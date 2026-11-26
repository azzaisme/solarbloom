/**
 * Giant trees (owner, 26 Nov 2026): huge old trees whose canopy spreads well above the follow camera, so Bloombot
 * walks under the leaves and the player sees the trunk and the underside of the canopy as they pass.
 *
 * Built like the other trees (TreeGen.ts), in the same soft style: a flared trunk on buttress roots, then limbs that
 * reach up and out, forking into twigs, with sprays of leaf cards at their ends (smooth tubes and soft-lit leaves,
 * never faceted). Units are tiles; the tree stands on its trunk's centre.
 *
 * Stages: 0 bare (before its ground is restored: a dusty, leafless giant), then 1–4 as it leafs out. The trunk and
 * limbs are full size at every stage (it is an old tree waking, not a sapling); the leaves come in a share at a time,
 * the same leaves at each stage (each spray's leaves are a prefix of the full set), shifting from Frog Green to Leaf
 * Green (PALETTE.leaf.young / grown) as they mature, and Radiant adds sun-berries and moss-jar lanterns under the canopy.
 */
import { PALETTE } from './Palette';
import { Buf, LEAVES, hex, hsl, limb, lerp, mix, norm, puff, rng, scaleC, spray, tube, type C, type Crown, type LimbOpts, type Lod, type Palette, type Tip, type TreeGeo, type V } from './TreeGen';

export type GiantStage = 0 | 1 | 2 | 3 | 4;
export const GIANT_VARIANTS = 6;

/** Share of each spray's leaves, and leaf size, per stage (bare … Radiant). */
const LEAF_SHARE = [0, 0.3, 0.62, 1, 1];
const LEAF_SIZE = [0, 0.72, 0.86, 1, 1];
/** How far the leaves have deepened from Frog Green toward Leaf Green, per stage. */
const LEAF_AGE = [0, 0, 0.5, 1, 1];

/** A hex colour as sRGB HSL: hue in degrees, saturation and lightness in percent. */
function toHsl(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), l = (hi + lo) / 2, d = hi - lo;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hue = hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue * 60, s * 100, l * 100];
}

/** The giant's leaves at a stage: between the palette's young and grown greens, light on top, dark underneath. */
function giantLeaves(stage: GiantStage, jitter: number): Palette {
  const y = toHsl(PALETTE.leaf.young), g = toHsl(PALETTE.leaf.grown);
  const k = LEAF_AGE[stage];
  const h = lerp(y[0], g[0], k) + (jitter - 0.5) * 6;
  const s = lerp(y[1], g[1], k);
  const l = lerp(y[2], g[2], k);
  // the underside stays readable from below (a little lighter than a small tree's shaded heart)
  return { base: hsl(h, s, l), light: hsl(h - 8, s + 8, l + 13), dark: hsl(h + 12, s - 4, l - 16) };
}

/** Per-variant proportions: limbs, how wide and how tall. */
const SHAPES = [
  { limbs: 6, w: 1, h: 1 },
  { limbs: 7, w: 1.08, h: 0.96 },
  { limbs: 6, w: 0.94, h: 1.06 },
  { limbs: 7, w: 1.04, h: 1.02 },
  { limbs: 5, w: 1.1, h: 0.98 },
  { limbs: 6, w: 0.98, h: 1.04 },
];

/** Measured from the built geometry: what the camera and Bloombot need to know (see GiantTrees.ts). */
export interface GiantBounds {
  /** the lowest leaf (world y above the trunk's foot) */
  underside: number;
  /** the highest point */
  top: number;
  /** the leaves' reach from the trunk (horizontal) */
  reach: number;
}

export interface GiantGeo extends TreeGeo {
  bounds: GiantBounds;
}

/**
 * Builds one giant. `variant` (0–5) changes its limbs and proportions; `stage` how far it has leafed out; `lod` its
 * detail (0 far … 2 close).
 */
