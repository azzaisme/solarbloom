import { HOUSE_INSIDE, houseRugs, type HouseFurniture, type HouseRoom, type HouseWall } from '../data/oldcity';
import { PALETTE } from './Palette';
import type { HouseTexName } from './HouseTex';
import type { VPrim } from './Shapes';

type V3 = [number, number, number];

/**
 * #782: what the house is drawn into: the chunk's vertex-coloured mesh (primitives, and triangles for the roofs'
 * slopes when the sink has them; a stepped roof otherwise).
 */
export interface HouseSink {
  add(type: VPrim, hex: string, p: V3, s: V3 | number, glow?: number): void;
  tri?(hex: string, a: V3, b: V3, c: V3, n: V3): void;
  /** #861: a box wearing one of the house's painted textures (HouseTex), tinted `hex`; a plain box without it */
  tex?(name: HouseTexName, hex: string, p: V3, s: V3): void;
}

/** #861: a box in a painted texture when the sink has them, else in plain colour. */
function tbox(b: HouseSink, name: HouseTexName, hex: string, p: V3, s: V3) {
  if (b.tex) b.tex(name, hex, p, s);
  else b.add('box', hex, p, s);
}

/** The house's footprint on the ground: its north-west cell, its size (cells) and its door cell (in front of it). */
export interface HouseSpot {
  x: number;
  z: number;
  size: number;
  door: [number, number];
}

const H = PALETTE.house;
const FLOWERS = PALETTE.flower;

/**
 * A pitched roof along x over the box x0..x1, z0..z1 standing at y0: two slopes rising `rise` to the ridge, its
 * gable ends in `wall`, the eaves hanging `eave` past the walls. Without triangles: three stepped slabs.
 */
function gable(b: HouseSink, x0: number, x1: number, z0: number, z1: number, y0: number, rise: number, eave: number, tiles: string, wall: string, under: string) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const len = (x1 - x0) / 2;
  const half = (z1 - z0) / 2;
  if (!b.tri) {
    for (let i = 0; i < 3; i++) b.add('box', i === 2 ? tiles : i ? under : tiles, [cx, y0 + (rise * (i + 0.5)) / 3, cz], [x1 - x0 + 2 * eave, rise / 3, (z1 - z0 + 2 * eave) * (1 - i / 3)]);
    return;
  }
  const y1 = y0 + rise;
  const ye = y0 - (eave * rise) / half;
  const nl = Math.hypot(rise, half);
  const L = len + eave;
  for (const side of [-1, 1]) {
    const n: V3 = [0, half / nl, (side * rise) / nl];
    const a: V3 = [cx - L, ye, cz + side * (half + eave)];
    const c: V3 = [cx + L, ye, cz + side * (half + eave)];
    b.tri(tiles, a, c, [cx + L, y1, cz], n);
    b.tri(tiles, a, [cx + L, y1, cz], [cx - L, y1, cz], n);
    // the roof's thickness along its lower edge, so it doesn't read as paper
    b.add('box', under, [cx, ye - 0.03, cz + side * (half + eave - 0.02)], [2 * L, 0.06, 0.05]);
    b.tri(wall, [cx + side * len, y0, cz - half], [cx + side * len, y0, cz + half], [cx + side * len, y1, cz], [side, 0, 0]);
  }
  b.add('box', under, [cx, y1 + 0.02, cz], [2 * L + 0.04, 0.06, 0.08]); // the ridge
}

/** A window on the south face (z = face) or the east face (x = face), glowing a little in its frame. */
function window(b: HouseSink, axis: 'z' | 'x', face: number, along: number, y: number, w: number, h: number, frame: string, glow: number) {
  const d = 0.04;
  const at = (k: number, yy: number, out: number): V3 => (axis === 'z' ? [along + k, yy, face + out] : [face + out, yy, along + k]);
  const sz = (a: number, hh: number, t: number): V3 => (axis === 'z' ? [a, hh, t] : [t, hh, a]);
  b.add('box', frame, at(0, y, 0.01), sz(w + 0.08, h + 0.08, d));
  b.add('box', H.glass, at(0, y, 0.03), sz(w, h, d), glow);
  b.add('box', frame, at(0, y, 0.05), sz(0.03, h, 0.02)); // the glazing bars
  b.add('box', frame, at(0, y, 0.05), sz(w, 0.03, 0.02));
  b.add('box', frame, at(0, y - h / 2 - 0.04, 0.06), sz(w + 0.14, 0.04, 0.1)); // the sill
}

/** A window box of flowers under a south window. */
function windowBox(b: HouseSink, x: number, y: number, z: number, w: number, seed: number) {
  b.add('box', PALETTE.terracotta, [x, y, z + 0.08], [w, 0.09, 0.12]);
  for (let i = 0; i < 4; i++) {
    const fx = x - w / 2 + (w * (i + 0.5)) / 4;
    b.add('sphere', PALETTE.leaf.mid, [fx, y + 0.07, z + 0.08], [0.09, 0.07, 0.08]);
    b.add('sphere', FLOWERS[(seed + i) % FLOWERS.length], [fx + 0.02, y + 0.12, z + 0.1], 0.05);
  }
}

/** A door in the south face, with its frame, a step and a knob. */
function door(b: HouseSink, x: number, y: number, z: number, paint: string, h = 0.78) {
  b.add('box', H.trim, [x, y + h / 2, z + 0.01], [0.5, h + 0.06, 0.04]);
  b.add('box', paint, [x, y + h / 2, z + 0.03], [0.42, h, 0.04]);
  b.add('box', H.beam, [x, y + h * 0.62, z + 0.05], [0.42, 0.03, 0.02]);
  b.add('sphere', PALETTE.trim.gold, [x + 0.14, y + h * 0.48, z + 0.07], 0.035);
  b.add('box', H.step, [x, y + 0.04, z + 0.16], [0.6, 0.08, 0.26]);
}

/** Plank lines down a wall (the south or the west face), for a timber look. */
function planks(b: HouseSink, axis: 'z' | 'x', face: number, from: number, to: number, y0: number, h: number, hex: string) {
  for (let k = from + 0.25; k < to - 0.1; k += 0.32) b.add('box', hex, axis === 'z' ? [k, y0 + h / 2, face + 0.012] : [face - 0.012, y0 + h / 2, k], axis === 'z' ? [0.025, h, 0.02] : [0.02, h, 0.025]);
}

/**
 * #782: the house at its level, standing on its footprint with its door on the south face in front of the door
 * cell. 1 the Shed: mended planks, a tin roof and a lantern by the door. 2 the Cottage: white plaster on a stone
 * plinth, a tiled roof, a chimney, shutters and window boxes. 3 the House: two storeys, stone below and plaster
 * above, a slate roof and a canopy over the door. 4 the Home: the House with a blue door, a porch, a balcony, a light
 * by the door and a solar panel on its roof. (Level 0, the ruined shed, stays the renderer's own.)
 */
