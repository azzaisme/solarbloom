/**
 * E19.2.2 (#254): how each decoration looks on its tile. Like plots (PlotArt), everything goes into the chunk's
 * own merged meshes or its model batch, so decorations cost no extra draw calls (#255). Existing hand-built prop
 * models are used where one fits (bench, lantern, planter pot and trough, lamp post, banner pole, crate, barrel,
 * Lucky Cat); without them (models off or still loading) the same decoration falls back to primitives.
 *
 * A decoration turns in quarter turns (`rot`, clockwise seen from above): every offset and footprint below is
 * laid out facing +z and turned here. The far level of detail is the model's own far version, or one or two
 * primitives in the decoration's main colour.
 */
import type { PlotHost } from './PlotArt';
import { PALETTE } from './Palette';
import type { VPrim } from './Shapes';
import { shrubGeo } from './TreeGen';

type V3 = [number, number, number];
const C = PALETTE.cozy;
const P = PALETTE;

interface At {
  h: PlotHost;
  /** tile centre and ground top */
  x: number;
  y: number;
  z: number;
  rot: number;
  far: boolean;
}

/** Turns a local offset (facing +z) by the decoration's quarter turns. */
function turn(rot: number, dx: number, dz: number): [number, number] {
  switch (rot & 3) {
    case 1:
      return [dz, -dx];
    case 2:
      return [-dx, -dz];
    case 3:
      return [-dz, dx];
    default:
      return [dx, dz];
  }
}

/** A primitive at a local offset: (dx, dz) turned, its x/z size swapped on odd turns. */
function put(a: At, type: VPrim, hex: string, dx: number, dy: number, dz: number, s: V3 | number, glow?: number) {
  const [ox, oz] = turn(a.rot, dx, dz);
  const sc: V3 | number = typeof s === 'number' ? s : a.rot & 1 ? [s[2], s[1], s[0]] : s;
  a.h.add(type, hex, [a.x + ox, a.y + dy, a.z + oz], sc, glow);
}

/** A model copy at a local offset, turned with the decoration. False when the model isn't there. */
function model(a: At, name: string, dx: number, dz: number, scale: number, extraRot = 0): boolean {
  const [ox, oz] = turn(a.rot, dx, dz);
  return a.h.model(name, a.x + ox, a.y, a.z + oz, -a.rot * (Math.PI / 2) + extraRot, scale);
}

function flowersRing(a: At, r: number, n: number, dy = 0.12, size = 0.12) {
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    put(a, 'sphere', P.flowers.mix[i % P.flowers.mix.length], Math.cos(ang) * r, dy, Math.sin(ang) * r, size);
  }
}

