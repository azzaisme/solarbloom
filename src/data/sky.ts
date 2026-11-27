/**
 * Look 4.7: sky and haze colours in one place, so lighting (Look 1) can grade against them.
 * Each pair is [fogged, clear]: the world starts greyed under the fog and clears as areas are woken
 * (`Sky.clarity`, 0 … 1). The haze colour is also the scene fog colour and the sky's colour at the horizon,
 * so the ground fades seamlessly into the sky. E27.1: the fogged sky keeps a soft blue overhead and a little warmth
 * low down, so a new game reads as a hazy sunny day, not an overcast one; the full clear blue comes with restoration.
 */
export const SKY = {
  // P7-E27.3 (#721): the dome's vertex colours are encoded to sRGB once more on output (they are not decoded first, as
  // material colours are), so a dome hex lands on screen roughly as its sRGB encoding: #3f86da shows as about
  // #8ec3f0. The night sky was approved against this, so the day values are authored to compensate (target on
  // screen in each comment) rather than changing the pipeline. `haze` is the exception: it is also the scene fog,
  // which the engine decodes, and Sky.horizonSeen decodes it for the dome, so it is written as seen.
  // #sky-blue: the day sky deepened to a saturated cobalt overhead and a clear azure lower down (it read pale and
  // washed out). Written decoded, so each lands on screen as the target in its comment: [fogged, clear].
  /** straight up (on screen #3a6cc4 fogged, #1d5fd8 clear) */
  zenith: ['#0a278f', '#021db1'],
  /** about 8° up (SKY_BANDS) (on screen #5a96dc, #3a8eea) */
  upper: ['#1a4fb8', '#0a46d3'],
  /** a pale band just above the horizon (on screen #a8c8e4, #9ccbf2: blue, not cream) */
  glow: ['#6695c7', '#579ae3'],
  /** the horizon and the distance (scene fog colour; as seen) */
  // P7-E27: cool pale blue haze (atmospheric perspective), not cream: the distance fades blue and the near scene stays clean
  haze: ['#c8d6e0', '#d6e4ee'],
  /** extra warmth in the sky toward the sun (on screen a soft warm ivory near the sun only) */
  sunGlow: ['#c9ccc4', '#ffe0af'],
  /** #painted-clouds: warm ivory where the clouds face the sun (on screen #f2f0ea fogged, #fff6e6 clear) */
  cloudLit: ['#e3dfd3', '#ffeccb'],
  /** the clouds' bodies, a soft blue-grey (on screen #c8cfd8, #b9c7da) */
  cloudShade: ['#95a1b1', '#7e94b5'],
} as const;

/**
 * E27.1 (#679): where the dome's bands sit (degrees above the horizon). The follow camera sees only the lowest 15° or
 * so of sky, and with the blue starting at 25° all it showed was the warm glow band, which tone mapping turned a flat
 * grey-white: an overcast look on a sunny day. Now the warm band hugs the horizon and the sky is blue by about 12°.
 */
// P7-E27: blue from lower down (upper 12° → 8°, zenith 60° → 45°): the low follow camera sees only ~17° of sky
export const SKY_BANDS = { glow: 3, upper: 8, zenith: 45 };
/** The bands the approved moonlit night was tuned with: the dome eases back to these as night falls. */
export const SKY_BANDS_NIGHT = { glow: 4, upper: 25, zenith: 90 };

/**
 * #painted-clouds: the clouds (PaintedClouds.ts): one painted cloud field, drawn on the sky and, zoomed out, as a
 * sheet high over the city. Broad, drawn-out formations with wispy edges and open blue sky between them, drifting
 * very slowly.
 */