export function drawHouse(b: HouseSink, level: number, at: HouseSpot, y: number) {
  const x0 = at.x + 0.12;
  const x1 = at.x + at.size - 0.12;
  const z0 = at.z + 0.12;
  const z1 = at.z + at.size - 0.12;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const W = x1 - x0;
  const D = z1 - z0;
  const dx = at.door[0] + 0.5;
  const winX = at.x + 0.75;
  if (level <= 1) {
    const h = 1.15;
    b.add('box', H.plank, [cx, y + h / 2, cz], [W, h, D]);
    planks(b, 'z', z1, x0, x1, y, h, H.plankDark);
    planks(b, 'x', x0, z0, z1, y, h, H.plankDark);
    // mended: lighter new boards over the old holes
    b.add('box', H.patch, [x0 + 0.5, y + 0.4, z1 + 0.025], [0.5, 0.22, 0.02]);
    b.add('box', H.patch, [x0 - 0.025, y + 0.7, cz + 0.3], [0.02, 0.2, 0.55]);
    for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as [number, number][]) b.add('box', H.beam, [px, y + h / 2, pz], [0.1, h + 0.02, 0.1]);
    gable(b, x0, x1, z0, z1, y + h, 0.5, 0.14, H.tin, H.plank, H.tinDark);
    for (let k = x0 + 0.2; k < x1; k += 0.35) b.add('box', H.tinDark, [k, y + h + 0.27, cz + D / 4 + 0.08], [0.03, 0.03, D / 2 + 0.2]); // ribs of the tin
    window(b, 'z', z1, winX, y + 0.7, 0.42, 0.34, H.beam, 0.15);
    door(b, dx, y, z1, H.plankDark);
    // a lantern by the door and a crate of odds and ends
    b.add('box', H.beam, [dx + 0.36, y + 0.95, z1 + 0.06], [0.04, 0.1, 0.1]);
    b.add('box', H.lamp, [dx + 0.36, y + 0.84, z1 + 0.1], [0.09, 0.13, 0.09], 0.8);
    b.add('box', PALETTE.wood.crate, [x0 + 0.25, y + 0.15, z1 + 0.3], [0.32, 0.3, 0.3]);
    return;
  }
  if (level === 2) {
    const h = 1.3;
    b.add('box', H.stone, [cx, y + 0.09, cz], [W + 0.08, 0.18, D + 0.08]);
    b.add('box', H.plaster, [cx, y + 0.18 + (h - 0.18) / 2, cz], [W, h - 0.18, D]);
    for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]] as [number, number][]) b.add('box', H.beam, [px, y + h / 2 + 0.09, pz], [0.11, h - 0.16, 0.11]);
    b.add('box', H.beam, [cx, y + h - 0.04, z1 + 0.01], [W, 0.08, 0.04]);
    b.add('box', H.beam, [x1 + 0.01, y + h - 0.04, cz], [0.04, 0.08, D]);
    gable(b, x0, x1, z0, z1, y + h, 0.85, 0.18, H.tile, H.plaster, H.tileDark);
    // the chimney at the back, a wisp of glow on its top
    b.add('box', H.brick, [x0 + 0.5, y + h + 0.75, z0 + 0.55], [0.3, 1.0, 0.3]);
    b.add('box', H.stoneDark, [x0 + 0.5, y + h + 1.27, z0 + 0.55], [0.36, 0.06, 0.36]);
    window(b, 'z', z1, winX, y + 0.78, 0.46, 0.4, H.trim, 0.35);
    for (const s of [-1, 1]) b.add('box', H.shutter, [winX + s * 0.33, y + 0.78, z1 + 0.03], [0.16, 0.44, 0.03]);
    windowBox(b, winX, y + 0.48, z1, 0.5, 1);
    window(b, 'x', x1, cz, y + 0.78, 0.5, 0.4, H.trim, 0.35);
    door(b, dx, y, z1, H.door);
    return;
  }
  // 3 and 4: two storeys
  const g = 1.15;
  const u = 1.05;
  b.add('box', H.stone, [cx, y + g / 2, cz], [W, g, D]);
  for (let r = 0.28; r < g; r += 0.28) b.add('box', H.stoneDark, [cx, y + r, z1 + 0.012], [W, 0.025, 0.02]); // stone courses
  b.add('box', H.beam, [cx, y + g + 0.04, cz], [W + 0.1, 0.08, D + 0.1]);
  b.add('box', H.plaster, [cx, y + g + 0.08 + u / 2, cz], [W, u, D]);
  for (const k of [x0 + 0.05, cx, x1 - 0.05]) b.add('box', H.beam, [k, y + g + 0.08 + u / 2, z1 + 0.012], [0.08, u, 0.02]);
  const top = y + g + 0.08 + u;
  gable(b, x0, x1, z0, z1, top, 0.95, 0.2, H.slate, H.plaster, H.slateDark);
  b.add('box', H.brick, [x0 + 0.45, top + 0.7, z0 + 0.5], [0.32, 1.1, 0.32]);
  b.add('box', H.stoneDark, [x0 + 0.45, top + 1.27, z0 + 0.5], [0.38, 0.06, 0.38]);
  // ground floor: a window by the door; upstairs: two on the south and one on the east
  window(b, 'z', z1, winX, y + 0.62, 0.46, 0.4, H.trim, 0.4);
  windowBox(b, winX, y + 0.33, z1, 0.5, 2);
  for (const k of [winX, dx]) window(b, 'z', z1, k, y + g + 0.6, 0.42, 0.42, H.trim, 0.4);
  window(b, 'x', x1, cz, y + g + 0.6, 0.5, 0.42, H.trim, 0.4);
  window(b, 'x', x1, cz, y + 0.62, 0.5, 0.4, H.trim, 0.4);
  const home = level >= 4;
  door(b, dx, y, z1, home ? H.doorHome : H.door, 0.82);
  if (!home) {
    // a little canopy over the door
    b.add('box', H.slateDark, [dx, y + 1.0, z1 + 0.18], [0.7, 0.05, 0.36]);
    for (const s of [-1, 1]) b.add('box', H.beam, [dx + s * 0.3, y + 0.94, z1 + 0.1], [0.04, 0.12, 0.2]);
    return;
  }
  // the Home: a porch on two posts, a light by the door, a balcony upstairs and a solar panel on the roof
  b.add('box', H.step, [dx, y + 0.05, z1 + 0.42], [0.95, 0.1, 0.62]);
  for (const s of [-1, 1]) b.add('box', H.trim, [dx + s * 0.4, y + 0.55, z1 + 0.68], [0.06, 1.0, 0.06]);
  b.add('box', H.slate, [dx, y + 1.08, z1 + 0.4], [1.0, 0.06, 0.7]);
  b.add('box', H.lamp, [dx - 0.32, y + 0.7, z1 + 0.05], [0.08, 0.12, 0.08], 1);
  b.add('box', H.step, [winX, y + g + 0.12, z1 + 0.22], [0.9, 0.06, 0.42]);
  for (let k = -0.4; k <= 0.41; k += 0.1) b.add('box', H.rail, [winX + k, y + g + 0.3, z1 + 0.42], [0.025, 0.3, 0.025]);
  b.add('box', H.rail, [winX, y + g + 0.46, z1 + 0.42], [0.9, 0.04, 0.04]);
  if (b.tri) {
    // the panel lies on the south slope
    const half = D / 2 + 0.2;
    const t = 0.95 / half;
    const zA = cz + 0.25;
    const zB = cz + half - 0.25;
    const yA = top + 0.95 - (zA - cz) * t + 0.04;
    const yB = top + 0.95 - (zB - cz) * t + 0.04;
    const n: V3 = [0, half / Math.hypot(0.95, half), 0.95 / Math.hypot(0.95, half)];
    const xa = cx + 0.05;
    const xb = x1 - 0.15;
    b.tri(PALETTE.solar.panel, [xa, yA, zA], [xa, yB, zB], [xb, yB, zB], n);
    b.tri(PALETTE.solar.panel, [xa, yA, zA], [xb, yB, zB], [xb, yA, zA], n);
  }
}

