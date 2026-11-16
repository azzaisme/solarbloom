import { CITY_GEN } from '../data/city';
import { CHUNK, hashString, tileRandom } from './Hash';

/**
 * City 16.3: arterials: four avenues out of the park, a square ring round it, and a jittered lattice every
 * `districtChunks`. Every run is straight and pinned to one chunk row or column, so any chunk finds its own runs
 * without its neighbours. No dependency on areas (the area map uses this to keep landmarks off arterials).
 */

export type Dir = 'n' | 's' | 'e' | 'w';

/** A chunk edge: the chunk on the `a` side and which side of it. Canonical: dir is 'e' or 's'. */
export interface ChunkEdge {
  cx: number;
  cz: number;
  dir: 'e' | 's';
}

/** One straight arterial run: along x (`axis: 'x'`, fixed chunk row `at`) or along z (fixed chunk column). */
export interface ArterialRun {
  axis: 'x' | 'z';
  /** chunk row (axis x) or column (axis z) it runs in */
  at: number;
  /** first tile across the run, chunk-local */
  lane: number;
  width: number;
  /** extent along the run, in world tiles, inclusive */
  from: number;
  to: number;
  kind: 'avenue' | 'ring' | 'lattice';
}

const NET = hashString('network');

/** Generations 2–3: is there a road (or canal) along this chunk row / column? Two tiles wide, seeded per row/column. */
export function roadRow(seed: number, cz: number) {
  return tileRandom(seed, NET, 0, cz, 1) < CITY_GEN.roadChance;
}
export function roadCol(seed: number, cx: number) {
  return tileRandom(seed, NET, cx, 0, 2) < CITY_GEN.roadChance;
}
/** A canal along this chunk row (lanes 3–4), every generation. */
export function canalRow(seed: number, cz: number) {
  return tileRandom(seed, NET, 0, cz, 3) < CITY_GEN.canalChance;
}

const SALT = hashString('roads');
const R = () => CITY_GEN.roads;


const LANES = [1, 12] as const;

/** Chunk column of vertical lattice line i (rows use the same rule with another salt). */
function latticeAt(seed: number, i: number, salt: number): number {
  if (i === 0) return 0;
  const n = CITY_GEN.districtChunks;
  const j = Math.floor(tileRandom(seed, SALT, i, 0, salt) * 3) - 1;
  return i * n + j;
}
function latticeLane(seed: number, i: number, salt: number): number {
  if (i === 0) return R().avenueLane;
  return LANES[Math.floor(tileRandom(seed, SALT, i, 1, salt) * LANES.length)];
}

/** Index of the lattice line at or just below chunk coordinate c (lines are monotonic). */
function latticeIndexBelow(seed: number, c: number, salt: number): number {
  const n = CITY_GEN.districtChunks;
  let i = Math.floor(c / n) + 1;
  while (latticeAt(seed, i, salt) > c) i--;
  return i;
}

const ROW = 101; // lines along x (fixed chunk row)
const COL = 102; // lines along z (fixed chunk column)

/** Does horizontal lattice segment (row line k, between column lines i and i+1) exist? Columns never drop. */
function rowSegmentKept(seed: number, k: number, i: number): boolean {
  if (k === 0) return true;
  return tileRandom(seed, SALT, k, i, 103) >= R().latticeDrop;
}

/** Centre-ish tile (world) where a lattice line sits, for joining runs. */
const lineTile = (at: number, lane: number) => at * CHUNK + lane;

/**
 * Every arterial run touching chunk (cx, cz). Runs are straight and pinned to chunk rows/columns, so a chunk
 * can find its own without looking at its neighbours. The park chunk has none (its own paths meet the avenues).
 */
