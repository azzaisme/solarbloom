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
