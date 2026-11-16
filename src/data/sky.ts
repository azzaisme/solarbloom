/**
 * Look 4.7 / 4.8: sky, haze and skyline colours in one place, so lighting (Look 1) can grade against them.
 * Each pair is [fogged, clear]: the world starts greyed under the fog and clears as areas are woken
 * (`Sky.clarity`, 0 … 1). The haze colour is also the scene fog colour and the sky's colour at the horizon,
 * so the ground fades seamlessly into the sky.
 */
export const SKY = {
  /** straight up */
  zenith: ['#97a3b0', '#5aa4e4'],
  /** about 25° up */
  upper: ['#b1bac2', '#9ccbef'],
  /** a warm band just above the horizon */
  glow: ['#cfcfc8', '#fbe6c4'],
  /** the horizon and the distance (scene fog colour) */
  haze: ['#c3c8c8', '#d9e8e8'],
  /** extra warmth in the sky toward the sun */
  sunGlow: ['#d8d4c8', '#ffe0a8'],
  sunCore: '#fff7e2',
  cloudLit: ['#e7e9ea', '#ffffff'],
  cloudShade: ['#b4bac0', '#dfe8f2'],
  /** distant skyline silhouettes: stone, greenery, glass, water; each layer is hazed toward `haze` */
  stone: ['#9a9d9c', '#d8ccb6'],
  green: ['#8d978f', '#6dbb5a'],
  glass: ['#a3adb4', '#86c8e2'],
  water: ['#b5bdc2', '#bfeaff'],
  glowWarm: ['#9a9a92', '#ffd36a'],
} as const;

/** Haze reach (world units past the camera target) as a function of how near the view is (0 far … 1 near). */
export const HAZE = {
  start: [8, 4],
  end: [52, 40],
};
