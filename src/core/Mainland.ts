// E23.8.3.1 (#451): the mainland's layout as pure lookups. Like the Old City, it is one fixed world (its own salt, not
// the game's seed), so every game's mainland is the same, and any cell can be asked about in any order.

import type { AreaType } from '../data/city';
import { MAINLAND, MAINLAND_TYPES, MAINLAND_WATER, SALVAGE_FIELDS } from '../data/mainland';
import type { PileDef, RampDef } from '../data/oldcity';
import { OLD_CITY } from '../data/oldcity';
import { MATERIALS, type PileSize } from '../data/salvage';
import type { MaterialId } from './types';
import { CHUNK, hashString, tileRandom } from './Hash';

const ML_SEED = 0x3a1a4d;
const LH = hashString('mainland');

/** Mainland area ids: `ml_<districtX>_<districtZ>`. */
export const ML_PREFIX = 'ml_';

export function isMainlandChunk(cx: number, _cz?: number): boolean {
  return cx >= MAINLAND.minChunkX;
}

export function isMainlandCell(x: number, _z?: number): boolean {
  return isMainlandChunk(Math.floor(x / CHUNK));
}

export function isMainlandArea(id: string): boolean {
  return id.startsWith(ML_PREFIX);
}

/** The district (area) a mainland chunk belongs to. */
export function mainlandAreaOfChunk(cx: number, cz: number): string {
  const d = MAINLAND.district;
  return `${ML_PREFIX}${Math.floor(cx / d)}_${Math.floor(cz / d)}`;
}

/** The chunks of a mainland district id. */
export function mainlandChunks(id: string): [number, number][] {
  const m = /^ml_(-?\d+)_(-?\d+)$/.exec(id);
  if (!m) return [];
  const d = MAINLAND.district;
  const out: [number, number][] = [];
  for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) out.push([Number(m[1]) * d + i, Number(m[2]) * d + j]);
  return out.filter(([cx]) => isMainlandChunk(cx));
}

/** The district the causeway lands in. */
export function landingArea(): string {
  return mainlandAreaOfChunk(MAINLAND.landing[0], MAINLAND.landing[1]);
}

function pick<T>(r: number, items: { v: T; w: number }[]): T {
  const total = items.reduce((a, b) => a + b.w, 0);
  let t = r * total;
  for (const it of items) if ((t -= it.w) < 0) return it.v;
  return items[items.length - 1].v;
}

/** A district's type, from its id (the landing is always a street, so the causeway arrives somewhere plain). */
export function mainlandType(id: string): AreaType {
  if (id === landingArea()) return 'street';
  const m = /^ml_(-?\d+)_(-?\d+)$/.exec(id);
  const r = m ? tileRandom(ML_SEED, LH, Number(m[1]), Number(m[2]), 1) : 0;
  return pick(r, MAINLAND_TYPES.map((t) => ({ v: t.type, w: t.weight })));
}

/** The rocky shore: the mainland's westmost cells are sea (except where the causeway crosses). */
export function mainlandShore(x: number, z: number): boolean {
  const x0 = MAINLAND.minChunkX * CHUNK;
  return x >= x0 && x < x0 + MAINLAND.shoreBand && !onCauseway(x, z);
}

/** Is a cell on the Long Causeway (whole or broken)? */
export function onCauseway(x: number, z: number): boolean {
  const c = MAINLAND.causeway;
  return z >= c.z0 && z <= c.z1 && x >= c.x0 && x <= c.x1;
}

/** Is a cell in the causeway's broken middle (open water until the Great Bloom)? */
export function causewayBroken(x: number, z: number): boolean {
  return onCauseway(x, z) && x >= MAINLAND.broken.x0 && x <= MAINLAND.broken.x1;
}