export function buildGiant(stage: GiantStage, variant: number, lod: Lod = 1): GiantGeo {
  const v = ((variant % GIANT_VARIANTS) + GIANT_VARIANTS) % GIANT_VARIANTS;
  const sh = SHAPES[v];
  const B = new Buf(3, true);
  // the skeleton draws from its own stream, so it is the same at every stage and detail
  const R = rng(9001 + v * 7907);
  const barkGrown = hex(PALETTE.wood.bark);
  const barkDeep = hex(PALETTE.wood.deep);
  // bare: dusty and pale, the dead ground's colour in its bark
  const dust = hex(PALETTE.ground.dead.lawn[0]);
  const bark = stage === 0 ? mix(barkGrown, dust, 0.45) : barkGrown;
  const barkDark = stage === 0 ? mix(barkDeep, dust, 0.35) : barkDeep;

  // ── trunk: a tall, gently curving column on a wide root flare ──
  const H = 6.0 * sh.h;
  const segs = lod === 0 ? 5 : 9;
  const sides = lod === 0 ? 8 : 14;
  const lean: V = [(R() - 0.5) * 0.08, 1, (R() - 0.5) * 0.08];
  const tp: V[] = [];
  const tr: number[] = [];
  const tc: C[] = [];
  const tf: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    tp.push([lean[0] * k * H + Math.sin(k * 2.6 + v) * 0.06, k * H, lean[2] * k * H + Math.cos(k * 2.2 + v) * 0.05]);
    tr.push(0.4 * (1 - 0.34 * k) * (1 + 0.65 * Math.exp(-k * 6)));
    tc.push(mix(barkDark, bark, Math.min(1, k * 1.4)));
    tf.push(k * 0.04);
  }
  tube(B, tp, tr, sides, tc, tf, false);
  const top = tp[segs];

  // ── buttress roots: wide, low and soft, spreading round the foot ──
  const roots = lod === 0 ? 5 : 7;
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + R() * 0.5;
    const c = Math.cos(a), s = Math.sin(a);
    const reach = 1.05 + R() * 0.25;
    tube(B, [[c * 0.22, 0.95, s * 0.22], [c * 0.62, 0.3, s * 0.62], [c * reach, -0.04, s * reach]], [0.24, 0.15, 0.05], lod === 0 ? 4 : 7, [bark, barkDark, barkDark], [0, 0, 0], true);
  }

  // ── limbs: up and out from the top of the trunk into a broad crown ──
  const o: LimbOpts = { upturn: 0.22, kids: lod === 0 ? [3, 0] : [3, 2], fork: 0.78, shrink: 0.62, bark, sides: lod === 0 ? 5 : 9 };
  const maxDepth = lod === 0 ? 1 : 2;
  const tips: Tip[] = [];
  const a0 = R() * Math.PI * 2;
  for (let i = 0; i < sh.limbs; i++) {
    const a = a0 + (i / sh.limbs) * Math.PI * 2 + (R() - 0.5) * 0.45;
    const from: V = [top[0] * (0.86 + 0.14 * (i % 2)), H * (0.86 + 0.14 * (i % 2)), top[2] * (0.86 + 0.14 * (i % 2))];
    const dir = norm([Math.cos(a), 0.5 + R() * 0.22, Math.sin(a)]);
    limb(B, R, from, dir, 2.8 * sh.w * (0.92 + R() * 0.16), 0.2, 0, maxDepth, 0.06, o, tips, i);
  }
  limb(B, R, top, norm([(R() - 0.5) * 0.3, 1, (R() - 0.5) * 0.3]), 2.0 * sh.h, 0.2, 0, maxDepth, 0.06, o, tips);

  // ── leaves ──
  if (stage > 0) {
    const pal = giantLeaves(stage, R());
    const crown: Crown = { heart: [top[0], H + 2.1 * sh.h, top[2]], r: 4.8 * sh.w, pal };
    const [n0, k] = LEAVES[lod];
    const n = lod === 0 ? 10 : Math.round(n0 * 1.5);
    const L = 0.36 * k * (lod === 0 ? 1.1 : 1) * LEAF_SIZE[stage];
    const count = Math.max(1, Math.round(n * LEAF_SHARE[stage]));
    tips.forEach((t, i) => {
      // each spray's leaves come from their own stream: a younger stage shows the first of the same leaves
      const LR = rng(31337 + v * 4099 + i * 131);
      spray(B, LR, t, count, 0.95, L, crown, 0.55, 0.62, 0.22);
    });
    if (stage === 4 && lod > 0) radiantGiant(B, R, crown);
  }
  const geo = B.done() as GiantGeo;
  geo.bounds = measure(geo);
  return geo;
}

