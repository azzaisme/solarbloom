/**
 * P7-E30 (#716): terrain dressing. The showcase waterfall off the Falls overlook (#745), Saltwind's stepped, rocky,
 * mossy walls (#743) and the wasteland's cracked earth, broken paths and derelict debris (#758).
 *
 * Looks only. Every choice is a pure function of the cell and its restoration; nothing is saved or read by the
 * simulation. Tunables: `TERRAIN` (data/terrain.ts). The chunk renderer calls in from two marked hooks
 * (`terrace` and the dead-ground branch of `dressTile`); everything lands in the chunk's merged mesh, and the moving
 * water goes to WaterLife as spots, so none of it adds a draw call.
 */
import type { TileData } from '../core/types';
import { levelY } from '../core/Height';
import { LOOK } from '../data/look';
import { TERRAIN } from '../data/terrain';
import { PALETTE } from './Palette';
import type { Sink } from './transitions/TransitionRenderer';
import { WATER } from './Water';
import type { LifeSpot } from './WaterLife';

const T = PALETTE.terrain;
const F = TERRAIN.fall;
const O = TERRAIN.overlook;

/** A seeded 0…1 per cell and salt (the same hash family the rest of the dressing uses). */
export function cellHash(x: number, z: number, salt: number): number {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ───────────── the showcase fall (#745) ─────────────

/** The cell the whole fall is drawn from (the rill's west cell on the lip row). */
export const FALL_ANCHOR = { x: F.source.x, z: O.z + O.d - 1 } as const;

/** Is (x, z)'s edge facing (dx, dz) the fall's lip (the overlook's south edge over the canal's head)? */
export function fallLip(x: number, z: number, dx: number, dz: number): boolean {
  return dx === 0 && dz === 1 && z === F.lip - 1 && x >= F.source.x && x < F.source.x + F.source.w;
}

/** How full the fall runs, 0 (its source dead: a trickle) … 1 (all of it restored): the share of its source restored. */
export function fallFlow(peek: (x: number, z: number) => Pick<TileData, 'ground'> | undefined): number {
  const s = F.source;
  let n = 0;
  let live = 0;
  for (let z = s.z; z < s.z + s.d; z++)
    for (let x = s.x; x < s.x + s.w; x++) {
      n++;
      if (peek(x, z)?.ground === 'restored') live++;
    }
  return n ? live / n : 0;
}

export interface FallParts {
  life: LifeSpot[];
  rocks: { x: number; z: number; r: number; strength: number }[];
  /** the sheet's width, its drop and where it lands (for tests) */
  width: number;
  drop: number;
  foot: { x: number; y: number; z: number };
}

/**
 * The fall, drawn once from its anchor cell: the spring and its rill across the overlook (dry and cracked while the
 * source is dead), the lip, the wet face behind the sheet with moss either side, rocks at the plunge; and its moving
 * water as WaterLife spots (the rill, the sheet, foam across the plunge and mist), all scaled by `flow`.
 * `h` is the chunk's base height (the overlook's top is level 2 over it, the canal's water level 0).
 */
export function showcaseFall(b: Sink, h: number, flow: number): FallParts {
  const W = LOOK.wall;
  const top = h + levelY(O.level) + 0.08;
  const water = h + levelY(0) + 0.08 - WATER.drop + 0.003;
  const x = F.x;
  const k = Math.max(0, Math.min(1, flow));
  const wet = k > 0;
  const life: LifeSpot[] = [];
  const rocks: FallParts['rocks'] = [];
  const spot = (kind: LifeSpot['kind'], px: number, pz: number, y: number, size: number, range: number, yaw: number, reach?: number): LifeSpot => ({ kind, x: px, z: pz, y, edge: 0, size, range, phase: 0, yaw, t0: -1e6, d: 0, reach });
  const south = -Math.PI / 2; // facing +z, out over the beach

  // the spring: a huddle of mossy boulders with a dark mouth the water wells out of
  const sz = F.spring - 0.28;
  for (const [ox, oz, r, c] of [[-0.34, 0.02, 0.24, 0], [0.33, -0.04, 0.27, 1], [0.0, -0.22, 0.3, 2], [-0.16, -0.32, 0.18, 1]] as const) {
    b.add('sphere', T.rock[c], [x + ox, top + r * 0.32, sz + oz], [r, r * 0.7, r * 0.9]);
    b.add('sphere', wet ? T.moss[c] : T.mossDry, [x + ox, top + r * 0.55, sz + oz - 0.02], [r * 0.8, r * 0.28, r * 0.7]);
  }
  b.add('box', T.rockDark, [x, top + 0.07, sz + 0.13], [0.24, 0.1, 0.04]);

  // the rill: a bed cut between kerbs of rough stone, south to the lip (dry and pale while dead)
  const z0 = F.spring;
  const z1 = F.lip - W.thick / 2;
  const len = z1 - z0;
  b.add('box', wet ? T.rillBed : T.dryBed, [x, top + 0.012, (z0 + z1) / 2], [F.bed, 0.024, len]);
  const stones = Math.max(3, Math.round(len / 0.42));
  for (const side of [-1, 1])
    for (let i = 0; i < stones; i++) {
      const r = cellHash(i, side, 7301);
      const along = z0 + ((i + 0.5) / stones) * len;
      const w = 0.09 + r * 0.04;
      b.add('box', T.rock[(i + (side > 0 ? 1 : 0)) % T.rock.length], [x + side * (F.bed / 2 + w / 2 - 0.01), top + 0.03 + r * 0.012, along], [w, 0.06 + r * 0.025, len / stones + 0.02]);
      if (wet && r < 0.45) b.add('sphere', T.moss[i % T.moss.length], [x + side * (F.bed / 2 + 0.04), top + 0.065, along + 0.06], [0.1, 0.035, 0.12]);
    }
  if (!wet) {
    // a dry bed: a few cracks and a pale silt line down its middle
    for (let i = 0; i < 4; i++) {
      const r = cellHash(i, 3, 7303);
      b.add('box', T.crack, [x + (r - 0.5) * 0.2, top + 0.026, z0 + ((i + 0.5) / 4) * len], [0.02, 0.004, 0.3 + r * 0.25]);
    }
  }
  // the lip: one worn, pale stone across the rill on the wall's coping, the water's edge
  b.add('box', T.lip, [x, top + 0.035, F.lip - W.thick / 2], [F.bed + 0.2, 0.04, W.thick + W.copingLip * 2 + 0.02]);

  // the face behind the sheet: dark and wet down to the water (a damp streak while it only trickles), moss each side
  const face = F.lip + W.thick / 2 + W.courseProud + 0.006;
  const width = F.trickle + (F.full - F.trickle) * k;
  const fallTop = top + 0.055;
  const drop = fallTop - water;
  b.add('box', T.wetFace, [x, (top + water) / 2, face - 0.003], [width + 0.08, top - water + 0.02, 0.012]);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const r = cellHash(i, side, 7311);
      const y = water + 0.3 + (i / 3) * (drop - 0.45);
      b.add('sphere', wet ? T.moss[i % T.moss.length] : T.mossDry, [x + side * (width / 2 + 0.2 + r * 0.12), y, face + 0.02], [0.16 + r * 0.1, 0.12 + r * 0.06, 0.06]);
    }
    // boulders at the plunge, either side, half in the water
    for (let i = 0; i < 2; i++) {
      const r = cellHash(i, side, 7317);
      const bx = x + side * (0.62 + i * 0.22 + r * 0.06);
      const bz = face + 0.18 + i * 0.32 + r * 0.1;
      const s = 0.2 + r * 0.1;
      b.add('sphere', T.rock[(i + 1) % T.rock.length], [bx, water + s * 0.12, bz], [s, s * 0.75, s * 0.9]);
      if (wet) b.add('sphere', T.moss[i % T.moss.length], [bx, water + s * 0.45, bz - 0.02], [s * 0.7, s * 0.2, s * 0.6]);
      rocks.push({ x: bx, z: bz, r: s * 0.6, strength: LOOK.waterLife.falls.ring * 0.4 });
    }
  }

  // a low timber rail along the overlook's lip, either side of the rill: it reads as a lookout from below
  const railZ = F.lip - W.thick / 2 - 0.1;
  const wood = PALETTE.wood;
  for (const [x0, x1] of [[O.x + 0.15, x - F.bed / 2 - 0.12], [x + F.bed / 2 + 0.12, O.x + O.w - 0.15]] as const) {
    const posts = Math.max(2, Math.round((x1 - x0) / 0.7) + 1);
    for (let i = 0; i < posts; i++) b.add('box', wood.deep, [x0 + ((x1 - x0) * i) / (posts - 1), top + 0.2, railZ], [0.07, 0.4, 0.07]);
    b.add('box', wood.mid, [(x0 + x1) / 2, top + 0.38, railZ], [x1 - x0 + 0.06, 0.05, 0.06]);
    b.add('box', wood.mid, [(x0 + x1) / 2, top + 0.2, railZ], [x1 - x0, 0.035, 0.04]);
  }

  // the moving water: the rill (while anything of the source lives), the sheet (a trickle at the least), foam, mist
  if (wet) life.push(spot('sheet', x, z0, top + 0.03, F.water * (0.4 + 0.6 * k), 0.012, south, len + 0.02));
  const reach = Math.max(0.12, drop * F.reach) * (0.55 + 0.45 * k);
  life.push(spot('sheet', x, face, water, width, drop, south, reach));
  const landZ = face + reach;
  const nFoam = Math.max(1, Math.round(F.foam * (0.34 + 0.66 * k)));
  for (let i = 0; i < nFoam; i++) {
    const across = nFoam === 1 ? 0 : (i / (nFoam - 1) - 0.5) * width * 0.75;
    life.push(spot('foam', x + across, landZ + (i % 2) * 0.12, water, F.foamSize * (0.35 + 0.65 * k), 0, i * 1.3));
  }
  rocks.push({ x, z: landZ, r: 0.1 + 0.3 * k, strength: LOOK.waterLife.falls.ring * (0.4 + 0.6 * k) });
  if (k > 0.15)
    for (let i = 0; i < F.mist; i++) {
      const across = (i / Math.max(1, F.mist - 1) - 0.5) * width * 0.9;
      life.push(spot('spray', x + across, landZ + 0.05 + (i % 2) * 0.1, water, F.mistSize * (0.5 + 0.5 * k), 0, i));
    }
  return { life, rocks, width, drop, foot: { x, y: water, z: landZ } };
}

