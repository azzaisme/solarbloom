import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { setWaterDisturbers, type WaterDisturber } from './WaterDisturbance';
import { waterFade, waterWaves } from './WaterSurface';

/**
 * E28.W04 (#697): life in the water: lily pads (and their flowers) on restored fresh water, small fish in clear
 * restored shallows, floating leaves and drifting flecks near restored shores, and aquatic plants in the shallows of
 * restored fresh water. Nothing on dead or murky water or the open sea; more of it as a shore blooms (LOOK.waterLife).
 *
 * Each chunk works out its own (`lifeForTile`, called as it builds its water) and hands them over by a source key of
 * its own (`setWaterLife`), as the rocks hand the water their rings. WaterLife draws the ones near where the camera
 * looks, one instanced draw per kind, on the water's layer (so the High reflection leaves them out). Everything that
 * floats rides the same swell the surface lifts by (`waterWaves`), on the water's own clock, and fades in with a
 * restore. Fish now and then rise and ring the surface (WaterDisturbance, source `fish`).
 */
export type LifeKind = 'pad0' | 'pad1' | 'flower' | 'leaf0' | 'leaf1' | 'fish' | 'fleck' | 'plant' | 'fall' | 'foam' | 'spray' | 'outlet';
export const LIFE_KINDS: readonly LifeKind[] = ['pad0', 'pad1', 'flower', 'leaf0', 'leaf1', 'fish', 'fleck', 'plant', 'fall', 'foam', 'spray', 'outlet'];

export interface LifeSpot {
  kind: LifeKind;
  /** where it rests (fish: the middle of its loop; leaves: of their orbit; flecks: where they set off) */
  x: number;
  z: number;
  /** the water's rest height there */
  y: number;
  /** its distance to land (the waves ease in by it, as the surface does) */
  edge: number;
  /** size: across (pads, flecks), long (leaves, fish), tall (plants) */
  size: number;
  /**
   * how far it may wander from (x, z): a fish's loop, a leaf's orbit, a fleck's drift; 0 for things that stay put.
   * An outlet's stream and culvert: how high its mouth is above the water
   */
  range: number;
  /** its own phase (radians) and heading at rest */
  phase: number;
  yaw: number;
  /** a restore's window (WaterSurface's transition clock): it fades in over it */
  t0: number;
  d: number;
}

/** What `lifeForTile` needs to know about a tile of water. */
export interface LifeTile {
  x: number;
  z: number;
  /** the water's rest height */
  y: number;
  /** pools, ponds and canals (not the sea or its surf) */
  fresh: boolean;
  /** restored, clear water (a dead or murky tile, or the open sea, has none) */
  living: boolean;
  /** how far its shore has bloomed, 0 … 4 */
  bloom: number;
  /** still under water (a draining pond's bared bed has none) */
  covered: boolean;
  /** distance to land at a point (the same the surface's waves ease in by) */
  dist: (x: number, z: number) => number;
  /** the restore's window */
  t0: number;
  d: number;
}

