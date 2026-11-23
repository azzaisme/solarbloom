import type { TileData } from '../core/types';
import { zoneAt, type PlantingZone, type ZoneCtx } from './PlantingZones';
import type { Species, TreeStage } from './TreeGen';

/**
 * Phase 5 visual overhaul: which restorable tiles grow a tree, of which species. Looks only: deterministic from
 * the tile's position and the world round it, so a tree never jumps between saves or rebuilds; nothing about it
 * is saved.
 *
 * P7-E29.4 (#737): trees are composed, not a flat share of tiles. Each cell's planting zone (P7-E28,
 * PlantingZones.zoneAt) decides its role:
 *  - groves: seeded grove centres (a jittered grid) gather 3–6 trees with overlapping crowns on lawn, meadow and
 *    woodland floor, so there are shaded glades with open lawn between them; woodland floor is denser;
 *  - specimens: the odd big lone tree, set two to four cells back from a path so it frames the route;
 *  - shoreline: willows (and the odd blossom) along banks;
 *  - accents: blossom trees among flower gardens;
 *  - nothing on path edges or in a landmark's or machine's clearance, so the centre of small squares, the jetty
 *    landing, bridges and machines stay readable. Paved streets, plazas and markets keep trees in planters, never
 *    on paving next to water (a jetty or a bridge).
 * Trees stand on natural ground: lawn, litter, clay and (restored) sand, so Saltwind Beach, the start, grows them.
 * A tree tile shows a sapling once restored and grows with the tile's bloom stage.
 *
 * Walkability is unchanged: tree tiles stay walkable (a tree is never a solid for movement), as before.
 */

