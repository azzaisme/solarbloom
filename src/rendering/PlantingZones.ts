/**
 * P7-E28.1 (#726): planting zones. Every cell of the city has one planting zone, a pure function of the cell, its
 * neighbours (paving, roads, the jetty, bridges, water, machines), the area's landmark, its feature and its area
 * type, plus seeded low-frequency noise. The ground dressing (Surfaces.ts) plants by zone, and tree placement
 * (P7-E29) reads the same zones, so lawns, beds, groves and clearings line up.
 *
 * Looks only: nothing here is saved or read by the simulation, and the same world always gets the same zones.
 *
 * API (kept stable for P7-E29; any change is called out in its commit message):
 *   zoneAt(x, z, ctx) → PlantingZone
 *   ZONE_DENSITY[zone] → 'calm' | 'moderate' | 'dense'
 *   ctx.ignoreOccupants: zones from the generated world only (no machines), for trees
 */
import type { TileData } from '../core/types';

export type PlantingZone = 'open_lawn' | 'meadow' | 'flower_garden' | 'shoreline' | 'woodland_understory' | 'path_edge' | 'landmark_clearance';

export const PLANTING_ZONES: readonly PlantingZone[] = ['open_lawn', 'meadow', 'flower_garden', 'shoreline', 'woodland_understory', 'path_edge', 'landmark_clearance'];

/** P7-E28.3 (#728): how full each zone is planted: about half the restored ground calm, a third moderate, a fifth dense. */
export const ZONE_DENSITY: Record<PlantingZone, 'calm' | 'moderate' | 'dense'> = {
  open_lawn: 'calm',
  path_edge: 'calm',
  landmark_clearance: 'calm',
  meadow: 'moderate',
  shoreline: 'moderate',
  woodland_understory: 'moderate',
  flower_garden: 'dense',
};

/** What zoneAt needs to know about the world. A chunk renderer's DressCtx satisfies it. */
export interface ZoneCtx {
  /** A generated tile (undefined: not generated yet, read as plain ground). */
  peek(x: number, z: number): Pick<TileData, 'feature' | 'blocked' | 'occupantId'> | undefined;
  /** The area id a cell belongs to. */
  areaAt(x: number, z: number): string;
  /** The area type of the cell being zoned (park, grove, canal, beach…). */
  areaType: string;
  /** The anchor cell of the area's landmark (its 2×2 footprint runs +x, +z from it), if it has one. */
  landmark?: readonly [number, number];
  /**
   * Ignore machines (neighbours' `occupantId`, and the cell's own): zones then depend only on the generated world, so
   * building beside a spot never changes its zone. For things that must not pop in or out (P7-E29 trees).
   */
  ignoreOccupants?: boolean;
}

/** Tunables (P7 config block: composition heuristics, not exact quotas). */
export const ZONES = {
  /** cells (Chebyshev) round a landmark's footprint or a machine kept low and open */
  clearance: 1,
  /** …and the ring beyond it planted as a full destination bed */
  gardenRing: 3,
  /** size in tiles of the lawn / meadow / garden noise field */
  fieldScale: 6.5,
  /** noise thresholds on the field: below `lawn` open lawn, below `meadow` meadow, above it a flower garden */
  lawn: 0.5,
  meadow: 0.67,
  /** a garden is likelier within two cells of a path (flowers in beds along edges) */
  pathBias: 0.07,
  /** copses in parkland and by water: field value above this is woodland understory */
  copse: 0.76,
  copseScale: 9,
};

/** Area types whose natural ground is mostly woodland. */
const WOODED = new Set(['grove']);
/** Area types that grow the odd copse in their lawns. */
const COPSE = new Set(['park', 'reservoir', 'canal']);
/** Hard, built area types: less open lawn, more gardens (their green is in beds). */
const BUILT = new Set(['street', 'plaza', 'market', 'rooftops', 'downtown']);