// ───────────── Saltwind's stepped, rocky, mossy walls (#743) ─────────────

/**
 * Dresses one tile edge of a retaining wall over restored beach: a rough step of rock along its foot, boulders
 * against it, a mossy ledge partway up (two on a double-height wall) and moss spilling over the coping. Everything
 * hugs the face (within ~0.3 of it), so bloombot, who stops at the cliff's edge, never walks into it. `top` is the
 * coping's height, `ground` the lower side's; (dx, dz) points from the wall's upper tile down to the lower one.
 */
export function rockyWall(b: Sink, x: number, z: number, dx: number, dz: number, ground: number, top: number, end0: number, end1: number) {
  const W = LOOK.wall;
  const R = TERRAIN.rockyWall;
  const r = (k: number) => cellHash(x * 3 + dx, z * 3 + dz, 7400 + k);
  const ax = dz ? 1 : 0;
  const az = dx ? 1 : 0;
  const face = 0.5 + W.thick / 2 + W.courseProud;
  // a point `along` the edge (−0.5 … 0.5) and `out` from the face
  const at = (along: number, out: number): [number, number] => [x + 0.5 + dx * (face + out) + ax * along, z + 0.5 + dz * (face + out) + az * along];
  // a box `along` the edge, `w` long, standing `out` proud of the face, from y0 to y1
  const slab = (hex: string, along: number, w: number, out: number, y0: number, y1: number, back = 0.02) => {
    const [px, pz] = at(along, (out - back) / 2);
    b.add('box', hex, [px, (y0 + y1) / 2, pz], [dx ? out + back : w, y1 - y0, dz ? out + back : w]);
  };
  const len = 1 + 0.06 * (end0 + end1);
  const shift = (0.06 * (end1 - end0)) / 2;
  const H = top - ground;
  // the foot: two or three rough blocks of rock, stepped, mossy on top
  const n = 2 + Math.floor(r(0) * 2);
  for (let i = 0; i < n; i++) {
    const w = len / n;
    const along = -len / 2 + shift + w * (i + 0.5);
    const h = 0.24 + r(1 + i) * 0.28;
    const out = 0.12 + r(4 + i) * 0.06;
    slab(T.rock[(i + Math.floor(r(7) * 3)) % T.rock.length], along, w + 0.02, out, ground - 0.04, ground + h);
    if (r(8 + i) < R.moss) {
      const [mx, mz] = at(along, out / 2 - 0.01);
      b.add('box', T.moss[i % T.moss.length], [mx, ground + h + 0.012, mz], [dx ? out + 0.01 : w * 0.8, 0.03, dz ? out + 0.01 : w * 0.8]);
    }
  }
  // boulders against the foot (they stay within ~0.35 of the face)
  const [b0, b1] = R.boulders;
  const nb = b0 + Math.floor(r(14) * (b1 - b0 + 1));
  for (let i = 0; i < nb; i++) {
    const s = 0.17 + r(15 + i) * 0.08;
    const along = (r(19 + i) - 0.5) * 0.8;
    const [px, pz] = at(along, 0.12 + s * 0.3);
    b.add('sphere', T.rock[(i + 1) % T.rock.length], [px, ground + s * 0.3, pz], [s * 1.2, s * 0.85, s]);
    if (r(23 + i) < R.moss) b.add('sphere', T.moss[(i + 2) % T.moss.length], [px, ground + s * 0.66, pz], [s * 0.9, s * 0.26, s * 0.8]);
  }
  // mossy ledges: deep rock shelves standing out of the face (two on a double-height wall), so it reads as stepped
  const ledges = H > 1.8 ? [R.ledgeAt * 0.8, R.ledgeAt * 1.55] : [R.ledgeAt + 0.1];
  for (const [j, k] of ledges.entries()) {
    const y = ground + H * k;
    const out = R.ledgeOut * (0.85 + r(30 + j) * 0.3);
    const th = 0.12 + r(32 + j) * 0.06;
    slab(T.rock[j % T.rock.length], shift, len, out, y - th, y);
    // a band of moss along its top, with tufts hanging over its lip
    slab(T.moss[j % T.moss.length], shift + (r(33 + j) - 0.5) * 0.15, len * (0.55 + r(34 + j) * 0.4), out + 0.01, y, y + 0.03, 0);
    const drapes = Math.floor(r(35 + j) * 2);
    for (let i = 0; i < drapes; i++) {
      if (r(36 + i + j * 4) > R.moss) continue;
      const along = (r(40 + i + j) - 0.5) * 0.75;
      const dl = 0.12 + r(44 + i) * 0.2;
      slab(T.moss[(i + j + 1) % T.moss.length], along, 0.1 + r(48 + i) * 0.08, out + 0.015, y - th - dl, y, -out + 0.03);
    }
  }
  // moss spilling over the coping
  for (let i = 0; i < 3; i++) {
    if (r(50 + i) > R.moss) continue;
    const along = (i - 1) * 0.33 + (r(53 + i) - 0.5) * 0.12;
    const cx = x + 0.5 + dx * 0.5 + ax * along;
    const cz = z + 0.5 + dz * 0.5 + az * along;
    b.add('box', T.moss[i % T.moss.length], [cx, top + W.copingHeight / 2 + 0.012, cz], [dx ? W.thick + 0.08 : 0.26, 0.025, dz ? W.thick + 0.08 : 0.26]);
  }
}