/** A small, fixed random stream per tile (the same life every build). */
function tileRng(x: number, z: number, salt: number) {
  let s = (Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ Math.imul(salt, 83492791)) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const TAU = Math.PI * 2;

/** Smooth value noise, 0 … 1, varying over about LOOK.waterLife.pads.patch tiles: where lily pads gather. */
export function lilyPatch(x: number, z: number): number {
  const k = 1 / LOOK.waterLife.pads.patch;
  const px = x * k;
  const pz = z * k;
  const ix = Math.floor(px);
  const iz = Math.floor(pz);
  const fx = px - ix;
  const fz = pz - iz;
  const h = (a: number, b: number) => tileRng(a, b, 31)();
  const u = fx * fx * (3 - 2 * fx);
  const w = fz * fz * (3 - 2 * fz);
  const top = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * u;
  const bot = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * u;
  return top + (bot - top) * w;
}

/** The life on one tile of water. */
export function lifeForTile(t: LifeTile): LifeSpot[] {
  if (!t.living || !t.covered) return [];
  const L = LOOK.waterLife;
  const out: LifeSpot[] = [];
  const bloom = Math.max(0, Math.min(4, t.bloom));
  const rnd = tileRng(t.x, t.z, 7);
  const at = (u: number, w: number) => ({ x: t.x + u, z: t.z + w });
  const spot = (kind: LifeKind, x: number, z: number, size: number, range: number): LifeSpot => ({
    kind,
    x,
    z,
    y: t.y,
    edge: t.dist(x, z),
    size,
    range,
    phase: rnd() * TAU,
    yaw: rnd() * TAU,
    t0: t.t0,
    d: t.d,
  });
  // lily pads and their flowers: fresh water only, in patches along the banks (none out in open water)
  if (t.fresh && lilyPatch(t.x + 0.5, t.z + 0.5) > 1 - L.pads.patches) {
    const n = L.pads.perTile - (rnd() < 0.35 ? 1 : 0) + (bloom >= L.pads.crowdFrom ? 1 : 0);
    let first = true;
    for (let i = 0; i < n; i++) {
      const p = at(0.15 + rnd() * 0.7, 0.15 + rnd() * 0.7);
      const size = L.pads.size[0] + rnd() * (L.pads.size[1] - L.pads.size[0]);
      const dp = t.dist(p.x, p.z);
      if (dp < size * 0.5 || dp > L.pads.reach) continue;
      const pad = spot(i % 2 ? 'pad1' : 'pad0', p.x, p.z, size, 0);
      out.push(pad);
      if (first && bloom >= L.pads.flowerFrom) out.push({ ...pad, kind: 'flower', size: size * 0.55 });
      first = false;
    }
    // an arrowhead clump in the shallows by a bank
    const q = at(0.15 + rnd() * 0.7, 0.15 + rnd() * 0.7);
    const dq = t.dist(q.x, q.z);
    if (dq > 0.12 && dq < L.plants.reach && rnd() < L.plants.chance + L.plants.perBloom * bloom) out.push(spot('plant', q.x, q.z, L.plants.height * (0.75 + rnd() * 0.5), 0));
  }
  // a little shoal, in water deep enough for its loop to stay off the land: at the deepest of a few points in the
  // tile (a narrow canal's open water runs along its middle, which is a tile's edge, not its centre)
  let c = at(0.5, 0.5);
  let dc = t.dist(c.x, c.z);
  for (const [u, v] of [[0.15, 0.5], [0.85, 0.5], [0.5, 0.15], [0.5, 0.85]]) {
    const p = at(u, v);
    const dp = t.dist(p.x, p.z);
    if (dp > dc + 1e-6) [c, dc] = [p, dp];
  }
  if (dc >= L.fish.minDepth && rnd() < L.fish.chance + L.fish.perBloom * bloom) {
    const range = Math.min(L.fish.range, dc - 0.2);
    const n = 1 + Math.floor(rnd() * L.fish.shoal);
    const base = spot('fish', c.x, c.z, L.fish.length, range);
    for (let i = 0; i < n; i++) out.push({ ...base, size: L.fish.length * (0.8 + rnd() * 0.4), yaw: i * 0.9 });
  }
  // near a restored shore: floating leaves and drifting flecks
  const s = at(0.2 + rnd() * 0.6, 0.2 + rnd() * 0.6);
  const ds = t.dist(s.x, s.z);
  if (ds > 0.15 && ds < L.leaves.reach && rnd() < L.leaves.chance + L.leaves.perBloom * bloom)
    out.push(spot(rnd() < 0.5 ? 'leaf0' : 'leaf1', s.x, s.z, L.leaves.size * (0.8 + rnd() * 0.4), Math.min(L.leaves.orbit, ds - 0.1)));
  const f = at(0.2 + rnd() * 0.6, 0.2 + rnd() * 0.6);
  const df = t.dist(f.x, f.z);
  if (df > 0.25 && df < L.flecks.reach && rnd() < L.flecks.chance + L.flecks.perBloom * bloom)
    out.push(spot('fleck', f.x, f.z, L.flecks.size * (0.7 + rnd() * 0.6), Math.min(L.flecks.drift * L.flecks.life, df - 0.15)));
  return out;
}

/** The culvert's proportions, as shares of its outer width (`LOOK.waterLife.falls.culvert`): `outletGeo` builds to them. */
export const CULVERT = { inner: 0.34, outer: 0.5, depth: 0.12, sill: 0.12 };

/**
 * An outlet in a wall: a channel of fresh water at rest height `y` ends against higher ground whose top stands `drop`
 * over it. (x, z) is on the wall's face (in front of its courses), and the water lies the way `yaw` points (+x turned
 * by it). Its culvert (the mouth's middle `range` over the water), the stream pouring from the mouth's lip, and where
 * that lands: foam and a puff of spray.
 */
export function outletSpots(x: number, z: number, y: number, yaw: number, drop: number, t0: number, d: number): LifeSpot[] {
  const F = LOOK.waterLife.falls;
  const mouth = Math.min(F.outlet, drop * 0.6);
  if (mouth < 0.15) return [];
  const base = { x, z, y, edge: 0, range: mouth, phase: 0, yaw, t0, d };
  const fx = Math.cos(yaw);
  const fz = -Math.sin(yaw);
  const land = fallReach();
  const at = { x: x + fx * land, z: z + fz * land, range: 0 };
  return [
    { ...base, kind: 'outlet', size: F.culvert },
    { ...base, kind: 'fall', size: F.width },
    { ...base, ...at, kind: 'foam', size: F.foam },
    { ...base, ...at, kind: 'spray', size: F.spray },
  ];
}

/** The streaks' scroll at time `t` (the map's v offset, 0 … 1): it grows with time, so the water falls. */
export function fallScroll(t: number): number {
  const k = (t * LOOK.waterLife.falls.speed) % 1;
  return k < 0 ? k + 1 : k;
}

/** How far out from the wall's face an outlet's stream lands: past the culvert's sill, then `lip` further as it falls. */
export function fallReach(): number {
  const F = LOOK.waterLife.falls;
  return F.culvert * (CULVERT.depth + CULVERT.sill * 0.5) + F.lip;
}

/** How high over the water an outlet's stream leaves the mouth (its lip, a little up from the barrel's floor). */
export function fallTop(range: number): number {
  return range - LOOK.waterLife.falls.culvert * CULVERT.inner * 0.82;
}

/**
 * Where a fish is at time `t`: a slow loop (two sines at different rates) round its spot, never further out than its
 * range, heading the way it swims. Its shoal-mates (`yaw` holds each one's place) follow the same loop a little behind.
 */
export function fishAt(s: LifeSpot, t: number): { x: number; z: number; yaw: number } {
  const L = LOOK.waterLife.fish;
  const r = Math.max(0.05, s.range);
  const w = L.speed / r;
  const tt = t - s.yaw * 0.6;
  const a = tt * w + s.phase;
  const b = tt * w * 0.63 + s.phase * 1.7;
  // 0.68 a side keeps the whole loop (corners too) inside its range
  const x = s.x + r * Math.sin(a) * 0.68;
  const z = s.z + r * Math.sin(b) * 0.68;
  const vx = r * w * Math.cos(a);
  const vz = r * w * 0.63 * Math.cos(b);
  // a shoal-mate sits a body length or so to the side of the leader's path
  const side = s.yaw ? (s.yaw > 1.5 ? -1 : 1) * 0.12 : 0;
  const len = Math.hypot(vx, vz) || 1;
  return { x: x - (vz / len) * side, z: z + (vx / len) * side, yaw: Math.atan2(-vz, vx) };
}

/** A leaf's slow orbit round its spot, turning as it goes. */
export function leafAt(s: LifeSpot, t: number): { x: number; z: number; yaw: number } {
  const L = LOOK.waterLife.leaves;
  const a = s.phase + (t * L.turn) / Math.max(0.05, s.range + 0.05);
  return { x: s.x + Math.cos(a) * s.range, z: s.z + Math.sin(a) * s.range, yaw: s.yaw + t * L.turn };
}

/** A fleck drifting off from its spot for its life, fading in and out (scale 0 … 1), then setting off again. */
export function fleckAt(s: LifeSpot, t: number): { x: number; z: number; k: number } {
  const L = LOOK.waterLife.flecks;
  const cyc = (t / L.life + s.phase / TAU) % 1;
  const n = Math.floor(t / L.life + s.phase / TAU);
  // each life sets off a new way (a fixed turn per life, so it wanders round its spot over time)
  const dir = s.yaw + n * 2.399;
  const go = cyc * s.range;
  return { x: s.x + Math.cos(dir) * go, z: s.z + Math.sin(dir) * go, k: Math.sin(cyc * Math.PI) };
}

/** Whether a fish is rising now (and since when): each fish rises about every `rise` seconds, for one ring. */
export function fishRise(s: LifeSpot, t: number): number | undefined {
  const L = LOOK.waterLife.fish;
  const every = L.rise * (0.7 + 0.6 * ((Math.sin(s.phase * 12.9898) * 43758.5453) % 1 + 1) % 1);
  const ring = 1 / Math.max(1e-3, LOOK.water.disturb.rate);
  const cyc = (t / every + s.phase / TAU + s.yaw * 0.37) % 1;
  if (cyc * every >= ring) return undefined;
  return t - cyc * every;
}

// ── the sources (each chunk's life) ──

const sources = new Map<string, LifeSpot[]>();
let version = 0;

export function setWaterLife(source: string, list: readonly LifeSpot[]) {
  if (!list.length) return clearWaterLife(source);
  sources.set(source, [...list]);
  version++;
}

export function clearWaterLife(source: string) {
  if (sources.delete(source)) version++;
}

export function waterLifeCount(kind?: LifeKind): number {
  let n = 0;
  for (const l of sources.values()) for (const s of l) if (!kind || s.kind === kind) n++;
  return n;
}

export function resetWaterLife() {
  sources.clear();
  version++;
}

/** The spots of each kind within `radius` of (x, z), nearest first, at most `max` of each. */
export function nearestLife(x: number, z: number, radius: number, max: Record<string, number>): Map<LifeKind, LifeSpot[]> {
  const by = new Map<LifeKind, { d: number; s: LifeSpot }[]>();
  const r2 = radius * radius;
  for (const l of sources.values())
    for (const s of l) {
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d > r2) continue;
      let a = by.get(s.kind);
      if (!a) by.set(s.kind, (a = []));
      a.push({ d, s });
    }
  const out = new Map<LifeKind, LifeSpot[]>();
  for (const k of LIFE_KINDS) {
    const a = by.get(k) ?? [];
    const cap = max[k.replace(/\d$/, '')] ?? 0;
    if (a.length > cap) a.sort((p, q) => p.d - q.d);
    out.set(
      k,
      a.slice(0, cap).map((e) => e.s),
    );
  }
  return out;
}

