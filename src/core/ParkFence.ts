import { CHUNK } from './Hash';
import { PARK_SET, REGIONS } from '../data/oldcity';

export const PARK_FENCE_INSET = 0.06;
const HALF_WIDTH = 0.06;
const gates = new Set(REGIONS.flatMap(region => region.gate.cells.map(([x, z]) => `${x},${z}`)));

/** Openings follow the adjoining region entrances and the beach stair. */
export function parkFenceGap(x: number, z: number): boolean {
  return gates.has(`${x},${z}`) ||
    (z === CHUNK && PARK_SET.ramps.some(ramp => x >= ramp.x && x < ramp.x + ramp.w));
}

const segments: { x: number; z: number; halfX: number; halfZ: number }[] = [];
for (let i = 0; i < CHUNK; i++) {
  if (!parkFenceGap(i, -1)) segments.push({ x: i + 0.5, z: PARK_FENCE_INSET, halfX: 0.5, halfZ: HALF_WIDTH });
  if (!parkFenceGap(i, CHUNK)) segments.push({ x: i + 0.5, z: CHUNK - PARK_FENCE_INSET, halfX: 0.5, halfZ: HALF_WIDTH });
  if (!parkFenceGap(-1, i)) segments.push({ x: PARK_FENCE_INSET, z: i + 0.5, halfX: HALF_WIDTH, halfZ: 0.5 });
  if (!parkFenceGap(CHUNK, i)) segments.push({ x: CHUNK - PARK_FENCE_INSET, z: i + 0.5, halfX: HALF_WIDTH, halfZ: 0.5 });
}

export function hitsParkFence(x: number, z: number, radius: number): boolean {
  const margin = radius + PARK_FENCE_INSET + HALF_WIDTH;
  if (x < -margin || z < -margin || x > CHUNK + margin || z > CHUNK + margin ||
      (x > margin && z > margin && x < CHUNK - margin && z < CHUNK - margin)) return false;
  return segments.some(segment => {
    const dx = Math.max(0, Math.abs(x - segment.x) - segment.halfX);
    const dz = Math.max(0, Math.abs(z - segment.z) - segment.halfZ);
    return dx * dx + dz * dz <= radius * radius;
  });
}
