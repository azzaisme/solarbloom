import { OLD_CITY, PARK_SET, REGIONS, type RampDef } from '../data/oldcity';
import { CAUSEWAY } from '../data/ending';
import { inOldCity, inRect, isSeaChunk, onCauseway, onJetty, regionOfChunk, regionWater, seaCell } from './OldCityLayout';

/**
 * E21.24 (§7 "Height"): the Old City's terraces. Every ground tile has a level 0–4 (one level is 1.2 tiles high),
 * a pure function of the cell (never saved), and only under old-city rules: classic ground stays flat.
 *
 * Tiles stay flat: a ramp (one level over 3 tiles) or a stair (one level over 2) is the only way between levels
 * on foot (ladders and perches come with E21.7). A step between two tiles is allowed when the heights of their
 * shared edge match: a flat tile's edges are all its level; a ramp's back and front edges are the heights it
 * starts and ends at, and its sides only meet the same row of the same ramp. A cliff edge blocks both ways, so
 * bloombot never falls. The simulation never reads any of this: height changes walking, building, looking only.
 */

const CHUNK = 16;

interface RampHit {
  ramp: RampDef;
  /** which ramp (for matching side edges) */
  key: string;
  /** index of this tile along the ramp, from its start (0) */
  i: number;
  /** tiles along the ramp */
  n: number;
}

const RAMPS: { ramp: RampDef; key: string }[] = [];
let rampsBuilt = false;
function ramps() {
  if (rampsBuilt) return RAMPS;
  rampsBuilt = true;
  PARK_SET.ramps.forEach((ramp, i) => RAMPS.push({ ramp, key: `park${i}` }));
  for (const r of regionsWithRamps()) r.ramps.forEach((ramp, i) => RAMPS.push({ ramp, key: `${r.id}${i}` }));
  return RAMPS;
}

function regionsWithRamps() {
  return REGIONS.filter((r) => r.ramps.length);
}

/** The ramp or stair on a cell, if any. */
export function rampAt(x: number, z: number): RampHit | undefined {
  for (const { ramp, key } of ramps()) {
    if (!inRect(ramp, x, z)) continue;
    const alongZ = ramp.dir === 'n' || ramp.dir === 's';
    const n = alongZ ? ramp.d : ramp.w;
    const i = ramp.dir === 's' ? z - ramp.z : ramp.dir === 'n' ? ramp.z + ramp.d - 1 - z : ramp.dir === 'e' ? x - ramp.x : ramp.x + ramp.w - 1 - x;
    return { ramp, key, i, n };
  }
  return undefined;
}

/** The terrace level of a ground cell (a ramp's cells report the level they are cut into). */
export function levelAt(x: number, z: number): number {
  const cx = Math.floor(x / CHUNK);
  const cz = Math.floor(z / CHUNK);
  // E23.9.3: the Long Causeway's deck is level with the streets it leaves from
  if (onCauseway(x, z)) return CAUSEWAY.level;
  // the sea all round (E21.26), the bay, the coast, the jetty and canals are all at sea level
  if (!inOldCity(cx, cz) || isSeaChunk(cx, cz) || seaCell(x, z) || onJetty(x, z) || regionWater(x, z)) return OLD_CITY.seaLevel;
  if (cx === 0 && cz === 0) return PARK_SET.level;
  const r = regionOfChunk(cx, cz);
  if (!r) return OLD_CITY.backstreetLevel;
  let level = r.level;
  for (const s of r.stamps) if (inRect(s, x, z)) level = s.level;
  return level;
}

const DIR: Record<RampDir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
type RampDir = RampDef['dir'];

/** A ramp tile's height (in levels) at a fraction `k` (0–1) of the way along it. */
function rampHeight(h: RampHit, k: number): number {
  return h.ramp.from + ((h.ramp.to - h.ramp.from) * (h.i + k)) / h.n;
}

/**
 * The height (in levels) of the edge of cell (x, z) facing (dx, dz), or a token string for a ramp's side (which
 * only meets the same row of the same ramp).
 */
export function edgeHeight(x: number, z: number, dx: number, dz: number): number | string {
  const h = rampAt(x, z);
  if (!h) return levelAt(x, z);
  const [fx, fz] = DIR[h.ramp.dir];
  if (dx === fx && dz === fz) return round(rampHeight(h, 1));
  if (dx === -fx && dz === -fz) return round(rampHeight(h, 0));
  return `${h.key}:${h.i}`;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** May bloombot step from cell a to its orthogonal neighbour b? (Same edge height, or the same ramp row.) */
export function canStep(ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.abs(dx) + Math.abs(dz) !== 1) return ax === bx && az === bz;
  return edgeHeight(ax, az, dx, dz) === edgeHeight(bx, bz, -dx, -dz);
}

/** Between two cells that touch (orthogonally or diagonally): a step, or a diagonal both of whose corners are steps. */
export function connected(ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  if (!dx && !dz) return true;
  if (Math.abs(dx) > 1 || Math.abs(dz) > 1) return false;
  if (!dx || !dz) return canStep(ax, az, bx, bz);
  return (canStep(ax, az, bx, az) && canStep(bx, az, bx, bz)) || (canStep(ax, az, ax, bz) && canStep(ax, bz, bx, bz));
}

/** The ground's height (in levels) under a point (continuous cell units): a ramp slopes, a terrace is flat. */
export function heightAt(px: number, pz: number): number {
  const x = Math.floor(px);
  const z = Math.floor(pz);
  const h = rampAt(x, z);
  if (!h) return levelAt(x, z);
  const fx = px - x;
  const fz = pz - z;
  const k = h.ramp.dir === 's' ? fz : h.ramp.dir === 'n' ? 1 - fz : h.ramp.dir === 'e' ? fx : 1 - fx;
  return rampHeight(h, k);
}

/** World y offset of a height in levels (level 1 is drawn at the classic ground height). */
export function levelY(level: number): number {
  return (level - OLD_CITY.baseLevel) * OLD_CITY.levelHeight;
}

/** The mid-tile height of a cell (in levels): what TileData.level holds. */
export function tileLevel(x: number, z: number): number {
  const h = rampAt(x, z);
  return h ? round(rampHeight(h, 0.5)) : levelAt(x, z);
}
