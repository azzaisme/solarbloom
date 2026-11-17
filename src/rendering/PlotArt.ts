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
 */
import type { PlotSpot } from '../core/Plots';
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

/** A plot's look: its option, or the waiting look when `option` is undefined. `y` is the ground's top. */
export function drawPlot(h: PlotHost, p: PlotSpot, option: string | undefined, y: number, far: boolean) {
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
  const at = { h, x0, z0, S, cx, cz, y, v };
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

/** A raised bed: timber edge, soil, rows of crops. */
function bed(h: PlotHost, cx: number, cz: number, w: number, d: number, y: number, crop: string, v: number) {
  h.add('box', C.deck, [cx, y + 0.07, cz], [w, 0.14, d]);
  h.add('box', C.bedSoil, [cx, y + 0.145, cz], [w - 0.1, 0.02, d - 0.1]);
  const n = Math.max(2, Math.round(w / 0.2));
  for (let i = 0; i < n; i++) {
    const px = cx - w / 2 + (i + 0.5) * (w / n);
    h.add('sphere', i % 2 ? PALETTE.flowers.stem : crop, [px, y + 0.19, cz - d * 0.2], 0.11);
    h.add('sphere', (i + v) % 3 ? PALETTE.flowers.stemSoft : crop, [px, y + 0.19, cz + d * 0.2], 0.1);
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

const garden = (a: At) => {
  bed(a.h, a.cx - 0.45, a.cz, 0.7, 1.6, a.y, pick(C.veg, a.v), a.v);
  bed(a.h, a.cx + 0.45, a.cz, 0.7, 1.6, a.y, pick(C.veg, a.v + 1), a.v + 1);
  for (const s of [-1, 1]) a.h.add('sphere', PALETTE.flowers.orange, [a.cx, a.y + 0.14, a.cz + s * 0.6], 0.16); // marigolds on the path
};

const ART: Record<string, (a: At) => void> = {
  garden,
  orchard: (a) => {
    for (const [dx, dz] of [[-0.48, -0.48], [0.48, -0.48], [-0.48, 0.48], [0.48, 0.48]]) {
      tree(a, 'cherry', a.cx + dx, a.cz + dz, 0.5, 2); // young trees: a quarter of a grown tree's triangles
      a.h.add('sphere', pick(C.fruit, a.v), [a.cx + dx + 0.12, a.y + 0.11, a.cz + dz - 0.1], 0.08); // a windfall
    }
  },
  cafe: (a) => {
    a.h.add('box', C.kerb, [a.cx, a.y + 0.02, a.cz], [a.S - 0.1, 0.04, a.S - 0.1]);
    table(a, a.cx - 0.45, a.cz - 0.45, 0);
    table(a, a.cx + 0.45, a.cz + 0.45, 1);
    if (!a.h.model('planter-trough', a.cx + 0.5, a.y + 0.08, a.cz - 0.6, 0, 0.45)) bed(a.h, a.cx + 0.5, a.cz - 0.6, 0.7, 0.3, a.y, PALETTE.flowers.stem, a.v);
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
    for (const s of [-1, 1]) {
      h.add('box', C.frame, [cx + s * 0.55, y + 0.55, cz], [0.07, 1.1, 0.07]);
      for (let k = 0; k < 4; k++) h.add('sphere', pick(C.rose, k + (s > 0 ? 1 : 0)), [cx + s * 0.55, y + 0.3 + k * 0.24, cz + ((k % 2) - 0.5) * 0.14], 0.16);
    }
    h.add('torus', C.frame, [cx, y + 1.1, cz], [1.1, 0.5, 0.2]);
    for (let k = 0; k < 6; k++) h.add('sphere', pick(C.rose, k), [cx - 0.5 + k * 0.2, y + 1.18 + Math.sin(k) * 0.05, cz], 0.18);
    if (!h.model('bench', cx, y + 0.08, cz - 0.55, 0, 0.5)) h.add('box', PALETTE.props.benchWood, [cx, y + 0.24, cz - 0.55], [0.7, 0.06, 0.24]);
  },
  meadow: (a) => {
    for (let i = 0; i < 9; i++) {
      const x = a.x0 + 0.3 + (i % 3) * 0.7;
      const z = a.z0 + 0.3 + Math.floor(i / 3) * 0.7;
      a.h.add('cone', PALETTE.lawn.tuft[i % 3], [x, a.y + 0.2, z], [0.32, 0.4, 0.32]);
      a.h.add('sphere', i % 3 ? PALETTE.flowers.red : PALETTE.flowers.yellow, [x + 0.1, a.y + 0.36, z - 0.06], 0.1);
    }
  },
  parklet: (a) => {
    const { h, y, cx, cz } = a;
    h.add('box', C.deck, [cx, y + 0.05, cz], [a.S - 0.2, 0.1, a.S - 0.2]);
    for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
      if (!h.model('planter-pot', cx + dx, y + 0.1, cz + dz, 0, 0.42)) h.add('cylinder', C.kerb, [cx + dx, y + 0.24, cz + dz], [0.36, 0.3, 0.36]);
      shrub(a, cx + dx, cz + dz, 0.45);
    }
    if (!h.model('bench', cx, y + 0.1, cz, 0, 0.5)) h.add('box', PALETTE.props.benchWood, [cx, y + 0.28, cz], [0.8, 0.06, 0.28]);
  },
  bikes: (a) => {
    const { h, y, cx, cz } = a;
    for (let i = 0; i < 4; i++) h.add('torus', C.metal, [cx - 0.6 + i * 0.4, y + 0.3, cz - 0.3], [0.4, 0.4, 0.06]);
    for (let i = 0; i < 2; i++) {
      const bx = cx - 0.4 + i * 0.8;
      const col = pick(C.play, a.v + i);
      for (const s of [-1, 1]) h.add('torus', PALETTE.pure.black, [bx + s * 0.22, y + 0.2, cz + 0.3], [0.36, 0.36, 0.05]);
      h.add('box', col, [bx, y + 0.32, cz + 0.3], [0.46, 0.05, 0.04]);
      h.add('box', col, [bx + 0.16, y + 0.42, cz + 0.3], [0.04, 0.22, 0.04]);
    }
  },
  splash: (a) => {
    const { h, y, cx, cz } = a;
    h.add('cylinder', C.kerb, [cx, y + 0.06, cz], [1.8, 0.12, 1.8]);
    h.add('cylinder', C.waterShallow, [cx, y + 0.1, cz], [1.6, 0.04, 1.6]);
    h.add('cylinder', C.kerb, [cx, y + 0.22, cz], [0.18, 0.3, 0.18]);
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
  boathouse: (a) => {
    const { h, y, cx, cz } = a;
    for (const s of [-1, 1]) for (const t of [-1, 1]) h.add('box', C.deckDark, [cx + s * 0.7, y + 0.45, cz + t * 0.4], [0.06, 0.9, 0.06]);
    for (let k = 0; k < 3; k++) {
      h.add('box', C.deckDark, [cx, y + 0.25 + k * 0.28, cz], [1.5, 0.04, 0.9]);
      h.add('sphere', pick(C.boat, a.v + k), [cx, y + 0.33 + k * 0.28, cz], [1.4, 0.16, 0.26]);
    }
  },
  stalls: (a) => {
    stall(a, a.cx - 0.45, a.cz - 0.4, 0);
    stall(a, a.cx + 0.45, a.cz + 0.4, 1);
    if (!a.h.model('crate', a.cx + 0.55, a.y + 0.08, a.cz - 0.6, 0.3, 0.35)) a.h.add('box', PALETTE.wood.crate, [a.cx + 0.55, a.y + 0.2, a.cz - 0.6], 0.3);
  },
  crates: (a) => {
    for (let i = 0; i < 4; i++) {
      const x = a.cx + (i % 2 ? 0.45 : -0.45);
      const z = a.cz + (i < 2 ? -0.45 : 0.45);
      if (!a.h.model('crate', x, a.y + 0.08, z, (i * Math.PI) / 7, 0.48)) a.h.add('box', PALETTE.wood.crate, [x, a.y + 0.28, z], [0.62, 0.4, 0.62]);
      shrub(a, x, z + 0.02, 0.4);
      a.h.add('sphere', pick(PALETTE.flowers.mix, i + a.v), [x + 0.15, a.y + 0.62, z], 0.14);
    }
  },
  reeds: (a) => {
    water(a, a.cx, a.cz, a.S - 0.3, a.S - 0.3);
    for (let i = 0; i < 14; i++) {
      const x = a.x0 + 0.3 + ((i * 37) % 13) / 9.5;
      const z = a.z0 + 0.3 + ((i * 53) % 11) / 7.5;
      a.h.add('cone', C.reed, [x, a.y + 0.36, z], [0.08, 0.62, 0.08]);
      a.h.add('capsule', i % 3 ? C.reedHead : C.iris, [x, a.y + 0.62, z], [0.06, 0.16, 0.06]);
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
    h.add('box', C.kerb, [cx, y + 0.08, cz], [1.6, 0.16, 1.2]);
    h.add('box', C.glass, [cx, y + 0.5, cz], [1.5, 0.7, 1.1], 0.05);
    h.add('box', C.glass, [cx, y + 0.95, cz], [1.2, 0.2, 0.8], 0.05);
    for (const s of [-1, 0, 1]) h.add('box', C.frame, [cx + s * 0.74, y + 0.55, cz], [0.04, 0.8, 1.14]);
    for (let i = 0; i < 5; i++) h.add('sphere', PALETTE.flowers.stem, [cx - 0.5 + i * 0.25, y + 0.34, cz], 0.14);
  },
};

/** For tests and review shots: every option id that has its own art. */
export const PLOT_ART = Object.keys(ART);