/** Writes a placement (turn about y, then scale, then move) into `m` at `o`, column-major as the engine reads it. */
export function placeMatrix(m: Float32Array, o: number, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  m[o] = c * sx;
  m[o + 1] = 0;
  m[o + 2] = -s * sx;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = sy;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = s * sz;
  m[o + 9] = 0;
  m[o + 10] = c * sz;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

// ── the meshes (unit size, flat on y = 0 unless they stand) ──

type Geo = { pos: number[]; col: number[]; idx: number[]; nrm?: number[]; uv?: number[] };
const rgb = (hex: string, k = 1): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) * k, ((n >> 8) & 255) * k, (n & 255) * k].map((v) => Math.min(255, Math.round(v))) as [number, number, number];
};
function vert(g: Geo, x: number, y: number, z: number, c: [number, number, number], alpha = 1) {
  g.pos.push(x, y, z);
  g.col.push(c[0], c[1], c[2], Math.round(255 * Math.max(0, Math.min(1, alpha))));
  return g.pos.length / 3 - 1;
}

type V3 = [number, number, number];
/**
 * A flat face (a convex polygon, its own vertices, its own normal): for the culvert's stones. Its normal is turned to
 * point along `out` (the way the face looks), whatever order its corners come in.
 */
function face(g: Geo, pts: V3[], c: [number, number, number], out: V3) {
  const [a, b, d] = [pts[0], pts[1], pts[pts.length - 1]];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  n = n.map((q) => q / l);
  if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = n.map((q) => -q);
  const first = g.pos.length / 3;
  for (const p of pts) {
    vert(g, p[0], p[1], p[2], c);
    g.nrm!.push(n[0], n[1], n[2]);
  }
  for (let i = 1; i < pts.length - 1; i++) g.idx.push(first, first + i, first + i + 1);
}

/** A lily pad: a disc half a unit round with a notch cut to its middle, lighter toward its centre. */
export function padGeo(colour: string, vein: string): Geo {
  const g: Geo = { pos: [], col: [], idx: [] };
  const mid = vert(g, 0, 0.002, 0, rgb(vein));
  const n = 16;
  const notch = 0.42;
  const ring: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = notch / 2 + (i / n) * (TAU - notch);
    const r = 0.5 * (0.96 + 0.04 * Math.cos(i * 2.7));
    ring.push(vert(g, Math.cos(a) * r, 0, Math.sin(a) * r, rgb(colour, 0.94 + 0.06 * (i % 2))));
  }
  for (let i = 0; i < n; i++) g.idx.push(mid, ring[i + 1], ring[i]);
  return g;
}

/** A water-lily flower: two rings of pointed petals round a gold heart, a unit across. */
export function flowerGeo(petal: string, heart: string): Geo {
  const g: Geo = { pos: [], col: [], idx: [] };
  const P = rgb(petal);
  const Pl = rgb(petal, 1.12);
  for (const [n, r, h, off] of [
    [8, 0.5, 0.22, 0],
    [6, 0.32, 0.36, 0.4],
  ] as const)
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * TAU;
      const w = (TAU / n) * 0.42;
      const b = vert(g, 0, 0.02, 0, P);
      const l = vert(g, Math.cos(a - w) * r * 0.45, h * 0.35, Math.sin(a - w) * r * 0.45, P);
      const tip = vert(g, Math.cos(a) * r, h, Math.sin(a) * r, Pl);
      const rr = vert(g, Math.cos(a + w) * r * 0.45, h * 0.35, Math.sin(a + w) * r * 0.45, P);
      g.idx.push(b, tip, l, b, rr, tip);
    }
  const H = rgb(heart);
  const c = vert(g, 0, 0.3, 0, H);
  const ring: number[] = [];
  for (let i = 0; i < 6; i++) ring.push(vert(g, Math.cos((i / 6) * TAU) * 0.12, 0.24, Math.sin((i / 6) * TAU) * 0.12, H));
  for (let i = 0; i < 6; i++) g.idx.push(c, ring[(i + 1) % 6], ring[i]);
  return g;
}

