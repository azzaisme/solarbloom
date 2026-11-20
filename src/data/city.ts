// The endless city: area types, district themes, landmarks and distance scaling. All data, no rules.

export type AreaType = 'park' | 'street' | 'plaza' | 'market' | 'reservoir' | 'grove' | 'rooftops' | 'beach' | 'downtown';
export type Theme = 'oldtown' | 'docks' | 'towers' | 'parkland';
/** What a ground tile is made of (look + specialty hooks). Obstacles are blocked. */
export type TileFeature = 'lawn' | 'paving' | 'road' | 'water' | 'clay' | 'litter' | 'obstacle' | 'building' | 'sand';

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
  market: { type: 'market', prop: 'stall', name: 'Market', icon: '🧺', ground: 'paving', obstacles: 0.08, obstacleName: 'broken stall', landmark: { kind: 'hall', name: 'Market Hall' }, weights: { oldtown: 3, docks: 3, towers: 1, parkland: 1 } },
  reservoir: { type: 'reservoir', prop: 'drain', name: 'Reservoir', icon: '💧', ground: 'clay', obstacles: 0.03, obstacleName: 'dry drain', landmark: { kind: 'cistern', name: 'Old Cistern' }, weights: { oldtown: 1, docks: 2, towers: 1, parkland: 2 } },
  // City 12.1: never picked by weight; a few streets, plazas and markets become rooftop clusters (CITY_GEN.rooftops).
  rooftops: { type: 'rooftops', prop: 'bollard', name: 'Rooftops', icon: '🏢', ground: 'paving', obstacles: 0.03, obstacleName: 'rusty bollard', landmark: { kind: 'crystal', name: 'Rooftop Core' }, weights: { oldtown: 0, docks: 0, towers: 0, parkland: 0 } },
  grove: { type: 'grove', prop: 'stump', name: 'Grove', icon: '🍂', ground: 'litter', obstacles: 0.06, obstacleName: 'dead stump', landmark: { kind: 'elder', name: 'Elder Tree' }, weights: { oldtown: 1, docks: 1, towers: 1, parkland: 4 } },
  // E21.4: the Old City's beach (Saltwind Beach). Never picked by weight: only the Old City lays it out.
  // E21.25: the Old City's downtown (Spire Heights). Never picked by weight.
  downtown: { type: 'downtown', prop: 'pillar', name: 'Downtown', icon: '🏙️', ground: 'paving', obstacles: 0.03, obstacleName: 'fallen girder', landmark: { kind: 'spire', name: 'Solar Spire' }, weights: { oldtown: 0, docks: 0, towers: 0, parkland: 0 } },
  beach: { type: 'beach', prop: 'post', name: 'Beach', icon: '🌊', ground: 'sand', obstacles: 0.03, obstacleName: 'driftwood', landmark: { kind: 'sealock', name: 'The Sea Lock' }, weights: { oldtown: 0, docks: 0, towers: 0, parkland: 0 } },
};

/** Types picked by weight (rooftop clusters are placed separately). */
export const AREA_TYPE_LIST: AreaType[] = (Object.keys(AREA_TYPES) as AreaType[]).filter((t) => t !== 'rooftops' && t !== 'beach' && t !== 'downtown');
export const THEMES: Theme[] = ['oldtown', 'docks', 'towers', 'parkland'];

/**
 * The starting park, hand-made (chunk 0,0; cells are park-local = ground cells). The fountain is its landmark
 * (from Areas: cell 7,7, 2×2). A round plaza circles the fountain and winding paths lead from it to the four
 * gates (`parkPath`); props are obstacles with names for the renderer.
 */
export const PARK_LAYOUT = {
  /** The park's gates: its paths meet the edge at these columns (north, south) and rows (west, east); avenues carry on from them. */
  paths: { cols: [7, 8], rows: [7, 8] },
  /** The round plaza about the fountain: paved out to this many tiles from the park's centre. */
  plaza: { centre: [8, 8] as [number, number], radius: 2.7 },
  /**
   * The winding paths from the plaza to the gates: each a curve from `from` to `to` bending towards `via`
   * (a quadratic Bézier, in tile units), paved `width` tiles wide. The west path runs straight under the pergola.
   */
  walks: [
    { from: [8, 5.6], via: [12, 2.6], to: [8, 0] },
    { from: [10.4, 8], via: [13.4, 12], to: [16, 8] },
    { from: [8, 10.4], via: [4, 13.4], to: [8, 16] },
    { from: [5.6, 8], via: [2.8, 8], to: [0, 8] },
  ] as { from: [number, number]; via: [number, number]; to: [number, number] }[],
  walkWidth: 1.9,
  props: [
    { at: [3, 6], prop: 'bench' },
    { at: [10, 6], prop: 'bench' },
    { at: [5, 9], prop: 'bench' },
    { at: [9, 10], prop: 'bench' },
    { at: [11, 2], prop: 'bandstand' },
    { at: [12, 2], prop: 'bandstand' },
    { at: [11, 3], prop: 'bandstand' },
    { at: [12, 3], prop: 'bandstand' },
    { at: [4, 12], prop: 'lamp' },
    { at: [1, 1], prop: 'barrel' },
  ] as { at: [number, number]; prop: string }[],
  /** The pond: restorable water tiles (a silted bed until restored), sunk below the lawn with rounded banks. */
  pond: [
    [1, 10], [2, 10], [3, 10],
    [1, 11], [2, 11], [3, 11],
    [1, 12], [2, 12], [3, 12],
    [1, 13], [2, 13], [3, 13],
  ] as [number, number][],
  /** Flower canopies: pergolas over stretches of path (looks only; the tiles under them stay open). */
  pergolas: [{ x: 2, z: 7, w: 4, d: 2 }] as { x: number; z: number; w: number; d: number }[],
  starterSolar: [5, 5] as [number, number],
  prepared: [
    [6, 5],
    [5, 6],
    [4, 5],
  ] as [number, number][],
};

