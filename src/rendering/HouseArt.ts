import type { HouseFurniture } from '../data/oldcity';
import { PALETTE } from './Palette';
import type { VPrim } from './Shapes';

type V3 = [number, number, number];

/**
 * #782: what the house is drawn into: the chunk's vertex-coloured mesh (primitives, and triangles for the roofs'
 * slopes when the sink has them; a stepped roof otherwise).
 */
export interface HouseSink {
  add(type: VPrim, hex: string, p: V3, s: V3 | number, glow?: number): void;
  tri?(hex: string, a: V3, b: V3, c: V3, n: V3): void;
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
  for (const [x, z, w, d] of [[ox + R / 2, oz + 0.015, R, 0.03], [ox + 0.015, oz + R / 2, 0.03, R], [ox + R - 0.015, oz + R / 2, 0.03, R]] as [number, number, number, number][]) b.add('box', H.skirting, [x, y + 0.06, z], [w, 0.12, d]);
  b.add('box', H.beam, [ox + R / 2, y + tall - 0.08, oz + 0.03], [R, 0.12, 0.06]);
  const [dx] = p.door;
  const low = 0.45;
  if (dx > 0) b.add('box', H.wallIn, [ox + dx / 2 - T / 2, y + low / 2, oz + R + T / 2], [dx + T, low, T]);
  if (dx + 1 < R) b.add('box', H.wallIn, [ox + (dx + 1 + R) / 2 + T / 2, y + low / 2, oz + R + T / 2], [R - dx - 1 + T, low, T]);
  for (const k of [dx, dx + 1]) b.add('box', H.beam, [ox + k, y + 0.5, oz + R + T / 2], [0.1, 1.0, T + 0.04]); // the door's posts
  b.add('box', H.rugEdge, [ox + dx + 0.5, y + 0.005, oz + R - 0.5], [0.8, 0.01, 0.6]); // the mat at the door
  b.add('box', H.rug, [ox + dx + 0.5, y + 0.01, oz + R - 0.5], [0.7, 0.012, 0.5]);
  // windows along the back wall, glowing with the day outside
  const n = Math.max(1, Math.floor(R / 3));
  for (let i = 0; i < n; i++) {
    const wx = ox + (R * (i + 0.5)) / n;
    if (p.furniture.some((f) => f.z === 0 && wx >= ox + f.x - 0.2 && wx <= ox + f.x + f.w + 0.2 && f.id === 'radio')) continue;
    b.add('box', H.trim, [wx, y + 1.3, oz + 0.02], [0.8, 0.7, 0.04]);
    b.add('box', H.glass, [wx, y + 1.3, oz + 0.04], [0.68, 0.58, 0.02], 0.6);
    b.add('box', H.trim, [wx, y + 1.3, oz + 0.05], [0.03, 0.58, 0.02]);
  }
  // a rug in the middle of the room
  b.add('box', H.rugEdge, [ox + R / 2, y + 0.004, oz + R / 2 + 0.3], [Math.min(3.2, R - 3), 0.008, Math.min(2.2, R - 3.5)]);
  b.add('box', H.rug, [ox + R / 2, y + 0.008, oz + R / 2 + 0.3], [Math.min(3.0, R - 3.2), 0.01, Math.min(2.0, R - 3.7)]);
  // a lamp hanging from a beam over the rug, warm
  b.add('cylinder', H.beam, [ox + R / 2, y + tall - 0.1, oz + R / 2], [0.02, 0.2, 0.02]);
  b.add('sphere', H.lamp, [ox + R / 2, y + tall - 0.28, oz + R / 2], 0.14, 1);
  for (const f of p.furniture) furniture(b, f, [ox, y, oz], y, p.keepsakes);
}
