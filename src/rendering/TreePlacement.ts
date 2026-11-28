import { areaMapFor } from '../core/Areas';
import { LANDING } from '../data/oldcity';
import { regionOfCell } from '../core/OldCityLayout';
import { DAY_SECONDS } from '../data/time';
import { TERRAIN } from '../data/terrain';
import { CHUNK, generateTile } from '../core/Generation';
import type { LayerData, TileData } from '../core/types';
import { beachDepth, zoneAt, type PlantingZone, type ZoneCtx } from './PlantingZones';
import { FORM_SPECIES, TREE_VARIANTS, type Form, type Species, type TreeStage } from './TreeGen';

/**
 * Phase 5 visual overhaul: which restorable tiles grow a tree, of which species. A pure function of the seed and
 * the cell: it reads the world as generated (TreeWorld: generated tiles, the area map), never the live grid, so a
 * tree never depends on which chunks are loaded, on restoration changing a tile (water filling), or on machines
 * built nearby, and never jumps between saves or rebuilds. Nothing about it is saved. The simulation reads it
 * (Ecosystem's thriving trees and species, Wildlife's plant kinds), so the game, headless sims and tests all get
 * the same trees: every caller passes the world of its own seed (`treeWorldOf(sim)`).
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
  /** on roofs (no zones up there): share of natural tiles that grow a tree */
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
  /** how densely a grove carries on into a flower garden (default 0.5: gardens stay mostly open) */
  gardenGroves?: number;
  /**
   * grove and woodland density factor, calibrated so each area type keeps about as many tree tiles as before
   * zones (the simulation counts them: Ecosystem's thriving trees and species, Wildlife), tested
   */
  density?: number;
  /** cells kept clear round the landmark (default TREES.landmarkClear) */
  landmarkClear?: number;
}

const RULES: Record<string, Rule> = {
  park: { share: 0.16, grove: [['oak', 5], ['birch', 2], ['cherry', 1]], shore: [['willow', 5], ['cherry', 1]], specimen: [['oak', 3], ['cherry', 2]], groves: 1, gardenGroves: 1, density: 2.4, landmarkClear: 2 },
  grove: { share: 0.3, grove: [['oak', 4], ['pine', 4], ['birch', 2]], shore: [['willow', 4], ['birch', 1]], specimen: [['oak', 3], ['pine', 1]], groves: 0.9, density: 1.4 },
  canal: { share: 0.12, planterShare: 0.05, grove: [['oak', 3], ['birch', 2], ['cherry', 2]], shore: [['willow', 6], ['cherry', 1]], specimen: [['oak', 2], ['cherry', 2]], groves: 0.4 },
  reservoir: { share: 0.14, grove: [['oak', 3], ['willow', 2], ['birch', 1]], shore: [['willow', 6], ['oak', 1]], specimen: [['oak', 3], ['willow', 1]], groves: 0.8, density: 1.8 },
  // the start: a coastal park of broad shade oaks (a pine only as a rare accent), willows on the canal and the odd
  // blossom tree, like the reference coast.
  // Pacing (owner-approved, P7-E29 #737): the beach had no trees before; now a few specimens and small groves inland
  // (thinned by half, none on the open sand by the sea) and the odd row of columnar trees bring songbirds (20 thriving
  // tree tiles) sooner round the start: 975 -> 500 restored tiles in the outward-restore proxy (seeds 7 and 21; 250
  // with the first, denser pass). See the commit "P7-E29 polish". TUNING is unchanged by decision.
  beach: { share: 0.1, grove: [['oak', 6], ['birch', 1], ['cherry', 1]], shore: [['willow', 5], ['cherry', 1]], specimen: [['oak', 3], ['cherry', 2]], groves: 0.45, density: 0.6 },
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
  deckClear: 3,
  /** …and within this many cells, only small trees, so the view from a jetty or bridge (the opening view from the
   * jetty end inland) is framed, not blocked, by big crowns */
  deckSmall: 6,
  /** the largest scale near a deck */
  deckScale: 1.15,
  /**
   * P7-E29 polish: the opening view from the jetty landing (Bloombot's spawn) to the showcase waterfall's lip
   * (P7-E30) stays open: within `viewHalf` cells of that line, only small trees (`deckScale`)
   */
  viewHalf: 2.5,
  /** the Falls overlook works as a lookout: no trees on its top, only small ones (`overlookScale`) within
   * `overlookEdge` cells of its seaward and beachward edges */
  overlookEdge: 2,
  overlookScale: 1.0,
  /** round a landmark (any area's, within this many cells): no columnar rows, and only small trees */
  landmarkView: 6,
  /** cells kept clear of trees round an area's landmark (its 2×2 footprint), so it reads from a distance */
  landmarkClear: 3,
  /** shoreline cells that grow a willow */
  shoreShare: 0.2,
  /** flower-garden cells that grow a blossom tree */
  accentShare: 0.05,
  /** meadow cells that grow a lone ornamental tree */
  meadowShare: 0.025,
  scale: {
    grove: [1.3, 1.6] as [number, number],
    specimen: [2.0, 2.4] as [number, number],
    shore: [1.2, 1.6] as [number, number],
    accent: [1.15, 1.4] as [number, number],
    planter: [0.86, 1.08] as [number, number],
    fallback: [1.0, 1.95] as [number, number],
    row: [1.05, 1.3] as [number, number],
  },
  /**
   * columnar trees in rows two cells off a path or canal: where the row field (smooth noise, cells of `rowScale`) is
   * above `rowField`, every third cell along
   */
  rowScale: 7,
  rowField: 0.62,
  /** specimens: shares of umbrella and coastal forms by the sea (within 4 of water or next to the beach) and inland */
  coastForms: { coastal: 0.5, umbrella: 0.3 },
  inlandForms: { umbrella: 0.35 },
  /** a grove's large oaks that are umbrellas */
  groveUmbrella: 0.4,
  /** garden accents that are fruit trees */
  fruitShare: 0.6,
  /**
   * grove trees come in size classes, so a grove isn't all one height: [share, scale range] (the rest are `scale.grove`,
   * the mid trees); specimens are the rare hero trees
   */
  groveSmall: [0.3, [1.0, 1.25]] as [number, [number, number]],
  groveLarge: [0.15, [1.7, 1.95]] as [number, [number, number]],
};

