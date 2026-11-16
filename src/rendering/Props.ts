/**
 * Look 3: hard-surface templates — bevelled boxes (3.15), cracked paving slabs (3.2), stone planters (3.9),
 * railings, balustrades and parapets (3.10) and the edge-clutter kit (3.11).
 *
 * Pure geometry in the tree template format (flex 0: these don't sway), stamped into the chunk's merged
 * vertex-coloured ground mesh (`MeshBuilder.addGeo`), so they cost no extra draw calls. Each template is built
 * once per (kind, state, variant) and cached.
 *
 * Meshy hook (docs/art/meshy-assets.md): the clutter kit and planters are the candidates for generated models.
 * When one exists, load it the way the drone does (`loadDroneModel` in DroneVisuals.ts → `assets/models/*.glb`
 * through the asset registry), flatten its meshes into a `TreeGeo` (positions, normals, baked vertex colours)
 * and return it from the cache below in place of the procedural build; placement stays the same.
 */
import { Buf, puff, tube, plate, hex, mix, scaleC, add, norm, rng, type TreeGeo, type Lod, type V, type C } from './TreeGen';
import { card } from './TreeGen';

// ───────────── bevelled box (3.15) ─────────────

export interface BoxOpts {
  /** colour of faces pointing up */
  top?: C;
  /** skip the bottom face (things that sit on the ground) */
  noBottom?: boolean;
  /** chip this top corner (0..3: −x−z, +x−z, −x+z, +x+z) down by `chipD` */
  chip?: number;
  chipD?: number;
  /** small rotations in degrees (x tilt, y turn, z tilt) about the centre */
  rot?: V;
}

/**
 * A box with rounded (smooth-normal) edges: each face is a 3×3 grid whose outer ring folds into a bevel of
 * radius `r`. 108 triangles (90 without a bottom), so hero props read soft without many vertices.
 */
export function bevelBox(B: Buf, c: V, h: V, r: number, col: C, o: BoxOpts = {}) {
  r = Math.min(r, h[0] * 0.9, h[1] * 0.9, h[2] * 0.9);
  const rx = ((o.rot?.[0] ?? 0) * Math.PI) / 180, ry = ((o.rot?.[1] ?? 0) * Math.PI) / 180, rz = ((o.rot?.[2] ?? 0) * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const turn = (v: V): V => {
    let [x, y, z] = v;
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    return [x, y, z];
  };
  const coords = (k: number) => [-h[k], -h[k] + r, h[k] - r, h[k]];
  const faces: [number, number, number, number][] = [
    // axis, sign, u axis, v axis
    [0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0],
  ];
  const cs = [-1, 1];
  for (const [ax, sg, ua, va] of faces) {
    if (o.noBottom && ax === 1 && sg < 0) continue;
    const base = B.n;
    const U = coords(ua), Vv = coords(va);
    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 4; i++) {
        const p: V = [0, 0, 0];
        p[ax] = sg * h[ax];
        p[ua] = U[i];
        p[va] = Vv[j];
        const inner: V = [Math.max(-h[0] + r, Math.min(h[0] - r, p[0])), Math.max(-h[1] + r, Math.min(h[1] - r, p[1])), Math.max(-h[2] + r, Math.min(h[2] - r, p[2]))];
        const n = norm([p[0] - inner[0], p[1] - inner[1], p[2] - inner[2]]);
        const q: V = [inner[0] + n[0] * r, inner[1] + n[1] * r, inner[2] + n[2] * r];
        if (o.chip !== undefined && p[1] > 0) {
          const sx2 = cs[o.chip & 1], sz2 = cs[(o.chip >> 1) & 1];
          const d = Math.max(0, 1 - (Math.abs(p[0] - sx2 * h[0]) + Math.abs(p[2] - sz2 * h[2])) / (Math.min(h[0], h[2]) * 0.9));
          q[1] -= d * (o.chipD ?? h[1] * 0.8);
        }
        const tq = turn(q);
        const tn = turn(n);
        const colr = o.top && n[1] > 0.55 ? o.top : n[1] < -0.5 ? scaleC(col, 0.7) : col;
        B.v([c[0] + tq[0], c[1] + tq[1], c[2] + tq[2]], tn, colr, 0);
      }
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) {
        const a = base + j * 4 + i, b = a + 1, d = a + 4, e = d + 1;
        // winding so the face points along +axis*sign
        B.tri(a, b, e);
        B.tri(a, e, d);
      }
  }
}

