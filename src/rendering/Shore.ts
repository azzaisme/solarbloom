import { LOOK } from '../data/look';
import type { TreeGeo } from './TreeGen';

/**
 * E28.W02 (#695): where natural ground meets the water. The grid still says which tiles are land and which are water;
 * this turns each land edge that opens onto water at its own level into a bank that slopes gently down under the
 * surface, so the waterline wanders instead of following the tile's straight side.
 *
 * Everything here is pure and decided by world position alone: the bank's reach comes from smooth value noise at the
 * point on the shore, so two tiles sharing an edge corner build the same bank there and the shoreline runs on without a
 * seam. The water's own distance to land (ChunkRenderer.waterDistance) is pulled out by the same reach, so the
 * turquoise shallows and the foam follow the new waterline.
 */

const S = () => LOOK.shore;

/** a lattice value in 0..1 for an integer cell (a hash, the same every run) */
function lattice(ix: number, iz: number, salt: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(salt, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** smooth 2D value noise in 0..1 */
function valueNoise(x: number, z: number, salt: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const w = fz * fz * (3 - 2 * fz);
  const a = lattice(ix, iz, salt);
  const b = lattice(ix + 1, iz, salt);
  const c = lattice(ix, iz + 1, salt);
  const d = lattice(ix + 1, iz + 1, salt);
  return (a + (b - a) * u) * (1 - w) + (c + (d - c) * u) * w;
}

/** The shore's wobble at a world point: two octaves of value noise, 0..1, one broad swell every `noise.scale` tiles. */
export function shoreNoise(x: number, z: number): number {
  const k = 1 / S().noise.scale;
  const a = valueNoise(x * k, z * k, 17);
  const b = valueNoise(x * k * 2.3 + 5.1, z * k * 2.3 - 3.7, 29);
  return Math.min(1, Math.max(0, a * (1 - S().noise.fine) + b * S().noise.fine));
}

/**
 * How far down the bank the land's own top carries (a share of the way to the waterline) before it turns to earth:
 * its own noise, so the grass line wanders too, sometimes reaching the water, sometimes stopping at the lip.
 */
export function grassLine(x: number, z: number): number {
  const g = S().grassLine;
  const k = 1 / S().noise.scale;
  return g.min + (g.max - g.min) * valueNoise(x * k * 1.7 + 11.3, z * k * 1.7 - 7.9, 41);
}

/**
 * How far out from the tile's edge the waterline sits at a world point on the shore (tiles). Sand beaches reach
 * further, so their banks are gentler.
 */
export function waterlineReach(x: number, z: number, beach: boolean): number {
  const r = S().reach;
  return (r.min + (r.max - r.min) * shoreNoise(x, z)) * (beach ? S().beach : 1);
}

/**
 * How far the land's own top carries on out past the tile's edge before the bank starts to slope (tiles): a shelf
 * whose width wanders by its own noise, so the edge of the lawn bulges and draws back instead of running straight.
 */
export function shelfAt(x: number, z: number): number {
  const sh = S().shelf;
  const k = 1 / S().noise.scale;
  return sh.min + (sh.max - sh.min) * valueNoise(x * k * 1.3 - 4.2, z * k * 1.3 + 9.1, 53);
}

/**
 * How far out from the tile's edge the water starts at a point on the shore: the shelf, then the slope down to the
 * waterline. With `room` (how far the open water runs out in front of the point before the next land), it keeps to
 * `LOOK.shore.room` of that, so the banks of a narrow channel never close it.
 */
export function waterlineAt(x: number, z: number, beach: boolean, room = Infinity): number {
  return (shelfAt(x, z) + waterlineReach(x, z, beach)) * roomScale(x, z, beach, room);
}

/** How much a bank shrinks to keep to its share of the open water in front of it (1: not at all). */
export function roomScale(x: number, z: number, beach: boolean, room: number): number {
  const want = shelfAt(x, z) + waterlineReach(x, z, beach);
  const most = room * S().room;
  return want > most ? most / want : 1;
}

/** How far the open water runs out from a point on the shore in a direction (tiles), before the next land. */
export type ShoreRoom = (x: number, z: number, nx: number, nz: number) => number;

/** The bank's cross-section: fraction `u` (0 at the tile's edge, 1 at its toe under the water) → fraction of its drop. */
export function bankDrop(u: number): number {
  const k = Math.min(1, Math.max(0, u));
  // a soft rounded shoulder at the top, then an even slope, easing out at the toe
  return k * k * (3 - 2 * k) * (1 - S().shoulder) + k * S().shoulder;
}

/** The `u` at which the bank has dropped `q` of its height (bankDrop inverted, by bisection). */
export function bankU(q: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (bankDrop(m) < q) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * A bank's sizes for a tile whose top is `depth` above the water's surface: its whole drop (to `under` below the
 * surface) and the share of its width at which it meets the water.
 */
export function bankSize(depth: number): { drop: number; wetU: number } {
  const drop = depth + S().under;
  return { drop, wetU: bankU(depth / drop) };
}

/** One point on a run of shore: where on the tile's outline, its outward direction, and the waterline's reach there. */
export interface ShorePoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/** ChunkRenderer's CORNERS order: (+1,+1), (−1,+1), (−1,−1), (+1,−1). */
const CORNERS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/**
 * The runs of a land tile's outline that open onto water, as points with outward directions, in order round the tile
 * (the order ChunkRenderer.cutRing goes round). `open` is per side in SIDES order (+x, −x, +z, −z); `cut` the radius
 * each corner is rounded off by (CORNERS order, 0 for square), as landCuts gives it. A square corner between two open
 * sides gets a fan (the same point, its direction turning), so the bank wraps round it. A tile open all round is one
 * closed run (its last point repeats its first).
 */
export function shoreRuns(x0: number, z0: number, open: readonly boolean[], cut: readonly number[], segments: number = S().segments, arc: number = S().arc): ShorePoint[][] {
  // sides in ring order: +z (corner 0 → 1), −x (1 → 2), −z (2 → 3), +x (3 → 0)
  const sideOpen = [open[2], open[1], open[3], open[0]];
  const sideN: [number, number][] = [
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 0],
  ];
  const corner = (k: number): [number, number] => [x0 + 0.5 + CORNERS[k][0] * 0.5, z0 + 0.5 + CORNERS[k][1] * 0.5];
  // the ring: each point, and whether the stretch from it to the next one opens onto water
  const ring: { p: ShorePoint; open: boolean }[] = [];
  for (let k = 0; k < 4; k++) {
    const [sx, sz] = CORNERS[k];
    const [cx, cz] = corner(k);
    const R = cut[k] ?? 0;
    const prev = (k + 3) % 4;
    if (R > 0) {
      // the arc from the previous side's end round to this side's start (water on both sides: always open). The
      // even corners are reached along their x edge, the odd ones along their z edge (as cutRing goes round)
      const ox = cx - sx * R;
      const oz = cz - sz * R;
      for (let i = 0; i <= arc; i++) {
        const a = ((k % 2 ? arc - i : i) / arc) * (Math.PI / 2);
        const nx = sx * Math.cos(a);
        const nz = sz * Math.sin(a);
        ring.push({ p: { x: ox + nx * R, z: oz + nz * R, nx, nz }, open: i < arc || sideOpen[k] });
      }
    } else if (sideOpen[prev] && sideOpen[k]) {
      // a square corner between two open sides: a fan, its direction turning from the previous side's to this one's
      const [ax, az] = sideN[prev];
      const [bx, bz] = sideN[k];
      for (let i = 0; i <= 3; i++) {
        const t = i / 3;
        const nx = ax * (1 - t) + bx * t;
        const nz = az * (1 - t) + bz * t;
        const l = Math.hypot(nx, nz);
        ring.push({ p: { x: cx, z: cz, nx: nx / l, nz: nz / l }, open: true });
      }
    } else {
      const [nx, nz] = sideN[sideOpen[k] ? k : prev];
      ring.push({ p: { x: cx, z: cz, nx, nz }, open: sideOpen[k] });
    }
    // this side's inner points, from its start (past this corner's arc) to short of the next corner's arc
    const [ex, ez] = corner((k + 1) % 4);
    const Rn = cut[(k + 1) % 4] ?? 0;
    const dx = Math.sign(ex - cx);
    const dz = Math.sign(ez - cz);
    const x1 = cx + dx * R;
    const z1 = cz + dz * R;
    const x2 = ex - dx * Rn;
    const z2 = ez - dz * Rn;
    const n = Math.max(1, Math.round(segments * Math.hypot(x2 - x1, z2 - z1)));
    const [nx, nz] = sideN[k];
    for (let i = 1; i < n; i++) ring.push({ p: { x: x1 + ((x2 - x1) * i) / n, z: z1 + ((z2 - z1) * i) / n, nx, nz }, open: sideOpen[k] });
  }
  const N = ring.length;
  if (ring.every((r) => r.open)) return [[...ring.map((r) => r.p), ring[0].p]];
  // runs: chains of open stretches, going round from just after a closed one
  const start = ring.findIndex((r) => !r.open);
  if (start < 0) return [];
  const runs: ShorePoint[][] = [];
  let cur: ShorePoint[] = [];
  for (let i = 1; i <= N; i++) {
    const s = (start + i) % N;
    if (ring[s].open) {
      if (!cur.length) cur.push(ring[s].p);
      cur.push(ring[(s + 1) % N].p);
    } else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** A bank's geometry: positions, normals, linear colours (0–1) and triangle indices. */
export interface BankGeo {
  pos: number[];
  nrm: number[];
  col: number[];
  idx: number[];
}

/** A bank's colours across it (linear 0–1): the land's top, the earth of the bank, the wet band, and under the water. */
export interface BankColours {
  top: [number, number, number];
  bank: [number, number, number];
  wet: [number, number, number];
  under: [number, number, number];
}

/** The rows across the bank (fractions of its width), always including the waterline. */
function rows(wetU: number): number[] {
  const n = S().rows;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(i / n);
  out.push(wetU, Math.max(0, wetU - 0.12), Math.min(1, wetU + 0.1));
  return [...new Set(out.map((u) => Math.round(u * 1e4) / 1e4))].sort((a, b) => a - b);
}

const mix3 = (a: readonly number[], b: readonly number[], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** The bank's colour at `u` across it (wetU: where it meets the water), shaded darker toward the waterline (its AO). */
export function bankColour(c: BankColours, u: number, wetU: number, share = 0.3, top: readonly number[] = c.top): [number, number, number] {
  const L = S();
  let rgb: [number, number, number];
  const topEnd = Math.min(wetU - L.wetBand - 0.02, wetU * share);
  const soft = 0.08;
  if (u <= topEnd - soft) rgb = [top[0], top[1], top[2]];
  else if (u <= wetU - L.wetBand) rgb = mix3(top, c.bank, Math.min(1, Math.max(0, (u - (topEnd - soft)) / Math.max(1e-6, wetU - L.wetBand - (topEnd - soft)))));
  else if (u <= wetU) rgb = mix3(c.bank, c.wet, (u - (wetU - L.wetBand)) / L.wetBand);
  else rgb = mix3(c.wet, c.under, Math.min(1, (u - wetU) / Math.max(1e-6, 1 - wetU)));
  // ambient occlusion: darkest just at and below the waterline, where the bank meets the water
  const ao = 1 - L.ao * Math.exp(-(((u - wetU) / L.aoWidth) ** 2));
  return [rgb[0] * ao, rgb[1] * ao, rgb[2] * ao];
}

/**
 * Where on a run's bank a point lies: `s` of the way along the run, `u` across its slope (0 at the shelf's lip, where
 * the slope starts, wetU at the waterline, 1 at the toe), with the bank's height there.
 */
export function bankPoint(run: ShorePoint[], s: number, u: number, top: number, surface: number, beach: boolean, room?: ShoreRoom): [number, number, number] {
  const [p, nx, nz] = alongRun(run, s);
  const { drop, wetU } = bankSize(top - S().crown - surface);
  const k = room ? roomScale(p[0], p[1], beach, room(p[0], p[1], nx, nz)) : 1;
  const d = (shelfAt(p[0], p[1]) + (waterlineReach(p[0], p[1], beach) / wetU) * u) * k;
  return [p[0] + nx * d, top - S().crown - drop * bankDrop(u), p[1] + nz * d];
}

/** A point `s` (0..1) of the way along a run's length, with its outward direction (blended between points). */
export function alongRun(run: ShorePoint[], s: number): [[number, number], number, number] {
  const lens: number[] = [0];
  for (let i = 1; i < run.length; i++) lens.push(lens[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z));
  const total = lens[lens.length - 1];
  if (total <= 1e-9) return [[run[0].x, run[0].z], run[0].nx, run[0].nz];
  const want = Math.min(1, Math.max(0, s)) * total;
  let i = 1;
  while (i < run.length - 1 && lens[i] < want) i++;
  const k = (want - lens[i - 1]) / Math.max(1e-9, lens[i] - lens[i - 1]);
  const a = run[i - 1];
  const b = run[i];
  const nx = a.nx + (b.nx - a.nx) * k;
  const nz = a.nz + (b.nz - a.nz) * k;
  const l = Math.hypot(nx, nz) || 1;
  return [[a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k], nx / l, nz / l];
}

/** A run's length along the tile's outline. */
export function runLength(run: ShorePoint[]): number {
  let L = 0;
  for (let i = 1; i < run.length; i++) L += Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z);
  return L;
}

/** One row of a bank's cross-section: how far out from the tile's edge, how high, and where across the slope (-1: the shelf). */
interface Row {
  d: number;
  y: number;
  u: number;
  /** the surface's normal there, as (out, up) */
  no: number;
  ny: number;
}

/**
 * A bank's cross-section at a point on the shore: first the shelf, the land's top carrying on out past the tile's
 * edge by `shelfAt` (falling only by `crown`, a soft rounding), then the slope down to its toe under the water. Every
 * point has the same rows (a shelf of no width has rows of no width), so neighbouring points stitch into one mesh.
 */
function crossSection(x: number, z: number, top: number, surface: number, beach: boolean, us: number[], k = 1): Row[] {
  const L = S();
  const sh = shelfAt(x, z) * k;
  const { drop, wetU } = bankSize(top - L.crown - surface);
  const R = (waterlineReach(x, z, beach) / wetU) * k;
  const out: Row[] = [];
  for (const v of [0, 0.5, 1]) {
    // the shelf's gentle fall: its slope there is 2 crown v over its width
    const slope = sh > 1e-6 ? (2 * L.crown * v) / sh : 0;
    out.push({ d: sh * v, y: top - L.crown * v * v, u: -1, no: slope, ny: 1 });
  }
  for (const u of us) {
    if (u <= 0) continue;
    const du = 1e-3;
    const lo = Math.max(0, u - du);
    const hi = Math.min(1, u + du);
    const dy = (drop * (bankDrop(hi) - bankDrop(lo))) / (hi - lo);
    out.push({ d: sh + R * u, y: top - L.crown - drop * bankDrop(u), u, no: dy, ny: R });
  }
  return out;
}

/**
 * The bank under one run: from the tile's top edge a shelf of the land's own ground carries on out (its width
 * wandering), then the bank slopes down to its toe `under` below the water's surface (its width wandering too), so
 * both the edge of the lawn and the waterline follow the shore's noise rather than the grid. Coloured from the land's
 * top through bare earth and a wet band into the shallows, with soft normals so it lights as one rounded slope. Each
 * end gets a cap down to the toe's depth, so nothing shows through where a run stops.
 */
export function bankStrip(
  out: BankGeo,
  run: ShorePoint[],
  top: number,
  surface: number,
  beach: boolean,
  c: BankColours,
  topAt?: (x: number, z: number) => readonly number[],
  room?: ShoreRoom,
  taper: readonly [boolean, boolean] = [false, false],
): [number, number] {
  if (run.length < 2) return [out.idx.length, out.idx.length];
  const fade = taperScales(run, taper);
  const { drop, wetU } = bankSize(top - S().crown - surface);
  const us = rows(wetU);
  const base = out.pos.length / 3;
  const stripIdx0 = out.idx.length;
  let W = 0;
  const sections: Row[][] = [];
  run.forEach((p, i) => {
    const share = grassLine(p.x, p.z);
    const topCol = topAt ? topAt(p.x, p.z) : c.top;
    const sec = crossSection(p.x, p.z, top, surface, beach, us, (room ? roomScale(p.x, p.z, beach, room(p.x, p.z, p.nx, p.nz)) : 1) * fade[i]);
    sections.push(sec);
    W = sec.length;
    for (const r of sec) {
      out.pos.push(p.x + p.nx * r.d, r.y, p.z + p.nz * r.d);
      const l = Math.hypot(r.no, r.ny) || 1;
      out.nrm.push((p.nx * r.no) / l, r.ny / l, (p.nz * r.no) / l);
      out.col.push(...(r.u < 0 ? [topCol[0], topCol[1], topCol[2]] : bankColour(c, r.u, wetU, share, topCol)));
    }
  });
  for (let i = 0; i + 1 < run.length; i++)
    for (let j = 0; j + 1 < W; j++) {
      const a = base + i * W + j;
      const b = a + W;
      // wound counter-clockwise seen from above whichever way round the run goes
      const p0 = run[i];
      const p1 = run[i + 1];
      const cw = (p1.x - p0.x) * p0.nz - (p1.z - p0.z) * p0.nx > 0;
      if (cw) out.idx.push(a, a + 1, b, b, a + 1, b + 1);
      else out.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const surfaceIdx: [number, number] = [stripIdx0, out.idx.length];
  // end caps: the cross-section at each end, down to the toe's depth
  const toe = top - S().crown - drop;
  for (const [end, prev] of [
    [0, 1],
    [run.length - 1, run.length - 2],
  ]) {
    const p = run[end];
    const q = run[prev];
    let tx = p.x - q.x;
    let tz = p.z - q.z;
    const tl = Math.hypot(tx, tz);
    if (tl < 1e-9) continue;
    tx /= tl;
    tz /= tl;
    const cb = out.pos.length / 3;
    const col = bankColour(c, 0.5, wetU);
    for (const r of sections[end]) {
      out.pos.push(p.x + p.nx * r.d, r.y, p.z + p.nz * r.d);
      out.pos.push(p.x + p.nx * r.d, toe, p.z + p.nz * r.d);
      for (let k = 0; k < 2; k++) {
        out.nrm.push(tx, 0, tz);
        out.col.push(col[0] * 0.8, col[1] * 0.8, col[2] * 0.8);
      }
    }
    for (let j = 0; j + 1 < W; j++) {
      const a = cb + j * 2;
      out.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      out.idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); // both faces (the cap is seen from either side)
    }
  }
  return surfaceIdx;
}

/**
 * How much of its width a bank keeps at each point of a run: 1, except toward an end that `taper` marks (where the
 * shore carries on past a built edge, paving or a road, that keeps its straight side), where it eases down to nothing
 * over `LOOK.shore.taper` tiles, so the bank fades into the built edge instead of stopping in a step.
 */
export function taperScales(run: ShorePoint[], taper: readonly [boolean, boolean]): number[] {
  const lens: number[] = [0];
  for (let i = 1; i < run.length; i++) lens.push(lens[i - 1] + Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z));
  const total = lens[lens.length - 1];
  const T = S().taper;
  const ease = (d: number) => {
    const k = Math.min(1, Math.max(0, d / T));
    return k * k * (3 - 2 * k);
  };
  return lens.map((l) => (taper[0] ? ease(l) : 1) * (taper[1] ? ease(total - l) : 1));
}

/**
 * The height of a bank's surface at (x, z): the highest of its triangles in `range` (index range, as bankStrip returns
 * it) over that point, or undefined where none is. What's dressed on a bank stands at exactly this height.
 */
export function bankHeight(g: BankGeo, range: readonly [number, number], x: number, z: number): number | undefined {
  let best: number | undefined;
  const P = g.pos;
  for (let i = range[0]; i < range[1]; i += 3) {
    const a = g.idx[i] * 3;
    const b = g.idx[i + 1] * 3;
    const c = g.idx[i + 2] * 3;
    const d = (P[b + 2] - P[c + 2]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 2] - P[c + 2]);
    if (Math.abs(d) < 1e-12) continue;
    const w1 = ((P[b + 2] - P[c + 2]) * (x - P[c]) + (P[c] - P[b]) * (z - P[c + 2])) / d;
    const w2 = ((P[c + 2] - P[a + 2]) * (x - P[c]) + (P[a] - P[c]) * (z - P[c + 2])) / d;
    const w3 = 1 - w1 - w2;
    if (w1 < -1e-7 || w2 < -1e-7 || w3 < -1e-7) continue;
    const y = w1 * P[a + 1] + w2 * P[b + 1] + w3 * P[c + 1];
    if (best === undefined || y > best) best = y;
  }
  return best;
}

const LEANED = new WeakMap<TreeGeo, Map<number, TreeGeo>>();
/**
 * A plant leaning over by `lean` radians toward its own +x: each vertex slides out by its height × tan(lean), so its
 * foot stays exactly where it stands and only what grows above leans out (over the water, for the shore's overhangs).
 * Cached per plant and angle.
 */
export function leanGeo(g: TreeGeo, lean: number): TreeGeo {
  let byLean = LEANED.get(g);
  if (!byLean) LEANED.set(g, (byLean = new Map()));
  const key = Math.round(lean * 1000);
  const hit = byLean.get(key);
  if (hit) return hit;
  const k = Math.tan(lean);
  const pos = new Float32Array(g.pos);
  for (let i = 0; i < pos.length; i += 4) pos[i] += Math.max(0, pos[i + 1]) * k;
  const out: TreeGeo = { ...g, pos };
  byLean.set(key, out);
  return out;
}

/** A stable 0..1 number for a point and a salt (decoration choices along the shore). */
export function shoreHash(x: number, z: number, salt: number): number {
  return lattice(Math.round(x * 64), Math.round(z * 64), salt);
}