/** A leaf: pointed at both ends along x, a unit long, its midrib a shade darker. */
export function leafGeo(colour: string): Geo {
  const g: Geo = { pos: [], col: [], idx: [] };
  const C = rgb(colour);
  const D = rgb(colour, 0.82);
  const tip = vert(g, 0.5, 0, 0, D);
  const stem = vert(g, -0.5, 0, 0, D);
  const side: [number, number][] = [
    [-0.25, 0.17],
    [0.05, 0.2],
    [0.3, 0.13],
  ];
  const up = side.map(([x, z]) => vert(g, x, 0.004, z, C));
  const dn = side.map(([x, z]) => vert(g, x, 0.004, -z, C));
  const mids = [stem, vert(g, -0.25, 0.006, 0, D), vert(g, 0.05, 0.006, 0, D), vert(g, 0.3, 0.006, 0, D), tip];
  for (let i = 0; i < 4; i++) {
    const a = i === 0 ? stem : up[i - 1];
    const b = i === 3 ? tip : up[i];
    g.idx.push(mids[i], b, a, mids[i], mids[i + 1], b);
    const c = i === 0 ? stem : dn[i - 1];
    const e = i === 3 ? tip : dn[i];
    g.idx.push(mids[i], c, e, mids[i], e, mids[i + 1]);
  }
  return g;
}

/** A fish seen from above: a rounded head at +x, the body narrowing to a forked tail, a unit long. */
export function fishGeo(): Geo {
  const g: Geo = { pos: [], col: [], idx: [] };
  const c: [number, number, number] = [255, 255, 255];
  const outline: [number, number][] = [
    [0.5, 0],
    [0.44, 0.07],
    [0.3, 0.11],
    [0.1, 0.11],
    [-0.12, 0.07],
    [-0.28, 0.03],
    [-0.5, 0.13],
    [-0.44, 0],
    [-0.5, -0.13],
    [-0.28, -0.03],
    [-0.12, -0.07],
    [0.1, -0.11],
    [0.3, -0.11],
    [0.44, -0.07],
  ];
  const mid = vert(g, 0.05, 0, 0, c);
  const ring = outline.map(([x, z]) => vert(g, x, 0, z, c));
  for (let i = 0; i < ring.length; i++) g.idx.push(mid, ring[i], ring[(i + 1) % ring.length]);
  return g;
}

/** A fleck: a small soft disc, a unit across. */
export function fleckGeo(): Geo {
  const g: Geo = { pos: [], col: [], idx: [] };
  const c: [number, number, number] = [255, 255, 255];
  const mid = vert(g, 0, 0, 0, c);
  const ring: number[] = [];
  for (let i = 0; i < 7; i++) ring.push(vert(g, Math.cos((i / 7) * TAU) * 0.5, 0, Math.sin((i / 7) * TAU) * 0.5, c));
  for (let i = 0; i < 7; i++) g.idx.push(mid, ring[(i + 1) % 7], ring[i]);
  return g;
}

/** An arrowhead clump: three stalks from the water, each with an arrow-shaped leaf, a unit tall. */
export function plantGeo(stalk: string, leaf: string): Geo {
  const g: Geo = { pos: [], col: [], idx: [] };
  const S = rgb(stalk);
  const L = rgb(leaf);
  const Ld = rgb(leaf, 0.85);
  const quad = (a: number, b: number, c: number, d: number) => g.idx.push(a, b, c, a, c, d, a, c, b, a, d, c);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    const lean = 0.12 + 0.05 * i;
    const h = 0.7 + 0.15 * i;
    const bx = Math.cos(a) * 0.08;
    const bz = Math.sin(a) * 0.08;
    const tx = bx + Math.cos(a) * lean;
    const tz = bz + Math.sin(a) * lean;
    const w = 0.025;
    // the stalk: a thin ribbon facing across its lean
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    quad(vert(g, bx - px, -0.15, bz - pz, S), vert(g, bx + px, -0.15, bz + pz, S), vert(g, tx + px * 0.6, h, tz + pz * 0.6, S), vert(g, tx - px * 0.6, h, tz - pz * 0.6, S));
    // the arrow leaf, tipped out and up from the top of the stalk
    const ox = Math.cos(a);
    const oz = Math.sin(a);
    const sx = -Math.sin(a);
    const sz = Math.cos(a);
    const top = vert(g, tx + ox * 0.22, h + 0.22, tz + oz * 0.22, L);
    const base = vert(g, tx, h, tz, Ld);
    const l1 = vert(g, tx + sx * 0.13 - ox * 0.05, h + 0.02, tz + sz * 0.13 - oz * 0.05, L);
    const r1 = vert(g, tx - sx * 0.13 - ox * 0.05, h + 0.02, tz - sz * 0.13 - oz * 0.05, L);
    const l2 = vert(g, tx + sx * 0.1 - ox * 0.2, h - 0.1, tz + sz * 0.1 - oz * 0.2, Ld);
    const r2 = vert(g, tx - sx * 0.1 - ox * 0.2, h - 0.1, tz - sz * 0.1 - oz * 0.2, Ld);
    g.idx.push(base, top, l1, base, l1, top, base, r1, top, base, top, r1);
    g.idx.push(base, l1, l2, base, l2, l1, base, r2, r1, base, r1, r2);
  }
  return g;
}

/**
 * An outlet's stream: two sheets a unit wide (z) leaving the mouth (x = 0) at its top (y = 1) and curving down and out
 * to x = 1 at the water (y = 0), as water poured over a lip falls. The front sheet is narrower and its streaks are
 * finer (its `uv` runs further), so the two scroll past each other. Alpha thins toward the edges and the foot, where it
 * breaks up; normals face out and up, so the sheet catches the light.
 */
