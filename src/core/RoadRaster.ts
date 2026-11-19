import { CITY_GEN } from '../data/city';
import { PARK } from './Areas';
import { arterialsInChunk, canalRow, runCovers } from './Arterials';
import { CHUNK, hashString, tileRandom } from './Hash';
import type { Gate, RoadPlan, RoadTier } from './RoadPlan';

/**
 * City 16.4: an area's road tiles. Each area routes only inside its own chunks, so it can be drawn on its own:
 * its terminals are its gates, the arterial runs through it and its landmark plaza, joined by least-cost paths
 * (Dijkstra over cells × heading). Existing road is cheap, so later routes join earlier ones and make junctions.
 * The area type's routing style (CITY_GEN.roads.style) shapes the cost.
 */

export interface RoadCell {
  tier: RoadTier;
  /** on a canal lane: a bridge (still road: walkable and restorable) */
  bridge: boolean;
}

/** Road cells of one area, keyed by `x,z`. */
export type AreaRaster = Map<string, RoadCell>;

const K = (x: number, z: number) => `${x},${z}`;
const SALT = hashString('road-raster');
const RANK: Record<RoadTier, number> = { lane: 0, street: 1, arterial: 2 };
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Landmark footprint plus this many tiles (a square) is never road: the plaza the road ends at or rings. */
export const LANDMARK_KEEP = 1;
export const landmarkKept = (x: number, z: number, mx: number, mz: number) => x >= mx - LANDMARK_KEEP && x <= mx + 1 + LANDMARK_KEEP && z >= mz - LANDMARK_KEEP && z <= mz + 1 + LANDMARK_KEEP;
const AROUND = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

/** Is a world cell on a canal lane (rows 3–4 of a canal row's chunks)? */
export function canalCell(plan: RoadPlan, _x: number, z: number): boolean {
  const cz = Math.floor(z / CHUNK);
  const lz = z - cz * CHUNK;
  if (lz !== 3 && lz !== 4) return false;
  return canalRow(plan.seed, cz);
}

/** Smooth value noise in 0–1 (for curving lanes). */
function noise(seed: number, x: number, z: number, scale: number): number {
  const fx = x / scale;
  const fz = z / scale;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fx - x0;
  const tz = fz - z0;
  const s = (t: number) => t * t * (3 - 2 * t);
  const v = (a: number, b: number) => tileRandom(seed, SALT, a, b, 9);
  const top = v(x0, z0) + (v(x0 + 1, z0) - v(x0, z0)) * s(tx);
  const bot = v(x0, z0 + 1) + (v(x0 + 1, z0 + 1) - v(x0, z0 + 1)) * s(tx);
  return top + (bot - top) * s(tz);
}

/** Minimal binary heap of [cost, node]. */
class Heap {
  private c: number[] = [];
  private n: number[] = [];
  get size() {
    return this.c.length;
  }
  push(cost: number, node: number) {
    const c = this.c;
    const n = this.n;
    let i = c.length;
    c.push(cost);
    n.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= cost) break;
      c[i] = c[p];
      n[i] = n[p];
      i = p;
    }
    c[i] = cost;
    n[i] = node;
  }
  pop(): [number, number] {
    const c = this.c;
    const n = this.n;
    const top: [number, number] = [c[0], n[0]];
    const lc = c.pop()!;
    const ln = n.pop()!;
    if (c.length) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= c.length) break;
        const r = l + 1;
        const m = r < c.length && c[r] < c[l] ? r : l;
        if (c[m] >= lc) break;
        c[i] = c[m];
        n[i] = n[m];
        i = m;
      }
      c[i] = lc;
      n[i] = ln;
    }
    return top;
  }
}

