// E21 (#312): the Old City — its map, regions, gates, set pieces, Keepers, caches, pages and the house.
// All data, no rules (docs/E21_OLD_CITY.md §7–§11). Cells are ground cells (chunk × 16 + local); the park is
// chunk (0, 0), so cells 0–15 on both axes. North is −z, south (toward the sea) is +z.

import type { AbilityId, MaterialId } from '../core/types';
import type { AreaType } from './city';
import type { MaterialCost, PileSize } from './salvage';

/**
 * The Old City is an island inside chunks −6…6 on both axes (13 × 13 chunks, 208 × 208 tiles). Every chunk outside
 * that square is open sea (E21.26), and so is the bay: chunks with z ≥ 3 and x ≤ 1.
 */
export const OLD_CITY = {
  min: -6,
  max: 6,
  /** chunks with z ≥ this and x ≤ seaMaxX are sea */
  seaMinZ: 3,
  seaMaxX: 1,
  /** E21.24: one terrace level is this many tiles high */
  levelHeight: 1.2,
  /** the level everything is measured from (drawn at the classic ground height) */
  baseLevel: 1,
  /** the sea and canals */
  seaLevel: 0,
  /** backstreets: their level until Milestone B blends them between neighbours */
  backstreetLevel: 1,
  /** the park */
  parkLevel: 1,
  /** the beach: rows of shallow surf before the open sea */
  surfRows: 3,
};

export type RegionId = 'mastRow' | 'oldMarket' | 'saltwind' | 'elderGrove' | 'cistern' | 'clockPlaza' | 'terraces' | 'glasshouse' | 'observatory' | 'spireHeights';

export type GateKind = 'barricade' | 'water' | 'lockBridge' | 'bridge' | 'climb' | 'cliff';

export interface GateDef {
  id: string;
  kind: GateKind;
  /** cells the gate covers (a barricade's rubble, the deep water, the bridge deck) */
  cells: [number, number][];
  /** what opens it: an ability, a region's landmark waking, or a repair delivery */
  needs: { ability?: AbilityId; landmark?: RegionId; repair?: MaterialCost };
  /** what the prompt says while it is shut */
  blocked: string;
  /**
   * Opening it opens its region (the default). False when the region is open from the start and the gate only
   * shuts off part of it (Saltwind Beach: the boat lands there; the barricade blocks the boardwalk to the Sea Lock).
   */
  opensRegion?: boolean;
}

/** A rectangle of cells (x, z, width, depth). */
export interface CellRect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export type RampDir = 'n' | 's' | 'e' | 'w';

/** E21.24: a ramp (one level over 3 tiles) or a stair (one level over 2), walked along `dir` from `from` to `to`. */
export interface RampDef extends CellRect {
  dir: RampDir;
  from: number;
  to: number;
  kind: 'ramp' | 'stair';
}

export interface PileDef {
  id: string;
  x: number;
  z: number;
  material: MaterialId;
  size: PileSize;
  /** which model draws it (one of the material's models) */
  model: string;
}

export interface SpotDef {
  id: string;
  x: number;
  z: number;
}

export interface RegionDef {
  id: RegionId;
  /** map order, 1–9 */
  n: number;
  name: string;
  type: AreaType;
  /** chunk rectangle, inclusive */
  chunks: { x0: number; x1: number; z0: number; z1: number };
  ring: 1 | 2 | 3;
  material: MaterialId;
  landmark: { kind: string; name: string; x: number; z: number };
  keeper: string;
  /** the 2×2 seam (a Reclaimer stands on it once the landmark wakes) */
  seam: { name: string; x: number; z: number };
  gate: GateDef;
  /** the Keeper's second request: restore every tile of this patch */
  patch: { name: string } & CellRect;
  caches: SpotDef[];
  pages: SpotDef[];
  lookout: SpotDef;
  /** E21.24 height */
  level: number;
  stamps: (CellRect & { level: number })[];
  ramps: RampDef[];
  /** E21.7: ladders (Climb) and perches (Glide, with their landing cell) */
  ladders: { x: number; z: number; to: [number, number] }[];
  perches: { x: number; z: number; to: [number, number] }[];
  /** loose piles (Milestone A lays out the park and Mast Row; the others land with E21.14–E21.16) */
  piles: PileDef[];
  /** the region's main street: a road from its gate (cells, two wide, for generation) */
  roads: CellRect[];
  /** deep water inside the region (a canal: never walked, until Hover; level 0) */
  water?: CellRect[];
}

const P = (id: string, x: number, z: number, material: MaterialId, size: PileSize, model: string): PileDef => ({ id, x, z, material, size, model });