export interface TreeSpot {
  species: Species;
  /** P7-E29: the tree's shape (TreeGen `Form`; the species stays what the simulation counts) */
  form: Form;
  variant: number;
  rot: number;
  scale: number;
  planter: boolean;
}

/** The world as generated, which placement reads (P7-E28 zones and paths). Pure: one per seed and ground layer. */
export interface TreeWorld {
  /** the generated tile at (x, z): its feature and blocking as the seed made it (never the live state) */
  peek(x: number, z: number): Pick<TileData, 'feature' | 'blocked' | 'occupantId' | 'level' | 'prop'> | undefined;
  areaAt(x: number, z: number): string;
  info(area: string): { type: string; landmark?: readonly [number, number]; noLandmark?: boolean };
  /** placement per cell, memoised (pure, so it never goes stale) */
  memo: Map<number, ReturnType<typeof treeZone> | null>;
  /** giant tree candidates per giant grid cell, memoised (pure) */
  giants?: Map<number, GiantSpot | null>;
}

const WORLDS = new Map<string, TreeWorld>();
/** The generated world of a seed's ground layer, shared by everything that asks for it (memoised). */
export function treeWorldFor(seed: number, layer: LayerData): TreeWorld {
  const key = `${seed}|${layer.id}|${layer.gen ?? 1}`;
  let w = WORLDS.get(key);
  if (w) return w;
  if (WORLDS.size > 4) WORLDS.clear();
  const map = areaMapFor(seed, layer.gen ?? 1);
  const chunks = new Map<number, (TileData | undefined)[]>();
  const ck = (cx: number, cz: number) => (cx + 0x8000) * 0x10000 + (cz + 0x8000);
  w = {
    peek(x, z) {
      const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
      let c = chunks.get(ck(cx, cz));
      if (!c) {
        if (chunks.size > 4096) chunks.clear();
        c = new Array(CHUNK * CHUNK);
        for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) c[lz * CHUNK + lx] = generateTile(seed, layer, cx * CHUNK + lx, cz * CHUNK + lz);
        chunks.set(ck(cx, cz), c);
      }
      return c[(z - cz * CHUNK) * CHUNK + (x - cx * CHUNK)];
    },
    areaAt: (x, z) => map.areaOfCell(x, z),
    info: (a) => map.info(a),
    memo: new Map(),
  };
  WORLDS.set(key, w);
  return w;
}