// ───────────── the wasteland (#758) and dead-tile litter ─────────────

type V3 = [number, number, number];
interface GeoOut { pos: number[]; nrm: number[]; col: number[]; idx: number[] }
const linByte = (hex: string): V3 => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(Math.pow(v / 255, 2.2) * 255)) as V3;
};
function vtx(g: GeoOut, p: V3, n: V3, c: V3): number {
  g.pos.push(p[0], p[1], p[2], 0);
  g.nrm.push(n[0], n[1], n[2]);
  g.col.push(c[0], c[1], c[2], 255);
  return g.pos.length / 4 - 1;
}
/** A box centred on `o` along three half-extent axes (any orientation), flat-shaded. */
function obox(g: GeoOut, o: V3, a: V3, b: V3, c: V3, hex: string) {
  const col = linByte(hex);
  const add = (p: V3, q: V3, k: number): V3 => [p[0] + q[0] * k, p[1] + q[1] * k, p[2] + q[2] * k];
  const unit = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  for (const [ax, u, w] of [[a, b, c], [b, c, a], [c, a, b]] as [V3, V3, V3][])
    for (const s of [1, -1]) {
      const n = unit([ax[0] * s, ax[1] * s, ax[2] * s]);
      const f = add(o, ax, s);
      const corners = [add(add(f, u, -1), w, -1), add(add(f, u, 1), w, -1), add(add(f, u, 1), w, 1), add(add(f, u, -1), w, 1)];
      const i = corners.map((p) => vtx(g, p, n, col));
      // wind each face outward whichever way its axes run
      const e1: V3 = [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1], corners[1][2] - corners[0][2]];
      const e2: V3 = [corners[2][0] - corners[0][0], corners[2][1] - corners[0][1], corners[2][2] - corners[0][2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0) g.idx.push(i[0], i[1], i[2], i[0], i[2], i[3]);
      else g.idx.push(i[0], i[2], i[1], i[0], i[3], i[2]);
    }
}
/** A flat strip on the ground along a polyline, tapering from `w0` to `w1` wide (a crack). */
function strip(g: GeoOut, pts: [number, number][], w0: number, w1: number, y: number, hex: string) {
  const col = linByte(hex);
  const up: V3 = [0, 1, 0];
  let prev: [number, number] | undefined;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const [nx, nz] = pts[Math.min(pts.length - 1, i + 1)];
    const [px, pz] = pts[Math.max(0, i - 1)];
    let dx = nx - px;
    let dz = nz - pz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const w = (w0 + (w1 - w0) * (i / (pts.length - 1))) / 2;
    const a = vtx(g, [x - dz * w, y, z + dx * w], up, col);
    const b = vtx(g, [x + dz * w, y, z - dx * w], up, col);
    if (prev) g.idx.push(prev[0], prev[1], a, prev[1], b, a);
    prev = [a, b];
  }
}
function done(g: GeoOut): TreeGeoLike {
  let top = 0;
  for (let i = 1; i < g.pos.length; i += 4) top = Math.max(top, g.pos[i]);
  return { pos: new Float32Array(g.pos), nrm: new Float32Array(g.nrm), col: new Uint8Array(g.col), idx: new Uint32Array(g.idx), height: top, tris: g.idx.length / 3 };
}
export interface TreeGeoLike {
  pos: Float32Array;
  nrm: Float32Array;
  col: Uint8Array;
  idx: Uint32Array;
  height: number;
  tris: number;
}
const rnd = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
};