export const REGIONS: RegionDef[] = [
  {
    id: 'mastRow',
    n: 1,
    name: 'Mast Row',
    type: 'street',
    chunks: { x0: 0, x1: 1, z0: -2, z1: -1 },
    ring: 1,
    material: 'copper',
    landmark: { kind: 'mast', name: 'Signal Mast', x: 18, z: -26 },
    keeper: 'pylon',
    seam: { name: 'the Pipeworks', x: 23, z: -8 },
    gate: { id: 'g-mastRow', kind: 'barricade', cells: [[7, -1], [8, -1]], needs: { ability: 'pry' }, blocked: 'Rubble blocks the way — needs Pry (fountain tier 1)' },
    patch: { name: 'The tram stop', x: 10, z: -20, w: 5, d: 3 },
    caches: [
      { id: 'c-mastRow-1', x: 2, z: -30 },
      { id: 'c-mastRow-2', x: 30, z: -12 },
    ],
    pages: [
      { id: 'p-mastRow-1', x: 14, z: -29 },
      { id: 'p-mastRow-2', x: 3, z: -10 },
    ],
    lookout: { id: 'l-mastRow', x: 28, z: -27 },
    level: 1,
    // one raised tram embankment along the east side, reached by a ramp from the south
    stamps: [{ x: 25, z: -31, w: 4, d: 9, level: 2 }],
    ramps: [{ x: 25, z: -22, w: 4, d: 3, dir: 's', from: 2, to: 1, kind: 'ramp' }],
    ladders: [{ x: 8, z: -32, to: [8, -33] }],
    perches: [],
    piles: [
      P('mr-c1', 4, -22, 'copper', 'large', 'salvage-copper'),
      P('mr-c2', 21, -14, 'copper', 'large', 'salvage-copper'),
      P('mr-c3', 12, -8, 'copper', 'medium', 'salvage-copper'),
      P('mr-c4', 16, -30, 'copper', 'medium', 'salvage-copper'),
      P('mr-c5', 22, -20, 'copper', 'medium', 'salvage-copper'),
      P('mr-c6', 2, -6, 'copper', 'medium', 'salvage-copper'),
      P('mr-c7', 15, -3, 'copper', 'small', 'salvage-copper'),
      P('mr-c8', 29, -6, 'copper', 'small', 'salvage-copper'),
      P('mr-c9', 11, -24, 'copper', 'small', 'salvage-copper'),
      P('mr-c10', 26, -28, 'copper', 'small', 'salvage-copper'),
      P('mr-s1', 20, -4, 'scrap', 'large', 'rubble-pile'),
      P('mr-s2', 4, -14, 'scrap', 'medium', 'crate'),
      P('mr-s3', 13, -27, 'scrap', 'medium', 'stone-block'),
      P('mr-s4', 30, -29, 'scrap', 'medium', 'rubble-pile'),
      P('mr-s5', 11, -12, 'scrap', 'small', 'crate'),
      P('mr-s6', 19, -10, 'scrap', 'small', 'rubble-pile'),
      P('mr-s7', 5, -29, 'scrap', 'small', 'stone-block'),
    ],
    roads: [
      { x: 7, z: -32, w: 2, d: 32 },
      { x: 0, z: -17, w: 32, d: 2 },
    ],
  },
  {
    id: 'oldMarket',
    n: 2,
    name: 'Old Market',
    type: 'market',
    chunks: { x0: 1, x1: 2, z0: 0, z1: 1 },
    ring: 1,
    material: 'glass',
    landmark: { kind: 'hall', name: 'Market Hall', x: 32, z: 14 },
    keeper: 'tally',
    seam: { name: 'the Glassworks', x: 40, z: 24 },
    gate: { id: 'g-oldMarket', kind: 'barricade', cells: [[16, 7], [16, 8]], needs: { ability: 'pry' }, blocked: 'Rubble blocks the way — needs Pry (fountain tier 1)' },
    patch: { name: 'The market square', x: 26, z: 18, w: 6, d: 4 },
    caches: [
      { id: 'c-oldMarket-1', x: 45, z: 2 },
      { id: 'c-oldMarket-2', x: 18, z: 29 },
    ],
    pages: [
      { id: 'p-oldMarket-1', x: 30, z: 4 },
      { id: 'p-oldMarket-2', x: 44, z: 28 },
    ],
    lookout: { id: 'l-oldMarket', x: 36, z: 6 },
    level: 1,
    stamps: [],
    ramps: [],
    ladders: [],
    perches: [],
    piles: [],
    roads: [{ x: 16, z: 7, w: 32, d: 2 }],
  },
  {
    id: 'saltwind',
    n: 3,
    name: 'Saltwind Beach',
    type: 'beach',
    chunks: { x0: -1, x1: 0, z0: 1, z1: 2 },
    ring: 1,
    material: 'timber',
    landmark: { kind: 'sealock', name: 'The Sea Lock', x: -6, z: 40 },
    keeper: 'tide',
    seam: { name: 'the Driftline', x: -12, z: 28 },
    // The boat lands here, so the beach is open from the start. The Sea Lock stands across the canal that runs down
    // to the bay; the barricade blocks the boardwalk bridge over it.
    gate: { id: 'g-saltwind', kind: 'barricade', cells: [[-3, 36], [-2, 36], [-3, 37], [-2, 37]], needs: { ability: 'pry' }, blocked: 'Rubble blocks the boardwalk to the Sea Lock — needs Pry (fountain tier 1)', opensRegion: false },
    patch: { name: 'The boardwalk', x: 0, z: 36, w: 10, d: 2 },
    caches: [
      { id: 'c-saltwind-1', x: -15, z: 18 },
      { id: 'c-saltwind-2', x: 13, z: 42 },
    ],
    pages: [
      { id: 'p-saltwind-1', x: 2, z: 30 },
      { id: 'p-saltwind-2', x: -10, z: 42 },
    ],
    lookout: { id: 'l-saltwind', x: 12, z: 24 },
    level: 0,
    stamps: [],
    ramps: [],
    ladders: [],
    perches: [],
    // the first pile: right in front of bloombot as it steps off the jetty
    piles: [P('sw-s1', 8, 44, 'scrap', 'small', 'crate')],
    roads: [],
    water: [{ x: -3, z: 16, w: 2, d: 32 }],
  },
  {
    id: 'elderGrove',
    n: 4,
    name: 'Elder Grove',
    type: 'grove',
    chunks: { x0: -2, x1: -1, z0: -1, z1: 0 },
    ring: 1,
    material: 'seeds',
    landmark: { kind: 'elder', name: 'Elder Tree', x: -20, z: -4 },
    keeper: 'moss',
    seam: { name: 'the Seedbank', x: -28, z: 8 },
    gate: { id: 'g-elderGrove', kind: 'barricade', cells: [[-1, 7], [-1, 8]], needs: { ability: 'pry' }, blocked: 'Rubble blocks the way — needs Pry (fountain tier 1)' },
    patch: { name: 'The ring of stumps', x: -14, z: 2, w: 4, d: 4 },
    caches: [
      { id: 'c-elderGrove-1', x: -31, z: -15 },
      { id: 'c-elderGrove-2', x: -3, z: -14 },
    ],
    pages: [
      { id: 'p-elderGrove-1', x: -24, z: 12 },
      { id: 'p-elderGrove-2', x: -10, z: -10 },
    ],
    lookout: { id: 'l-elderGrove', x: -15, z: -3 },
    level: 1,
    // the Elder Tree on a hill, reached by a ramp from the south; its lookout on the east edge faces the park
    stamps: [{ x: -26, z: -10, w: 12, d: 12, level: 2 }],
    ramps: [{ x: -21, z: 2, w: 3, d: 3, dir: 'n', from: 1, to: 2, kind: 'ramp' }],
    ladders: [],
    perches: [],
    piles: [],
    roads: [{ x: -32, z: 7, w: 32, d: 2 }],
  },
  {
    id: 'cistern',
    n: 5,
    name: 'Cistern Basin',
    type: 'reservoir',
    chunks: { x0: 2, x1: 4, z0: 2, z1: 3 },
    ring: 2,
    material: 'clay',
    landmark: { kind: 'cistern', name: 'Old Cistern', x: 56, z: 48 },
    keeper: 'sluice',
    seam: { name: 'the Claypits', x: 70, z: 58 },
    gate: { id: 'g-cistern', kind: 'water', cells: [[40, 32], [41, 32], [40, 33], [41, 33], [40, 34], [41, 34]], needs: { ability: 'hover' }, blocked: 'Deep water — needs Hover (fountain tier 2)' },
    patch: { name: 'The spillway', x: 44, z: 52, w: 4, d: 6 },
    caches: [
      { id: 'c-cistern-1', x: 78, z: 33 },
      { id: 'c-cistern-2', x: 33, z: 62 },
    ],
    pages: [
      { id: 'p-cistern-1', x: 64, z: 36 },
      { id: 'p-cistern-2', x: 48, z: 60 },
    ],
    lookout: { id: 'l-cistern', x: 76, z: 40 },
    level: 1,
    // a sunken basin inside the rim, the cistern on an island in it; a ramp down from the north rim, one up to the island
    stamps: [
      { x: 36, z: 36, w: 40, d: 24, level: 0 },
      { x: 52, z: 44, w: 10, d: 10, level: 1 },
    ],
    ramps: [
      { x: 44, z: 36, w: 3, d: 3, dir: 's', from: 1, to: 0, kind: 'ramp' },
      { x: 56, z: 54, w: 2, d: 3, dir: 'n', from: 0, to: 1, kind: 'ramp' },
    ],
    ladders: [],
    perches: [],
    piles: [],
    roads: [],
  },
  {
    id: 'clockPlaza',
    n: 6,
    name: 'Clock Plaza',
    type: 'plaza',
    chunks: { x0: 3, x1: 4, z0: -1, z1: 1 },
    ring: 2,
    material: 'gears',
    landmark: { kind: 'clock', name: 'Clock Tower', x: 64, z: 4 },
    keeper: 'tock',
    seam: { name: 'the Escapement', x: 72, z: -12 },
    gate: { id: 'g-clockPlaza', kind: 'lockBridge', cells: [[48, 7], [49, 7], [48, 8], [49, 8]], needs: { landmark: 'saltwind', ability: 'hover' }, blocked: 'The canal is too deep — the lock bridge rises when the Sea Lock wakes (or Hover)' },
    patch: { name: 'The plaza', x: 60, z: 12, w: 8, d: 4 },
    caches: [
      { id: 'c-clockPlaza-1', x: 78, z: 30 },
      { id: 'c-clockPlaza-2', x: 50, z: -15 },
    ],
    pages: [
      { id: 'p-clockPlaza-1', x: 70, z: 22 },
      { id: 'p-clockPlaza-2', x: 56, z: -8 },
    ],
    lookout: { id: 'l-clockPlaza', x: 76, z: 0 },
    level: 2,
    stamps: [],
    ramps: [],
    ladders: [],
    perches: [],
    piles: [],
    roads: [],
  },
  {
    id: 'terraces',
    n: 7,
    name: 'The Terraces',
    type: 'rooftops',
    chunks: { x0: -1, x1: 1, z0: -4, z1: -3 },
    ring: 2,
    material: 'sunstone',
    landmark: { kind: 'crystal', name: 'Rooftop Core', x: 6, z: -52 },
    keeper: 'gable',
    seam: { name: 'the Sunvein', x: -10, z: -60 },
    gate: { id: 'g-terraces', kind: 'climb', cells: [[8, -33]], needs: { ability: 'climb' }, blocked: 'Only the roofs go on from here — needs Climb (fountain tier 3)' },
    patch: { name: 'The roof garden', x: 18, z: -46, w: 4, d: 4 },
    caches: [
      { id: 'c-terraces-1', x: -15, z: -63 },
      { id: 'c-terraces-2', x: 30, z: -34 },
    ],
    pages: [
      { id: 'p-terraces-1', x: 24, z: -60 },
      { id: 'p-terraces-2', x: -8, z: -40 },
    ],
    lookout: { id: 'l-terraces', x: 28, z: -50 },
    level: 2,
    stamps: [],
    ramps: [],
    ladders: [],
    perches: [{ x: 31, z: -48, to: [33, -48] }],
    piles: [],
    roads: [],
  },
  {
    id: 'glasshouse',
    n: 8,
    name: 'Glasshouse Gardens',
    type: 'grove',
    chunks: { x0: -4, x1: -3, z0: -2, z1: 0 },
    ring: 3,
    material: 'glass',
    landmark: { kind: 'greenhouse', name: 'Great Greenhouse', x: -50, z: -10 },
    keeper: 'fern',
    seam: { name: 'the Potting Sheds', x: -60, z: -28 },
    gate: { id: 'g-glasshouse', kind: 'bridge', cells: [[-36, 0], [-35, 0], [-34, 0], [-33, 0], [-36, 1], [-35, 1], [-34, 1], [-33, 1]], needs: { repair: { timber: 30, copper: 20, gears: 10 } }, blocked: 'The bridge is broken — repair it with 30 Timber, 20 Copper and 10 Gears' },
    patch: { name: 'The nursery beds', x: -46, z: 6, w: 4, d: 4 },
    caches: [
      { id: 'c-glasshouse-1', x: -63, z: 14 },
      { id: 'c-glasshouse-2', x: -34, z: -31 },
    ],
    pages: [
      { id: 'p-glasshouse-1', x: -56, z: 2 },
      { id: 'p-glasshouse-2', x: -40, z: -22 },
    ],
    lookout: { id: 'l-glasshouse', x: -48, z: -30 },
    level: 2,
    stamps: [],
    ramps: [],
    ladders: [],
    perches: [],
    piles: [],
    roads: [],
  },
  {
    id: 'observatory',
    n: 9,
    name: 'Observatory Hill',
    type: 'rooftops',
    chunks: { x0: 2, x1: 4, z0: -5, z1: -3 },
    ring: 3,
    material: 'copper',
    landmark: { kind: 'observatory', name: 'Sky Observatory', x: 60, z: -66 },
    keeper: 'vega',
    seam: { name: 'the Lens Grinders', x: 72, z: -40 },
    gate: { id: 'g-observatory', kind: 'cliff', cells: [[33, -48]], needs: { ability: 'glide' }, blocked: 'A cliff too high to climb — glide here from the edge of The Terraces (fountain tier 4)' },
    patch: { name: 'The hilltop', x: 56, z: -74, w: 6, d: 4 },
    caches: [
      { id: 'c-observatory-1', x: 78, z: -79 },
      { id: 'c-observatory-2', x: 34, z: -78 },
    ],
    pages: [
      { id: 'p-observatory-1', x: 50, z: -36 },
      { id: 'p-observatory-2', x: 70, z: -56 },
    ],
    lookout: { id: 'l-observatory', x: 69, z: -70 },
    level: 3,
    // the summit (level 4) round the observatory, reached by a ramp from the south
    stamps: [{ x: 52, z: -76, w: 18, d: 17, level: 4 }],
    ramps: [{ x: 60, z: -59, w: 2, d: 3, dir: 'n', from: 3, to: 4, kind: 'ramp' }],
    ladders: [],
    perches: [],
    piles: [],
    roads: [],
  },
  {
    // E21.25: a downtown of five glass towers on a raised plateau (the towers themselves land with #352)
    id: 'spireHeights',
    n: 10,
    name: 'Spire Heights',
    type: 'downtown',
    chunks: { x0: -5, x1: -2, z0: -6, z1: -3 },
    ring: 3,
    material: 'gears',
    landmark: { kind: 'spire', name: 'Solar Spire', x: -50, z: -66 },
    keeper: 'atlas',
    seam: { name: 'the Foundry Vaults', x: -70, z: -50 },
    gate: { id: 'g-spireHeights', kind: 'climb', cells: [[-24, -33], [-23, -33]], needs: { ability: 'climb' }, blocked: 'A collapsed skybridge blocks the avenue — needs Climb (fountain tier 3)' },
    patch: { name: 'Spire Square', x: -54, z: -58, w: 8, d: 4 },
    caches: [
      { id: 'c-spireHeights-1', x: -79, z: -90 },
      { id: 'c-spireHeights-2', x: -20, z: -92 },
    ],
    pages: [
      { id: 'p-spireHeights-1', x: -40, z: -40 },
      { id: 'p-spireHeights-2', x: -70, z: -80 },
    ],
    lookout: { id: 'l-spireHeights', x: -30, z: -60 },
    level: 2,
    stamps: [],
    ramps: [],
    ladders: [],
    perches: [],
    piles: [],
    roads: [{ x: -24, z: -96, w: 2, d: 64 }],
  },
];