/** A plain box without a bottom (10 triangles): the far-detail stand-in for a bevelled one. */
export function plainBox(B: Buf, c: V, h: V, col: C, top?: C, rotY = 0) {
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const P = (x: number, y: number, z: number): V => [c[0] + x * cs + z * sn, c[1] + y, c[2] - x * sn + z * cs];
  const N = (x: number, y: number, z: number): V => [x * cs + z * sn, y, -x * sn + z * cs];
  const face = (n: V, a: V, b: V, cc: V, d: V, k: C) => {
    const nn = N(...n);
    const i = B.v(P(...a), nn, k, 0), j = B.v(P(...b), nn, k, 0), l = B.v(P(...cc), nn, k, 0), m = B.v(P(...d), nn, k, 0);
    B.tri(i, j, l);
    B.tri(i, l, m);
  };
  const [x, y, z] = h;
  face([0, 1, 0], [-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z], top ?? col);
  face([0, 0, 1], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], col);
  face([0, 0, -1], [x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], col);
  face([1, 0, 0], [x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], col);
  face([-1, 0, 0], [-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], col);
}

/** A flat strip lying on y (2 triangles), from a to b, w wide: cracks, seams, painted lines. */
export function strip(B: Buf, a: V, b: V, w: number, col: C) {
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const l = Math.hypot(dx, dz) || 1;
  const sx = (-dz / l) * (w / 2), sz = (dx / l) * (w / 2);
  const n: V = [0, 1, 0];
  const i = B.v([a[0] + sx, a[1], a[2] + sz], n, col, 0), j = B.v([a[0] - sx, a[1], a[2] - sz], n, col, 0);
  const k = B.v([b[0] - sx, b[1], b[2] - sz], n, col, 0), m = B.v([b[0] + sx, b[1], b[2] + sz], n, col, 0);
  B.tri(i, k, j);
  B.tri(i, m, k);
}

// ───────────── paving (3.2) ─────────────

/** Slab rectangles (x0, z0, x1, z1 in −0.5…0.5) per layout. */
const LAYOUTS: [number, number, number, number][][] = [
  [[-0.5, -0.5, 0, 0.5], [0, -0.5, 0.5, 0.5]],
  [[-0.5, -0.5, 0.5, 0], [-0.5, 0, 0.5, 0.5]],
  [[-0.5, -0.5, 0, 0], [0, -0.5, 0.5, 0], [-0.5, 0, 0, 0.5], [0, 0, 0.5, 0.5]],
  [[-0.5, -0.5, 0.5, 0], [-0.5, 0, 0, 0.5], [0, 0, 0.5, 0.5]],
  [[-0.5, -0.5, -0.12, 0.5], [-0.12, -0.5, 0.5, 0.12], [-0.12, 0.12, 0.5, 0.5]],
  [[-0.5, -0.5, 0.5, 0.5]],
];
export const PAVING_LAYOUTS = LAYOUTS.length;
/** Points along the gaps of a layout (where weeds or moss grow). */
export function pavingGaps(layout: number): [number, number][] {
  const pts: [number, number][] = [];
  for (const [x0, z0, x1, z1] of LAYOUTS[layout]) {
    if (x1 < 0.49) pts.push([x1, (z0 + z1) / 2]);
    if (z1 < 0.49) pts.push([(x0 + x1) / 2, z1]);
  }
  pts.push([0.49, 0.1], [-0.1, 0.49]); // the tile seams too
  return pts;
}

/**
 * One tile of stone paving: 1–4 bevelled slabs with gaps, height and tilt jitter, chipped corners, the odd
 * missing or broken slab (dead: more), and hairline cracks. Top of the slabs at y = 0.03 (above the tile top).
 */