/** Cracked earth: a main crack wandering across the tile with a branch or two, dark in its middle. */
function crackGeo(v: number): TreeGeoLike {
  const g: GeoOut = { pos: [], nrm: [], col: [], idx: [] };
  const R = rnd(9100 + v);
  const main: [number, number][] = [];
  const n = 6;
  let zz = (R() - 0.5) * 0.3;
  for (let i = 0; i <= n; i++) {
    zz += (R() - 0.5) * 0.18;
    main.push([-0.46 + (0.92 * i) / n, Math.max(-0.42, Math.min(0.42, zz))]);
  }
  strip(g, main, 0.022, 0.05, 0.004, T.crack);
  strip(g, main.slice(1, -1), 0.008, 0.02, 0.006, T.crackDeep);
  for (let k = 0; k < 1 + Math.floor(R() * 2); k++) {
    const from = main[1 + Math.floor(R() * (n - 2))];
    const side = R() < 0.5 ? -1 : 1;
    const br: [number, number][] = [from];
    let [bx, bz] = from;
    for (let i = 0; i < 3; i++) {
      bx += (R() - 0.3) * 0.12;
      bz += side * (0.08 + R() * 0.07);
      br.push([bx, Math.max(-0.45, Math.min(0.45, bz))]);
    }
    strip(g, br, 0.026, 0.006, 0.005, T.crack);
  }
  return done(g);
}

