/**
 * Phase 5 visual overhaul: procedural trees in the lush, rounded solarpunk style of the art reference.
 *
 * Pure geometry (no engine imports), so it can be built once per species / stage / variant, cached, and stamped
 * into merged chunk meshes or shown on its own. The branch skeleton follows the earlier tree designer; the
 * crowns are chunky, lumpy foliage clumps with baked soft lighting (warm sunlit tops, cool shaded undersides,
 * darker toward the crown's heart) instead of thousands of tiny leaf cards.
 *
 * Every vertex carries a "flex" weight in the 4th position component: 0 at the roots, rising to ~1 at the
 * outer leaves. The foliage material's wind shader sways vertices by it (see Foliage.ts).
 *
 * The machine side of solarpunk: brass irrigation collars with a little status light round grown trunks,
 * glass sun-petals on the Sun-Catcher Birch, and moss-jar lanterns on Radiant trees.
 */
import { PALETTE } from './Palette';

export type Species = 'oak' | 'cherry' | 'birch' | 'pine' | 'willow';
export const SPECIES: Species[] = ['oak', 'cherry', 'birch', 'pine', 'willow'];
/** Tile stages that carry a tree: 1 sapling (Restored), 2 young (Blooming), 3 full (Thriving), 4 Radiant. */
export type TreeStage = 1 | 2 | 3 | 4;
export type Lod = 0 | 1 | 2 | 3; // 0 far (one blob) · 1 normal · 2 close-up (leaf clusters) · 3 super close (leaves on the clusters)

export const SPECIES_NAMES: Record<Species, string> = {
  oak: 'Canopy Oak',
  cherry: 'Blossom Cherry',
  birch: 'Sun-Catcher Birch',
  pine: 'Spire Pine',
  willow: 'Canal Willow',
};

export interface TreeGeo {
  /** x, y, z, flex per vertex */
  pos: Float32Array;
  nrm: Float32Array;
  /** linear RGBA bytes */
  col: Uint8Array;
  idx: Uint32Array;
  height: number;
  /** triangles, for budgets */
  tris: number;
}

type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V): V => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

/** sRGB HSL → linear RGB (0–1), matching how the game's vertex colours are stored. */
type C = [number, number, number];
function hsl(h: number, s: number, l: number): C {
  h = ((h % 360) + 360) % 360 / 360;
  s /= 100;
  l /= 100;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)].map((v) => Math.pow(clamp(v, 0, 1), 2.2)) as C;
}
function hex(h: string): C {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2)) as C;
}
const mix = (a: C, b: C, k: number): C => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const scaleC = (a: C, k: number): C => [a[0] * k, a[1] * k, a[2] * k];

const SUN = norm([0.55, 0.75, 0.35]);

/** Growable vertex buffer. */
class Buf {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  n = 0;
  top = 0;
  v(p: V, n: V, c: C, flex: number) {
    this.pos.push(p[0], p[1], p[2], flex);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(Math.round(clamp(c[0], 0, 1) * 255), Math.round(clamp(c[1], 0, 1) * 255), Math.round(clamp(c[2], 0, 1) * 255), 255);
    if (p[1] > this.top) this.top = p[1];
    return this.n++;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  done(): TreeGeo {
    return {
      pos: new Float32Array(this.pos),
      nrm: new Float32Array(this.nrm),
      col: new Uint8Array(this.col),
      idx: new Uint32Array(this.idx),
      height: this.top,
      tris: this.idx.length / 3,
    };
  }
}

// ───────────── icospheres (shared unit spheres per detail level) ─────────────

const ICO: { v: V[]; f: [number, number, number][] }[] = [];
function icosphere(detail: number) {
  if (ICO[detail]) return ICO[detail];
  const t = (1 + Math.sqrt(5)) / 2;
  let v: V[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => norm(p as V));
  let f: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let d = 0; d < detail; d++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      let i = cache.get(k);
      if (i === undefined) {
        i = v.length;
        v.push(norm(mul(add(v[a], v[b]), 0.5)));
        cache.set(k, i);
      }
      return i;
    };
    const nf: [number, number, number][] = [];
    for (const [a, b, c] of f) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    v = v.slice();
    f = nf;
  }
  return (ICO[detail] = { v, f });
}

// ───────────── primitives ─────────────

interface PuffOpts {
  c: V; // centre
  r: V; // radii
  base: C;
  light: C;
  dark: C;
  flex: number;
  seed: number;
  detail: number;
  lump?: number; // 0..1 lumpiness
  crown?: V; // crown heart, for ambient darkening
  crownR?: number;
  /**
   * Look 3.7: a canopy clump made of many rounded leaf clusters: this many broad, soft bumps (never narrow enough
   * to pull a single vertex into a point), with darker crevices between them.
   */
  clusters?: number;
  /** Look 3.7: show the foliage shader's leaf pattern on this clump (default: any lumpy clump) */
  leafy?: boolean;
}

/**
 * Look 3.7: added to a vertex's flex to mark it as foliage, so the foliage shader draws leaves over it (rounded
 * leaves with dark gaps, lit from above) at every zoom without any extra triangles. Flex itself stays below 2.
 */
export const LEAF_FLAG = 2;

/** A soft, lumpy foliage clump: an ellipsoid with low-frequency bumps and baked sun / sky / ambient shading. */
function puff(B: Buf, o: PuffOpts) {
  const ico = icosphere(o.detail);
  const R = rng(o.seed);
  // a handful of random lobes give the cauliflower silhouette of the reference
  const lobes: { d: V; k: number }[] = [];
  const nc = o.clusters ?? 0;
  if (nc) for (let i = 0; i < nc; i++) lobes.push({ d: norm([R() * 2 - 1, R() * 1.4 - 0.4, R() * 2 - 1]), k: 0.7 + R() * 0.3 });
  else for (let i = 0; i < 9; i++) lobes.push({ d: norm([R() * 2 - 1, R() * 0.6 + 0.2, R() * 2 - 1]), k: 0.5 + R() * 0.5 });
  const lump = nc ? 0.14 : o.lump ?? 0.16;
  // broad falloff for clusters (rounded bumps); the old narrow lobes made spikes on coarse spheres
  const sharp = nc ? 5 : 9;
  const base = B.n;
  const leafy = o.leafy ?? o.lump !== 0 ? LEAF_FLAG : 0;
  for (const u of ico.v) {
    let bump = 0;
    let top = 0;
    for (const l of lobes) {
      const b = Math.pow(Math.max(0, dot(u, l.d)), sharp) * l.k;
      bump += nc ? 0 : b;
      if (b > top) top = b;
    }
    if (nc) bump = top * 1.6; // each cluster a smooth dome; the seams between them stay low (the crevices)
    const k = 1 + lump * (bump - 0.25) - (u[1] < -0.3 ? 0.08 * (-u[1] - 0.3) : 0); // slightly flattened underside
    const p = add(o.c, [u[0] * o.r[0] * k, u[1] * o.r[1] * k, u[2] * o.r[2] * k]);
    const n = norm([u[0] / o.r[0], u[1] / o.r[1], u[2] / o.r[2]]);
    // shading: sky from above, sun warmth, cool underside, darker toward the crown's heart
    const up = clamp(0.45 + 0.55 * n[1], 0, 1);
    const sun = clamp(dot(n, SUN), 0, 1);
    let col = up < 0.5 ? mix(o.dark, o.base, up * 2) : mix(o.base, o.light, Math.pow((up - 0.5) * 2, 1.4) * 0.75);
    col = mix(col, o.light, sun * sun * 0.3);
    if (o.crown && o.crownR) {
      const out = dot(norm(sub(p, o.crown)), n);
      const ao = clamp(0.5 + 0.45 * (0.5 + 0.5 * out) + 0.15 * (len(sub(p, o.crown)) / o.crownR), 0.5, 1.08);
      col = scaleC(col, ao);
    }
    // gentle per-vertex variation so clumps don't look plastic
    col = scaleC(col, nc ? 0.74 + 0.32 * Math.min(1, top * 1.4) : 0.94 + R() * 0.1);
    B.v(p, n, col, o.flex * (0.75 + 0.25 * up) + leafy);
  }
  for (const [a, b, c] of ico.f) B.tri(base + a, base + b, base + c);
}