/** #782: the house's garden (level 3 on): a rectangle of cells beside it. */
export interface GardenSpot {
  x: number;
  z: number;
  w: number;
  d: number;
  /** the side left open as its gate */
  gate: 'n' | 's' | 'e' | 'w';
}

/** #782: the low white fence round the house's garden (flat: Bloombot walks in through its gate). */
export function drawGardenFence(b: HouseSink, g: GardenSpot, y: number) {
  const x0 = g.x + 0.06;
  const x1 = g.x + g.w - 0.06;
  const z0 = g.z + 0.06;
  const z1 = g.z + g.d - 0.06;
  const side = (s: 'n' | 's' | 'e' | 'w') => {
    if (s === g.gate) {
      // the gate's two posts and nothing between them
      const [ax, az, bx, bz] = s === 'n' ? [x0, z0, x1, z0] : s === 's' ? [x0, z1, x1, z1] : s === 'w' ? [x0, z0, x0, z1] : [x1, z0, x1, z1];
      for (const [px, pz] of [[ax, az], [bx, bz]]) b.add('box', H.fencePost, [px, y + 0.24, pz], [0.07, 0.48, 0.07]);
      return;
    }
    const along = s === 'n' || s === 's';
    const len = along ? x1 - x0 : z1 - z0;
    const fixed = s === 'n' ? z0 : s === 's' ? z1 : s === 'w' ? x0 : x1;
    const mid = along ? (x0 + x1) / 2 : (z0 + z1) / 2;
    for (const ry of [0.14, 0.3]) b.add('box', H.fence, along ? [mid, y + ry, fixed] : [fixed, y + ry, mid], along ? [len, 0.035, 0.025] : [0.025, 0.035, len]);
    for (let k = 0; k <= len + 0.001; k += len / Math.max(1, Math.round(len / 0.25))) {
      const p = (along ? x0 : z0) + k;
      b.add('box', H.fence, along ? [p, y + 0.2, fixed] : [fixed, y + 0.2, p], [0.05, 0.4, 0.05]);
    }
  };
  (['n', 's', 'e', 'w'] as const).forEach(side);
}

/**
 * #859: the Home's fireplace, in metres from its corner on the west wall: the chimney breast's `depth` out from the
 * wall and `wide` along it, the firebox's `mouth` (wide) and `mouthTop` (high) with its `back` set into the wall, the
 * hearth stone `hearth` out from the wall. The fire burns at `glow` (its light, HouseInterior).
 */
export const FIREPLACE = { depth: 0.5, wide: 1.7, mouth: 0.8, mouthTop: 0.8, back: 0.18, hearth: 0.95, glow: [0.38, 0.42] as [number, number] };
/** #859: how strongly the fire's parts glow (0-1): enough to stand out at night, low enough that they keep their hue */
export const FIRE_GLOW = { outer: 0.45, core: 0.6, coals: 0.55, candle: 0.6 };

/**
 * #859: the flames: tongues rising off the logs, each `h` tall and `w` wide (m), `dz` along the grate from its middle
 * and `dx` toward the room, leaning `lean` degrees, flickering at their own `rate` and `phase` (HouseInterior).
 */
export const FIRE_TONGUES: { dx: number; dz: number; h: number; w: number; lean: number; rate: number; phase: number }[] = [
  { dx: 0, dz: -0.19, h: 0.24, w: 0.11, lean: -9, rate: 5.3, phase: 0 },
  { dx: 0, dz: -0.07, h: 0.36, w: 0.14, lean: -4, rate: 6.7, phase: 1.9 },
  { dx: 0, dz: 0.06, h: 0.42, w: 0.15, lean: 3, rate: 5.9, phase: 3.7 },
  { dx: 0, dz: 0.18, h: 0.27, w: 0.11, lean: 8, rate: 7.4, phase: 5.1 },
  { dx: 0.05, dz: 0.0, h: 0.21, w: 0.1, lean: -1, rate: 8.1, phase: 2.6 },
];

/** #859: where the flames' bases stand over the logs: x (cells, for a fireplace at cell `fx` on the west wall), and height (m). */
export function fireX(fx: number): number {
  return fx + FIREPLACE.back + (FIREPLACE.depth - FIREPLACE.back) / 2;
}
export const FIRE_BASE = 0.15;

/**
 * #859: one tongue of flame, a unit tall and wide, its base at the origin: a deep orange-red teardrop (a rounded foot
 * narrowing up to a point) round a smaller gold one set a little toward the room, so the core shows in front. Each
 * tongue is drawn once and scaled (its height flickering) by HouseInterior, self-lit: in its own colours whatever
 * light falls on it (the `glow`s mark it as lit for anything drawing it in the shared material).
 */
export function drawFlameTongue(b: HouseSink) {
  const H = PALETTE.house;
  b.add('sphere', H.flameOuter, [0, 0.2, 0], [1, 0.42, 1], FIRE_GLOW.outer);
  b.add('cone', H.flameOuter, [0, 0.6, 0], [0.94, 0.82, 0.94], FIRE_GLOW.outer);
  b.add('sphere', H.flameCore, [0.2, 0.17, 0], [0.62, 0.3, 0.62], FIRE_GLOW.core);
  b.add('cone', H.flameCore, [0.22, 0.44, 0], [0.56, 0.56, 0.56], FIRE_GLOW.core);
}

/**
 * #859: the coals glowing deep red-orange under the logs, and the logs' undersides catching, for a fireplace whose grate
 * is centred on (`x`, `z`) with its floor at `y` (world). Drawn apart from the room, self-lit (HouseInterior).
 */