/** The ramps down to the causeway's low middle (sea level) from its two high ends (the island's base level). */
export function causewayRamps(): RampDef[] {
  const C = MAINLAND.causeway;
  const B = MAINLAND.broken;
  const n = MAINLAND.rampLength;
  const d = C.z1 - C.z0 + 1;
  const hi = OLD_CITY.baseLevel;
  const lo = OLD_CITY.seaLevel;
  return [
    { x: B.x0 - n, z: C.z0, w: n, d, dir: 'e', from: hi, to: lo, kind: 'ramp' },
    { x: B.x1 + 1, z: C.z0, w: n, d, dir: 'e', from: lo, to: hi, kind: 'ramp' },
  ];
}

/** Every broken causeway cell (what the Great Bloom raises). */
export function brokenCells(): [number, number][] {
  const out: [number, number][] = [];
  for (let z = MAINLAND.causeway.z0; z <= MAINLAND.causeway.z1; z++) for (let x = MAINLAND.broken.x0; x <= MAINLAND.broken.x1; x++) out.push([x, z]);
  return out;
}

// ───────────── fresh water ─────────────

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Is a mainland cell fresh water (a canal or a pond)? Canals run through every other row of districts and ponds sit in
 * reservoirs, plazas and some parks and groves (`MAINLAND_WATER`). Never on an avenue (they bridge the water), the
 * shore or the causeway.
 */
export function mainlandWater(x: number, z: number): boolean {
  if (!isMainlandCell(x) || mainlandShore(x, z) || onCauseway(x, z)) return false;
  const lx = mod(x, CHUNK);
  const lz = mod(z, CHUNK);
  if (lx === 7 || lx === 8 || lz === 7 || lz === 8) return false;
  const D = MAINLAND.district * CHUNK;
  const dx = Math.floor(x / D);
  const dz = Math.floor(z / D);
  const ox = x - dx * D;
  const oz = z - dz * D;
  const W = MAINLAND_WATER;
  if (mod(dz, W.canalEvery) === 0 && W.canalRows.includes(oz)) return true;
  const pond = W.ponds[mainlandType(`${ML_PREFIX}${dx}_${dz}`)];
  if (!pond || tileRandom(ML_SEED, LH, dx, dz, 30) >= pond.chance) return false;
  if (pond.rect) return ox >= pond.rect[0] && oz >= pond.rect[1] && ox <= pond.rect[2] && oz <= pond.rect[3];
  const [px, pz] = pond.centre!;
  return Math.hypot(ox - px, oz - pz) <= pond.radius!;
}

// ───────────── salvage fields ─────────────

const fieldCache = new Map<string, Map<string, PileDef>>();

/** A mainland chunk's salvage field: what it holds and its centre (local cells), or none. */
function fieldOf(cx: number, cz: number): { mats: Partial<Record<MaterialId, number>>; cxl: number; czl: number } | undefined {
  if (!isMainlandChunk(cx)) return undefined;
  const mats = SALVAGE_FIELDS.materials[mainlandType(mainlandAreaOfChunk(cx, cz))];
  if (!mats) return undefined;
  const r = (salt: number) => tileRandom(ML_SEED, LH, cx, cz, salt);
  if (r(10) >= SALVAGE_FIELDS.chance) return undefined;
  // the field's centre keeps off the chunk's avenues (cells 7–8) and its shore
  return { mats, cxl: r(11) < 0.5 ? 3 : 12, czl: r(12) < 0.5 ? 3 : 12 };
}

