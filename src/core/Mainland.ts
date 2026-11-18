// E23.8.3.1 (#451): the mainland's layout as pure lookups. Like the Old City, it is one fixed world (its own salt, not
// the game's seed), so every game's mainland is the same, and any cell can be asked about in any order.

import type { AreaType } from '../data/city';
import { MAINLAND, MAINLAND_TYPES, SALVAGE_FIELDS } from '../data/mainland';
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

// ───────────── salvage fields ─────────────

const fieldCache = new Map<string, Map<string, PileDef>>();

/** The piles of one mainland chunk's salvage field (none for most chunks of some types, and none on the shore). */
export function chunkPiles(cx: number, cz: number): Map<string, PileDef> {
  const k = `${cx},${cz}`;
  const hit = fieldCache.get(k);
  if (hit) return hit;
  const out = new Map<string, PileDef>();
  if (fieldCache.size > 4096) fieldCache.clear();
  fieldCache.set(k, out);
  if (!isMainlandChunk(cx)) return out;
  const type = mainlandType(mainlandAreaOfChunk(cx, cz));
  const mats = SALVAGE_FIELDS.materials[type];
  if (!mats) return out;
  const r = (salt: number) => tileRandom(ML_SEED, LH, cx, cz, salt);
  if (r(10) >= SALVAGE_FIELDS.chance) return out;
  const F = SALVAGE_FIELDS;
  // the field's centre keeps off the chunk's avenues (cells 7–8) and its shore
  const cxl = r(11) < 0.5 ? 3 : 12;
  const czl = r(12) < 0.5 ? 3 : 12;
  const n = F.piles[0] + Math.floor(r(13) * (F.piles[1] - F.piles[0] + 1));
  const matList = (Object.entries(mats) as [MaterialId, number][]).map(([v, w]) => ({ v, w }));
  const sizeList = (Object.entries(F.sizes) as [PileSize, number][]).map(([v, w]) => ({ v, w }));
  for (let i = 0; i < n * 3 && out.size < n; i++) {
    const lx = cxl + Math.round((r(20 + i * 4) * 2 - 1) * F.spread);
    const lz = czl + Math.round((r(21 + i * 4) * 2 - 1) * F.spread);
    if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK || lx === 7 || lx === 8 || lz === 7 || lz === 8) continue;
    const x = cx * CHUNK + lx;
    const z = cz * CHUNK + lz;
    if (mainlandShore(x, z) || onCauseway(x, z)) continue;
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
