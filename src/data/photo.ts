import type { WeatherKind } from './weather';

/**
 * E23.7.3 (#397): photo mode's own sky. `now` is the game's real weather; `golden` is golden hour: a low evening
 * sun on a clear day (it sets the time too). The rest are the seven weathers (#830: snow too).
 */
export type PhotoWeather = 'now' | 'golden' | WeatherKind;
export const PHOTO_WEATHERS: readonly PhotoWeather[] = ['now', 'sunny', 'golden', 'cloudy', 'rain', 'wind', 'storm', 'fog', 'snow'];
export const PHOTO_WEATHER_NAMES: Record<PhotoWeather, string> = { now: 'As it is', sunny: 'Sun', golden: 'Golden hour', cloudy: 'Cloud', rain: 'Rain', wind: 'Wind', storm: 'Storm', fog: 'Fog', snow: 'Snow' };
/** E23.7.3: filters over the picture (and the view while framing); the saved PNG gets the same one */
export type PhotoFilter = 'none' | 'warm' | 'cool' | 'faded' | 'mono' | 'vivid';
export const PHOTO_FILTERS: Record<PhotoFilter, { name: string; css: string }> = {
  none: { name: 'No filter', css: '' },
  warm: { name: 'Warm', css: 'sepia(0.25) saturate(1.15) hue-rotate(-8deg)' },
  cool: { name: 'Cool', css: 'saturate(0.9) hue-rotate(12deg) brightness(1.03)' },
  faded: { name: 'Faded', css: 'contrast(0.85) saturate(0.75) brightness(1.08)' },
  mono: { name: 'Black and white', css: 'grayscale(1) contrast(1.1)' },
  vivid: { name: 'Vivid', css: 'saturate(1.45) contrast(1.08)' },
};
/** golden hour: the last hour before dusk (22:00 in this game's day), when the sun is low and warm */
export const GOLDEN_HOUR = 21;

// ───────────── Photo mode 2 (#photo-2): the lens, the frame and bloombot's poses ─────────────

/**
 * The lens. `fov` is the vertical field of view in degrees (a wide lens takes in more and stretches depth, a long
 * one flattens it and brings the far city close); `roll` leans the horizon; `focus` is how far away the sharp
 * plane can be set by hand (world units: one is a tile); `blur` is the range of the blur disc's radius, from the
 * softest to the strongest setting, and `depth` how deep the sharp band is as a share of the focus distance (at the
 * softest and the strongest blur); `ev` is the brightness range in stops.
 */
export const PHOTO_LENS = {
  fovMin: 14,
  fovMax: 92,
  rollMax: 45,
  focusMin: 0.6,
  focusMax: 60,
  blur: [1.2, 9] as [number, number],
  depth: [1.6, 0.25] as [number, number],
  /** the sharp band is never thinner than this (bloombot is about half a unit across) */
  minDepth: 0.9,
  evMax: 2,
  /** the vignette at full strength, and its shape (it starts nearer the middle than the game's own, and is darker) */
  vignette: { intensity: 1, inner: 0.28, outer: 1.05, curvature: 0.5, color: '#0d0a08' },
};

/** The lens as photographers name it: the focal length on a 35 mm frame (24 mm tall) with this field of view. */
export function focalLength(fovDegrees: number): number {
  return Math.round(12 / Math.tan((fovDegrees * Math.PI) / 360));
}

/** The focus slider is even steps of distance ratio: 0 … 1 across focusMin … focusMax. */
export function focusFromSlider(t: number): number {
  const { focusMin: a, focusMax: b } = PHOTO_LENS;
  return a * Math.pow(b / a, Math.min(1, Math.max(0, t)));
}
export function focusToSlider(distance: number): number {
  const { focusMin: a, focusMax: b } = PHOTO_LENS;
  return Math.min(1, Math.max(0, Math.log(distance / a) / Math.log(b / a)));
}

/** The picture's shape: `ratio` is width over height (0: the whole screen). The saved picture is cut to it. */
export type PhotoFrame = 'screen' | 'wide' | 'film' | 'classic' | 'square' | 'portrait' | 'tall' | 'cinema';
export const PHOTO_FRAMES: Record<PhotoFrame, { name: string; ratio: number }> = {
  screen: { name: 'Whole screen', ratio: 0 },
  wide: { name: 'Wide 16:9', ratio: 16 / 9 },
  film: { name: 'Photo 3:2', ratio: 3 / 2 },
  classic: { name: 'Classic 4:3', ratio: 4 / 3 },
  square: { name: 'Square', ratio: 1 },
  portrait: { name: 'Portrait 4:5', ratio: 4 / 5 },
  tall: { name: 'Tall 9:16', ratio: 9 / 16 },
  cinema: { name: 'Cinema 21:9', ratio: 21 / 9 },
};

/** The biggest centred box of a shape inside a `w` × `h` view, in whole pixels (the whole view for ratio 0). */
export function frameRect(w: number, h: number, ratio: number): { x: number; y: number; w: number; h: number } {
  if (!(ratio > 0) || !(w > 0) || !(h > 0)) return { x: 0, y: 0, w, h };
  const fw = Math.min(w, Math.round(h * ratio));
  const fh = Math.min(h, Math.round(fw / ratio));
  return { x: Math.floor((w - fw) / 2), y: Math.floor((h - fh) / 2), w: fw, h: fh };
}

/** Guide lines over the frame while composing (never in the picture). */
export type PhotoGrid = 'none' | 'thirds' | 'centre' | 'diagonals';
export const PHOTO_GRIDS: Record<PhotoGrid, string> = { none: 'No guides', thirds: 'Thirds', centre: 'Centre lines', diagonals: 'Diagonals' };

/** How big the saved picture is: the screen's own pixels, or twice as many each way (drawn once, for the picture). */
export type PhotoSize = 'screen' | 'double';
export const PHOTO_SIZES: Record<PhotoSize, { name: string; scale: number }> = { screen: { name: 'Screen size', scale: 1 }, double: { name: 'Double size', scale: 2 } };
/** no side of a double-size picture is longer than this (a GPU's render target limit, with room to spare) */
export const PHOTO_MAX_SIDE = 4096;

/** Bloombot's poses: `stand` is whatever it was doing; the rest are its own clips, played on the spot. */
export type PhotoPose = 'stand' | 'cheer' | 'wave' | 'pulse';
export const PHOTO_POSES: Record<PhotoPose, string> = { stand: 'Standing', cheer: 'Cheer', wave: 'Wave', pulse: 'Pulse' };
/** Bloombot's visor faces (`auto`: its own) */
export type PhotoFace = 'auto' | 'happy' | 'surprised' | 'wink' | 'blink';
export const PHOTO_FACES: Record<PhotoFace, string> = { auto: 'Its own', happy: 'Happy', surprised: 'Surprised', wink: 'Wink', blink: 'Eyes closed' };