/** A tapered tube along a polyline. */
function tube(B: Buf, pts: V[], radii: number[], sides: number, colors: C[], flex: number[], cap = true) {
  const n = pts.length;
  const T: V[] = [];
  for (let i = 0; i < n; i++) T.push(norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let N = norm(Math.abs(T[0][1]) < 0.9 ? cross(T[0], [0, 1, 0]) : cross(T[0], [1, 0, 0]));
  const base = B.n;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // parallel transport
      const b = cross(T[i - 1], T[i]);
      if (len(b) > 1e-6) {
        const bn = norm(b);
        const ang = Math.acos(clamp(dot(T[i - 1], T[i]), -1, 1));
        N = rotateAxis(N, bn, ang);
      }
    }
    const Bn = cross(T[i], N);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const d = add(mul(N, Math.cos(a)), mul(Bn, Math.sin(a)));
      B.v(add(pts[i], mul(d, radii[i])), d, colors[i], flex[i]);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let s = 0; s < sides; s++) {
      const a = base + i * sides + s, b = base + i * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
      B.tri(a, b, c);
      B.tri(b, d, c);
    }
  if (cap) {
    const tip = B.v(add(pts[n - 1], mul(T[n - 1], radii[n - 1] * 0.5)), T[n - 1], colors[n - 1], flex[n - 1]);
    for (let s = 0; s < sides; s++) B.tri(base + (n - 1) * sides + s, base + (n - 1) * sides + ((s + 1) % sides), tip);
  }
}
function rotateAxis(v: V, k: V, a: number): V {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

/** A flat n-gon plate facing `nrm` (two-sided). */
function plate(B: Buf, c: V, r: number, nrm: V, col: C, flex: number, sides = 6) {
  const ax = norm(Math.abs(nrm[1]) < 0.9 ? cross(nrm, [0, 1, 0]) : cross(nrm, [1, 0, 0]));
  const ay = cross(nrm, ax);
  const back = mul(nrm, -1);
  const c0 = B.v(c, nrm, col, flex);
  const c1 = B.v(c, back, scaleC(col, 0.7), flex);
  const ring: number[] = [];
  const ringB: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const p = add(c, add(mul(ax, Math.cos(a) * r), mul(ay, Math.sin(a) * r)));
    ring.push(B.v(p, nrm, col, flex));
    ringB.push(B.v(p, back, scaleC(col, 0.7), flex));
  }
  for (let i = 0; i < sides; i++) {
    B.tri(c0, ring[i], ring[(i + 1) % sides]);
    B.tri(c1, ringB[(i + 1) % sides], ringB[i]);
  }
}

/** A flat ring (torus-ish band) round the trunk: the brass irrigation collar. */
function collar(B: Buf, y: number, rIn: number, rOut: number, h: number, col: C) {
  const sides = 10;
  const base = B.n;
  const rows: [number, number][] = [[rIn, y], [rOut, y + h * 0.3], [rOut, y + h], [rIn, y + h * 1.1]];
  for (const [r, yy] of rows)
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const n: V = norm([Math.cos(a), r === rOut ? 0.2 : 0.9, Math.sin(a)]);
      B.v([Math.cos(a) * r, yy, Math.sin(a) * r], n, r === rOut ? scaleC(col, 0.85) : col, 0);
    }
  for (let row = 0; row < rows.length - 1; row++)
    for (let s = 0; s < sides; s++) {
      const a = base + row * sides + s, b = base + row * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
      B.tri(a, c, b);
      B.tri(b, c, d);
    }
}

// ───────────── cards ─────────────

/** A leaf or petal card from `p` along `dir`, `w` wide (widest at `at`), folded along its midrib. */
export function card(B: Buf, p: V, dir: V, up: V, L: number, w: number, col: C, tip: C, f0: number, f1: number, at = 0.42, fold = 0.25, soft?: V) {
  const side = norm(cross(dir, up));
  const n = norm(cross(side, dir));
  const back = soft ? col : scaleC(col, 0.72);
  const mid = add(p, mul(dir, L * at));
  const sp = add(add(mid, mul(side, w / 2)), mul(n, -w * fold));
  const sm = add(add(mid, mul(side, -w / 2)), mul(n, -w * fold));
  const tp = add(p, mul(dir, L));
  const fm = f0 + (f1 - f0) * at;
  // front
  // `soft`: shade both faces with the clump's own surface normal, so leaves blend into the canopy's soft light
  const nf = soft ?? n;
  const a = B.v(p, nf, col, f0), b = B.v(sp, nf, col, fm), c = B.v(tp, nf, tip, f1), d = B.v(sm, nf, col, fm);
  B.tri(a, b, c);
  B.tri(a, c, d);
  // back
  const nb = soft ?? mul(n, -1);
  const a2 = B.v(p, nb, back, f0), b2 = B.v(sp, nb, back, fm), c2 = B.v(tp, nb, soft ? tip : scaleC(tip, 0.8), f1), d2 = B.v(sm, nb, back, fm);
  B.tri(a2, c2, b2);
  B.tri(a2, d2, c2);
}

const randDir = (R: () => number, upBias: number): V => norm([R() * 2 - 1, upBias + R() * (1 - upBias), R() * 2 - 1]);