/** A few broken pieces of an old path, tipped and sunk at odd angles. */
function pathGeo(v: number): TreeGeoLike {
  const g: GeoOut = { pos: [], nrm: [], col: [], idx: [] };
  const R = rnd(9200 + v);
  const n = 2 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI;
    const tilt = (R() - 0.5) * 0.35;
    const w = 0.16 + R() * 0.14;
    const d = 0.12 + R() * 0.12;
    const cx = (R() - 0.5) * 0.5;
    const cz = (R() - 0.5) * 0.5;
    const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(tilt), st = Math.sin(tilt);
    obox(g, [cx, 0.02, cz], [ca * w * ct, st * w, sa * w * ct], [-sa * d, 0, ca * d], [0, 0.025, 0], T.pathPiece[i % T.pathPiece.length]);
  }
  return done(g);
}

/** A solar panel toppled off its post: glass face down-ish, one edge propped on its bent stand. */
function panelGeo(v: number): TreeGeoLike {
  const g: GeoOut = { pos: [], nrm: [], col: [], idx: [] };
  const R = rnd(9300 + v);
  const tilt = 0.32 + R() * 0.2;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  // the panel: 0.8 × 0.5, tipped up along x
  const a: V3 = [0.4 * ct, 0.4 * st, 0];
  const b: V3 = [0, 0, 0.25];
  const up: V3 = [-0.018 * st, 0.018 * ct, 0];
  obox(g, [0, 0.4 * st + 0.03, 0], a, b, up, T.panelFrame);
  obox(g, [-0.01 * st, 0.4 * st + 0.05, 0], [a[0] * 0.94, a[1] * 0.94, 0], [0, 0, 0.23], [-0.004 * st, 0.004 * ct, 0], R() < 0.5 ? T.panelGlass : T.panelCracked);
  // a few cells' lines across the glass
  for (let i = 1; i < 4; i++) {
    const k = i / 4 - 0.5;
    obox(g, [a[0] * 2 * k - 0.012 * st, a[1] * 2 * k + 0.4 * st + 0.058, 0], [0.006 * ct, 0.006 * st, 0], [0, 0, 0.23], [-0.002 * st, 0.002 * ct, 0], T.panelFrame);
  }
  // its stand, bent, holding the high edge up; a snapped stub of the post beside it
  obox(g, [0.33, 0.3 * st, 0.1], [0.02, 0, 0], [0, 0.3 * st, 0], [0, 0, 0.02], T.pole);
  obox(g, [-0.5, 0.12, -0.3], [0.035, 0, 0], [0, 0.12, 0], [0, 0, 0.035], T.poleRust);
  return done(g);
}