export const CLOUDS = {
  /** where the cloud starts in the field (higher: less cloud) and how soft its edges are */
  cover: 0.56,
  softness: 0.15,
  /** how much more of the sky heavy cloud covers (overcast 1) */
  overcastCover: 0.32,
  /** the field's scale on the sky's ceiling (higher: smaller formations) and how far they are drawn out along the wind */
  scale: 0.42,
  stretch: 2.1,
  /** how far the ceiling bends down to the horizon: higher keeps far formations broad instead of crowding into
   * slivers (the follow camera sees mostly the lowest 25° of sky) */
  flatness: 0.22,
  /** how strongly the edges tear into wisps */
  wisps: 0.38,
  /** the silver glow through thin cloud round the sun */
  sunGlow: 0.45,
  /** the sky's clouds thin away over the lowest `horizonFade` (sine of the elevation) and take the horizon's colour
   * over the lowest `horizonHaze` */
  horizonFade: 0.04,
  horizonHaze: 0.16,
  /** how solid the thickest cloud is */
  opacity: 0.94,
  /** drift, ceiling units a second (very slow) and the wind's share on top */
  drift: [0.0045, 0.0012] as [number, number],
  wind: 4,
  /** the zoomed-out sheet: field scale per world unit, how solid it is, and how dark its shadow on the ground is */
  layer: { scale: 0.045, opacity: 0.32, shadow: 0.3 },
} as const;

/**
 * Haze reach (world units past the camera target) as a function of how near the view is (0 far … 1 near). Close
 * up it reaches far enough that the real city's buildings carry out toward the horizon.
 */
export const HAZE = {
  // P7-E27.5: the haze starts and completes further out (was 8/6 → 56/76), so the playable island near the camera stays
  // crisp and only the distance fades
  start: [12, 10],
  end: [64, 88],
};

/**
 * Bloombot (G.18): in the close follow view (zoom past the old default) the horizon is always on screen, so each
 * graphics tier draws a shorter way out: the haze ends this share of HAZE.end sooner, and the far clip with it,
 * so the cut-off sits inside thick haze. Same camera on every tier.
 */
export const CLOSE_VIEW_REACH: Record<'high' | 'medium' | 'low', number> = { high: 1, medium: 0.78, low: 0.6 };

/**
 * E23.7.1: the sky at dusk (a warm band low down) and at night (a deep, calm blue: night is cosy, never black).
 * DayNight blends the day sky toward these by the light clock; `sun` tints the sun's glow, `cloud` the clouds.
 */
export const NIGHT_SKY = {
  dusk: { haze: '#e8b994', glow: '#f2a477', upper: '#c9a3b8', zenith: '#5d6f9c', sun: '#ff9a5c', cloud: '#f0b8a0' },
  // E23.7.5: a moonlit night: a clear deep blue all the way down, never grey and never black
  night: { haze: '#33487c', glow: '#3a5290', upper: '#27407c', zenith: '#16265a', sun: '#6f8fd8', cloud: '#4a5f96' },
} as const;

/**
 * E23.7.5: the night sky's stars (the moon is SUN_MOON's): soft dots over the upper sky (seeded, so every night is
 * the same sky) that come out as the daylight goes and hide behind heavy cloud.
 */
export const NIGHT_SKY_LIGHTS = {
  stars: {
    count: 260,
    /** lowest elevation, degrees (the clouds and the haze keep the horizon) */
    above: 20,
    /** angular radius, radians: smallest and largest */
    size: [0.0035, 0.008] as [number, number],
    colours: ['#ffffff', '#dfe8ff', '#fff1d6'],
    /** how deep into night (0 … 1) they start to show */
    from: 0.55,
    seed: 23,
  },
} as const;

/**
 * #sunsets: the sun and the moon as things in the sky, each on its own path (DayNight), not just the key light.
 * The sun's disc follows a true arc: it touches the horizon at dusk and sinks below it (cut flat by the horizon as it
 * goes), while the key light stays at DAY_LIGHT.sunLow so the shadows never go flat. As it gets low the sky round it
 * turns gold and orange to rose (`sunset`), and the sea lays a golden path under it (LOOK.water.sunPath).
 * The moon rises as night falls and crosses low over the sea (`low` … `high` degrees up, so the follow camera sees
 * it), along the heading of the moonlight, with darker seas on its face. Sizes are angular radii in radians.
 *
 * The dome's colours land on screen brighter than written (see SKY), so the sunset colours are authored deep.
 */
