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

export type Species = 'oak' | 'cherry' | 'birch' | 'pine' | 'willow';
export const SPECIES: Species[] = ['oak', 'cherry', 'birch', 'pine', 'willow'];
/** Tile stages that carry a tree: 1 sapling (Restored), 2 young (Blooming), 3 full (Thriving), 4 Radiant. */
export type TreeStage = 1 | 2 | 3 | 4;
export type Lod = 0 | 1 | 2; // 0 far · 1 normal · 2 close-up (showcase)

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
}

/** A soft, lumpy foliage clump: an ellipsoid with low-frequency bumps and baked sun / sky / ambient shading. */
function puff(B: Buf, o: PuffOpts) {
  const ico = icosphere(o.detail);
  const R = rng(o.seed);
  // a handful of random lobes give the cauliflower silhouette of the reference
  const lobes: { d: V; k: number }[] = [];
  for (let i = 0; i < 9; i++) lobes.push({ d: norm([R() * 2 - 1, R() * 0.6 + 0.2, R() * 2 - 1]), k: 0.5 + R() * 0.5 });
  const lump = o.lump ?? 0.16;
  const base = B.n;
  for (const u of ico.v) {
    let bump = 0;
    for (const l of lobes) bump += Math.pow(Math.max(0, dot(u, l.d)), 9) * l.k;
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
    col = scaleC(col, 0.94 + R() * 0.1);
    B.v(p, n, col, o.flex * (0.75 + 0.25 * up));
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
      const h = j(330, 346);
      return { base: hsl(h, 62, 76), light: hsl(h + 8, 70, 88), dark: hsl(h - 6, 45, 56) };
    }
    case 'birch': {
      const h = j(90, 104);
      return { base: hsl(h, 54, 34), light: hsl(h - 12, 62, 52), dark: hsl(h + 26, 46, 18) };
    }
    case 'pine': {
      const h = j(146, 158);
      return { base: hsl(h, 42, 32), light: hsl(h - 14, 48, 50), dark: hsl(h + 10, 40, 18) };
    }
    case 'willow': {
      const h = j(94, 106);
      return { base: hsl(h, 48, 38), light: hsl(h - 12, 58, 56), dark: hsl(h + 22, 42, 20) };
    }
    default: {
      const h = j(108, 124) - (stage === 4 ? 6 : 0);
      return { base: hsl(h, 52, 30), light: hsl(h - 14, 60, 47), dark: hsl(h + 28, 50, 15) };
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
const BRASS = hex('#d9a441');
const CREAM = hex('#f6efdc');
const CYAN = hex('#6fe3e0');
const GLOW = hex('#ffe9a3');
const NAVY = hex('#24406e');
const STAKE = hex('#d8c07a');
const MULCH = hsl(25, 38, 24);

/** One crown "anchor": where a limb ends and a foliage clump sits. */
interface Anchor {
  p: V;
  r: number;
}

/**
 * Builds one tree. `variant` changes the branching and crown layout; `stage` its growth; `lod` its detail.
 * Units are tiles: a full-grown tree is about 1.1–1.5 tiles tall and fits a tile's footprint.
 */
export function buildTree(sp: Species, stage: TreeStage, variant: number, lod: Lod = 1): TreeGeo {
  const B = new Buf();
  const R = rng((variant + 1) * 7919 + SPECIES.indexOf(sp) * 104729 + stage * 13);
  const bark = BARK[sp];
  const barkDark = scaleC(bark, sp === 'birch' ? 0.45 : 0.7);
  const det = lod === 0 ? 0 : lod === 2 ? 2 : 1;
  const big = lod === 0 ? 0 : lod === 2 ? 3 : 2; // detail for the main clumps
  if (stage === 1) return sapling(B, sp, R, lod).done();
  const S = (stage === 2 ? 0.62 : stage === 4 ? 1.08 : 1) * 1.12; // overall size
  const pal = leafPalette(sp, R, stage);

  if (sp === 'pine') pine(B, R, S, pal, bark, det, big);
  else if (sp === 'willow') willow(B, R, S, pal, bark, barkDark, det, big, lod);
  else broadleaf(B, sp, R, S, pal, bark, barkDark, det, big, stage);

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

function broadleaf(B: Buf, sp: Species, R: () => number, S: number, pal: Palette, bark: C, barkDark: C, det: number, big: number, stage: TreeStage) {
  const birch = sp === 'birch';
  const cherry = sp === 'cherry';
  const trunkH = (birch ? 0.78 : cherry ? 0.42 : 0.5) * S;
  const trunkR = (birch ? 0.05 : 0.075) * S;
  const lean: V = [(R() - 0.5) * 0.12, 1, (R() - 0.5) * 0.12];
  // trunk: a gently curving, flared tube
  const tp: V[] = [];
  const tr: number[] = [];
  const tc: C[] = [];
  const tf: number[] = [];
  const segs = birch ? 6 : 4;
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    tp.push([lean[0] * k * trunkH + Math.sin(k * 3 + R()) * 0.012, k * trunkH, lean[2] * k * trunkH]);
    tr.push(trunkR * (1 - 0.35 * k) * (1 + 0.6 * Math.exp(-k * 8)));
    let c = mix(barkDark, bark, clamp(k * 1.6, 0, 1));
    if (birch && i > 0 && i < segs && R() < 0.5) c = hsl(30, 12, 22); // birch eyes
    tc.push(c);
    tf.push(k * 0.12);
  }
  tube(B, tp, tr, 7, tc, tf, false);
  const top = tp[tp.length - 1];
  // crown heart and anchors
  const crownY = top[1] + (birch ? 0.22 : 0.24) * S;
  const heart: V = [top[0], crownY, top[2]];
  const anchors: Anchor[] = [];
  const nLimb = birch ? 3 : cherry ? 5 : 4;
  const spread = (birch ? 0.16 : cherry ? 0.3 : 0.26) * S;
  for (let i = 0; i < nLimb; i++) {
    const a = (i / nLimb) * Math.PI * 2 + R() * 0.8;
    const rr = spread * (0.75 + R() * 0.4);
    const y = crownY + (birch ? (i - 1) * 0.16 * S : (R() - 0.35) * 0.14 * S);
    anchors.push({ p: [heart[0] + Math.cos(a) * rr, y, heart[2] + Math.sin(a) * rr], r: (birch ? 0.17 : cherry ? 0.2 : 0.22) * S * (0.8 + R() * 0.35) });
  }
  // limbs from the trunk top to each clump (mostly hidden, they show between clumps)
  for (const an of anchors) {
    const mid: V = [lerp(top[0], an.p[0], 0.55), lerp(top[1], an.p[1], 0.35) + 0.03 * S, lerp(top[2], an.p[2], 0.55)];
    tube(B, [top, mid, an.p], [trunkR * 0.55, trunkR * 0.38, trunkR * 0.22], 5, [bark, bark, bark], [0.12, 0.3, 0.5]);
  }
  const crownR = spread + 0.3 * S;
  // the clumps: a big heart clump, one per limb, and a crowning top
  const heartR: V = birch ? [0.22 * S, 0.34 * S, 0.22 * S] : cherry ? [0.4 * S, 0.27 * S, 0.4 * S] : [0.36 * S, 0.3 * S, 0.36 * S];
  const leaf = (p: V, r: V, d: number, seed: number, flex: number) =>
    puff(B, { c: p, r, base: pal.base, light: pal.light, dark: pal.dark, flex, seed, detail: d, crown: heart, crownR, lump: 0.32 });
  leaf(heart, heartR, big, R() * 1e9, 0.55);
  for (const an of anchors) leaf(an.p, [an.r, an.r * 0.85, an.r], det, R() * 1e9, 0.8);
  if (!cherry || stage !== 2) leaf([heart[0] + (R() - 0.5) * 0.06, crownY + heartR[1] * 0.75, heart[2] + (R() - 0.5) * 0.06], mul([1, 0.8, 1], (birch ? 0.16 : 0.2) * S) as V, det, R() * 1e9, 0.9);
  // cherry blossom: a few white clumps and petal specks
  if (cherry) for (let i = 0; i < 2; i++) {
    const an = anchors[(i * 2) % anchors.length];
    puff(B, { c: add(an.p, [0, an.r * 0.5, 0]), r: [an.r * 0.5, an.r * 0.42, an.r * 0.5], base: hsl(340, 30, 95), light: hsl(0, 0, 99), dark: hsl(338, 40, 80), flex: 0.85, seed: R() * 1e9, detail: det, crown: heart, crownR });
  }
  // machine side: glass sun-petals on the birch, turned to the light
  if (birch && det > 0) {
    const n = 3 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.6;
      const p: V = [heart[0] + Math.cos(a) * 0.27 * S, crownY + (R() - 0.3) * 0.3 * S, heart[2] + Math.sin(a) * 0.27 * S];
      const face = norm(add(SUN, [Math.cos(a) * 0.4, 0.2, Math.sin(a) * 0.4]));
      plate(B, add(p, mul(face, -0.004)), 0.072 * S, face, BRASS, 0.85);
      plate(B, p, 0.058 * S, face, NAVY, 0.85);
      plate(B, add(p, mul(face, 0.003)), 0.03 * S, face, hex('#4fb0ad'), 0.85);
    }
  }
}

function pine(B: Buf, R: () => number, S: number, pal: Palette, bark: C, det: number, big: number) {
  const H = 1.35 * S;
  const trunkR = 0.065 * S;
  tube(B, [[0, 0, 0], [0, H * 0.5, 0], [0, H * 0.9, 0]], [trunkR * 1.3, trunkR * 0.8, trunkR * 0.3], 6, [scaleC(bark, 0.75), bark, bark], [0, 0.15, 0.4], false);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1);
    const y = H * (0.28 + 0.2 * i);
    const r = (0.42 - 0.3 * k) * S;
    const heart: V = [0, y, 0];
    // a tier: a soft, drooping skirt of needles (squashed lumpy clump), darker underneath
    puff(B, { c: heart, r: [r, (0.15 + 0.03 * (1 - k)) * S, r], base: pal.base, light: pal.light, dark: pal.dark, flex: 0.35 + 0.5 * k, seed: R() * 1e9, detail: i === 0 ? big : det, lump: 0.28, crown: [0, y - 0.1, 0], crownR: r });
  }
  puff(B, { c: [0, H * 0.98, 0], r: [0.07 * S, 0.14 * S, 0.07 * S], base: pal.base, light: pal.light, dark: pal.dark, flex: 1, seed: R() * 1e9, detail: det, lump: 0.1 });
}

