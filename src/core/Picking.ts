import type { LayerData } from './types';

/** Height of a tile's walkable top above its layer's surface (the slab). */
export const SLAB_TOP = 0.08;

export interface LayerHit {
  layerId: string;
  /** local, continuous tile coordinates on that layer */
  fx: number;
  fz: number;
  /** distance along the ray */
  t: number;
}

type V3 = { x: number; y: number; z: number };

/**
 * City 01.4: casts a ray against every pickable layer's plane (its height plus the slab top) and returns the
 * nearest hit. Bounded (raised) layers only count inside their footprint; the ground is unbounded. Locked
 * layers are skipped unless shown as a preview. Pure, so tests can cover overlapping layers.
 */
export function pickLayers(layers: readonly LayerData[], o: V3, d: V3): LayerHit | undefined {
  if (Math.abs(d.y) < 1e-6) return undefined;
  let best: LayerHit | undefined;
  for (const l of layers) {
    if (!l.unlocked && !l.preview) continue;
    const t = (l.origin[1] + l.height + SLAB_TOP - o.y) / d.y;
    if (t < 0 || (best && t >= best.t)) continue;
    const fx = o.x + d.x * t - l.origin[0];
    const fz = o.z + d.z * t - l.origin[2];
    if (l.kind === 'raised' && (fx < 0 || fz < 0 || fx >= l.width || fz >= l.depth)) continue;
    best = { layerId: l.id, fx, fz, t };
  }
  return best;
}

/**
 * Drone tap targets in screen pixels: a minimum, or a world-space radius at the current zoom, whichever is larger.
 * Generous over open ground (drones are small and moving); tight (about the drone's body) whenever a machine or a
 * placement footprint is under the pointer, so a drone hovering beside a machine can't steal the machine's tap.
 */
export const DRONE_TAP = {
  generous: { minPx: 26, world: 0.35 },
  tight: { minPx: 10, world: 0.2 },
} as const;

export function droneTapRadius(worldPerPixel: number, tight: boolean): number {
  const r = tight ? DRONE_TAP.tight : DRONE_TAP.generous;
  return Math.max(r.minPx, r.world / worldPerPixel);
}

/** The drone nearest the tap within the radius (screen positions), or undefined. Pure, for tests. */
export function pickDrone(drones: Iterable<{ id: string; x: number; y: number }>, x: number, y: number, radius: number): string | undefined {
  let best: string | undefined;
  let bestD = radius;
  for (const d of drones) {
    const dist = Math.hypot(d.x - x, d.y - y);
    if (dist <= bestD) {
      best = d.id;
      bestD = dist;
    }
  }
  return best;
}

/** Distance from a point to a convex polygon (0 inside). */
export function polyDist(poly: [number, number][], x: number, z: number): number {
  let inside = true;
  let best = Infinity;
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const ex = bx - ax;
    const ez = bz - az;
    const cross = ex * (z - az) - ez * (x - ax);
    const sg = Math.sign(cross);
    if (sg !== 0) {
      if (sign === 0) sign = sg;
      else if (sg !== sign) inside = false;
    }
    const l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  return inside ? 0 : best;
}

/**
 * E21.24: picking on terraced ground. The ray is followed down from where it crosses the highest terrace top until it
 * first goes below the ground under it (so a cliff in front hides the street behind, and ramps and stairs are hit
 * on their slope); the crossing is refined by bisection. `baseY` is the world y of level 1's walkable top;
 * `heightOf` reads the ground's height in levels under a point (undefined: level 1). Pure, for tests.
 */
export function pickTerraced(o: V3, d: V3, baseY: number, heightOf: (px: number, pz: number) => number | undefined, top = 4, levelHeight = 1.2): { fx: number; fz: number } | undefined {
  if (d.y > -1e-6) return undefined;
  const ground = (t: number) => baseY + ((heightOf(o.x + d.x * t, o.z + d.z * t) ?? 1) - 1) * levelHeight;
  const yTop = baseY + (top - 1) * levelHeight;
  const yLow = baseY - levelHeight - 1.2; // the sea's level, and hidden ground drawn sunk below it
  let t0 = Math.max(0, (yTop - o.y) / d.y);
  const t1 = (yLow - o.y) / d.y;
  const len = Math.hypot(d.x, d.y, d.z);
  const step = 0.08 / len; // well under a tile along the ground
  for (let t = t0; t <= t1; t += step) {
    if (o.y + d.y * t > ground(t)) {
      t0 = t;
      continue;
    }
    let a = t0;
    let b = t;
    for (let i = 0; i < 24; i++) {
      const m = (a + b) / 2;
      if (o.y + d.y * m > ground(m)) a = m;
      else b = m;
    }
    return { fx: o.x + d.x * b, fz: o.z + d.z * b };
  }
  return undefined;
}