export function drawCoals(b: HouseSink, x: number, y: number, z: number) {
  const H = PALETTE.house;
  for (const [k, w, c] of [[-0.2, 0.16, H.ember], [-0.07, 0.14, H.emberHot], [0.06, 0.17, H.ember], [0.19, 0.13, H.emberHot]] as [number, number, string][])
    b.add('sphere', c, [x + (k > 0 ? 0.02 : -0.02), y + 0.06, z + k], [w, 0.07, w], FIRE_GLOW.coals);
  for (const s of [-1, 1]) b.add('box', H.ember, [x + 0.056, y + 0.09 + (s > 0 ? 0.07 : 0), z + s * 0.06], [0.004, 0.025, FIREPLACE.mouth - 0.3], FIRE_GLOW.coals);
}

/** #859: the reading nook's standing lamp, in metres from the nook's corner (x, height of its bulb, z) */
export const NOOK_LAMP: V3 = [1.25, 1.36, 0.3];
/** #859: the reading nook's bookcase is this tall (m): low, under the east wall's window (its sill is at 0.91) */
export const NOOK_SHELF = 0.84;

/** A piece of furniture's look, cells from the room's corner `o` (world), standing on the floor at `y`. */
function furniture(b: HouseSink, f: HouseFurniture, o: V3, y: number, keepsakes: number) {
  const x0 = o[0] + f.x;
  const z0 = o[2] + f.z;
  const cx = x0 + f.w / 2;
  const cz = z0 + f.d / 2;
  if (f.id === 'bed') {
    b.add('box', H.bedWood, [cx, y + 0.12, cz], [0.86, 0.24, 1.8]);
    b.add('box', H.bedWood, [cx, y + 0.35, z0 + 0.06], [0.9, 0.7, 0.1]); // the headboard
    b.add('box', H.pillow, [cx, y + 0.3, cz], [0.78, 0.12, 1.7]);
    b.add('box', H.blanket, [cx, y + 0.33, cz + 0.25], [0.82, 0.1, 1.2]);
    b.add('box', H.rugEdge, [cx, y + 0.385, cz - 0.33], [0.82, 0.02, 0.08]);
    b.add('box', H.pillow, [cx, y + 0.42, z0 + 0.32], [0.6, 0.1, 0.32]);
    return;
  }
  if (f.id === 'radio') {
    const P = PALETTE.radio;
    b.add('box', H.desk, [cx, y + 0.3, cz], [0.7, 0.06, 0.5]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.add('box', H.desk, [cx + sx * 0.3, y + 0.14, cz + sz * 0.2], [0.05, 0.28, 0.05]);
    b.add('box', P.body, [cx, y + 0.46, cz], [0.46, 0.26, 0.24]);
    b.add('box', P.grille, [cx - 0.09, y + 0.46, cz + 0.125], [0.16, 0.16, 0.01]);
    b.add('box', P.dial, [cx + 0.12, y + 0.48, cz + 0.125], [0.1, 0.1, 0.01], 0.9);
    return;
  }
  if (f.id === 'chest') {
    b.add('box', H.plank, [cx, y + 0.22, cz], [0.8, 0.44, 0.6]);
    b.add('box', H.plankLight, [cx, y + 0.47, cz], [0.84, 0.08, 0.64]);
    for (const k of [-0.25, 0.25]) b.add('box', H.chestBand, [cx + k, y + 0.25, cz], [0.06, 0.5, 0.66]);
    b.add('box', PALETTE.trim.gold, [cx, y + 0.38, cz + 0.33], [0.1, 0.1, 0.03]);
    return;
  }
  if (f.id === 'shelf') {
    // against the east wall, the keepsakes found so far along its boards
    const wx = x0 + f.w - 0.2;
    for (const yy of [0.05, 0.55, 1.05, 1.55]) b.add('box', H.shelf, [wx, y + yy, cz], [0.36, 0.05, f.d - 0.1]);
    for (const k of [z0 + 0.06, z0 + f.d - 0.06]) b.add('box', H.shelf, [wx, y + 0.8, k], [0.36, 1.6, 0.05]);
    for (let i = 0; i < keepsakes; i++) {
      const row = Math.floor(i / 4);
      const k = i % 4;
      b.add(i % 3 === 0 ? 'sphere' : i % 3 === 1 ? 'cylinder' : 'box', [H.brick, H.glass, PALETTE.trim.gold, H.door, H.rugEdge][i % 5], [wx, y + 0.17 + row * 0.5, z0 + 0.3 + k * ((f.d - 0.6) / 3)], [0.16, 0.2, 0.16]);
    }
    return;
  }
  if (f.id === 'stove') {
    // #858: an iron range against the back wall: an oven with a glowing fire window, two hobs and a kettle, its flue
    const bz = z0 + 0.36;
    tbox(b, 'tiles', H.tileWhite, [cx, y + 0.9, z0 + 0.03], [0.96, 0.9, 0.04]); // tiles behind it
    b.add('box', H.iron, [cx, y + 0.4, bz], [0.8, 0.8, 0.6]);
    b.add('box', H.ironDark, [cx, y + 0.81, bz], [0.84, 0.04, 0.64]);
    b.add('box', H.ironDark, [cx - 0.16, y + 0.35, bz + 0.305], [0.36, 0.4, 0.02]); // the oven door
    b.add('box', PALETTE.trim.gold, [cx - 0.16, y + 0.58, bz + 0.33], [0.26, 0.025, 0.03]);
    b.add('box', H.fire, [cx + 0.2, y + 0.3, bz + 0.31], [0.2, 0.14, 0.02], 0.9); // the fire's window
    for (const s of [-1, 1]) b.add('cylinder', H.ironDark, [cx + s * 0.2, y + 0.84, bz + 0.05], [0.24, 0.02, 0.24]);
    b.add('sphere', H.copper, [cx - 0.2, y + 0.95, bz + 0.05], [0.2, 0.16, 0.2]); // the kettle
    b.add('box', H.copper, [cx - 0.2, y + 1.05, bz + 0.05], [0.04, 0.06, 0.04]);
    b.add('cylinder', H.ironDark, [cx + 0.25, y + 1.45, z0 + 0.12], [0.12, 1.2, 0.12]); // the flue
    return;
  }
  if (f.id === 'counter') {
    // #858: cupboards along the back wall, a wooden top with a board, jars and a bowl of vegetables
    const bz = z0 + 0.33;
    tbox(b, 'tiles', H.tileWhite, [cx, y + 1.0, z0 + 0.03], [f.w - 0.04, 0.45, 0.04]); // tiles behind it
    tbox(b, 'wood', H.plank, [cx, y + 0.38, bz], [f.w - 0.08, 0.76, 0.56]);
    tbox(b, 'wood', H.plankLight, [cx, y + 0.79, bz + 0.02], [f.w - 0.02, 0.06, 0.64]);
    for (let i = 0; i < 2 * f.w; i++) {
      const dx = x0 + 0.04 + ((f.w - 0.08) * (i + 0.5)) / (2 * f.w);
      tbox(b, 'wood', H.plankDark, [dx, y + 0.4, bz + 0.285], [(f.w - 0.08) / (2 * f.w) - 0.05, 0.62, 0.02]); // the doors
      b.add('sphere', PALETTE.trim.gold, [dx + 0.12 * (i % 2 ? -1 : 1), y + 0.62, bz + 0.31], 0.025);
    }
    tbox(b, 'wood', H.desk, [x0 + 0.45, y + 0.83, bz + 0.05], [0.42, 0.03, 0.3]); // the chopping board
    for (let i = 0; i < 3; i++) b.add('cylinder', [H.glass, H.copper, H.paper][i], [x0 + f.w - 0.25 - i * 0.16, y + 0.9, z0 + 0.15], [0.11, 0.18, 0.11]);
    b.add('cylinder', H.plaster, [cx + 0.15, y + 0.86, bz + 0.08], [0.32, 0.08, 0.32]); // the bowl
    for (const [k, c] of [[-0.06, H.brick], [0.06, PALETTE.leaf.mid], [0, H.veg]] as [number, string][]) b.add('sphere', c, [cx + 0.15 + k, y + 0.92, bz + 0.08 + (k ? 0 : 0.06)], 0.06);
    return;
  }
  if (f.id === 'table') {
    // #858: a table for two squares by two under a gingham cloth, a chair at each corner, a jug of flowers, two plates
    tbox(b, 'wood', H.bedWood, [cx, y + 0.62, cz], [1.3, 0.06, 0.8]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tbox(b, 'wood', H.bedWood, [cx + sx * 0.58, y + 0.3, cz + sz * 0.32], [0.06, 0.6, 0.06]);
    tbox(b, 'cloth', H.cloth, [cx, y + 0.656, cz], [1.1, 0.012, 0.9]); // the cloth, hanging a little over the long sides
    for (const s of [-1, 1]) tbox(b, 'cloth', H.cloth, [cx, y + 0.6, cz + s * 0.452], [1.1, 0.12, 0.012]);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const chx = cx + sx * 0.35;
        const chz = cz + sz * 0.62;
        tbox(b, 'wood', H.desk, [chx, y + 0.36, chz], [0.36, 0.05, 0.34]);
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tbox(b, 'wood', H.desk, [chx + lx * 0.15, y + 0.17, chz + lz * 0.14], [0.04, 0.34, 0.04]);
        tbox(b, 'wood', H.desk, [chx, y + 0.6, chz + sz * 0.16], [0.36, 0.44, 0.04]); // the back, away from the table
      }
    b.add('cylinder', H.glass, [cx, y + 0.743, cz], [0.12, 0.16, 0.12]);
    for (let i = 0; i < 3; i++) b.add('sphere', FLOWERS[i % FLOWERS.length], [cx + (i - 1) * 0.05, y + 0.86, cz + (i % 2) * 0.04], 0.05);
    for (const s of [-1, 1]) b.add('cylinder', H.pillow, [cx + s * 0.35, y + 0.67, cz + s * 0.2], [0.24, 0.015, 0.24]);
    return;
  }
  if (f.id === 'fireplace') {
    // #859: a brick chimney breast against the west wall, its firebox open to the room with logs burning in it, a
    // wooden mantel with two candles and a jar on it, and a stone hearth in front (FIREPLACE: where the fire's light
    // and Bloombot's seat go)
    const F = FIREPLACE;
    const bx = x0 + F.depth / 2;
    const half = F.wide / 2;
    const jamb = half - F.mouth / 2;
    for (const s of [-1, 1]) tbox(b, 'brick', H.brick, [bx, y + F.mouthTop / 2, cz + s * (half - jamb / 2)], [F.depth, F.mouthTop, jamb]); // the jambs
    tbox(b, 'brick', H.brick, [bx, y + (F.mouthTop + HOUSE_INSIDE.wall) / 2, cz], [F.depth, HOUSE_INSIDE.wall - F.mouthTop, F.wide]); // the breast above
    b.add('box', H.soot, [x0 + F.back / 2, y + F.mouthTop / 2, cz], [F.back, F.mouthTop, F.mouth]); // the firebox's sooty back
    for (const s of [-1, 1]) b.add('box', H.soot, [bx + F.back / 2, y + F.mouthTop / 2, cz + s * (F.mouth / 2 - 0.01)], [F.depth - F.back, F.mouthTop, 0.02]);
    b.add('box', H.soot, [bx + F.back / 2, y + F.mouthTop - 0.01, cz], [F.depth - F.back, 0.02, F.mouth]);
    tbox(b, 'hearth', H.hearth, [x0 + F.hearth / 2, y + 0.03, cz], [F.hearth, 0.06, F.wide + 0.2]); // the hearth stone
    tbox(b, 'wood', H.beam, [x0 + F.depth + 0.06, y + F.mouthTop + 0.12, cz], [0.2, 0.08, F.wide + 0.16]); // the mantel
    // the fire: two logs across the grate (the coals glowing under them and the flames rising off them are drawn in
    // their own light, so the room's moonlight never greys them: HouseInterior, drawCoals and drawFlameTongue)
    const fx = fireX(x0);
    for (const s of [-1, 1]) b.add('box', H.beam, [fx, y + 0.12 + (s > 0 ? 0.07 : 0), cz + s * 0.06], [0.11, 0.09, F.mouth - 0.2]);
    // on the mantel: two candles and a jar
    for (const s of [-1, 1]) {
      b.add('cylinder', H.pillow, [x0 + F.depth + 0.06, y + F.mouthTop + 0.24, cz + s * 0.6], [0.05, 0.16, 0.05]);
      b.add('cone', H.flame, [x0 + F.depth + 0.06, y + F.mouthTop + 0.35, cz + s * 0.6], [0.03, 0.06, 0.03], FIRE_GLOW.candle);
    }
    b.add('cylinder', H.copper, [x0 + F.depth + 0.06, y + F.mouthTop + 0.24, cz - 0.15], [0.12, 0.16, 0.12]);
    return;
  }
  if (f.id === 'nook') {
    // #859: the reading nook in the room's south-east corner: a low bookcase full of books against the east wall, under
    // the window (NOOK_SHELF: its top below the sill), an armchair turned to the fire, and a standing lamp at its
    // shoulder
    const P = PALETTE.furnish;
    const wx = x0 + f.w - 0.2;
    const top = NOOK_SHELF;
    for (const yy of [0.05, top / 2, top - 0.025]) tbox(b, 'wood', H.shelf, [wx, y + yy, cz], [0.36, 0.05, f.d - 0.1]);
    for (const k of [z0 + 0.06, z0 + f.d - 0.06]) tbox(b, 'wood', H.shelf, [wx, y + top / 2, k], [0.36, top, 0.05]);
    let seed = 859;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const row of [0.075, top / 2 + 0.025]) {
      let z = z0 + 0.12;
      let i = 0;
      while (z < z0 + f.d - 0.2) {
        const t = 0.05 + rnd() * 0.05;
        const h = 0.24 + rnd() * 0.12;
        if (rnd() < 0.08) {
          z += 0.12; // a gap on the shelf
          continue;
        }
        b.add('box', H.book[i++ % H.book.length], [wx - 0.02, y + row + h / 2, z + t / 2], [0.28, h, t]);
        z += t + 0.005;
      }
    }
    // the armchair, turned west across the room to the fire: a seat with a cushion, a high back, two rolled arms,
    // short feet; its rug lies in front of it (houseRugs)
    const ax = x0 + 0.7;
    const az = z0 + 1.05;
    b.add('box', P.fabric, [ax, y + 0.28, az], [0.7, 0.26, 0.78]);
    b.add('box', P.cushion, [ax - 0.04, y + 0.44, az], [0.56, 0.08, 0.6]);
    b.add('box', P.fabric, [ax + 0.3, y + 0.66, az], [0.16, 0.82, 0.78]);
    b.add('box', P.fabricDark, [ax + 0.3, y + 1.08, az], [0.12, 0.04, 0.7]);
    for (const s of [-1, 1]) {
      b.add('box', P.fabricDark, [ax, y + 0.45, az + s * 0.33], [0.7, 0.3, 0.14]);
      b.add('cylinder', P.fabric, [ax - 0.02, y + 0.6, az + s * 0.33], [0.66, 0.04, 0.15]);
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tbox(b, 'wood', H.plankDark, [ax + sx * 0.28, y + 0.07, az + sz * 0.32], [0.06, 0.14, 0.06]);
    b.add('box', H.book[1], [ax - 0.12, y + 0.5, az + 0.1], [0.26, 0.04, 0.2]); // a book left open on the cushion
    b.add('box', H.paper, [ax - 0.12, y + 0.525, az + 0.1], [0.24, 0.01, 0.18]);
    // the standing lamp at the chair's shoulder, its bulb lit under the shade (NOOK_LAMP: where its light hangs)
    const [lx, , lz] = NOOK_LAMP;
    b.add('cylinder', H.ironDark, [x0 + lx, y + 0.02, z0 + lz], [0.26, 0.04, 0.26]);
    b.add('cylinder', P.brass, [x0 + lx, y + 0.72, z0 + lz], [0.03, 1.4, 0.03]);
    b.add('cylinder', P.shade, [x0 + lx, y + 1.45, z0 + lz], [0.36, 0.26, 0.36], 0.5);
    b.add('sphere', H.lamp, [x0 + lx, y + 1.36, z0 + lz], 0.09, 1);
    return;
  }
  // the journal desk: a table, an open book, a pen and a lamp
  b.add('box', H.desk, [cx, y + 0.42, cz], [0.62, 0.06, 0.8]);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.add('box', H.desk, [cx + sx * 0.26, y + 0.2, cz + sz * 0.34], [0.05, 0.4, 0.05]);
  b.add('box', H.paper, [cx + 0.02, y + 0.46, cz], [0.32, 0.02, 0.42]);
  b.add('box', H.book[0], [cx + 0.02, y + 0.455, cz], [0.34, 0.015, 0.02]);
  b.add('box', H.book[1], [cx - 0.18, y + 0.5, cz - 0.28], [0.18, 0.1, 0.12]);
  b.add('cylinder', H.beam, [cx - 0.18, y + 0.56, cz + 0.3], [0.02, 0.22, 0.02]);
  b.add('sphere', H.lamp, [cx - 0.18, y + 0.68, cz + 0.3], 0.08, 0.9);
}

/** The room: what the inside drawing needs from the game. */
export interface RoomPlan {
  /** world position of the room's north-west cell corner, at the floor's top */
  origin: V3;
  room: number;
  wall: number;
  level: number;
  door: [number, number];
  furniture: HouseFurniture[];
  /** #860: the inner walls (drawn apart, by HouseInterior, so the camera can see over them; their skirting is here) */
  walls: HouseWall[];
  /** #861: the rooms (the main room first), for each room's lamp */
  rooms: HouseRoom[];
  /** keepsakes found (stand on the shelf) */
  keepsakes: number;
  /** the floorboards' variety, per cell (stable) */
  variant: (x: number, z: number) => number;
}

/**
 * #782: the inside of the house: warm floorboards, three tall walls (north, west and east) and a low south wall cut
 * away for the camera with the door in it, windows glowing on the north wall, a rug, and the furniture of its level.
 * Round it, a lawn as far as the camera sees, so the room sits in its own garden.
 */
export function drawRoom(b: HouseSink, p: RoomPlan) {
  const [ox, y, oz] = p.origin;
  const R = p.room;
  // the lawn round it, a step below the floor, edged
  b.add('box', H.apron, [ox + R / 2, y - 0.3, oz + R / 2], [R + 30, 0.4, R + 30]);
  b.add('box', H.apronEdge, [ox + R / 2, y - 0.08, oz + R / 2], [R + 0.9, 0.1, R + 0.9]);
  // the floor: a board per cell, a little different each, with a gap between them
  b.add('box', H.floorGap, [ox + R / 2, y - 0.06, oz + R / 2], [R, 0.1, R]);
  for (let z = 0; z < R; z++)
    for (let x = 0; x < R; x++) {
      const v = p.variant(x, z);
      b.add('box', H.floor[v % H.floor.length], [ox + x + 0.5, y - 0.03, oz + z + 0.5], [0.98, 0.06, 0.96]);
      b.add('box', H.floorGap, [ox + x + 0.5, y + 0.001, oz + z + 0.5 + ((v >> 3) % 2 ? 0.2 : -0.2)], [0.98, 0.004, 0.02]);
    }
  // the walls: tall at the back and the sides, low at the front so the camera looks in
  const T = 0.18;
  const tall = p.wall;
  b.add('box', H.wallIn, [ox + R / 2, y + tall / 2, oz - T / 2], [R + 2 * T, tall, T]);
  for (const s of [-1, 1]) b.add('box', s < 0 ? H.wallIn : H.wallInShade, [ox + (s < 0 ? -T / 2 : R + T / 2), y + tall / 2, oz + R / 2], [T, tall, R + T]);
  for (const [x, z, w, d] of [[ox + R / 2, oz + 0.015, R, 0.03], [ox + 0.015, oz + R / 2, 0.03, R], [ox + R - 0.015, oz + R / 2, 0.03, R]] as [number, number, number, number][]) tbox(b, 'wood', H.skirting, [x, y + 0.06, z], [w, 0.12, d]);
  // #861: a wall plate along the top of each tall wall, and the ends of the ceiling's joists along the back
  tbox(b, 'wood', H.beam, [ox + R / 2, y + tall - 0.08, oz + 0.03], [R, 0.12, 0.06]);
  for (const s of [0, R]) tbox(b, 'wood', H.beam, [ox + s + (s ? -0.03 : 0.03), y + tall - 0.08, oz + R / 2], [0.06, 0.12, R]);
  for (let k = 0.75; k < R; k += 1.5) tbox(b, 'wood', H.beam, [ox + k, y + tall - 0.2, oz + 0.08], [0.1, 0.12, 0.16]);
  const [dx] = p.door;
  const low = 0.45;
  if (dx > 0) b.add('box', H.wallIn, [ox + dx / 2 - T / 2, y + low / 2, oz + R + T / 2], [dx + T, low, T]);
  if (dx + 1 < R) b.add('box', H.wallIn, [ox + (dx + 1 + R) / 2 + T / 2, y + low / 2, oz + R + T / 2], [R - dx - 1 + T, low, T]);
  for (const k of [dx, dx + 1]) tbox(b, 'wood', H.beam, [ox + k, y + 0.5, oz + R + T / 2], [0.1, 1.0, T + 0.04]); // the door's posts
  // #861: skirting along the low front wall too, each side of the door
  if (dx > 0) tbox(b, 'wood', H.skirting, [ox + dx / 2, y + 0.06, oz + R - 0.015], [dx, 0.12, 0.03]);
  if (dx + 1 < R) tbox(b, 'wood', H.skirting, [ox + (dx + 1 + R) / 2, y + 0.06, oz + R - 0.015], [R - dx - 1, 0.12, 0.03]);
  // #861: a coir doormat inside the door, a dark band at each end (no higher than the rugs: below DecorArt's RUG.base)
  tbox(b, 'coir', H.doormat, [ox + dx + 0.5, y + 0.007, oz + R - 0.42], [0.82, 0.014, 0.56]);
  for (const s of [-1, 1]) tbox(b, 'coir', H.doormatDark, [ox + dx + 0.5, y + 0.008, oz + R - 0.42 + s * 0.22], [0.82, 0.014, 0.06]);
  // windows, glowing with the day outside (#861: more of them as the room widens)
  for (const w of windowSpots(p)) {
    if (w.axis === 'z') roomWindow(b, 'z', ox + w.along, y, oz + w.at, 1);
    else roomWindow(b, 'x', ox + w.at, y, oz + w.along, w.at === 0 ? 1 : -1);
  }
  // #861: the room's rugs, more as it grows (data/oldcity houseRugs; all below DecorArt's RUG.base)
  const RUGS = { red: H.rug, blue: H.rugBlue, green: H.rugGreen };
  for (const r of houseRugs(p.level)) {
    tbox(b, 'weave', H.rugEdge, [ox + r.x, y + 0.004, oz + r.z], [r.w, 0.008, r.d]);
    tbox(b, 'weave', RUGS[r.colour], [ox + r.x, y + 0.008, oz + r.z], [r.w - 0.2, 0.01, r.d - 0.2]);
  }
  // a lamp on the back wall, warm (the room's light, HouseInterior, hangs unseen over the rug); #861: one in each room,
  // the main room's moved out of the kitchen's corner once there is a kitchen
  const lamps: [number, number][] = [[p.rooms.some((r) => r.id === 'kitchen') ? 4.6 : 0.6, 0.05]];
  for (const r of p.rooms.slice(1)) lamps.push([r.x + r.w - 0.5, r.z + 0.05]);
  for (const [lx, lz] of lamps) {
    tbox(b, 'wood', H.beam, [ox + lx, y + 1.75, oz + lz], [0.12, 0.2, 0.08]);
    b.add('sphere', H.lamp, [ox + lx, y + 1.9, oz + lz + 0.07], 0.1, 1);
  }
  // #860: skirting along both faces of each inner wall (the walls themselves are drawn apart: they sink for the camera)
  for (const w of p.walls)
    for (const piece of innerWallPieces(w)) {
      if (piece.lintel) continue;
      const [x0, z0, x1, z1] = piece.line;
      for (const side of [-1, 1]) {
        const off = side * (INNER_WALL.thick / 2 + 0.015);
        if (w.axis === 'x') tbox(b, 'wood', H.skirting, [ox + (x0 + x1) / 2, y + 0.06, oz + z0 + off], [x1 - x0, 0.12, 0.03]);
        else tbox(b, 'wood', H.skirting, [ox + x0 + off, y + 0.06, oz + (z0 + z1) / 2], [0.03, 0.12, z1 - z0]);
      }
    }
  for (const f of p.furniture) furniture(b, f, [ox, y, oz], y, p.keepsakes);
}

/** #861: the pieces too tall for a window above them (a window there is left out). */
const TALL = new Set<string>(['shelf', 'fireplace']);

/** One window on a wall's inner face: the north wall (`axis` 'z', facing south) or a side wall (facing `inward`). */
function roomWindow(b: HouseSink, axis: 'z' | 'x', x: number, y: number, z: number, inward: number) {
  if (axis === 'z') {
    b.add('box', H.trim, [x, y + 1.3, z + 0.02], [0.8, 0.7, 0.04]);
    b.add('box', H.glass, [x, y + 1.3, z + 0.04], [0.68, 0.58, 0.02], 0.6);
    b.add('box', H.trim, [x, y + 1.3, z + 0.05], [0.03, 0.58, 0.02]);
    b.add('box', H.trim, [x, y + 0.93, z + 0.07], [0.88, 0.04, 0.12]); // the sill
    return;
  }
  b.add('box', H.trim, [x + inward * 0.02, y + 1.3, z], [0.04, 0.7, 0.8]);
  b.add('box', H.glass, [x + inward * 0.04, y + 1.3, z], [0.02, 0.58, 0.68], 0.6);
  b.add('box', H.trim, [x + inward * 0.05, y + 1.3, z], [0.02, 0.58, 0.03]);
  b.add('box', H.trim, [x + inward * 0.07, y + 0.93, z], [0.12, 0.04, 0.88]);
}

/**
 * #861: the room's windows, more as it widens. Along the back wall each room's stretch has its own (one every three
 * squares or so), none behind the radio; from the Cottage on, the side walls have them too (one every four squares),
 * clear of where an inner wall meets them and of anything tall against them. `along` is in cells along the wall.
 */
export function windowSpots(p: Pick<RoomPlan, 'room' | 'level' | 'furniture' | 'walls'>): { axis: 'z' | 'x'; at: number; along: number }[] {
  const R = p.room;
  const out: { axis: 'z' | 'x'; at: number; along: number }[] = [];
  const cuts = [0, ...p.walls.filter((w) => w.axis === 'z' && w.from === 0).map((w) => w.at), R].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, c] = [cuts[i], cuts[i + 1]];
    const n = Math.max(1, Math.floor((c - a) / 3));
    for (let k = 0; k < n; k++) {
      const wx = a + ((c - a) * (k + 0.5)) / n;
      if (p.furniture.some((f) => f.z === 0 && wx >= f.x - 0.2 && wx <= f.x + f.w + 0.2 && (f.id === 'radio' || TALL.has(f.id)))) continue;
      out.push({ axis: 'z', at: 0, along: wx });
    }
  }
  if (p.level < 2) return out;
  for (const side of [0, R]) {
    const n = Math.floor(R / 4);
    const joins = p.walls.filter((w) => w.axis === 'x' && (side === 0 ? w.from === 0 : w.to === R)).map((w) => w.at);
    const col = side === 0 ? 0 : R - 1;
    for (let k = 0; k < n; k++) {
      const wz = (R * (k + 0.5)) / n;
      if (joins.some((j) => Math.abs(j - wz) < 0.6)) continue;
      if (p.furniture.some((f) => TALL.has(f.id) && col >= f.x && col < f.x + f.w && wz >= f.z - 0.2 && wz <= f.z + f.d + 0.2)) continue;
      out.push({ axis: 'x', at: side, along: wz });
    }
  }
  return out;
}