/** A sim's (or any game state's) generated world. */
export function treeWorldOf(sim: { state: { seed: number }; grid: { layer(id: string): LayerData | undefined } }): TreeWorld {
  return treeWorldFor(sim.state.seed, sim.grid.layer('g')!);
}

/** A cell's planting zone in the generated world: machines are ignored (P7-E28 `ignoreOccupants`). */
function zoneCtx(w: TreeWorld, x: number, z: number, areaType: string): ZoneCtx {
  const info = w.info(w.areaAt(x, z));
  return { peek: (px, pz) => w.peek(px, pz), areaAt: (px, pz) => w.areaAt(px, pz), areaType, landmark: info.noLandmark ? undefined : info.landmark, ignoreOccupants: true };
}
function zoneOfCell(w: TreeWorld, x: number, z: number, areaType: string): PlantingZone {
  return zoneAt(x, z, zoneCtx(w, x, z, areaType));
}
/** Whether a P7-E28 beach (open sand by the sea) lies within `r` cells of (x, z). */
function nearBeach(w: TreeWorld, x: number, z: number, areaType: string, r: number): boolean {
  const ctx = zoneCtx(w, x, z, areaType);
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if ((dx || dz) && beachDepth(x + dx, z + dz, ctx) !== undefined) return true;
  return false;
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
const route = (w: TreeWorld) => (x: number, z: number) => {
  const t = w.peek(x, z);
  return isHard(t) || isWater(t);
};
/** A jetty or bridge deck: paving or road with water beside it. */
const deck = (w: TreeWorld) => (x: number, z: number) => isHard(w.peek(x, z)) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => isWater(w.peek(x + dx, z + dz)));

/** Distance from (x, z) to the segment a–b. */
function segDist(x: number, z: number, a: readonly [number, number], b: readonly [number, number]) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}

/** Whether any area's landmark (its 2×2 footprint) lies within `r` cells of (x, z). */
function landmarkNear(w: TreeWorld, x: number, z: number, r: number): boolean {
  const seen = new Set<string>();
  for (const [dx, dz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r], [0, -r], [0, r], [-r, 0], [r, 0]]) {
    const a = w.areaAt(x + dx, z + dz);
    if (seen.has(a)) continue;
    seen.add(a);
    const info = w.info(a);
    if (info.noLandmark || !info.landmark) continue;
    const [lx, lz] = info.landmark;
    if (Math.max(x < lx ? lx - x : x > lx + 1 ? x - lx - 1 : 0, z < lz ? lz - z : z > lz + 1 ? z - lz - 1 : 0) <= r) return true;
  }
  return false;
}

/** Smooth value noise for the columnar rows (0…1). */
function rowNoise(x: number, z: number) {
  const s = TREES.rowScale;
  const fx = x / s, fz = z / s;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = fx - x0, tz = fz - z0;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash01(x0, z0, 61), b = hash01(x0 + 1, z0, 61), c = hash01(x0, z0 + 1, 61), d = hash01(x0 + 1, z0 + 1, 61);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/** The way from (x, z) to the nearest open water within `r` cells (unit x, z), if any. */
function seaward(w: TreeWorld, x: number, z: number, r: number): [number, number] | undefined {
  let vx = 0, vz = 0;
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      if (!isWater(w.peek(x + dx, z + dz))) continue;
      const d2 = dx * dx + dz * dz;
      vx += dx / d2;
      vz += dz / d2;
    }
  const l = Math.hypot(vx, vz);
  return l > 1e-6 ? [vx / l, vz / l] : undefined;
}

/** Whether (x, z) is the specimen candidate of its grid cell. */
function specimenCell(x: number, z: number): boolean {
  const C = TREES.specimenCell;
  const gx = Math.floor(x / C), gz = Math.floor(z / C);
  if (hash01(gx, gz, 51) >= TREES.specimenChance) return false;
  return Math.floor(gx * C + hash01(gx, gz, 52) * C) === x && Math.floor(gz * C + hash01(gx, gz, 53) * C) === z;
}

type Role = 'grove' | 'specimen' | 'shore' | 'accent' | 'planter' | 'fallback' | 'row';

/**
 * P7-E29.4: the one place a ground cell's tree role is decided (by its planting zone in the generated world).
 * Undefined: no tree. Roof cells (no zones up there) take a plain per-cell share.
 */