// ───────────── E23.8.1 (#399): region strengths ─────────────

/**
 * A region's natural strength, as well as its E21 material: the reason to link regions together. A machine that
 * matches a strength gives that much more output when it stands in the region (see `strengthAt` in
 * core/RegionStrengths). `shelter` and `water` read as yes/no: greenhouses ignore weather, springs refill for free.
 */
export type StrengthKind = 'wind' | 'tide' | 'sun' | 'soil' | 'water' | 'machinery' | 'salvage' | 'shelter' | 'trade';

/** Starting value: about 1.5× output for a matching machine in its strength region. */
export const STRENGTH_BONUS = 1.5;

export const REGION_STRENGTHS: Record<RegionId, { strengths: Partial<Record<StrengthKind, number>>; text: string }> = {
  mastRow: { strengths: { wind: STRENGTH_BONUS }, text: 'Wind' },
  oldMarket: { strengths: { trade: STRENGTH_BONUS }, text: 'Trade: swap materials, buy seeds' },
  saltwind: { strengths: { wind: 1.75, tide: STRENGTH_BONUS }, text: 'Wind and tide: the strongest wind' },
  elderGrove: { strengths: { soil: STRENGTH_BONUS }, text: 'Fertile soil: faster crops, more biomass' },
  cistern: { strengths: { water: STRENGTH_BONUS }, text: 'Water: springs refill for free' },
  clockPlaza: { strengths: { machinery: STRENGTH_BONUS }, text: 'Machinery' },
  terraces: { strengths: { sun: STRENGTH_BONUS }, text: 'Sun: more solar on the roofs' },
  glasshouse: { strengths: { shelter: STRENGTH_BONUS }, text: 'Shelter: greenhouses ignore weather' },
  observatory: { strengths: { sun: STRENGTH_BONUS, wind: STRENGTH_BONUS }, text: 'Sun and wind' },
  spireHeights: { strengths: { salvage: STRENGTH_BONUS }, text: 'Scrap and metals: the richest salvage' },
};

