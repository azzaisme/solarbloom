import type { TreeGeo } from './TreeGen';

/**
 * #687: the drawn top of the tile being dressed, so scattered ground pieces (tufts, flowers, shrubs, stones) keep
 * their whole footprint on it instead of hanging over the water or a drop.
 *
 * A tile's top is its 1 × 1 square, except that a corner poking out into water is rounded off (`ChunkRenderer.landCuts`,
 * a quarter circle of radius `cut[i]`). Only the sides where the ground visibly ends count: water, lower ground, or
 * nothing at all. Where the neighbour is ground at the same height a piece may spread across the seam, since the
 * neighbour's top carries on under it.
 */
export interface GroundFit {
  /** the tile's corner (its square runs to x0 + 1, z0 + 1) */
  x0: number;
  z0: number;
  /** does the ground end on the +x, −x, +z, −z side (SIDES order)? */
  open: [boolean, boolean, boolean, boolean];
  /** radius each corner is rounded off by (ChunkRenderer's CORNERS order: (+1,+1), (−1,+1), (−1,−1), (+1,−1)), 0 for square */
  cut: number[];
}

/** ChunkRenderer's CORNERS order. */
const CORNER_SIGNS: [number, number][] = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

/** A hair of ground left showing past a piece's footprint, so leaves never sit exactly on the lip. */
export const FIT_LIP = 0.02;

/**
 * Where to put a piece of footprint radius `r` meant for (x, z) so its footprint stays on the tile's drawn top: moved
 * the least distance in from each open side and out of each rounded corner. Never removed: a piece too big for the
 * room left is centred on that axis (or on the rounded corner's centre).
 */
export function fitOnGround(f: GroundFit, x: number, z: number, r: number): [number, number] {
  const m = r + FIT_LIP;
  const cx = f.x0 + 0.5;
  const cz = f.z0 + 0.5;
  const clamp = (v: number, lo: number, hi: number, mid: number) => (lo > hi ? mid : Math.min(hi, Math.max(lo, v)));
  // open sides: +x, −x, +z, −z
  const loX = f.open[1] ? f.x0 + m : -Infinity;
  const hiX = f.open[0] ? f.x0 + 1 - m : Infinity;
  const loZ = f.open[3] ? f.z0 + m : -Infinity;
  const hiZ = f.open[2] ? f.z0 + 1 - m : Infinity;
  x = clamp(x, loX, hiX, cx);
  z = clamp(z, loZ, hiZ, cz);
  // rounded corners: past the quarter circle's centre on both axes, stay within its radius less the footprint
  CORNER_SIGNS.forEach(([sx, sz], i) => {
    const R = f.cut[i];
    if (!R) return;
    const ox = cx + sx * (0.5 - R);
    const oz = cz + sz * (0.5 - R);
    const dx = x - ox;
    const dz = z - oz;
    if (dx * sx <= 0 || dz * sz <= 0) return; // not in this corner's square
    const room = R - m;
    const d = Math.hypot(dx, dz);
    if (room <= 0) {
      x = ox;
      z = oz;
    } else if (d > room) {
      x = ox + (dx / d) * room;
      z = oz + (dz / d) * room;
    }
  });
  return [x, z];
}

/** Is a footprint of radius `r` at (x, z) on the tile's drawn top (within `eps`)? For the tests and the dev check. */
export function onGround(f: GroundFit, x: number, z: number, r: number, eps = 1e-6): boolean {
  if (f.open[0] && x + r > f.x0 + 1 + eps) return false;
  if (f.open[1] && x - r < f.x0 - eps) return false;
  if (f.open[2] && z + r > f.z0 + 1 + eps) return false;
  if (f.open[3] && z - r < f.z0 - eps) return false;
  const cx = f.x0 + 0.5;
  const cz = f.z0 + 0.5;
  return CORNER_SIGNS.every(([sx, sz], i) => {
    const R = f.cut[i];
    if (!R) return true;
    const ox = cx + sx * (0.5 - R);
    const oz = cz + sz * (0.5 - R);
    const dx = x - ox;
    const dz = z - oz;
    // the footprint must stay inside the rounded corner wherever it reaches into the corner's square
    if (dx * sx + r <= 0 || dz * sz + r <= 0) return true;
    const px = dx * sx > 0 ? dx : 0;
    const pz = dz * sz > 0 ? dz : 0;
    return Math.hypot(px, pz) + r <= R + eps;
  });
}

const RADIUS = new WeakMap<TreeGeo, number>();
/** A foliage piece's footprint radius at scale 1: the furthest any of its vertices reaches from its foot, across. */
export function geoRadius(g: TreeGeo): number {
  let r = RADIUS.get(g);
  if (r === undefined) {
    r = 0;
    for (let i = 0; i < g.pos.length; i += 4) r = Math.max(r, Math.hypot(g.pos[i], g.pos[i + 2]));
    RADIUS.set(g, r);
  }
  return r;
}