/** A snapped pole: its jagged stub still standing, the rest lying across the ground with a loop of dead wire. */
function poleGeo(v: number): TreeGeoLike {
  const g: GeoOut = { pos: [], nrm: [], col: [], idx: [] };
  const R = rnd(9400 + v);
  const h = 0.3 + R() * 0.15;
  obox(g, [-0.3, h / 2, 0], [0.04, 0, 0], [0, h / 2, 0], [0, 0, 0.04], T.pole);
  obox(g, [-0.3, h + 0.03, 0.01], [0.03, 0.01, 0], [0, 0.03, 0], [0, 0, 0.025], T.poleRust);
  // the fallen length, lying away from the stub, a crossbar at its far end
  const a = (R() - 0.5) * 0.8;
  const ca = Math.cos(a), sa = Math.sin(a);
  const L = 0.42;
  obox(g, [-0.18 + ca * L, 0.04, sa * L], [ca * L, 0, sa * L], [0, 0.035, 0], [-sa * 0.035, 0, ca * 0.035], T.pole);
  const ex = -0.18 + ca * L * 1.85;
  const ez = sa * L * 1.85;
  obox(g, [ex, 0.03, ez], [-sa * 0.18, 0, ca * 0.18], [0, 0.02, 0], [ca * 0.02, 0, sa * 0.02], T.poleRust);
  strip(g, [[-0.3, 0.06], [-0.1, 0.2], [0.15, 0.24], [0.3, 0.12]], 0.012, 0.012, 0.008, T.wire);
  return done(g);
}