export function buildPaving(layout: number, variant: number, alive: boolean, shades: string[], lod: Lod): TreeGeo {
  const B = new Buf();
  const R = rng(variant * 2654 + layout * 71 + (alive ? 9 : 0));
  const gap = 0.022;
  const T = 0.05;
  for (const [x0, z0, x1, z1] of LAYOUTS[layout]) {
    const missing = R() < (alive ? 0.02 : 0.1);
    const w = (x1 - x0) / 2 - gap, d = (z1 - z0) / 2 - gap;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (missing) {
      // a hole: a few broken pieces lying in the dirt
      for (let k = 0; k < (lod > 0 ? 3 : 1); k++) plainBox(B, [cx + (R() - 0.5) * w, -0.012, cz + (R() - 0.5) * d], [0.04 + R() * 0.05, 0.015, 0.03 + R() * 0.04], hex(shades[k % shades.length]), undefined, R() * 3);
      continue;
    }
    const col = scaleC(hex(shades[Math.floor(R() * shades.length)]), 0.93 + R() * 0.12);
    const topC = mix(col, [1, 1, 1], alive ? 0.06 : 0);
    const y = 0.03 - T + (R() - 0.5) * 0.012;
    const tilt: V = [(R() - 0.5) * (alive ? 1.2 : 3), 0, (R() - 0.5) * (alive ? 1.2 : 3)];
    const big = w > 0.3 && d > 0.3;
    if (lod === 0) {
      // mid / far zoom: plain slabs, same layout, gaps and height jitter (10 triangles each)
      plainBox(B, [cx, y, cz], [w, T, d], col, topC);
      continue;
    }
    if (big && R() < (alive ? 0.15 : 0.35)) {
      // a broken slab: two pieces split across the middle, one sunk a little
      const along = R() < 0.5;
      const h1: V = along ? [w / 2 - gap / 2, T, d] : [w, T, d / 2 - gap / 2];
      const o1: V = along ? [-w / 2, 0, 0] : [0, 0, -d / 2];
      bevelBox(B, [cx + o1[0], y, cz + o1[2]], h1, 0.012, col, { top: topC, noBottom: true, rot: tilt });
      bevelBox(B, [cx - o1[0], y - 0.01, cz - o1[2]], h1, 0.012, scaleC(col, 0.95), { top: scaleC(topC, 0.95), noBottom: true, rot: [-tilt[0] * 2, 0, -tilt[2] * 2] });
      continue;
    }
    const chip = R() < (alive ? 0.2 : 0.45) ? Math.floor(R() * 4) : undefined;
    bevelBox(B, [cx, y, cz], [w, T, d], 0.014, col, { top: topC, noBottom: true, rot: tilt, chip, chipD: 0.03 });
    // hairline cracks (thin dark strips just above the top), more on dead stone
    if (lod > 0 && R() < (alive ? 0.25 : 0.6)) {
      let px = cx + (R() - 0.5) * w, pz = cz - d * 0.9;
      const crack = scaleC(col, 0.45);
      for (let k = 0; k < 3; k++) {
        const nx = Math.max(cx - w * 0.9, Math.min(cx + w * 0.9, px + (R() - 0.5) * w * 0.7));
        const nz = pz + d * 0.6;
        strip(B, [px, y + T + 0.002, pz], [nx, y + T + 0.002, nz], 0.007, crack);
        px = nx;
        pz = nz;
      }
    }
  }
  return B.done();
}

// ───────────── planters (3.9) ─────────────

const CREAM: C = hex('#ece4d2');
const CREAM_TOP: C = hex('#f7f1e4');
const STONE_DEAD: C = hex('#a49d90');
const SOIL: C = hex('#6f533a');
const SOIL_DRY: C = hex('#9a8466');