export function treeZone(x: number, z: number, areaType: string, w: TreeWorld, roof = false): { role: Role; mix: Mix; depth?: number; small?: boolean; cap?: number } | undefined {
  const rule = RULES[areaType] ?? RULES.park;
  const t = w.peek(x, z);
  if (!t || t.blocked) return undefined;
  const f = t.feature ?? 'lawn';
  const natural = f === 'lawn' || f === 'litter' || f === 'clay' || f === 'sand';
  if (f === 'paving') {
    if (!rule.planterShare || hash01(x, z, 1) >= rule.planterShare) return undefined;
    // no planters on a jetty or a bridge (paving with water beside it)
    if (deck(w)(x, z)) return undefined;
    return { role: 'planter', mix: PLANTER };
  }
  if (!natural) return undefined;
  // a giant tree's trunk and roots take their cells; nothing else grows right against its trunk
  if (!roof && giantNear(w, x, z, GIANT.ring)) return undefined;
  if (roof) return hash01(x, z, 1) < rule.share ? { role: 'fallback', mix: rule.grove } : undefined;
  const zone = zoneOfCell(w, x, z, areaType);
  if (zone === 'path_edge' || zone === 'landmark_clearance') return undefined;
  // keep the jetty landing and bridge ends open: no crowns over the planks or the first steps off them
  const dd = distTo(x, z, TREES.deckSmall, deck(w));
  if (dd <= TREES.deckClear) return undefined;
  let cap = dd <= TREES.deckSmall ? TREES.deckScale : Infinity;
  // and the landmark: no crown hides it (P7-E28's clearance is one cell, for flowers)
  const info = w.info(w.areaAt(x, z));
  if (!info.noLandmark && info.landmark) {
    const [lx, lz] = info.landmark;
    const d = Math.max(x < lx ? lx - x : x > lx + 1 ? x - lx - 1 : 0, z < lz ? lz - z : z > lz + 1 ? z - lz - 1 : 0);
    if (d <= (rule.landmarkClear ?? TREES.landmarkClear)) return undefined;
  }
  // P7-E29 polish: views kept open (the waterfall from the jetty, the overlook, landmarks from round about)
  const ov = TERRAIN.overlook;
  if (x >= ov.x && x < ov.x + ov.w && z >= ov.z && z < ov.z + ov.d) return undefined;
  const e = TREES.overlookEdge;
  if (x >= ov.x - 1 && x < ov.x + ov.w + e && z >= ov.z - 1 && z < ov.z + ov.d + e) cap = Math.min(cap, TREES.overlookScale);
  if (segDist(x + 0.5, z + 0.5, LANDING.spawn, [TERRAIN.fall.x + 0.5, TERRAIN.fall.lip]) <= TREES.viewHalf) cap = Math.min(cap, TREES.deckScale);
  const nearMark = landmarkNear(w, x, z, TREES.landmarkView);
  if (nearMark) cap = Math.min(cap, TREES.deckScale);
  const small = cap < Infinity;
  const u = hash01(x, z, 1);
  switch (zone) {
    case 'beach':
      // P7-E28: the open sand by the sea stays a real beach (owner): no trees on it
      return undefined;
    case 'shoreline':
      return u < TREES.shoreShare ? { small, cap, role: 'shore', mix: rule.shore } : undefined;
    default: {
      // open lawn, meadow, woodland floor (and, thinner, gardens): groves first, then a lone specimen framing a
      // path or the water, then the odd ornamental
      const wood = zone === 'woodland_understory';
      const garden = zone === 'flower_garden';
      const depth = groveDepth(x, z, wood ? 1 : rule.groves);
      const p = Math.min(0.92, (depth > 0 ? TREES.groveDensity * (0.45 + 0.55 * depth) : wood ? TREES.woodDensity * 0.5 : 0) * (garden ? rule.gardenGroves ?? 0.5 : 1) * (rule.density ?? 1));
      if (u < p) return { small, cap, role: 'grove', mix: rule.grove, depth };
      if (!wood && specimenCell(x, z)) {
        const d = distTo(x, z, TREES.specimenPath[1], route(w));
        if (d >= TREES.specimenPath[0] && d <= TREES.specimenPath[1]) return { small, cap, role: 'specimen', mix: rule.specimen };
        // just inland of the beach, the odd coastal specimen frames it
        if (nearBeach(w, x, z, areaType, 2)) return { small, cap, role: 'specimen', mix: rule.specimen };
      }
      // columnar trees in short rows along paths and canals
      if (!wood && !nearMark && rowNoise(x, z) > TREES.rowField && (((x * 7 + z * 13) % 3) + 3) % 3 === 0 && distTo(x, z, 2, route(w)) === 2) return { small, cap, role: 'row', mix: [['birch', 1]] };
      if (garden) return u < TREES.accentShare ? { small, cap, role: 'accent', mix: [['cherry', 1]] } : undefined;
      if (zone === 'meadow' && hash01(x, z, 7) < TREES.meadowShare) return { small, cap, role: 'accent', mix: [['birch', 2], ['cherry', 1]] };
      return undefined;
    }
  }
}