/**
 * Scatters leaf cards over an ellipsoid as a soft, scaly shell: each leaf starts just inside the surface and lies
 * mostly along it (drooping a little), poking out only at its tip, and is lit with the clump's own surface normal,
 * so the canopy keeps its soft light and only its silhouette and texture turn leafy.
 */
export function leafShell(B: Buf, c: V, r: V, n: number, base: C, light: C, dark: C, flex: number, L: number, R: () => number, narrow = 0.55) {
  for (let i = 0; i < n; i++) {
    const u = randDir(R, -0.35);
    const sn = norm([u[0] / r[0], u[1] / r[1], u[2] / r[2]]);
    const p: V = [c[0] + u[0] * r[0] * 0.88, c[1] + u[1] * r[1] * 0.88, c[2] + u[2] * r[2] * 0.88];
    // a tangent direction, biased downhill, tipped out a little from the surface
    const a = R() * Math.PI * 2;
    const t1 = norm(Math.abs(sn[1]) < 0.9 ? cross(sn, [0, 1, 0]) : cross(sn, [1, 0, 0]));
    const t2 = cross(sn, t1);
    let tan = add(mul(t1, Math.cos(a)), mul(t2, Math.sin(a)));
    tan = norm(add(tan, [0, -0.35, 0]));
    const dir = norm(add(tan, mul(sn, 0.45)));
    const k = clamp(0.5 + 0.5 * sn[1], 0, 1);
    const col = k > 0.5 ? mix(base, light, Math.pow((k - 0.5) * 2, 1.2) * 0.8) : mix(dark, base, k * 2);
    const l = L * (0.8 + R() * 0.4);
    card(B, p, dir, sn, l, l * narrow, scaleC(col, 0.95 + R() * 0.1), mix(col, light, 0.2), flex * 0.85, flex, 0.45, 0.15, sn);
  }
}


// ───────────── Phase 6: branches and leaves ─────────────
//
// Owner review: crowns made of lumpy spheres read as broccoli. Trees and shrubs are now built the way they grow:
// a trunk that splits into limbs, limbs into twigs (tubes along gently curving splines), and leaves along and at
// the ends of the twigs. Leaves are lit with a soft normal (outward from the crown's heart, tipped up), so the
// crown still shades as one soft volume, light on its sunny top and dark inside and underneath.

/** Where leaves grow: a twig's end or a point along it. */
interface Tip {
  p: V;
  dir: V;
}

interface LimbOpts {
  /** how strongly a limb bends upward along its length (negative droops) */
  upturn: number;
  /** children per limb, by depth (the last entry repeats) */
  kids: number[];
  /** angle between a limb and its children, radians */
  fork: number;
  /** child length and radius as a share of the parent's */
  shrink: number;
  bark: C;
  /** tube sides at depth 0 (thinner limbs use fewer) */
  sides: number;
}

/** One limb as a curving tube, then its children; leaf points are collected in `tips`. */
function limb(B: Buf, R: () => number, from: V, dir: V, L: number, rad: number, depth: number, maxDepth: number, flex: number, o: LimbOpts, tips: Tip[]) {
  const segs = 3;
  const pts: V[] = [from];
  const radii: number[] = [rad];
  const fl: number[] = [flex];
  const cols: C[] = [o.bark];
  let d = dir;
  for (let i = 1; i <= segs; i++) {
    d = norm(add(d, [(R() - 0.5) * 0.4, o.upturn * 0.3 + (R() - 0.5) * 0.15, (R() - 0.5) * 0.4]));
    pts.push(add(pts[i - 1], mul(d, L / segs)));
    radii.push(rad * (1 - 0.5 * (i / segs)));
    fl.push(flex + (i / segs) * 0.16);
    cols.push(o.bark);
  }
  tube(B, pts, radii, Math.max(3, o.sides - depth * 2), cols, fl, depth === maxDepth);
  const end = pts[segs];
  if (depth >= maxDepth) {
    tips.push({ p: end, dir: d });
    return;
  }
  // leaves partway along bigger limbs too, so the crown has no bare middle
  if (depth === maxDepth - 1) tips.push({ p: pts[segs - 1], dir: d });
  const ax = norm(Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0]));
  const ay = cross(d, ax);
  const phi0 = R() * Math.PI * 2;
  const kids = o.kids[Math.min(depth, o.kids.length - 1)];
  for (let k = 0; k < kids; k++) {
    // the last child carries on from the end; the others leave the limb along its outer half
    const last = k === kids - 1;
    const at = last ? segs : 1 + Math.floor(R() * (segs - 1)) + 1;
    const a = last ? o.fork * 0.45 : o.fork * (0.8 + R() * 0.4);
    const phi = phi0 + (k / kids) * Math.PI * 2 + (R() - 0.5) * 0.6;
    const cd = norm(add(mul(d, Math.cos(a)), mul(add(mul(ax, Math.cos(phi)), mul(ay, Math.sin(phi))), Math.sin(a))));
    const i = Math.min(segs, at);
    limb(B, R, pts[i], cd, L * o.shrink * (0.85 + R() * 0.3), radii[i] * 0.75, depth + 1, maxDepth, fl[i], o, tips);
  }
}

interface Crown {
  heart: V;
  r: number;
  pal: Palette;
  /** a second leaf colour for a share of the leaves (blossom) */
  alt?: { pal: Palette; share: number };
}

/** A leaf's colour: light on the sunny top of the crown, dark inside and underneath. */
function leafColour(cr: Crown, p: V, n: V, R: () => number): C {
  const pal = cr.alt && R() < cr.alt.share ? cr.alt.pal : cr.pal;
  const up = clamp(0.5 + 0.5 * n[1], 0, 1);
  const sun = clamp(dot(n, SUN), 0, 1);
  let col = up < 0.55 ? mix(pal.dark, pal.base, up / 0.55) : mix(pal.base, pal.light, Math.pow((up - 0.55) / 0.45, 1.6) * 0.6);
  col = mix(col, pal.light, sun * sun * sun * 0.35);
  const out = clamp(len(sub(p, cr.heart)) / cr.r, 0, 1.15);
  return scaleC(col, (0.55 + 0.45 * out) * (0.88 + R() * 0.24));
}

/**
 * A spray of leaves round a twig end: each leaf starts near the twig and lies outward and a little down, like a
 * real leaf on its stalk. `narrow` is width / length (0.6 broad leaves, 0.25 needles or willow leaves).
 */
