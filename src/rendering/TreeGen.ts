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
/**
 * P7-E29: tree shapes beyond each species' own, in the same leafy style (limbs, twigs, leaf sprays). A form changes
 * only the look; the species (what the simulation counts) stays: an umbrella or coastal tree is an oak, a columnar
 * one a birch (a poplar's shape), a fruit tree a cherry.
 *   umbrella  a wide, flat crown on a tall bare trunk (a stone pine's or acacia's shape)
 *   columnar  tall and narrow, leafy from low on the trunk to the top (a poplar's)
 *   fruit     short and multi-stemmed, a dense round crown dotted with fruit
 *   coastal   two or three stems leaning one way, the crown swept after them (the template leans toward +x)
 */
export type Form = 'standard' | 'umbrella' | 'columnar' | 'fruit' | 'coastal';
/** the species each form belongs to */
export const FORM_SPECIES: Record<Exclude<Form, 'standard'>, Species> = { umbrella: 'oak', columnar: 'birch', fruit: 'cherry', coastal: 'oak' };
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
  /** Where late-growing ornaments sprout, ordered by their first vertex. */
  attachments?: readonly { first: number; at: V }[];
  /** First vertex of each leaf card. Its first vertex is the leaf's attachment point. */
  leafStarts?: Uint32Array;
}

export const LEAF_CARD_VERTICES = 8;

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
  readonly attachments: { first: number; at: V }[] = [];
  readonly leafStarts?: number[];
  constructor(readonly age: TreeStage = 3, tree = false) {
    if (tree) this.leafStarts = [];
  }
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
      attachments: this.attachments.length ? this.attachments : undefined,
      leafStarts: this.leafStarts && new Uint32Array(this.leafStarts),
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

interface BranchPose {
  /** Attachment in the full tree and in this pose, before the overall tree proportions are applied. */
  root: V;
  anchor: V;
  extension: number;
}

function branchPoint(p: V, branch?: BranchPose): V {
  if (!branch) return p;
  return branch.extension ? add(branch.anchor, mul(sub(p, branch.root), branch.extension)) : branch.anchor;
}

// Rows are fork depths. The final entry repeats for later branches at each depth.
const SAPLING_BRANCHES = [[0.66, 0.66, 0], [0.56, 0], [0.4, 0]];
const YOUNG_BRANCHES = [[0.95, 0.95, 0.7], [0.83, 0.83, 0.46], [0.48, 0]];
const TRUNK_RADIUS_SCALE = 0.86;

/** Deeper forks and later side branches wait for their parent to grow. */
function branchPose(age: TreeStage, root: V, depth: number, order: number, parent?: BranchPose): BranchPose | undefined {
  if (age >= 3) return undefined;
  const stages = age === 1 ? SAPLING_BRANCHES : YOUNG_BRANCHES;
  const forks = stages[Math.min(depth, stages.length - 1)];
  const extension = forks[Math.min(order, forks.length - 1)];
  return { root, anchor: branchPoint(root, parent), extension: Math.min(extension, parent?.extension ?? 1) };
}

