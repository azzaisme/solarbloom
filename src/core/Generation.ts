import { AREA_TYPES, CITY_GEN, PARK_LAYOUT, type TileFeature } from '../data/city';
import { ROOF_TEMPLATES } from '../data/templates';
import { TUNING } from '../data/tuning';
import { areaMapFor, genKey, PARK, type AreaInfo } from './Areas';
import { canalRow, roadCol, roadRow } from './Arterials';
import { distToFootprintRaw } from './Footprint';
import { roadPlanFor } from './RoadPlan';
import { CHUNK, hashString, tileId, tileRandom } from './Hash';
import type { GroundState, LayerData, TileData } from './types';

export { CHUNK, hashString, tileId, tileRandom };
export { canalRow, roadCol, roadRow };

const inList = (list: readonly (readonly [number, number])[] | undefined, x: number, z: number) => !!list && list.some(([a, b]) => a === x && b === z);
/** The starting state of one tile, before any play. `undefined` outside a bounded layer. */
export function generateTile(seed: number, layer: LayerData, x: number, z: number): TileData | undefined {
  if (layer.kind === 'ground') return generateGround(seed, layer, x, z);
  if (x < 0 || z < 0 || x >= layer.width || z >= layer.depth) return undefined;
  const lh = hashString(layer.id);
  const def = layer.template ? ROOF_TEMPLATES[layer.template] : undefined;
  const prepared = inList(def?.prepared, x, z);
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
    feature: prop ? 'obstacle' : path ? 'paving' : inList(L.pond, x, z) ? 'water' : 'lawn',
    prop,
    growthRemainingSec: 0,
    bloom: 0,
  };
}

const GROUND_ID = 'g';

export interface BuildingPlot {
  /** world tile of its north-west corner, and its footprint */
  x: number;
  z: number;
  w: number;
  d: number;
  storeys: number;
  /** look variant (0–9) */
  style: number;
}

const plotCache = new Map<string, BuildingPlot[]>();

/**
 * The buildings of one ground chunk (generation 2): at most one per quarter, on the quarter's outer corner,
 * never on roads, canals, footpaths or near the landmark, and never in the park. A pure function of the seed.
 */
