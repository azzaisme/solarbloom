/**
 * E23.12.3 (#530, epic rule 8): can the player really see a hiding cat? Before the first cat is found, the pointer
 * (its tip, a click) and bloombot's "Say hello" only answer for a cat the player could spot by eye. Otherwise
 * sweeping the cursor over the overview would find a cat a few pixels big or one behind a building, like a metal
 * detector.
 *
 * "Seen" is measured on the frame itself: the game renders a pick pass (rendering/SightPicker) and counts the screen
 * pixels where the frontmost thing drawn is the cat. Anything the player can't see through hides it at its real
 * shape and height: buildings, towers, landmarks, trees, ruins, walls, props, machines. Where the GPU pick can't run
 * (WebGPU reads back only asynchronously), a CPU ray march estimates the same number against the solid things'
 * real shapes as drawn (core/Solids: the chunk builder records them), so a canopy or a tree crown can overhang a
 * cat and still be seen under (cpuSeenPixels). This module is the pure part: the screen box to read, the count, the ray march, and how
 * much is enough.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export const CAT_SIGHT = {
  /**
   * How much of the cat must show (screen pixels, at full resolution) to count as seen: about a 10 × 10 patch. A
   * cat in the overview's default view is a few pixels in all; one 14 px tall and in the open shows over 100.
   */
  minPixels: 100,
  /** the pick pass runs at this fraction of the screen's resolution (each pick pixel stands for 1/scale² pixels) */
  scale: 0.5,
  /** a result is reused for this long (s) even while things move: a walking view re-measures at most this often */
  cacheSeconds: 0.25,
  /** a result from an unchanged view is reused up to this long (s): things that move on their own (drones) */
  maxAgeSeconds: 2,
  /** the pointer counts as near a cat within its tap radius plus this (screen px): it is measured before it's under the pointer */
  pointerMarginPx: 24,
  /** CPU ray march: the cat's height (world units: the Lucky Cat model as drawn) */
  catHeight: 0.32,
  /** CPU ray march: how much of the square on the cat's screen height its silhouette fills */
  fill: 0.65,
  /** CPU ray march: how finely a line of sight is walked (world units) */
  step: 0.08,
  /** CPU ray march: the stretch beside the cat that isn't checked (its own nook: the bench or ledge it tucks into) */
  skipNear: 0.3,
};

export interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The screen box around projected points (the cat's bounds), clipped to the screen; undefined when none of it is on
 * screen. Whole pixels, so it reads cleanly from a pick buffer.
 */
export function screenBox(points: { x: number; y: number }[], width: number, height: number): ScreenBox | undefined {
  if (!points.length) return undefined;
  const x0 = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x))));
  const y0 = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))));
  const x1 = Math.min(width, Math.ceil(Math.max(...points.map((p) => p.x))));
  const y1 = Math.min(height, Math.ceil(Math.max(...points.map((p) => p.y))));
  if (x1 <= x0 || y1 <= y0) return undefined;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** How many pixels of a pick buffer (RGBA, the mesh id in ARGB order as PlayCanvas writes it) are one of `ids`. */
export function countIds(pixels: Uint8Array, ids: ReadonlySet<number>): number {
  let n = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const id = ((pixels[i + 3] << 24) | (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]) >>> 0;
    if (ids.has(id)) n++;
  }
  return n;
}

/** Pick-buffer pixels as screen pixels (each stands for 1/scale² of them). */
export function toScreenPixels(pickPixels: number, scale = CAT_SIGHT.scale): number {
  return pickPixels / (scale * scale);
}

/** Seen: at least `CAT_SIGHT.minPixels` screen pixels of the cat show. */
export function seenEnough(screenPixels: number): boolean {
  return screenPixels >= CAT_SIGHT.minPixels;
}

/**
 * The points on a cat the CPU ray march looks at: low, middle and high on its middle line, and its two sides at
 * mid-height (`right` is the camera's right, flat).
 */
export function catSamples(base: P3, height: number, right: { x: number; z: number }): P3[] {
  const len = Math.hypot(right.x, right.z) || 1;
  const rx = right.x / len;
  const rz = right.z / len;
  const side = height * 0.35;
  return [
    { x: base.x, y: base.y + height * 0.2, z: base.z },
    { x: base.x, y: base.y + height * 0.5, z: base.z },
    { x: base.x, y: base.y + height * 0.85, z: base.z },
    { x: base.x - rx * side, y: base.y + height * 0.5, z: base.z - rz * side },
    { x: base.x + rx * side, y: base.y + height * 0.5, z: base.z + rz * side },
  ];
}

/**
 * Is the line from `eye` to `p` clear? `solidAt(x, y, z)` says whether a point is inside something solid (the
 * ground, a roof, a tree's crown, a ruin, a wall, a machine). Walked from the point out (its own nook, the first
 * `skipNear`, aside); blocked at the first solid point.
 */
export function rayClear(eye: P3, p: P3, solidAt: (x: number, y: number, z: number) => boolean): boolean {
  const dx = eye.x - p.x;
  const dy = eye.y - p.y;
  const dz = eye.z - p.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  for (let s = CAT_SIGHT.skipNear; s < len; s += CAT_SIGHT.step) {
    const f = s / len;
    if (solidAt(p.x + dx * f, p.y + dy * f, p.z + dz * f)) return false;
  }
  return true;
}

/**
 * The CPU estimate of a cat's seen screen pixels, the same measure as the GPU pick's: the share of its sample points
 * with a clear line to the eye, times its silhouette's area on screen (`heightPx`: its height there, px).
 */
export function cpuSeenPixels(eye: P3, samples: P3[], heightPx: number, solidAt: (x: number, y: number, z: number) => boolean): number {
  if (!samples.length || heightPx <= 0) return 0;
  const clear = samples.filter((p) => rayClear(eye, p, solidAt)).length;
  return (clear / samples.length) * heightPx * heightPx * CAT_SIGHT.fill;
}