/** A tapered tube along a polyline. Buds keep their final normals even when collapsed at the branch joint. */
function tube(B: Buf, pts: V[], radii: number[], sides: number, colors: C[], flex: number[], cap = true, branch?: BranchPose) {
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
      B.v(branchPoint(add(pts[i], mul(d, radii[i])), branch), d, colors[i], flex[i]);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let s = 0; s < sides; s++) {
      const a = base + i * sides + s, b = base + i * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
      B.tri(a, b, c);
      B.tri(b, d, c);
    }
  if (cap) {
    const tip = B.v(branchPoint(add(pts[n - 1], mul(T[n - 1], radii[n - 1] * 0.5)), branch), T[n - 1], colors[n - 1], flex[n - 1]);
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
  branch?: BranchPose;
  /** Individual leaf order for crown silhouettes that use one leaf per spray. */
  order?: number;
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
function limb(B: Buf, R: () => number, from: V, dir: V, L: number, rad: number, depth: number, maxDepth: number, flex: number, o: LimbOpts, tips: Tip[], order = 0, parent?: BranchPose) {
  const branch = branchPose(B.age, from, depth, order, parent);
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
  tube(B, pts, radii, Math.max(3, o.sides - depth * 2), cols, fl, depth === maxDepth, branch);
  const end = pts[segs];
  if (depth >= maxDepth) {
    tips.push({ p: end, dir: d, branch });
    return;
  }
  // leaves partway along bigger limbs too, so the crown has no bare middle
  if (depth === maxDepth - 1) tips.push({ p: pts[segs - 1], dir: d, branch });
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
    limb(B, R, pts[i], cd, L * o.shrink * (0.85 + R() * 0.3), radii[i] * 0.75, depth + 1, maxDepth, fl[i], o, tips, k, branch);
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
    const order = at.order ?? i / n;
    // Keep unopened cards collapsed at the twig so each cohort can grow into the canopy in place.
    const birth = B.age === 1 ? clamp((0.16 - order) * 10, 0, 1)
      : B.age === 2 ? clamp((0.37 - order) * 6, 0, 1)
      : 1;
    const extension = at.branch?.extension ?? 1;
    const unfold = extension > 0 ? birth : 0;
    const root = branchPoint(at.p, at.branch);
    const offset = unfold * extension;
    const bud = offset === 1 ? p : add(root, mul(sub(p, at.p), offset));
    const leafSize = l * (B.age === 1 ? 1.5 : 1);
    B.leafStarts?.push(B.n);
    card(B, bud, dir, upv, leafSize * unfold, leafSize * narrow * unfold * unfold, col, mix(col, cr.pal.light, 0.12), flex * 0.85, Math.min(1.2, flex + 0.15), 0.5, 0.14, soft);
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
/**
 * P7-E29: the original leafy trees, varied. Each template variant has its own proportions and green, so neighbouring
 * trees differ: crown width (`w`) and height (`h`, the trunk and leader), how far the trunk leans, and a hue /
 * saturation / lightness shift within natural greens (olive, mid, deeper, a soft yellow-green; never lime).
 */
interface Shape {
  w: number;
  h: number;
  lean: number;
  hue: number;
  sat: number;
  lit: number;
}
const SHAPES: Shape[] = [
  { w: 1, h: 1, lean: 0.14, hue: 0, sat: -6, lit: 0 }, // mid green
  { w: 1.22, h: 0.86, lean: 0.18, hue: 10, sat: -18, lit: -2 }, // broad olive
  { w: 0.84, h: 1.18, lean: 0.1, hue: -2, sat: -8, lit: 1 }, // tall and narrow
  { w: 1.08, h: 1.04, lean: 0.34, hue: 14, sat: -10, lit: -6 }, // deep green, leaning
  { w: 0.94, h: 0.94, lean: 0.2, hue: -8, sat: -10, lit: 3 }, // soft yellow-green
  { w: 1.16, h: 1.1, lean: 0.12, hue: 6, sat: -14, lit: -4 }, // big and dark
];
const shapeOf = (variant: number) => SHAPES[((variant % SHAPES.length) + SHAPES.length) % SHAPES.length];

function leafPalette(sp: Species, R: () => number, sh: Shape): Palette {
  const j = (a: number, b: number) => lerp(a, b, R());
  const { hue: dh, sat: ds, lit: dl } = sh;
  switch (sp) {
    case 'cherry': {
      // pink blossom, with some green leaves mixed into the crown
      const h = j(...PALETTE.leaf.hue.cherry);
      return { base: hsl(h, 62, 76), light: hsl(h + 8, 70, 88), dark: hsl(h - 6, 45, 56) };
    }
    case 'birch': {
      const h = j(...PALETTE.leaf.hue.birch) + dh;
      return { base: hsl(h, 60 + ds, 36 + dl), light: hsl(h - 12, 68 + ds, 50 + dl), dark: hsl(h + 18, 50 + ds, 19 + dl) };
    }
    case 'pine': {
      const h = j(...PALETTE.leaf.hue.pine) + dh * 0.4;
      return { base: hsl(h, 42 + ds * 0.5, 32 + dl), light: hsl(h - 14, 48 + ds * 0.5, 50 + dl), dark: hsl(h + 10, 40, 18 + dl) };
    }
    case 'willow': {
      const h = j(...PALETTE.leaf.hue.willow) + dh;
      return { base: hsl(h, 56 + ds, 36 + dl), light: hsl(h - 12, 64 + ds, 50 + dl), dark: hsl(h + 18, 48 + ds, 20 + dl) };
    }
    default: {
      const h = j(...PALETTE.leaf.hue.oak) + dh;
      // Phase 6: brighter crowns with yellow-green sunlit tops and deep green undersides, like the reference
      return { base: hsl(h, 60 + ds, 33 + dl), light: hsl(h - 14, 68 + ds, 48 + dl), dark: hsl(h + 16, 52 + ds, 17 + dl) };
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
 * Units are tiles: a full-grown tree is about 1.1–1.5 tiles tall and fits a tile's footprint.
 */
export function buildTree(sp: Species, stage: TreeStage, variant: number, lod: Lod = 1, form: Form = 'standard'): TreeGeo {
  const B = new Buf(stage, true);
  // A tree keeps its trunk, branching pattern and leaf positions for its whole life.
  const R = rng((variant + 1) * 7919 + SPECIES.indexOf(sp) * 104729 + 3 * 13);
  const bark = BARK[sp];
  const barkDark = scaleC(bark, sp === 'birch' ? 0.45 : 0.7);
  const det = lod === 0 ? 0 : lod >= 2 ? 2 : 1;
  const big = lod === 0 ? 0 : lod >= 2 ? 3 : 2; // detail for the main clumps
  const S = 1.12;
  const sh = shapeOf(variant);
  const pal = leafPalette(sp, R, sh);
  if (form !== 'standard') {
    formTree(B, form, R, S, form === 'fruit' ? leafPalette('oak', R, sh) : pal, bark, barkDark, stage, lod);
    return proportion(B, sh, variant, stage).done();
  }
  if (lod === 0) return proportion(farTree(B, sp, R, S, pal, bark), sh, variant, stage).done();

  if (sp === 'pine') pine(B, R, S, pal, bark, det, big, lod);
  else if (sp === 'willow') willow(B, R, S, pal, bark, barkDark, det, big, lod);
  else broadleaf(B, sp, R, S, pal, bark, barkDark, lod);

  // machine side: brass irrigation collar with a little cyan status light (grown trees only)
  if (stage >= 3 && lod > 0) {
    B.attachments.push({ first: B.n, at: [0, 0, 0] });
    const tr = (sp === 'birch' ? 0.055 : 0.075) * S * TRUNK_RADIUS_SCALE;
    collar(B, 0.0, tr * 0.9, tr * 1.9, 0.045, BRASS);
    puff(B, { c: [tr * 1.9, 0.035, 0], r: [0.014, 0.014, 0.014], base: CYAN, light: CYAN, dark: scaleC(CYAN, 0.8), flex: 0, seed: 1, detail: 0, lump: 0 });
  }
  // Radiant: moss-jar lanterns and golden sun-berries
  if (stage === 4 && lod > 0) radiant(B, R, sp, S);
  return proportion(B, sh, variant, stage).done();
}

/**
 * P7-E29: gives a grown tree its variant's proportions: wider or narrower (x, z), taller or shorter (y), and a gentle
 * lean (a shear that grows with height, so the roots stay put). The same transform at every detail level, so a tree
 * keeps its shape when its level changes. Normals follow the stretch.
 */
function proportion(B: Buf, sh: Shape, variant: number, stage: TreeStage): Buf {
  const a = (variant * 2.399) % (Math.PI * 2);
  const k = Math.max(0, sh.lean - 0.1) * 0.5;
  const height = [0, 0.29, 0.62, 1, 1.08][stage];
  const spread = [0, 0.24, 0.58, 1, 1.08][stage];
  const w = sh.w * spread, h = sh.h * height;
  const kx = Math.cos(a) * k * height, kz = Math.sin(a) * k * height;
  for (const { at } of B.attachments) {
    at[0] = at[0] * w + at[1] * kx;
    at[2] = at[2] * w + at[1] * kz;
    at[1] *= h;
  }
  for (let i = 0; i < B.pos.length; i += 4) {
    const y = B.pos[i + 1];
    B.pos[i] = B.pos[i] * w + y * kx;
    B.pos[i + 1] = y * h;
    B.pos[i + 2] = B.pos[i + 2] * w + y * kz;
  }
  for (let i = 0; i < B.nrm.length; i += 3) {
    const n = norm([B.nrm[i] / w, B.nrm[i + 1] / h, B.nrm[i + 2] / w]);
    B.nrm[i] = n[0];
    B.nrm[i + 1] = n[1];
    B.nrm[i + 2] = n[2];
  }
  B.top *= h;
  return B;
}

/** The trunk: a gently curving, flared tube. Returns its top. */
function trunk(B: Buf, R: () => number, H: number, rad: number, bark: C, barkDark: C, segs: number, sides: number, birch = false): V {
  const lean: V = [(R() - 0.5) * 0.14, 1, (R() - 0.5) * 0.14];
  const tp: V[] = [];
  const tr: number[] = [];
  const tc: C[] = [];
  const tf: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    tp.push([lean[0] * k * H + Math.sin(k * 3 + R()) * 0.012, k * H, lean[2] * k * H]);
    tr.push(rad * TRUNK_RADIUS_SCALE * (1 - 0.4 * k) * (1 + 0.8 * Math.exp(-k * 7))); // root flare
    let c = mix(barkDark, bark, clamp(k * 1.6, 0, 1));
    if (birch && i > 0 && i < segs && R() < 0.5) c = hex(PALETTE.birchEye);
    tc.push(c);
    tf.push(k * 0.12);
  }
  tube(B, tp, tr, sides, tc, tf, false);
  return tp[segs];
}

/** Far zoom: a trunk, three limbs and a few dozen big leaves (cheap, calm at a distance, still a tree). */
function farTree(B: Buf, sp: Species, R: () => number, S: number, pal: Palette, bark: C) {
  const shape: Record<Species, [number, number, number]> = {
    // trunk height, crown radius, crown half-height (in units of S)
    oak: [0.5, 0.5, 0.4],
    cherry: [0.42, 0.52, 0.36],
    birch: [0.78, 0.3, 0.44],
    pine: [0.25, 0.36, 0.6],
    willow: [0.5, 0.5, 0.36],
  };
  const [th, cr, ch] = shape[sp];
  tube(B, [[0, 0, 0], [0, th * S + ch * S * 0.5, 0]], [0.07 * S * TRUNK_RADIUS_SCALE, 0.04 * S * TRUNK_RADIUS_SCALE], 4, [scaleC(bark, 0.75), bark], [0, 0.1], false);
  const heart: V = [0, th * S + ch * S * 0.8, 0];
  const crown: Crown = { heart, r: cr * S, pal };
  const n = 44;
  for (let i = 0; i < n; i++) {
    const u = norm([R() * 2 - 1, R() * 1.7 - 0.6, R() * 2 - 1]);
    const k = sp === 'pine' ? 1 - 0.75 * clamp(0.5 + 0.5 * u[1], 0, 1) : 1; // a cone for the pine
    const p: V = [heart[0] + u[0] * cr * S * 0.7 * k, heart[1] + u[1] * ch * S * 0.8, heart[2] + u[2] * cr * S * 0.7 * k];
    spray(B, R, { p, dir: u, order: i / n, branch: branchPose(B.age, heart, 0, i % 3) }, 1, 0.02, (sp === 'pine' || sp === 'willow' ? 0.3 : 0.26) * S, crown, 0.6, sp === 'pine' ? 0.4 : sp === 'willow' ? 0.35 : 0.7, sp === 'willow' ? 0.9 : 0.25);
  }
  return B;
}

/** P7-E29: the far tree of a form: a trunk (leaning by `lean`), and a few dozen big leaves over its crown. */
function farForm(B: Buf, R: () => number, S: number, pal: Palette, bark: C, th: number, cr: number, ch: number, lean = 0, narrow = 0.7) {
  const top: V = [lean * th * S, th * S + ch * S * 0.5, 0];
  tube(B, [[0, 0, 0], top], [0.07 * S * TRUNK_RADIUS_SCALE, 0.04 * S * TRUNK_RADIUS_SCALE], 4, [scaleC(bark, 0.75), bark], [0, 0.1], false);
  const heart: V = [lean * th * S * 1.2, th * S + ch * S * 0.8, 0];
  const crown: Crown = { heart, r: cr * S, pal };
  for (let i = 0; i < 44; i++) {
    const u = norm([R() * 2 - 1, R() * 1.7 - 0.6, R() * 2 - 1]);
    const p: V = [heart[0] + u[0] * cr * S * 0.7, heart[1] + u[1] * ch * S * 0.8, heart[2] + u[2] * cr * S * 0.7];
    spray(B, R, { p, dir: u, order: i / 44, branch: branchPose(B.age, heart, 0, i % 3) }, 1, 0.02, 0.26 * S, crown, 0.6, narrow, 0.25);
  }
}

/** P7-E29: the forms (see `Form`), built like the broadleaves: trunk, limbs, twigs and sprays of leaves. */
function formTree(B: Buf, form: Exclude<Form, 'standard'> | Form, R: () => number, S: number, pal: Palette, bark: C, barkDark: C, stage: TreeStage, lod: Lod) {
  const [n, k] = LEAVES[lod];
  const tips: Tip[] = [];
  if (form === 'umbrella') {
    if (lod === 0) return farForm(B, R, S, pal, bark, 0.95, 0.78, 0.2, 0, 0.75);
    // a tall bare trunk, then limbs that fan out almost level into a wide, flat-topped crown
    const trunkH = 0.95 * S;
    const trunkR = 0.08 * S;
    const top = trunk(B, R, trunkH, trunkR, bark, barkDark, 5, 7);
    const crown: Crown = { heart: [top[0], top[1] + 0.12 * S, top[2]], r: 0.8 * S, pal };
    const o: LimbOpts = { upturn: 0.12, kids: [3, 2], fork: 0.85, shrink: 0.66, bark, sides: 6 };
    const arms = 5;
    const a0 = R() * Math.PI * 2;
    for (let i = 0; i < arms; i++) {
      const a = a0 + (i / arms) * Math.PI * 2 + (R() - 0.5) * 0.4;
      limb(B, R, [top[0], top[1] - (i % 2) * 0.06 * S, top[2]], norm([Math.cos(a), 0.32 + R() * 0.12, Math.sin(a)]), 0.4 * S * (0.9 + R() * 0.2), trunkR * 0.6, 0, 2, 0.14, o, tips, i);
    }
    // leaves lie flat on top: sprays reach outward and droop a little at the rim
    for (const t of tips) spray(B, R, { ...t, dir: norm([t.dir[0], 0.25, t.dir[2]]) }, n, 0.2 * S, 0.1 * S * k, crown, 0.7, 0.62, 0.3);
    return;
  }
  if (form === 'columnar') {
    if (lod === 0) return farForm(B, R, S, pal, bark, 0.25, 0.24, 0.78, 0, 0.55);
    // tall and narrow: a straight leader, short upswept limbs all the way up, leaves close in
    const H = 1.6 * S;
    const trunkR = 0.05 * S;
    const top = trunk(B, R, H * 0.92, trunkR, bark, barkDark, 6, 6, true);
    const crown: Crown = { heart: [top[0] * 0.6, H * 0.6, top[2] * 0.6], r: 0.34 * S, pal };
    const o: LimbOpts = { upturn: 1.1, kids: [2], fork: 0.5, shrink: 0.65, bark, sides: 4 };
    const m = lod >= 2 ? 16 : 13;
    for (let i = 0; i < m; i++) {
      const kk = 0.1 + 0.86 * (i / (m - 1));
      const a = i * 2.4 + R() * 0.5;
      const from: V = [top[0] * kk, H * 0.92 * kk, top[2] * kk];
      // a spindle: limbs longest a third of the way up, short at the foot and the tip
      const reach = 0.1 + 0.18 * Math.sin(Math.PI * Math.min(1, kk * 1.15));
      limb(B, R, from, norm([Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55]), reach * S * (0.9 + R() * 0.2), trunkR * 0.45, 0, 1, 0.2 + 0.3 * kk, o, tips, (i + 1) % 4);
    }
    tips.push({ p: [top[0], H, top[2]], dir: [0, 1, 0] });
    for (const t of tips) spray(B, R, t, Math.max(4, Math.round(n * 0.75)), 0.12 * S, 0.105 * S * k, crown, 0.75, 0.55, 0.1);
    return;
  }
  if (form === 'fruit') {
    if (lod === 0) return farForm(B, R, S, pal, bark, 0.3, 0.42, 0.36, 0, 0.7);
    // short and multi-stemmed: three stems splay from the ground into one dense, round crown, dotted with fruit
    const stems = 3;
    const crown: Crown = { heart: [0, 0.62 * S, 0], r: 0.46 * S, pal };
    const o: LimbOpts = { upturn: 0.5, kids: [3], fork: 0.8, shrink: 0.7, bark, sides: 5 };
    const a0 = R() * Math.PI * 2;
    for (let i = 0; i < stems; i++) {
      const a = a0 + (i / stems) * Math.PI * 2;
      limb(B, R, [Math.cos(a) * 0.02 * S, 0, Math.sin(a) * 0.02 * S], norm([Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4]), 0.46 * S, 0.05 * S * TRUNK_RADIUS_SCALE, 0, 1, 0.08, o, tips, i);
    }
    for (const t of tips) spray(B, R, t, Math.round(n * 1.2), 0.2 * S, 0.11 * S * k, crown, 0.7, 0.62, 0.2);
    if (stage >= 3) {
      const fruit = PALETTE.cozy.fruit.map(hex);
      const col = fruit[Math.floor(R() * fruit.length)];
      const dots = lod >= 2 ? 14 : 9;
      for (let i = 0; i < dots; i++) {
        // fruit hangs among the leaves, a little below the twig ends
        const t = tips[i % tips.length];
        const c: V = add(t.p, [(R() - 0.5) * 0.16 * S, -0.04 * S - R() * 0.06 * S, (R() - 0.5) * 0.16 * S]);
        B.attachments.push({ first: B.n, at: c });
        puff(B, { c, r: [0.026, 0.026, 0.026], base: col, light: mix(col, [1, 1, 1], 0.3), dark: scaleC(col, 0.7), flex: 0.9, seed: i, detail: 0, lump: 0 });
      }
    }
    return;
  }
  // coastal: two or three stems leaning toward +x, the crown swept after them
  if (lod === 0) return farForm(B, R, S, pal, bark, 0.58, 0.55, 0.32, 0.4, 0.7);
  const crown: Crown = { heart: [0.34 * S, 0.82 * S, 0], r: 0.6 * S, pal };
  const o: LimbOpts = { upturn: 0.3, kids: [2, 2], fork: 0.8, shrink: 0.66, bark, sides: 5 };
  const stems = 3;
  for (let i = 0; i < stems; i++) {
    const side = (i - (stems - 1) / 2) * 0.35;
    const L = (0.62 - 0.08 * i) * S;
    const d = norm([0.36 + R() * 0.12, 1, side]);
    const pts: V[] = [[side * 0.03 * S, 0, side * 0.05 * S]];
    for (let j = 1; j <= 4; j++) {
      const kk = j / 4;
      // a stem that bends further over as it climbs
      pts.push(add(pts[0], [d[0] * L * kk * (0.6 + 0.6 * kk), d[1] * L * kk, d[2] * L * kk]));
    }
    const rad = (0.075 - 0.015 * i) * S;
    const stem = branchPose(B.age, pts[0], 0, i);
    tube(B, pts, pts.map((_, j) => rad * TRUNK_RADIUS_SCALE * (1 - 0.45 * (j / 4)) * (j === 0 ? 1.5 : 1)), 6, pts.map((_, j) => mix(barkDark, bark, j / 4)), pts.map((_, j) => (j / 4) * 0.12), false, stem);
    const top = pts[4];
    for (let a = 0; a < 2; a++) {
      const ang = (R() - 0.5) * 2.2 + (a ? 0.4 : -0.4);
      limb(B, R, top, norm([0.7 + Math.cos(ang) * 0.4, 0.55, Math.sin(ang)]), 0.3 * S, rad * 0.55, 0, 2, 0.16, o, tips, a, stem);
    }
  }
  for (const t of tips) spray(B, R, t, n, 0.18 * S, 0.1 * S * k, crown, 0.7, 0.62, 0.25);
}

function broadleaf(B: Buf, sp: Species, R: () => number, S: number, pal: Palette, bark: C, barkDark: C, lod: Lod) {
  const birch = sp === 'birch';
  const cherry = sp === 'cherry';
  const trunkH = (birch ? 0.8 : cherry ? 0.36 : 0.44) * S;
  const trunkR = (birch ? 0.05 : 0.088) * S;
  const top = trunk(B, R, trunkH, trunkR, bark, barkDark, birch ? 6 : 4, 7, birch);
  const crownH = (birch ? 0.3 : cherry ? 0.3 : 0.36) * S;
  const heart: V = [top[0], top[1] + crownH * (birch ? 0.1 : 0.75), top[2]];
  const crownR = (birch ? 0.5 : cherry ? 0.62 : 0.6) * S;
  const crown: Crown = { heart, r: crownR, pal };
  // cherry: mostly blossom; a Thriving or Radiant one leafs out a little green among it
  if (cherry) crown.alt = { pal: { base: hsl(96, 50, 40), light: hsl(84, 60, 56), dark: hsl(110, 44, 24) }, share: 0.16 };
  const o: LimbOpts = { upturn: birch ? 0.9 : cherry ? 0.35 : 0.55, kids: birch ? [2] : [3, lod >= 2 ? 3 : 2], fork: birch ? 0.6 : cherry ? 0.85 : 0.75, shrink: 0.68, bark, sides: 6 };
  const tips: Tip[] = [];
  const maxDepth = birch ? 1 : 2;
  if (birch) {
    // a slender leader with short upswept limbs along its upper half
    const n = 7;
    for (let i = 0; i < n; i++) {
      const k = 0.45 + 0.55 * (i / (n - 1));
      const a = i * 2.4 + R() * 0.6;
      const from: V = [top[0] * k, trunkH * k, top[2] * k];
      const dir = norm([Math.cos(a), 0.55 + R() * 0.3, Math.sin(a)]);
      limb(B, R, from, dir, (0.3 - 0.12 * k) * S * (0.9 + R() * 0.3), trunkR * 0.5 * (1.2 - 0.6 * k), 0, maxDepth, 0.2 + 0.2 * k, o, tips, i % 4);
    }
    limb(B, R, top, norm([(R() - 0.5) * 0.2, 1, (R() - 0.5) * 0.2]), 0.22 * S, trunkR * 0.5, 0, maxDepth, 0.3, o, tips);
  } else {
    // the trunk splits into limbs that reach up and out, plus a leader through the middle
    const n = 4;
    const a0 = R() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + (R() - 0.5) * 0.5;
      const rise = cherry ? 0.45 + R() * 0.25 : 0.7 + R() * 0.35;
      const dir = norm([Math.cos(a), rise, Math.sin(a)]);
      const from: V = [top[0], top[1] - (i % 2) * 0.05 * S, top[2]];
      limb(B, R, from, dir, (cherry ? 0.36 : 0.33) * S * (0.9 + R() * 0.25), trunkR * 0.62, 0, maxDepth, 0.14, o, tips, i + 1);
    }
    limb(B, R, top, norm([(R() - 0.5) * 0.3, 1, (R() - 0.5) * 0.3]), 0.28 * S, trunkR * 0.6, 0, maxDepth, 0.14, o, tips);
  }
  const [n, k] = LEAVES[lod];
  const L = (birch ? 0.08 : 0.1) * S * k;
  for (const t of tips) spray(B, R, t, n, 0.2 * S, L, crown, 0.65 + 0.3 * clamp(len(sub(t.p, heart)) / crownR, 0, 1), birch ? 0.55 : 0.62, birch ? 0.35 : 0.2);
}

function pine(B: Buf, R: () => number, S: number, pal: Palette, bark: C, _det: number, _big: number, lod: Lod = 1) {
  const H = 1.35 * S;
  const trunkR = 0.06 * S;
  tube(B, [[0, 0, 0], [0, H * 0.5, 0], [0, H * 0.97, 0]], [1.3, 0.8, 0.2].map((taper) => trunkR * TRUNK_RADIUS_SCALE * taper), 6, [scaleC(bark, 0.75), bark, bark], [0, 0.15, 0.4], false);
  const crown: Crown = { heart: [0, H * 0.55, 0], r: 0.6 * S, pal };
  const [n, k] = LEAVES[lod];
  const whorls = 5;
  for (let w = 0; w < whorls; w++) {
    const kk = w / (whorls - 1);
    const y = H * (0.24 + 0.68 * kk);
    const reach = (0.44 - 0.33 * kk) * S;
    const arms = 6 - Math.floor(kk * 2);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2 + w * 0.7 + R() * 0.3;
      // a bough: out and a little down, lifting at its tip
      const out: V = [Math.cos(a), 0, Math.sin(a)];
      const p0: V = [0, y, 0];
      const p1 = add(p0, add(mul(out, reach * 0.55), [0, -reach * 0.16, 0]));
      const p2 = add(p0, add(mul(out, reach), [0, -reach * 0.14, 0]));
      const branch = branchPose(B.age, p0, 0, (i + w) % arms);
      tube(B, [p0, p1, p2], [trunkR * 0.4 * (1 - 0.5 * kk), trunkR * 0.25, trunkR * 0.1], 3, [bark, bark, bark], [0.2 + 0.3 * kk, 0.4 + 0.3 * kk, 0.6 + 0.3 * kk], false, branch);
      for (const [q, f] of [[p1, 0.5], [p2, 0.7], [add(mul(add(p0, p1), 0.5), [0, 0, 0]), 0.4]] as [V, number][])
        spray(B, R, { p: q, dir: norm(add(out, [0, -0.2, 0])), branch }, Math.max(2, Math.round(n * 0.5)), 0.1 * S, 0.11 * S * k, crown, f + 0.2 * kk, 0.3, 0.5);
    }
  }
  spray(B, R, { p: [0, H * 0.97, 0], dir: [0, 1, 0] }, n, 0.05 * S, 0.1 * S * k, crown, 1, 0.3, -0.6);
}

function willow(B: Buf, R: () => number, S: number, pal: Palette, bark: C, barkDark: C, _det: number, _big: number, lod: Lod) {
  const trunkH = 0.5 * S;
  const top = trunk(B, R, trunkH, 0.085 * S, bark, barkDark, 4, 7);
  const heart: V = [top[0], trunkH + 0.2 * S, top[2]];
  const crown: Crown = { heart, r: 0.62 * S, pal };
  const [n, k] = LEAVES[lod];
  const arms = lod === 1 ? 7 : 9;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + R() * 0.4;
    const out: V = [Math.cos(a), 0, Math.sin(a)];
    // a limb that rises, arches over and lets its tip fall
    const reach = (0.34 + R() * 0.12) * S;
    const p1 = add(top, add(mul(out, reach * 0.45), [0, 0.3 * S, 0]));
    const p2 = add(top, add(mul(out, reach * 0.9), [0, 0.34 * S, 0]));
    const p3 = add(top, add(mul(out, reach * 1.15), [0, 0.2 * S, 0]));
    const branch = branchPose(B.age, top, 0, i);
    tube(B, [top, p1, p2, p3], [0.03 * S, 0.02 * S, 0.012 * S, 0.006 * S], 4, [bark, bark, bark, bark], [0.14, 0.25, 0.4, 0.55], false, branch);
    spray(B, R, { p: p2, dir: out, branch }, Math.round(n * 0.6), 0.12 * S, 0.11 * S * k, crown, 0.6, 0.3, 0.5);
    // hanging strands: thin stems that fall from the arch, leaves pointing down along them
    for (const [order, from] of [p2, p3, add(mul(add(p1, p2), 0.5), [0, 0, 0])].entries()) {
      const Ls = (0.42 + R() * 0.22) * S; // P7-E29: longer, so it reads as weeping
      const sway: V = [(R() - 0.5) * 0.08 * S, 0, (R() - 0.5) * 0.08 * S];
      const mid = add(from, add(mul(sway, 0.5), [0, -Ls * 0.5, 0]));
      const end = add(from, add(sway, [0, -Ls, 0]));
      const strand = branchPose(B.age, from, 1, order, branch);
      tube(B, [from, mid, end], [0.004 * S, 0.003 * S, 0.002 * S], 3, [pal.dark, pal.dark, pal.base], [0.55, 0.85, 1.1], false, strand);
      for (const [q, f] of [[mid, 0.85], [end, 1.1], [add(mul(add(from, mid), 0.5), [0, 0, 0]), 0.7]] as [V, number][])
        spray(B, R, { p: q, dir: [0, -1, 0], branch: strand }, Math.max(2, Math.round(n * 0.35)), 0.04 * S, 0.1 * S * k, crown, f, 0.26, 1.6);
    }
  }
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
    B.attachments.push({ first: B.n, at: top });
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
    const c: V = [Math.cos(a) * rr, y, Math.sin(a) * rr];
    B.attachments.push({ first: B.n, at: c });
    puff(B, { c, r: [0.022, 0.022, 0.022], base: hex(PALETTE.glow.gold), light: hex(PALETTE.glow.sun), dark: hex(PALETTE.glow.sunDark), flex: 0.9, seed: i, detail: 0, lump: 0 });
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
/** P7-E29: six variants (proportions and greens, SHAPES), was four */
export const TREE_VARIANTS = 6;
export function treeGeo(sp: Species, stage: TreeStage, variant: number, lod: Lod = 1, form: Form = 'standard'): TreeGeo {
  const key = `${sp}|${stage}|${variant % TREE_VARIANTS}|${lod}|${form}`;
  let g = cache.get(key);
  if (!g) cache.set(key, (g = buildTree(sp, stage, variant % TREE_VARIANTS, lod, form)));
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
    // P7-E29: forms keep their own silhouette from sapling to maturity.
    for (const [form, sp] of Object.entries(FORM_SPECIES) as [Form, Species][])
      for (const st of [1, 2, 3, 4] as const)
        for (let v = 0; v < TREE_VARIANTS; v++) {
          treeGeo(sp, st, v, lod, form);
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