const hash01 = (x: number, z: number, salt: number) => {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

type Mix = [Species, number][];

interface Rule {
  /** without a world (no zones known): share of natural tiles that grow a tree */
  share: number;
  /** of paved tiles (in planters) */
  planterShare?: number;
  /** grove trees */
  grove: Mix;
  /** shoreline trees */
  shore: Mix;
  /** lone specimens framing routes */
  specimen: Mix;
  /** how likely a grove centre is in a grid cell (0 none … 1 every cell) */
  groves: number;
}

const RULES: Record<string, Rule> = {
  park: { share: 0.16, grove: [['oak', 5], ['birch', 2], ['cherry', 1]], shore: [['willow', 5], ['cherry', 1]], specimen: [['oak', 3], ['cherry', 2]], groves: 0.7 },
  grove: { share: 0.3, grove: [['oak', 4], ['pine', 4], ['birch', 2]], shore: [['willow', 4], ['birch', 1]], specimen: [['oak', 3], ['pine', 1]], groves: 0.9 },
  canal: { share: 0.12, planterShare: 0.05, grove: [['oak', 3], ['birch', 2], ['cherry', 2]], shore: [['willow', 6], ['cherry', 1]], specimen: [['oak', 2], ['cherry', 2]], groves: 0.4 },
  reservoir: { share: 0.14, grove: [['oak', 3], ['willow', 2], ['birch', 1]], shore: [['willow', 6], ['oak', 1]], specimen: [['oak', 3], ['willow', 1]], groves: 0.45 },
  // the start: a beach park of shade oaks and windswept pines, willows on the canal, a blossom tree or two
  beach: { share: 0.1, grove: [['oak', 4], ['pine', 2], ['cherry', 1]], shore: [['willow', 5], ['cherry', 1]], specimen: [['oak', 3], ['cherry', 2]], groves: 0.75 },
  street: { share: 0.1, planterShare: 0.06, grove: [['birch', 3], ['cherry', 2]], shore: [['willow', 3], ['birch', 1]], specimen: [['cherry', 2], ['birch', 1]], groves: 0.2 },
  plaza: { share: 0.1, planterShare: 0.07, grove: [['birch', 3], ['cherry', 3]], shore: [['willow', 3], ['cherry', 1]], specimen: [['cherry', 2], ['oak', 1]], groves: 0.2 },
  market: { share: 0.08, planterShare: 0.04, grove: [['cherry', 3], ['birch', 3]], shore: [['willow', 3], ['cherry', 1]], specimen: [['cherry', 2], ['oak', 1]], groves: 0.15 },
  rooftops: { share: 0.1, planterShare: 0.05, grove: [['birch', 3], ['cherry', 2]], shore: [['willow', 1]], specimen: [['cherry', 1], ['birch', 1]], groves: 0.15 },
};
const PLANTER: Mix = [['birch', 6], ['cherry', 4]];

/** P7-E29 tunables (composition heuristics, not exact quotas). Sizes are in tiles; scales multiply the template. */
export const TREES = {
  /** grove centres: one candidate per `groveCell`² cells, jittered */
  groveCell: 9,
  /** a grove reaches this far from its centre */
  groveRadius: 2.4,
  /** chance a cell in reach grows a tree, at the centre (falls off toward the edge) */
  groveDensity: 0.62,
  /** …on woodland floor, where groves run together into a wood */
  woodDensity: 0.4,
  /** specimens: one candidate per `specimenCell`² cells, kept when it lands this many cells from a path or water */
  specimenCell: 7,
  specimenPath: [2, 4] as [number, number],
  specimenChance: 0.7,
  /** cells kept clear round a jetty or bridge deck */
  deckClear: 2,
  /** shoreline cells that grow a willow */
  shoreShare: 0.2,
  /** flower-garden cells that grow a blossom tree */
  accentShare: 0.05,
  /** meadow cells that grow a lone ornamental tree */
  meadowShare: 0.025,
  scale: {
    grove: [1.3, 1.75] as [number, number],
    specimen: [2.0, 2.4] as [number, number],
    shore: [1.35, 1.7] as [number, number],
    accent: [1.15, 1.4] as [number, number],
    planter: [0.86, 1.08] as [number, number],
    fallback: [1.0, 1.95] as [number, number],
  },
};

export interface TreeSpot {
  species: Species;
  variant: number;
  rot: number;
  scale: number;
  planter: boolean;
}

/** What placement needs to know about the world (P7-E28 zones and paths): Game binds the live world once. */
export interface TreeWorld {
  peek(x: number, z: number): Pick<TileData, 'feature' | 'blocked' | 'occupantId'> | undefined;
  areaAt(x: number, z: number): string;
  info(area: string): { type: string; landmark?: readonly [number, number]; noLandmark?: boolean };
}
let world: TreeWorld | undefined;
/** Binds the world tree placement reads (zones, paths). Without one, placement is a per-tile share (tests). */
export function setTreeWorld(w: TreeWorld | undefined) {
  world = w;
}

/** A cell's planting zone in the bound world (undefined without one). */
function zoneOfCell(x: number, z: number, areaType: string): PlantingZone | undefined {
  if (!world) return undefined;
  const w = world;
  const area = w.areaAt(x, z);
  const info = w.info(area);
  const ctx: ZoneCtx = { peek: (px, pz) => w.peek(px, pz), areaAt: (px, pz) => w.areaAt(px, pz), areaType, landmark: info.noLandmark ? undefined : info.landmark };
  return zoneAt(x, z, ctx);
}

const pick = (mix: Mix, u: number): Species => {
  const total = mix.reduce((a, [, w]) => a + w, 0);
  let k = u * total;
  for (const [sp, w] of mix) if ((k -= w) < 0) return sp;
  return mix[mix.length - 1][0];
};
const isHard = (t: Pick<TileData, 'feature' | 'blocked'> | undefined) => !!t && !t.blocked && (t.feature === 'paving' || t.feature === 'road');
const isWater = (t: Pick<TileData, 'feature'> | undefined) => t?.feature === 'water';

/** The jittered grove centre of grid cell (gx, gz), if that cell has a grove. */
function groveCentre(gx: number, gz: number, chance: number): [number, number] | undefined {
  if (hash01(gx, gz, 41) >= chance) return undefined;
  const C = TREES.groveCell;
  return [(gx + 0.2 + 0.6 * hash01(gx, gz, 42)) * C, (gz + 0.2 + 0.6 * hash01(gx, gz, 43)) * C];
}

/** How deep in a grove (x, z) stands: 1 at a centre … 0 at the edge or outside any grove. */
function groveDepth(x: number, z: number, chance: number): number {
  const C = TREES.groveCell;
  const gx = Math.floor(x / C), gz = Math.floor(z / C);
  let best = 0;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const c = groveCentre(gx + dx, gz + dz, chance);
      if (!c) continue;
      const d = Math.hypot(x + 0.5 - c[0], z + 0.5 - c[1]) / TREES.groveRadius;
      if (d < 1) best = Math.max(best, 1 - d);
    }
  return best;
}

/**
 * Chebyshev distance from (x, z) to the nearest cell `hit` accepts, up to `max` (max + 1 if none is that close).
 */
function distTo(x: number, z: number, max: number, hit: (x: number, z: number) => boolean): number {
  for (let r = 1; r <= max; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (hit(x + dx, z + dz)) return r;
      }
  return max + 1;
}
/** A route to frame: a path, a road or open water. */
const route = (x: number, z: number) => {
  const t = world!.peek(x, z);
  return isHard(t) || isWater(t);
};
/** A jetty or bridge deck: paving or road with water beside it. */
const deck = (x: number, z: number) => isHard(world!.peek(x, z)) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => isWater(world!.peek(x + dx, z + dz)));

/** Whether (x, z) is the specimen candidate of its grid cell. */
function specimenCell(x: number, z: number): boolean {
  const C = TREES.specimenCell;
  const gx = Math.floor(x / C), gz = Math.floor(z / C);
  if (hash01(gx, gz, 51) >= TREES.specimenChance) return false;
  return Math.floor(gx * C + hash01(gx, gz, 52) * C) === x && Math.floor(gz * C + hash01(gx, gz, 53) * C) === z;
}