/** A raised stone bed `w` × `d` tiles, rim top at y ≈ 0.2; soil inside. Dead: cracked, chipped, dry soil. */
export function buildPlanter(w: number, d: number, alive: boolean, variant: number, lod: Lod): TreeGeo {
  const B = new Buf();
  const R = rng(variant * 991 + Math.round(w * 100) + Math.round(d * 1000) + (alive ? 1 : 0));
  const H = 0.1;
  const t = 0.04;
  const col = alive ? CREAM : STONE_DEAD;
  const top = alive ? CREAM_TOP : scaleC(STONE_DEAD, 1.05);
  const r = lod > 0 ? 0.015 : 0.004;
  const walls: [V, V][] = [
    [[0, H, -d / 2 + t], [w / 2, H, t]],
    [[0, H, d / 2 - t], [w / 2, H, t]],
    [[-w / 2 + t, H, 0], [t, H, d / 2 - 2 * t]],
    [[w / 2 - t, H, 0], [t, H, d / 2 - 2 * t]],
  ];
  walls.forEach(([c, h], i) => bevelBox(B, c, h, r, col, { top, noBottom: true, chip: !alive && i === variant % 4 ? variant % 4 : undefined, chipD: 0.05 }));
  // coping: a slightly wider cap all round (alive only: dead ones lost theirs)
  if (alive && lod > 0)
    for (const [c, h] of walls) bevelBox(B, [c[0], H * 2 + 0.008, c[2]], [h[0] + 0.006, 0.014, h[2] + 0.006], 0.008, CREAM_TOP, { noBottom: true });
  bevelBox(B, [0, H * 1.65, 0], [w / 2 - t * 1.6, 0.02, d / 2 - t * 1.6], 0.01, alive ? SOIL : SOIL_DRY, { noBottom: true });
  if (!alive && lod > 0)
    for (let k = 0; k < 2; k++) {
      const x = (R() - 0.5) * w * 0.8;
      strip(B, [x, H * 2 + 0.002, -d / 2], [x + (R() - 0.5) * 0.06, H * 2 + 0.002, -d / 2 + t * 2], 0.006, scaleC(STONE_DEAD, 0.5));
    }
  return B.done();
}

// ───────────── railings (3.10) ─────────────

export type RailKind = 'pipe' | 'balustrade' | 'parapet';
const RUST: C = hex('#8f5434');
const COPPER: C = hex('#b97a4a');

/** One tile of edge treatment along +x (0…1) at z = 0, standing on y = 0. `broken` drops a section (dead edges). */
export function buildRail(kind: RailKind, alive: boolean, variant: number, broken: boolean, lod: Lod): TreeGeo {
  const B = new Buf();
  const R = rng(variant * 37 + (alive ? 5 : 0) + (broken ? 11 : 0) + kind.length * 101);
  const sides = lod > 0 ? 6 : 4;
  if (kind === 'pipe') {
    const col = alive ? COPPER : RUST;
    const H = 0.34;
    for (const x of [0.02, 0.98]) {
      tube(B, [[x, 0, 0], [x, H + 0.01, 0]], [0.016, 0.014], sides, [scaleC(col, 0.8), col], [0, 0], false);
      if (lod > 0) puff(B, { c: [x, H + 0.02, 0], r: [0.02, 0.016, 0.02], base: alive ? hex('#e8ba40') : scaleC(RUST, 0.9), light: hex('#fff1b8'), dark: scaleC(col, 0.6), flex: 0, seed: 1, detail: 0, lump: 0 });
    }
    const end = broken ? 0.45 + R() * 0.2 : 1;
    tube(B, [[0, H, 0], [end, H - (broken ? 0.02 : 0), 0]], [0.013, 0.013], sides, [col, col], [0, 0], false);
    if (broken) tube(B, [[end, H - 0.02, 0], [end + 0.12, H - 0.16, 0.06]], [0.012, 0.011], sides, [col, scaleC(col, 0.8)], [0, 0], false);
    else tube(B, [[0, H * 0.5, 0], [1, H * 0.5, 0]], [0.009, 0.009], sides, [scaleC(col, 0.9), scaleC(col, 0.9)], [0, 0], false);
  } else if (kind === 'balustrade') {
    const col = alive ? CREAM : STONE_DEAD;
    const top = alive ? CREAM_TOP : scaleC(STONE_DEAD, 1.05);
    bevelBox(B, [0.5, 0.025, 0], [0.5, 0.025, 0.06], 0.01, col, { top, noBottom: true });
    const n = lod > 0 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      if (broken && i === 2) continue;
      const x = (i + 0.5) / n;
      // a turned baluster: bulb low, slim neck
      tube(B, [[x, 0.05, 0], [x, 0.12, 0], [x, 0.2, 0], [x, 0.29, 0]], [0.026, 0.034, 0.016, 0.022], lod > 0 ? 8 : 4, [col, col, col, top], [0, 0, 0, 0], false);
    }
    if (!broken) bevelBox(B, [0.5, 0.31, 0], [0.5, 0.025, 0.055], lod > 0 ? 0.016 : 0.006, col, { top });
    else bevelBox(B, [0.3, 0.31, 0], [0.3, 0.025, 0.055], 0.016, col, { top, chip: 1, chipD: 0.04 });
  } else {
    const col = alive ? hex('#e6dcc8') : hex('#8f8a80');
    const top = alive ? CREAM_TOP : hex('#a19c91');
    bevelBox(B, [0.5, 0.12, 0], [0.5, 0.12, 0.06], 0.012, col, { top, noBottom: true, chip: broken ? 3 : undefined, chipD: 0.1 });
    bevelBox(B, [0.5, 0.25, 0], [0.51, 0.018, 0.08], 0.012, top, { chip: broken ? 1 : undefined, chipD: 0.03 });
  }
  return B.done();
}