export function fallGeo(): Geo & { uv: number[]; nrm: number[] } {
  const g: Geo & { uv: number[]; nrm: number[] } = { pos: [], col: [], idx: [], uv: [], nrm: [] };
  const c: [number, number, number] = [255, 255, 255];
  const rows = 12;
  for (const [layer, wide, out, vk, uk] of [
    [0, 1, 0, 1, 0],
    [1, 0.62, 0.05, 1.7, 0.37],
  ] as const) {
    const first = g.pos.length / 3;
    for (let j = 0; j <= rows; j++) {
      const u = j / rows;
      const k = 0.5 / Math.max(0.08, Math.sqrt(u));
      const l = Math.hypot(1, k);
      for (const w of [-0.5, -0.25, 0, 0.25, 0.5]) {
        // narrow at the lip, spreading as it falls; thinner at its edges and as it breaks up near the water
        const edge = 1 - Math.pow(Math.abs(w) * 2, 2) * 0.7;
        vert(g, Math.sqrt(u) + out * (1 - u), 1 - u, w * wide * (0.85 + 0.3 * u), c, edge * (1 - 0.5 * u * u) * (layer ? 0.8 : 1));
        g.uv.push(w + 0.5 + uk, u * vk);
        g.nrm.push(1 / l, k / l, 0);
      }
    }
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < 4; i++) {
        const a = first + j * 5 + i;
        g.idx.push(a, a + 5, a + 1, a + 1, a + 5, a + 6);
      }
  }
  return g;
}

/**
 * Foam where a stream lands: froth a unit across, its bubbles clumped (alpha that varies from vertex to vertex), thick
 * in the middle and thinning to nothing at its rim, so it melts into the water round it rather than sitting on it.
 */
export function foamGeo(): Geo {
  const g: Geo = { pos: [], col: [], idx: [] };
  const c: [number, number, number] = [255, 255, 255];
  const rnd = tileRng(5, 9, 13);
  const n = 24;
  // (radius, alpha at its thickest): the froth thins outward
  const rings = [
    [0, 0.8],
    [0.08, 0.8],
    [0.17, 0.75],
    [0.26, 0.6],
    [0.35, 0.4],
    [0.43, 0.18],
    [0.5, 0],
  ];
  const mid = vert(g, 0, 0, 0, c, rings[0][1]);
  const jag = Array.from({ length: n }, () => 0.8 + rnd() * 0.4);
  let prev: number[] = [];
  for (let r = 1; r < rings.length; r++) {
    const [rad, a] = rings[r];
    const ring: number[] = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + r * 0.13;
      const rr = rad * jag[(i + r) % n];
      // clumps of bubbles: some points nearly clear, some thick
      const froth = r === rings.length - 1 ? 0 : 0.25 + 0.75 * rnd();
      ring.push(vert(g, Math.cos(ang) * rr, 0, Math.sin(ang) * rr, c, a * froth));
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (r === 1) g.idx.push(mid, ring[j], ring[i]);
      else g.idx.push(prev[i], ring[j], ring[i], prev[i], prev[j], ring[j]);
    }
    prev = ring;
  }
  return g;
}

/** Spray at a stream's foot: three soft upright puffs crossed round the middle, a unit across and a unit tall. */
export function sprayGeo(): Geo {
  const g: Geo = { pos: [], col: [], idx: [] };
  const c: [number, number, number] = [255, 255, 255];
  const n = 10;
  for (let p = 0; p < 3; p++) {
    const a = (p / 3) * Math.PI;
    const ax = Math.cos(a);
    const az = Math.sin(a);
    const mid = vert(g, 0, 0.3, 0, c, 0.55);
    const ring: number[] = [];
    for (let i = 0; i < n; i++) {
      // a dome: wide at the water, rounded over the top
      const t = (i / n) * TAU;
      const s = Math.cos(t) * 0.5;
      const h = Math.max(0, Math.sin(t)) * 0.7 + 0.3 - (Math.sin(t) < 0 ? 0.3 : 0);
      ring.push(vert(g, ax * s, h, az * s, c, 0));
    }
    for (let i = 0; i < n; i++) g.idx.push(mid, ring[(i + 1) % n], ring[i]);
  }
  return g;
}

/**
 * A culvert set in a wall face (the plane x = 0; the water lies toward +x), a unit across: a ring of stone voussoirs
 * standing proud of the wall with a keystone at the top, mortar between them, a dark barrel running back into the
 * wall (darkest at its far end) and a stone sill under the mouth that the water pours over. All flat-shaded stone.
 */
