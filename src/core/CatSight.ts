/**
 * E23.12.3 (#530, epic rule 8): can the player really see a hiding cat? Before the first cat is found, the pointer
 * only finds a cat the player could spot by eye: one big enough on screen to make out, with nothing solid between
 * it and the camera. Otherwise sweeping the cursor over the overview would find a cat a few pixels big or behind a
 * building, like a metal detector. Pure geometry: the game passes the top of whatever stands at a point.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export const CAT_SIGHT = {
  /** a cat smaller than this on screen (its height, px) can't be made out */
  minPixels: 14,
  /** the cat's own height (world units), for its size on screen */
  catHeight: 0.32,
  /** how finely the line of sight is walked (world units) */
  step: 0.2,
  /** the last stretch beside the cat isn't checked (its own nook, the ground it sits on) */
  skipNear: 0.45,
};

/** How tall a cat stands on screen (px), from the camera's world units per pixel and its depth scale. */
export function catPixels(worldPerPixel: number, scale = 1): number {
  return (CAT_SIGHT.catHeight / Math.max(1e-6, worldPerPixel)) * scale;
}

/**
 * Is the line from the eye to the cat clear? `topAt(x, z)` is the top of whatever stands at a point (the ground, a
 * building's roof, a tall machine). Blocked when the line passes below it anywhere between them (the cat's own
 * spot aside).
 */
export function sightClear(eye: P3, cat: P3, topAt: (x: number, z: number) => number): boolean {
  const dx = eye.x - cat.x;
  const dy = eye.y - cat.y;
  const dz = eye.z - cat.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  for (let s = CAT_SIGHT.skipNear; s < len; s += CAT_SIGHT.step) {
    const f = s / len;
    const x = cat.x + dx * f;
    const z = cat.z + dz * f;
    const y = cat.y + dy * f;
    if (y < topAt(x, z)) return false;
  }
  return true;
}

/** Seen: big enough on screen and nothing in the way. */
export function catSeen(eye: P3, cat: P3, pixels: number, topAt: (x: number, z: number) => number): boolean {
  return pixels >= CAT_SIGHT.minPixels && sightClear(eye, cat, topAt);
}