function spray(B: Buf, R: () => number, at: Tip, n: number, reach: number, L: number, cr: Crown, flex: number, narrow = 0.6, droop = 0.2) {
  for (let i = 0; i < n; i++) {
    const u = norm([R() * 2 - 1, R() * 2 - 1, R() * 2 - 1]);
    // leaves fan out round the twig's direction and away from the crown's heart
    const away = norm(sub(at.p, cr.heart));
    const dir = norm(add(add(mul(u, 1), mul(at.dir, 0.55)), add(mul(away, 0.6), [0, -droop, 0])));
    const p = add(at.p, mul(u, reach * 0.45 * R()));
    const soft = norm(add(mul(norm(sub(add(p, mul(dir, L * 0.5)), cr.heart)), 1), [0, 0.2, 0]));
    const col = leafColour(cr, add(p, mul(dir, L * 0.5)), soft, R);
    const l = L * (0.8 + R() * 0.4);
    // the card needs an "up" that isn't along the leaf
    const upv: V = Math.abs(dot(dir, soft)) > 0.92 ? norm(add(soft, [0.3, 0.2, -0.3])) : soft;
    card(B, p, dir, upv, l, l * narrow, col, mix(col, cr.pal.light, 0.12), flex * 0.85, Math.min(1.2, flex + 0.15), 0.5, 0.14, soft);
  }
}

/** Leaves per spray and leaf length factor per detail level (far … super close). */
const LEAVES: Record<Lod, [number, number]> = { 0: [3, 2.1], 1: [17, 1.25], 2: [24, 0.82], 3: [32, 0.72] };

// ───────────── species ─────────────

interface Palette {
  base: C;
  light: C;
  dark: C;
}
function leafPalette(sp: Species, R: () => number, stage: TreeStage): Palette {
  const j = (a: number, b: number) => lerp(a, b, R());
  switch (sp) {
    case 'cherry': {
      // pink when it first blooms, the full pink crown later; Thriving leafs out a little green
      const h = j(...PALETTE.leaf.hue.cherry);
      return { base: hsl(h, 62, 76), light: hsl(h + 8, 70, 88), dark: hsl(h - 6, 45, 56) };
    }
    case 'birch': {
      const h = j(...PALETTE.leaf.hue.birch);
      return { base: hsl(h, 60, 36), light: hsl(h - 12, 68, 50), dark: hsl(h + 18, 50, 19) };
    }
    case 'pine': {
      const h = j(...PALETTE.leaf.hue.pine);
      return { base: hsl(h, 42, 32), light: hsl(h - 14, 48, 50), dark: hsl(h + 10, 40, 18) };
    }
    case 'willow': {
      const h = j(...PALETTE.leaf.hue.willow);
      return { base: hsl(h, 56, 36), light: hsl(h - 12, 64, 50), dark: hsl(h + 18, 48, 20) };
    }
    default: {
      const h = j(...PALETTE.leaf.hue.oak) - (stage === 4 ? 6 : 0);
      // Phase 6: brighter crowns with yellow-green sunlit tops and deep green undersides, like the reference
      return { base: hsl(h, 60, 33), light: hsl(h - 14, 68, 48), dark: hsl(h + 16, 52, 17) };
    }
  }
}

const BARK: Record<Species, C> = {
  oak: hsl(26, 32, 34),
  cherry: hsl(12, 30, 32),
  birch: hsl(40, 18, 92),
  pine: hsl(22, 30, 28),
  willow: hsl(30, 26, 36),
};
const BRASS = hex(PALETTE.trim.brass);
const CREAM = hex(PALETTE.plastic.lantern);
const CYAN = hex(PALETTE.aqua.teal);
const GLOW = hex(PALETTE.glow.honey);


/**
 * Builds one tree. `variant` changes the branching and crown layout; `stage` its growth; `lod` its detail.
 * Units are tiles: a full-grown template is about 1.4–1.8 tiles tall (pine the tallest) with a crown about two tiles
 * across; placement scales it (TreePlacement.TREES.scale), so a grove tree stands four to six Bloombots tall.
 */
export function buildTree(sp: Species, stage: TreeStage, variant: number, lod: Lod = 1): TreeGeo {
  const B = new Buf();
  const R = rng((variant + 1) * 7919 + SPECIES.indexOf(sp) * 104729 + stage * 13);
  const bark = BARK[sp];
  const barkDark = scaleC(bark, sp === 'birch' ? 0.45 : 0.7);
  if (stage === 1) return sapling(B, sp, R, lod).done();
  const S = (stage === 2 ? 0.62 : stage === 4 ? 1.08 : 1) * 1.12; // overall size
  const pal = leafPalette(sp, R, stage);
  if (sp === 'pine') pine(B, R, S, pal, bark, lod);
  else if (sp === 'willow') willow(B, R, S, pal, bark, barkDark, lod);
  else broadleaf(B, sp, R, S, pal, bark, barkDark, stage, lod);

  // machine side: brass irrigation collar with a little cyan status light (grown trees only)
  if (stage >= 3 && lod > 0) {
    const tr = (sp === 'birch' ? 0.055 : 0.075) * S;
    collar(B, 0.0, tr * 0.9, tr * 1.9, 0.045, BRASS);
    puff(B, { c: [tr * 1.9, 0.035, 0], r: [0.014, 0.014, 0.014], base: CYAN, light: CYAN, dark: scaleC(CYAN, 0.8), flex: 0, seed: 1, detail: 0, lump: 0 });
  }
  // Radiant: moss-jar lanterns and golden sun-berries
  if (stage === 4 && lod > 0) radiant(B, R, sp, S);
  return B.done();
}

/** The trunk: a gently curving, flared tube. Returns its top. */
function trunk(B: Buf, R: () => number, H: number, rad: number, bark: C, barkDark: C, segs: number, sides: number, birch = false, leanBy = 0.14): V {
  const lean: V = [(R() - 0.5) * leanBy, 1, (R() - 0.5) * leanBy];
  const tp: V[] = [];
  const tr: number[] = [];
  const tc: C[] = [];
  const tf: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    tp.push([lean[0] * k * H + Math.sin(k * 3 + R()) * 0.012, k * H, lean[2] * k * H]);
    tr.push(rad * (1 - 0.4 * k) * (1 + 0.95 * Math.exp(-k * 7))); // sturdy, with a root flare
    let c = mix(barkDark, bark, clamp(k * 1.6, 0, 1));
    if (birch && i > 0 && i < segs && R() < 0.5) c = hex(PALETTE.birchEye);
    tc.push(c);
    tf.push(k * 0.12);
  }
  tube(B, tp, tr, sides, tc, tf, false);
  return tp[segs];
}

// ───────────── P7-E29: clustered crowns ─────────────
//
// Phase 7 review: crowns of loose leaf cards read as a cloud of flakes up close and a scatter of confetti far off,
// and lone spheres read as lollipops. A crown is now a few designed leaf-cluster volumes resting on the ends of
// real limbs: each cluster is a soft, lumpy mass (the foliage shader draws leaves over it) with a fringe of leaf
// cards round its edge, so the silhouette is leafy and layered. Clusters are lit as one crown: light on the sunny
// top, darker and cooler underneath and toward the heart, which gives the canopy's underside its depth. Every
// detail level uses the same cluster layout, so a tree keeps its silhouette as it changes level (no popping).