function willow(B: Buf, R: () => number, S: number, pal: Palette, bark: C, barkDark: C, _det: number, big: number, lod: Lod) {
  const trunkH = 0.5 * S;
  const tr = 0.085 * S;
  const lx = (R() - 0.5) * 0.14;
  tube(B, [[0, 0, 0], [lx * 0.5, trunkH * 0.5, 0], [lx, trunkH, 0.02]], [tr * 1.4, tr * 0.9, tr * 0.6], 7, [barkDark, bark, bark], [0, 0.08, 0.15], false);
  const heart: V = [lx, trunkH + 0.2 * S, 0.02];
  const domeR: V = [0.44 * S, 0.3 * S, 0.44 * S];
  puff(B, { c: heart, r: domeR, base: pal.base, light: pal.light, dark: pal.dark, flex: 0.5, seed: R() * 1e9, detail: big, lump: 0.18, crown: heart, crownR: 0.5 * S });
  // weeping curtains: ribbons that hang from the dome's rim and swing most at the tips
  const n = lod === 0 ? 0 : 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R() * 0.3;
    const rim: V = add(heart, [Math.cos(a) * domeR[0] * 0.92, -domeR[1] * 0.15, Math.sin(a) * domeR[2] * 0.92]);
    const L = (0.32 + R() * 0.22) * S;
    const out: V = [Math.cos(a), 0, Math.sin(a)];
    const pts: V[] = [rim, add(rim, add(mul(out, 0.04 * S), [0, -L * 0.5, 0])), add(rim, add(mul(out, 0.05 * S), [0, -L, 0]))];
    const c0 = pal.base;
    const c1 = mix(pal.light, pal.base, 0.4);
    tube(B, pts, [0.03 * S, 0.026 * S, 0.012 * S], 4, [c0, c1, c1], [0.55, 0.85, 1.1]);
  }
}

