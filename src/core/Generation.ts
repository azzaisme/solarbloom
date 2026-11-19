import { AREA_TYPES, CITY_GEN, PARK_LAYOUT, parkPath, type TileFeature } from '../data/city';
import { ROOF_TEMPLATES } from '../data/templates';
import { TUNING } from '../data/tuning';
import { areaMapFor, genKey, PARK, SEA, type AreaInfo } from './Areas';
import { canalRow } from './Arterials';
import { distToFootprintRaw } from './Footprint';
import { roadPlanFor } from './RoadPlan';
import { coastSand, inRect, isSeaChunk, onJetty, regionById, regionWater, seaCell, setPieceAt } from './OldCityLayout';
import { rampAt, tileLevel } from './Height';
import { causewayBroken, mainlandWater, onCauseway } from './Mainland';
import { OLD_CITY } from '../data/oldcity';
import { CHUNK, hashString, tileId, tileRandom } from './Hash';
import type { GroundState, LayerData, TileData } from './types';

export { CHUNK, hashString, tileId, tileRandom };
export { canalRow };

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

/**
 * E21 (generation 5): the Old City's set pieces stamped over generated ground: salvage piles, Keepers, gates and
 * the ruined shed stand on their tile (blocked, with a prop the renderer draws). Pure: the layout never changes.
 */
export function stampOldCity(t: TileData): TileData {
  // E21.24: the terrace height (every Old City tile has one)
  t.level = tileLevel(t.x, t.z);
  if (rampAt(t.x, t.z)) t.ramp = true;
  const p = setPieceAt(t.x, t.z);
  if (!p) return t;
  if (p.kind === 'pile') return Object.assign(t, { blocked: true, feature: 'obstacle', prop: `pile:${p.pile.id}` });
  if (p.kind === 'keeper') return Object.assign(t, { blocked: true, feature: t.feature === 'water' ? 'paving' : t.feature, prop: `keeper:${p.keeper.id}` });
  // E23.8.3.2: the industrial ruins round a steel field: frames and gantry legs block, stains are on the ground
  if (p.kind === 'ruin') {
    const q = p.ruin;
    const solid = q.kind !== 'stain';
    return Object.assign(t, { blocked: solid || t.blocked, feature: solid ? 'obstacle' : t.feature, prop: `ruin:${q.kind}:${q.turn}:${q.part ?? ''}:${q.span ?? 0}` });
  }
  if (p.kind === 'shed') return Object.assign(t, { blocked: true, feature: 'obstacle', prop: 'shed' });
  // E21.24: a lookout: a bench and a telescope on a terrace's edge
  if (p.kind === 'lookout') return Object.assign(t, { blocked: true, feature: t.feature === 'water' ? 'paving' : t.feature, prop: `lookout:${p.id}` });
  // E23.9.1: a page of the maker's journal, pinned to a post
  if (p.kind === 'page') return Object.assign(t, { blocked: true, feature: t.feature === 'water' ? 'paving' : t.feature, prop: `page:${p.id}` });
  if (p.kind === 'gate') {
    const g = p.gate;
    if (g.kind === 'barricade') return Object.assign(t, { blocked: true, feature: 'obstacle', prop: `gate:${g.id}` });
    if (g.kind === 'water' || g.kind === 'lockBridge') return Object.assign(t, { blocked: false, feature: 'water', prop: `gate:${g.id}` });
    if (g.kind === 'bridge') return Object.assign(t, { blocked: true, feature: 'obstacle', prop: `gate:${g.id}` });
  }
  return t;
}

