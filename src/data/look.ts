// Look 1 (lighting and post-processing): every rendering knob for the golden-hour look lives here, apart from
// gameplay tuning (tuning.ts), so the art pass can retune it without touching balance. In a dev build the live
// object is `window.solarbloom.look.cfg`: change a value, then call `window.solarbloom.look.apply()`.
// See docs/art/rendering.md for the pipeline these numbers are tuned against.

export const LOOK = {
  /** Look 1.2: the golden-hour key light. Elevation above the horizon and compass direction it shines toward. */
  sun: {
    color: '#ffd29a',
    intensity: 3.1,
    elevation: 34,
    /**
     * Horizontal direction the light travels, as a world-space (x, z) vector. With the default camera yaw (45°)
     * this throws shadows toward the lower left of the screen, like the reference (sun behind, to the right).
     */
    toward: [-0.25, 0.97] as [number, number],
    /** Shadow bias tuned for 2048² maps over the zoom-dependent shadow distance. */
    shadowBias: 0.2,
    normalOffsetBias: 0.05,
  },
};
