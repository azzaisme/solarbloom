import { AREA_TYPES, CITY_GEN, PARK_LAYOUT, type TileFeature } from '../data/city';
import { ROOF_BY_ID } from '../data/rooftops';
import { TUNING } from '../data/tuning';
import { areaMapFor, PARK } from './Areas';
import { distToFootprintRaw } from './Footprint';
import { CHUNK, hashString, tileId, tileRandom } from './Hash';
import type { GroundState, LayerData, TileData } from './types';

export { CHUNK, hashString, tileId, tileRandom };

const inList = (list: readonly (readonly [number, number])[] | undefined, x: number, z: number) => !!list && list.some(([a, b]) => a === x && b === z);
const NET = hashString('network');

/** Is there a road (or canal) along this chunk row / column? Two tiles wide, seeded per row/column. */
export function roadRow(seed: number, cz: number) {
  return tileRandom(seed, NET, 0, cz, 1) < CITY_GEN.roadChance;
}
export function roadCol(seed: number, cx: number) {
  return tileRandom(seed, NET, cx, 0, 2) < CITY_GEN.roadChance;
}
export function canalRow(seed: number, cz: number) {
  return tileRandom(seed, NET, 0, cz, 3) < CITY_GEN.canalChance;
}

/** The starting state of one tile, before any play. `undefined` outside a bounded layer. */
export function generateTile(seed: number, layer: LayerData, x: number, z: number): TileData | undefined {
  if (layer.kind === 'ground') return generateGround(seed, layer, x, z);
  if (x < 0 || z < 0 || x >= layer.width || z >= layer.depth) return undefined;
  const lh = hashString(layer.id);
  const def = ROOF_BY_ID[layer.id];
  const prepared = inList(def?.prepared, x, z) || (!!def?.starterSolar && def.starterSolar[0] === x && def.starterSolar[1] === z);
  const blocked = inList(def?.blocked, x, z);
  const ground: GroundState = prepared ? 'prepared' : 'polluted';
  const { pollutionMin, pollutionMax } = TUNING.restore;
  return {
    id: tileId(layer.id, x, z),
    roofId: layer.id,
    x,
    z,
    ground,
    pollution: prepared ? 0 : Math.round(pollutionMin + (pollutionMax - pollutionMin) * tileRandom(seed, lh, x, z, 1)),
    variant: Math.floor(tileRandom(seed, lh, x, z, 2) * 10000),
    blocked,
    growthRemainingSec: 0,
    bloom: 0,
  };
}

/** The hand-made starting park: lawns, a path cross through the fountain, benches, a bandstand, a lamp. */
function generatePark(seed: number, lh: number, x: number, z: number): TileData {
  const L = PARK_LAYOUT;
  const prop = L.props.find((p) => p.at[0] === x && p.at[1] === z)?.prop;
  const path = L.paths.cols.includes(x) || L.paths.rows.includes(z);
  const prepared = L.prepared.some(([a, b]) => a === x && b === z) || (L.starterSolar[0] === x && L.starterSolar[1] === z);
  const { pollutionMin, pollutionMax } = TUNING.restore;
  return {
    id: tileId(GROUND_ID, x, z),
    roofId: GROUND_ID,
    x,
    z,
    ground: prepared ? 'prepared' : 'polluted',
    pollution: prepared ? 0 : Math.round(pollutionMin + (pollutionMax - pollutionMin) * tileRandom(seed, lh, x, z, 1)),
    variant: Math.floor(tileRandom(seed, lh, x, z, 2) * 10000),
    blocked: !!prop,
    feature: prop ? 'obstacle' : path ? 'paving' : 'lawn',
    prop,
    growthRemainingSec: 0,
    bloom: 0,
  };
}

const GROUND_ID = 'g';

/**
 * A city ground tile: its area's base material, the road and canal network running through (restorable into
 * green avenues and clean water, never walls), and a few small obstacles away from the landmark.
 * Pollution is heavier further from the park.
 */
function generateGround(seed: number, layer: LayerData, x: number, z: number): TileData {
  const lh = hashString(layer.id);
  const map = areaMapFor(seed);
  const cx = Math.floor(x / CHUNK);
  const cz = Math.floor(z / CHUNK);
  const lx = x - cx * CHUNK;
  const lz = z - cz * CHUNK;
  const area = map.info(map.areaOfChunk(cx, cz));
  if (area.id === PARK) return generatePark(seed, lh, x, z);
  const def = AREA_TYPES[area.type];
  let feature: TileFeature = def.ground;
  const park = area.id === PARK;
  // Footpaths cross parkland and plazas through the landmark chunk.
  if ((area.type === 'park' || area.type === 'plaza') && (lx === 3 || lz === 12)) feature = 'paving';
  if (!park) {
    if (roadRow(seed, cz) && (lz === 7 || lz === 8)) feature = 'road';
    if (roadCol(seed, cx) && (lx === 7 || lx === 8)) feature = 'road';
    if ((canalRow(seed, cz) || area.type === 'canal') && (lz === 3 || lz === 4)) feature = 'water';
  }
  const [mx, mz] = area.landmark;
  const nearLandmark = distToFootprintRaw(x, z, mx, mz, 2) <= CITY_GEN.landmarkClearance;
  const blocked = !nearLandmark && feature !== 'road' && feature !== 'water' && tileRandom(seed, lh, x, z, 5) < def.obstacles;
  if (blocked) feature = 'obstacle';
  const prop = blocked ? def.prop : undefined;
  const { pollutionMin, pollutionMax } = TUNING.restore;
  const lo = Math.max(pollutionMin, area.pollutionFloor);
  return {
    id: tileId(layer.id, x, z),
    roofId: layer.id,
    x,
    z,
    ground: 'polluted',
    pollution: Math.min(100, Math.round(lo + (Math.max(lo, pollutionMax) - lo) * tileRandom(seed, lh, x, z, 1))),
    variant: Math.floor(tileRandom(seed, lh, x, z, 2) * 10000),
    blocked,
    feature,
    prop,
    growthRemainingSec: 0,
    bloom: 0,
  };
}
