/**
 * Look 3: the end-state dressing of a ground tile at each stage, as standalone builders the chunk renderer calls
 * (and Look 6's transition hooks can call with an in-between stage): turf (3.3), grass (3.3), flower drifts
 * (3.4, 3.5), paving (3.2), Thriving / Radiant extras (3.6), planters (3.9), area edges with railings, banners,
 * vines and clutter (3.8, 3.10, 3.11) and building dressing.
 *
 * Everything is deterministic per tile (seeded by its position and variant), so a tile always renders the same
 * after a reload or rebuild. Density follows `ctx.dens` (quality tier × zoom band).
 */
import type { TileData } from '../core/types';
import type { BuildingPlot } from '../core/Generation';
import type { TreeGeo, Lod } from './TreeGen';
import { PALETTE } from './Materials';
import type { VPrim } from './Shapes';
import { grassGeo, flowerGeo, leafyShrubGeo, vineGeo, bannerGeo, reedGeo, tintGeo, FLOWER_COLOURS, type FlowerSpecies } from './Flora';
import { zoneAt, type PlantingZone, type ZoneCtx } from './PlantingZones';
import { pavingGeo, pavingGaps, PAVING_LAYOUTS, planterGeo, railGeo, clutterGeo, CLUTTER_ALIVE, CLUTTER_DEAD, type RailKind, type ClutterKind } from './Props';

export interface SolidSink {
  grey: number;
  add(type: VPrim, hex: string, p: [number, number, number], s: [number, number, number] | number, glow?: number): void;
  addGeo(g: TreeGeo, x: number, y: number, z: number, rotY: number, scale: number): void;
  /** a quad from 4 corners (x, y, z ×4, counter-clockwise from above) with linear colours (r, g, b ×4) */
  quad(p: number[], cols: number[]): void;
}
export interface FoliageSink {
  add(g: TreeGeo, x: number, y: number, z: number, rotY: number, scale: number): void;
}
export interface DressCtx {
  b: SolidSink;
  fb: FoliageSink;
  /** 0…1: how much small detail to add (quality tier × zoom band) */
  dens: number;
  lod: Lod;
  area: string;
  areaType: string;
  /** prop level 0 (broken) … 4 (fully restored) */
  level: number;
  peek(x: number, z: number): TileData | undefined;
  areaAt(x: number, z: number): string;
  /**
   * Look 6: a tile's ground slab. While a tile transitions, Look 6's living surface draws slabs (so the ground
   * changes colour in place); other primitives are props that grow in or fall away. Defaults to `b.add('box')`.
   */
  slab?(hex: string, p: [number, number, number], s: [number, number, number]): void;
  /**
   * Look 3.19: place a hand-built model (assets/raw/models/final) instead of procedural geometry. Returns false
   * while it isn't loaded (or for hidden ground): the caller then draws its procedural version.
   */
  model?(name: string, x: number, y: number, z: number, rotY: number, sx: number, sy?: number, sz?: number): boolean;
  /** E23.4.4: the bloom stage a tile shows (its own, less any fade from low water nearby). Defaults to `t.bloom`. */
  bloom?(t: TileData): number;
  /**
   * #687: where a scattered piece of footprint radius `r` meant for (x, z) goes so it stays on the drawn ground of
   * the tile being dressed (moved in from water and drops, never removed). Foliage added through `fb` while a tile
   * is dressed is fitted already; this is for solid pieces. Defaults to (x, z).
   */
  fit?(x: number, z: number, r: number): [number, number];
  /** P7-E28: the area's landmark anchor (its 2×2 footprint), for planting zones */
  landmark?: readonly [number, number];
  /** P7-E28: a cell's planting zone (the renderer memoises it per build). Defaults to `zoneAt(x, z, ctx)`. */
  zone?(x: number, z: number): PlantingZone;
}

/** P7-E28: a cell's planting zone through the context (memoised when the renderer provides it). */
export const zoneOf = (c: DressCtx, x: number, z: number): PlantingZone => (c.zone ? c.zone(x, z) : zoneAt(x, z, c as ZoneCtx));

/**
 * Look 3.19: clutter kinds drawn as hand-built models, with the scale that fits each to the procedural prop's size
 * (the models are full size; the city's props are toy-sized). Bricks and murals stay procedural; so does the
 * restored pot (a terracotta planter, not the broken one).
 */
const CLUTTER_MODEL: Partial<Record<ClutterKind, [string, number]>> = {
  ac: ['ac-unit', 0.32],
  pipes: ['copper-pipe', 0.34],
  crate: ['crate', 0.32],
  rubble: ['rubble-pile', 0.34],
  vent: ['vent', 0.3],
  block: ['stone-block', 0.42],
  lantern: ['lamp-post', 0.21],
  niche: ['wall-niche', 0.2],
};
/** The banner pole model's scale: its crossbar (2.3 m) lands where the procedural pole's does (0.92). */
const BANNER_POLE = 0.4;
/** Clutter as a model if it can be, else procedurally. A restored pot is the sandstone planter pot; every fourth vent a satellite dish. */
function clutter(c: DressCtx, kind: ClutterKind, alive: boolean, variant: number, x: number, y: number, z: number, rot: number, scale: number) {
  const m: [string, number] | undefined =
    kind === 'pot' ? (alive ? ['planter-pot', 0.2] : ['broken-pot', 0.3]) : kind === 'vent' && ((variant % 4) + 4) % 4 === 0 ? ['satellite-dish', 0.28] : CLUTTER_MODEL[kind];
  if (m && c.model?.(m[0], x, y, z, rot, m[1] * scale)) return;
  c.b.addGeo(clutterGeo(kind, alive, variant, 1), x, y, z, rot, scale);
}
const slab = (c: DressCtx, hex: string, p: [number, number, number], s: [number, number, number]) => (c.slab ? c.slab(hex, p, s) : c.b.add('box', hex, p, s));