/**
 * #861: the ceiling's beams, across the room from the west wall to the east one (more as it grows: one in the
 * Cottage, two in the House, three in the Home). They hang at the walls' tops, so the camera sees past them: like an
 * inner wall, one between the camera and Bloombot is put out of sight (HouseInterior).
 */
export function ceilingBeams(level: number, room: number): InnerWallPiece[] {
  const n = Math.max(0, level - 1);
  return Array.from({ length: n }, (_, i) => {
    const z = Math.round(((room * (i + 1)) / (n + 1)) * 2) / 2 + 0.25;
    return { line: [0, z, room, z] as [number, number, number, number], beam: true };
  });
}

/** #861: a ceiling beam, drawn at its height (just under the walls' top). */
export function drawCeilingBeam(b: HouseSink, piece: InnerWallPiece, o: V3) {
  const [x0, z0, x1] = piece.line;
  tbox(b, 'wood', H.beam, [o[0] + (x0 + x1) / 2, o[1] + HOUSE_INSIDE.wall - 0.1, o[2] + z0], [x1 - x0, 0.16, 0.14]);
}

/** #860: the inner walls' size: thinner than the outer ones; a doorway's top (the lintel) and how low a wall sinks. */
export const INNER_WALL = { thick: 0.12, doorTop: 1.55, low: 0.45 };