function sapling(B: Buf, sp: Species, R: () => number, lod: Lod) {
  const pal = leafPalette(sp, R, 1);
  const bark = BARK[sp];
  const h = 0.3 + R() * 0.06;
  // mulch ring and a bamboo stake tied with twine
  plate(B, [0, 0.004, 0], 0.17, [0, 1, 0], MULCH, 0, 9);
  tube(B, [[0, 0, 0], [0.01, h * 0.6, 0], [0.005, h, 0.005]], [0.022, 0.016, 0.01], 5, [bark, bark, bark], [0, 0.25, 0.5]);
  if (lod > 0) {
    tube(B, [[0.06, 0, 0.02], [0.06, h * 0.85, 0.02]], [0.009, 0.007], 4, [STAKE, STAKE], [0, 0]);
    tube(B, [[0.06, h * 0.5, 0.02], [0.006, h * 0.5, 0.0]], [0.004, 0.004], 3, [hex('#b48a5a'), hex('#b48a5a')], [0, 0.05], false);
  }
  if (sp === 'pine') {
    puff(B, { c: [0, h * 0.75, 0], r: [0.09, 0.07, 0.09], base: pal.base, light: pal.light, dark: pal.dark, flex: 0.6, seed: R() * 1e9, detail: 1 });
    puff(B, { c: [0, h * 1.02, 0], r: [0.05, 0.07, 0.05], base: pal.base, light: pal.light, dark: pal.dark, flex: 0.8, seed: R() * 1e9, detail: 1 });
    return B;
  }
  const c: V = [0.005, h + 0.04, 0.005];
  puff(B, { c, r: [0.1, 0.085, 0.1], base: pal.base, light: pal.light, dark: pal.dark, flex: 0.7, seed: R() * 1e9, detail: 1, lump: 0.2 });
  puff(B, { c: add(c, [0.06, -0.03, 0.03]), r: [0.06, 0.05, 0.06], base: pal.base, light: pal.light, dark: pal.dark, flex: 0.75, seed: R() * 1e9, detail: 1 });
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
    puff(B, { c: [Math.cos(a) * rr, y, Math.sin(a) * rr], r: [0.022, 0.022, 0.022], base: hex('#ffd34d'), light: hex('#fff3b0'), dark: hex('#e7b54a'), flex: 0.9, seed: i, detail: 0, lump: 0 });
  }
}