/** Radiant: moss-jar lanterns hanging under the canopy (seen from below) and sun-berries over it. */
function radiantGiant(B: Buf, R: () => number, cr: Crown) {
  const cream = hex(PALETTE.plastic.lantern);
  const glow = hex(PALETTE.glow.honey);
  const brass = hex(PALETTE.trim.brass);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + R();
    const rr = 1.8 + R() * 1.4;
    const at: V = [cr.heart[0] + Math.cos(a) * rr, cr.heart[1] - 1.4, cr.heart[2] + Math.sin(a) * rr];
    const bot: V = [at[0], at[1] - 0.5, at[2]];
    B.attachments.push({ first: B.n, at });
    tube(B, [at, bot], [0.01, 0.01], 3, [barkOf(), barkOf()], [0.6, 0.7], false);
    puff(B, { c: [bot[0], bot[1] - 0.1, bot[2]], r: [0.1, 0.13, 0.1], base: cream, light: [1, 1, 1], dark: scaleC(cream, 0.85), flex: 0.7, seed: i, detail: 1, lump: 0 });
    puff(B, { c: [bot[0], bot[1] - 0.11, bot[2]], r: [0.065, 0.08, 0.065], base: glow, light: glow, dark: glow, flex: 0.7, seed: i, detail: 0, lump: 0 });
    tube(B, [[bot[0], bot[1] + 0.015, bot[2]], [bot[0], bot[1] - 0.03, bot[2]]], [0.06, 0.07], 6, [brass, brass], [0.7, 0.7]);
  }
  for (let i = 0; i < 14; i++) {
    const a = R() * Math.PI * 2;
    const rr = 1.5 + R() * 3;
    const c: V = [cr.heart[0] + Math.cos(a) * rr, cr.heart[1] + 0.6 + R() * 1.4, cr.heart[2] + Math.sin(a) * rr];
    B.attachments.push({ first: B.n, at: c });
    puff(B, { c, r: [0.07, 0.07, 0.07], base: hex(PALETTE.glow.gold), light: hex(PALETTE.glow.sun), dark: hex(PALETTE.glow.sunDark), flex: 0.8, seed: i, detail: 0, lump: 0 });
  }
}
const barkOf = () => hex(PALETTE.wood.deep);

/** Leaf extent: the lowest leaf, the top, and the reach (from the leaf flag in each vertex's flex). */
function measure(g: TreeGeo): GiantBounds {
  let underside = Infinity, top = 0, reach = 0;
  const starts = g.leafStarts ?? new Uint32Array();
  for (const s of starts) {
    for (let j = 0; j < 8; j++) {
      const i = (s + j) * 4;
      const y = g.pos[i + 1];
      if (y < underside) underside = y;
      reach = Math.max(reach, Math.hypot(g.pos[i], g.pos[i + 2]));
    }
  }
  for (let i = 1; i < g.pos.length; i += 4) top = Math.max(top, g.pos[i]);
  return { underside: Number.isFinite(underside) ? underside : top, top, reach };
}

const cache = new Map<string, GiantGeo>();
/** Template cache: one giant per stage / variant / detail. */
export function giantGeo(stage: GiantStage, variant: number, lod: Lod = 1): GiantGeo {
  const key = `${stage}|${((variant % GIANT_VARIANTS) + GIANT_VARIANTS) % GIANT_VARIANTS}|${lod}`;
  let g = cache.get(key);
  if (!g) cache.set(key, (g = buildGiant(stage, variant, lod)));
  return g;
}

/** The grown giant's leaf bounds for a variant (what the camera keeps under). */
export function giantBounds(variant: number): GiantBounds {
  return giantGeo(3, variant, 1).bounds;
}

/** Every giant template the world uses (far and normal detail, every stage and variant), built a slice at a time. */
export function* warmGiants(): Generator<void> {
  for (const lod of [0, 1] as const)
    for (let v = 0; v < GIANT_VARIANTS; v++)
      for (const st of [0, 1, 2, 3, 4] as const) {
        giantGeo(st, v, lod);
        yield;
      }
}
