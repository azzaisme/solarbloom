import * as pc from 'playcanvas';

export type GfxTier = 'low' | 'medium' | 'high';

// Look 1 (lighting and post-processing): every rendering knob for the golden-hour look lives here, apart from
// gameplay tuning (tuning.ts), so the art pass can retune it without touching balance. In a dev build the live
// object is `window.solarbloom.look.cfg`: change a value, then call `window.solarbloom.look.apply()`.
// See docs/art/rendering.md for the pipeline these numbers are tuned against.

export const LOOK = {
  /** Look 1.2: the golden-hour key light. Elevation above the horizon and compass direction it shines toward. */
  sun: {
    color: '#ffe6bf',
    intensity: 3.4,
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
  fill: { color: '#c9dcff', intensity: 0.75 },
  /**
   * Look 1.3: ambient light from the sky above and the ground below, baked into a tiny environment atlas.
   * Colours are linear-ish sRGB hex; `intensity` scales the whole environment (ambient and reflections).
   */
  env: {
    zenith: '#8fb8ee',
    horizon: '#f2efe6',
    ground: '#b8a57c',
    intensity: 1.3,
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
  exposure: 1.15,
  /**
   * Look 1.5: bloom on emissive and very bright pixels only. The threshold is scene-referred (before exposure and
   * tone mapping): sunlit grass and paving peak around 1.0–1.3, so glows are authored at 3 and above (Look 1.9).
   */
  bloom: { intensity: 0.14, threshold: 1.15, blurLevel: 14 },
  /**
   * Look 1.9: emissive budget (scene-referred, before exposure; bloom starts at 1.5). See docs/art/rendering.md.
   * `gain` multiplies every standard material authored as a glow (emissiveIntensity >= 1); weaker emissive tints
   * stay as they are and never bloom. `vertexGlow` is the glow of chunk geometry flagged in its vertex alpha (lit
   * lamps, Radiant flowers). `tile` drives restore-tile flashes and glows, `preview` the pulse footprint preview,
   * `particles` the burst and trail sparkles.
   */
  emissive: { gain: 4, vertexGlow: 4, tile: 4, preview: 3, particles: 2.5 },
  /**
   * Look 1.6: screen-space ambient occlusion for contact shadows (High tier). The radius is in world units (a tile
   * is 1): `radiusPerView` × the world height in view, clamped, so close-ups get tight contact shadows under
   * bushes and machines and the overview still shows grounding around buildings and trees.
   */
  ssao: { intensity: 1, power: 2, minAngle: 10, samples: 12, radiusPerView: 0.12, minRadius: 0.6, maxRadius: 2 },
  /**
   * Look 1.7: colour grading. `warm` is the restored look; `dead` is the fogged / unrestored mood. The game blends
   * between them by the restoration of the area in view (0 = dead, 1 = warm), so the light comes back as you
   * restore. Read every frame: live edits apply at once.
   */
  grade: {
    warm: { brightness: 1.03, contrast: 1.0, saturation: 1.12, tint: '#fff4e4', shadows: 0.18, highlights: -0.1, vibrance: 0.22 },
    dead: { brightness: 0.97, contrast: 1.03, saturation: 0.82, tint: '#e9eef6', shadows: 0.0, highlights: -0.1, vibrance: 0.0 },
    /** High contrast (settings): a flatter grade with no vignette so outlines and text stay readable. */
    contrast: { brightness: 1.02, contrast: 1.0, saturation: 1.0, tint: '#ffffff', shadows: 0.2, highlights: -0.1, vibrance: 0.0 },
    /** Seconds for the mood to follow a change in restoration. */
    follow: 2.5,
  },
  /**
   * Look 1.8: depth of field (High tier). Focus is on the camera's goal point; the far blur starts `blurFrom` world
   * units beyond it (where the haze is already strong, so blur and haze rise together) and is complete one
   * `blurRamp` further. Near blur is off, so nothing in front of the focus is ever blurred.
   */
  dof: { blurFrom: 9, blurRamp: 18, blurRadius: 3, blurRings: 3, blurRingPoints: 4 },
  /**
   * Look 1.10: the warm golden haze toward the horizon (the linear fog; where it starts and ends follows the zoom,
   * see CameraController.hazeStart / hazeEnd). The camera clears to it when post-processing is on.
   */
  haze: { color: '#f4ecdc' },
  /**
   * Look 1.10: drifting light motes and soft light shafts over restored ground near the camera's focus. Counts per
   * graphics tier; `lowVfx` and reduced motion turn the motes off, reduced motion freezes the shafts.
   */
  atmosphere: {
    motes: { high: 90, medium: 50, low: 0 },
    shafts: { high: 5, medium: 3, low: 0 },
    moteColor: '#ffe9a8',
    moteGlow: 3,
    moteSize: 0.05,
    shaftColor: '#ffd9a0',
    shaftGlow: 0.35,
    shaftWidth: 1.6,
    shaftLength: 7,
  },
  vignette: { intensity: 0, inner: 0.55, outer: 1.35, curvature: 0.6, color: '#2a1d14' },
  /**
   * Look 1.11: what each graphics tier turns on. High is for laptops and desktops (60 fps), Low for mid-range phones
   * (30 fps or better). Low has no post-processing: the camera tone-maps directly, so there is no grade, vignette,
   * bloom, SSAO or depth of field. Fauna caps per tier live in tuning.ts (E16).
   */
  tiers: {
    low: { post: false, samples: 1, shadowRes: 1024, softShadows: false, bloom: false, ssao: false, dof: false, rim: true },
    medium: { post: true, samples: 2, shadowRes: 2048, softShadows: false, bloom: true, ssao: false, dof: false, rim: true },
    high: { post: true, samples: 4, shadowRes: 2048, softShadows: true, bloom: true, ssao: true, dof: false, rim: true },
  } satisfies Record<GfxTier, TierSpec>,
};

export interface TierSpec {
  /** CameraFrame post-processing (off: the camera tone-maps directly) */
  post: boolean;
  /** MSAA samples of the HDR scene target */
  samples: number;
  shadowRes: number;
  /** PCF5 (softer penumbra) instead of PCF3 */
  softShadows: boolean;
  bloom: boolean;
  ssao: boolean;
  dof: boolean;
  rim: boolean;
}