/**
 * Which machines a strength boosts. Machine ids are the E23 build ids; several belong to sessions still landing
 * (power, water, farm, crafting), so this is a plain lookup they can extend. A machine not listed has no strength.
 */
export const STRENGTH_MACHINES: Record<StrengthKind, string[]> = {
  wind: ['windTurbine', 'turbineField'],
  tide: ['tidalPump', 'desalinationPlant'],
  sun: ['solar', 'largeSolar'],
  soil: ['planter', 'orchard', 'floodedBed', 'roofGarden', 'beehive'],
  water: ['pump', 'reservoir', 'largeReservoir', 'gravityFeed', 'spring'],
  machinery: ['craftingTable', 'assembler', 'motor', 'bioDigester', 'mulcher'],
  salvage: ['salvage'],
  shelter: ['greenhouse', 'mushroomLog'],
  trade: ['trade'],
};

// ───────────── E21.26: the island ─────────────

export type CoastKind = 'cliff' | 'rocky' | 'beach';

/**
 * The island's coastline, per edge: what kind of shore and how many tiles of each outer chunk are sea. Sea cliffs
 * in the north (under Spire Heights and Observatory Hill), rocky shore east and west, beaches in the south. The bay
 * (z ≥ 3, x ≤ 1) has its own shore: Saltwind Beach.
 */