export const hash01 = (x: number, z: number, salt: number) => {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
/** Smooth value noise (deterministic), for drifts that span several tiles. */
export function noise2(x: number, z: number, salt: number) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const tx = x - x0, tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash01(x0, z0, salt), b = hash01(x0 + 1, z0, salt), c = hash01(x0, z0 + 1, salt), d = hash01(x0 + 1, z0 + 1, salt);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const lin = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [Math.pow(((n >> 16) & 255) / 255, 2.2), Math.pow(((n >> 8) & 255) / 255, 2.2), Math.pow((n & 255) / 255, 2.2)];
};

export const SIDES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Frame for a tile edge: template origin (relative to the tile corner) and turn, so local +x runs along the edge and local +z faces out. */
const EDGE_FRAME: Record<string, { ox: number; oz: number; rot: number; tx: number; tz: number }> = {
  '0,1': { ox: 0, oz: 1, rot: 0, tx: 1, tz: 0 },
  '0,-1': { ox: 1, oz: 0, rot: Math.PI, tx: -1, tz: 0 },
  '1,0': { ox: 1, oz: 1, rot: -Math.PI / 2, tx: 0, tz: -1 },
  '-1,0': { ox: 0, oz: 0, rot: Math.PI / 2, tx: 0, tz: 1 },
};

// ───────────── turf and grass (3.3) ─────────────

/** Phase 5 E16 grass by stage (index 1 Restored … 4 Radiant), three shades each. */
export const STAGE_GRASS: string[][] = PALETTE.stageGrass;
/** One of a palette list by a (possibly negative) variant: lists differ in length now that Look 2 owns them. */
const pick = (a: string[], v: number) => a[((v % a.length) + a.length) % a.length];
const isTurf = (t: TileData | undefined) => !!t && t.ground === 'restored' && !t.blocked && (t.feature ?? 'lawn') !== 'paving' && (t.feature ?? 'lawn') !== 'water' && (t.feature ?? 'lawn') !== 'road';
const turfColour = (t: TileData, bloom = t.bloom) => lin(pick(STAGE_GRASS[Math.max(1, Math.min(4, bloom || 1))], t.variant));

/**
 * A restored lawn's top: one quad whose corner colours average the turf of the (up to) four tiles meeting there,
 * so neighbouring lawns blend instead of showing square seams; the grid only shows where a tool draws it.
 */
export function turfTop(c: DressCtx, t: TileData, top: number) {
  const cols = turfCorners(c, t);
  const pos: number[] = [];
  for (const [cx, cz] of TURF_CORNERS) pos.push(t.x + cx, top + 0.002, t.z + cz);
  c.b.quad(pos, cols);
}

const TURF_CORNERS: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0]];

/**
 * E28.W02: a restored lawn's colour at a point on its top (linear), as `turfTop` draws it: its corners' blended,
 * mottled turf, mixed across the tile. The shore's banks start in exactly this colour.
 */
export function turfAt(c: DressCtx, t: TileData, x: number, z: number): [number, number, number] {
  const k = turfCorners(c, t);
  const u = Math.min(1, Math.max(0, x - t.x));
  const w = Math.min(1, Math.max(0, z - t.z));
  // corners (0,0) (0,1) (1,1) (1,0)
  const f = [(1 - u) * (1 - w), (1 - u) * w, u * w, u * (1 - w)];
  return [0, 1, 2].map((ch) => f[0] * k[ch] + f[1] * k[3 + ch] + f[2] * k[6 + ch] + f[3] * k[9 + ch]) as [number, number, number];
}

