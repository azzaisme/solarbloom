import { AREA_TYPES, CITY_GEN, type AreaType } from '../data/city';
import { areaMapFor, PARK, type AreaMap } from './Areas';
import { CHUNK, hashString, tileRandom } from './Hash';

/**
 * City 16: the road network, planned on the area graph (not the chunk lattice). A pure function of the seed,
 * order-independent, and local: every answer needs only a bounded neighbourhood of chunks and areas.
 *
 * Three tiers (CITY_GEN.roads):
 * - **arterial**: long, straight main roads: four avenues out of the park, a ring round it, and a jittered lattice
 *   every `districtChunks` chunks. Defined per chunk row/column, so any chunk knows its arterial tiles alone.
 * - **street**: links between neighbouring areas. Every area links to its parent (one chunk step closer to the
 *   park), so the links form a tree rooted at the park; extra links add loops.
 * - **lane**: a link between two lane-style areas (parkland, groves): 1 tile, paved, not asphalt.
 *
 * A link crosses the shared border at a **gate**: one chunk edge and a tile offset, picked from the sorted pair
 * ids, so both sides agree. An arterial crossing a shared border is that pair's link (no street beside it).
 */

export type RoadTier = 'arterial' | 'street' | 'lane';
export type Dir = 'n' | 's' | 'e' | 'w';

/** A chunk edge: the chunk on the `a` side and which side of it. Canonical: dir is 'e' or 's'. */
export interface ChunkEdge {
  cx: number;
  cz: number;
  dir: 'e' | 's';
}

export interface Gate {
  edge: ChunkEdge;
  /** first tile along the edge (0–15, chunk-local) and width in tiles */
  offset: number;
  width: number;
}

export interface RoadLink {
  /** the other area */
  to: string;
  tier: RoadTier;
  /** why it exists */
  kind: 'parent' | 'child' | 'extra' | 'arterial';
  gate: Gate;
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

const SALT = hashString('roads');
const R = () => CITY_GEN.roads;

/** Lane-style areas: footpaths, not asphalt. */
export const laneStyle = (t: AreaType | 'park') => R().laneTypes.includes(t as AreaType);

const edgeKey = (e: ChunkEdge) => `${e.cx},${e.cz},${e.dir}`;
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** The edge between two edge-adjacent chunks, canonical. */
function edgeBetween(ax: number, az: number, bx: number, bz: number): ChunkEdge {
  if (ax === bx) return { cx: ax, cz: Math.min(az, bz), dir: 's' };
  return { cx: Math.min(ax, bx), cz: az, dir: 'e' };
}

// ───────────────────────────── arterials ─────────────────────────────

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

// ───────────────────────────── area links ─────────────────────────────

/** An area's chunk nearest the park (cx²+cz², then cx, then cz). */
function nearestChunk(chunks: [number, number][]): [number, number] {
  let best = chunks[0];
  for (const c of chunks) {
    const d = c[0] ** 2 + c[1] ** 2;
    const bd = best[0] ** 2 + best[1] ** 2;
    if (d < bd || (d === bd && (c[0] < best[0] || (c[0] === best[0] && c[1] < best[1])))) best = c;
  }
  return best;
}

/** One chunk step toward the park along the longer axis (strictly closer, so parents form a tree). */
function stepToPark([cx, cz]: [number, number]): [number, number] {
  if (Math.abs(cx) >= Math.abs(cz)) return [cx - Math.sign(cx), cz];
  return [cx, cz - Math.sign(cz)];
}

export interface AreaRoads {
  id: string;
  parent?: string;
  links: RoadLink[];
}

/** Road plan for one seed (cached like `areaMapFor`). */
export class RoadPlan {
  private cache = new Map<string, AreaRoads>();
  private parents = new Map<string, { parent: string; edge: ChunkEdge } | null>();
  private candidates = new Map<string, string[]>();

  constructor(
    readonly seed: number,
    readonly map: AreaMap,
  ) {}

  /** The area's parent (one chunk step toward the park) and the edge the parent link crosses. */
  parentOf(id: string): { parent: string; edge: ChunkEdge } | null {
    const hit = this.parents.get(id);
    if (hit !== undefined) return hit;
    let out: { parent: string; edge: ChunkEdge } | null = null;
    if (id !== PARK) {
      const c = nearestChunk(this.map.info(id).chunks);
      const p = stepToPark(c);
      out = { parent: this.map.areaOfChunk(p[0], p[1]), edge: edgeBetween(c[0], c[1], p[0], p[1]) };
    }
    this.parents.set(id, out);
    return out;
  }

  /** Neighbours this area is tree-linked to (its parent and children). */
  private treeLinked(id: string): Set<string> {
    const out = new Set<string>();
    const p = this.parentOf(id);
    if (p) out.add(p.parent);
    for (const n of this.map.info(id).neighbours) if (this.parentOf(n)?.parent === id) out.add(n);
    return out;
  }

  /** Every chunk edge two neighbouring areas share, canonical and sorted. */
  sharedEdges(a: string, b: string): ChunkEdge[] {
    const out: ChunkEdge[] = [];
    const seen = new Set<string>();
    for (const [cx, cz] of this.map.info(a).chunks)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (this.map.areaOfChunk(cx + dx, cz + dz) !== b) continue;
        const e = edgeBetween(cx, cz, cx + dx, cz + dz);
        const k = edgeKey(e);
        if (!seen.has(k)) seen.add(k), out.push(e);
      }
    return out.sort((x, y) => x.cz - y.cz || x.cx - y.cx || (x.dir < y.dir ? -1 : 1));
  }