/** Draw one area's roads. Pure (given the plan). */
export function rasterArea(plan: RoadPlan, id: string): AreaRaster {
  if (id === PARK) return new Map();
  const map = plan.map;
  const seed = plan.seed;
  const info = map.info(id);
  const style = CITY_GEN.roads.style[info.type];
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [cx, cz] of info.chunks) {
    x0 = Math.min(x0, cx * CHUNK);
    z0 = Math.min(z0, cz * CHUNK);
    x1 = Math.max(x1, cx * CHUNK + CHUNK - 1);
    z1 = Math.max(z1, cz * CHUNK + CHUNK - 1);
  }
  const W = x1 - x0 + 1;
  const D = z1 - z0 + 1;
  const idx = (x: number, z: number) => (z - z0) * W + (x - x0);
  // Per-cell arrays over the area's bounding box (string keys only for the result).
  const inside = new Uint8Array(W * D);
  for (const [cx, cz] of info.chunks)
    for (let z = cz * CHUNK; z < cz * CHUNK + CHUNK; z++) for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) inside[idx(x, z)] = 1;
  const inArea = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && inside[idx(x, z)] === 1;
  const [mx, mz] = info.landmark;
  const blockedAt = new Uint8Array(W * D);
  const water = new Uint8Array(W * D);
  const base = new Float32Array(W * D);
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, z);
      if (!inside[i]) continue;
      if (landmarkKept(x, z, mx, mz) || map.underRoof(id, x, z)) blockedAt[i] = 1;
      if (canalCell(plan, x, z)) water[i] = 1;
      let c = water[i] ? 5 : 1;
      if (style === 'curve') c += 1.6 * noise(seed, x, z, 5);
      if (style === 'waterside') {
        const lz = z - Math.floor(z / CHUNK) * CHUNK;
        if (lz === 2 || lz === 5) c *= 0.5;
      }
      if (style === 'skirt') c += 3 * Math.max(0, 1 - (Math.abs(x - mx - 0.5) + Math.abs(z - mz - 0.5)) / 7);
      base[i] = c;
    }
  const free = (x: number, z: number) => inArea(x, z) && !blockedAt[idx(x, z)];
  // The brush: a route's centre cell plus, for a 2-wide road, the cell beside it across its heading (+z when moving
  // along x, +x when moving along z). Turns fill the 2×2 corner. Nothing is painted ahead of the centre, so a
  // route ends flush on the road it joins (no overhang).
  // fitsH / fitsV: does the brush fit for a move along x / along z (index by width).
  const fitsH = [new Uint8Array(0), new Uint8Array(W * D), new Uint8Array(W * D)];
  const fitsV = [new Uint8Array(0), new Uint8Array(W * D), new Uint8Array(W * D)];
  // Canals run along x: a brush touching water may only be entered moving along z, so roads cross canals
  // straight over as bridges and never run along them.
  const wetAt = (x: number, z: number) => inArea(x, z) && water[idx(x, z)] === 1;
  const wetH = [new Uint8Array(0), new Uint8Array(W * D), new Uint8Array(W * D)];
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, z);
      const f = free(x, z) ? 1 : 0;
      fitsH[1][i] = fitsV[1][i] = f;
      fitsH[2][i] = f && free(x, z + 1) ? 1 : 0;
      fitsV[2][i] = f && free(x + 1, z) ? 1 : 0;
      wetH[1][i] = wetAt(x, z) ? 1 : 0;
      wetH[2][i] = wetH[1][i] || wetAt(x, z + 1) ? 1 : 0;
    }

  /** -1 none, else RANK of the tier painted there */
  const tierAt = new Int8Array(W * D).fill(-1);
  const TIERS: RoadTier[] = ['lane', 'street', 'arterial'];
  const paint = (x: number, z: number, tier: RoadTier) => {
    if (!inArea(x, z)) return;
    const i = idx(x, z);
    if (tierAt[i] < RANK[tier]) tierAt[i] = RANK[tier];
  };

  // 1. Arterials through the area, at their real tiles (the area map keeps landmarks and roofs off them).
  for (const [cx, cz] of info.chunks)
    for (const r of arterialsInChunk(seed, cx, cz))
      for (let z = cz * CHUNK; z < cz * CHUNK + CHUNK; z++) for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) if (runCovers(r, x, z)) paint(x, z, 'arterial');

  // The landmark plaza: free cells touching the kept-clear blob (corners too) are where a road may end.
  const plaza = new Uint8Array(W * D);
  let plazaCount = 0;
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++)
      if (free(x, z) && AROUND.some(([dx, dz]) => inArea(x + dx, z + dz) && blockedAt[idx(x + dx, z + dz)])) {
        plaza[idx(x, z)] = 1;
        plazaCount++;
      }

  // Plazas ring their landmark.
  if (style === 'ring') for (let i = 0; i < W * D; i++) if (plaza[i]) tierAt[i] = Math.max(tierAt[i], RANK.street);

  // 2. Terminals: arterial components inside the area, then gates (sorted, so the result is stable).
  const own = laneTierInside(plan, id);
  const comps: { cells: number[]; tier: RoadTier }[] = [];
  const seen = new Uint8Array(W * D);
  for (let s0 = 0; s0 < W * D; s0++) {
    if (tierAt[s0] !== RANK.arterial || seen[s0]) continue;
    const cells: number[] = [];
    const stack = [s0];
    seen[s0] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const x = x0 + (i % W);
      const z = z0 + Math.floor(i / W);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx;
        const nz = z + dz;
        if (!inArea(nx, nz)) continue;
        const n = idx(nx, nz);
        if (seen[n] || tierAt[n] !== RANK.arterial) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    comps.push({ cells, tier: own });
  }
  const gates = plan
    .roads(id)
    .links.filter((l) => l.tier !== 'arterial')
    .sort((a, b) => (a.to < b.to ? -1 : 1));
  for (const l of gates) comps.push({ cells: gateStart(l.gate, id, plan).map(([x, z]) => idx(x, z)), tier: l.tier });

  // Paint the gates themselves (their full width on this side of the border).
  for (const l of gates) for (const [x, z] of gateCells(l.gate, id, plan)) paint(x, z, l.tier);

  // 3. Join every terminal to the network (the first to the plaza).
  const network = new Uint8Array(W * D);
  let connected = style === 'ring' && plazaCount > 0;
  if (connected) for (let i = 0; i < W * D; i++) if (plaza[i]) network[i] = 1;
  const turn = { grid: 2.5, ring: 2.5, waterside: 1.5, skirt: 1, curve: 0.3 }[style];
  const cost = (i: number) => (network[i] || tierAt[i] === RANK.arterial ? 0.35 + (base[i] - 1) * 0.35 : base[i]);
  for (const comp of comps) {
    const tier = comp.tier;
    const w = CITY_GEN.roads.width[tier];
    const path = route(comp.cells, w);
    if (path)
      path.forEach((node, k) => {
        const i = node >> 2;
        const h = node & 3;
        const x = x0 + (i % W);
        const z = z0 + Math.floor(i / W);
        const cells: [number, number][] = [[x, z]];
        if (w === 2) {
          const next = path[k + 1];
          const turning = next !== undefined && (next & 3) >> 1 !== h >> 1;
          if (h < 2 || turning) cells.push([x, z + 1]);
          if (h >= 2 || turning) cells.push([x + 1, z]);
          if (turning) cells.push([x + 1, z + 1]);
        }
        for (const [cx, cz] of cells)
          if (free(cx, cz)) {
            paint(cx, cz, tier);
            network[idx(cx, cz)] = 1;
          }
      });
    for (const i of comp.cells) network[i] = 1;
    connected = true;
  }

  const out: AreaRaster = new Map();
  for (let i = 0; i < W * D; i++) {
    if (tierAt[i] < 0) continue;
    out.set(K(x0 + (i % W), z0 + Math.floor(i / W)), { tier: TIERS[tierAt[i]], bridge: !!water[i] });
  }
  return out;

  /** Least-cost path over (cell × heading) from any start to a goal; returns its nodes (cell * 4 + heading). */
  function route(starts: number[], w: number): number[] | undefined {
    const N = W * D * 4;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const heap = new Heap();
    for (const s of starts)
      for (let h = 0; h < 4; h++) {
        dist[s * 4 + h] = 0;
        heap.push(0, s * 4 + h);
      }
    const startSet = new Set(starts);
    while (heap.size) {
      const [d, node] = heap.pop();
      if (d > dist[node]) continue;
      const cell = node >> 2;
      const h = node & 3;
      const x = x0 + (cell % W);
      const z = z0 + Math.floor(cell / W);
      // Goal: the centre lands on the network (or, for the first route, on the plaza).
      if (!startSet.has(cell) && (connected ? network[cell] : plaza[cell])) {
        const path: number[] = [];
        for (let n = node; n >= 0; n = prev[n]) path.push(n);
        return path.reverse();
      }
      for (let nh = 0; nh < 4; nh++) {
        const nx = x + DIRS[nh][0];
        const nz = z + DIRS[nh][1];
        if (nx < x0 || nx > x1 || nz < z0 || nz > z1) continue;
        const nc = idx(nx, nz);
        if (nh < 2 ? !fitsH[w][nc] || wetH[w][nc] : !fitsV[w][nc]) continue;
        const nd = d + cost(nc) + (nh === h || startSet.has(cell) ? 0 : turn);
        const nn = nc * 4 + nh;
        if (nd < dist[nn]) {
          dist[nn] = nd;
          prev[nn] = node;
          heap.push(nd, nn);
        }
      }
    }
    return undefined;
  }
}

/** Inside a lane-style area its own spur to the landmark is a lane; elsewhere a street. */
function laneTierInside(plan: RoadPlan, id: string): RoadTier {
  return CITY_GEN.roads.laneTypes.includes(plan.map.info(id).type) ? 'lane' : 'street';
}

/** This area's side of a gate: the full gate width along the edge, on the edge row/column. */
export function gateCells(g: Gate, id: string, plan: RoadPlan): [number, number][] {
  const { cx, cz, dir } = g.edge;
  const aSide = plan.map.areaOfChunk(cx, cz) === id;
  const out: [number, number][] = [];
  for (let i = 0; i < g.width; i++) {
    if (dir === 'e') out.push([aSide ? cx * CHUNK + CHUNK - 1 : (cx + 1) * CHUNK, cz * CHUNK + g.offset + i]);
    else out.push([cx * CHUNK + g.offset + i, aSide ? cz * CHUNK + CHUNK - 1 : (cz + 1) * CHUNK]);
  }
  return out;
}

/** The centre cell a gate's route starts from: its first tile (the brush covers the rest across the heading). */
function gateStart(g: Gate, id: string, plan: RoadPlan): [number, number][] {
  return [gateCells(g, id, plan)[0]];
}