/**
 * The tree this tile grows, if any (ignores its current growth). `w`: the world of the tile's seed
 * (`treeWorldOf(sim)`). A tile blocked now shows no tree, but where trees stand comes from generation alone.
 */
export function treeSpot(t: Pick<TileData, 'x' | 'z' | 'blocked' | 'laid'> & { roofId?: string }, areaType: string, w: TreeWorld): TreeSpot | undefined {
  if (t.blocked || (t.laid && t.laid !== 'grass')) return undefined; // nothing grows through a footpath or road Bloombot laid
  const roof = t.roofId !== undefined && t.roofId !== 'g';
  const key = (t.x + 0x8000) * 0x10000 + (t.z + 0x8000);
  let z: ReturnType<typeof treeZone> | null | undefined = roof ? undefined : w.memo.get(key);
  if (z === undefined) {
    // a ground cell's area type comes from the world itself, so every caller gets the same answer
    z = (roof ? undefined : treeZone(t.x, t.z, w.info(w.areaAt(t.x, t.z)).type, w)) ?? null;
    if (!roof) {
      if (w.memo.size > 200_000) w.memo.clear();
      w.memo.set(key, z);
    }
  }
  if (roof) z = hash01(t.x, t.z, 1) < (RULES[areaType] ?? RULES.park).share ? { role: 'fallback', mix: (RULES[areaType] ?? RULES.park).grove } : null;
  if (!z) return undefined;
  const [s0, s1] = TREES.scale[z.role];
  let scale = s0 + (s1 - s0) * hash01(t.x, t.z, 5);
  // Phase 6: without zones, about a third of the trees are big specimens; the rest stay ornamental
  if (z.role === 'fallback') scale = hash01(t.x, t.z, 6) < 0.34 ? 1.65 + hash01(t.x, t.z, 5) * 0.3 : 1.0 + hash01(t.x, t.z, 5) * 0.25;
  if (z.role === 'grove') {
    // size classes: small, mid and the odd large tree
    const c = hash01(t.x, t.z, 8);
    const [sS, rS] = TREES.groveSmall, [sL, rL] = TREES.groveLarge;
    const r = c < sS ? rS : c > 1 - sL ? rL : undefined;
    if (r) scale = r[0] + (r[1] - r[0]) * hash01(t.x, t.z, 5);
    // a grove's edge trees are a little smaller, so its canopy domes up in the middle
    scale *= 0.88 + 0.12 * Math.min(1, (z.depth ?? 0) * 2);
  }
  // near a jetty or bridge, only small trees (the view off the deck stays open)
  if (z.small) scale = Math.min(scale, z.cap ?? TREES.deckScale);
  let species = pick(z.mix, hash01(t.x, t.z, 2));
  let rot = hash01(t.x, t.z, 4) * Math.PI * 2;
  // P7-E29: the shape. Specimens are umbrella or coastal trees now and then (coastal ones by the sea, leaning away
  // from it), garden accents mostly fruit trees, rows columnar; everything else the species' own shape
  let form: Form = 'standard';
  const f = hash01(t.x, t.z, 9);
  if (z.role === 'row') form = 'columnar';
  // a grove's large trees are sometimes umbrellas, standing over the rest
  else if (z.role === 'grove' && scale >= TREES.groveLarge[1][0] * 0.88 && species === 'oak' && f < TREES.groveUmbrella) form = 'umbrella';
  else if (z.role === 'accent' && species === 'cherry' && f < TREES.fruitShare) form = 'fruit';
  else if (z.role === 'specimen') {
    const sea = seaward(w, t.x, t.z, 6);
    if (sea && f < TREES.coastForms.coastal) {
      form = 'coastal';
      // the template leans toward +x; turn it so it leans away from the sea (FoliageBuilder turns +x to (cos, sin))
      rot = Math.atan2(-sea[1], -sea[0]) + (hash01(t.x, t.z, 10) - 0.5) * 0.5;
    } else if (f < (sea ? TREES.coastForms.coastal + TREES.coastForms.umbrella : TREES.inlandForms.umbrella)) form = 'umbrella';
  }
  if (form !== 'standard') species = FORM_SPECIES[form];
  return {
    species,
    form,
    variant: Math.floor(hash01(t.x, t.z, 3) * TREE_VARIANTS),
    rot,
    scale,
    planter: z.role === 'planter',
  };
}