/** One leaf mass of a crown: centre, radii, and how light it sits in the crown (0 inner / under … 1 outer top). */
interface Cluster {
  c: V;
  r: V;
  /** the limb that carries it starts here (none: it sits on another cluster) */
  from?: V;
  /** that limb's radius where it starts */
  rad?: number;
  /** tone shift for this cluster (-1 … 1): a slightly different green, so the masses read apart */
  tone: number;
  /** bumps on its surface (default 6) */
  lobes?: number;
}

/** Per detail level: cluster sphere detail, fringe leaves per cluster (per unit of cluster size), fringe leaf length. */
const CROWN: Record<Lod, { detail: number; fringe: number; leaf: number; limbSides: number }> = {
  0: { detail: 1, fringe: 0, leaf: 0, limbSides: 0 },
  1: { detail: 2, fringe: 15, leaf: 1.25, limbSides: 5 },
  2: { detail: 2, fringe: 34, leaf: 0.8, limbSides: 6 },
  3: { detail: 2, fringe: 52, leaf: 0.7, limbSides: 6 },
};

/** A limb from `a` to `b` that bows upward a little (or droops for negative `bow`), tapering from rad to rad·k. */
function bough(B: Buf, R: () => number, a: V, b: V, rad: number, sides: number, bark: C, f0: number, f1: number, bow = 0.12, k = 0.45) {
  const d = sub(b, a);
  const L = len(d);
  const side: V = [(R() - 0.5) * 0.12 * L, 0, (R() - 0.5) * 0.12 * L];
  const p1 = add(add(a, mul(d, 0.34)), add([0, bow * L * 0.6, 0], side));
  const p2 = add(add(a, mul(d, 0.7)), add([0, bow * L * 0.5, 0], mul(side, 0.5)));
  tube(B, [a, p1, p2, b], [rad, rad * (1 - (1 - k) * 0.4), rad * (1 - (1 - k) * 0.75), rad * k], sides, [scaleC(bark, 0.85), bark, bark, bark], [f0, lerp(f0, f1, 0.34), lerp(f0, f1, 0.7), f1], true);
}

/** Draws a crown's clusters (and the limbs that carry them) at detail level `lod`. */
function drawCrown(B: Buf, R: () => number, cl: Cluster[], cr: Crown, bark: C, lod: Lod, o: { narrow: number; leafL: number; droop?: number }) {
  const q = CROWN[lod];
  if (lod > 0)
    for (const k of cl)
      if (k.from && k.rad) {
        // the limb ends inside its cluster, a little below the centre, so it shows under the crown and vanishes in it
        const end = add(k.c, [0, -k.r[1] * 0.35, 0]);
        bough(B, R, k.from, end, k.rad, q.limbSides, bark, 0.14, 0.45);
      }
  for (let i = 0; i < cl.length; i++) {
    const k = cl[i];
    const pal = shade(shiftPal(cr.alt && (i * 0.618) % 1 < cr.alt.share ? cr.alt.pal : cr.pal, k.tone));
    puff(B, { c: k.c, r: k.r, base: pal.base, light: pal.light, dark: pal.dark, flex: 0.55 + 0.3 * clamp(len(sub(k.c, cr.heart)) / cr.r, 0, 1), seed: i * 31 + 7, detail: q.detail, clusters: k.lobes ?? 6, crown: cr.heart, crownR: cr.r, leafy: true });
    if (!q.fringe) continue;
    const size = (k.r[0] + k.r[2]) / 2;
    fringe(B, R, k, Math.round(q.fringe * clamp(size / 0.3, 0.6, 1.6)), pal, cr, o.leafL * q.leaf, o.narrow, o.droop ?? 0.35);
  }
}

/**
 * Leaves round a cluster's edge that break its outline: each starts just under the surface and sticks out past it,
 * lying back along it and drooping a little, lit with the surface's own soft normal so the mass keeps its light.
 * Mostly on the sides and top: underneath they would only fill the shade.
 */
function fringe(B: Buf, R: () => number, k: Cluster, n: number, pal: Palette, cr: Crown, L: number, narrow: number, droop: number) {
  for (let i = 0; i < n; i++) {
    const u = randDir(R, -0.45);
    const sn = norm([u[0] / k.r[0], u[1] / k.r[1], u[2] / k.r[2]]);
    const p: V = [k.c[0] + u[0] * k.r[0] * 0.9, k.c[1] + u[1] * k.r[1] * 0.9, k.c[2] + u[2] * k.r[2] * 0.9];
    const t1 = norm(Math.abs(sn[1]) < 0.9 ? cross(sn, [0, 1, 0]) : cross(sn, [1, 0, 0]));
    const t2 = cross(sn, t1);
    const a = R() * Math.PI * 2;
    const tan = add(mul(t1, Math.cos(a)), mul(t2, Math.sin(a)));
    const dir = norm(add(add(tan, mul(sn, 0.9)), [0, -droop, 0]));
    const soft = norm(add(mul(norm(sub(p, cr.heart)), 0.5), sn));
    const col = leafColour(cr, p, soft, R);
    const tint = mix(col, pal.base, 0.35);
    const l = L * (0.8 + R() * 0.45);
    const upv: V = Math.abs(dot(dir, soft)) > 0.92 ? norm(add(soft, [0.3, 0.2, -0.3])) : soft;
    card(B, p, dir, upv, l, l * narrow, tint, mix(tint, pal.light, 0.15), 0.8, 1.1, 0.5, 0.14, soft);
  }
}

/**
 * The crown's underside is the shade colour: lifted and cooled from the leaf's darkest tone, so the canopy seen from
 * below has depth (about 40% darker than its lit top, not black).
 */
const shade = (p: Palette): Palette => ({ ...p, dark: mix(p.dark, mul3(p.base, [0.8, 0.95, 1.12]), 0.45) });
const mul3 = (a: C, b: C): C => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];

/** A palette nudged lighter / yellower (tone > 0) or deeper (tone < 0). */
function shiftPal(p: Palette, tone: number): Palette {
  const k = 1 + tone * 0.12;
  const y: C = [1 + tone * 0.05, 1 + tone * 0.02, 1 - tone * 0.06];
  const f = (c: C): C => [c[0] * k * y[0], c[1] * k * y[1], c[2] * k * y[2]];
  return { base: f(p.base), light: f(p.light), dark: f(p.dark) };
}

/** A trunk for every detail level: full taper and flare near, a plain tapered post far. Returns its top. */
function trunkAt(B: Buf, R: () => number, lod: Lod, H: number, rad: number, bark: C, barkDark: C, birch = false, lean = 0.14): V {
  if (lod === 0) {
    const top: V = [(R() - 0.5) * lean * H, H, (R() - 0.5) * lean * H];
    tube(B, [[0, 0, 0], mul(top, 0.5), top], [rad * 1.25, rad * 0.85, rad * 0.6], 5, [barkDark, bark, bark], [0, 0.06, 0.12], false);
    return top;
  }
  return trunk(B, R, H, rad, bark, barkDark, birch ? 6 : 5, lod >= 2 ? 9 : 7, birch, lean);
}

