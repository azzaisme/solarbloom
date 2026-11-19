/**
 * E23.12.3 (#530, epic rule 8): can the player really see a hiding cat? Before the first cat is found, the pointer
 * (its tip, a click) and bloombot's "Say hello" only answer for a cat the player could spot by eye. Otherwise
 * sweeping the cursor over the overview would find a cat a few pixels big or one behind a building, like a metal
 * detector.
 *
 * "Seen" is measured on the frame itself: the game renders a pick pass (rendering/SightPicker) and counts the screen
 * pixels where the frontmost thing drawn is the cat. Anything the player can't see through hides it at its real
 * shape and height: buildings, towers, landmarks, trees, ruins, walls, props, machines, the fog. This module is the
 * pure part: the screen box to read, the count, and how much is enough.
 */

export const CAT_SIGHT = {
  /**
   * How much of the cat must show (screen pixels, at full resolution) to count as seen: about a 10 × 10 patch. A
   * cat in the overview's default view is a few pixels in all; one 14 px tall and in the open shows over 100.
   */
  minPixels: 100,
  /** the pick pass runs at this fraction of the screen's resolution (each pick pixel stands for 1/scale² pixels) */
  scale: 0.5,
  /** a result is reused for this long (s): the pointer and the prompt ask every frame */
  cacheSeconds: 0.25,
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