export function arterialsInChunk(seed: number, cx: number, cz: number): ArterialRun[] {
  if (cx === 0 && cz === 0) return [];
  const out: ArterialRun[] = [];
  const W = R().width.arterial;
  const avenueEnd = (sign: number) => (sign > 0 ? CHUNK : -1); // avenues stop at the park's edge
  // Avenues: chunk row 0 and column 0, out from the park both ways, endless.
  if (cz === 0) {
    const lane = R().avenueLane;
    out.push(cx > 0 ? { axis: 'x', at: 0, lane, width: W, from: avenueEnd(1), to: Infinity, kind: 'avenue' } : { axis: 'x', at: 0, lane, width: W, from: -Infinity, to: avenueEnd(-1), kind: 'avenue' });
  }
  if (cx === 0) {
    const lane = R().avenueLane;
    out.push(cz > 0 ? { axis: 'z', at: 0, lane, width: W, from: avenueEnd(1), to: Infinity, kind: 'avenue' } : { axis: 'z', at: 0, lane, width: W, from: -Infinity, to: avenueEnd(-1), kind: 'avenue' });
  }
  // Ring: a square at Chebyshev radius `ring` chunks.
  const r = R().ring;
  const ringLane = (side: number) => (side > 0 ? LANES[0] : LANES[1]); // sits on the inner side of its chunk
  const ringSpan = (lo: number, hi: number, laneLo: number, laneHi: number) => [lo * CHUNK + laneLo, hi * CHUNK + laneHi + W - 1] as const;
  for (const side of [-1, 1]) {
    const c = side * r;
    if (cz === c && Math.abs(cx) <= r) {
      const [from, to] = ringSpan(-r, r, ringLane(-1), ringLane(1));
      out.push({ axis: 'x', at: c, lane: ringLane(side), width: W, from, to, kind: 'ring' });
    }
    if (cx === c && Math.abs(cz) <= r) {
      const [from, to] = ringSpan(-r, r, ringLane(-1), ringLane(1));
      out.push({ axis: 'z', at: c, lane: ringLane(side), width: W, from, to, kind: 'ring' });
    }
  }
  // Lattice: rows (along x) and columns (along z) every ~districtChunks, jittered; row segments sometimes drop.
  // Columns cross the whole lattice; rows run between columns and end on one, so no row ever ends in nothing.
  const n = CITY_GEN.districtChunks;
  for (let k = Math.floor(cz / n) - 1; k <= Math.floor(cz / n) + 1; k++) {
    if (k === 0 || latticeAt(seed, k, ROW) !== cz) continue;
    const lane = latticeLane(seed, k, ROW);
    // Which pair of columns does this chunk sit between?
    const i = latticeIndexBelow(seed, cx, COL);
    for (const seg of [i - 1, i]) {
      if (!rowSegmentKept(seed, k, seg)) continue;
      const a = latticeAt(seed, seg, COL);
      const b = latticeAt(seed, seg + 1, COL);
      const from = lineTile(a, latticeLane(seed, seg, COL));
      const to = lineTile(b, latticeLane(seed, seg + 1, COL)) + W - 1;
      if (cx * CHUNK + CHUNK - 1 < from || cx * CHUNK > to) continue;
      out.push({ axis: 'x', at: cz, lane, width: W, from, to, kind: 'lattice' });
    }
  }
  for (let i = Math.floor(cx / n) - 1; i <= Math.floor(cx / n) + 1; i++) {
    if (i === 0 || latticeAt(seed, i, COL) !== cx) continue;
    out.push({ axis: 'z', at: cx, lane: latticeLane(seed, i, COL), width: W, from: -Infinity, to: Infinity, kind: 'lattice' });
  }
  // Keep the ring clear of the park chunk rows/cols it never crosses; clip runs into the park chunk.
  return out.filter((run) => run.from <= run.to);
}

/** Does an arterial cross this chunk edge? Returns the run (its tiles on the edge are lane..lane+width-1). */
export function arterialAcross(seed: number, e: ChunkEdge): ArterialRun | undefined {
  // An 'e' edge is crossed by a run along x in that chunk row reaching both sides; 's' by a run along z.
  const [bx, bz] = e.dir === 'e' ? [e.cx + 1, e.cz] : [e.cx, e.cz + 1];
  const axis = e.dir === 'e' ? 'x' : 'z';
  const crossTile = e.dir === 'e' ? e.cx * CHUNK + CHUNK - 1 : e.cz * CHUNK + CHUNK - 1;
  const inA = arterialsInChunk(seed, e.cx, e.cz).filter((r) => r.axis === axis);
  const inB = arterialsInChunk(seed, bx, bz).filter((r) => r.axis === axis);
  // An avenue meets the park at its edge (the park's own path cross carries on inside).
  if (e.cx === 0 && e.cz === 0) return inB.find((r) => r.kind === 'avenue');
  if (bx === 0 && bz === 0) return inA.find((r) => r.kind === 'avenue');
  return inA.find((r) => r.from <= crossTile && r.to >= crossTile + 1 && inB.some((s) => s.at === r.at && s.lane === r.lane));
}


/** Is this world cell on an arterial? Returns the run. */
export function arterialAt(seed: number, x: number, z: number): ArterialRun | undefined {
  const cx = Math.floor(x / CHUNK);
  const cz = Math.floor(z / CHUNK);
  return arterialsInChunk(seed, cx, cz).find((r) => runCovers(r, x, z));
}

/** Does a run cover a world cell? */
export function runCovers(r: ArterialRun, x: number, z: number): boolean {
  const [along, across] = r.axis === 'x' ? [x, z] : [z, x];
  const a0 = r.at * CHUNK + r.lane;
  return along >= r.from && along <= r.to && across >= a0 && across < a0 + r.width;
}