export const COAST: Record<'north' | 'south' | 'east' | 'west', { kind: CoastKind; band: number }> = {
  north: { kind: 'cliff', band: 3 },
  east: { kind: 'rocky', band: 3 },
  west: { kind: 'rocky', band: 3 },
  south: { kind: 'beach', band: 4 },
};

/**
 * E21.26: the Landing. A new old-city game starts on this jetty on Saltwind Beach, at the foot of the beach below the
 * park's south steps, facing north toward the park (the boat arrival cinematic comes with #353).
 */
export const LANDING = {
  /** 3 × 4 tiles: the jetty model at half size, so its planks and rope posts suit bloombot (0.85 m) */
  jetty: { x: 7, z: 45, w: 3, d: 4 } as CellRect,
  spawn: [8.5, 45.5] as [number, number],
  /** radians, 0 = +z (south): π faces north, up the beach to the park */
  facing: Math.PI,
};

/** The park's set pieces (chunk 0, 0). The first pile stands right in front of bloombot when it wakes. */
export const PARK_SET = {
  /** E21.12: 60 Scrap and 18 Seeds (see data/salvage LOOSE_YIELD) */
  piles: [
    P('pk-s1', 8, 9, 'scrap', 'small', 'rubble-pile'),
    P('pk-s2', 13, 5, 'scrap', 'small', 'crate'),
    P('pk-s3', 12, 11, 'scrap', 'medium', 'rubble-pile'),
    P('pk-s4', 5, 2, 'scrap', 'medium', 'stone-block'),
    P('pk-s5', 13, 14, 'scrap', 'large', 'rubble-pile'),
    P('pk-e1', 11, 13, 'seeds', 'small', 'broken-pot'),
    P('pk-e2', 3, 15, 'seeds', 'small', 'broken-pot'),
    P('pk-e3', 14, 1, 'seeds', 'small', 'stump'),
  ],
  /** E21.11: the ruined shed, north-west of the fountain (3 × 3; its door faces the fountain, on the south-east) */
  shed: { x: 2, z: 2, size: 3, door: [4, 5] as [number, number] },
  level: 1,
  /** broad steps down to the beach through the south gate */
  ramps: [{ x: 6, z: 14, w: 4, d: 2, dir: 's', from: 1, to: 0, kind: 'stair' }] as RampDef[],
  pages: [
    // E23.9.1: his first note waits at the top of the beach steps, where bloombot first comes into the park
    { id: 'p-park-1', x: 7, z: 12 },
    { id: 'p-park-2', x: 14, z: 9 },
  ] as SpotDef[],
};

// ───────────── §8 Keepers ─────────────

export type RewardId = 'beacons' | 'trade' | 'lockBridge' | 'seedsDouble' | 'waterCap' | 'helpersFast' | 'energyCap' | 'heartSeed' | 'starLens' | 'lifts';

export interface KeeperDef {
  id: string;
  name: string;
  region: RegionId;
  /** where it sleeps (near the region's entrance) */
  x: number;
  z: number;
  /** bloombot's model, tinted */
  tint: string;
  /** the one prop it carries (a model name) */
  prop: string;
  request1: MaterialCost;
  landmark: MaterialCost;
  reward: RewardId;
  rewardText: string;
  /** speech bubbles, one to three lines each */
  say: {
    asleep: string[];
    stirred: string[];
    woke: string[];
    request1: string[];
    request2: string[];
    landmark: string[];
    settled: string[];
  };
}

