import { AREA_TYPES, CITY_GEN, PARK_LAYOUT, type AreaType } from '../data/city';
import { areaMapFor, PARK, type AreaMap } from './Areas';
import { arterialAcross, type ArterialRun, type ChunkEdge } from './Arterials';
import { CHUNK } from './Hash';
import { landmarkKept, rasterArea, type AreaRaster, type RoadCell } from './RoadRaster';
import { hashString, tileRandom } from './Hash';

export { arterialAcross, arterialAt, arterialsInChunk, type ArterialRun, type ChunkEdge } from './Arterials';

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

  /**
   * The gate a street or lane link crosses: the parent edge for tree links, else a seeded shared edge. The offset
   * starts from the pair hash and moves to the nearest one whose cells, a road-width deep on both sides, are clear
   * of landmarks and rooftops (so a route can always leave the gate).
   */
  gate(a: string, b: string, tier: RoadTier): Gate {
    const pa = this.parentOf(a);
    const pb = this.parentOf(b);
    const shared = this.sharedEdges(a, b);
    let first: ChunkEdge;
    if (pa?.parent === b) first = pa.edge;
    else if (pb?.parent === a) first = pb.edge;
    else first = shared[Math.floor(this.pairRandom(a, b, 3) * shared.length)];
    const width = R().width[tier];
    const [lo, hi] = R().gateRange;
    const want = lo + Math.floor(this.pairRandom(a, b, 4) * (hi - lo - width + 2));
    const edges = [first, ...shared.filter((e) => edgeKey(e) !== edgeKey(first))];
    // Preferred range first; then anywhere along the edge clear of the arterial lanes near its ends.
    for (const [l, h] of [[lo, hi], [4, 11]])
      for (const edge of edges)
        for (let d = 0; d < CHUNK * 2; d++) {
          const offset = want + (d % 2 ? -1 : 1) * Math.ceil(d / 2);
          if (offset < l || offset + width - 1 > h) continue;
          if (this.gateClear(edge, offset, width)) return { edge, offset, width };
        }
    return { edge: first, offset: want, width };
  }

  /** Are a gate's cells, `width` deep into both chunks, clear of both areas' landmarks and roofs? */
  private gateClear(e: ChunkEdge, offset: number, width: number): boolean {
    for (const [cx, cz, inward] of [
      [e.cx, e.cz, -1],
      [e.dir === 'e' ? e.cx + 1 : e.cx, e.dir === 's' ? e.cz + 1 : e.cz, 1],
    ] as const) {
      const id = this.map.areaOfChunk(cx, cz);
      if (id === PARK) continue;
      const a = this.map.info(id);
      for (let i = 0; i < width; i++)
        for (let d = 0; d <= width; d++) {
          const along = offset + i;
          const across = inward < 0 ? CHUNK - 1 - d : d;
          const x = cx * CHUNK + (e.dir === 'e' ? across : along);
          const z = cz * CHUNK + (e.dir === 'e' ? along : across);
          if (landmarkKept(x, z, a.landmark[0], a.landmark[1]) || this.map.underRoof(id, x, z)) return false;
        }
    }
    return true;
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

  private rasters = new Map<string, AreaRaster>();

  /** This area's road tiles (cached). */
  cells(id: string): AreaRaster {
    let r = this.rasters.get(id);
    if (!r) {
      if (this.rasters.size > 4000) this.rasters.clear();
      r = rasterArea(this, id);
      this.rasters.set(id, r);
    }
    return r;
  }

  /** The road on a world cell, if any (the park's own paths are not part of the network). */
  roadAt(x: number, z: number): RoadCell | undefined {
    const id = this.map.areaOfChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    if (id === PARK) return undefined;
    return this.cells(id).get(`${x},${z}`);
  }

  /**
   * Shape of the road tile at a world cell. `mask` is every side with road next to it (kerbs go on the others);
   * `through` only the sides where the road carries on a full road-width, so a street's own other half doesn't
   * count and a 2-wide straight reads as straight, not as a junction.
   */
  pieceAt(x: number, z: number): RoadPiece | undefined {
    const c = this.roadAt(x, z);
    if (!c) return undefined;
    const w = R().width[c.tier];
    let mask = 0;
    let through = 0;
    // The park's own path cross (tiles 7–8) carries the avenues on into the park.
    const road = (rx: number, rz: number) => !!this.roadAt(rx, rz) || (rx >= 0 && rz >= 0 && rx < CHUNK && rz < CHUNK && (PARK_LAYOUT.paths.cols.includes(rx) || PARK_LAYOUT.paths.rows.includes(rz)));
    for (const [dx, dz, b] of SIDE) {
      if (!road(x + dx, z + dz)) continue;
      mask |= b;
      let ok = true;
      for (let k = 2; k <= w && ok; k++) if (!road(x + dx * k, z + dz * k)) ok = false;
      if (ok) through |= b;
    }
    const n = bits(through);
    // An end has nothing round it but the way back and its own other lanes; more road than that is a jog in a junction.
    const kind: RoadPieceKind = n >= 4 ? 'cross' : n === 3 ? 'tee' : n === 2 ? ((through & 3) === 3 || (through & 12) === 12 ? 'straight' : 'corner') : bits(mask) <= w ? 'end' : 'corner';
    return { tier: c.tier, bridge: c.bridge, mask, through, kind };
  }
}

/** What a road tile looks like from above: which sides continue, and the piece that implies. */
export type RoadPieceKind = 'straight' | 'corner' | 'tee' | 'cross' | 'end';
export interface RoadPiece {
  tier: RoadTier;
  bridge: boolean;
  /** sides whose neighbour is road: bit 1 = +x (e), 2 = -x (w), 4 = +z (s), 8 = -z (n) */
  mask: number;
  /** sides the road continues beyond its own width (centreline view, for markings and piece shape) */
  through: number;
  kind: RoadPieceKind;
}

const SIDE = [
  [1, 0, 1],
  [-1, 0, 2],
  [0, 1, 4],
  [0, -1, 8],
] as const;
const bits = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

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