/**
 * Trees grow over game days (owner, 26 Nov 2026): a tree starts as a sapling when its ground is restored and
 * reaches each stage only once it is old enough, never at once. The tile's bloom still caps it (a tile left at its
 * first bloom keeps a sapling). Ages are game seconds (the game clock, `gameSecondsOf`: sleeping moves it on).
 *   days[i]: the age (game days) a tree needs to show stage i + 1 (sapling, young, full, Radiant)
 */
export const TREE_GROWTH = {
  days: [0, 1, 3, 4] as readonly number[],
  /** giant trees take longer */
  giantDays: [0, 2, 5, 7] as readonly number[],
  /** seconds (sim time) a tree takes to grow into its next stage on screen when it reaches it */
  morph: 20,
};

/** The stage a tree of this age (game seconds) has grown to, before its bloom caps it. */
export function ageStage(age: number, giant = false): TreeStage {
  const days = giant ? TREE_GROWTH.giantDays : TREE_GROWTH.days;
  let s = 1;
  for (let i = 1; i < days.length; i++) if (age >= days[i] * DAY_SECONDS) s = i + 1;
  return s as TreeStage;
}

/** The age (game seconds) at which a tree is fully grown: past it, its planting time no longer matters. */
export function grownAge(giant = false): number {
  const days = giant ? TREE_GROWTH.giantDays : TREE_GROWTH.days;
  return days[days.length - 1] * DAY_SECONDS;
}

/**
 * The growth stage a tile's tree shows (undefined: nothing grows there yet). `bloom` is the stage the tile shows,
 * which low water nearby can fade (E23.4.4: pass `sim.water.bloomShown(t)`); it defaults to the tile's own. `now`
 * (game seconds, `gameSecondsOf(state)`) ages the tree from `treeAt`, when it was planted; a tree without a
 * planting time (grown, or from a save made before trees grew) shows its bloom.
 */
export function treeStage(t: Pick<TileData, 'ground' | 'bloom' | 'occupantId' | 'treeAt'>, bloom = t.bloom, now?: number, giant = false): TreeStage | undefined {
  if (t.ground !== 'restored' || (t.occupantId && !giant)) return undefined;
  const cap = Math.max(1, Math.min(4, bloom || 1)) as TreeStage;
  if (now === undefined || t.treeAt === undefined) return cap;
  return Math.min(cap, ageStage(now - t.treeAt, giant)) as TreeStage;
}

/**
 * When (game seconds) the tree's shown stage next changes as it ages, or undefined when ageing can't change it any
 * more (fully grown, or its bloom caps it where it is).
 */
export function nextTreeStep(t: Pick<TileData, 'ground' | 'bloom' | 'treeAt'>, now: number, giant = false, bloom = t.bloom): number | undefined {
  if (t.ground !== 'restored' || t.treeAt === undefined) return undefined;
  const cap = Math.max(1, Math.min(4, bloom || 1));
  const s = ageStage(now - t.treeAt, giant);
  if (s >= cap) return undefined;
  const days = giant ? TREE_GROWTH.giantDays : TREE_GROWTH.days;
  return t.treeAt + days[s] * DAY_SECONDS;
}

// ───────────── giant trees ─────────────

/**
 * Giant trees (owner, 26 Nov 2026): huge old trees with a tall bare trunk and a broad canopy well above the
 * follow camera, so Bloombot walks under the leaves. In the world they grow only in the woodland (Elder Grove: none
 * at the fountain or on the beach), a few to the region; the player can also plant them there once unlocked
 * (a `giantTree` machine). A world giant's trunk stands on the corner where four cells meet (its trunk cells): they
 * are solid (the sim stamps them occupied, as a decoration's tile), and their ground drives the tree: bare and dusty
 * until one is restored, then leafing out over game days (TREE_GROWTH.giantDays) as far as their bloom allows.
 */