/** The piles of one mainland chunk's salvage field (none for most chunks of some types, and none on the shore). */
export function chunkPiles(cx: number, cz: number): Map<string, PileDef> {
  const k = `${cx},${cz}`;
  const hit = fieldCache.get(k);
  if (hit) return hit;
  const out = new Map<string, PileDef>();
  if (fieldCache.size > 4096) fieldCache.clear();
  fieldCache.set(k, out);
  if (!isMainlandChunk(cx)) return out;
  const field = fieldOf(cx, cz);
  if (!field) return out;
  const { mats, cxl, czl } = field;
  const r = (salt: number) => tileRandom(ML_SEED, LH, cx, cz, salt);
  const F = SALVAGE_FIELDS;
  const n = F.piles[0] + Math.floor(r(13) * (F.piles[1] - F.piles[0] + 1));
  const matList = (Object.entries(mats) as [MaterialId, number][]).map(([v, w]) => ({ v, w }));
  const sizeList = (Object.entries(F.sizes) as [PileSize, number][]).map(([v, w]) => ({ v, w }));
  for (let i = 0; i < n * 3 && out.size < n; i++) {
    const lx = cxl + Math.round((r(20 + i * 4) * 2 - 1) * F.spread);
    const lz = czl + Math.round((r(21 + i * 4) * 2 - 1) * F.spread);
    if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK || lx === 7 || lx === 8 || lz === 7 || lz === 8) continue;
    const x = cx * CHUNK + lx;
    const z = cz * CHUNK + lz;
    if (mainlandShore(x, z) || onCauseway(x, z) || mainlandWater(x, z)) continue;
    const id = `ml:${x}:${z}`;
    if (out.has(id)) continue;
    const size = pick(r(22 + i * 4), sizeList);
    const material = pick(r(23 + i * 4), matList);
    // the material's own pile model (as on the island), the usual one most of the time
    const models = MATERIALS[material].models;
    const model = models[Math.floor(r(24 + i * 4) * 4) % models.length] ?? F.models[size];
    out.set(id, { id, x, z, material, size, model });
  }
  return out;
}

/** The mainland pile on a cell, if any. */
export function mainlandPileAt(x: number, z: number): PileDef | undefined {
  if (!isMainlandCell(x)) return undefined;
  return chunkPiles(Math.floor(x / CHUNK), Math.floor(z / CHUNK)).get(`ml:${x}:${z}`);
}

/** A mainland pile by id (`ml:<x>:<z>`). */
export function mainlandPileById(id: string): PileDef | undefined {
  const m = /^ml:(-?\d+):(-?\d+)$/.exec(id);
  return m ? mainlandPileAt(Number(m[1]), Number(m[2])) : undefined;
}

// ───────────── the industrial ruins ─────────────

/**
 * E23.8.3.2: a steel field lies in the industrial ruins: rusted steel frames still standing, a broken gantry (legs at
 * both ends, its girder snapped and fallen; you walk under it) and rust stains on the ground round the piles. Pure
 * dressing: frames and gantry legs block their cell, stains and the cells under a gantry stay walkable. Never on a
 * pile or next to one, the avenues, the shore, the water or the causeway, so every pile stays reachable.
 */
export interface RuinDef {
  kind: 'frame' | 'gantry' | 'stain';
  x: number;
  z: number;
  /** 0: along x; 1: along z */
  turn: 0 | 1;
  /** a gantry: its first leg ('a', which draws it) or its far leg ('b') */
  part?: 'a' | 'b';
  /** a gantry: cells from leg to leg */
  span?: number;
}

const ruinCache = new Map<string, Map<string, RuinDef>>();

