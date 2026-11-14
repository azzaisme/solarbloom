// The endless city: area types, district themes, landmarks and distance scaling. All data, no rules.

export type AreaType = 'park' | 'street' | 'plaza' | 'canal' | 'market' | 'reservoir' | 'grove' | 'rooftops';
export type Theme = 'oldtown' | 'docks' | 'towers' | 'parkland';
/** What a ground tile is made of (look + specialty hooks). Obstacles are blocked. */
export type TileFeature = 'lawn' | 'paving' | 'road' | 'water' | 'clay' | 'litter' | 'obstacle' | 'building';

export interface AreaTypeDef {
  type: AreaType;
  name: string;
  icon: string;
  /** base ground material */
  ground: TileFeature;
  /** share of tiles that are small obstacles (stumps, stalls, pillars…) */
  obstacles: number;
  obstacleName: string;
  /** renderer prop for its obstacles */
  prop: string;
  landmark: { kind: string; name: string };
  /** how much rarer/commoner it is in each district theme */
  weights: Record<Theme, number>;
}

export const AREA_TYPES: Record<AreaType, AreaTypeDef> = {
  park: { type: 'park', prop: 'stump', name: 'Parkland', icon: '🌳', ground: 'lawn', obstacles: 0.04, obstacleName: 'old stump', landmark: { kind: 'fountain', name: 'Dry Fountain' }, weights: { oldtown: 2, docks: 1, towers: 2, parkland: 6 } },
  street: { type: 'street', prop: 'bollard', name: 'Street', icon: '🛣️', ground: 'paving', obstacles: 0.03, obstacleName: 'rusty bollard', landmark: { kind: 'mast', name: 'Signal Mast' }, weights: { oldtown: 4, docks: 3, towers: 5, parkland: 2 } },
  plaza: { type: 'plaza', prop: 'pillar', name: 'Plaza', icon: '⛲', ground: 'paving', obstacles: 0.05, obstacleName: 'cracked pillar', landmark: { kind: 'clock', name: 'Clock Tower' }, weights: { oldtown: 4, docks: 1, towers: 3, parkland: 1 } },
  canal: { type: 'canal', prop: 'post', name: 'Canal', icon: '🛶', ground: 'paving', obstacles: 0.02, obstacleName: 'mooring post', landmark: { kind: 'lock', name: 'Lock Gate' }, weights: { oldtown: 1, docks: 6, towers: 1, parkland: 2 } },
  market: { type: 'market', prop: 'stall', name: 'Market', icon: '🧺', ground: 'paving', obstacles: 0.08, obstacleName: 'broken stall', landmark: { kind: 'hall', name: 'Market Hall' }, weights: { oldtown: 3, docks: 3, towers: 1, parkland: 1 } },
  reservoir: { type: 'reservoir', prop: 'drain', name: 'Reservoir', icon: '💧', ground: 'clay', obstacles: 0.03, obstacleName: 'dry drain', landmark: { kind: 'cistern', name: 'Old Cistern' }, weights: { oldtown: 1, docks: 2, towers: 1, parkland: 2 } },
  // City 12.1: never picked by weight; a few streets, plazas and markets become rooftop clusters (CITY_GEN.rooftops).
  rooftops: { type: 'rooftops', prop: 'bollard', name: 'Rooftops', icon: '🏢', ground: 'paving', obstacles: 0.03, obstacleName: 'rusty bollard', landmark: { kind: 'crystal', name: 'Rooftop Core' }, weights: { oldtown: 0, docks: 0, towers: 0, parkland: 0 } },
  grove: { type: 'grove', prop: 'stump', name: 'Grove', icon: '🍂', ground: 'litter', obstacles: 0.06, obstacleName: 'dead stump', landmark: { kind: 'elder', name: 'Elder Tree' }, weights: { oldtown: 1, docks: 1, towers: 1, parkland: 4 } },
};

/** Types picked by weight (rooftop clusters are placed separately). */
export const AREA_TYPE_LIST: AreaType[] = (Object.keys(AREA_TYPES) as AreaType[]).filter((t) => t !== 'rooftops');
export const THEMES: Theme[] = ['oldtown', 'docks', 'towers', 'parkland'];

/**
 * The starting park, hand-made (chunk 0,0; cells are park-local = ground cells). The fountain is its landmark
 * (from Areas: cell 7,7, 2×2). Paths cross at the fountain; props are obstacles with names for the renderer.
 */
export const PARK_LAYOUT = {
  paths: { cols: [7, 8], rows: [7, 8] },
  props: [
    { at: [3, 6], prop: 'bench' },
    { at: [12, 6], prop: 'bench' },
    { at: [3, 9], prop: 'bench' },
    { at: [12, 9], prop: 'bench' },
    { at: [11, 2], prop: 'bandstand' },
    { at: [12, 2], prop: 'bandstand' },
    { at: [11, 3], prop: 'bandstand' },
    { at: [12, 3], prop: 'bandstand' },
    { at: [4, 12], prop: 'lamp' },
    { at: [1, 1], prop: 'barrel' },
  ] as { at: [number, number]; prop: string }[],
  starterSolar: [5, 5] as [number, number],
  prepared: [
    [6, 5],
    [5, 6],
    [6, 6],
  ] as [number, number][],
};

export const CITY_GEN = {
  /** district themes are chosen per region of this many chunks */
  districtChunks: 6,
  /** a row/column of chunks has a road through it with this chance (two tiles wide) */
  roadChance: 0.35,
  canalChance: 0.12,
  /** obstacles never sit this close (Manhattan) to a landmark */
  landmarkClearance: 2,
  /** Rare authored landmarks at these distances (chunks from the park), one per band. */
  authored: [
    { distance: 6, kind: 'greenhouse', name: 'Great Greenhouse' },
    { distance: 12, kind: 'cathedral', name: 'Solar Cathedral' },
    { distance: 20, kind: 'observatory', name: 'Sky Observatory' },
  ],
  /**
   * City 12.1 (generation 3): rooftop clusters. This share of streets, plazas and markets at least `minDistance`
   * chunks out carry a raised rooftop (one of the old campaign's layouts) whose Core is the area's landmark.
   */
  rooftops: { chance: 0.14, minDistance: 2, from: ['street', 'plaza', 'market'], templates: ['r1', 'r2', 'r3'], height: 2.6 },
  /** Further out, one authored landmark every this many chunks of distance. */
  authoredEvery: 10,
  /**
   * Buildings (generation 2): the chance each quarter of a chunk holds one, by area type, and storeys by district.
   * They stand on the quarter's outer corner, clear of roads, canals, footpaths and landmarks.
   */
  buildings: {
    chance: { park: 0.1, street: 0.6, plaza: 0.35, canal: 0.45, market: 0.5, reservoir: 0.12, grove: 0.08, rooftops: 0.4 } as Record<string, number>,
    storeys: { oldtown: [2, 4], docks: [1, 3], towers: [3, 6], parkland: [1, 2] } as Record<string, [number, number]>,
    /** height of one storey in world units */
    storey: 0.42,
  },
  /** Difficulty with distance (chunks): pulse cost multiplier and pollution floor, both capped. */
  difficulty: { perChunk: 0.04, max: 2, pollutionPerChunk: 1.5, pollutionFloorMax: 85 },
};