const walkTiles = new Set<number>();
/** Is this park cell paved: the round plaza, or within half a path's width of one of the winding walks? */
export function parkPath(x: number, z: number): boolean {
  if (x < 0 || z < 0 || x > 15 || z > 15) return false;
  if (!walkTiles.size) {
    const L = PARK_LAYOUT;
    const half = L.walkWidth / 2;
    for (let cz = 0; cz < 16; cz++)
      for (let cx = 0; cx < 16; cx++) {
        const px = cx + 0.5;
        const pz = cz + 0.5;
        let on = Math.hypot(px - L.plaza.centre[0], pz - L.plaza.centre[1]) < L.plaza.radius;
        for (const w of L.walks) {
          if (on) break;
          for (let i = 0; i <= 48 && !on; i++) {
            const t = i / 48;
            const bx = (1 - t) * (1 - t) * w.from[0] + 2 * t * (1 - t) * w.via[0] + t * t * w.to[0];
            const bz = (1 - t) * (1 - t) * w.from[1] + 2 * t * (1 - t) * w.via[1] + t * t * w.to[1];
            if (Math.hypot(px - bx, pz - bz) < half) on = true;
          }
        }
        if (on) walkTiles.add(cz * 16 + cx);
      }
  }
  return walkTiles.has(z * 16 + x);
}

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
  rooftops: { chance: 0.14, minDistance: 2, from: ['street', 'plaza', 'market'], templates: ['seed', 'reservoir', 'canopy'], height: 2.6 },
  /** Further out, one authored landmark every this many chunks of distance. */
  authoredEvery: 10,
  /**
   * Buildings (generation 2): the chance each quarter of a chunk holds one, by area type, and storeys by district.
   * One or two storeys draws as a house (pitched roof), six and up as a skyscraper (the towers district).
   * They stand on the quarter's outer corner, clear of roads, canals, footpaths and landmarks.
   */
  buildings: {
    chance: { park: 0.1, street: 0.6, plaza: 0.35, market: 0.5, reservoir: 0.12, grove: 0.08, rooftops: 0.4, beach: 0.05, downtown: 0.7 } as Record<string, number>,
    storeys: { oldtown: [2, 4], docks: [1, 3], towers: [7, 14], parkland: [1, 2] } as Record<string, [number, number]>,
    /** height of one storey in world units */
    storey: 0.42,
  },
  /**
   * City 16 (generation 4): the road network, planned on the area graph. See docs/design/roads.md.
   * - arterials: four avenues out of the park (chunk row/column 0), a square ring at `ring` chunks, and a jittered
   *   lattice every `districtChunks`; a lattice row segment drops with `latticeDrop` (columns never do).
   * - streets link neighbouring areas: always to the parent (one chunk step closer to the park, so every area
   *   reaches the park), plus extra links with the theme's chance, up to `maxLinks` per area.
   * - lanes: a link between two `laneTypes` areas is a 1-tile paved footpath.
   * Gates sit on a shared chunk edge, tiles `gateRange` (chunk-local, inclusive).
   */
  roads: {
    width: { arterial: 3, street: 2, lane: 1 },
    avenueLane: 6,
    ring: 3,
    latticeDrop: 0.25,
    extraChance: { oldtown: 0.45, docks: 0.3, towers: 0.55, parkland: 0.15 } as Record<Theme, number>,
    maxLinks: 4,
    laneTypes: ['park', 'grove'] as AreaType[],
    gateRange: [5, 10] as [number, number],
    /** routing style inside an area (City 16.4) */
    style: { street: 'grid', market: 'grid', rooftops: 'grid', plaza: 'ring', park: 'curve', grove: 'curve', canal: 'waterside', reservoir: 'skirt', beach: 'curve', downtown: 'grid' } as Record<AreaType, 'grid' | 'ring' | 'curve' | 'waterside' | 'skirt'>,
  },
  /** Difficulty with distance (chunks): pulse cost multiplier and pollution floor, both capped. */
  difficulty: { perChunk: 0.04, max: 2, pollutionPerChunk: 1.5, pollutionFloorMax: 85 },
};