export const KEEPERS: KeeperDef[] = [
  {
    id: 'pylon', name: 'Pylon', region: 'mastRow', x: 10, z: -4, tint: '#d08a4c', prop: 'copper-pipe',
    request1: { seeds: 8 }, landmark: { copper: 20, scrap: 10 }, reward: 'beacons', rewardText: 'Every landmark beacon shows on the minimap',
    say: {
      asleep: ['A robot slumped against a lamp post. Its visor is dark.'],
      stirred: ['…bzzt. Power? Is someone there?', 'Five of anything would get my circuits going.'],
      woke: ['Pylon, signal keeper of Mast Row. You woke me!', 'The mast up the street has been dark for years.'],
      request1: ['Nothing grows here any more.', 'Bring me 8 Seeds from the park and I will plant the verges.'],
      request2: ['The old tram stop is where everyone used to meet.', 'Bring it back to life, every tile of it.'],
      landmark: ['The Signal Mast is ready to sing again.', 'Bring 20 Copper and 10 Scrap to the mast and wake it.'],
      settled: ['The mast is calling! Every beacon in the city answers now.', 'Look for the lights on your map.'],
    },
  },
  {
    id: 'tally', name: 'Tally', region: 'oldMarket', x: 19, z: 10, tint: '#7fb8c4', prop: 'lantern',
    request1: { timber: 10 }, landmark: { glass: 20, timber: 10 }, reward: 'trade', rewardText: 'Tally trades any 3 of one material for 1 of another',
    say: {
      asleep: ['A robot behind a broken stall, counting nothing.'],
      stirred: ['Customer? Five of anything and we can talk.'],
      woke: ['Tally, keeper of the Old Market. Every stall had a lamp once.'],
      request1: ['The stalls need mending. 10 Timber from the beach, please.'],
      request2: ['Restore the market square, so people have somewhere to stand.'],
      landmark: ['The Market Hall can open its doors.', 'Bring 20 Glass and 10 Timber to the hall.'],
      settled: ['Open for business! Bring me 3 of anything and I will give you 1 of what you need.'],
    },
  },
  {
    id: 'tide', name: 'Tide', region: 'saltwind', x: 10, z: 19, tint: '#5f9ec0', prop: 'barrel',
    request1: { copper: 10 }, landmark: { timber: 20, copper: 10 }, reward: 'lockBridge', rewardText: 'The lock bridge to Clock Plaza rises; the canals fill',
    say: {
      asleep: ['A robot half buried in the sand, facing the sea.'],
      stirred: ['…the tide? Five of anything, and I will get up.'],
      woke: ['Tide, keeper of Saltwind Beach. I watch the Sea Lock.'],
      request1: ['The lock\'s hinges are gone. 10 Copper from Mast Row, please.'],
      request2: ['Restore the boardwalk so the beach can be walked again.'],
      landmark: ['The Sea Lock is ready. Bring 20 Timber and 10 Copper.'],
      settled: ['The lock is open! The canals fill and the bridge to Clock Plaza rises.'],
    },
  },
  {
    id: 'moss', name: 'Moss', region: 'elderGrove', x: -4, z: 10, tint: '#7aa05a', prop: 'planter-pot',
    request1: { glass: 10 }, landmark: { seeds: 20, biomass: 40 }, reward: 'seedsDouble', rewardText: 'Loose Seeds piles give double',
    say: {
      asleep: ['A robot curled up among dead leaves.'],
      stirred: ['Mm. Five of anything, and I will wake properly.'],
      woke: ['Moss, keeper of Elder Grove. The old tree is still alive, just.'],
      request1: ['I need cloches for the seedlings. 10 Glass from the market.'],
      request2: ['Restore the ring of stumps where the grove began.'],
      landmark: ['Wake the Elder Tree with 20 Seeds and 40 Biomass.'],
      settled: ['The Elder Tree is awake! Seeds come twice as easily now.'],
    },
  },
  {
    id: 'sluice', name: 'Sluice', region: 'cistern', x: 38, z: 37, tint: '#6a8fb0', prop: 'dry-drain',
    request1: { gears: 12 }, landmark: { clay: 30, copper: 15 }, reward: 'waterCap', rewardText: 'Water storage doubled',
    say: {
      asleep: ['A robot on the rim of a dry basin.'],
      stirred: ['Water? No… five of anything, then.'],
      woke: ['Sluice, keeper of Cistern Basin.'],
      request1: ['The valves are seized. 12 Gears from Clock Plaza.'],
      request2: ['Restore the spillway so the water has somewhere to go.'],
      landmark: ['Wake the Old Cistern with 30 Clay and 15 Copper.'],
      settled: ['The cistern holds water again! Your tanks hold twice as much.'],
    },
  },
  {
    id: 'tock', name: 'Tock', region: 'clockPlaza', x: 52, z: 8, tint: '#c4a85a', prop: 'vent',
    request1: { glass: 12 }, landmark: { gears: 30, glass: 15 }, reward: 'helpersFast', rewardText: 'Helpers work 25% faster',
    say: {
      asleep: ['A robot frozen mid-step at the foot of the stair.'],
      stirred: ['Tick… tick… five of anything, please.'],
      woke: ['Tock, keeper of Clock Plaza. The clock stopped at twenty past four.'],
      request1: ['The clock face is shattered. 12 Glass, please.'],
      request2: ['Restore the plaza around the tower.'],
      landmark: ['Wake the Clock Tower with 30 Gears and 15 Glass.'],
      settled: ['The clock runs! Every helper keeps better time now.'],
    },
  },
  {
    id: 'gable', name: 'Gable', region: 'terraces', x: 10, z: -36, tint: '#b07a8a', prop: 'planter-trough',
    request1: { clay: 15 }, landmark: { sunstone: 30, gears: 15 }, reward: 'energyCap', rewardText: 'Energy storage doubled',
    say: {
      asleep: ['A robot asleep against a chimney.'],
      stirred: ['Up here? Five of anything and I will wake.'],
      woke: ['Gable, keeper of The Terraces.'],
      request1: ['The roof beds need clay. 15 Clay from the basin.'],
      request2: ['Restore the roof garden.'],
      landmark: ['Wake the Rooftop Core with 30 Sunstone and 15 Gears.'],
      settled: ['The Core is glowing! Your batteries hold twice as much.'],
    },
  },
  {
    id: 'fern', name: 'Fern', region: 'glasshouse', x: -38, z: 4, tint: '#5aa07a', prop: 'planter-bed',
    request1: { sunstone: 15 }, landmark: { glass: 40, seeds: 40, clay: 20 }, reward: 'heartSeed', rewardText: 'The Heart Seed',
    say: {
      asleep: ['A robot among cracked glass panes.'],
      stirred: ['Five of anything, and I will see you properly.'],
      woke: ['Fern, keeper of the Glasshouse Gardens.'],
      request1: ['The heaters need light. 15 Sunstone from the roofs.'],
      request2: ['Restore the nursery beds.'],
      landmark: ['Wake the Great Greenhouse with 40 Glass, 40 Seeds and 20 Clay.'],
      settled: ['The greenhouse breathes! Take the Heart Seed to the fountain.'],
    },
  },
  {
    id: 'vega', name: 'Vega', region: 'observatory', x: 36, z: -46, tint: '#8a7ac4', prop: 'satellite-dish',
    request1: { glass: 20 }, landmark: { sunstone: 40, copper: 30, gears: 20 }, reward: 'starLens', rewardText: 'The Star Lens; caches show on the map',
    say: {
      asleep: ['A robot staring at the sky, unmoving.'],
      stirred: ['Five of anything, and I will look down for once.'],
      woke: ['Vega, keeper of Observatory Hill.'],
      request1: ['The telescope needs lenses. 20 Glass, please.'],
      request2: ['Restore the hilltop.'],
      landmark: ['Wake the Sky Observatory with 40 Sunstone, 30 Copper and 20 Gears.'],
      settled: ['I can see everything! Take the Star Lens, and look for the caches on your map.'],
    },
  },
  {
    id: 'atlas', name: 'Atlas', region: 'spireHeights', x: -24, z: -36, tint: '#9aa6b8', prop: 'lamp-post',
    request1: { clay: 20 }, landmark: { glass: 40, gears: 30, sunstone: 20 }, reward: 'lifts', rewardText: 'Every tower lift runs; the Spire\'s top becomes a travel point',
    say: {
      asleep: ['A tall robot under a fallen skybridge, holding up nothing.'],
      stirred: ['Floors… so many floors. Five of anything, please.'],
      woke: ['Atlas, keeper of Spire Heights. I ran the lifts.'],
      request1: ['The planters on the terraces are bare. 20 Clay from the basin.'],
      request2: ['Restore Spire Square, at the foot of the towers.'],
      landmark: ['Wake the Solar Spire with 40 Glass, 30 Gears and 20 Sunstone.'],
      settled: ['The Spire is lit! Every lift runs again, right to the top.'],
    },
  },
];

