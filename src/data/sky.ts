/**
 * Look 4.7 / 4.8: sky, haze and skyline colours in one place, so lighting (Look 1) can grade against them.
 * Each pair is [fogged, clear]: the world starts greyed under the fog and clears as areas are woken
 * (`Sky.clarity`, 0 … 1). The haze colour is also the scene fog colour and the sky's colour at the horizon,
 * so the ground fades seamlessly into the sky.
 */
export const SKY = {
  /** straight up */
  zenith: ['#97a3b0', '#78afe6'],
  /** about 25° up */
  upper: ['#b1bac2', '#a4cdee'],
  /** a warm band just above the horizon */
  glow: ['#cfcfc8', '#f6e2c0'],
  /** the horizon and the distance (scene fog colour) */
  haze: ['#c3c8c8', '#e6e2d4'],
  /** extra warmth in the sky toward the sun */
  sunGlow: ['#d8d4c8', '#ffe0a8'],
  sunCore: '#fff7e2',
  cloudLit: ['#e7e9ea', '#ffffff'],
  cloudShade: ['#b4bac0', '#dde3ee'],
  /** distant skyline silhouettes: stone, greenery, glass, water; each layer is hazed toward `haze` */
  stone: ['#9a9d9c', '#e9e1cf'],
  green: ['#8d978f', '#a9c98a'],
  glass: ['#a3adb4', '#bcd6e4'],
  water: ['#b5bdc2', '#bfeaff'],
  glowWarm: ['#9a9a92', '#ffd36a'],
} as const;

/**
 * Haze reach (world units past the camera target) as a function of how near the view is (0 far … 1 near). Close
 * up it reaches far enough that the real city's buildings carry out to the foot of the distant skyline.
 */
export const HAZE = {
  start: [8, 6],
  end: [56, 76],
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
  night: { haze: '#2b3858', glow: '#31406a', upper: '#1f2c4e', zenith: '#121c38', sun: '#3a4a78', cloud: '#3a4668' },
} as const;

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
  moonColour: '#a8bce8',
  moonShare: 0.12,
  /** the sun's colour when low (dawn and dusk) */
  lowSunColour: '#ffb27a',
  /** night shares of the fill light and the ambient environment */
  fillNight: 0.3,
  envNight: 0.16,
  /** exposure at night, as a share of LOOK's (the eye adjusts a little, but night stays night) */
  exposureNight: 0.72,
  fillNightColour: '#8fa4d8',
  /** the unlit clouds' tint at night (linear 0–1 multipliers) */
  cloudNight: [0.3, 0.34, 0.48] as [number, number, number],
  /** the warm rim on silhouettes at night */
  rimNight: 0.25,
};