/**
 * Broad shade tree (oak): a stout, flared trunk that splits low into a few strong limbs reaching up and out, and a
 * wide, layered dome of clusters (an outer ring, a raised inner ring and a crown on top), wider than it is tall.
 * Cherry: shorter and crookeder, limbs spreading almost flat into an umbrella of blossom. Birch: a slender white
 * leader with a narrow, airy oval of small clusters stacked along its upper half.
 */
function broadleaf(B: Buf, sp: Species, R: () => number, S: number, pal: Palette, bark: C, barkDark: C, stage: TreeStage, lod: Lod) {
  const birch = sp === 'birch';
  const cherry = sp === 'cherry';
  const young = stage === 2;
  const trunkH = (birch ? 0.86 : cherry ? 0.46 : 0.52) * S;
  const trunkR = (birch ? 0.045 : cherry ? 0.082 : 0.1) * S;
  const top = trunkAt(B, R, lod, trunkH, trunkR, bark, barkDark, birch, cherry ? 0.3 : 0.14);
  const cl: Cluster[] = [];
  let heart: V;
  let crownR: number;
  if (birch) {
    // a narrow oval: small clusters spiralling up the leader, the biggest a third of the way up the crown
    const n = young ? 4 : 6;
    heart = [top[0], top[1] + 0.12 * S, top[2]];
    crownR = 0.42 * S;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const a = i * 2.4 + R() * 0.5;
      const w = (0.22 + 0.14 * Math.sin(Math.PI * (0.25 + 0.75 * k))) * S;
      const y = top[1] - 0.16 * S + k * 0.56 * S;
      const off = (0.14 + 0.06 * R()) * S * (1 - 0.6 * k);
      const from: V = [top[0] * (y / top[1]) * 0.9, Math.min(y - 0.1 * S, top[1]), top[2] * (y / top[1]) * 0.9];
      cl.push({ c: [top[0] + Math.cos(a) * off, y, top[2] + Math.sin(a) * off], r: [w * 0.9, w * 0.85, w * 0.9], from, rad: trunkR * 0.45, tone: R() * 2 - 1 });
    }
    cl.push({ c: [top[0], top[1] + 0.4 * S, top[2]], r: [0.16 * S, 0.2 * S, 0.16 * S], tone: 0.6 });
    if (lod > 0) bough(B, R, [top[0] * 0.8, top[1] * 0.8, top[2] * 0.8], [top[0], top[1] + 0.32 * S, top[2]], trunkR * 0.55, 5, bark, 0.12, 0.4, 0.02);
  } else {
    // the outer ring: one cluster per main limb
    const ring = young ? 3 : cherry ? 5 : 5 + Math.floor(R() * 2);
    const reach = (cherry ? 0.56 : 0.5) * S;
    const rise = (cherry ? 0.24 : 0.26) * S;
    heart = [top[0], top[1] + (cherry ? 0.2 : 0.3) * S, top[2]];
    crownR = (cherry ? 0.78 : 0.74) * S;
    const a0 = R() * Math.PI * 2;
    for (let i = 0; i < ring; i++) {
      const a = a0 + (i / ring) * Math.PI * 2 + (R() - 0.5) * 0.7;
      const d = reach * (0.82 + R() * 0.3);
      const rr = (cherry ? 0.3 : 0.32) * S * (0.85 + R() * 0.3);
      const y = top[1] + rise + (R() - 0.5) * 0.12 * S;
      // limbs leave the trunk at staggered heights, the lower ones a little below its top
      const from: V = [top[0] * 0.9, top[1] - (i % 2) * 0.1 * S, top[2] * 0.9];
      cl.push({ c: [top[0] + Math.cos(a) * d, y, top[2] + Math.sin(a) * d], r: [rr * 1.08, rr * (cherry ? 0.66 : 0.74), rr * 1.08], from, rad: trunkR * 0.6, tone: R() * 1.4 - 0.9 });
    }
    // the raised inner ring and the crown on top, carried by a leader through the middle
    const inner = young ? 1 : cherry ? 2 : 3;
    for (let i = 0; i < inner; i++) {
      const a = a0 + ((i + 0.5) / inner) * Math.PI * 2 + (R() - 0.5) * 0.5;
      const d = inner === 1 ? 0 : reach * (0.34 + R() * 0.12);
      const rr = (cherry ? 0.3 : 0.34) * S * (0.9 + R() * 0.2);
      const y = top[1] + rise + (cherry ? 0.16 : 0.26) * S + R() * 0.06 * S;
      cl.push({ c: [top[0] + Math.cos(a) * d, y, top[2] + Math.sin(a) * d], r: [rr, rr * (cherry ? 0.72 : 0.82), rr], from: i === 0 ? top : undefined, rad: trunkR * 0.55, tone: 0.3 + R() * 0.7 });
    }
  }
  const cr: Crown = { heart, r: crownR, pal };
  // cherry: blossom clusters with a little fresh green among them once it's Thriving; a sapling-stage cherry is all
  // blossom
  if (cherry)
    cr.alt = stage >= 3
      ? { pal: { base: hsl(96, 46, 40), light: hsl(84, 56, 56), dark: hsl(110, 40, 24) }, share: 0.14 }
      : { pal: { base: hex(PALETTE.treeBlossom[0]), light: hex(PALETTE.treeBlossom[1]), dark: hex(PALETTE.treeBlossom[2]) }, share: 0.3 };
  drawCrown(B, R, cl, cr, bark, lod, { narrow: birch ? 0.55 : 0.62, leafL: (birch ? 0.085 : 0.11) * S });
}

/**
 * Spire pine: a straight, tapering trunk and a stack of drooping, layered tiers that narrow toward a pointed top,
 * each tier a flattened ring of needle masses (never a smooth cone).
 */