export const GIANT = {
  /** Old City regions where giants grow in the world */
  regions: ['elderGrove'] as readonly string[],
  /** one candidate per `cell`² cells, jittered */
  cell: 12,
  /** where in its grid cell a giant may stand (share of `cell`), and how many spots are tried there */
  jitter: [0.15, 0.85] as [number, number],
  tries: 24,
  /** trunks at least this far apart (canopies touch, they don't pile up) */
  spacing: 8,
  /** cells round the trunk cells where no other tree grows (its roots), and how many of them may be rubble */
  ring: 1,
  rubble: 3,
  /**
   * cells kept clear (from the trunk's centre) round the region's landmark (its own great tree stands alone), its
   * gate, the Keeper's patch and seam, and the spots where finds lie
   */
  clear: { landmark: 6, gate: 4, seam: 3, patch: 2, spot: 2 },
  /** the trunk's radius at its foot (tiles); the canopy's size is measured from its geometry (GiantTreeGen) */
  trunkR: 0.6,
};

export interface GiantSpot {
  /** the trunk's lower corner cell: the trunk cells are (gx, gz) … (gx + 1, gz + 1) */
  gx: number;
  gz: number;
  /** the trunk's centre (world x, z): where the four trunk cells meet */
  x: number;
  z: number;
  variant: number;
  rot: number;
}

/** Points in the region that a giant keeps clear of. */
export function giantKeepClear(x: number, z: number): boolean {
  const r = regionOfCell(x, z);
  if (!r) return true;
  const K = GIANT.clear;
  const pts: [number, number, number][] = [[r.landmark.x + 1, r.landmark.z + 1, K.landmark + 1]];
  if (r.seam) pts.push([r.seam.x + 1, r.seam.z + 1, K.seam + 1]);
  for (const c of [...(r.caches ?? []), ...(r.pages ?? [])]) pts.push([c.x + 0.5, c.z + 0.5, K.spot + 0.5]);
  for (const [gx, gz] of r.gate?.cells ?? []) pts.push([gx + 0.5, gz + 0.5, K.gate + 0.5]);
  if (r.patch && Math.max(r.patch.x - x, x - (r.patch.x + r.patch.w), r.patch.z - z, z - (r.patch.z + r.patch.d)) <= K.patch) return true;
  return pts.some(([px, pz, d]) => Math.max(Math.abs(px - x), Math.abs(pz - z)) <= d);
}

/** The giant candidate of giant grid cell (gx, gz), if it is one (memoised per world). */
function giantOfCell(w: TreeWorld, cx: number, cz: number): GiantSpot | undefined {
  const memo = (w.giants ??= new Map());
  const key = (cx + 0x8000) * 0x10000 + (cz + 0x8000);
  const hit = memo.get(key);
  if (hit !== undefined) return hit ?? undefined;
  const C = GIANT.cell;
  const [j0, j1] = GIANT.jitter;
  // most of the world has no giants: a cell with no woodland in it is settled at once (and ends the look-back below)
  let woods = false;
  for (let i = 0; i <= 4 && !woods; i++) for (let j = 0; j <= 4 && !woods; j++) woods = GIANT.regions.includes(regionOfCell(Math.floor((cx + i / 4) * C), Math.floor((cz + j / 4) * C))?.id ?? '');
  if (!woods) {
    memo.set(key, null);
    return undefined;
  }
  // giants of the cells before this one (in reading order) keep this one at a distance, so canopies don't pile up
  const before = [[-1, -1], [0, -1], [1, -1], [-1, 0]].map(([dx, dz]) => giantOfCell(w, cx + dx, cz + dz)).filter((g): g is GiantSpot => !!g);
  let spot: GiantSpot | null = null;
  // a few spots in the cell's middle, in a seeded order: the first that suits takes it
  for (let i = 0; i < GIANT.tries && !spot; i++) {
    const gx = Math.floor((cx + j0 + (j1 - j0) * hash01(cx * 31 + i, cz, 71)) * C);
    const gz = Math.floor((cz + j0 + (j1 - j0) * hash01(cx, cz * 31 + i, 72)) * C);
    if (giantFits(w, gx, gz) && before.every((g) => Math.hypot(g.x - gx - 1, g.z - gz - 1) >= GIANT.spacing))
      spot = { gx, gz, x: gx + 1, z: gz + 1, variant: Math.floor(hash01(cx, cz, 73) * 6), rot: hash01(cx, cz, 74) * Math.PI * 2 };
  }
  if (memo.size > 20_000) memo.clear();
  memo.set(key, spot);
  return spot ?? undefined;
}