/** A lawn tile's four corner colours (linear, corners (0,0) (0,1) (1,1) (1,0)), for `turfTop` and `turfAt`. */
function turfCorners(c: DressCtx, t: TileData): number[] {
  const cols: number[] = [];
  for (const [cx, cz] of TURF_CORNERS) {
    let r = 0, g = 0, b = 0, n = 0;
    for (const [ox, oz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const n2 = ox === 0 && oz === 0 && cx === 0 && cz === 0 ? t : c.peek(t.x + cx + ox, t.z + cz + oz);
      if (!n2 || !isTurf(n2) || c.areaAt(n2.x, n2.z) !== c.area) continue;
      const k = turfColour(n2, c.bloom?.(n2));
      r += k[0];
      g += k[1];
      b += k[2];
      n++;
    }
    const k = n ? [r / n, g / n, b / n] : turfColour(t, c.bloom?.(t));
    // a soft mottling across the lawn, a few tiles wide
    // Phase 6: with no blades shading it, the bare turf is a touch deeper, and the light / dark patches are stronger
    // so a big lawn reads as soft sunlit and shaded areas rather than one flat green
    const m = 0.5 + 0.28 * noise2((t.x + cx) * 0.45, (t.z + cz) * 0.45, 7) + 0.14 * noise2((t.x + cx) * 1.3, (t.z + cz) * 1.3, 8);
    cols.push(k[0] * m, k[1] * m, k[2] * m);
  }
  return cols;
}

/** Grass clumps over a tile (sparse while young, lush in full bloom); blades lean out and spill over edges. */
export function grassTufts(c: DressCtx, t: TileData, stage: number, x: number, z: number, top: number, span = 0.46, base?: number) {
  const lod: Lod = c.lod === 2 && c.dens > 0.99 ? 2 : 1;
  // Look 3.3: lawns get an even carpet of short blades (seeded turn, so it never lines up), then a few taller
  // tufts on top. The carpet goes at mid zoom too, except on Low, where it waits for near zoom.
  // Phase 6: no blade carpet. The lawn is the smooth blended turf quad (turfTop) with soft painted variation, like
  // the reference; life comes from a sprinkle of small tufts and tiny lawn flowers (daisies, clover) on top.
  if (base === undefined && stage >= 1) {
    const sprinkle = Math.round((stage === 1 ? 2 : 3) * c.dens);
    for (let i = 0; i < sprinkle; i++) {
      const px = x + (hash01(t.x * 17 + i, t.z, 101) - 0.5) * 0.9;
      const pz = z + (hash01(t.x, t.z * 17 + i, 103) - 0.5) * 0.9;
      if (hash01(t.x + i, t.z * 3, 107) < 0.45) c.fb.add(flowerGeo('wild', t.variant + i, true, i, 1), px, top, pz, i * 1.9, 0.8);
      else c.fb.add(grassGeo(stage, t.variant + i + 1, 1), px, top, pz, hash01(t.x, t.z + i, 109) * 6.28, 0.5);
    }
  }
  // Phase 6: open lawn keeps one taller tuft at most (the carpet does the work); edges pass their own `base`
  const n = Math.round((base ?? [2, 1, 1, 1, 1][stage]) * c.dens);
  for (let i = 0; i < n; i++) {
    const px = x + (hash01(t.x * 7 + i, t.z, 11) - 0.5) * 2 * span;
    const pz = z + (hash01(t.x, t.z * 7 + i, 13) - 0.5) * 2 * span;
    c.fb.add(grassGeo(stage, t.variant + i, lod), px, top, pz, hash01(t.x + i, t.z, 17) * 6.28, 0.85 + hash01(t.x, t.z + i, 19) * 0.4);
  }
}

// ───────────── flowers (3.4, 3.5) ─────────────

// Phase 6: big open heads lead (cosmos, daisies), lavender is an accent rather than every other drift
const SPECIES_FIELD: FlowerSpecies[] = ['cosmos', 'daisy', 'wild', 'cosmos', 'daisy', 'lavender', 'cosmos', 'wild', 'daisy', 'sunflower'];
/** One main species and colour per drift: both come from a field a few tiles wide, so neighbouring clumps match. */
function speciesAt(x: number, z: number, stage: number): FlowerSpecies {
  const sp = SPECIES_FIELD[Math.floor(noise2(x / 3.2, z / 3.2, 91) * SPECIES_FIELD.length * 0.999)];
  return sp === 'sunflower' && stage < 3 ? 'daisy' : sp;
}
const colourAt = (x: number, z: number) => Math.floor(noise2(x / 2.4, z / 2.4, 93) * 12);

function clump(c: DressCtx, t: TileData, sp: FlowerSpecies, open: boolean, px: number, pz: number, top: number, k: number, size = 1) {
  // Phase 6: neighbouring clumps step through the colours (mixed beds, like the reference), at about 1.5x the size
  const col = (colourAt(px, pz) + k) % FLOWER_COLOURS[sp].length;
  c.fb.add(flowerGeo(sp, col, open, t.variant + k, c.lod === 2 ? 1 : 0), px, top, pz, hash01(t.x * 3 + k, t.z, 23) * 6.28, (1.25 + hash01(t.x, t.z * 3 + k, 29) * 0.4) * size);
}

/** Is this side of the tile an edge flowers hug (paving, a wall, a planter, another area, water)? */
function flowerEdge(c: DressCtx, t: TileData, dx: number, dz: number) {
  const n = c.peek(t.x + dx, t.z + dz);
  if (!n) return false;
  if (c.areaAt(n.x, n.z) !== c.area) return true;
  const nf = n.feature ?? 'lawn';
  return n.blocked || nf === 'paving' || nf === 'water' || nf === 'road' || !!n.occupantId;
}

/**
 * Flower drifts by stage: buds along edges (Restored), the first open flowers and buds (Blooming), full drifts
 * hugging every edge with sparser clumps on open lawn (Thriving / Radiant).
 */
export function flowerDrifts(c: DressCtx, t: TileData, stage: number, x: number, z: number, top: number) {
  if (stage < 1) return;
  let k = 0;
  for (const [dx, dz] of SIDES) {
    if (!flowerEdge(c, t, dx, dz)) continue;
    // Phase 6: beds packed like the reference: 1–2 clumps a side when young, 3–4 once Blooming, 5 when Thriving;
    // along a path the bed is solid (two full rows of bigger flowers), so it reads as a border from the default view
    const nb = c.peek(t.x + dx, t.z + dz);
    const path = !!nb && (nb.feature ?? 'lawn') === 'paving' && !nb.blocked;
    const want = stage === 1 ? 1 + (hash01(t.x + dx, t.z + dz, 31) < 0.4 ? 1 : 0) + (path ? 1 : 0) : stage === 2 ? (path ? 5 : 3 + (hash01(t.x, t.z + dx, 37) < 0.5 ? 1 : 0)) : path ? 7 : 5;
    const n = Math.max(want ? 1 : 0, Math.round(want * c.dens));
    for (let i = 0; i < n; i++) {
      const along = (i + 0.5) / n - 0.5 + (hash01(t.x * 5 + i, t.z + dz, 41) - 0.5) * 0.18;
      const inset = 0.36 - (i % 2) * 0.13; // two staggered rows, so a bed reads as a mass rather than a line
      const px = x + dx * inset + (dz ? along * 0.9 : 0);
      const pz = z + dz * inset + (dx ? along * 0.9 : 0);
      const open = stage >= 3 || (stage === 2 && hash01(t.x + i, t.z, 43) < 0.6);
      clump(c, t, speciesAt(px, pz, stage), open || path, px, pz, top, k++, path ? 1.3 : 1);
    }
  }
  // open lawn: sparse clumps where the drift field is strong
  const f = noise2(t.x / 2.6, t.z / 2.6, 47);
  const inner = stage === 1 ? (f > 0.6 ? 1 : 0) : stage === 2 ? (f > 0.35 ? 2 : 0) + (f > 0.6 ? 2 : 0) : (f > 0.2 ? 3 : 0) + (f > 0.5 ? 3 : 0);
  for (let i = 0; i < Math.round(inner * Math.max(0.5, c.dens)); i++) {
    const px = x + (hash01(t.x * 11 + i, t.z, 53) - 0.5) * 0.8;
    const pz = z + (hash01(t.x, t.z * 11 + i, 59) - 0.5) * 0.8;
    clump(c, t, speciesAt(px, pz, stage), stage >= 3 || hash01(t.x, t.z + i, 61) < 0.6, px, pz, top, k++);
  }
}

/** Thriving extras on a tile without a tree: a leafy (sometimes flowering) shrub, a flower bed, or a mossy rock. */
export function thrivingExtras(c: DressCtx, t: TileData, x: number, z: number, top: number) {
  const pick = hash01(t.x, t.z, 61);
  if (pick < 0.58) c.fb.add(leafyShrubGeo(t.variant, c.lod === 2 ? 1 : 0, hash01(t.x, t.z, 63) < 0.3), x + (t.variant % 3) * 0.06 - 0.06, top, z, t.variant * 1.7, 1);
  else if (pick < 0.8) {
    const sp: FlowerSpecies = hash01(t.x, t.z, 65) < 0.35 ? 'sunflower' : 'lavender';
    for (let i = 0; i < 2; i++) clump(c, t, sp, true, x + (i - 0.5) * 0.24, z + (hash01(t.x + i, t.z, 67) - 0.5) * 0.3, top, 20 + i);
  } else {
    const sx = x + (hash01(t.x, t.z, 69) - 0.5) * 0.4;
    const sz = z + (hash01(t.x, t.z, 71) - 0.5) * 0.4;
    const [rx, rz] = c.fit ? c.fit(sx, sz, 0.17) : [sx, sz];
    c.b.add('sphere', PALETTE.rock, [rx, top + 0.06, rz], [0.34, 0.2, 0.28]);
    c.b.add('sphere', PALETTE.rockMoss, [rx, top + 0.13, rz], [0.24, 0.07, 0.2]);
    c.fb.add(grassGeo(3, t.variant, 1), rx + 0.18, top, rz - 0.1, 0, 1.2);
  }
}

/**
 * Radiant: luminous golden daisies and sunflowers above the shrubs. (Phase 6: the flat gold disc that used to sit
 * under them is gone: it was opaque and read as a tan hexagonal pad. The golden grass tone carries the stage.)
 */
export function radiantExtras(c: DressCtx, t: TileData, x: number, z: number, top: number) {
  for (let i = 0; i < 4; i++) {
    const px = x + (hash01(t.x * 13 + i, t.z, 73) - 0.5) * 0.6;
    const pz = z + (hash01(t.x, t.z * 13 + i, 79) - 0.5) * 0.6;
    const sp: FlowerSpecies = i === 0 ? 'sunflower' : 'daisy';
    c.fb.add(flowerGeo(sp, sp === 'daisy' ? 2 : 0, true, t.variant + i, 1), px, top, pz, hash01(t.x, t.z, 83 + i) * 6.28, 1.1);
  }
}

// ───────────── P7-E28: planting by zone ─────────────

/** A flower: species and colour index into FLOWER_COLOURS. */
type Bloom = readonly [FlowerSpecies, number];
/**
 * P7-E28.4 / E28.8 (#729, #733): a plant family: 2–3 primary flowers that make up a bed, one contrasting accent
 * (about one clump in twelve) and, rarely, a special variety for discovery. Neighbouring tiles share a family.
 */
interface Family {
  main: readonly Bloom[];
  accent: Bloom;
}
const FAMILIES: Record<PlantingZone, readonly Family[]> = {
  flower_garden: [
    { main: [['cosmos', 0], ['cosmos', 2], ['daisy', 0]], accent: ['lavender', 2] }, // pinks and white, purple
    { main: [['lavender', 0], ['lavender', 1], ['daisy', 0]], accent: ['cosmos', 1] }, // lavenders and white, magenta
    { main: [['sunflower', 0], ['daisy', 1], ['wild', 1]], accent: ['lavender', 2] }, // golds, purple
    { main: [['cosmos', 3], ['daisy', 1], ['daisy', 0]], accent: ['wild', 2] }, // apricot and cream, blue
  ],
  meadow: [
    { main: [['wild', 0], ['daisy', 0], ['wild', 1]], accent: ['wild', 2] }, // white and yellow, blue
    { main: [['wild', 2], ['lavender', 0], ['daisy', 0]], accent: ['wild', 1] }, // blue and white, yellow
    { main: [['daisy', 0], ['daisy', 1], ['wild', 3]], accent: ['lavender', 2] }, // cream and rose, purple
  ],
  path_edge: [
    { main: [['daisy', 0], ['wild', 0]], accent: ['lavender', 0] },
    { main: [['lavender', 0], ['daisy', 0]], accent: ['wild', 1] },
  ],
  shoreline: [{ main: [['wild', 0], ['wild', 2]], accent: ['daisy', 0] }],
  woodland_understory: [{ main: [['wild', 2], ['wild', 0]], accent: ['daisy', 2] }], // bluebells and wood anemones
  open_lawn: [{ main: [['wild', 0], ['daisy', 0]], accent: ['wild', 1] }],
  landmark_clearance: [{ main: [['wild', 0], ['daisy', 0]], accent: ['wild', 1] }],
};
/** The rare special variety: a deep red bloom found in about one garden bed in forty. */
const RARE: Bloom = ['cosmos', 0];

/**
 * P7-E28.3 / E28.7 (#728, #732): how much each zone plants at each bloom stage (index 1 Restored … 4 Radiant).
 * Stages 1–2 are mostly grass; density and diversity rise by zone. `flowers`: clumps on the tile; `tufts`: grass
 * clumps; `shrub`: chance of a medium bush; `reeds`: reed clumps along each water side.
 */
const ZONE_PLAN: Record<PlantingZone, { flowers: number[]; tufts: number[]; shrub: number[]; reeds?: number[] }> = {
  flower_garden: { flowers: [0, 2, 8, 14, 16], tufts: [0, 2, 1, 1, 1], shrub: [0, 0, 0.1, 0.3, 0.35] },
  meadow: { flowers: [0, 0, 3, 6, 7], tufts: [0, 3, 3, 3, 3], shrub: [0, 0, 0, 0.08, 0.1] },
  path_edge: { flowers: [0, 0, 2, 3, 3], tufts: [0, 1, 1, 1, 1], shrub: [0, 0, 0, 0, 0] },
  shoreline: { flowers: [0, 0, 1, 2, 2], tufts: [0, 2, 2, 2, 2], shrub: [0, 0, 0, 0.08, 0.1], reeds: [0, 1, 2, 2, 3] },
  woodland_understory: { flowers: [0, 0, 1, 2, 3], tufts: [0, 2, 3, 3, 3], shrub: [0, 0.15, 0.4, 0.6, 0.7] },
  open_lawn: { flowers: [0, 0, 1, 1, 1], tufts: [0, 2, 2, 2, 2], shrub: [0, 0, 0, 0, 0] },
  landmark_clearance: { flowers: [0, 0, 0, 1, 1], tufts: [0, 1, 1, 1, 1], shrub: [0, 0, 0, 0, 0] },
};

/** A tile's family: from a noise field a few tiles wide, so a bed spans neighbouring tiles. */
function familyAt(zone: PlantingZone, x: number, z: number): Family {
  const fs = FAMILIES[zone];
  return fs[Math.min(fs.length - 1, Math.floor(noise2(x / 5, z / 5, 301) * fs.length))];
}
/** One bloom from a family at a point: drifts of each primary (a field ~1.5 tiles wide), the odd accent. */
function bloomAt(f: Family, px: number, pz: number, stage: number, salt: number): Bloom {
  if (hash01(Math.floor(px * 8), Math.floor(pz * 8), salt) < 0.08) return f.accent;
  const b = f.main[Math.min(f.main.length - 1, Math.floor(noise2(px / 1.5, pz / 1.5, 303) * f.main.length))];
  // sunflowers wait for Thriving (they're the tall statement); before that the bed shows a daisy
  return b[0] === 'sunflower' && stage < 3 ? ['daisy', 1] : b;
}

/** Positions on a 4×4 bed grid (−1.5 … 1.5 in steps, ×0.24), in a seeded order per tile. */
const BED: [number, number][] = [];
for (const gz of [-1.5, -0.5, 0.5, 1.5]) for (const gx of [-1.5, -0.5, 0.5, 1.5]) BED.push([gx, gz]);

/**
 * P7-E28 (#714): the dressing of a restored natural tile by its planting zone, in layers (#731): the turf (drawn
 * by the caller), sparse grass clumps, medium bushes, flowering masses and the odd statement piece, all scaled by
 * the bloom stage (#732). `tree`: the tile grows a tree, so it keeps its ground low (no bush or statement).
 * Deterministic per tile; nothing is saved.
 */
export function zonedPlanting(c: DressCtx, t: TileData, stage: number, x: number, z: number, top: number, zone: PlantingZone, tree = false) {
  if (stage < 1) return;
  const plan = ZONE_PLAN[zone];
  const st = Math.max(1, Math.min(4, stage));
  const lod: Lod = c.lod === 2 ? 1 : 0;
  const dens = Math.max(0.35, c.dens);
  // ── sparse grass clumps (young grass is light; tufts keep low on paths and clearings)
  const tufts = Math.round(plan.tufts[st] * dens);
  for (let i = 0; i < tufts; i++) {
    const px = x + (hash01(t.x * 7 + i, t.z, 11) - 0.5) * 0.86;
    const pz = z + (hash01(t.x, t.z * 7 + i, 13) - 0.5) * 0.86;
    const sc = zone === 'meadow' || zone === 'woodland_understory' ? 0.95 + hash01(t.x, t.z + i, 19) * 0.4 : 0.6 + hash01(t.x, t.z + i, 19) * 0.3;
    c.fb.add(grassGeo(st, t.variant + i, c.lod === 2 && c.dens > 0.99 ? 2 : 1), px, top, pz, hash01(t.x + i, t.z, 17) * 6.28, sc);
  }
  const fam = familyAt(zone, t.x + 0.5, t.z + 0.5);
  const plant = (b: Bloom, px: number, pz: number, k: number, size: number, open: boolean) => {
    const g = flowerGeo(b[0], b[1], open, t.variant + k, lod);
    c.fb.add(b === RARE && zone === 'flower_garden' && k === 0 ? tintGeo(g, PALETTE.flowers.red) : g, px, top, pz, hash01(t.x * 3 + k, t.z, 23) * 6.28, size * (0.9 + hash01(t.x, t.z * 3 + k, 29) * 0.3));
  };
  const want = plan.flowers[st];
  const n = want ? Math.max(1, Math.round(want * dens)) : 0;
  if (zone === 'path_edge') {
    // ── a neat, low border set back from each path side: one row, small flowers, nothing tall
    const sides = SIDES.filter(([dx, dz]) => {
      const nb = c.peek(t.x + dx, t.z + dz);
      const f = nb?.feature ?? 'lawn';
      return !!nb && !nb.blocked && (f === 'paving' || f === 'road');
    });
    let k = 0;
    for (const [dx, dz] of sides)
      for (let i = 0; i < n; i++) {
        const along = (i + 0.5) / n - 0.5 + (hash01(t.x * 5 + i, t.z + dz, 41) - 0.5) * 0.12;
        const px = x + dx * 0.3 + (dz ? along * 0.85 : 0);
        const pz = z + dz * 0.3 + (dx ? along * 0.85 : 0);
        plant(bloomAt(fam, px, pz, st, 43), px, pz, k++, 0.85, st >= 3 || hash01(t.x + i, t.z, 45) < 0.5);
      }
  } else if (zone === 'flower_garden') {
    // ── a flowering mass on a staggered grid; the bed stops short on sides that border lawn, so beds keep a shape
    const open: boolean[] = SIDES.map(([dx, dz]) => zoneOf(c, t.x + dx, t.z + dz) === 'flower_garden');
    const start = Math.floor(hash01(t.x, t.z, 47) * BED.length);
    let k = 0;
    for (let j = 0; j < BED.length && k < n; j++) {
      const [gx, gz] = BED[(start + j) % BED.length];
      // SIDES order: +x, −x, +z, −z
      if ((gx > 1 && !open[0]) || (gx < -1 && !open[1]) || (gz > 1 && !open[2]) || (gz < -1 && !open[3])) continue;
      // alternate rows shift half a step, so the mass doesn't read as a grid
      const px = x + (gx + (Math.round(gz + 1.5) % 2) * 0.25) * 0.24 + (hash01(t.x * 11 + j, t.z, 53) - 0.5) * 0.1;
      const pz = z + gz * 0.24 + (hash01(t.x, t.z * 11 + j, 59) - 0.5) * 0.1;
      const rare = st >= 3 && k === 0 && hash01(t.x, t.z, 49) < 0.025;
      plant(rare ? RARE : bloomAt(fam, px, pz, st, 61), px, pz, k++, 1.55, st >= 3 || hash01(t.x + j, t.z, 63) < 0.4);
    }
  } else if (n) {
    // ── loose drifts: meadow, woodland floor, shore and lawn flowers (small, so open lawn stays calm)
    const size = zone === 'meadow' ? 1.25 : zone === 'woodland_understory' ? 0.85 : 0.7;
    for (let i = 0; i < n; i++) {
      const px = x + (hash01(t.x * 13 + i, t.z, 67) - 0.5) * 0.8;
      const pz = z + (hash01(t.x, t.z * 13 + i, 71) - 0.5) * 0.8;
      // on open lawn and in clearings only a few tiles carry a flower at all
      if ((zone === 'open_lawn' || zone === 'landmark_clearance') && hash01(t.x + i, t.z, 73) > 0.35) continue;
      plant(bloomAt(fam, px, pz, st, 79), px, pz, i, size, st >= 3 || hash01(t.x, t.z + i, 83) < 0.5);
    }
  }
  // ── shoreline: reeds toward the water and rounded wet stones on the bank
  if (plan.reeds) {
    const r = plan.reeds[st];
    let k = 0;
    for (const [dx, dz] of SIDES) {
      if ((c.peek(t.x + dx, t.z + dz)?.feature ?? 'lawn') !== 'water') continue;
      for (let i = 0; i < r; i++) {
        const along = (hash01(t.x * 17 + i, t.z + dx, 87) - 0.5) * 0.8;
        const px = x + dx * 0.36 + (dz ? along : 0);
        const pz = z + dz * 0.36 + (dx ? along : 0);
        c.fb.add(reedGeo(t.variant + k, lod), px, top, pz, hash01(t.x, t.z, 89 + k) * 6.28, 0.8 + hash01(t.x + k, t.z, 91) * 0.5);
        k++;
      }
    }
    if (hash01(t.x, t.z, 93) < 0.35) {
      const sx = x + (hash01(t.x, t.z, 95) - 0.5) * 0.5, sz = z + (hash01(t.x, t.z, 97) - 0.5) * 0.5;
      const [rx, rz] = c.fit ? c.fit(sx, sz, 0.13) : [sx, sz];
      const s2 = 0.75 + hash01(t.x, t.z, 99) * 0.5;
      c.b.add('sphere', pick(PALETTE.wetStone, t.variant), [rx, top + 0.035 * s2, rz], [0.24 * s2, 0.12 * s2, 0.2 * s2]);
    }
  }
  if (tree) return;
  // ── medium bushes (gardens, woodland floor, the odd one in a meadow or on a bank)
  if (hash01(t.x, t.z, 103) < plan.shrub[st]) {
    const flowering = zone === 'flower_garden' && hash01(t.x, t.z, 105) < 0.5;
    const sx = x + (hash01(t.x, t.z, 107) - 0.5) * 0.3, sz = z + (hash01(t.x, t.z, 109) - 0.5) * 0.3;
    c.fb.add(leafyShrubGeo(t.variant, lod, flowering), sx, top, sz, t.variant * 1.7, zone === 'woodland_understory' ? 0.85 + hash01(t.x, t.z, 111) * 0.3 : 0.8);
  }
  // ── the odd statement piece: a sunflower stand in a gold bed, a mossy rock in a meadow or on the lawn
  if (st >= 3) {
    const h = hash01(t.x, t.z, 113);
    if (zone === 'flower_garden' && fam.main[0][0] === 'sunflower' && h < 0.18) {
      for (let i = 0; i < 3; i++) c.fb.add(flowerGeo('sunflower', i % 2, true, t.variant + i, lod), x + (i - 1) * 0.14, top, z + (hash01(t.x + i, t.z, 115) - 0.5) * 0.2, i * 2.1, 1.35);
    } else if ((zone === 'meadow' || zone === 'open_lawn' || zone === 'woodland_understory') && h < 0.035) {
      const sx = x + (hash01(t.x, t.z, 69) - 0.5) * 0.4, sz = z + (hash01(t.x, t.z, 71) - 0.5) * 0.4;
      const [rx, rz] = c.fit ? c.fit(sx, sz, 0.17) : [sx, sz];
      c.b.add('sphere', PALETTE.rock, [rx, top + 0.06, rz], [0.34, 0.2, 0.28]);
      c.b.add('sphere', PALETTE.rockMoss, [rx, top + 0.13, rz], [0.24, 0.07, 0.2]);
    }
  }
  // ── Radiant: the golden grass carries the stage; beds and meadows add a luminous gold daisy or two
  if (st >= 4 && (zone === 'flower_garden' || zone === 'meadow') && hash01(t.x, t.z, 117) < 0.5) {
    const px = x + (hash01(t.x, t.z, 119) - 0.5) * 0.6, pz = z + (hash01(t.x, t.z, 121) - 0.5) * 0.6;
    c.fb.add(flowerGeo('daisy', 1, true, t.variant, lod), px, top, pz, t.variant, 1.1);
  }
}

// ───────────── paving (3.2) ─────────────

const PAVE_ALIVE = PALETTE.paveAlive;
const PAVE_DEAD = PALETTE.paveDead;

/**
 * A paving tile as individual slabs over dark grout: layout and turn seeded per tile (nothing repeats over a
 * 10×10 area), weeds and dry tufts in the gaps when dead, moss and tiny flowers when restored.
 */
export function paving(c: DressCtx, t: TileData, alive: boolean, x: number, z: number, h: number, swept = false) {
  const top = h + 0.08;
  if (c.dens === 0 && c.lod === 0) {
    // deep fog: one plain slab, as before Look 3 (nothing finer shows through)
    slab(c, pick(alive ? PAVE_ALIVE : PAVE_DEAD, t.variant), [x, h, z], [1, 0.16, 1]);
    return;
  }
  slab(c, PALETTE.grout[alive ? 0 : 1], [x, h - 0.01, z], [1, 0.16, 1]);
  const layout = Math.floor(hash01(t.x, t.z, 3) * PAVING_LAYOUTS);
  const rot = Math.floor(hash01(t.x, t.z, 5) * 4) * (Math.PI / 2);
  c.b.addGeo(pavingGeo(layout, t.variant + Math.floor(hash01(t.x, t.z, 7) * 4), alive || swept, alive ? PAVE_ALIVE : swept ? PALETTE.paveSwept : PAVE_DEAD, c.lod === 2 ? 1 : 0), x, top, z, rot, 1);
  const gaps = pavingGaps(layout);
  const n = Math.round((alive ? 2 : 3) * c.dens);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const [gx, gz] = gaps[Math.floor(hash01(t.x + i, t.z, 9) * gaps.length)];
    const px = x + gx * cr - gz * sr;
    const pz = z + gx * sr + gz * cr;
    if (!alive) c.fb.add(grassGeo(0, t.variant + i, 1), px, top, pz, i * 2.1, 0.7 + hash01(t.x, t.z + i, 2) * 0.5);
    else if (hash01(t.x, t.z + i, 4) < 0.5) c.fb.add(flowerGeo('wild', t.variant + i, true, i, 1), px, top + 0.01, pz, i, 0.6);
    else c.fb.add(grassGeo(1, t.variant + i, 1), px, top, pz, i * 2.1, 0.55);
  }
}