/** The industrial ruins of one mainland chunk (only round a field that holds steel). */
export function chunkRuins(cx: number, cz: number): Map<string, RuinDef> {
  const k = `${cx},${cz}`;
  const hit = ruinCache.get(k);
  if (hit) return hit;
  const out = new Map<string, RuinDef>();
  if (ruinCache.size > 4096) ruinCache.clear();
  ruinCache.set(k, out);
  const field = fieldOf(cx, cz);
  if (!field?.mats.steel) return out;
  const R = SALVAGE_FIELDS.ruins;
  const piles = chunkPiles(cx, cz);
  const r = (salt: number) => tileRandom(ML_SEED, LH, cx, cz, salt);
  const ck = (x: number, z: number) => `${x},${z}`;
  const nearPile = (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (piles.has(`ml:${x + dx}:${z + dz}`)) return true;
    return false;
  };
  const open = (lx: number, lz: number) => {
    if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK || lx === 7 || lx === 8 || lz === 7 || lz === 8) return false;
    const x = cx * CHUNK + lx;
    const z = cz * CHUNK + lz;
    return !mainlandShore(x, z) && !onCauseway(x, z) && !mainlandWater(x, z) && !out.has(ck(x, z)) && !piles.has(`ml:${x}:${z}`);
  };
  // a solid piece is never next to a pile or another solid piece, so it can't close a path
  const solidOk = (lx: number, lz: number) => {
    if (!open(lx, lz)) return false;
    const x = cx * CHUNK + lx;
    const z = cz * CHUNK + lz;
    if (nearPile(x, z)) return false;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const o = out.get(ck(x + dx, z + dz));
        if (o && o.kind !== 'stain') return false;
      }
    return true;
  };
  const put = (def: RuinDef) => out.set(ck(def.x, def.z), def);
  // every cell within reach of the field's centre, in a shuffled (but fixed) order; a crowded field spills its
  // ruins over the rest of the chunk (that list is only made when needed)
  const near = (reach: number, salt: number): [number, number, number][] => {
    const c: [number, number, number][] = [];
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++) c.push([field.cxl + dx, field.czl + dz, r(salt + (dz + reach) * 64 + dx + reach)]);
    return c.sort((p, q) => p[2] - q[2]);
  };
  const anywhere = (salt: number): [number, number, number][] => {
    const c: [number, number, number][] = [];
    for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) c.push([lx, lz, r(salt + lz * CHUNK + lx)]);
    return c.sort((p, q) => p[2] - q[2]);
  };
  // the gantry: two legs a span apart, at the field's edge
  const gantry = (cells: [number, number, number][]): boolean => {
    for (const [ax, az, h] of cells)
      for (const turn of (h < 0.5 ? [0, 1] : [1, 0]) as (0 | 1)[]) {
        const bx = ax + (turn === 0 ? R.gantrySpan : 0);
        const bz = az + (turn === 1 ? R.gantrySpan : 0);
        if (!solidOk(ax, az) || !solidOk(bx, bz)) continue;
        // the cells under it stay clear (you walk under the gantry)
        let under = true;
        for (let d = 1; d < R.gantrySpan; d++) if (!open(ax + (turn === 0 ? d : 0), az + (turn === 1 ? d : 0))) under = false;
        if (!under) continue;
        put({ kind: 'gantry', x: cx * CHUNK + ax, z: cz * CHUNK + az, turn, part: 'a', span: R.gantrySpan });
        put({ kind: 'gantry', x: cx * CHUNK + bx, z: cz * CHUNK + bz, turn, part: 'b', span: R.gantrySpan });
        return true;
      }
    return false;
  };
  if (!gantry(near(R.reach, 1000))) gantry(anywhere(1500));
  // rusted frames still standing
  let frames = 0;
  const frame = (cells: [number, number, number][]) => {
    for (const [lx, lz, h] of cells) {
      if (frames >= R.frames) return;
      if (!solidOk(lx, lz)) continue;
      put({ kind: 'frame', x: cx * CHUNK + lx, z: cz * CHUNK + lz, turn: (h * 1000) % 1 < 0.5 ? 0 : 1 });
      frames++;
    }
  };
  frame(near(R.reach, 2000));
  if (frames < R.frames) frame(anywhere(2500));
  // rust stains on the ground round the piles
  let stains = 0;
  for (const [lx, lz] of near(SALVAGE_FIELDS.spread, 3000)) {
    if (stains >= R.stains) break;
    if (!open(lx, lz)) continue;
    put({ kind: 'stain', x: cx * CHUNK + lx, z: cz * CHUNK + lz, turn: 0 });
    stains++;
  }
  return out;
}

/** The industrial-ruin piece on a mainland cell, if any. */
export function mainlandRuinAt(x: number, z: number): RuinDef | undefined {
  if (!isMainlandCell(x)) return undefined;
  return chunkRuins(Math.floor(x / CHUNK), Math.floor(z / CHUNK)).get(`${x},${z}`);
}
