import { POWER } from '../data/power';
import type { Sim } from './Sim';

/**
 * E23.3: what the grid needs to know about the sky. This is the ONE place power reads time of day and weather.
 *
 * It reads E23.7's handles when they exist (see e23-time's clock API):
 *   sim.clock.solarFactor()  0..1, night 0, includes the weather's solar share
 *   sim.clock.daylight()     0..1
 *   sim.clock.dayFraction()  0 dawn .. 2/3 dusk .. 1 (fallback for daylight)
 *   sim.weather.current()    { kind, wind, solar, rain }: kind 'sunny' | 'cloudy' | 'rain' | 'wind' | 'storm' | 'fog',
 *                            wind 0..1 (the turbine share)
 *   (sim.weather.kind() and .wind() are read too, if E23.7 offers them as methods)
 * With neither, it is always a clear day (E21 has no night) with a steady breeze, so the grid behaves as before.
 */
export interface PowerSky {
  /** 0 (night) .. 1 (full daylight). */
  sun: number;
  /** A solar panel's share of its full output right now (daylight × weather: cloud −20%). */
  solar: number;
  /** The sky is overcast (cloud, rain, storm, fog). */
  cloudy: boolean;
  /** 0 (still) .. 1 (storm): a turbine's share of its full output, before height and region. */
  wind: number;
  /** How much lights should be on, 0..1: dusk to dawn, or in fog and storms (lights fade with the sun). */
  dark: number;
}

interface ClockLike {
  solarFactor?: () => number;
  daylight?: () => number;
  dayFraction?: () => number;
}
interface WeatherNow {
  kind?: string;
  wind?: number;
}
interface WeatherLike {
  current?: () => WeatherNow | string | undefined;
  kind?: () => string | undefined;
  wind?: () => number | undefined;
}

const CLOUDY = new Set(['cloud', 'cloudy', 'overcast', 'rain', 'storm', 'fog']);
/** Wind by weather kind when the weather gives no number: turbines turn on windy days and in storms (a little in rain). */
const WIND: Record<string, number> = { wind: 0.75, windy: 0.75, storm: 1, rain: 0.3 };
const GLOOMY = new Set(['fog', 'storm']);

/** Daylight 0..1 from E23.7's day fraction (0 dawn, 2/3 dusk, 1 the next dawn), easing over a short twilight. */
export function sunAt(f: number): number {
  const x = ((f % 1) + 1) % 1;
  const dusk = 2 / 3;
  const ramp = 0.03;
  if (x < ramp) return 0.5 + (0.5 * x) / ramp;
  if (x > 1 - ramp) return (0.5 * (x - (1 - ramp))) / ramp;
  if (x >= dusk + ramp) return 0;
  if (x > dusk - ramp) return (dusk + ramp - x) / (2 * ramp);
  return 1;
}

export function readSky(sim: Sim): PowerSky {
  const s = sim as unknown as { clock?: ClockLike; weather?: WeatherLike };
  const c = s.clock;
  const w = s.weather;
  const now = w?.current?.();
  const cur: WeatherNow = typeof now === 'string' ? { kind: now } : (now ?? {});
  const kind = cur.kind ?? w?.kind?.() ?? 'sunny';
  const cloudy = CLOUDY.has(kind);
  const f = c?.dayFraction?.();
  const sun = c?.daylight?.() ?? (f === undefined ? 1 : sunAt(f));
  // E23.7's solar factor already includes the weather; without it, apply cloud here.
  const solar = c?.solarFactor?.() ?? sun * (cloudy ? POWER.solar.cloudFactor : 1);
  const wind = !w ? POWER.fallbackWind : (cur.wind ?? w.wind?.() ?? WIND[kind] ?? 0);
  return { sun, solar, cloudy, wind, dark: Math.max(1 - sun, GLOOMY.has(kind) ? 1 : 0) };
}