// ───────────── planters (3.9) ─────────────

/**
 * A stone planter (decorative; it never changes a rule): cracked with dry soil and weeds while dead, a full
 * flower bed once restored. `w` × `d` in tiles; the rim stands on `top`.
 */
export function planterBed(c: DressCtx, t: TileData, alive: boolean, x: number, z: number, top: number, w: number, d: number, rot = 0) {
  // Look 3.19: a long bed is the stone trough, a square one the raised bed, both fitted to w × d (soil kept level)
  const long = Math.max(w, d) / Math.min(w, d) > 1.5;
  const along = w >= d ? 0 : Math.PI / 2;
  const [mw, md, mh] = long ? [1.8, 0.66, 0.42] : [1, 1, 0.59];
  const [lw, ld] = w >= d ? [w, d] : [d, w];
  if (!c.model?.(long ? 'planter-trough' : 'planter-bed', x, top, z, rot + along, lw / mw, 0.2 / mh, ld / md)) c.b.addGeo(planterGeo(w, d, alive, t.variant, c.lod === 0 ? 0 : 1), x, top, z, rot, 1);
  const soil = top + 0.185;
  const n = Math.max(1, Math.round((w * d > 0.5 ? 4 : 2) * Math.max(0.6, c.dens)));
  const sp: FlowerSpecies = (['lavender', 'cosmos', 'sunflower', 'daisy'] as const)[Math.floor(hash01(t.x, t.z, 87) * 4)];
  for (let i = 0; i < n; i++) {
    const px = x + ((i % 2) - 0.5) * w * 0.45 + (hash01(t.x + i, t.z, 89) - 0.5) * 0.06;
    const pz = z + (Math.floor(i / 2) - (n > 2 ? 0.5 : 0)) * d * 0.45;
    if (alive) c.fb.add(flowerGeo(sp, colourAt(t.x, t.z), true, t.variant + i, 1), px, soil, pz, i * 1.9, 1);
    else c.fb.add(grassGeo(0, t.variant + i, 1), px, soil, pz, i * 1.3, 0.8);
  }
}

