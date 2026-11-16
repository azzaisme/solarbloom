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