/** A small lush shrub of two or three clumps (non-tree tiles in full bloom). */
export function buildShrub(variant: number, lod: Lod = 1): TreeGeo {
  const B = new Buf();
  const R = rng(variant * 9973 + 7);
  const h = 98 + R() * 30;
  const pal = { base: hsl(h, 55, 40), light: hsl(h - 20, 66, 58), dark: hsl(h + 16, 45, 24) };
  const n = 2 + Math.floor(R() * 2);
  const det = lod === 0 ? 0 : 1;
  for (let i = 0; i < n; i++) {
    const s = 0.12 + R() * 0.07;
    const a = R() * Math.PI * 2;
    const d = i === 0 ? 0 : 0.1 + R() * 0.08;
    puff(B, { c: [Math.cos(a) * d, s * 0.75, Math.sin(a) * d], r: [s, s * 0.82, s], base: pal.base, light: pal.light, dark: pal.dark, flex: 0.25, seed: R() * 1e9, detail: det, lump: 0.24 });
  }
  // the odd flowering bush
  if (R() < 0.35)
    for (let i = 0; i < 4; i++) {
      const a = R() * Math.PI * 2;
      puff(B, { c: [Math.cos(a) * 0.12, 0.2 + R() * 0.05, Math.sin(a) * 0.12], r: [0.025, 0.02, 0.025], base: hex(['#ff7eb6', '#ffd23f', '#ffffff', '#b48cff'][i % 4]), light: [1, 1, 1], dark: hex('#e88aa8'), flex: 0.3, seed: i, detail: 0, lump: 0 });
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
  if (!g) cache.set(key, (g = buildShrub(variant % 6, lod)));
  return g;
}