export function outletGeo(stone: string, mouth: string): Geo & { nrm: number[] } {
  const g: Geo & { nrm: number[] } = { pos: [], col: [], idx: [], nrm: [] };
  const { inner: ri, outer: ro, depth: d, sill } = CULVERT;
  const p = (r: number, a: number, x: number): V3 => [x, Math.sin(a) * r, Math.cos(a) * r];
  const M = rgb(mouth);
  const n = 11;
  const gap = 0.05;
  // mortar behind the stones (it shows in the joints)
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * TAU;
    const a1 = ((i + 1) / 24) * TAU;
    face(g, [p(ri, a0, 0.005), p(ri, a1, 0.005), p(ro * 1.04, a1, 0.005), p(ro * 1.04, a0, 0.005)], rgb(stone, 0.5), [1, 0, 0]);
  }
  // the voussoirs, the keystone (i = 0) at the top
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI / 2 + ((i - 0.5) / n) * TAU + gap / 2;
    const a1 = Math.PI / 2 + ((i + 0.5) / n) * TAU - gap / 2;
    const key = i === 0;
    const o = ro * (key ? 1.1 : 1 + 0.03 * ((i * 7) % 3 - 1));
    const x = d + (key ? 0.03 : 0.01 * ((i * 5) % 3));
    const col = rgb(stone, key ? 1.05 : [1, 0.93, 0.97, 0.9][i % 4]);
    const shade = rgb(stone, 0.72);
    // front, outer edge, both joint faces (the inner edge is the barrel's lip, below)
    for (let k = 0; k < 2; k++) {
      const b0 = a0 + ((a1 - a0) * k) / 2;
      const b1 = a0 + ((a1 - a0) * (k + 1)) / 2;
      const bm = (b0 + b1) / 2;
      face(g, [p(ri, b0, x), p(o, b0, x), p(o, b1, x), p(ri, b1, x)], col, [1, 0, 0]);
      face(g, [p(o, b0, x), p(o, b0, 0), p(o, b1, 0), p(o, b1, x)], shade, [0, Math.sin(bm), Math.cos(bm)]);
    }
    // the joints face along the ring, away from the stone's middle
    face(g, [p(ri, a0, 0), p(o, a0, 0), p(o, a0, x), p(ri, a0, x)], shade, [0, -Math.cos(a0), Math.sin(a0)]);
    face(g, [p(ri, a1, x), p(o, a1, x), p(o, a1, 0), p(ri, a1, 0)], shade, [0, Math.cos(a1), -Math.sin(a1)]);
  }
  // the barrel: from the stones' face back to the wall's, dark, its roof catching a little light; then its throat on
  // the wall's face (the wall itself is solid behind it), near black in the middle, so the mouth reads as deep
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * TAU;
    const a1 = ((i + 1) / 16) * TAU;
    const lit = 1.3 + 0.9 * Math.max(0, Math.sin((a0 + a1) / 2));
    face(g, [p(ri, a0, d), p(ri, a1, d), p(ri, a1, 0.006), p(ri, a0, 0.006)], rgb(mouth, lit), [0, -Math.sin((a0 + a1) / 2), -Math.cos((a0 + a1) / 2)]);
  }
  const throat = vert(g, 0.007, 0, 0, rgb(mouth, 0.25));
  g.nrm.push(1, 0, 0);
  const rim: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * TAU;
    rim.push(vert(g, 0.007, Math.sin(a) * ri, Math.cos(a) * ri, rgb(mouth, 0.9)));
    g.nrm.push(1, 0, 0);
  }
  for (let i = 0; i < 16; i++) g.idx.push(throat, rim[i], rim[i + 1]);
  // the wall round it, darker with the wet that seeps from it
  const wet: number[] = [];
  const dry: number[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * TAU;
    // the stain runs further down than up
    const k = 1 + 0.5 * Math.max(0, -Math.sin(a));
    wet.push(vert(g, 0.003, Math.sin(a) * ro * 1.02, Math.cos(a) * ro * 1.02, rgb(stone, 0.45)));
    g.nrm.push(1, 0, 0);
    dry.push(vert(g, 0.003, Math.sin(a) * ro * 1.35 * k, Math.cos(a) * ro * 1.3, rgb(stone, 0.45), 0));
    g.nrm.push(1, 0, 0);
  }
  for (let i = 0; i < 24; i++) g.idx.push(wet[i], dry[i], dry[i + 1], wet[i], dry[i + 1], wet[i + 1]);
  // the sill the water pours over: a slab under the mouth, its top a little up the barrel's floor
  const top = -ri * 0.82;
  const w = ri * 0.95;
  const x1 = d + sill;
  const S = rgb(stone, 0.94);
  const Sd = rgb(stone, 0.7);
  face(g, [[0, top, -w], [0, top, w], [x1, top, w], [x1, top, -w]], S, [0, 1, 0]);
  face(g, [[x1, top, -w], [x1, top, w], [x1, top - 0.08, w], [x1, top - 0.08, -w]], Sd, [1, 0, 0]);
  face(g, [[0, top, w], [0, top - 0.08, w], [x1, top - 0.08, w], [x1, top, w]], Sd, [0, 0, 1]);
  face(g, [[0, top, -w], [x1, top, -w], [x1, top - 0.08, -w], [0, top - 0.08, -w]], Sd, [0, 0, -1]);
  void M;
  return g;
}

/**
 * The streaks a stream scrolls through: soft vertical runs of more and less water. Its colour runs from `tint` between
 * the runs to white in their cores, and its alpha from a little to nearly solid.
 */
function streakTexture(device: pc.GraphicsDevice, tint: string): pc.Texture {
  const W = 32;
  const H = 64;
  const tex = new pc.Texture(device, { name: 'water-life-streaks', width: W, height: H, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, addressU: pc.ADDRESS_REPEAT, addressV: pc.ADDRESS_REPEAT });
  const px = tex.lock() as Uint8Array;
  const rnd = tileRng(3, 5, 11);
  const T = rgb(tint);
  const cols = Array.from({ length: W }, () => [rnd() * TAU, 2 + Math.floor(rnd() * 3), 0.45 + rnd() * 0.35, rnd() * TAU, 5 + Math.floor(rnd() * 4)]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [ph, k, base, ph2, k2] = cols[x];
      // whole cycles down the texture, so it wraps without a seam: long runs with finer ripples in them
      const v = base + 0.45 * Math.sin((y / H) * TAU * k + ph) + 0.15 * Math.sin((y / H) * TAU * k2 + ph2);
      const s = Math.max(0, Math.min(1, v));
      const core = s * s;
      const i = (y * W + x) * 4;
      px[i] = Math.round(T[0] + (255 - T[0]) * core);
      px[i + 1] = Math.round(T[1] + (255 - T[1]) * core);
      px[i + 2] = Math.round(T[2] + (255 - T[2]) * core);
      px[i + 3] = Math.round(255 * (0.4 + 0.6 * s));
    }
  tex.unlock();
  return tex;
}

function meshOf(device: pc.GraphicsDevice, g: Geo & { uv?: number[] }): pc.Mesh {
  const m = new pc.Mesh(device);
  m.setPositions(g.pos);
  if (g.uv) m.setUvs(0, g.uv);
  // flat things face up; the standing plant is lit as if from above too (soft, no hard facets); the culvert's stones
  // and the stream bring their own
  m.setNormals(g.nrm ?? g.pos.map((_, i) => (i % 3 === 1 ? 1 : 0)));
  m.setColors32(g.col);
  m.setIndices(g.idx);
  m.update(pc.PRIMITIVE_TRIANGLES);
  return m;
}

/** What WaterLife needs each frame. */
export interface WaterLifeFrame {
  /** the water's clock (WaterSurface's uWaterTime: held still for reduced motion) */
  time: number;
  /** the transition clock (restores fade in by it) */
  trTime: number;
  /** where the camera looks */
  focus: { x: number; z: number };
  /** 0 day … 1 night */
  night: number;
}

interface Slot {
  mi: pc.MeshInstance;
  mat: pc.StandardMaterial;
  vb?: pc.VertexBuffer;
  data: Float32Array;
  cap: number;
  spots: LifeSpot[];
}

