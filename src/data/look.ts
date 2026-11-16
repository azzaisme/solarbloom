import * as pc from 'playcanvas';

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
  /** Look 1.3: a cool, low fill from the side opposite the sun (no shadows). */
  fill: { color: '#8fb4ff', intensity: 0.42 },
  /**
   * Look 1.3: ambient light from the sky above and the ground below, baked into a tiny environment atlas.
   * Colours are linear-ish sRGB hex; `intensity` scales the whole environment (ambient and reflections).
   */
  env: {
    zenith: '#5d8fd6',
    horizon: '#cfd9e3',
    ground: '#7a6a48',
    intensity: 0.85,
  },
  /**
   * Look 1.3: a warm rim on silhouettes (a view-dependent term added in the standard shader), stronger on the
   * sun side, so flowers, the drone and machines pick up a bright edge against darker ground.
   */
  rim: { color: '#ffc98a', intensity: 0.8, power: 3.0 },
  /**
   * Look 1.4: tone mapping and exposure. Khronos PBR Neutral keeps the palette's hues and saturation (ACES
   * bleached the greens and pinks toward yellow-white), and rolls highlights off so nothing clips.
   */
  toneMapping: pc.TONEMAP_NEUTRAL as number,
  exposure: 1.0,
  /**
   * Look 1.5: bloom on emissive and very bright pixels only. The threshold is scene-referred (before exposure and
   * tone mapping): sunlit grass and paving peak around 1.0–1.3, so glows are authored at 2 and above (Look 1.9).
   */
  bloom: { intensity: 0.03, threshold: 1.6, blurLevel: 12 },
  /**
   * Look 1.6: screen-space ambient occlusion for contact shadows (High tier). The radius is in world units (a tile
   * is 1): `radiusPerView` × the world height in view, clamped, so close-ups get tight contact shadows under
   * bushes and machines and the overview still shows grounding around buildings and trees.
   */
  ssao: { intensity: 1, power: 2, minAngle: 10, samples: 12, radiusPerView: 0.12, minRadius: 0.6, maxRadius: 2 },
};