  /** Neighbours with an arterial across a shared border (that is their link). */
  private arterialLinked(id: string): Map<string, { edge: ChunkEdge; run: ArterialRun }> {
    const out = new Map<string, { edge: ChunkEdge; run: ArterialRun }>();
    for (const n of this.map.info(id).neighbours)
      for (const e of this.sharedEdges(id, n)) {
        const run = arterialAcross(this.seed, e);
        if (run) {
          out.set(n, { edge: e, run });
          break;
        }
      }
    return out;
  }

  private pairRandom(a: string, b: string, salt: number) {
    return tileRandom(this.seed, SALT, hashString(pairKey(a, b)), 0, salt);
  }

  /**
   * Extra-link candidates of an area, best first: neighbours not already tree- or arterial-linked, kept with the
   * theme's chance (the mean of both sides), ranked by the pair's hash. Symmetric inputs, so both sides agree.
   */
  private extraCandidates(id: string): string[] {
    const hit = this.candidates.get(id);
    if (hit) return hit;
    const tree = this.treeLinked(id);
    const art = this.arterialLinked(id);
    const a = this.map.info(id);
    const out = a.neighbours
      .filter((n) => n !== PARK && id !== PARK && !tree.has(n) && !art.has(n))
      .filter((n) => {
        const b = this.map.info(n);
        const chance = (R().extraChance[a.theme] + R().extraChance[b.theme]) / 2;
        return this.pairRandom(id, n, 1) < chance;
      })
      .sort((x, y) => this.pairRandom(id, x, 2) - this.pairRandom(id, y, 2) || (x < y ? -1 : 1));
    this.candidates.set(id, out);
    return out;
  }

  /** How many extra links an area may still take after its tree and arterial links. */
  private extraRoom(id: string): number {
    const used = new Set([...this.treeLinked(id), ...this.arterialLinked(id).keys()]).size;
    return Math.max(0, R().maxLinks - used);
  }

  /** An extra link exists when each side ranks the other within its remaining room. */
  private extraLinked(a: string, b: string): boolean {
    const ca = this.extraCandidates(a);
    const cb = this.extraCandidates(b);
    const ia = ca.indexOf(b);
    const ib = cb.indexOf(a);
    return ia >= 0 && ib >= 0 && ia < this.extraRoom(a) && ib < this.extraRoom(b);
  }

  /** The gate a street or lane link crosses: the parent edge for tree links, else a seeded shared edge. */
  gate(a: string, b: string, tier: RoadTier): Gate {
    const pa = this.parentOf(a);
    const pb = this.parentOf(b);
    let edge: ChunkEdge;
    if (pa?.parent === b) edge = pa.edge;
    else if (pb?.parent === a) edge = pb.edge;
    else {
      const edges = this.sharedEdges(a, b);
      edge = edges[Math.floor(this.pairRandom(a, b, 3) * edges.length)];
    }
    const width = R().width[tier];
    const [lo, hi] = R().gateRange;
    const offset = lo + Math.floor(this.pairRandom(a, b, 4) * (hi - lo - width + 2));
    return { edge, offset, width };
  }

  /** All road links of an area (symmetric: b is in a's links exactly when a is in b's, with the same gate). */
  roads(id: string): AreaRoads {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const a = this.map.info(id);
    const art = this.arterialLinked(id);
    const p = this.parentOf(id);
    const links: RoadLink[] = [];
    for (const n of a.neighbours) {
      const run = art.get(n);
      if (run) {
        links.push({ to: n, tier: 'arterial', kind: 'arterial', gate: { edge: run.edge, offset: run.run.lane, width: run.run.width } });
        continue;
      }
      const tier: RoadTier = laneStyle(id === PARK ? 'park' : a.type) && laneStyle(n === PARK ? 'park' : this.map.info(n).type) ? 'lane' : 'street';
      if (p?.parent === n) links.push({ to: n, tier, kind: 'parent', gate: this.gate(id, n, tier) });
      else if (this.parentOf(n)?.parent === id) links.push({ to: n, tier, kind: 'child', gate: this.gate(id, n, tier) });
      else if (this.extraLinked(id, n)) links.push({ to: n, tier, kind: 'extra', gate: this.gate(id, n, tier) });
    }
    const out: AreaRoads = { id, parent: p?.parent, links };
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(id, out);
    return out;
  }
}

const PLANS = new Map<string, RoadPlan>();
/** Shared road plan per seed and ground generation (roads exist from generation 4). */
export function roadPlanFor(seed: number, gen = 4): RoadPlan {
  const key = `${seed}|${gen}`;
  let p = PLANS.get(key);
  if (!p) {
    if (PLANS.size > 8) PLANS.clear();
    p = new RoadPlan(seed, areaMapFor(seed, gen));
    PLANS.set(key, p);
  }
  return p;
}

/** Area types → routing style inside the area (City 16.4). */
export const routingStyle = (t: AreaType) => R().style[t];
export { AREA_TYPES };
