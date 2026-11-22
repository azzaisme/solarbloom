/**
 * E19.1.3 (#249): how each plot option looks on its plot, and the tidy "waiting" look of an empty plot.
 *
 * Everything is drawn into the chunk's own merged meshes (vertex-coloured primitives and the foliage batch) or its
 * model batch, so a plot costs no extra draw calls (E19.1.5). Existing hand-built models are used where one fits
 * (bench, market stall, lantern, planters, crate, mooring post); without them (models off, or still loading) the
 * same spot falls back to primitives. A Meshy-built model per option can replace any of these later through the
 * model pipeline (#197, #198): add it to the batch here under the option's id, keeping the fallback.
 *
 * Far level of detail is one coloured pad and a single blob, so a zoomed-out city full of plots stays cheap.
 *
 * E27.2 (#680): the plant plots grow from the park's own planting (leafy shrubs, flower clumps, grass and ivy from
 * Flora.ts) instead of cones and balls, so they sit in the park and can show being picked, pruned and growing back.
 * Arches and wheels are rings of short pieces, because the chunk mesh has no torus and no rotation.
 */
import type { PlotSpot } from '../core/Plots';
import { flowerGeo, grassGeo, leafyShrubGeo, vineGeo, type FlowerSpecies } from './Flora';
import { PALETTE } from './Palette';
import type { VPrim } from './Shapes';
import { shrubGeo, treeGeo, type Lod, type Species } from './TreeGen';

type V3 = [number, number, number];

export interface PlotHost {
  /** a vertex-coloured primitive into the chunk's ground mesh */
  add(type: VPrim, hex: string, p: V3, s: V3 | number, glow?: number): void;
  /** foliage into the chunk's foliage batch */
  foliage(g: ReturnType<typeof treeGeo>, x: number, y: number, z: number, rotY: number, scale: number): void;
  /** a hand-built model copy (false when it isn't available: draw the fallback) */
  model(name: string, x: number, y: number, z: number, rot: number, s: number): boolean;
  lod: Lod;
}

const C = PALETTE.cozy;
const pick = <T>(list: readonly T[], k: number) => list[((k % list.length) + list.length) % list.length];

/**
 * A plot's look: its option, or the waiting look when `option` is undefined. `y` is the ground's top. `growth` (E27.2,
 * #680) is how grown back a plant plot is since Bloombot last worked it: 0 just picked (or pruned), 1 full again (or,
 * for the ones Bloombot prunes, grown wild).
 */
export function drawPlot(h: PlotHost, p: PlotSpot, option: string | undefined, y: number, far: boolean, growth = 1) {
  const x0 = p.x;
  const z0 = p.z;
  const S = p.size;
  const cx = x0 + S / 2;
  const cz = z0 + S / 2;
  const v = (Math.abs(x0 * 73856093) ^ Math.abs(z0 * 19349663)) & 0xffff; // stable per plot
  if (far) {
    drawFar(h, option, cx, cz, S, y, v);
    return;
  }
  if (!option) {
    waiting(h, x0, z0, S, y);
    return;
  }
  const at = { h, x0, z0, S, cx, cz, y, v, g: Math.max(0, Math.min(1, growth)) };
  (ART[option] ?? garden)(at);
}

interface At {
  h: PlotHost;
  x0: number;
  z0: number;
  S: number;
  cx: number;
  cz: number;
  y: number;
  v: number;
  /** E27.2: grown back, 0 to 1 */
  g: number;
}

/** Far: a pad in the option's main colour and one bump (a tree crown, a roof, a pool). */
function drawFar(h: PlotHost, option: string | undefined, cx: number, cz: number, S: number, y: number, v: number) {
  if (!option) {
    h.add('box', C.kerb, [cx, y + 0.02, cz], [S - 0.2, 0.04, S - 0.2]);
    return;
  }
  const [pad, top]: [string, string] =
    option === 'splash' || option === 'reeds' || option === 'dipping' || option === 'mooring' ? [C.waterShallow, C.deck]
    : option === 'orchard' || option === 'hut' || option === 'meadow' || option === 'picnic' ? [PALETTE.lawn.tones[1], pick(PALETTE.leaf.shrub, v)]
    : option === 'playground' ? [C.sand, pick(C.play, v)]
    : option === 'cafe' || option === 'stalls' || option === 'bandstand' ? [C.kerb, pick(C.canvas, v)]
    : option === 'greenhouse' ? [C.kerb, C.glass]
    : [C.bedSoil, pick(C.veg, v)];
  h.add('box', pad, [cx, y + 0.02, cz], [S - 0.15, 0.05, S - 0.15]);
  h.add('sphere', top, [cx, y + 0.3, cz], [S * 0.5, 0.5, S * 0.5]);
}