function pine(B: Buf, R: () => number, S: number, pal: Palette, bark: C, lod: Lod) {
  const H = 1.55 * S;
  const trunkR = 0.07 * S;
  tube(B, [[0, 0, 0], [0, H * 0.45, 0], [0, H * 0.95, 0]], [trunkR * 1.35, trunkR * 0.8, trunkR * 0.2], lod === 0 ? 5 : 7, [scaleC(bark, 0.75), bark, bark], [0, 0.15, 0.4], false);
  const cr: Crown = { heart: [0, H * 0.5, 0], r: 0.62 * S, pal };
  const cl: Cluster[] = [];
  const tiers = 6;
  for (let w = 0; w < tiers; w++) {
    const k = w / (tiers - 1);
    const y = H * (0.22 + 0.66 * k);
    const reach = (0.52 - 0.4 * k) * S;
    // each tier a drooping skirt of needles with a lumpy rim, sitting low on the tier below so the layers read as
    // one tapering spire
    const off = (R() - 0.5) * 0.04 * S;
    cl.push({ c: [off, y, -off], r: [reach * 0.95, (0.17 - 0.04 * k) * S, reach * 0.95], tone: k * 0.8 - 0.5 + (R() - 0.5) * 0.3, lobes: 9 });
  }
  cl.push({ c: [0, H * 0.97, 0], r: [0.07 * S, 0.14 * S, 0.07 * S], tone: 0.5 });
  drawCrown(B, R, cl, cr, bark, lod, { narrow: 0.28, leafL: 0.12 * S, droop: 0.6 });
}

/**
 * Canal willow: a leaning trunk, limbs that rise and arch over, a low dome of leaf masses on top and a curtain of
 * hanging strands falling from the arch almost to the ground.
 */
function willow(B: Buf, R: () => number, S: number, pal: Palette, bark: C, barkDark: C, lod: Lod) {
  const trunkH = 0.52 * S;
  const top = trunkAt(B, R, lod, trunkH, 0.095 * S, bark, barkDark, false, 0.24);
  const heart: V = [top[0], trunkH + 0.24 * S, top[2]];
  const cr: Crown = { heart, r: 0.7 * S, pal };
  const cl: Cluster[] = [];
  const arms = 5;
  const a0 = R() * Math.PI * 2;
  const tips: { p: V; out: V }[] = [];
  for (let i = 0; i < arms; i++) {
    const a = a0 + (i / arms) * Math.PI * 2 + (R() - 0.5) * 0.5;
    const out: V = [Math.cos(a), 0, Math.sin(a)];
    const reach = (0.44 + R() * 0.12) * S;
    const c = add(top, add(mul(out, reach * 0.62), [0, 0.3 * S, 0]));
    cl.push({ c, r: [0.28 * S, 0.17 * S, 0.28 * S], from: top, rad: 0.05 * S, tone: R() * 1.2 - 0.6 });
    tips.push({ p: add(top, add(mul(out, reach), [0, 0.22 * S, 0])), out });
  }
  cl.push({ c: add(top, [0, 0.42 * S, 0]), r: [0.3 * S, 0.18 * S, 0.3 * S], from: top, rad: 0.05 * S, tone: 0.5 });
  drawCrown(B, R, cl, cr, bark, lod, { narrow: 0.3, leafL: 0.1 * S });
  // the curtain: far off, a few long hanging masses; nearer, strands of leaves on thin falling stems
  const strands = lod === 0 ? 0 : lod === 1 ? 5 : 6;
  for (let i = 0; i < tips.length; i++) {
    const { p, out } = tips[i];
    const pal2 = shiftPal(pal, (i % 3) * 0.3 - 0.3);
    // a hanging mass inside the strands (all that's left far off), so the curtain reads as foliage, not threads
    const near = lod > 0;
    puff(B, { c: add(p, [0, -0.2 * S, 0]), r: near ? [0.15 * S, 0.22 * S, 0.15 * S] : [0.18 * S, 0.25 * S, 0.18 * S], base: pal2.base, light: pal2.light, dark: pal2.dark, flex: 0.9, seed: i, detail: lod >= 2 ? 2 : lod === 1 ? 1 : 0, clusters: 4, crown: heart, crownR: cr.r, leafy: true });
    if (!near) continue;
    const side = cross(out, [0, 1, 0]);
    for (let s = 0; s < strands; s++) {
      const t = s / (strands - 1) - 0.5;
      const from = add(add(p, mul(side, t * 0.42 * S)), mul(out, -Math.abs(t) * 0.16 * S + (R() - 0.5) * 0.05 * S));
      const Ls = (0.42 + R() * 0.2) * S;
      const sway: V = add(mul(out, 0.05 * S), [(R() - 0.5) * 0.04 * S, 0, (R() - 0.5) * 0.04 * S]);
      const mid = add(from, add(mul(sway, 0.5), [0, -Ls * 0.5, 0]));
      const end = add(from, add(sway, [0, -Ls, 0]));
      tube(B, [from, mid, end], [0.004 * S, 0.003 * S, 0.002 * S], 3, [pal2.dark, pal2.dark, pal2.base], [0.6, 0.9, 1.15], false);
      const per = lod === 1 ? 3 : 4;
      for (let j = 0; j < per; j++) {
        const kk = (j + 0.5) / per;
        const q = add(from, add(mul(sway, kk), [0, -Ls * kk, 0]));
        spray(B, R, { p: q, dir: [0, -1, 0] }, lod === 1 ? 3 : 4, 0.05 * S, 0.12 * S, { heart, r: cr.r, pal: pal2 }, 0.6 + 0.5 * kk, 0.26, 1.8);
      }
    }
  }
}

function sapling(B: Buf, sp: Species, R: () => number, lod: Lod) {
  const pal = leafPalette(sp, R, 1);
  const bark = BARK[sp];
  // a young tree: a thin stem that forks into a few twigs, each with a spray of leaves
  const h = 0.2 + R() * 0.05;
  tube(B, [[0, 0, 0], [0.006, h * 0.5, 0], [0.01, h, 0.004]], [0.03, 0.02, 0.014], 5, [scaleC(bark, 0.8), bark, bark], [0, 0.2, 0.4], false);
  const top: V = [0.01, h, 0.004];
  const crown: Crown = { heart: [0.01, h + 0.05, 0.004], r: 0.2, pal };
  const tips: Tip[] = [];
  const o: LimbOpts = { upturn: 0.7, kids: [0], fork: 0.6, shrink: 0.7, bark, sides: 3 };
  const n = sp === 'pine' ? 5 : 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R();
    const from: V = sp === 'pine' ? [0.01 * (i / n), h * (0.35 + 0.6 * (i / n)), 0] : top;
    limb(B, R, from, norm([Math.cos(a), sp === 'pine' ? 0.15 : 0.7 + R() * 0.4, Math.sin(a)]), (sp === 'pine' ? 0.1 * (1.2 - i / n) : 0.1) * (0.9 + R() * 0.3), 0.008, 0, 0, 0.5, o, tips);
  }
  tips.push({ p: add(top, [0, 0.03, 0]), dir: [0, 1, 0] });
  const [ln, k] = LEAVES[lod];
  for (const t of tips) spray(B, R, t, Math.max(2, Math.round(ln * 0.5)), 0.05, (sp === 'pine' ? 0.06 : 0.07) * k, crown, 0.8, sp === 'pine' ? 0.3 : 0.6);
  return B;
}

