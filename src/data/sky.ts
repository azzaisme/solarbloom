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