/** Waiting: a low stone kerb, four stakes and a string line. Tidy, clearly "something goes here". */
function waiting(h: PlotHost, x0: number, z0: number, S: number, y: number) {
  const e = 0.1;
  const w = 0.07;
  const hy = y + 0.04;
  h.add('box', C.kerb, [x0 + S / 2, hy, z0 + e], [S - 2 * e, 0.08, w]);
  h.add('box', C.kerb, [x0 + S / 2, hy, z0 + S - e], [S - 2 * e, 0.08, w]);
  h.add('box', C.kerb, [x0 + e, hy, z0 + S / 2], [w, 0.08, S - 2 * e]);
  h.add('box', C.kerb, [x0 + S - e, hy, z0 + S / 2], [w, 0.08, S - 2 * e]);
  for (const [sx, sz] of [[e, e], [S - e, e], [e, S - e], [S - e, S - e]]) h.add('box', C.stake, [x0 + sx, y + 0.2, z0 + sz], [0.05, 0.36, 0.05]);
  h.add('box', C.string, [x0 + S / 2, y + 0.34, z0 + e], [S - 2 * e, 0.012, 0.012]);
  h.add('box', C.string, [x0 + S / 2, y + 0.34, z0 + S - e], [S - 2 * e, 0.012, 0.012]);
}

/**
 * E27.2: a raised bed: timber edge, soil, two rows of leafy crops, and a sunflower at each end. Picked, only new
 * leaves show in the soil; the crops fill out again as it grows back, and the flowers come back last.
 */
function bed(a: At, cx: number, cz: number, w: number, d: number, k: number) {
  const { h, y, g } = a;
  h.add('box', C.deck, [cx, y + 0.07, cz], [w, 0.14, d]);
  h.add('box', C.bedSoil, [cx, y + 0.145, cz], [w - 0.1, 0.02, d - 0.1]);
  const n = Math.max(2, Math.round(d / 0.36));
  for (let i = 0; i < n; i++) {
    const pz = cz - d / 2 + (i + 0.5) * (d / n);
    for (const s of [-1, 1]) {
      const px = cx + s * w * 0.22;
      const vv = a.v + i * 3 + (s > 0 ? 1 : 0) + k;
      if (g < 0.2) h.foliage(grassGeo(1, vv, h.lod), px, y + 0.155, pz, vv, 1.1); // picked: new leaves just showing
      else h.foliage(leafyShrubGeo(vv, h.lod, false), px, y + 0.155, pz, vv * 1.3, 0.2 + 0.26 * g);
    }
  }
  if (g >= 0.5) for (const s of [-1, 1]) h.foliage(flowerGeo('sunflower', k, true, a.v + k + s, h.lod), cx, y + 0.155, cz + s * (d / 2 - 0.08), k, 0.7 + 0.3 * g);
}

/** E27.2: a little heap of fresh clippings beside a plant Bloombot has just pruned (gone once it has grown out). */
function clippings(a: At, x: number, z: number) {
  if (a.g >= 0.5) return;
  const k = 1 - a.g * 2;
  for (let i = 0; i < 5; i++) {
    const ang = a.v + i * 1.3;
    a.h.add('box', i % 2 ? PALETTE.flowers.stem : PALETTE.wood.mid, [x + Math.cos(ang) * 0.08, a.y + 0.03 + (i % 3) * 0.02, z + Math.sin(ang) * 0.06], [0.22 * k, 0.025, 0.04]);
  }
  a.h.foliage(leafyShrubGeo(a.v + 2, a.h.lod, false), x, a.y + 0.02, z, a.v, 0.22 * k);
}

/**
 * E27.2: an upright ring (or arc from `from` to `to`, radians from +x) of `n` short pieces centred on (x, y, z), in
 * the x-y plane. A piece is long along the ring and `thick` across it.
 */