export const SUN_MOON = {
  sun: {
    radius: 0.04,
    /** emissive strength of the disc: tone mapping dulls a plain white to cream, so it is lit past 1 (and blooms) */
    bright: 3.2,
    /**
     * the disc's colour high up and on the horizon: it stays near white even when low (only a warm tint), so the sun
     * reads by standing out from the deeper orange round it
     */
    core: '#ffffff',
    low: '#fff0c4',
    /** the glow and rim round it on the horizon */
    lowGlow: '#ff4a08',
  },
  sunset: {
    /** the sun starts to colour the sky below this elevation (degrees) and has stopped by `under` below the horizon */
    from: 16,
    under: 7,
    /** how high the warm band reaches up the sky (degrees), and how strongly it colours it */
    height: 24,
    strength: 0.8,
    /** gold near the sun, orange along the horizon on its side, rose further round */
    gold: '#ff7a1c',
    orange: '#f2602a',
    rose: '#c8587a',
    /**
     * #sky-clouds: the low sun lights the clouds from below: gold-orange undersides toward it, rose further round,
     * under dusky mauve-grey crowns (as seen)
     */
    cloudUnder: '#ff8a3a',
    cloudUnderFar: '#e85c84',
    cloudTop: '#6e5a86',
  },
  moon: {
    radius: 0.034,
    bright: 1.3,
    colour: '#eef2ff',
    /** its darker seas */
    maria: '#6f7ba6',
    halo: '#8fa6ef',
    /** degrees above the horizon at moonrise and set, and at midnight */
    low: 5,
    high: 20,
    /** how deep into night (0 … 1) it starts to show */
    from: 0.8,
  },
} as const;

/**
 * #twilight: the afterglow. For a few minutes after the sun has gone under (and before it comes up) the sky glows:
 * an orange line on the horizon on the sun's side, hot magenta above it, purple higher up and deep violet overhead,
 * with the far side of the sky a darker blue-violet. The clouds go dark against it, the land goes dusky with a pink
 * edge of light, and the sea mirrors it. Then the approved blue moonlit night takes over.
 *
 * It follows the sun disc's elevation (degrees, DayNight.sunEl): it comes in from `rise` above the horizon, is full
 * from `peak` to `hold` below it, and has gone by `end` below. Heavy cloud mutes it (`cloud`: share lost at overcast 1).
 *
 * The sky's colours (`sky`, `cloud`) are written as they should look on screen: Sky decodes them before drawing, so
 * they keep their saturation (see SKY on the dome's colours landing paler than written). `haze` is the scene fog.
 */
export const TWILIGHT = {
  rise: 3,
  peak: -1,
  hold: -5,
  end: -14,
  /** how far over the sky's own colours it is laid at its height */
  strength: 0.92,
  cloud: 0.7,
  sky: {
    /** the horizon on the sun's side, and round the far side */
    horizon: '#ff9a3c',
    /** right under where the sun went down: a hot gold glow low on the horizon */
    glow: '#ffc463',
    horizonFar: '#5a3cb4',
    /** the band above it (about `bandAt` degrees up), the sun's side and the far side */
    band: '#ff4fa6',
    bandFar: '#6a36c8',
    bandAt: 4,
    /** purple partway up (`midAt` degrees), and the deep violet overhead */
    mid: '#9b36dc',
    midFar: '#4a2cb4',
    midAt: 13,
    top: '#3a1a9e',
    /** where the violet overhead is reached (degrees) */
    topAt: 42,
    /** how wide round the horizon the sun's side reaches (0 just toward the sun … 1 all the way round) */
    spread: 0.55,
  },
  /** the scene fog and the far distance (as seen) */
  haze: '#4f3a8e',
  /** the sky's clouds, lit from below by the sun under the horizon: magenta undersides (toward it, and round the far
   * side) under dusky violet crowns (as seen) */
  cloudUnder: '#ff5c9c',
  cloudUnderFar: '#b0509a',
  cloudTop: '#3c2a70',
  /** the world's unlit clouds and fog sheets (linear 0–1 multipliers) */
  cloudTint: [0.4, 0.3, 0.6] as [number, number, number],
  /** the sea's reflection: low over the horizon and higher up (0–1 sRGB) */
  seaLow: '#e2508e',
  seaHigh: '#4a2aa8',
  /** the light: the key light goes a low pink and dims, the fill turns violet, the ambient dims and turns purple */
  light: '#c070b0',
  lightKeep: 0.22,
  fill: '#7a4ae6',
  envKeep: 0.6,
  env: { zenith: '#3a2490', horizon: '#6a3a9a', ground: '#1e1440' },
  /** the rim on silhouettes turns pink and stronger (a share of LOOK.rim.intensity) */
  rim: '#ff5fa8',
  rimShare: 1.1,
} as const;