/** The dead beach's litter: a strand of wrack, a rope's end, a broken plank. Dull, a little sunk in the sand. */
function beachGeo(v: number): TreeGeoLike {
  const g: GeoOut = { pos: [], nrm: [], col: [], idx: [] };
  const R = rnd(9500 + v);
  // wrack most often, then a rope's end; a plank now and then
  const kind = v < 3 ? 0 : v < 5 ? 1 : 2;
  if (kind === 0) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 6; i++) pts.push([-0.4 + i * 0.16, Math.sin(i * 0.9 + R() * 2) * 0.08]);
    strip(g, pts, 0.07, 0.03, 0.006, T.wrack[0]);
    strip(g, pts.map(([x, z]) => [x + 0.02, z + 0.035] as [number, number]), 0.04, 0.02, 0.009, T.wrack[1]);
  } else if (kind === 1) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 12; i++) {
      const a = i * 0.75;
      const r = 0.04 + i * 0.012;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    pts.push([0.35, 0.12]);
    strip(g, pts, 0.03, 0.03, 0.012, T.rope);
  } else {
    const a = R() * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    obox(g, [0, 0.02, 0], [ca * 0.34, 0.03, sa * 0.34], [-sa * 0.07, 0, ca * 0.07], [0, 0.018, 0], T.plank[0]);
    obox(g, [ca * 0.42 - sa * 0.04, 0.012, sa * 0.42 + ca * 0.04], [ca * 0.1, -0.01, sa * 0.1], [-sa * 0.06, 0, ca * 0.06], [0, 0.015, 0], T.plank[1]);
  }
  return done(g);
}

const VARIANTS = 6;
const cache = new Map<string, TreeGeoLike>();
const geo = (kind: string, v: number, make: (v: number) => TreeGeoLike) => {
  const k = `${kind}:${v}`;
  let g = cache.get(k);
  if (!g) cache.set(k, (g = make(v)));
  return g;
};

/** What a dead Old City tile carries, a pure function of the cell: for tests and the dressing below. */
export function wastelandPieces(x: number, z: number, ground: 'earth' | 'sand' | 'paving'): ('crack' | 'path' | 'panel' | 'pole' | 'litter')[] {
  const W = TERRAIN.wasteland;
  const out: ('crack' | 'path' | 'panel' | 'pole' | 'litter')[] = [];
  if (ground === 'sand') {
    if (cellHash(x, z, 9001) < W.beachLitter) out.push('litter');
    return out;
  }
  if (ground === 'paving') {
    if (cellHash(x, z, 9002) < W.cracks * 0.5) out.push('crack');
    return out;
  }
  const d = cellHash(x, z, 9003);
  if (d < W.debris) out.push(cellHash(x, z, 9004) < 0.5 ? 'panel' : 'pole');
  else if (cellHash(x, z, 9005) < W.pathPieces) out.push('path');
  if (cellHash(x, z, 9006) < W.cracks) out.push('crack');
  return out;
}

/** Something to stamp rotated geometry into (the chunk's mesh builder). */
export interface GeoStamp {
  addGeo(g: TreeGeoLike, x: number, y: number, z: number, rotY: number, scale: number): void;
}

/**
 * #758: dresses a dead Old City tile as wasteland: cracked earth, broken pieces of an old path and, rarely, a
 * toppled solar panel or a snapped pole; dead sand gets a little litter instead (it stays a dull, abandoned beach);
 * dead paving a few more cracks. `top` is the tile's top. No plants: this is ground the player hasn't brought back.
 */
export function wasteland(s: GeoStamp, x: number, z: number, top: number, ground: 'earth' | 'sand' | 'paving') {
  const rot = (k: number) => cellHash(x, z, 9010 + k) * Math.PI * 2;
  const v = (k: number) => Math.floor(cellHash(x, z, 9020 + k) * VARIANTS);
  const cx = x + 0.5;
  const cz = z + 0.5;
  for (const p of wastelandPieces(x, z, ground)) {
    if (p === 'crack') s.addGeo(geo('crack', v(0), crackGeo), cx, top, cz, rot(0), 0.85 + cellHash(x, z, 9030) * 0.25);
    else if (p === 'path') s.addGeo(geo('path', v(1), pathGeo), cx, top, cz, rot(1), 1);
    else if (p === 'panel') s.addGeo(geo('panel', v(2), panelGeo), cx, top, cz, rot(2), 1);
    else if (p === 'pole') s.addGeo(geo('pole', v(3), poleGeo), cx, top, cz, rot(3), 1);
    else s.addGeo(geo(`litter`, v(4), beachGeo), cx + (cellHash(x, z, 9031) - 0.5) * 0.3, top, cz + (cellHash(x, z, 9032) - 0.5) * 0.3, rot(4), 0.9);
  }
}
