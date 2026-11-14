// The endless city: area types, district themes, landmarks and distance scaling. All data, no rules.

export type AreaType = 'park' | 'street' | 'plaza' | 'canal' | 'market' | 'reservoir' | 'grove';
export type Theme = 'oldtown' | 'docks' | 'towers' | 'parkland';
/** What a ground tile is made of (look + specialty hooks). Obstacles are blocked. */
export type TileFeature = 'lawn' | 'paving' | 'road' | 'water' | 'clay' | 'litter' | 'obstacle';

export interface AreaTypeDef {
  type: AreaType;
  name: string;
  icon: string;
  /** base ground material */
  ground: TileFeature;
  /** share of tiles that are small obstacles (stumps, stalls, pillars…) */
  obstacles: number;
  obstacleName: string;
  landmark: { kind: string; name: string };
  /** how much rarer/commoner it is in each district theme */
  weights: Record<Theme, number>;
}

export const AREA_TYPES: Record<AreaType, AreaTypeDef> = {
  park: { type: 'park', name: 'Parkland', icon: '🌳', ground: 'lawn', obstacles: 0.04, obstacleName: 'old stump', landmark: { kind: 'fountain', name: 'Dry Fountain' }, weights: { oldtown: 2, docks: 1, towers: 2, parkland: 6 } },
  street: { type: 'street', name: 'Street', icon: '🛣️', ground: 'paving', obstacles: 0.03, obstacleName: 'rusty bollard', landmark: { kind: 'mast', name: 'Signal Mast' }, weights: { oldtown: 4, docks: 3, towers: 5, parkland: 2 } },
  plaza: { type: 'plaza', name: 'Plaza', icon: '⛲', ground: 'paving', obstacles: 0.05, obstacleName: 'cracked pillar', landmark: { kind: 'clock', name: 'Clock Tower' }, weights: { oldtown: 4, docks: 1, towers: 3, parkland: 1 } },
  canal: { type: 'canal', name: 'Canal', icon: '🛶', ground: 'paving', obstacles: 0.02, obstacleName: 'mooring post', landmark: { kind: 'lock', name: 'Lock Gate' }, weights: { oldtown: 1, docks: 6, towers: 1, parkland: 2 } },
  market: { type: 'market', name: 'Market', icon: '🧺', ground: 'paving', obstacles: 0.08, obstacleName: 'broken stall', landmark: { kind: 'hall', name: 'Market Hall' }, weights: { oldtown: 3, docks: 3, towers: 1, parkland: 1 } },
  reservoir: { type: 'reservoir', name: 'Reservoir', icon: '💧', ground: 'clay', obstacles: 0.03, obstacleName: 'dry drain', landmark: { kind: 'cistern', name: 'Old Cistern' }, weights: { oldtown: 1, docks: 2, towers: 1, parkland: 2 } },
  grove: { type: 'grove', name: 'Grove', icon: '🍂', ground: 'litter', obstacles: 0.06, obstacleName: 'dead stump', landmark: { kind: 'elder', name: 'Elder Tree' }, weights: { oldtown: 1, docks: 1, towers: 1, parkland: 4 } },
};

export const AREA_TYPE_LIST = Object.keys(AREA_TYPES) as AreaType[];
export const THEMES: Theme[] = ['oldtown', 'docks', 'towers', 'parkland'];

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
  /** Further out, one authored landmark every this many chunks of distance. */
  authoredEvery: 10,
  /** Difficulty with distance (chunks): pulse cost multiplier and pollution floor, both capped. */
  difficulty: { perChunk: 0.04, max: 2, pollutionPerChunk: 1.5, pollutionFloorMax: 85 },
};