// ───────────── area edges (3.8, 3.10, 3.11) ─────────────

const RAIL_KIND: Record<string, RailKind> = { park: 'balustrade', plaza: 'balustrade', street: 'pipe', market: 'pipe', rooftops: 'pipe', canal: 'parapet', reservoir: 'parapet', grove: 'parapet' };
const openEdge = (f: string | undefined) => f === 'road' || f === 'water';

/**
 * Where this tile meets another area: a continuous railing, balustrade or parapet along the boundary (gaps where
 * a road, water or a path crosses), ivy over it, sun banners in restored areas and a clutter prop against it.
 * Only the side whose area id sorts first draws a shared edge, so it isn't doubled.
 */
export function areaEdges(c: DressCtx, t: TileData, top: number) {
  if (t.feature === 'building') return;
  const alive = c.level >= 3;
  const stage = c.level >= 4 ? 4 : c.level >= 3 ? 3 : 0;
  for (const [dx, dz] of SIDES) {
    const nx = t.x + dx, nz = t.z + dz;
    const other = c.areaAt(nx, nz);
    // one side draws a shared edge: the park always (its balustrade), otherwise the area whose id sorts first
    if (other === c.area || (c.area !== 'park' && (other === 'park' || other < c.area))) continue;
    const n = c.peek(nx, nz);
    const fr = EDGE_FRAME[`${dx},${dz}`];
    const ox = t.x + fr.ox - dx * 0.06;
    const oz = t.z + fr.oz - dz * 0.06;
    const h = hash01(t.x, t.z, 101 + dx * 3 + dz);
    if (openEdge(t.feature) || openEdge(n?.feature) || (t.feature === 'paving' && n?.feature === 'paving' && !t.blocked)) {
      // an entrance: banner poles either side in restored areas
      if (alive && h < 0.5) {
        const px = ox + fr.tx * 0.08, pz = oz + fr.tz * 0.08;
        // Look 3.19: the hand-built pole (its crossbar on +x, like the procedural one), with the swaying cloth hung
        // from the bar
        if (c.model?.('banner-pole', px, top, pz, fr.rot, BANNER_POLE)) {
          const cx = 0.17;
          c.fb.add(bannerGeo('rail', true, t.x + t.z, 1), px + Math.cos(fr.rot) * cx, top + 2.3 * BANNER_POLE - 0.012, pz - Math.sin(fr.rot) * cx, fr.rot, 1);
        } else c.fb.add(bannerGeo('pole', true, t.x + t.z, 1), px, top, pz, fr.rot, 1);
      }
      continue;
    }
    const kind = RAIL_KIND[c.areaType] ?? 'pipe';
    const broken = !alive && h < 0.3;
    c.b.addGeo(railGeo(kind, alive, t.x + t.z, broken, c.lod === 0 ? 0 : 1), ox, top, oz, fr.rot, 1);
    if (c.lod === 0) continue;
    const railTop = top + (kind === 'parapet' ? 0.27 : kind === 'balustrade' ? 0.33 : 0.34);
    // ivy over the rail (sparse and dry on dead edges), hanging down the outside
    if (h < (alive ? 0.75 : 0.35)) c.fb.add(vineGeo(stage, alive ? 0.5 : 0.3, t.x * 3 + t.z, 1), ox + dx * 0.02, railTop, oz + dz * 0.02, fr.rot, 1);
    // sun banners hung from restored rails
    else if (alive && h > 0.9) c.fb.add(bannerGeo('rail', true, t.x, 1), ox + fr.tx * 0.5 + dx * 0.05, railTop, oz + fr.tz * 0.5 + dz * 0.05, fr.rot, 1);
    // a clutter prop against the rail, inside the tile (debris when dead, tidy when restored)
    const h2 = hash01(t.x, t.z, 131 + dz);
    if (h2 < 0.3 * Math.max(0.5, c.dens)) {
      const kit = alive ? CLUTTER_ALIVE : CLUTTER_DEAD;
      const kind2: ClutterKind = kit[Math.floor(hash01(t.x * 2, t.z * 3, 137) * kit.length)];
      if (kind2 === 'niche') continue;
      const along = 0.2 + hash01(t.x, t.z, 139) * 0.6;
      clutter(c, kind2, alive, t.x + t.z * 3, ox + fr.tx * along - dx * 0.1, top, oz + fr.tz * along - dz * 0.1, fr.rot + Math.PI, 0.9 + h2);
    }
  }
}