/**
 * #860: one stretch of an inner wall, on the room's cells' edges (`line`: from x0, z0 to x1, z1, in cells from the
 * room's north-west corner). A wall is cut at its doorway: a stretch each side, and the lintel over the gap.
 */
export interface InnerWallPiece {
  line: [number, number, number, number];
  /** the beam over the doorway (shown only while the wall stands tall) */
  lintel?: boolean;
  /** #861: a ceiling beam (shown only while it isn't between the camera and Bloombot) */
  beam?: boolean;
}

/** #860: an inner wall's stretches: each side of its doorway, and the lintel over it. */
export function innerWallPieces(w: HouseWall): InnerWallPiece[] {
  const line = (a: number, c: number): [number, number, number, number] => (w.axis === 'x' ? [a, w.at, c, w.at] : [w.at, a, w.at, c]);
  if (w.door === undefined) return [{ line: line(w.from, w.to) }];
  const out: InnerWallPiece[] = [];
  if (w.door > w.from) out.push({ line: line(w.from, w.door) });
  if (w.door + 1 < w.to) out.push({ line: line(w.door + 1, w.to) });
  out.push({ line: line(w.door, w.door + 1), lintel: true });
  return out;
}

/**
 * #860: a stretch of inner wall, drawn one unit high from the floor (the caller stretches it to its height): plaster
 * faces, a post at each end. A lintel is drawn at its own height, a beam over the doorway.
 */