/** Can a giant's trunk stand with its lower corner cell at (gx, gz)? */
export function giantFits(w: TreeWorld, gx: number, gz: number): boolean {
  const home = regionOfCell(gx, gz)?.id;
  if (!GIANT.regions.includes(home ?? '') || giantKeepClear(gx + 1, gz + 1)) return false;
  const R = GIANT.ring;
  const level = w.peek(gx, gz)?.level;
  let rubble = 0;
  for (let dz = -R; dz < 2 + R; dz++)
    for (let dx = -R; dx < 2 + R; dx++) {
      const x = gx + dx, z = gz + dz;
      // the whole footprint in the region, at one height; the trunk on open natural ground, the roots round it
      // among at most a little rubble (an old tree in an old wood)
      if (regionOfCell(x, z)?.id !== home) return false;
      const t = w.peek(x, z);
      if (!t || t.level !== level) return false;
      const f = t.feature ?? 'lawn';
      const open = !t.blocked && !t.prop && (f === 'lawn' || f === 'litter' || f === 'clay');
      const trunk = dx >= 0 && dx < 2 && dz >= 0 && dz < 2;
      if (!open && (trunk || f === 'building' || ++rubble > GIANT.rubble)) return false;
    }
  // and off the paths: nothing hard or wet within two cells of the trunk
  for (let dz = -2; dz < 4; dz++)
    for (let dx = -2; dx < 4; dx++) if (isHard(w.peek(gx + dx, gz + dz)) || isWater(w.peek(gx + dx, gz + dz))) return false;
  return true;
}

/** The world giant whose trunk cells or surrounding ring (within `ring` cells of them) include (x, z), if any. */
export function giantNear(w: TreeWorld, x: number, z: number, ring = 0): GiantSpot | undefined {
  // a cheap gate: giants grow only in their regions
  if (!GIANT.regions.includes(regionOfCell(x, z)?.id ?? '')) return undefined;
  const C = GIANT.cell;
  const cx = Math.floor(x / C), cz = Math.floor(z / C);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const g = giantOfCell(w, cx + dx, cz + dz);
      if (g && x >= g.gx - ring && x < g.gx + 2 + ring && z >= g.gz - ring && z < g.gz + 2 + ring) return g;
    }
  return undefined;
}

/** The world giants with a trunk within `r` tiles of (x, z) (centre to trunk). */
export function giantsWithin(w: TreeWorld, x: number, z: number, r: number): GiantSpot[] {
  const C = GIANT.cell;
  const out: GiantSpot[] = [];
  for (let cz = Math.floor((z - r) / C) - 1; cz <= Math.floor((z + r) / C) + 1; cz++)
    for (let cx = Math.floor((x - r) / C) - 1; cx <= Math.floor((x + r) / C) + 1; cx++) {
      const g = giantOfCell(w, cx, cz);
      if (g && Math.hypot(g.x - x, g.z - z) <= r) out.push(g);
    }
  return out;
}

/** The trunk cells of a giant whose lower corner is (gx, gz). */
export function giantCells(g: Pick<GiantSpot, 'gx' | 'gz'>): [number, number][] {
  return [[g.gx, g.gz], [g.gx + 1, g.gz], [g.gx, g.gz + 1], [g.gx + 1, g.gz + 1]];
}

/** What a giant's trunk cells say about it: restored at all, when it began growing, how far its bloom allows. */
export function giantGrowth(cells: (Pick<TileData, 'ground' | 'bloom' | 'treeAt'> | undefined)[], now: number): { stage: 0 | TreeStage; next?: number } {
  // the first cell restored starts it; the furthest-bloomed cell caps it; the oldest planting time ages it
  let bloom = 0;
  let at: number | undefined;
  let grown = false;
  for (const t of cells) {
    if (!t || t.ground !== 'restored') continue;
    bloom = Math.max(bloom, t.bloom || 1);
    if (t.treeAt === undefined) grown = true;
    else at = at === undefined ? t.treeAt : Math.min(at, t.treeAt);
  }
  if (!bloom) return { stage: 0 };
  const probe = { ground: 'restored' as const, bloom, occupantId: undefined, treeAt: grown ? undefined : at };
  return { stage: treeStage(probe, bloom, now, true)!, next: nextTreeStep(probe, now, true, bloom) };
}