// ───────────── edge clutter (3.11) ─────────────

export type ClutterKind = 'ac' | 'pipes' | 'crate' | 'bricks' | 'rubble' | 'vent' | 'block' | 'pot' | 'lantern' | 'niche' | 'mural';
/** Dead ground gets debris; restored ground tidier, decorative props. */
export const CLUTTER_DEAD: ClutterKind[] = ['rubble', 'bricks', 'crate', 'pot', 'ac', 'pipes', 'vent', 'block'];
export const CLUTTER_ALIVE: ClutterKind[] = ['lantern', 'pot', 'crate', 'block', 'ac', 'pipes', 'vent', 'niche'];
const WOOD: C = hex('#a67a4e');
const TERRACOTTA: C = hex('#c76b45');

/** One clutter prop, standing at the origin, facing +z (its "front", away from a wall at −z). */
export function buildClutter(kind: ClutterKind, alive: boolean, variant: number, lod: Lod): TreeGeo {
  const B = new Buf();
  const R = rng(variant * 523 + kind.length * 17 + (alive ? 3 : 0));
  const r = lod > 0 ? 0.012 : 0.004;
  switch (kind) {
    case 'ac': {
      const col = alive ? hex('#e9e4d8') : hex('#a7a49c');
      bevelBox(B, [0, 0.1, 0], [0.13, 0.1, 0.08], r, col, { noBottom: true });
      plate(B, [0.04, 0.1, 0.082], 0.065, [0, 0, 1], hex('#3a3f45'), 0, 10);
      if (lod > 0) {
        for (let k = -2; k <= 2; k++) plainBox(B, [0.04, 0.1 + k * 0.024, 0.086], [0.066 - Math.abs(k) * 0.01, 0.003, 0.003], scaleC(col, 0.8));
        for (let k = 0; k < 4; k++) plainBox(B, [-0.09, 0.05 + k * 0.035, 0.082], [0.025, 0.004, 0.004], scaleC(col, 0.7));
      }
      break;
    }
    case 'pipes': {
      const col = alive ? COPPER : RUST;
      const x = (R() - 0.5) * 0.1;
      tube(B, [[x, 0, -0.04], [x, 0.36, -0.04], [x + 0.03, 0.42, -0.04], [x + 0.16, 0.42, -0.04]], [0.022, 0.022, 0.022, 0.022], lod > 0 ? 6 : 4, [col, col, col, col], [0, 0, 0, 0], true);
      if (lod > 0) for (const y of [0.12, 0.3]) bevelBox(B, [x, y, -0.04], [0.03, 0.01, 0.03], 0.004, scaleC(col, 0.7));
      break;
    }
    case 'crate': {
      const n = alive ? 1 + Math.floor(R() * 2) : 1;
      for (let k = 0; k < n; k++) {
        const s = 0.08 + R() * 0.03;
        const c: V = [k * 0.05, s + k * 2 * s * 0.98, k * 0.02];
        const col = alive ? scaleC(WOOD, 0.95 + R() * 0.1) : hex('#7d6a55');
        bevelBox(B, c, [s, s, s], r, col, { rot: [0, (R() - 0.5) * 30, alive ? 0 : 8], noBottom: k === 0 });
        if (lod > 0) for (const dy of [-0.5, 0.5]) plainBox(B, add(c, [0, dy * s, s + 0.002]), [s * 0.98, 0.008, 0.004], scaleC(col, 0.7));
      }
      break;
    }
    case 'bricks': {
      for (let k = 0; k < (lod > 0 ? 7 : 3); k++) {
        const row = Math.floor(k / 3);
        bevelBox(B, [((k % 3) - 1) * 0.07 + row * 0.03, 0.02 + row * 0.04, (R() - 0.5) * 0.04], [0.032, 0.018, 0.016], 0.005, hex(['#a8573c', '#b5654a', '#93503a'][k % 3]), { rot: [0, (R() - 0.5) * 30, 0] });
      }
      break;
    }
    case 'rubble': {
      for (let k = 0; k < (lod > 0 ? 6 : 3); k++) {
        const a = R() * Math.PI * 2, d = R() * 0.1;
        puff(B, { c: [Math.cos(a) * d, 0.015, Math.sin(a) * d], r: [0.03 + R() * 0.03, 0.02 + R() * 0.02, 0.03 + R() * 0.03], base: hex(['#8f8d86', '#7d7b74', '#9a9890'][k % 3]), light: hex('#b4b1a8'), dark: hex('#5f5c55'), flex: 0, seed: k, detail: 0, lump: 0.4 });
      }
      break;
    }
    case 'vent': {
      const col = alive ? hex('#c9c4b8') : hex('#7d7a73');
      bevelBox(B, [0, 0.07, 0], [0.09, 0.07, 0.09], r, col, { noBottom: true });
      bevelBox(B, [0, 0.15, 0], [0.11, 0.012, 0.11], r, scaleC(col, 0.9));
      if (lod > 0) for (let k = -1; k <= 1; k++) plainBox(B, [0, 0.07 + k * 0.03, 0.092], [0.07, 0.004, 0.004], scaleC(col, 0.6));
      break;
    }
    case 'block': {
      const col = alive ? hex('#d9d1c0') : hex('#9a9890');
      bevelBox(B, [0, 0.07, 0], [0.12, 0.07, 0.09], r * 1.5, col, { noBottom: true, rot: [0, (R() - 0.5) * 40, 0], chip: alive ? undefined : 2 });
      if (alive && lod > 0) puff(B, { c: [0.02, 0.14, 0], r: [0.1, 0.018, 0.07], base: hex('#7fa35a'), light: hex('#a5c86a'), dark: hex('#5a7f3f'), flex: 0, seed: 3, detail: 1, lump: 0.4 });
      break;
    }
    case 'pot': {
      const col = alive ? TERRACOTTA : hex('#9a6a52');
      if (alive) {
        tube(B, [[0, 0, 0], [0, 0.06, 0], [0, 0.11, 0]], [0.045, 0.055, 0.065], lod > 0 ? 8 : 5, [scaleC(col, 0.85), col, col], [0, 0, 0], false);
        plate(B, [0, 0.1, 0], 0.058, [0, 1, 0], SOIL, 0, 8);
      } else {
        // a broken pot on its side, with shards
        tube(B, [[0, 0.05, 0], [0.06, 0.05, 0.02], [0.1, 0.055, 0.03]], [0.045, 0.055, 0.06], 6, [col, col, scaleC(col, 0.8)], [0, 0, 0], false);
        for (let k = 0; k < 3; k++) plainBox(B, [0.13 + R() * 0.06, 0.006, (R() - 0.5) * 0.1], [0.02, 0.004, 0.015], col, undefined, R() * 1.5);
      }
      break;
    }
    case 'lantern': {
      const metal = hex('#3f4246');
      tube(B, [[0, 0, 0], [0, 0.42, 0]], [0.012, 0.01], 5, [metal, metal], [0, 0], false);
      bevelBox(B, [0, 0.47, 0], [0.035, 0.045, 0.035], 0.006, hex('#fff1b8'));
      bevelBox(B, [0, 0.525, 0], [0.045, 0.01, 0.045], 0.005, hex('#d9a441'));
      bevelBox(B, [0, 0.42, 0], [0.04, 0.006, 0.04], 0.004, hex('#d9a441'));
      break;
    }
    case 'niche': {
      // a wall niche with a little lucky cat statue (CatVisuals' white and red)
      const col = alive ? CREAM : STONE_DEAD;
      bevelBox(B, [0, 0.16, -0.04], [0.12, 0.16, 0.04], r, col, { noBottom: true });
      plainBox(B, [0, 0.17, 0.005], [0.08, 0.1, 0.004], scaleC(col, 0.55));
      if (alive) {
        puff(B, { c: [0, 0.12, 0.03], r: [0.035, 0.04, 0.03], base: hex('#fbfaf7'), light: [1, 1, 1], dark: hex('#d9d6cf'), flex: 0, seed: 1, detail: 1, lump: 0 });
        puff(B, { c: [0, 0.18, 0.03], r: [0.032, 0.028, 0.028], base: hex('#fbfaf7'), light: [1, 1, 1], dark: hex('#d9d6cf'), flex: 0, seed: 2, detail: 1, lump: 0 });
        plainBox(B, [0, 0.152, 0.045], [0.026, 0.005, 0.008], hex('#e2483c'));
        for (const s of [-1, 1]) card(B, [s * 0.016, 0.2, 0.03], norm([s * 0.3, 1, 0]), [0, 0, 1], 0.02, 0.018, hex('#fbfaf7'), hex('#ffc1dc'), 0, 0, 0.3, 0);
      }
      break;
    }
    case 'mural': {
      // a painted leaf mural: flat leaves just off the wall (at −z), pale greens and gold
      const cols = [hex('#a5d94d'), hex('#7fb35a'), hex('#e8ba40'), hex('#cfe6a0')];
      for (let k = 0; k < 5; k++) {
        const a = -0.6 + k * 0.3 + (R() - 0.5) * 0.2;
        card(B, [0, 0.15, -0.075], norm([Math.sin(a), Math.cos(a), 0]), [0, 0, 1], 0.12 + R() * 0.05, 0.07, cols[k % 4], mix(cols[k % 4], [1, 1, 1], 0.2), 0, 0, 0.45, 0);
      }
      break;
    }
  }
  return B.done();
}