/** Clutter on an obstacle tile's free corner (they're never tapped): debris while dead, tidy props once restored. */
export function obstacleClutter(c: DressCtx, t: TileData, x: number, z: number, top: number) {
  if (c.lod === 0 || hash01(t.x, t.z, 151) > 0.55 * Math.max(0.5, c.dens)) return;
  const alive = c.level >= 3;
  const kit = alive ? CLUTTER_ALIVE : CLUTTER_DEAD;
  const kind = kit[Math.floor(hash01(t.x, t.z, 157) * kit.length)];
  if (kind === 'niche' || kind === 'pipes') return;
  const cx = hash01(t.x, t.z, 163) < 0.5 ? -1 : 1, cz = hash01(t.x, t.z, 167) < 0.5 ? -1 : 1;
  const [px, pz] = c.fit ? c.fit(x + cx * 0.33, z + cz * 0.33, 0.15) : [x + cx * 0.33, z + cz * 0.33];
  clutter(c, kind, alive, t.variant, px, top, pz, hash01(t.x, t.z, 173) * 6.28, 0.85);
}

// ───────────── buildings ─────────────

/**
 * A building's facades: ivy hanging from the parapet down the two faces the camera sees (dry and sparse in the
 * fog, lush and flowering once clear), wall clutter (AC units, copper pipes, a niche with a vase of flowers, a painted
 * leaf mural), and a bevelled coping on the parapet.
 */