function ring(a: At, hex: string, x: number, y: number, z: number, r: number, thick: number, from = 0, to = Math.PI * 2, n = 12) {
  const seg = ((to - from) / n) * r * 1.15;
  for (let i = 0; i < n; i++) {
    const t = from + ((i + 0.5) / n) * (to - from);
    const across = Math.abs(Math.sin(t)); // 1 at the top and bottom (the piece lies along x), 0 at the sides
    a.h.add('box', hex, [x + Math.cos(t) * r, y + Math.sin(t) * r, z], [thick + (seg - thick) * across, thick + (seg - thick) * (1 - across), thick]);
  }
}

function tree(a: At, sp: Species, x: number, z: number, scale: number, stage: 1 | 2 | 3 | 4 = 3) {
  a.h.foliage(treeGeo(sp, stage, (a.v + Math.round(x * 7 + z * 13)) & 7, a.h.lod), x, a.y + 0.08, z, ((a.v + x * 3) % 6) * 1.04, scale);
}

function shrub(a: At, x: number, z: number, scale: number) {
  a.h.foliage(shrubGeo((a.v + Math.round(x * 5 + z * 11)) & 7, a.h.lod), x, a.y + 0.08, z, 0, scale);
}

/** A café table with two stools and a parasol. */
function table(a: At, x: number, z: number, k: number) {
  const { h, y } = a;
  h.add('cylinder', C.metal, [x, y + 0.2, z], [0.05, 0.4, 0.05]);
  h.add('cylinder', C.table, [x, y + 0.41, z], [0.42, 0.03, 0.42]);
  for (const s of [-1, 1]) h.add('cylinder', C.deckDark, [x + s * 0.3, y + 0.12, z], [0.16, 0.24, 0.16]);
  h.add('cylinder', C.metal, [x, y + 0.7, z], [0.03, 0.6, 0.03]);
  h.add('cone', pick(C.canvas, a.v + k), [x, y + 1.02, z], [0.9, 0.22, 0.9]);
}

/** A striped awning stall (when the model isn't there). */
function stall(a: At, x: number, z: number, k: number) {
  const { h, y } = a;
  if (h.model('market-stall', x, y + 0.08, z, 0, 0.5)) return;
  h.add('box', C.deck, [x, y + 0.3, z], [0.75, 0.44, 0.4]);
  for (const s of [-1, 1]) h.add('box', C.deckDark, [x + s * 0.34, y + 0.5, z - 0.16], [0.05, 0.84, 0.05]);
  h.add('box', pick(C.canvas, a.v + k), [x, y + 0.92, z], [0.86, 0.04, 0.55]);
  for (let i = 0; i < 4; i++) h.add('sphere', pick(C.fruit, i + k), [x - 0.24 + i * 0.16, y + 0.56, z + 0.04], 0.12);
}

function water(a: At, x: number, z: number, w: number, d: number) {
  a.h.add('box', C.kerb, [x, a.y + 0.05, z], [w + 0.14, 0.1, d + 0.14]);
  a.h.add('box', C.waterShallow, [x, a.y + 0.09, z], [w, 0.02, d]);
}

/** E27.2: for the plots Bloombot prunes, how wild they've grown (0 just pruned, 1 at `growth` 1). */
const wildOf = (a: At) => Math.max(0, (a.g - 0.35) / 0.65);

const garden = (a: At) => {
  bed(a, a.cx - 0.45, a.cz, 0.7, 1.6, 0);
  bed(a, a.cx + 0.45, a.cz, 0.7, 1.6, 1);
  for (const s of [-1, 1]) a.h.foliage(flowerGeo('wild', 1, true, a.v + s, a.h.lod), a.cx, a.y + 0.02, a.cz + s * 0.62, s, 0.9); // marigolds on the path
};