// ───────────── §10 caches, blueprints, keepsakes, pages ─────────────

/** One blueprint per region, in map order. */
export const BLUEPRINTS: { id: string; name: string; region: RegionId }[] = [
  { id: 'networks', name: 'Networks workbench group', region: 'mastRow' },
  { id: 'fog', name: 'Fog workbench group', region: 'oldMarket' },
  { id: 'pulse3', name: 'Pulse, level 3', region: 'saltwind' },
  { id: 'machines3', name: 'Machines, level 3', region: 'elderGrove' },
  { id: 'drones3', name: 'Drones, level 3', region: 'cistern' },
  { id: 'storage3', name: 'Storage, level 3', region: 'clockPlaza' },
  { id: 'reclaimerMk2', name: 'Reclaimer Mk 2 (12 a minute)', region: 'terraces' },
  { id: 'packFrame', name: 'Pack Frame (+40 to every stack)', region: 'glasshouse' },
  { id: 'sprintServos', name: 'Sprint Servos (faster sprint)', region: 'observatory' },
  { id: 'longGlide', name: 'Long Glide (glides from a tower top reach twice as far)', region: 'spireHeights' },
];

/** One keepsake decoration per region (existing models). */
export const KEEPSAKES: { id: string; name: string; model: string; region: RegionId }[] = [
  { id: 'ks-mast', name: 'Tram sign', model: 'keepsake-tram-sign', region: 'mastRow' },
  { id: 'ks-market', name: 'Market scales', model: 'keepsake-scales', region: 'oldMarket' },
  { id: 'ks-beach', name: 'Ship\'s bell', model: 'keepsake-ship-bell', region: 'saltwind' },
  { id: 'ks-grove', name: 'Acorn lamp', model: 'keepsake-acorn-lamp', region: 'elderGrove' },
  { id: 'ks-cistern', name: 'Water jug', model: 'keepsake-water-jug', region: 'cistern' },
  { id: 'ks-clock', name: 'Cuckoo clock', model: 'keepsake-cuckoo-clock', region: 'clockPlaza' },
  { id: 'ks-roofs', name: 'Weathercock', model: 'keepsake-weathercock', region: 'terraces' },
  { id: 'ks-glass', name: 'Terrarium', model: 'keepsake-terrarium', region: 'glasshouse' },
  { id: 'ks-observatory', name: 'Orrery', model: 'keepsake-orrery', region: 'observatory' },
  { id: 'ks-spire', name: 'Lift dial', model: 'keepsake-lift-dial', region: 'spireHeights' },
];

/** E23.9.1: the journal's pages live in data/journal (book order, by stage); the posts are placed above. */
export { PAGES } from './journal';

// ───────────── §11 the house ─────────────

export interface HouseLevel {
  level: number;
  name: string;
  delivery: MaterialCost;
  /** inside, tiles a side */
  room: number;
  /** decorations allowed inside */
  decor: number;
  gives: string[];
}

export const HOUSE: HouseLevel[] = [
  { level: 1, name: 'Shed', delivery: { scrap: 15, timber: 10 }, room: 6, decor: 12, gives: ['A bed', 'A storage chest', 'The Workbench moves in'] },
  { level: 2, name: 'Cottage', delivery: { timber: 30, glass: 20, clay: 20 }, room: 8, decor: 40, gives: ['Keepsake shelf', 'Journal desk'] },
  { level: 3, name: 'House', delivery: { gears: 40, copper: 40, glass: 30 }, room: 10, decor: 80, gives: ['A fenced garden outside'] },
  { level: 4, name: 'Home', delivery: { sunstone: 40, timber: 60, clay: 40 }, room: 12, decor: 140, gives: ['Travel home from anywhere'] },
];

/** §17 one-off items. */
export const ITEMS: Record<string, { name: string; from: RegionId }> = {
  heartSeed: { name: 'Heart Seed', from: 'glasshouse' },
  starLens: { name: 'Star Lens', from: 'observatory' },
};

// ───────────── the Old City's models ─────────────

/**
 * Every model the Old City expects, by file name (`assets/raw/models/final/<name>.glb` plus `<name>.lod1.glb`), as
 * listed in docs/art/old-city-models.md. They are loaded by name through src/rendering/Models.ts. Until a file has
 * landed the game draws its STAND-IN (an existing model, or 'procedural' for code-drawn shapes): stand-ins are
 * placeholders, not the finished art. Keepers are rigged (clips idle, wave, sleep) and play through the bloombot
 * pipeline once they land. Dead and restored looks come from the neglected-look shader (E20.6), not extra files.
 */