type Role = 'grove' | 'specimen' | 'shore' | 'accent' | 'planter' | 'fallback';

/**
 * P7-E29.4: the one place a cell's tree role is decided (by its planting zone). Undefined: no tree.
 * `zone` may be passed when the caller already knows it (the chunk builder memoises zones per build).
 */
export function treeZone(t: Pick<TileData, 'x' | 'z' | 'feature' | 'blocked'>, areaType: string, zone = zoneOfCell(t.x, t.z, areaType)): { role: Role; mix: Mix; depth?: number } | undefined {
  const rule = RULES[areaType] ?? RULES.park;
  const f = t.feature ?? 'lawn';
  const natural = f === 'lawn' || f === 'litter' || f === 'clay' || f === 'sand';
  if (f === 'paving') {
    if (!rule.planterShare || hash01(t.x, t.z, 1) >= rule.planterShare) return undefined;
    // no planters on a jetty or a bridge (paving with water beside it)
    if (world && deck(t.x, t.z)) return undefined;
    return { role: 'planter', mix: PLANTER };
  }
  if (!natural) return undefined;
  if (!zone) return hash01(t.x, t.z, 1) < rule.share ? { role: 'fallback', mix: rule.grove } : undefined;
  if (zone === 'path_edge' || zone === 'landmark_clearance') return undefined;
  // keep the jetty landing and bridge ends open: no crowns over the planks or the first steps off them
  if (world && distTo(t.x, t.z, TREES.deckClear, deck) <= TREES.deckClear) return undefined;
  const u = hash01(t.x, t.z, 1);
  switch (zone) {
    case 'shoreline':
      return u < TREES.shoreShare ? { role: 'shore', mix: rule.shore } : undefined;
    default: {
      // open lawn, meadow, woodland floor (and, thinner, gardens): groves first, then a lone specimen framing a
      // path or the water, then the odd ornamental
      const wood = zone === 'woodland_understory';
      const garden = zone === 'flower_garden';
      const depth = groveDepth(t.x, t.z, wood ? 1 : rule.groves);
      const p = (depth > 0 ? TREES.groveDensity * (0.45 + 0.55 * depth) : wood ? TREES.woodDensity * 0.5 : 0) * (garden ? 0.5 : 1);
      if (u < p) return { role: 'grove', mix: rule.grove, depth };
      if (!wood && specimenCell(t.x, t.z) && world) {
        const d = distTo(t.x, t.z, TREES.specimenPath[1], route);
        if (d >= TREES.specimenPath[0] && d <= TREES.specimenPath[1]) return { role: 'specimen', mix: rule.specimen };
      }
      if (garden) return u < TREES.accentShare ? { role: 'accent', mix: [['cherry', 1]] } : undefined;
      if (zone === 'meadow' && hash01(t.x, t.z, 7) < TREES.meadowShare) return { role: 'accent', mix: [['birch', 2], ['cherry', 1]] };
      return undefined;
    }
  }
}

/** The tree this tile grows, if any (ignores its current state). */
export function treeSpot(t: Pick<TileData, 'x' | 'z' | 'feature' | 'blocked'>, areaType: string, zone?: PlantingZone): TreeSpot | undefined {
  if (t.blocked) return undefined;
  const z = zone === undefined ? treeZone(t, areaType) : treeZone(t, areaType, zone);
  if (!z) return undefined;
  const [s0, s1] = TREES.scale[z.role];
  let scale = s0 + (s1 - s0) * hash01(t.x, t.z, 5);
  // Phase 6: without zones, about a third of the trees are big specimens; the rest stay ornamental
  if (z.role === 'fallback') scale = hash01(t.x, t.z, 6) < 0.34 ? 1.65 + hash01(t.x, t.z, 5) * 0.3 : 1.0 + hash01(t.x, t.z, 5) * 0.25;
  // a grove's edge trees are a little smaller, so its canopy domes up in the middle
  if (z.role === 'grove') scale *= 0.88 + 0.12 * Math.min(1, (z.depth ?? 0) * 2);
  return {
    species: pick(z.mix, hash01(t.x, t.z, 2)),
    variant: Math.floor(hash01(t.x, t.z, 3) * 4),
    rot: hash01(t.x, t.z, 4) * Math.PI * 2,
    scale,
    planter: z.role === 'planter',
  };
}

/**
 * The growth stage a tile shows (undefined: nothing grows there yet). `bloom` is the stage the tile shows, which
 * low water nearby can fade (E23.4.4: pass `sim.water.bloomShown(t)`); it defaults to the tile's own.
 */
export function treeStage(t: Pick<TileData, 'ground' | 'bloom' | 'occupantId'>, bloom = t.bloom): TreeStage | undefined {
  if (t.ground !== 'restored' || t.occupantId) return undefined;
  return Math.max(1, Math.min(4, bloom || 1)) as TreeStage;
}