export function drawInnerWall(b: HouseSink, piece: InnerWallPiece, o: V3) {
  const [x0, z0, x1, z1] = piece.line;
  const alongX = z0 === z1;
  const cx = o[0] + (x0 + x1) / 2;
  const cz = o[2] + (z0 + z1) / 2;
  const len = alongX ? x1 - x0 : z1 - z0;
  const T = INNER_WALL.thick;
  const size = (l: number, h: number, t: number): V3 => (alongX ? [l, h, t] : [t, h, l]);
  if (piece.lintel) {
    const h = HOUSE_INSIDE.wall - INNER_WALL.doorTop;
    b.add('box', H.wallIn, [cx, o[1] + INNER_WALL.doorTop + h / 2, cz], size(len, h, T));
    tbox(b, 'wood', H.beam, [cx, o[1] + INNER_WALL.doorTop + 0.04, cz], size(len + 0.1, 0.08, T + 0.04));
    return;
  }
  b.add('box', H.wallIn, [cx, o[1] + 0.5, cz], size(len, 1, T));
  // a post at each end (the doorway's frame, or where it meets the outer wall)
  for (const e of [0, 1]) {
    const px = o[0] + (alongX ? (e ? x1 - 0.04 : x0 + 0.04) : x0);
    const pz = o[2] + (alongX ? z0 : e ? z1 - 0.04 : z0 + 0.04);
    tbox(b, 'wood', H.beam, [px, o[1] + 0.5, pz], alongX ? [0.08, 1, T + 0.04] : [T + 0.04, 1, 0.08]);
  }
}