export class WaterLife {
  private slots = new Map<LifeKind, Slot>();
  private at?: { x: number; z: number; v: number };
  private rising = '';
  private night = -1;
  private fallMat: pc.StandardMaterial;
  /** the stream, its foam and its spray: their light of their own fades out as the day does */
  private splash: pc.StandardMaterial[] = [];
  /** the drifting flecks are particles: off on the Low tier and with Fewer particles, as the air's motes are */
  particles = true;

  constructor(
    device: pc.GraphicsDevice,
    parent: pc.Entity,
    layer?: number,
  ) {
    const L = LOOK.waterLife;
    const lit = (cull: number = pc.CULLFACE_BACK) => {
      const m = new pc.StandardMaterial();
      m.diffuseVertexColor = true;
      m.diffuse = new pc.Color(1, 1, 1);
      // leaves and petals: a soft sheen, never the white shine that washed the first pads out
      m.specular = new pc.Color(0.06, 0.06, 0.06);
      m.gloss = 0.4;
      m.cull = cull;
      m.update();
      return m;
    };
    const ghost = (hex: string, opacity: number) => {
      const m = new pc.StandardMaterial();
      m.useLighting = false;
      m.diffuse = new pc.Color(0, 0, 0);
      m.emissive = new pc.Color().fromString(hex);
      m.opacity = opacity;
      m.blendType = pc.BLEND_NORMAL;
      m.depthWrite = false;
      m.useFog = true;
      m.update();
      return m;
    };
    // the outlets' water: lit like the world (so it is moonlit by night, never glowing), with a glossy sheen that
    // catches the sun, and a touch of its own light by day only (`glow`, see `update`)
    const water = (opacity: number) => {
      const m = new pc.StandardMaterial();
      m.diffuse = new pc.Color().fromString(L.falls.colour);
      m.specular = new pc.Color(L.falls.sheen, L.falls.sheen, L.falls.sheen);
      m.gloss = 0.85;
      m.opacity = opacity;
      m.opacityVertexColor = true;
      m.opacityVertexColorChannel = 'a';
      m.blendType = pc.BLEND_NORMAL;
      m.depthWrite = false;
      m.cull = pc.CULLFACE_NONE;
      // one-sided lighting: the sheets' and foam's normals already face out to the water and up. Two-sided lighting
      // turned them into the wall for whichever side the engine called the back, where they took the warm bounce
      // off the ground: an amber stream under a blue moonlit night (the send-back on #707)
      m.useFog = true;
      return m;
    };
    // the stream: streaks scrolling down two sheets
    const fm = water(L.falls.opacity);
    const streaks = streakTexture(device, L.falls.tint);
    fm.diffuseMap = streaks;
    fm.opacityMap = streaks;
    fm.opacityMapChannel = 'a';
    fm.update();
    this.fallMat = fm;
    const foamMat = water(L.falls.opacity * 0.85);
    foamMat.update();
    const sprayMat = water(L.falls.opacity * 0.6);
    sprayMat.update();
    this.splash = [fm, foamMat, sprayMat];
    // the culvert: stone, solid, but the wet stain round it fades into the wall (its vertex alpha)
    const culvertMat = lit(pc.CULLFACE_NONE);
    culvertMat.opacityVertexColor = true;
    culvertMat.opacityVertexColorChannel = 'a';
    culvertMat.blendType = pc.BLEND_NORMAL;
    culvertMat.depthWrite = true;
    culvertMat.update();
    const geos: Record<LifeKind, [Geo, pc.StandardMaterial]> = {
      pad0: [padGeo(L.pads.colours[0], L.pads.vein), lit()],
      pad1: [padGeo(L.pads.colours[1], L.pads.vein), lit()],
      flower: [flowerGeo(L.pads.flower, L.pads.flowerCore), lit(pc.CULLFACE_NONE)],
      leaf0: [leafGeo(L.leaves.colours[0]), lit(pc.CULLFACE_NONE)],
      leaf1: [leafGeo(L.leaves.colours[1]), lit(pc.CULLFACE_NONE)],
      fish: [fishGeo(), ghost(L.fish.colour, L.fish.opacity)],
      fleck: [fleckGeo(), ghost(L.flecks.colour, L.flecks.opacity)],
      plant: [plantGeo(L.plants.stalk, L.plants.leaf), lit(pc.CULLFACE_NONE)],
      fall: [fallGeo(), this.fallMat],
      foam: [foamGeo(), foamMat],
      spray: [sprayGeo(), sprayMat],
      outlet: [outletGeo(L.falls.stone, L.falls.mouth), culvertMat],
    };
    const fmt = pc.VertexFormat.getDefaultInstancingFormat(device);
    for (const k of LIFE_KINDS) {
      const [g, mat] = geos[k];
      const mi = new pc.MeshInstance(meshOf(device, g), mat);
      const cap = (L.max as Record<string, number>)[k.replace(/\d$/, '')];
      const vb = new pc.VertexBuffer(device, fmt, cap, { usage: pc.BUFFER_DYNAMIC });
      mi.setInstancing(vb);
      mi.instancingCount = 0;
      // instances sit anywhere round the camera: no culling by the unit mesh's own bounds
      mi.cull = false;
      mi.visible = false;
      const e = new pc.Entity(`water-life-${k}`);
      e.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: k !== 'fish' && k !== 'fleck' && k !== 'fall' && k !== 'foam' && k !== 'spray', layers: layer !== undefined ? [layer] : [pc.LAYERID_WORLD] });
      parent.addChild(e);
      this.slots.set(k, { mi, mat, vb, data: new Float32Array(cap * 16), cap, spots: [] });
    }
  }

  update(f: WaterLifeFrame) {
    const L = LOOK.waterLife;
    const v = lifeVersion();
    if (!this.at || this.at.v !== v || Math.abs(this.at.x - f.focus.x) + Math.abs(this.at.z - f.focus.z) > 1) {
      const near = nearestLife(f.focus.x, f.focus.z, L.radius, L.max);
      for (const [k, s] of this.slots) s.spots = near.get(k) ?? [];
      this.at = { x: f.focus.x, z: f.focus.z, v };
    }
    // fish and flecks see less of themselves by night
    const night = Math.min(1, Math.max(0, f.night));
    if (Math.abs(night - this.night) > 0.02) {
      this.night = night;
      const fish = this.slots.get('fish')!.mat;
      fish.opacity = L.fish.opacity + (L.fish.nightOpacity - L.fish.opacity) * night;
      fish.update();
      const fleck = this.slots.get('fleck')!.mat;
      fleck.opacity = L.flecks.opacity + (L.flecks.nightOpacity - L.flecks.opacity) * night;
      fleck.update();
      // the stream, its foam and spray: lit like the world, with a little light of their own by day only
      const own = new pc.Color().fromString(L.falls.colour).mulScalar(L.falls.glow * (1 - night));
      // by night the pale stream turns the canal's moonlit blue-grey and loses most of its sheen, so it can't
      // read as a lamp under the wall
      const day = new pc.Color().fromString(L.falls.colour);
      const dark = new pc.Color().fromString(L.falls.nightColour);
      const diffuse = new pc.Color().lerp(day, dark, night);
      const sheen = L.falls.sheen * (1 - 0.6 * night);
      for (const [i, m] of this.splash.entries()) {
        // the foam and spray lie in the sun already: half as much of their own as the stream (in the wall's shade)
        m.emissive = i ? own.clone().mulScalar(0.5) : own;
        m.diffuse = diffuse;
        m.specular = new pc.Color(sheen, sheen, sheen);
        m.update();
      }
    }
    const t = f.time;
    // the streams' streaks run down
    if (this.slots.get('fall')!.spots.length) {
      // the streaks run down the sheet (its v grows downward): the engine flips a map's v offset (it stores
      // 1 - tiling - offset), so a growing offset moves the pattern down the screen. Checked in motion by
      // shore-shots STRIP_MS (the owner saw it running up with the sign the other way)
      const run = new pc.Vec2(0, fallScroll(t));
      this.fallMat.diffuseMapOffset = run;
      this.fallMat.opacityMapOffset = run;
      this.fallMat.update();
    }
    const rises: WaterDisturber[] = [];
    let key = '';
    for (const [k, slot] of this.slots) {
      if (k === 'fleck' && !this.particles) {
        slot.mi.instancingCount = 0;
        slot.mi.visible = false;
        continue;
      }
      const m = slot.data;
      let n = 0;
      for (const s of slot.spots) {
        const grow = waterFade(f.trTime, s.t0, s.d);
        if (grow <= 0.001) continue;
        let x = s.x;
        let z = s.z;
        let yaw = s.yaw;
        let k2 = grow;
        if (k === 'fish') {
          const p = fishAt(s, t);
          x = p.x;
          z = p.z;
          yaw = p.yaw;
          const since = fishRise(s, t);
          if (since !== undefined && s.yaw === 0) {
            // the shoal's leader rises (once per ring), where it was when it rose
            const at = fishAt(s, since);
            rises.push({ x: at.x, z: at.z, r: 0.02, strength: L.fish.ring });
            key += `${at.x.toFixed(2)},${at.z.toFixed(2)};`;
          }
        } else if (k === 'leaf0' || k === 'leaf1') {
          const p = leafAt(s, t);
          x = p.x;
          z = p.z;
          yaw = p.yaw;
        } else if (k === 'fleck') {
          const p = fleckAt(s, t);
          x = p.x;
          z = p.z;
          k2 *= p.k;
        } else if (k === 'outlet') {
          // in the wall's face, the mouth's middle `range` over the water
          placeMatrix(m, n * 16, x, s.y + s.range, z, yaw, s.size * grow, s.size * grow, s.size * grow);
          n++;
          continue;
        } else if (k === 'fall') {
          // from the sill's edge down and out to the water
          const out = L.falls.culvert * (CULVERT.depth + CULVERT.sill);
          const fx = Math.cos(yaw);
          const fz = -Math.sin(yaw);
          const reach = fallReach() - out + L.falls.culvert * CULVERT.sill * 0.5;
          placeMatrix(m, n * 16, x + fx * out, s.y, z + fz * out, yaw, reach * grow, fallTop(s.range) * grow, s.size * grow);
          n++;
          continue;
        } else if (k === 'foam') {
          // two layers churning round each other, breathing a little
          for (const [turn, k3] of [
            [0.7, 1],
            [-1.1, 0.68],
          ] as const) {
            if (n >= slot.cap) break;
            const b = 0.92 + 0.08 * Math.sin(t * 2.3 * k3 + s.x * 3.1);
            placeMatrix(m, n * 16, x, s.y + 0.006 + (k3 < 1 ? 0.002 : 0), z, s.yaw + t * turn, s.size * k3 * b * grow, 1, s.size * k3 * b * grow);
            n++;
          }
          continue;
        } else if (k === 'spray') {
          const b = 0.85 + 0.15 * Math.sin(t * 5.1 + s.z * 2.3);
          placeMatrix(m, n * 16, x, s.y, z, t * 0.4, s.size * grow, s.size * 0.8 * b * grow, s.size * grow);
          n++;
          continue;
        }
        else if (k !== 'plant') yaw = s.yaw + Math.sin(t * L.pads.turn + s.phase) * 0.6;
        // floating things ride the swell (plants stand rooted in the shallows, foam at a wall's foot, where it has eased off)
        const lift = k === 'plant' ? 0 : waterWaves(x, z, t, s.edge);
        // fish show just under the surface's own height (drawn over it, seen through it); the rest sit on it
        const y = s.y + lift + (k === 'fish' ? 0.004 : k === 'fleck' ? 0.006 : k === 'flower' ? 0.012 : 0.008);
        const sz = s.size * k2;
        placeMatrix(m, n * 16, x, y, z, yaw, sz, k === 'plant' || k === 'flower' ? sz : 1, sz);
        n++;
      }
      slot.mi.instancingCount = n;
      slot.mi.visible = n > 0;
      if (n) slot.vb!.setData(m);
    }
    if (key !== this.rising) {
      this.rising = key;
      setWaterDisturbers('fish', rises);
    }
  }

  destroy() {
    for (const s of this.slots.values()) {
      s.vb?.destroy();
      s.mi.mesh?.destroy();
    }
    setWaterDisturbers('fish', []);
  }
}

/** Changes every time any chunk's life changes. */
export function lifeVersion(): number {
  return version;
}