const hash01 = (x: number, z: number, salt: number) => {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
/** Smooth value noise (the same as Surfaces.noise2; repeated so this module has no renderer imports). */
function noise2(x: number, z: number, salt: number) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const tx = x - x0, tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash01(x0, z0, salt), b = hash01(x0 + 1, z0, salt), c = hash01(x0, z0 + 1, salt), d = hash01(x0 + 1, z0 + 1, salt);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const featureOf = (t: Pick<TileData, 'feature'> | undefined) => t?.feature ?? 'lawn';
const isHard = (t: Pick<TileData, 'feature' | 'blocked'> | undefined) => !!t && !t.blocked && (featureOf(t) === 'paving' || featureOf(t) === 'road');
const isWater = (t: Pick<TileData, 'feature'> | undefined) => !!t && featureOf(t) === 'water';
/** Ground that can be planted (lawn, sand, clay, litter), unblocked and with nothing standing on it. */
export const plantable = (t: Pick<TileData, 'feature' | 'blocked' | 'occupantId'> | undefined) => {
  if (!t || t.blocked || t.occupantId) return false;
  const f = featureOf(t);
  return f === 'lawn' || f === 'sand' || f === 'clay' || f === 'litter';
};

/** Chebyshev distance from (x, z) to the landmark's 2×2 footprint. */
function landmarkDist(x: number, z: number, lm: readonly [number, number] | undefined) {
  if (!lm) return Infinity;
  const dx = x < lm[0] ? lm[0] - x : x > lm[0] + 1 ? x - lm[0] - 1 : 0;
  const dz = z < lm[1] ? lm[1] - z : z > lm[1] + 1 ? z - lm[1] - 1 : 0;
  return Math.max(dx, dz);
}

/** The lawn / meadow / garden field at a cell (0…1), before any bias. Exported for tests and tuning. */
export function zoneField(x: number, z: number) {
  const s = ZONES.fieldScale;
  return 0.72 * noise2(x / s, z / s, 7101) + 0.28 * noise2(x / (s * 0.42), z / (s * 0.42), 7103);
}

/**
 * The planting zone of cell (x, z). Hard ground (paving, roads, the jetty's planks) is `path_edge`, water is
 * `shoreline`, anything built, blocked or occupied is `landmark_clearance`; plantable ground goes by, in order:
 *  1. within `clearance` of the landmark or a machine: `landmark_clearance` (low and open, so prompts read);
 *  2. next to water: `shoreline` (reeds, stones, restrained bank plants);
 *  3. next to a path or road: `path_edge` (short, neat borders);
 *  4. within `gardenRing` of the landmark or a machine: `flower_garden` (the destination's fuller beds);
 *  5. grove ground, leaf litter, or a copse in the field: `woodland_understory`;
 *  6. the field: `open_lawn`, `meadow` or `flower_garden`.
 */
export function zoneAt(x: number, z: number, ctx: ZoneCtx): PlantingZone {
  const raw = ctx.peek(x, z);
  const t = raw && ctx.ignoreOccupants && raw.occupantId ? { ...raw, occupantId: undefined } : raw;
  if (t && !plantable(t)) {
    if (isWater(t)) return 'shoreline';
    if (isHard(t)) return 'path_edge';
    return 'landmark_clearance';
  }
  const R = ZONES.gardenRing;
  const lmd = landmarkDist(x, z, ctx.landmark);
  let machine = Infinity, water = false, edge = false, nearPath = false;
  for (let dz = -R; dz <= R; dz++)
    for (let dx = -R; dx <= R; dx++) {
      if (!dx && !dz) continue;
      const n = ctx.peek(x + dx, z + dz);
      if (!n) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (n.occupantId && !ctx.ignoreOccupants && d < machine) machine = d;
      if (d > 2) continue;
      if (d === 1 && isWater(n)) water = true;
      if (isHard(n)) {
        nearPath = true;
        if (d === 1 && (dx === 0 || dz === 0)) edge = true;
      }
    }
  const dest = Math.min(lmd, machine);
  if (dest <= ZONES.clearance) return 'landmark_clearance';
  if (water) return 'shoreline';
  if (edge) return 'path_edge';
  if (dest <= R) return 'flower_garden';
  const f = featureOf(t);
  if (WOODED.has(ctx.areaType) || f === 'litter') return 'woodland_understory';
  if (COPSE.has(ctx.areaType) && noise2(x / ZONES.copseScale, z / ZONES.copseScale, 7109) > ZONES.copse) return 'woodland_understory';
  const v = zoneField(x, z) + (nearPath ? ZONES.pathBias : 0) + (BUILT.has(ctx.areaType) ? 0.08 : 0);
  if (v < ZONES.lawn) return 'open_lawn';
  if (v < ZONES.meadow) return 'meadow';
  return 'flower_garden';
}