export const MODEL_NAMES: Record<string, { standIn: string; what: string }> = {
  // Keepers (rigged)
  'keeper-pylon': { standIn: 'procedural', what: 'Pylon, Keeper of Mast Row' },
  'keeper-tally': { standIn: 'procedural', what: 'Tally, Keeper of the Old Market' },
  'keeper-tide': { standIn: 'procedural', what: 'Tide, Keeper of Saltwind Beach' },
  'keeper-moss': { standIn: 'procedural', what: 'Moss, Keeper of Elder Grove' },
  'keeper-sluice': { standIn: 'procedural', what: 'Sluice, Keeper of Cistern Basin' },
  'keeper-tock': { standIn: 'procedural', what: 'Tock, Keeper of Clock Plaza' },
  'keeper-gable': { standIn: 'procedural', what: 'Gable, Keeper of The Terraces' },
  'keeper-fern': { standIn: 'procedural', what: 'Fern, Keeper of the Glasshouse Gardens' },
  'keeper-vega': { standIn: 'procedural', what: 'Vega, Keeper of Observatory Hill' },
  'keeper-atlas': { standIn: 'procedural', what: 'Atlas, Keeper of Spire Heights' },
  // landmarks and towers
  'solar-spire': { standIn: 'skyline-tower', what: 'The Solar Spire (Spire Heights landmark)' },
  'glass-tower': { standIn: 'skyline-tower', what: 'Glass Tower' },
  'twin-tower': { standIn: 'skyline-tower', what: 'The Twins (placed twice)' },
  'old-exchange': { standIn: 'skyline-tower', what: 'Old Exchange' },
  'great-greenhouse': { standIn: 'skyline-dome', what: 'The Great Greenhouse (Glasshouse Gardens landmark)' },
  'sky-observatory': { standIn: 'satellite-dish', what: 'The Sky Observatory (Observatory Hill landmark)' },
  'sea-lock-light': { standIn: 'lamp-post', what: 'The Sea Lock\'s beacon, beside the existing lock-gate' },
  // the house
  'house-shed': { standIn: 'procedural', what: 'House level 1: the patched shed' },
  'house-cottage': { standIn: 'procedural', what: 'House level 2: the cottage' },
  'house-two-storey': { standIn: 'procedural', what: 'House level 3: two storeys' },
  'house-home': { standIn: 'procedural', what: 'House level 4: home' },
  bed: { standIn: 'procedural', what: 'The bed' },
  workbench: { standIn: 'procedural', what: 'The Workbench' },
  'keepsake-shelf': { standIn: 'procedural', what: 'The keepsake shelf' },
  'journal-desk': { standIn: 'procedural', what: 'The journal desk' },
  // the island
  boat: { standIn: 'procedural', what: 'The boat that brings bloombot' },
  jetty: { standIn: 'procedural', what: 'The Landing\'s jetty' },
  'causeway-span': { standIn: 'procedural', what: 'A span of the Long Causeway' },
  'causeway-broken': { standIn: 'procedural', what: 'The Long Causeway\'s broken middle' },
  'sea-cliff': { standIn: 'skyline-cliff', what: 'Close-range sea cliffs in the north' },
  // machines
  reclaimer: { standIn: 'ac-unit', what: 'The Reclaimer (on a seam)' },
  'storage-chest': { standIn: 'crate', what: 'The Storage Chest' },
  // salvage piles (Scrap stays rubble-pile, crate, stone-block; Seeds stays broken-pot, stump)
  'salvage-copper': { standIn: 'copper-pipe', what: 'A Copper pile' },
  'salvage-driftwood': { standIn: 'barrel', what: 'A Timber (driftwood) pile' },
  'salvage-glass': { standIn: 'lantern', what: 'A Glass pile' },
  'salvage-clay': { standIn: 'planter-pot', what: 'A Clay pile' },
  'salvage-gears': { standIn: 'vent', what: 'A Gears pile' },
  'salvage-sunstone': { standIn: 'procedural', what: 'A Sunstone pile' },
  // gates and getting about
  barricade: { standIn: 'rubble-pile', what: 'A rubble barricade (Pry)' },
  'skybridge-collapsed': { standIn: 'procedural', what: 'The collapsed skybridge into Spire Heights (Climb)' },
  'bridge-broken': { standIn: 'procedural', what: 'The broken bridge to the Glasshouse Gardens' },
  'bridge-repaired': { standIn: 'procedural', what: 'The same bridge, repaired' },
  'lift-bridge': { standIn: 'procedural', what: 'The lock bridge to Clock Plaza' },
  'glide-perch': { standIn: 'procedural', what: 'A glide perch' },
  'tower-lift': { standIn: 'procedural', what: 'A tower lift' },
  'lookout-telescope': { standIn: 'procedural', what: 'A lookout\'s telescope' },
  // finds
  'cache-box': { standIn: 'crate', what: 'A cache' },
  'journal-page-post': { standIn: 'procedural', what: 'A journal page on its post' },
  // keepsakes
  'keepsake-tram-sign': { standIn: 'procedural', what: 'Keepsake: tram sign (Mast Row)' },
  'keepsake-scales': { standIn: 'procedural', what: 'Keepsake: scales (Old Market)' },
  'keepsake-ship-bell': { standIn: 'procedural', what: 'Keepsake: ship\'s bell (Saltwind Beach)' },
  'keepsake-acorn-lamp': { standIn: 'procedural', what: 'Keepsake: acorn lamp (Elder Grove)' },
  'keepsake-water-jug': { standIn: 'procedural', what: 'Keepsake: water jug (Cistern Basin)' },
  'keepsake-cuckoo-clock': { standIn: 'procedural', what: 'Keepsake: cuckoo clock (Clock Plaza)' },
  'keepsake-weathercock': { standIn: 'procedural', what: 'Keepsake: weathercock (The Terraces)' },
  'keepsake-terrarium': { standIn: 'procedural', what: 'Keepsake: terrarium (Glasshouse Gardens)' },
  'keepsake-orrery': { standIn: 'procedural', what: 'Keepsake: orrery (Observatory Hill)' },
  'keepsake-lift-dial': { standIn: 'procedural', what: 'Keepsake: lift dial (Spire Heights)' },
};

/** The model each gate kind is drawn with (names from MODEL_NAMES). */
export const GATE_MODELS: Record<GateKind, string> = { barricade: 'barricade', water: 'lift-bridge', lockBridge: 'lift-bridge', bridge: 'bridge-broken', climb: 'skybridge-collapsed', cliff: 'glide-perch' };
/** The model each new landmark kind is drawn with. */
export const OLD_LANDMARK_MODELS: Record<string, string> = { greenhouse: 'great-greenhouse', observatory: 'sky-observatory', spire: 'solar-spire' };