const ART: Record<string, (a: At) => void> = {
  garden,
  orchard: (a) => {
    // E27.2: pruned, four neat young fruit trees and a heap of clippings; left, each grows a bigger, shaggier crown
    // with suckers bushing up round its foot, until Bloombot prunes it back
    const wild = wildOf(a);
    for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      const x = a.cx + dx;
      const z = a.cz + dz;
      a.h.add('cylinder', C.bedSoil, [x, a.y + 0.01, z], [0.5, 0.02, 0.5]); // a cleared ring round each trunk
      tree(a, 'cherry', x, z, 0.5 + 0.22 * wild, wild > 0.5 ? 3 : 2);
      for (let k = 0; k < Math.round(wild * 3); k++) a.h.foliage(leafyShrubGeo(a.v + k, a.h.lod, false), x + (k - 1) * 0.16, a.y + 0.02, z + 0.14 - k * 0.06, k, 0.3 + 0.12 * wild);
      a.h.add('sphere', pick(C.fruit, a.v), [x + 0.16, a.y + 0.05, z - 0.12], 0.08); // a windfall
    }
    clippings(a, a.cx, a.cz - 0.95);
  },
  cafe: (a) => {
    a.h.add('box', C.kerb, [a.cx, a.y + 0.02, a.cz], [a.S - 0.1, 0.04, a.S - 0.1]);
    table(a, a.cx - 0.45, a.cz - 0.45, 0);
    table(a, a.cx + 0.45, a.cz + 0.45, 1);
    if (!a.h.model('planter-trough', a.cx + 0.5, a.y + 0.08, a.cz - 0.6, 0, 0.45)) {
      a.h.add('box', C.deck, [a.cx + 0.5, a.y + 0.07, a.cz - 0.6], [0.7, 0.14, 0.3]);
      for (const s of [-1, 1]) a.h.foliage(leafyShrubGeo(a.v + s, a.h.lod, false), a.cx + 0.5 + s * 0.18, a.y + 0.15, a.cz - 0.6, s, 0.22);
    }
  },
  playground: (a) => {
    const { h, y, cx, cz } = a;
    h.add('box', C.sand, [cx + 0.45, y + 0.03, cz + 0.45], [0.8, 0.06, 0.8]); // sandpit
    h.add('box', C.deck, [cx + 0.45, y + 0.07, cz + 0.45], [0.86, 0.04, 0.86]);
    // slide: a ladder tower and a ramp
    h.add('box', pick(C.play, a.v), [cx - 0.55, y + 0.4, cz - 0.55], [0.36, 0.8, 0.36]);
    h.add('box', pick(C.play, a.v + 1), [cx - 0.15, y + 0.4, cz - 0.55], [0.8, 0.06, 0.3]);
    // swing frame
    for (const s of [-1, 1]) h.add('box', C.metal, [cx + s * 0.4, y + 0.45, cz - 0.05 + 0.5], [0.05, 0.9, 0.05]);
    h.add('box', C.metal, [cx, y + 0.9, cz + 0.45], [0.86, 0.05, 0.05]);
    h.add('box', pick(C.play, a.v + 2), [cx, y + 0.32, cz + 0.45], [0.28, 0.04, 0.16]);
  },
  arbour: (a) => {
    const { h, y, cx, cz } = a;
    // E27.2: an arch of white timber over a bench, with climbing roses up both sides and over the top. Pruned, the
    // roses sit close to the frame beside a heap of clippings; left, they bush out, flower thickly and trail canes.
    const wild = wildOf(a);
    const H = 0.9;
    const W = 0.55;
    for (const s of [-1, 1]) {
      for (const dz of [-0.22, 0.22]) {
        h.add('box', C.kerb, [cx + s * W, y + 0.04, cz + dz], [0.14, 0.08, 0.14]);
        h.add('box', C.frame, [cx + s * W, y + H / 2, cz + dz], [0.07, H, 0.07]);
      }
      for (let k = 0; k < 4; k++) h.add('box', C.frame, [cx + s * W, y + 0.2 + k * 0.2, cz], [0.03, 0.03, 0.44]); // trellis rungs
      // pruned, short green stems; left, big flowering bushes
      for (let k = 0; k < 3; k++) h.foliage(leafyShrubGeo(a.v + k + (s > 0 ? 3 : 0), h.lod, wild > 0.3), cx + s * (W + 0.04 + 0.08 * wild), y + 0.04 + k * 0.3, cz + (k % 2 ? 0.1 : -0.1), k * 1.7, 0.2 + 0.36 * wild);
    }
    for (const dz of [-0.22, 0.22]) ring(a, C.frame, cx, y + H, cz + dz, W, 0.06, 0, Math.PI, 16);
    for (let k = 0; k < 5; k++) {
      const t = ((k + 0.5) / 5) * Math.PI;
      h.add('box', C.frame, [cx + Math.cos(t) * W, y + H + Math.sin(t) * W, cz], [0.04, 0.04, 0.5]); // slats over the top
    }
    // roses over the top: a few close to the frame when pruned, a thick flowering crown left wild
    const top = 3 + Math.round(wild * 5);
    for (let k = 0; k < top; k++) {
      const t = ((k + 0.5) / top) * Math.PI;
      h.foliage(leafyShrubGeo(a.v + k, h.lod, wild > 0.3 || k % 2 === 0), cx + Math.cos(t) * W, y + H + Math.sin(t) * W - 0.06, cz + ((k % 2) - 0.5) * 0.18, k * 2.3, 0.2 + 0.34 * wild);
    }
    // left wild, canes trail down off the top of the arch, front and back (a vine runs along its local +x from where
    // it starts, so the back one, turned round, starts at the other end)
    if (wild > 0.3) {
      const len = 0.5 + 0.4 * wild;
      for (const s of [-1, 1]) h.foliage(vineGeo(3, 0.15 + 0.4 * wild, a.v + s, h.lod), cx - (s * len) / 2, y + H + W * 0.85, cz + s * 0.27, s > 0 ? 0 : Math.PI, len);
    }
    // the roses' flowers: a few buds once pruned, then pink clusters all over the arch as it grows wild
    const blooms = Math.round(2 + wild * 6);
    for (let k = 0; k < blooms; k++) {
      const t = ((k + 0.5) / blooms) * Math.PI;
      h.foliage(flowerGeo('cosmos', k, wild > 0.2, a.v + k, h.lod), cx + Math.cos(t) * (W + 0.03), y + H + Math.sin(t) * (W + 0.03), cz + (k % 2 ? 0.2 : -0.2), k, 0.6 + 0.9 * wild);
    }
    for (const s of [-1, 1]) for (let k = 0; k < Math.round(wild * 3); k++) h.foliage(flowerGeo('cosmos', k + 2, true, a.v + k + s, h.lod), cx + s * (W + 0.1), y + 0.2 + k * 0.28, cz + (k % 2 ? -0.18 : 0.18), k, 0.9 + 0.5 * wild);
    if (!h.model('bench', cx, y + 0.08, cz, 0, 0.5)) h.add('box', PALETTE.props.benchWood, [cx, y + 0.24, cz], [0.7, 0.06, 0.24]);
    clippings(a, cx + 0.72, cz - 0.72);
  },
  meadow: (a) => {
    // E27.2: long grass and wildflowers from the park's own grass and flower clumps. Cut, short stubble with bundles
    // of cut grass; the long grass comes back, then the poppies, daisies and cosmos.
    const kinds: FlowerSpecies[] = ['wild', 'daisy', 'cosmos'];
    for (let i = 0; i < 16; i++) {
      const x = a.x0 + 0.22 + (i % 4) * 0.52 + ((a.v + i * 7) % 5) * 0.03;
      const z = a.z0 + 0.22 + Math.floor(i / 4) * 0.52 + ((a.v + i * 3) % 5) * 0.03;
      a.h.foliage(grassGeo(a.g < 0.25 ? 1 : 3, a.v + i, a.h.lod), x, a.y + 0.01, z, i * 1.1, 1.2 + 2.2 * a.g);
      if (a.g > 0.5 && i % 2 === 0) a.h.foliage(flowerGeo(kinds[(i / 2) % 3], i, true, a.v + i, a.h.lod), x + 0.12, a.y + 0.01, z - 0.1, i, 0.7 + 1.2 * (a.g - 0.5));
    }
    if (a.g < 0.5) for (const [dx, dz] of [[-0.5, -0.3], [0.45, 0.4]]) a.h.add('cylinder', PALETTE.lawn.tuft[2], [a.cx + dx, a.y + 0.07, a.cz + dz], [0.22, 0.14, 0.22]); // bundles of cut grass
  },
  parklet: (a) => {
    const { h, y, cx, cz } = a;
    h.add('box', C.deck, [cx, y + 0.05, cz], [a.S - 0.2, 0.1, a.S - 0.2]);
    // E27.2: a flowering shrub in each pot. Pruned, neat rounds with clippings on the deck; left, they bush out over
    // the rims in long sprays.
    const wild = wildOf(a);
    const pots: [number, number][] = [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]];
    pots.forEach(([dx, dz], i) => {
      let top = y + 0.36;
      if (!h.model('planter-pot', cx + dx, y + 0.1, cz + dz, 0, 0.42)) {
        h.add('cylinder', C.kerb, [cx + dx, y + 0.24, cz + dz], [0.36, 0.3, 0.36]);
        top = y + 0.38;
      }
      h.foliage(leafyShrubGeo(a.v + i, h.lod, wild > 0.3), cx + dx, top, cz + dz, i, 0.26 + 0.36 * wild);
      for (let k = 0; k < Math.round(wild * 3); k++) h.foliage(leafyShrubGeo(a.v + i + k + 2, h.lod, true), cx + dx + (k - 1) * 0.16, top + 0.08, cz + dz + (k % 2 ? 0.16 : -0.12), k, 0.24 + 0.16 * wild);
    });
    if (!h.model('bench', cx, y + 0.1, cz, 0, 0.5)) h.add('box', PALETTE.props.benchWood, [cx, y + 0.28, cz], [0.8, 0.06, 0.28]);
    clippings(a, cx, cz - 0.55);
  },
  bikes: (a) => {
    const { h, y, cx, cz } = a;
    // E27.2 (#680): the hoops and wheels are rings now (they drew as solid slabs: the chunk mesh has no torus)
    h.add('box', C.kerb, [cx, y + 0.02, cz - 0.3], [1.7, 0.04, 0.3]);
    for (let i = 0; i < 4; i++) ring(a, C.metal, cx - 0.6 + i * 0.4, y + 0.04, cz - 0.3, 0.17, 0.035, 0, Math.PI, 7);
    for (let i = 0; i < 2; i++) {
      const bx = cx - 0.4 + i * 0.8;
      const col = pick(C.play, a.v + i);
      for (const s of [-1, 1]) ring(a, PALETTE.pure.black, bx + s * 0.22, y + 0.2, cz + 0.3, 0.16, 0.03, 0, Math.PI * 2, 10);
      h.add('box', col, [bx, y + 0.32, cz + 0.3], [0.46, 0.04, 0.04]);
      h.add('box', col, [bx - 0.1, y + 0.27, cz + 0.3], [0.04, 0.16, 0.04]);
      h.add('box', col, [bx + 0.16, y + 0.42, cz + 0.3], [0.04, 0.22, 0.04]);
      h.add('box', PALETTE.pure.black, [bx + 0.16, y + 0.53, cz + 0.3], [0.04, 0.03, 0.24]); // handlebars
      h.add('box', PALETTE.pure.black, [bx - 0.12, y + 0.37, cz + 0.3], [0.12, 0.03, 0.07]); // saddle
    }
  },
  splash: (a) => {
    const { h, y, cx, cz } = a;
    // E27.2 (#680): the water sits inside a low stone rim (it was level with the stone before, so the pool looked dry)
    h.add('cylinder', C.kerb, [cx, y + 0.02, cz], [1.8, 0.04, 1.8]);
    for (let k = 0; k < 16; k++) {
      const t = (k / 16) * Math.PI * 2;
      h.add('box', C.kerb, [cx + Math.cos(t) * 0.86, y + 0.09, cz + Math.sin(t) * 0.86], [0.36, 0.14, 0.36]);
    }
    h.add('cylinder', C.waterShallow, [cx, y + 0.12, cz], [1.56, 0.02, 1.56]);
    h.add('cylinder', C.kerb, [cx, y + 0.22, cz], [0.18, 0.24, 0.18]);
    h.add('sphere', PALETTE.aqua.mist, [cx, y + 0.42, cz], [0.26, 0.2, 0.26], 0.2);
  },
  bandstand: (a) => {
    const { h, y, cx, cz } = a;
    h.add('cylinder', C.deck, [cx, y + 0.1, cz], [1.7, 0.2, 1.7]);
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2;
      h.add('box', C.frame, [cx + Math.cos(ang) * 0.75, y + 0.6, cz + Math.sin(ang) * 0.75], [0.05, 0.8, 0.05]);
    }
    h.add('cone', pick(C.canvas, a.v), [cx, y + 1.15, cz], [1.8, 0.4, 1.8]);
    for (let k = 0; k < 8; k++) h.add('cone', pick(C.canvas, k), [cx - 0.7 + k * 0.2, y + 0.92, cz + 0.8], [0.1, 0.12, 0.04]); // bunting
  },
  mooring: (a) => {
    const { h, y, cx, cz } = a;
    h.add('box', C.deck, [cx, y + 0.1, cz], [a.S - 0.1, 0.06, 1.1]);
    for (let i = 0; i < 6; i++) h.add('box', C.deckDark, [a.x0 + 0.2 + i * 0.32, y + 0.135, cz], [0.02, 0.01, 1.1]);
    for (const s of [-1, 1]) if (!h.model('mooring-post', cx + s * 0.8, y + 0.08, cz + 0.6, 0, 0.5)) h.add('cylinder', C.deckDark, [cx + s * 0.8, y + 0.3, cz + 0.6], [0.12, 0.5, 0.12]);
    // a little boat pulled up beside the deck
    h.add('sphere', pick(C.boat, a.v), [cx, y + 0.16, cz - 0.7], [1.3, 0.24, 0.38]); // a hull lying along the deck
    h.add('box', C.canvasWhite, [cx, y + 0.25, cz - 0.7], [0.5, 0.03, 0.2]);
  },
  stalls: (a) => {
    stall(a, a.cx - 0.45, a.cz - 0.4, 0);
    stall(a, a.cx + 0.45, a.cz + 0.4, 1);
    if (!a.h.model('crate', a.cx + 0.55, a.y + 0.08, a.cz - 0.6, 0.3, 0.35)) a.h.add('box', PALETTE.wood.crate, [a.cx + 0.55, a.y + 0.2, a.cz - 0.6], 0.3);
  },
  crates: (a) => {
    // E27.2: herbs and lavender in old crates. Picked, cut down to the rim; they grow back up and flower again.
    const herbs: FlowerSpecies[] = ['lavender', 'daisy', 'lavender', 'wild'];
    for (let i = 0; i < 4; i++) {
      const x = a.cx + (i % 2 ? 0.45 : -0.45);
      const z = a.cz + (i < 2 ? -0.45 : 0.45);
      let top = a.y + 0.42;
      if (!a.h.model('crate', x, a.y + 0.08, z, (i * Math.PI) / 7, 0.48)) {
        a.h.add('box', PALETTE.wood.crate, [x, a.y + 0.28, z], [0.62, 0.4, 0.62]);
        top = a.y + 0.48;
      }
      a.h.foliage(leafyShrubGeo(a.v + i, a.h.lod, false), x, top - 0.06, z, i, 0.16 + 0.22 * a.g);
      if (a.g > 0.5) a.h.foliage(flowerGeo(herbs[i], i, true, a.v + i, a.h.lod), x + 0.08, top, z - 0.04, i, 0.8 + (a.g - 0.5));
    }
  },
  reeds: (a) => {
    water(a, a.cx, a.cz, a.S - 0.3, a.S - 0.3);
    for (let i = 0; i < 14; i++) {
      const x = a.x0 + 0.3 + ((i * 37) % 13) / 9.5;
      const z = a.z0 + 0.3 + ((i * 53) % 11) / 7.5;
      const tall = 0.18 + 0.44 * a.g; // E27.2: cut down near the water, growing back up
      a.h.add('cone', C.reed, [x, a.y + 0.05 + tall / 2, z], [0.08, tall, 0.08]);
      if (a.g > 0.5) a.h.add('capsule', i % 3 ? C.reedHead : C.iris, [x, a.y + 0.05 + tall, z], [0.06, 0.16, 0.06]);
    }
  },
  dipping: (a) => {
    a.h.add('cylinder', PALETTE.lawn.edge, [a.cx, a.y + 0.04, a.cz], [1.9, 0.08, 1.9]);
    a.h.add('cylinder', C.waterShallow, [a.cx, a.y + 0.08, a.cz], [1.5, 0.03, 1.5]);
    a.h.add('box', C.deck, [a.cx + 0.55, a.y + 0.14, a.cz], [0.9, 0.05, 0.36]);
    for (const [dx, dz] of [[-0.35, 0.3], [0.1, -0.4]]) a.h.add('cylinder', PALETTE.lawn.tones[0], [a.cx + dx, a.y + 0.11, a.cz + dz], [0.3, 0.02, 0.3]); // lily pads
  },
  picnic: (a) => {
    const { h, y, cx, cz } = a;
    h.add('box', C.blanket[0], [cx, y + 0.1, cz], [1.0, 0.02, 0.8]);
    for (let i = 0; i < 4; i++) h.add('box', C.blanket[1], [cx - 0.375 + i * 0.25, y + 0.112, cz], [0.06, 0.005, 0.8]);
    h.add('box', C.basket, [cx + 0.2, y + 0.2, cz + 0.1], [0.28, 0.18, 0.2]);
    for (const s of [-1, 1]) h.add('cylinder', PALETTE.wood.mid, [cx, y + 0.17, cz + s * 0.7], [1.0, 0.18, 0.2]); // log seats
    tree(a, 'oak', a.x0 + 0.3, a.z0 + 0.3, 0.45, 2);
  },
  hut: (a) => {
    const { h, y, cx, cz } = a;
    h.add('cone', C.thatch, [cx, y + 0.55, cz], [1.3, 1.1, 1.3]);
    h.add('cone', C.moss, [cx, y + 0.95, cz], [0.6, 0.35, 0.6]);
    h.add('box', C.bedSoil, [cx, y + 0.25, cz + 0.55], [0.32, 0.46, 0.1]);
    shrub(a, cx + 0.7, cz - 0.6, 0.5);
  },
  greenhouse: (a) => {
    const { h, y, cx, cz } = a;
    // E27.2 (#680): a white-framed glasshouse on a low sill, its sides open between the frames and pale glass only in
    // the roof, so the benches of seedlings inside show from any side (the old shut glass box drew as a dark block).
    // Picked, the trays hold tiny shoots that grow back.
    h.add('box', C.kerb, [cx, y + 0.04, cz], [1.6, 0.08, 1.2]);
    const H = 0.8;
    for (const sz of [-0.58, 0.58]) h.add('box', C.frame, [cx, y + 0.14, cz + sz], [1.6, 0.2, 0.05]); // the sill
    for (const s of [-1, 1]) h.add('box', C.frame, [cx + s * 0.78, y + 0.14, cz], [0.05, 0.2, 1.16]);
    for (const sx of [-0.78, -0.26, 0.26, 0.78]) for (const sz of [-0.58, 0.58]) h.add('box', C.frame, [cx + sx, y + H / 2, cz + sz], [0.05, H, 0.05]);
    for (const sz of [-0.58, 0.58]) h.add('box', C.frame, [cx, y + H, cz + sz], [1.62, 0.05, 0.05]);
    for (const s of [-1, 1]) h.add('box', C.frame, [cx + s * 0.78, y + H, cz], [0.05, 0.05, 1.16]);
    // a pitched roof of pale glass in steps (the chunk mesh has no rotation), with white glazing bars
    for (let k = 0; k < 4; k++) {
      for (const s of [-1, 1]) h.add('box', C.glass, [cx, y + H + 0.03 + k * 0.07, cz + s * (0.58 - (k + 0.5) * 0.145)], [1.56, 0.02, 0.15], 0.3);
    }
    for (const sx of [-0.52, 0, 0.52]) for (const s of [-1, 1]) h.add('box', C.frame, [cx + sx, y + H + 0.15, cz + s * 0.29], [0.03, 0.03, 0.6]);
    h.add('box', C.frame, [cx, y + H + 0.3, cz], [1.62, 0.05, 0.05]); // the ridge
    // two benches of seedling trays
    for (const bz of [-0.2, 0.26]) {
      h.add('box', PALETTE.wood.mid, [cx, y + 0.3, cz + bz], [1.4, 0.05, 0.32]);
      for (const lx of [-0.6, 0.6]) h.add('box', PALETTE.wood.mid, [cx + lx, y + 0.15, cz + bz], [0.04, 0.3, 0.28]);
      for (let i = 0; i < 4; i++) {
        const tx = cx - 0.5 + i * 0.33;
        h.add('box', C.bedSoil, [tx, y + 0.35, cz + bz], [0.28, 0.05, 0.26]);
        if (a.g < 0.2) h.foliage(grassGeo(1, a.v + i, h.lod), tx, y + 0.375, cz + bz, i, 0.9);
        else h.foliage(leafyShrubGeo(a.v + i + (bz > 0 ? 3 : 0), h.lod, a.g > 0.75 && i % 2 === 0), tx, y + 0.375, cz + bz, i, 0.1 + 0.22 * a.g);
      }
    }
  },
};

/** For tests and review shots: every option id that has its own art. */
export const PLOT_ART = Object.keys(ART);
