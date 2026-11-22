import * as pc from 'playcanvas';

export type GfxTier = 'low' | 'medium' | 'high';

// Look 1 (lighting and post-processing): every rendering knob for the golden-hour look lives here, apart from
// gameplay tuning (tuning.ts), so the art pass can retune it without touching balance. In a dev build the live
// object is `window.solarbloom.look.cfg`: change a value, then call `window.solarbloom.look.apply()`.
// See docs/art/rendering.md for the pipeline these numbers are tuned against.

export const LOOK = {
  /** Look 1.2: the golden-hour key light. Elevation above the horizon and compass direction it shines toward. */
  sun: {
    // E27.1 (#679): was 3.4, which with the old ambient lit sunlit sand and grass three to four times past white
    // before tone mapping (most of a beach clipped). Now a sunlit pale surface lands just under white, and the
    // sun is about three times the shade's light, so shadows read
    color: '#ffdcaa',
    intensity: 2.1,
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
  /** Look 1.3: a cool, low fill from the side opposite the sun (no shadows). E27.1: a soft sky blue (was grey). */
  fill: { color: '#d0dcf0', intensity: 0.45 },
  /**
   * Look 1.3: ambient light from the sky above and the ground below, baked into a tiny environment atlas.
   * Colours are linear-ish sRGB hex; `intensity` scales the whole environment (ambient and reflections).
   */
  env: {
    // E27.1 (#679): a bluer sky and a lower strength (was 1.15 of a near-white horizon, which filled every shadow);
    // the ground's warm bounce keeps the shade side of ivory stone warm, not navy
    zenith: '#82aae0',
    horizon: '#dde3ea',
    ground: '#a08a62',
    intensity: 0.7,
  },
  /**
   * Look 1.3: a warm rim on silhouettes (a view-dependent term added in the standard shader), stronger on the
   * sun side, so flowers, the drone and machines pick up a bright edge against darker ground.
   */
  // Phase 6: stronger and more golden (was '#ffc98a', 0.8, power 3.0 on a plain 1 - N·V edge); see LookShaders
  // E27.1 (#679): softer and tighter (was 2.6, power 1.3): at that strength the gold edge lit half of every bush and
  // tuft, which is much of why the grass read fluorescent yellow-green
  rim: { color: '#ffd35c', intensity: 1.2, power: 2.2 },
  /**
   * Look 1.4: tone mapping and exposure. Khronos PBR Neutral keeps the palette's hues and saturation (ACES
   * bleached the greens and pinks toward yellow-white), and rolls highlights off so nothing clips.
   */
  toneMapping: pc.TONEMAP_NEUTRAL as number,
  exposure: 1.1,
  /**
   * Look 1.5: bloom on emissive and very bright pixels only. The threshold is scene-referred (before exposure and
   * tone mapping): glows are authored at 3 and above (Look 1.9). E27.1 (#679): was 1.15, under sunlit sand (about
   * 1.7), so pale ground bloomed by day and laid a warm veil over the picture; now only glows and sparkles bloom.
   * E23.7.5: `night` multiplies the intensity by deep night, so lamps, the pulse ring and glows wear soft halos
   * against the blue (by day it would wash the sunlit ground).
   */
  bloom: { intensity: 0.14, threshold: 1.8, blurLevel: 14, night: 2 },
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
    // E27.1 (#679): saturation 1.32 and vibrance 0.42 pushed the greens fluorescent, and lifted shadows flattened them
    warm: { brightness: 1.0, contrast: 1.06, saturation: 1.1, tint: '#fff4e4', shadows: 0.0, highlights: -0.15, vibrance: 0.15 },
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
   * E27.1 (#679): haze toward the horizon (LookShaders). With the skyline gone (#681) the far sea and coast sat in a
   * hard line against the sky from the low follow camera. Far surfaces within `band` degrees below the camera fade
   * into the haze colour, fully by `reach` of the way from where the depth fog starts to where it ends (nothing
   * nearer than the fog's start is touched), so the sea's edge and the far coast dissolve into the sky. The sky's
   * lowest `skyBand` degrees and the fog colour are matched to one colour (Sky.horizonSeen, fogMatchingSky).
   */
  horizon: {
    band: 6,
    reach: 0.45,
    strength: 1,
    /** how many degrees of sky above the horizon ease into the haze as the fogged distance shows it (Sky) */
    skyBand: 5,
  },
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
    low: { post: false, samples: 1, shadowRes: 1024, shadowCascades: 1, softShadows: false, bloom: false, ssao: false, dof: false, rim: true, waterReflect: false },
    // #648: 4× MSAA on Medium too (and so on the Deck, which draws Medium at 0.75 scale): at 2× the long thin
    // edges of the retaining walls and their coping stepped visibly
    medium: { post: true, samples: 4, shadowRes: 2048, shadowCascades: 2, softShadows: false, bloom: true, ssao: false, dof: false, rim: true, waterReflect: false },
    high: { post: true, samples: 4, shadowRes: 4096, shadowCascades: 3, softShadows: true, bloom: true, ssao: true, dof: false, rim: true, waterReflect: true },
  } satisfies Record<GfxTier, TierSpec>,
  /**
   * #156: how the sun's shadow cascades split the shadow distance, 0 (even) … 1 (logarithmic: most detail near the
   * camera). The skyline and sky are unlit and cast no shadows, so the cascades only cover the playable terrace.
   */
  cascadeDistribution: 0.6,
  /**
   * #648: the Old City's retaining walls (ChunkRenderer.terrace), in metres. The coping runs straight along a wall
   * and only reaches past the tile where the wall ends or turns, so neighbouring stones never overlap in a notch.
   * Brick courses stand far enough off the face that their top edge is never thinner than a pixel.
   */
  wall: {
    /** the wall's thickness, centred on the tile edge */
    thick: 0.12,
    /** how far the coping reaches out over each face */
    copingLip: 0.03,
    copingHeight: 0.06,
    /** brick courses: one every `courseStep` up from `courseFrom` above the lower side's ground */
    courseFrom: 0.15,
    courseStep: 0.45,
    courseHeight: 0.06,
    /** how far a course stands proud of the face */
    courseProud: 0.03,
    /** how far the foot sinks below the lower side's ground or water */
    footSink: 0.25,
  },
  /**
   * E28.W01 (#694): the water (WaterSurface). One surface for every stretch of live water (the open sea, its
   * shallows, the beach's surf and restored pools), coloured by how far it is from land, with ripples, sun and moon
   * highlights, Fresnel reflections of the sky (and, on High, of the world itself) and foam that laps the shores and
   * curls round whatever stands in the water. Colours are sRGB hex (the shader works in linear); lengths are in tiles.
   */
  water: {
    /** clear water right by the shore: turquoise */
    shallow: '#3fbfba',
    /** a little way out */
    mid: '#2aa3b4',
    /** far from land: deep blue-teal */
    deep: '#1a7f9e',
    /** the beach's surf while it is still dead: murky (restoring it clears it) */
    murky: '#6e877b',
    /** the sand seen through the shallows */
    bed: '#d3c08e',
    /** foam on the shore and round things in the water */
    foam: '#eef8f4',
    /** depth: `mid` is reached `midAt` tiles from land and `deep` by `deepAt` */
    midAt: 1.2,
    deepAt: 5,
    /** the bed shows through the shallows, fading out by `bedReach` tiles from land, up to `bedShow` of the colour */
    bedReach: 1.4,
    bedShow: 0.5,
    /** light nets on the bed in the shallows (0 off) */
    caustics: 0.1,
    /** ripples: wave length scale (tiles), drift speed, slope strength, and how much finer ripples add */
    ripple: { scale: 1.7, speed: 0.55, strength: 0.14, fine: 0.45 },
    /** waves that follow the shore and the outline of anything in the water, travelling in toward it */
    lap: { reach: 1.6, length: 0.55, speed: 0.5, strength: 0.18 },
    /** foam: how far out it reaches (tiles), how many lines, how fast they travel in, how strong */
    foamLine: { reach: 0.5, lines: 2, speed: 0.3, strength: 0.8 },
    /** the surface: gloss (sharp sun highlights) and how strong the highlight is (kept off neon, little bloom) */
    gloss: 0.93,
    specular: 0.18,
    /** Fresnel: reflectance looking straight down, how fast it rises toward grazing, and its cap */
    fresnel: { base: 0.04, power: 5, max: 0.6 },
    /** how strongly the sky's colours reflect (all tiers) */
    sky: 0.75,
    /** reflections take on this much of the water's own hue, so far water reads aqua (or navy) rather than the haze's grey */
    reflectTint: 0.45,
    /** the sky's blue light filling the water's own colour (the engine's sky light is off for water: it reflects its own way) */
    ambient: 0.55,
    /**
     * High only: a planar reflection of the world (buildings, the jetty, plants, lamps at night) at `scale` of the
     * screen's size, drawn as far as `far` tiles, mixed in by `strength` and broken up by the ripples (`distort`)
     */
    reflect: { strength: 0.7, scale: 0.5, far: 50, distort: 0.08 },
    /** by night the water's own colour dims to `nightAlbedo` of the day's (the moon, sky and lamps do the rest) */
    nightAlbedo: 0.55,
    /** by night the water's colour turns to this moonlit navy (the approved night sea) */
    night: '#123a8f',
  },
};

export interface TierSpec {
  /** E28.W01: a planar reflection of the world in the water */
  waterReflect: boolean;
  /** CameraFrame post-processing (off: the camera tone-maps directly) */
  post: boolean;
  /** MSAA samples of the HDR scene target */
  samples: number;
  /**
   * Size of the sun's whole shadow map. With 2+ cascades PlayCanvas packs them into a 2×2 atlas, so each cascade
   * gets half this per side (High: 3 × 2048²).
   */
  shadowRes: number;
  /** #156: sun shadow cascades, so mid-distance objects keep shadows without softening the near ones */
  shadowCascades: number;
  /** PCF5 (softer penumbra) instead of PCF3 */
  softShadows: boolean;
  bloom: boolean;
  ssao: boolean;
  dof: boolean;
  rim: boolean;
}

/**
 * #633: the Glow setting's steps (Settings › Display): a scale on bloom's strength. Normal (1) is the look the game
 * shipped with; Off turns the halo off but leaves the post stack (and lit windows and lamps themselves) as they are.
 */
export const GLOW_STEPS: readonly [value: string, label: string][] = [
  ['0', 'Off'],
  ['0.5', 'Soft'],
  ['1', 'Normal'],
  ['1.6', 'Strong'],
];

/** Bloom's strength for the tier (`on`), how far into night it is (0 … 1) and the Glow setting (#633). */
export function glowIntensity(on: boolean, night: number, glow = 1): number {
  const B = LOOK.bloom;
  return on ? B.intensity * (1 + (B.night - 1) * night) * Math.max(0, glow) : 0;
}