/**
 * P7-E27.6 (#724): the three named lighting presets, as moments of the existing day/night cycle (DayNight, DAY_LIGHT,
 * NIGHT_SKY) rather than a system of their own. Each is an authored look: Bright Day is the benchmark (the sun near
 * the top of its arc, 35–50° up); Golden Hour is the low warm sun (DAY_LIGHT.lowSunColour below warmBelow, the dusk
 * sky band); Moonlit Garden is the approved moonlit night (#685). `f` is the day fraction; the fixed-camera shots
 * (tests/e2e/lib/p7-scene.mjs TIMES) and the dev lighting panel use the same moments.
 */
export const LIGHT_PRESETS = {
  brightDay: { label: 'Bright Day', f: 0.3 },
  goldenHour: { label: 'Golden Hour', f: 0.6 },
  moonlitGarden: { label: 'Moonlit Garden', f: 0.83 },
} as const;
export type LightPresetName = keyof typeof LIGHT_PRESETS;

/**
 * E23.7.1: the light through the day. The key light follows the sun's arc by day (from low in the east to low in
 * the west, never overhead, so the golden-hour look holds most of the day) and becomes a cool moon by night.
 * Shares are of LOOK's values (1 = the golden-hour look as tuned).
 */
export const DAY_LIGHT = {
  /** sun elevation in degrees at the horizon and at noon */
  sunLow: 8,
  sunHigh: 50,
  /** how far the sun swings either side of LOOK's heading over the day, degrees (the morning side) */
  swing: 70,
  /**
   * #sunsets: the afternoon keeps swinging past `swing`, to `setSwing` degrees from noon by sunset, so the sun goes down
   * over the open sea straight out from the jetty (bearing 0, +z: RUINS keeps 345°–15° clear of headlands). The extra
   * swing starts after `setFrom` of the afternoon and eases in and out, so the morning and early afternoon light are as
   * they were and the sun sinks into the sea rather than sliding along the horizon.
   */
  setSwing: 197,
  setFrom: 0.2,
  /** #sunsets: at sunset the sea warms: its night darkening eases off by this share, and it reflects the sunset sky */
  seaWarm: 0.55,
  /** the moon: elevation, colour and the share of the sun's intensity it gives */
  moonElevation: 42,
  /** E23.7.5: night is lit, not dimmed: a strong blue moon as the key light (it throws soft shadows) */
  moonColour: '#6d92ff',
  /**
   * E27.1 (#679): night's own light strengths, not shares of the day's: the day's sun, fill and ambient can be
   * retuned without touching the approved moonlit night. (These are the strengths E23.7.5 tuned night to.)
   */
  moonIntensity: 1.02,
  /** how fast the key light swings from the sun's side to the moon's as daylight goes (higher = later, quicker) */
  moonBlend: 1.6,
  /**
   * the sun is warm (`lowSunColour`) below this height (0 horizon … 1 noon), easing to LOOK's colour above it.
   * P7-E27.6 (#724): 0.45 → 0.6, so Golden Hour (LIGHT_PRESETS) has a golden key light, not a pale one
   */
  warmBelow: 0.6,
  /**
   * P7-E27.6 (#724): how far from the horizon (in twilight lengths, DAY.twilight) the sky's warm dusk band reaches
   * (was a fixed 2, so Golden Hour's sky stayed noon-blue). Night's colours are untouched: they follow the daylight
   */
  duskSpan: 3,
  /** the sun's colour when low (dawn and dusk) */
  lowSunColour: '#ffb27a',
  /** night's fill light and ambient environment strengths */
  fillNight: 0.36,
  envNight: 0.805,
  fillNightColour: '#4f70e0',
  /**
   * E23.7.5: the ambient environment by night (LOOK.env's three colours by day): cool blue from the sky, the
   * horizon and the ground, so faces the moon misses stay readable and blue. The environment is re-baked in
   * `envSteps` steps through dusk and dawn. Night keeps LOOK's exposure: it is built from light and colour.
   */
  envNightColours: { zenith: '#4268d8', horizon: '#3350b0', ground: '#1c2c66' },
  envSteps: 16,
  /** the unlit clouds' tint at night (linear 0–1 multipliers) */
  cloudNight: [0.3, 0.34, 0.48] as [number, number, number],
  /** the warm rim on silhouettes at night (its strength, as LOOK.rim.intensity is by day) */
  rimNight: 0.65,
};