/** The hand-made starting park: lawns, a round plaza about the fountain, winding paths, benches, a bandstand, a lamp. */
function generatePark(seed: number, lh: number, x: number, z: number, gen = GROUND_GEN_CLASSIC): TileData {
  const L = PARK_LAYOUT;
  const prop = L.props.find((p) => p.at[0] === x && p.at[1] === z)?.prop;
  const path = parkPath(x, z);
  const prepared = L.prepared.some(([a, b]) => a === x && b === z) || (L.starterSolar[0] === x && L.starterSolar[1] === z);
  const { pollutionMin, pollutionMax } = TUNING.restore;
  const t: TileData = {
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
  return gen >= OLD_CITY_GEN_ID ? stampOldCity(t) : t;
}

/** Ground generations: 4 is the city ground; 5 is the Old City laid over it (core/GameState OLD_CITY_GEN). */
const GROUND_GEN_CLASSIC = 4;
const OLD_CITY_GEN_ID = 5;

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
 * The buildings of one ground chunk: the Old City's own (generation 5), else the city generator's along its roads
 * (generation 4), never in the park. A pure function of the seed.
 */
export function buildingPlots(seed: number, cx: number, cz: number, gen = 4): BuildingPlot[] {
  const key = `${seed}|${cx}|${cz}|${genKey(gen)}`;
  const hit = plotCache.get(key);
  if (hit) return hit;
  const out: BuildingPlot[] = [];
  const map = areaMapFor(seed, gen);
  const area = map.info(map.areaOfChunk(cx, cz));
  if (genKey(gen) === 5) out.push(...oldCityPlots(seed, cx, cz, area));
  else if (area.id !== PARK) out.push(...roadPlots(seed, cx, cz, area));
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
  const canal = canalRow(seed, cz);
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
  const lz = z - cz * CHUNK;
  const area = map.info(map.areaOfChunk(cx, cz));
  if (area.id === PARK) return generatePark(seed, lh, x, z, layer.gen ?? 1);
  if (genKey(layer.gen ?? 1) === 5) return generateOldCity(seed, layer, lh, x, z, area);
  const def = AREA_TYPES[area.type];
  let feature: TileFeature = def.ground;
  // Generation 4 (City 16): the planned road network. Streets and arterials are road; lanes are paved footpaths;
  // a road over a canal is a bridge (still road).
  const onRoad = roadPlanFor(seed, 4).roadAt(x, z);
  if (canalRow(seed, cz) && (lz === 3 || lz === 4)) feature = 'water';
  if (onRoad) feature = onRoad.tier === 'lane' ? 'paving' : 'road';
  const [mx, mz] = area.landmark;
  const nearLandmark = distToFootprintRaw(x, z, mx, mz, 2) <= CITY_GEN.landmarkClearance;
  // A rooftop's ground under its roof is the building that holds it up.
  const building = !!buildingAt(seed, x, z, layer.gen ?? 4) || (feature !== 'road' && feature !== 'water' && map.underRoof(area.id, x, z)); // roads and canals run on underneath
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

// ───────────── E21.4: the Old City (generation 5) ─────────────

/**
 * The Old City is one fixed city: its buildings and obstacles come from this constant, never from the game's seed,
 * so every game has the same streets (only pollution and small looks vary).
 */
const OC_SEED = 0x01dc17;

/** Is a cell on one of the Old City's roads: a region's main streets, or a backstreet's crossing avenues? */
export function oldCityRoad(x: number, z: number, area: AreaInfo): boolean {
  const r = area.region ? regionById(area.region) : undefined;
  if (r) return r.roads.some((q) => inRect(q, x, z));
  if (!area.noLandmark || area.id === SEA || area.id.startsWith('out_')) return false;
  const lx = x - Math.floor(x / CHUNK) * CHUNK;
  const lz = z - Math.floor(z / CHUNK) * CHUNK;
  return lx === 7 || lx === 8 || lz === 7 || lz === 8; // a backstreet: two avenues crossing at its middle
}

/** Cells kept clear of buildings and generated obstacles: set pieces and their neighbours, the patch, the seam, the landmark, terraces. */
function oldCityKeepClear(x: number, z: number, area: AreaInfo): boolean {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (setPieceAt(x + dx, z + dz)) return true;
  const r = area.region ? regionById(area.region) : undefined;
  if (!r) return false;
  if (distToFootprintRaw(x, z, r.landmark.x, r.landmark.z, 2) <= CITY_GEN.landmarkClearance + 1) return true;
  if (distToFootprintRaw(x, z, r.seam.x, r.seam.z, 2) <= 1) return true;
  const grow = (q: { x: number; z: number; w: number; d: number }, m: number) => ({ x: q.x - m, z: q.z - m, w: q.w + 2 * m, d: q.d + 2 * m });
  if (inRect(grow(r.patch, 1), x, z)) return true;
  if (r.stamps.some((q) => inRect(grow(q, 1), x, z)) || r.ramps.some((q) => inRect(grow(q, 1), x, z))) return true;
  return r.roads.some((q) => inRect(grow(q, 1), x, z));
}

/** Old City buildings: at most one per chunk quarter, on its outer corner, never on roads, set pieces or terraces. */
function oldCityPlots(_seed: number, cx: number, cz: number, area: AreaInfo): BuildingPlot[] {
  const out: BuildingPlot[] = [];
  if (area.id === PARK || area.id === SEA || area.type === 'beach' || area.id.startsWith('out_')) return out;
  const B = CITY_GEN.buildings;
  const lh = hashString('buildings');
  const [lo, hi] = B.storeys.oldtown;
  for (const [qx, qz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const r = (salt: number) => tileRandom(OC_SEED, lh, cx * 2 + qx, cz * 2 + qz, salt);
    if (r(1) >= (B.chance[area.type] ?? 0)) continue;
    const w = 2 + Math.floor(r(2) * 3);
    const d = 2 + Math.floor(r(3) * 3);
    const x = cx * CHUNK + (qx === 0 ? 0 : CHUNK - w);
    const z = cz * CHUNK + (qz === 0 ? 0 : CHUNK - d);
    let ok = true;
    for (let j = 0; j < d && ok; j++) for (let i = 0; i < w && ok; i++) if (oldCityRoad(x + i, z + j, area) || oldCityKeepClear(x + i, z + j, area)) ok = false;
    if (!ok) continue;
    out.push({ x, z, w, d, storeys: lo + Math.floor(r(4) * (hi - lo + 1)), style: Math.floor(r(5) * 10) });
  }
  return out;
}

/**
 * E21.4: one Old City ground tile. The sea is open water nothing crosses; the beach is sand with a band of
 * shallow surf before it; regions take their type's ground with their main streets; backstreets are paved with
 * two avenues; then buildings, a few obstacles and the set pieces. Beyond the Old City: dead street under cloud.
 */
function generateOldCity(seed: number, layer: LayerData, lh: number, x: number, z: number, area: AreaInfo): TileData {
  const { pollutionMin, pollutionMax } = TUNING.restore;
  const base: TileData = {
    id: tileId(layer.id, x, z),
    roofId: layer.id,
    x,
    z,
    ground: 'polluted',
    pollution: 0,
    variant: Math.floor(tileRandom(seed, lh, x, z, 2) * 10000),
    blocked: false,
    growthRemainingSec: 0,
    bloom: 0,
  };
  // E21.26: the Landing's jetty: walkable planks out over the surf and the bay
  if (onJetty(x, z)) return Object.assign(base, { feature: 'paving' as TileFeature, prop: undefined, level: tileLevel(x, z) });
  // E23.8.3.1: the Long Causeway to the mainland; its broken middle is rubble across the gap until the Great Bloom
  if (onCauseway(x, z)) {
    const broken = causewayBroken(x, z);
    return stampOldCity(Object.assign(base, { feature: 'road' as TileFeature, blocked: broken, prop: broken ? 'causeway-broken' : undefined, pollution: pollutionMax }));
  }
  // the sea all round the island, the bay and the coast band: open water nothing crosses; canals: deep water
  if (area.id === SEA || area.id.startsWith('out_') || seaCell(x, z) || regionWater(x, z) || mainlandWater(x, z)) return stampOldCity(Object.assign(base, { feature: 'water' as TileFeature, blocked: true }));
  const def = AREA_TYPES[area.type];
  let feature: TileFeature = area.noLandmark ? 'paving' : def.ground;
  const road = oldCityRoad(x, z, area);
  if (road) feature = 'road';
  // the beach: shallow surf (wadable) in the rows before the sea
  if (area.type === 'beach' && isSeaChunk(Math.floor(x / CHUNK), Math.floor((z + OLD_CITY.surfRows) / CHUNK))) feature = 'water';
  if (coastSand(x, z) && !road) feature = 'sand';
  const clear = oldCityKeepClear(x, z, area);
  const building = !road && !clear && !!buildingAt(seed, x, z, layer.gen ?? 5);
  const blocked = building || (!road && !clear && feature !== 'water' && tileRandom(OC_SEED, lh, x, z, 5) < def.obstacles);
  if (building) feature = 'building';
  else if (blocked) feature = 'obstacle';
  const lo = Math.max(pollutionMin, area.pollutionFloor);
  Object.assign(base, {
    pollution: Math.min(100, Math.round(lo + (Math.max(lo, pollutionMax) - lo) * tileRandom(seed, lh, x, z, 1))),
    blocked,
    feature,
    prop: building ? 'building' : blocked ? def.prop : undefined,
  });
  return stampOldCity(base);
}