function radiant(B: Buf, R: () => number, sp: Species, S: number) {
  const n = sp === 'pine' ? 2 : 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R();
    const rr = (sp === 'birch' ? 0.24 : 0.36) * S;
    const y = (sp === 'birch' ? 0.82 : sp === 'pine' ? 0.42 : 0.56) * S;
    const top: V = [Math.cos(a) * rr, y, Math.sin(a) * rr];
    const L = 0.09 + R() * 0.06;
    const bot = add(top, [0, -L, 0]);
    tube(B, [top, bot], [0.004, 0.004], 3, [hsl(30, 25, 30), hsl(30, 25, 30)], [0.8, 0.95], false);
    // jar: cream glass with a warm glowing heart and a brass cap
    puff(B, { c: add(bot, [0, -0.04, 0]), r: [0.04, 0.05, 0.04], base: CREAM, light: [1, 1, 1], dark: scaleC(CREAM, 0.85), flex: 1, seed: i, detail: 1, lump: 0 });
    puff(B, { c: add(bot, [0, -0.045, 0]), r: [0.026, 0.03, 0.026], base: GLOW, light: GLOW, dark: GLOW, flex: 1, seed: i, detail: 0, lump: 0 });
    tube(B, [add(bot, [0, 0.006, 0]), add(bot, [0, -0.012, 0])], [0.024, 0.028], 6, [BRASS, BRASS], [0.95, 1]);
  }
  // sun-berries: tiny golden lights dotted over the crown
  for (let i = 0; i < 6; i++) {
    const a = R() * Math.PI * 2;
    const y = (sp === 'pine' ? 0.5 + R() * 0.6 : sp === 'birch' ? 0.95 + R() * 0.35 : 0.68 + R() * 0.3) * S;
    const rr = (sp === 'birch' ? 0.25 : sp === 'pine' ? 0.3 * (1.3 - y) : 0.42) * S;
    puff(B, { c: [Math.cos(a) * rr, y, Math.sin(a) * rr], r: [0.022, 0.022, 0.022], base: hex(PALETTE.glow.gold), light: hex(PALETTE.glow.sun), dark: hex(PALETTE.glow.sunDark), flex: 0.9, seed: i, detail: 0, lump: 0 });
  }
}

/**
 * A shrub: several stems that splay up and out from one root, each forking once, with leaves along and at the ends
 * of the twigs. `flowering` adds clusters of small petals at the tips.
 */
export function buildShrub(variant: number, lod: Lod = 1, flowering?: boolean, bloom?: C): TreeGeo {
  const B = new Buf();
  const R = rng(variant * 9973 + 7 + (flowering ? 501 : 0));
  const [h0, h1] = PALETTE.leaf.hue.shrub;
  const h = h0 + R() * (h1 - h0);
  const pal = { base: hsl(h, 58, 33), light: hsl(h - 10, 64, 47), dark: hsl(h + 16, 48, 18) };
  const crown: Crown = { heart: [0, 0.1, 0], r: 0.3, pal };
  const tips: Tip[] = [];
  const twig = hex(PALETTE.twig[0]);
  const o: LimbOpts = { upturn: 0.5, kids: [lod === 0 ? 0 : 2], fork: 0.7, shrink: 0.6, bark: twig, sides: 3 };
  const stems = lod === 0 ? 4 : 5 + Math.floor(R() * 2);
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + R() * 0.7;
    const splay = 0.25 + R() * 0.75;
    const dir = norm([Math.cos(a) * splay, 1, Math.sin(a) * splay]);
    limb(B, R, [Math.cos(a) * 0.02, 0, Math.sin(a) * 0.02], dir, 0.16 + R() * 0.08, 0.012, 0, lod === 0 ? 0 : 1, 0.15, o, tips);
  }
  const [n, k] = LEAVES[lod];
  for (const t of tips) spray(B, R, t, Math.max(3, Math.round(n * 0.6)), 0.1, 0.06 * k, crown, 0.3, 0.62, 0.25);
  if (flowering ?? R() < 0.35) {
    const cols = bloom ? [bloom] : [hex(PALETTE.flowers.pink), hex(PALETTE.flowers.yellow), hex(PALETTE.flowers.white), hex(PALETTE.flowers.lavender)];
    const col = cols[variant % cols.length];
    const petals: Crown = { heart: crown.heart, r: crown.r, pal: { base: col, light: mix(col, [1, 1, 1], 0.35), dark: scaleC(col, 0.75) } };
    for (let i = 0; i < tips.length; i += 2) spray(B, R, { p: add(tips[i].p, [0, 0.02, 0]), dir: [0, 1, 0] }, lod === 0 ? 2 : 5, 0.04, 0.04 * k, petals, 0.35, 0.8, -0.3);
  }
  return B.done();
}

/** Template cache: one geometry per species / stage / variant / detail. */
const cache = new Map<string, TreeGeo>();
export const TREE_VARIANTS = 4;
export function treeGeo(sp: Species, stage: TreeStage, variant: number, lod: Lod = 1): TreeGeo {
  const key = `${sp}|${stage}|${variant % TREE_VARIANTS}|${lod}`;
  let g = cache.get(key);
  if (!g) cache.set(key, (g = buildTree(sp, stage, variant % TREE_VARIANTS, lod)));
  return g;
}
export function shrubGeo(variant: number, lod: Lod = 1): TreeGeo {
  const key = `shrub|${variant % 6}|${lod}`;
  let g = cache.get(key);
  if (!g) cache.set(key, (g = shrubBuilder(variant % 6, lod)));
  return g;
}
/** Look 3.6: the leafy shrub builder (Flora.ts registers it; the smooth `buildShrub` stays as the fallback). */
let shrubBuilder: (variant: number, lod: Lod) => TreeGeo = buildShrub;
export function setShrubBuilder(f: (variant: number, lod: Lod) => TreeGeo) {
  shrubBuilder = f;
}

/**
 * Every template the world uses (far and normal detail, all species, stages and variants, and shrubs), so the
 * cache can be filled ahead of need in small slices instead of all at once when a pan reaches new chunks.
 */
export function* warmTemplates(): Generator<void> {
  for (const lod of [1, 0, 2, 3] as const) {
    for (const sp of SPECIES)
      for (const st of [1, 2, 3, 4] as const)
        for (let v = 0; v < TREE_VARIANTS; v++) {
          treeGeo(sp, st, v, lod);
          yield;
        }
    for (let v = 0; v < 6; v++) {
      shrubGeo(v, lod);
      yield;
    }
  }
}

/** Look 3: the geometry helpers, shared with the flower, shrub, vine and prop builders (Flora.ts, Props.ts). */
export type { PuffOpts };
export { Buf, puff, tube, plate, randDir, hsl, hex, mix, scaleC, add, sub, mul, norm, cross, dot, len, clamp, lerp, rotateAxis, SUN };
export type { V, C, Palette };