export function buildingPlots(seed: number, cx: number, cz: number, gen = 2): BuildingPlot[] {
  const key = `${seed}|${cx}|${cz}|${genKey(gen)}`;
  const hit = plotCache.get(key);
  if (hit) return hit;
  const out: BuildingPlot[] = [];
  const map = areaMapFor(seed, gen);
  const area = map.info(map.areaOfChunk(cx, cz));
  if (area.id !== PARK && gen >= 4) out.push(...roadPlots(seed, cx, cz, area));
  else if (area.id !== PARK) {
    const B = CITY_GEN.buildings;
    const lh = hashString('buildings');
    const road = { row: roadRow(seed, cz), col: roadCol(seed, cx), canal: canalRow(seed, cz) || area.type === 'canal' };
    const path = area.type === 'park' || area.type === 'plaza';
    const [mx, mz] = area.landmark;
    const [lo, hi] = B.storeys[area.theme] ?? [1, 3];
    for (const [qx, qz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const r = (salt: number) => tileRandom(seed, lh, cx * 2 + qx, cz * 2 + qz, salt);
      if (r(1) >= (B.chance[area.type] ?? 0)) continue;
      const w = 2 + Math.floor(r(2) * 3);
      const d = 2 + Math.floor(r(3) * 3);
      // Outer corner of the quarter (quarters are 0–6 and 9–15, leaving room for the road cross).
      const lx0 = qx === 0 ? 0 : CHUNK - w;
      const lz0 = qz === 0 ? 0 : CHUNK - d;
      const x = cx * CHUNK + lx0;
      const z = cz * CHUNK + lz0;
      let ok = true;
      for (let lz = lz0; lz < lz0 + d && ok; lz++)
        for (let lx = lx0; lx < lx0 + w && ok; lx++) {
          if (road.row && (lz === 7 || lz === 8)) ok = false;
          if (road.col && (lx === 7 || lx === 8)) ok = false;
          if (road.canal && (lz === 3 || lz === 4)) ok = false;
          if (path && (lx === 3 || lz === 12)) ok = false;
          if (distToFootprintRaw(cx * CHUNK + lx, cz * CHUNK + lz, mx, mz, 2) <= CITY_GEN.landmarkClearance + 1) ok = false;
          if (map.underRoof(area.id, cx * CHUNK + lx, cz * CHUNK + lz)) ok = false; // the cluster's own building
        }
      if (!ok) continue;
      out.push({ x, z, w, d, storeys: lo + Math.floor(r(4) * (hi - lo + 1)), style: Math.floor(r(5) * 10) });
    }
  }
  if (plotCache.size > 4096) plotCache.clear();
  plotCache.set(key, out);
  return out;
}

/**
 * City 16.5 (generation 4): at most one building per quarter, placed on the first spot (from the quarter's outer
 * corner inward) that keeps off roads, lanes, canals, the landmark and any rooftop, preferring a spot that fronts a
 * road. Buildings fronting an arterial get a storey more (a taller skyline along main roads).
 */
function roadPlots(seed: number, cx: number, cz: number, area: AreaInfo): BuildingPlot[] {
  const out: BuildingPlot[] = [];
  const plan = roadPlanFor(seed, 4);
  const map = plan.map;
  const B = CITY_GEN.buildings;
  const lh = hashString('buildings');
  const [mx, mz] = area.landmark;
  const [lo, hi] = B.storeys[area.theme] ?? [1, 3];
  const canal = canalRow(seed, cz) || area.type === 'canal';
  const H = CHUNK / 2;
  const clear = (x: number, z: number) => {
    const lz = z - cz * CHUNK;
    if (plan.roadAt(x, z) || (canal && (lz === 3 || lz === 4))) return false;
    if (distToFootprintRaw(x, z, mx, mz, 2) <= CITY_GEN.landmarkClearance + 1) return false;
    return !map.underRoof(area.id, x, z);
  };
  for (const [qx, qz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const r = (salt: number) => tileRandom(seed, lh, cx * 2 + qx, cz * 2 + qz, salt);
    if (r(1) >= (B.chance[area.type] ?? 0)) continue;
    const w = 2 + Math.floor(r(2) * 3);
    const d = 2 + Math.floor(r(3) * 3);
    let best: { x: number; z: number; score: number; arterial: boolean } | undefined;
    for (let sz = 0; sz <= H - d; sz++)
      for (let sx = 0; sx <= H - w; sx++) {
        const lx0 = qx === 0 ? sx : CHUNK - w - sx;
        const lz0 = qz === 0 ? sz : CHUNK - d - sz;
        const x = cx * CHUNK + lx0;
        const z = cz * CHUNK + lz0;
        let ok = true;
        for (let j = 0; j < d && ok; j++) for (let i = 0; i < w && ok; i++) if (!clear(x + i, z + j)) ok = false;
        if (!ok) continue;
        // Does it front a road (a road cell right beside its footprint)?
        let fronts = false;
        let arterial = false;
        for (let i = -1; i <= w; i++)
          for (let j = -1; j <= d; j++) {
            if ((i >= 0 && i < w && j >= 0 && j < d) || ((i < 0 || i >= w) && (j < 0 || j >= d))) continue;
            const rc = plan.roadAt(x + i, z + j);
            if (!rc) continue;
            fronts = true;
            if (rc.tier === 'arterial') arterial = true;
          }
        const score = sx + sz - (fronts ? 12 : 0); // fronting a road beats any setback inside the quarter
        if (!best || score < best.score) best = { x, z, score, arterial };
      }
    if (!best) continue;
    const storeys = Math.min(hi + 1, lo + Math.floor(r(4) * (hi - lo + 1)) + (best.arterial ? 1 : 0));
    out.push({ x: best.x, z: best.z, w, d, storeys, style: Math.floor(r(5) * 10) });
  }
  return out;
}

/** The building standing on a tile (generation 2), if any. */
export function buildingAt(seed: number, x: number, z: number, gen = 2): BuildingPlot | undefined {
  const cx = Math.floor(x / CHUNK);
  const cz = Math.floor(z / CHUNK);
  return buildingPlots(seed, cx, cz, gen).find((b) => x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d);
}

/**
 * A city ground tile: its area's base material, the road and canal network running through (restorable into
 * green avenues and clean water, never walls), and a few small obstacles away from the landmark.
 * Pollution is heavier further from the park.
 */
function generateGround(seed: number, layer: LayerData, x: number, z: number): TileData {
  const lh = hashString(layer.id);
  const map = areaMapFor(seed, layer.gen ?? 1);
  const cx = Math.floor(x / CHUNK);
  const cz = Math.floor(z / CHUNK);
  const lx = x - cx * CHUNK;
  const lz = z - cz * CHUNK;
  const area = map.info(map.areaOfChunk(cx, cz));
  if (area.id === PARK) return generatePark(seed, lh, x, z);
  const def = AREA_TYPES[area.type];
  let feature: TileFeature = def.ground;
  const park = area.id === PARK;
  const gen = layer.gen ?? 1;
  // Generation 4 (City 16): the planned road network. Streets and arterials are road; lanes are paved footpaths;
  // a road over a canal is a bridge (still road). Older generations keep their row/column lattice and footpaths.
  const onRoad = gen >= 4 ? roadPlanFor(seed, 4).roadAt(x, z) : undefined;
  if (gen >= 4) {
    if ((canalRow(seed, cz) || area.type === 'canal') && (lz === 3 || lz === 4)) feature = 'water';
    if (onRoad) feature = onRoad.tier === 'lane' ? 'paving' : 'road';
  } else {
    // Footpaths cross parkland and plazas through the landmark chunk.
    if ((area.type === 'park' || area.type === 'plaza') && (lx === 3 || lz === 12)) feature = 'paving';
    if (!park) {
      if (roadRow(seed, cz) && (lz === 7 || lz === 8)) feature = 'road';
      if (roadCol(seed, cx) && (lx === 7 || lx === 8)) feature = 'road';
      if ((canalRow(seed, cz) || area.type === 'canal') && (lz === 3 || lz === 4)) feature = 'water';
    }
  }
  const [mx, mz] = area.landmark;
  const nearLandmark = distToFootprintRaw(x, z, mx, mz, 2) <= CITY_GEN.landmarkClearance;
  // Generation 3: a rooftop cluster's ground under its roof is the building that holds it up.
  const building = ((layer.gen ?? 1) >= 2 && !!buildingAt(seed, x, z, layer.gen ?? 1)) || ((layer.gen ?? 1) >= 3 && feature !== 'road' && feature !== 'water' && map.underRoof(area.id, x, z)); // roads and canals run on underneath
  const blocked = building || (!nearLandmark && !onRoad && feature !== 'road' && feature !== 'water' && tileRandom(seed, lh, x, z, 5) < def.obstacles);
  if (building) feature = 'building';
  else if (blocked) feature = 'obstacle';
  const prop = building ? 'building' : blocked ? def.prop : undefined;
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