// ───────────── caches ─────────────

const cache = new Map<string, TreeGeo>();
const get = (key: string, make: () => TreeGeo) => {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
};
export const PROP_VARIANTS = 4;
export const pavingGeo = (layout: number, variant: number, alive: boolean, shades: string[], lod: Lod) =>
  get(`p|${layout}|${variant % PROP_VARIANTS}|${alive}|${shades[0]}|${lod}`, () => buildPaving(layout, variant % PROP_VARIANTS, alive, shades, lod));
export const planterGeo = (w: number, d: number, alive: boolean, variant: number, lod: Lod) => get(`pl|${w}|${d}|${alive}|${variant % PROP_VARIANTS}|${lod}`, () => buildPlanter(w, d, alive, variant % PROP_VARIANTS, lod));
export const railGeo = (kind: RailKind, alive: boolean, variant: number, broken: boolean, lod: Lod) => get(`r|${kind}|${alive}|${variant % 2}|${broken}|${lod}`, () => buildRail(kind, alive, variant % 2, broken, lod));
export const clutterGeo = (kind: ClutterKind, alive: boolean, variant: number, lod: Lod) => get(`c|${kind}|${alive}|${variant % PROP_VARIANTS}|${lod}`, () => buildClutter(kind, alive, variant % PROP_VARIANTS, lod));
