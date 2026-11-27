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
import { houseplantGeo } from './TreeGen';

type V3 = [number, number, number];
const C = PALETTE.cozy;
const P = PALETTE;
const L = PALETTE.light;
const H = PALETTE.house;
const F = PALETTE.furnish;

interface At {
  h: PlotHost;
  /** tile centre and ground top */
  x: number;
  y: number;
  z: number;
  rot: number;
  far: boolean;
  /** #849/#851: a number particular to this placed piece (from its square), so pieces like houseplants differ */
  seed: number;
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

/**
 * #851: the rugs' layers. Each is a slab from the floor up to its own height, `RUG.step` above the layer under it, the
 * lowest `RUG.base` up: clear of the room's own rug and door mat (rendering/HouseArt, at most 0.016 high), so a rug laid
 * over them, or a layer over a layer, never flickers.
 */
export const RUG = { base: 0.026, step: 0.007 };
function rug(a: At, type: VPrim, hex: string, dx: number, dz: number, w: number, d: number, layer: number) {
  const top = RUG.base + layer * RUG.step;
  put(a, type, hex, dx, top / 2, dz, [w, top, d]);
}

/** A model copy at a local offset, turned with the decoration. False when the model isn't there. */
function model(a: At, name: string, dx: number, dz: number, scale: number, extraRot = 0, dy = 0): boolean {
  const [ox, oz] = turn(a.rot, dx, dz);
  return a.h.model(name, a.x + ox, a.y + dy, a.z + oz, -a.rot * (Math.PI / 2) + extraRot, scale);
}

/** A short sagging string of bulbs (a line light's look in hand). */
function lineSample(a: At, hex: string, size: number, n: number) {
  // far away, half the bulbs and never more than four, spread along the same curve: the string still reads, inside
  // the far-art budget (under 400 triangles)
  if (a.far) n = Math.min(4, Math.ceil(n / 2));
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    put(a, 'sphere', hex, -0.4 + 0.8 * t, 0.9 - Math.sin(t * Math.PI) * 0.15, 0, size);
  }
  if (!a.far) put(a, 'box', P.metal.dark, 0, 0.95, 0, [0.84, 0.015, 0.015]);
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
    put(a, 'box', L.bulbOff, 0, 0.2, 0, [0.16, 0.22, 0.16]); // E23.3.5: lit by LightVisuals at dusk
    put(a, 'cone', P.metal.dark, 0, 0.36, 0, [0.24, 0.1, 0.24]);
    if (!a.far) put(a, 'box', P.solar.panel, 0, 0.42, 0, [0.14, 0.02, 0.14]); // its sun cell
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
    put(a, 'cylinder', P.metal.dark, 0, 0.47, 0, [0.07, 0.94, 0.07]);
    put(a, 'sphere', L.bulbOff, 0, 1.02, 0, 0.2); // E23.3.5: lit by LightVisuals at dusk (data/lights bulbY)
  },
  solarlamppost: (a) => {
    if (!model(a, 'lamp-post', 0, 0, 0.48)) {
      put(a, 'cylinder', P.metal.dark, 0, 0.47, 0, [0.07, 0.94, 0.07]);
      put(a, 'sphere', L.bulbOff, 0, 1.02, 0, 0.2);
    }
    if (a.far) return;
    // its own little sun panel, tilted on a short arm above the lamp
    put(a, 'box', P.metal.dark, 0, 1.3, 0, [0.03, 0.2, 0.03]);
    put(a, 'box', P.metal.dark, 0, 1.4, 0, [0.3, 0.015, 0.24]);
    put(a, 'box', P.solar.panel, 0, 1.41, 0, [0.27, 0.015, 0.21]);
  },
  // ───── E23.3.5 night lights (data/lights.ts). The glowing parts are LightVisuals', drawn dark here. ─────
  pathlight: (a) => {
    if (model(a, 'bollard', 0, 0, 0.42)) return;
    put(a, 'cylinder', P.metal.dark, 0, 0.16, 0, [0.14, 0.32, 0.14]);
    put(a, 'cylinder', L.bulbOff, 0, 0.36, 0, [0.12, 0.08, 0.12]);
    put(a, 'cylinder', P.metal.dark, 0, 0.42, 0, [0.16, 0.03, 0.16]);
  },
  solarstake: (a) => {
    put(a, 'cylinder', P.metal.dark, 0, 0.14, 0, [0.03, 0.28, 0.03]);
    put(a, 'sphere', L.bulbOff, 0, 0.3, 0, 0.09);
    if (a.far) return;
    put(a, 'box', P.solar.panel, 0, 0.36, 0, [0.12, 0.015, 0.12]);
    put(a, 'box', P.metal.dark, 0, 0.35, 0, [0.14, 0.01, 0.14]);
  },
  uplight: (a) => {
    put(a, 'cylinder', P.stone.light, 0, 0.03, 0, [0.22, 0.06, 0.22]);
    put(a, 'cylinder', L.bulbOff, 0, 0.07, 0, [0.14, 0.02, 0.14]);
  },
  porchlight: (a) => {
    put(a, 'box', P.stone.light, 0, 0.5, -0.32, [0.26, 1.0, 0.16]);
    if (a.far) return;
    put(a, 'box', P.metal.dark, 0, 1.12, -0.18, [0.04, 0.04, 0.2]);
    put(a, 'box', L.bulbOff, 0, 1.03, -0.1, [0.12, 0.14, 0.12]);
    put(a, 'cone', P.metal.dark, 0, 1.13, -0.1, [0.16, 0.06, 0.16]);
  },
  tablelight: (a) => {
    put(a, 'cylinder', P.wood.mid, 0, 0.42, 0, [0.6, 0.04, 0.6]);
    put(a, 'cylinder', P.wood.mid, 0, 0.2, 0, [0.06, 0.4, 0.06]);
    if (a.far) return;
    put(a, 'cylinder', P.wood.mid, 0, 0.02, 0, [0.3, 0.03, 0.3]);
    put(a, 'cylinder', P.metal.dark, 0.08, 0.5, 0.04, [0.04, 0.12, 0.04]);
    put(a, 'cone', L.bulbOff, 0.08, 0.62, 0.04, [0.18, 0.12, 0.18]);
  },
  glowpod: (a) => {
    put(a, 'cylinder', C.bedSoil, 0, 0.02, 0, [0.5, 0.04, 0.5]);
    if (a.far) return put(a, 'sphere', P.leaf.mid, 0, 0.18, 0, 0.3);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      put(a, 'cylinder', P.leaf.mid, Math.cos(ang) * 0.12, 0.12, Math.sin(ang) * 0.12, [0.03, 0.22, 0.03]);
      put(a, 'sphere', P.leaf.shrub[0], Math.cos(ang) * 0.12, 0.25, Math.sin(ang) * 0.12, 0.08);
    }
  },
  // Line lights hang on a pole's lines (never on a tile): this is only their look in hand (the hologram).
  festoon: (a) => lineSample(a, L.bulbOff, 0.09, 5),
  fairylights: (a) => lineSample(a, L.bulbOff, 0.04, 11),
  paperlanterns: (a) => lineSample(a, L.lamps.rose, 0.16, 3),
  glasslanterns: (a) => {
    put(a, 'box', P.metal.dark, 0, 0.9, 0, [0.7, 0.02, 0.02]);
    if (!model(a, 'lantern', 0, 0, 0.4, 0, 0.5)) put(a, 'box', L.bulbOff, 0, 0.7, 0, [0.14, 0.2, 0.14]);
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
    put(a, 'box', P.stone.light, 0, 0.12, 0, [0.36, 0.24, 0.36]);
    put(a, 'box', C.bedSoil, 0, 0.245, 0, [0.3, 0.01, 0.3]);
    if (a.far) return put(a, 'sphere', P.leaf.shrub[0], 0, 0.46, 0, 0.36);
    put(a, 'sphere', P.leaf.shrub[1], 0, 0.44, 0, 0.36);
    put(a, 'sphere', P.leaf.shrub[0], 0, 0.66, 0, 0.2);
  },
  catstatue: (a) => {
    put(a, 'box', P.stone.light, 0, 0.08, 0, [0.42, 0.16, 0.42]);
    if (model(a, 'lucky-cat', 0, 0, 0.55, 0, 0.16)) return;
    put(a, 'sphere', P.glow.gold, 0, 0.36, 0, [0.3, 0.38, 0.26]);
    put(a, 'sphere', P.glow.gold, 0, 0.6, 0.02, 0.22);
  },
  // E23.12.2 (#529): cat-only decorations, left by Lucky Cats
  catbench: (a) => {
    put(a, 'box', P.props.benchWood, 0, 0.26, 0, [0.78, 0.06, 0.28]);
    put(a, 'box', P.props.benchWood, 0, 0.46, -0.12, [0.78, 0.2, 0.05]);
    if (a.far) return;
    for (const s of [-1, 1]) {
      put(a, 'box', P.props.benchFrame, s * 0.32, 0.13, 0, [0.06, 0.26, 0.26]);
      put(a, 'cone', P.props.benchWood, s * 0.26, 0.62, -0.12, [0.1, 0.12, 0.04]); // the ears on its back
    }
  },
  catfountain: (a) => {
    put(a, 'cylinder', P.stone.light, 0, 0.12, 0, [0.6, 0.24, 0.6]);
    put(a, 'cylinder', C.waterShallow, 0, 0.245, 0, [0.5, 0.02, 0.5]);
    if (a.far) return put(a, 'sphere', P.glow.gold, 0, 0.42, 0, [0.16, 0.24, 0.14]);
    put(a, 'cylinder', P.stone.light, 0, 0.3, 0, [0.12, 0.14, 0.12]);
    put(a, 'sphere', P.glow.gold, 0, 0.45, 0, [0.16, 0.2, 0.14]);
    put(a, 'sphere', P.glow.gold, 0, 0.6, 0.02, 0.12);
    for (const s of [-1, 1]) put(a, 'cone', P.glow.gold, s * 0.045, 0.69, 0.02, [0.05, 0.06, 0.04]);
    put(a, 'cylinder', C.waterShallow, 0, 0.42, 0.12, [0.03, 0.3, 0.03]); // the spout's stream
  },
  pawstones: (a) => {
    put(a, 'cylinder', P.stone.light, 0, 0.02, 0.08, [0.36, 0.04, 0.3]);
    if (a.far) return;
    for (const [x, z] of [[-0.2, -0.14], [-0.07, -0.24], [0.07, -0.24], [0.2, -0.14]]) put(a, 'cylinder', P.stone.light, x, 0.02, z, [0.12, 0.04, 0.12]);
  },
  goldlantern: (a) => {
    put(a, 'box', P.stone.light, 0, 0.04, 0, [0.26, 0.08, 0.26]);
    put(a, 'box', P.glow.gold, 0, 0.22, 0, [0.17, 0.24, 0.17], 1);
    put(a, 'cone', P.glow.gold, 0, 0.4, 0, [0.26, 0.12, 0.26]);
    if (!a.far) for (const s of [-1, 1]) put(a, 'cone', P.glow.gold, s * 0.07, 0.49, 0, [0.06, 0.08, 0.05]); // cat ears
  },
  rainbowbunting: (a) => {
    put(a, 'cylinder', P.wood.post, 0, 0.7, 0, [0.06, 1.4, 0.06]);
    if (a.far) return put(a, 'box', P.flowers.pink, 0.18, 1.15, 0, [0.32, 0.36, 0.02]);
    const flags = [P.flowers.pink, P.flowers.yellow, P.leaf.shrub[0], P.glow.lamp];
    flags.forEach((c, i) => put(a, 'box', c, 0.16, 1.32 - i * 0.14, 0, [0.28, 0.12, 0.02]));
  },
  // ───── #850: furniture made for a room, in the woods of the bed, desk and chest already there (HouseArt) ─────
  armchair: (a) => {
    put(a, 'box', F.fabric, 0, 0.17, 0.02, [0.7, 0.22, 0.6]); // the seat's base
    put(a, 'box', F.fabric, 0, 0.42, -0.26, [0.7, 0.5, 0.16]); // its back
    if (a.far) return put(a, 'box', F.fabricDark, 0, 0.3, 0.02, [0.86, 0.14, 0.6]);
    for (const s of [-1, 1]) {
      put(a, 'box', F.fabricDark, s * 0.38, 0.31, 0.02, [0.12, 0.26, 0.62]); // arms
      put(a, 'sphere', F.fabricDark, s * 0.38, 0.44, 0.02, [0.13, 0.08, 0.62]);
      for (const k of [-1, 1]) put(a, 'box', H.bedWood, s * 0.34, 0.03, 0.02 + k * 0.24, [0.06, 0.06, 0.06]); // feet
    }
    put(a, 'box', F.cushion, 0, 0.31, 0.06, [0.6, 0.08, 0.48]);
    put(a, 'box', F.cushion, 0, 0.5, -0.16, [0.54, 0.34, 0.08]);
  },
  stool: (a) => {
    put(a, 'cylinder', F.seat, 0, 0.36, 0, [0.38, 0.06, 0.38]);
    if (a.far) return put(a, 'cylinder', H.desk, 0, 0.17, 0, [0.26, 0.34, 0.26]);
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * Math.PI * 2 + Math.PI / 2;
      put(a, 'cylinder', H.desk, Math.cos(ang) * 0.12, 0.17, Math.sin(ang) * 0.12, [0.04, 0.34, 0.04]);
    }
    put(a, 'cylinder', H.desk, 0, 0.12, 0, [0.26, 0.025, 0.26]); // the ring between the legs
  },
  diningtable: (a) => {
    // 2 × 1 squares: about the middle of its footprint, long across x
    put(a, 'box', H.desk, 0, 0.46, 0, [1.78, 0.07, 0.78]);
    if (a.far) return put(a, 'box', H.desk, 0, 0.22, 0, [1.5, 0.44, 0.5]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(a, 'box', H.desk, sx * 0.8, 0.21, sz * 0.31, [0.07, 0.42, 0.07]);
    put(a, 'box', F.cloth, 0, 0.5, 0, [1.3, 0.012, 0.36]); // a runner down the middle
    put(a, 'box', F.clothEdge, 0, 0.505, 0, [1.3, 0.01, 0.04]);
    for (const s of [-1, 1]) {
      put(a, 'cylinder', F.plate, s * 0.5, 0.51, 0.2, [0.2, 0.02, 0.2]);
      put(a, 'cylinder', F.plate, s * 0.5, 0.51, -0.2, [0.2, 0.02, 0.2]);
    }
    put(a, 'cylinder', H.glass, 0, 0.58, 0, [0.08, 0.16, 0.08]); // a jug of water
    put(a, 'sphere', P.flowers.pink, 0, 0.68, 0, 0.08);
  },
  sidetable: (a) => {
    put(a, 'cylinder', H.desk, 0, 0.44, 0, [0.46, 0.05, 0.46]);
    put(a, 'cylinder', H.desk, 0, 0.22, 0, [0.06, 0.42, 0.06]);
    if (a.far) return;
    put(a, 'cylinder', H.desk, 0, 0.02, 0, [0.28, 0.04, 0.28]);
    put(a, 'box', H.book[1], -0.08, 0.49, 0.04, [0.18, 0.05, 0.13]);
    put(a, 'sphere', H.door, 0.1, 0.53, -0.06, [0.14, 0.12, 0.14]); // a teapot
    put(a, 'cylinder', H.door, 0.19, 0.55, -0.06, [0.03, 0.06, 0.03]);
  },
  bookshelf: (a) => {
    // against the wall behind it: four boards of books
    const back = -0.3;
    put(a, 'box', H.shelf, 0, 0.7, back - 0.08, [0.84, 1.4, 0.04]);
    if (a.far) return put(a, 'box', H.book[0], 0, 0.7, back + 0.06, [0.76, 1.2, 0.2]);
    for (const k of [-1, 1]) put(a, 'box', H.shelf, k * 0.41, 0.7, back + 0.04, [0.04, 1.4, 0.28]);
    for (const yy of [0.04, 0.38, 0.72, 1.06, 1.4]) put(a, 'box', H.shelf, 0, yy, back + 0.04, [0.82, 0.04, 0.28]);
    for (let row = 0; row < 4; row++)
      for (let i = 0; i < 3; i++) {
        const w = 0.18 + ((row + i) % 3) * 0.03;
        put(a, 'box', H.book[(row + i * 2) % H.book.length], -0.24 + i * 0.25, 0.06 + row * 0.34 + 0.13, back + 0.05, [w, 0.24 - (i % 2) * 0.04, 0.2]);
      }
  },
  coatstand: (a) => {
    put(a, 'cylinder', H.bedWood, 0, 0.62, 0, [0.05, 1.24, 0.05]);
    put(a, 'cylinder', H.bedWood, 0, 0.03, 0, [0.34, 0.05, 0.34]);
    if (a.far) return put(a, 'box', F.coat, 0.07, 0.86, 0, [0.12, 0.5, 0.26]);
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      put(a, 'box', F.brass, Math.cos(ang) * 0.08, 1.16, Math.sin(ang) * 0.08, [0.12, 0.025, 0.025]);
    }
    put(a, 'box', F.coat, 0.08, 0.84, 0, [0.12, 0.54, 0.28]); // a coat on one hook
    put(a, 'box', F.coat, 0.08, 1.06, 0, [0.14, 0.1, 0.18]);
    put(a, 'cylinder', F.hat, -0.06, 1.24, 0, [0.22, 0.03, 0.22]); // a hat on another
    put(a, 'cylinder', F.hat, -0.06, 1.3, 0, [0.13, 0.1, 0.13]);
    put(a, 'sphere', F.brass, 0, 1.27, 0, 0.05);
  },
  // ───── #851: soft furnishings. Rugs lie flat (Bloombot walks over them); lamps glow by LightVisuals at night. ─────
  roundrug: (a) => {
    rug(a, 'cylinder', F.rugGreenEdge, 0, 0, 0.88, 0.88, 0);
    rug(a, 'cylinder', F.rugGreen, 0, 0, 0.78, 0.78, 1);
    if (a.far) return;
    rug(a, 'cylinder', F.rugGreenEdge, 0, 0, 0.44, 0.44, 2);
    rug(a, 'cylinder', F.rugGreen, 0, 0, 0.34, 0.34, 3);
  },
  hallrunner: (a) => {
    // 1 × 3 squares, long along z
    rug(a, 'box', F.rugBlue, 0, 0, 0.7, 2.78, 0);
    if (a.far) return;
    for (const s of [-1, 1]) {
      rug(a, 'box', F.rugBlueEdge, s * 0.29, 0, 0.05, 2.66, 1); // a pale stripe down each side
      rug(a, 'box', F.rugBlueEdge, 0, s * 1.12, 0.58, 0.05, 1);
      rug(a, 'box', F.rugBlueEdge, 0, s * 1.42, 0.62, 0.06, 0); // the fringe at each end
    }
    for (const z of [-0.6, 0, 0.6]) rug(a, 'box', F.rugBlueEdge, 0, z, 0.16, 0.16, 1);
  },
  bigrug: (a) => {
    // 2 × 3 squares
    rug(a, 'box', F.rugCream, 0, 0, 1.84, 2.84, 0);
    rug(a, 'box', F.rugRed, 0, 0, 1.6, 2.6, 1);
    if (a.far) return;
    rug(a, 'box', F.rugCream, 0, 0, 1.2, 2.2, 2);
    rug(a, 'box', F.rugRed, 0, 0, 1.08, 2.08, 3);
    rug(a, 'cylinder', F.rugCream, 0, 0, 0.6, 0.9, 4); // a medallion in the middle
    rug(a, 'cylinder', F.rugRed, 0, 0, 0.4, 0.66, 5);
  },
  patternrug: (a) => {
    // 2 × 2 squares: a field of checks round a big middle square
    rug(a, 'box', F.rugTeal, 0, 0, 1.84, 1.84, 0);
    if (a.far) return rug(a, 'box', F.rugGold, 0, 0, 1.1, 1.1, 1);
    rug(a, 'box', F.rugGold, 0, 0, 1.7, 1.7, 1);
    rug(a, 'box', F.rugTeal, 0, 0, 1.56, 1.56, 2);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const big = i === 0 && j === 0;
        rug(a, 'box', (i + j) % 2 ? F.rugCream : F.rugGold, i * 0.5, j * 0.5, big ? 0.44 : 0.26, big ? 0.44 : 0.26, 3);
      }
  },
  floorlamp: (a) => {
    put(a, 'cylinder', F.iron, 0, 0.02, 0, [0.32, 0.04, 0.32]);
    put(a, 'cylinder', F.brass, 0, 0.5, 0, [0.04, 0.96, 0.04]);
    put(a, 'cylinder', F.shade, 0, 1.08, 0, [0.34, 0.24, 0.34]); // its shade: LightVisuals glows it at night
    if (a.far) return;
    put(a, 'cylinder', F.brass, 0, 0.94, 0, [0.08, 0.04, 0.08]);
    put(a, 'cylinder', F.brass, 0, 1.21, 0, [0.06, 0.03, 0.06]);
  },
  tablelamp: (a) => {
    put(a, 'cylinder', H.desk, 0, 0.36, 0, [0.42, 0.05, 0.42]);
    put(a, 'cylinder', H.desk, 0, 0.18, 0, [0.06, 0.34, 0.06]);
    put(a, 'cylinder', F.shade, 0.06, 0.66, -0.04, [0.22, 0.16, 0.22]); // its shade: LightVisuals glows it at night
    if (a.far) return;
    put(a, 'cylinder', H.desk, 0, 0.02, 0, [0.26, 0.04, 0.26]);
    put(a, 'sphere', F.potWhite, 0.06, 0.45, -0.04, [0.12, 0.12, 0.12]); // the lamp's round base
    put(a, 'cylinder', F.brass, 0.06, 0.54, -0.04, [0.02, 0.12, 0.02]);
    put(a, 'box', H.book[2], -0.1, 0.4, 0.08, [0.16, 0.04, 0.12]); // a book beside it
  },
  houseplant: (a) => {
    put(a, 'cylinder', F.pot, 0, 0.12, 0, [0.3, 0.24, 0.3]);
    put(a, 'cylinder', F.potRim, 0, 0.24, 0, [0.34, 0.04, 0.34]);
    if (a.far) return put(a, 'sphere', P.leaf.mid, 0, 0.42, 0, [0.42, 0.34, 0.42]);
    put(a, 'cylinder', F.soil, 0, 0.255, 0, [0.28, 0.01, 0.28]);
    // grown by the tree and shrub code, its own shape from its square (TreeGen buildHouseplant)
    a.h.foliage(houseplantGeo(a.seed, a.h.lod), a.x, a.y + 0.26, a.z, (a.seed % 12) * 0.52, 1.6);
  },
  pottedtree: (a) => {
    put(a, 'cylinder', F.potWhite, 0, 0.16, 0, [0.4, 0.32, 0.4]);
    put(a, 'cylinder', F.potWhite, 0, 0.32, 0, [0.44, 0.04, 0.44]);
    if (a.far) return put(a, 'sphere', P.leaf.mid, 0, 0.85, 0, [0.6, 0.6, 0.6]);
    put(a, 'cylinder', F.soil, 0, 0.335, 0, [0.38, 0.01, 0.38]);
    a.h.foliage(houseplantGeo(a.seed, a.h.lod, true), a.x, a.y + 0.34, a.z, (a.seed % 12) * 0.52, 1.35);
  },
  cushions: (a) => {
    const c = F.cushions;
    put(a, 'box', c[0], -0.08, 0.07, 0.06, [0.5, 0.14, 0.44]);
    put(a, 'box', c[1], 0.14, 0.07, -0.14, [0.42, 0.14, 0.38]);
    if (a.far) return;
    put(a, 'box', c[2], 0.02, 0.19, -0.02, [0.36, 0.12, 0.32]);
    put(a, 'sphere', c[3], -0.2, 0.06, -0.2, [0.26, 0.12, 0.26]);
    for (const [x, z] of [[-0.28, 0.24], [0.16, 0.24], [-0.28, -0.12]]) put(a, 'sphere', c[0], x, 0.08, z, 0.04); // tassels
  },
  clock: (a) => {
    // a tall case clock, its face to the front
    put(a, 'box', F.clockWood, 0, 0.62, -0.1, [0.4, 1.24, 0.26]);
    put(a, 'sphere', F.clockFace, 0, 1.0, 0.035, [0.26, 0.26, 0.02]);
    if (a.far) return;
    put(a, 'box', F.clockWood, 0, 1.3, -0.1, [0.46, 0.1, 0.3]);
    put(a, 'box', F.clockWood, 0, 0.04, -0.1, [0.46, 0.08, 0.3]);
    put(a, 'box', F.iron, 0, 1.03, 0.05, [0.015, 0.09, 0.01]); // the hands
    put(a, 'box', F.iron, 0.025, 0.99, 0.05, [0.06, 0.012, 0.01]);
    put(a, 'box', H.glass, 0, 0.55, 0.035, [0.24, 0.5, 0.01]); // the glass door…
    put(a, 'cylinder', F.brass, 0, 0.6, 0.02, [0.012, 0.32, 0.012]); // …and the pendulum behind it
    put(a, 'sphere', F.brass, 0, 0.42, 0.025, [0.1, 0.1, 0.02]);
  },
};

/** Ids with art (tests check every decoration has some). */
export const DECOR_ART = Object.keys(ART);

/**
 * Draws a decoration about (`x`, `z`), the middle of its footprint, its ground top at `y`. `rot` in quarter turns;
 * `far` the far level of detail; `seed` a number particular to the placed piece (#849), so no two houseplants match.
 */
export function drawDecor(h: PlotHost, kind: string, x: number, y: number, z: number, rot: number, far: boolean, seed = 0) {
  (ART[kind] ?? ART.pot)({ h, x, y, z, rot: rot & 3, far, seed });
}