export function buildingDressing(c: DressCtx, p: BuildingPlot, h: number, H: number, alive: boolean) {
  const top = h + 0.08 + H;
  const bw = p.w - 0.25, bd = p.d - 0.25;
  const south = p.z + p.d - 0.125; // wall face, +z
  const east = p.x + p.w - 0.125; // wall face, +x
  const stage = alive ? 4 : 0;
  const hang = Math.min(1.5, H * (alive ? 0.75 : 0.35));
  for (let i = 0; i < Math.floor(bw); i++) {
    const k = hash01(p.x + i, p.z, 181);
    if (k < (alive ? 0.7 : 0.3)) c.fb.add(vineGeo(stage, hang * (0.6 + k * 0.6), p.x + i + p.style, 1), p.x + 0.125 + i, top + 0.06, south + 0.01, 0, 1);
  }
  for (let i = 0; i < Math.floor(bd); i++) {
    const k = hash01(p.x, p.z + i, 191);
    if (k < (alive ? 0.55 : 0.25)) c.fb.add(vineGeo(stage, hang * (0.6 + k * 0.6), p.z + i + p.style * 3, 1), east + 0.01, top + 0.06, p.z + 0.125 + i + 1, -Math.PI / 2, 1);
  }
  if (c.lod === 0) return;
  // wall clutter on the south face, one storey up
  const storey = H / Math.max(1, p.storeys);
  const kinds: ClutterKind[] = alive ? ['ac', 'niche', 'mural', 'pipes'] : ['ac', 'pipes', 'ac', 'vent'];
  for (let i = 0; i < Math.min(3, Math.floor(bw)); i++) {
    const k = hash01(p.x + i * 5, p.z, 197);
    if (k > 0.6) continue;
    const kind = kinds[Math.floor(hash01(p.x, p.z + i, 199) * kinds.length)];
    const y = kind === 'pipes' ? h + 0.08 : h + 0.08 + storey * (0.1 + Math.floor(k * Math.max(1, p.storeys - 1)));
    const gx = p.x + 0.4 + i * ((bw - 0.3) / Math.max(1, Math.min(3, Math.floor(bw))));
    clutter(c, kind, alive, p.style + i, gx, y, south + (kind === 'mural' ? 0.075 : kind === 'pipes' ? 0.045 : kind === 'niche' ? 0.04 : 0.08), 0, 1);
  }
}

export type { ClutterKind, RailKind };