const ART: Record<string, (a: At) => void> = {
  bench: (a) => {
    if (model(a, 'bench', 0, 0, 0.55)) return;
    put(a, 'box', P.props.benchWood, 0, 0.26, 0, [0.78, 0.06, 0.28]);
    put(a, 'box', P.props.benchWood, 0, 0.46, -0.12, [0.78, 0.2, 0.05]);
    if (!a.far) for (const s of [-1, 1]) put(a, 'box', P.props.benchFrame, s * 0.32, 0.13, 0, [0.06, 0.26, 0.26]);
  },
  lantern: (a) => {
    if (model(a, 'lantern', 0, 0, 0.5)) return;
    put(a, 'box', P.metal.dark, 0, 0.04, 0, [0.22, 0.08, 0.22]);
    put(a, 'box', P.glow.lamp, 0, 0.2, 0, [0.16, 0.22, 0.16], 1);
    put(a, 'cone', P.metal.dark, 0, 0.36, 0, [0.24, 0.1, 0.24]);
  },
  pot: (a) => {
    if (!model(a, 'planter-pot', 0, 0, 0.5)) put(a, 'cylinder', C.kerb, 0, 0.16, 0, [0.4, 0.32, 0.4]);
    if (a.far) return put(a, 'sphere', P.flowers.pink, 0, 0.4, 0, 0.3);
    put(a, 'sphere', P.flowers.stem, 0, 0.38, 0, 0.3);
    flowersRing(a, 0.09, 5, 0.46, 0.1);
  },
  flowerbed: (a) => {
    put(a, 'cylinder', C.bedSoil, 0, 0.02, 0, [0.82, 0.04, 0.82]);
    if (a.far) return put(a, 'cylinder', P.flowers.pink, 0, 0.06, 0, [0.7, 0.06, 0.7]);
    flowersRing(a, 0.3, 8, 0.1, 0.13);
    flowersRing(a, 0.12, 4, 0.12, 0.12);
  },
  stones: (a) => {
    const n = a.far ? 1 : 3;
    for (let i = 0; i < n; i++) put(a, 'cylinder', P.stone.light, (i - 1) * 0.08, 0.02, (i - 1) * 0.3, [0.3, 0.04, 0.26]);
  },
  trough: (a) => {
    if (!model(a, 'planter-trough', 0, 0, 0.5)) put(a, 'box', P.stone.light, 0, 0.14, 0, [0.8, 0.28, 0.32]);
    if (a.far) return put(a, 'box', P.leaf.mid, 0, 0.32, 0, [0.66, 0.12, 0.22]);
    for (let i = 0; i < 4; i++) put(a, 'sphere', i % 2 ? P.leaf.mid : P.flowers.lavender, -0.27 + i * 0.18, 0.32, 0, 0.16);
  },
  birdbath: (a) => {
    put(a, 'cylinder', P.stone.light, 0, 0.03, 0, [0.36, 0.06, 0.36]);
    put(a, 'cylinder', P.stone.light, 0, 0.25, 0, [0.12, 0.4, 0.12]);
    put(a, 'cylinder', P.stone.light, 0, 0.48, 0, [0.56, 0.08, 0.56]);
    put(a, 'cylinder', C.waterShallow, 0, 0.525, 0, [0.46, 0.02, 0.46]);
    if (!a.far) put(a, 'sphere', P.fauna.birds[0], 0.18, 0.6, 0.05, [0.1, 0.08, 0.14]);
  },
  lamppost: (a) => {
    if (model(a, 'lamp-post', 0, 0, 0.48)) return;
    put(a, 'cylinder', P.metal.dark, 0, 0.7, 0, [0.07, 1.4, 0.07]);
    put(a, 'sphere', P.glow.lamp, 0, 1.45, 0, 0.2, 1);
  },
  bunting: (a) => {
    if (model(a, 'banner-pole', 0, 0, 0.5)) return;
    put(a, 'cylinder', P.wood.post, 0, 0.7, 0, [0.06, 1.4, 0.06]);
    put(a, 'box', P.props.bunting[0], 0.18, 1.15, 0, [0.32, 0.36, 0.02]);
  },
  cratestack: (a) => {
    if (!model(a, 'crate', -0.05, 0.02, 0.48)) put(a, 'box', P.wood.crate, -0.05, 0.2, 0.02, 0.4);
    if (a.far) return;
    if (!model(a, 'crate', 0.04, -0.03, 0.36, 0.4)) put(a, 'box', P.wood.crate, 0.04, 0.55, -0.03, 0.3);
  },
  barrel: (a) => {
    if (!model(a, 'barrel', 0, 0, 0.55)) put(a, 'cylinder', P.wood.mid, 0, 0.2, 0, [0.42, 0.4, 0.42]);
    if (a.far) return put(a, 'sphere', P.flowers.yellow, 0, 0.45, 0, 0.3);
    put(a, 'sphere', P.flowers.stem, 0, 0.44, 0, 0.32);
    flowersRing(a, 0.1, 5, 0.52, 0.1);
  },
  rug: (a) => {
    put(a, 'box', C.blanket[0], 0, 0.015, 0, [0.84, 0.02, 0.7]);
    if (a.far) return;
    for (let i = 0; i < 4; i++) put(a, 'box', C.blanket[1], -0.31 + i * 0.21, 0.03, 0, [0.08, 0.012, 0.7]);
    put(a, 'box', C.basket, 0.18, 0.1, 0.12, [0.26, 0.16, 0.18]);
    put(a, 'box', C.basket, 0.18, 0.22, 0.12, [0.03, 0.12, 0.18]);
  },
  topiary: (a) => {
    put(a, 'box', P.wood.mid, 0, 0.13, 0, [0.42, 0.26, 0.42]);
    if (a.far) return put(a, 'sphere', P.leaf.shrub[0], 0, 0.55, 0, 0.5);
    a.h.foliage(shrubGeo(3, a.h.lod), a.x, a.y + 0.26, a.z, a.rot, 0.9);
  },
  catstatue: (a) => {
    put(a, 'box', P.stone.light, 0, 0.08, 0, [0.42, 0.16, 0.42]);
    if (model(a, 'lucky-cat', 0, 0, 0.5, 0)) return;
    put(a, 'sphere', P.glow.gold, 0, 0.36, 0, [0.3, 0.38, 0.26]);
    put(a, 'sphere', P.glow.gold, 0, 0.6, 0.02, 0.22);
  },
};

/** Ids with art (tests check every decoration has some). */
export const DECOR_ART = Object.keys(ART);

/**
 * Draws a decoration on the tile centred at (`x`, `z`), its ground top at `y`. `rot` in quarter turns; `far` the
 * far level of detail.
 */
export function drawDecor(h: PlotHost, kind: string, x: number, y: number, z: number, rot: number, far: boolean) {
  (ART[kind] ?? ART.pot)({ h, x, y, z, rot: rot & 3, far });
}
