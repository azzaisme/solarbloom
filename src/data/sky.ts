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
  /** straight up (on screen ~#5e9ee6 clear, a touch greyer while fogged) */
  zenith: ['#2a5fb8', '#1d59cb'],
  /** about 8° up (SKY_BANDS) (on screen ~#8ec3f0) */
  upper: ['#4a86cc', '#3f86da'],
  /** a pale band just above the horizon (on screen ~#c4dbef: blue, not cream) */
  glow: ['#8aaccc', '#8fb7dd'],
  /** the horizon and the distance (scene fog colour; as seen) */
  // P7-E27: cool pale blue haze (atmospheric perspective), not cream: the distance fades blue and the near scene stays clean
  haze: ['#c8d6e0', '#d6e4ee'],
  /** extra warmth in the sky toward the sun (on screen a soft warm ivory near the sun only) */
  sunGlow: ['#c9ccc4', '#ffe0af'],
  sunCore: '#fff7e2',
  cloudLit: ['#e7e9ea', '#ffffff'],
  cloudShade: ['#c4cdd8', '#d6e0ee'],
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
 * E23.7.5: the night sky's moon and stars. The moon's disc sits along the key light once it has swung round to the
 * moon's side; the stars are soft dots over the upper sky (seeded, so every night is the same sky) that come out as
 * the daylight goes and hide behind heavy cloud.
 */
export const NIGHT_SKY_LIGHTS = {
  /** the moon's disc, and how deep into night (0 … 1) it starts to show */
  moon: '#f1f5ff',
  moonFrom: 0.8,
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
  /** how far the sun swings either side of LOOK's heading over the day, degrees */
  swing: 70,
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
  /** the sun is warm (`lowSunColour`) below this height (0 horizon … 1 noon), easing to LOOK's colour above it */
  warmBelow: 0.45,
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