/** #860: the cap along an inner wall's top, drawn at y = 0 (the caller lifts it to the wall's height). */
export function drawInnerWallCap(b: HouseSink, piece: InnerWallPiece, o: V3) {
  const [x0, z0, x1, z1] = piece.line;
  const alongX = z0 === z1;
  const len = (alongX ? x1 - x0 : z1 - z0) + 0.04;
  tbox(b, 'wood', H.beam, [o[0] + (x0 + x1) / 2, o[1] + 0.03, o[2] + (z0 + z1) / 2], alongX ? [len, 0.06, INNER_WALL.thick + 0.05] : [INNER_WALL.thick + 0.05, 0.06, len]);
}

/**
 * #860: does a stretch of inner wall sink low for the camera? When it stands between the camera and Bloombot: on the
 * camera's side of it (nearer the camera by more than a little) and facing the camera rather than running toward it
 * (a wall seen end-on hides nothing). Points in the room's cells, `bot` where Bloombot stands and `cam` where the
 * camera is (seen from above).
 */
export function wallSinks(piece: InnerWallPiece, bot: [number, number], cam: [number, number]): boolean {
  const [x0, z0, x1, z1] = piece.line;
  let fx = bot[0] - cam[0];
  let fz = bot[1] - cam[1];
  const fl = Math.hypot(fx, fz);
  if (fl < 1e-6) return false; // straight overhead: nothing stands between
  fx /= fl;
  fz /= fl;
  const ux = x1 - x0;
  const uz = z1 - z0;
  const ul = Math.hypot(ux, uz) || 1;
  if (Math.abs((ux * fx + uz * fz) / ul) > 0.75) return false;
  // how much nearer the camera the wall is than Bloombot: its nearest end counts
  const nearer = (px: number, pz: number) => -((px - bot[0]) * fx + (pz - bot[1]) * fz);
  return Math.max(nearer(x0, z0), nearer(x1, z1)) > 0.2 && nearer((x0 + x1) / 2, (z0 + z1) / 2) > -0.5;
}
