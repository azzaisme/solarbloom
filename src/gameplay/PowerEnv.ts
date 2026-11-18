import { GROUND } from '../core/GameState';
import { regionOfCell } from '../core/OldCityLayout';
import type { MachineData } from '../core/types';
import { POWER } from '../data/power';
import type { Sim } from './Sim';

/**
 * E23.3: what the grid needs to know about the sky. This is the ONE place power reads time of day and weather,
 * so E23.7's clock and weather plug in here.
 *
 * Until E23.7 lands it reads, if present, `sim.clock?.dayFraction()` (0..1, 0 = midnight) and
 * `sim.weather?.current()` (a kind string). With neither, it is always a clear, still day (the world has no
 * night yet), so the grid behaves exactly as before.
 */
export interface PowerSky {
  /** 0 (night) .. 1 (full sun), before cloud. */
  sun: number;
  /** The sky is overcast (cloud, rain, storm, fog): solar −20%. */
  cloudy: boolean;
  /** 0 (still) .. 1 (storm). */
  wind: number;
  /** Lights should be on (dusk to dawn, or fog and storms), 0..1 so lights fade in and out with the sun. */
  dark: number;
}

interface ClockLike {
  dayFraction?: () => number;
}
interface WeatherLike {
  current?: () => string | { kind?: string; wind?: number } | undefined;
}

/** A source's region strength multiplier (E23.8 owns this; a provisional table until then). */
export function regionBoost(sim: Sim, m: MachineData, kind: 'wind' | 'solar'): number {
  const r = (sim as unknown as { regions?: { strength?: (m: MachineData, kind: string) => number | undefined } }).regions;
  const v = r?.strength?.(m, kind);
  if (typeof v === 'number') return v;
  if (m.roofId !== GROUND || !sim.oldCity) return 1;
  const id = regionOfCell(m.x, m.z)?.id;
  return id && POWER.regionStrengths[kind].includes(id) ? POWER.regionBoost : 1;
}

/** How high a machine stands, in terrace levels (rooftops count as high ground). */
export function groundLevel(sim: Sim, m: MachineData): number {
  if (m.roofId !== GROUND) return POWER.wind.roofLevel;
  return sim.grid.get(GROUND, m.x, m.z)?.level ?? 0;
}

const CLOUDY = new Set(['cloud', 'cloudy', 'overcast', 'rain', 'drizzle', 'storm', 'fog', 'mist']);
/** Wind by weather kind: turbines only turn on windy days and in storms (and a little in rain). */
const WIND: Record<string, number> = { windy: 0.75, wind: 0.75, gale: 0.9, storm: 1, rain: 0.3 };
const GLOOMY = new Set(['fog', 'mist', 'storm']);

/** Daylight 0..1 from a day fraction: dark before 0.25 (6:00) and after 0.79 (19:00), ramps over ~45 min of clock. */
export function sunAt(f: number): number {
  const ramp = 0.03;
  const rise = 0.25;
  const set = 0.79;
  const x = ((f % 1) + 1) % 1;
  if (x <= rise - ramp || x >= set + ramp) return 0;
  if (x < rise + ramp) return (x - (rise - ramp)) / (2 * ramp);
  if (x > set - ramp) return ((set + ramp) - x) / (2 * ramp);
  return 1;
}

export function readSky(sim: Sim): PowerSky {
  const s = sim as unknown as { clock?: ClockLike; weather?: WeatherLike };
  const f = s.clock?.dayFraction?.();
  const sun = f === undefined ? 1 : sunAt(f);
  const w = s.weather?.current?.();
  const kind = typeof w === 'string' ? w : (w?.kind ?? 'clear');
  // No weather system yet (before E23.7): a steady breeze, so turbines can be built and seen working.
  const wind = !s.weather ? POWER.fallbackWind : typeof w === 'object' && w && typeof w.wind === 'number' ? w.wind : (WIND[kind] ?? 0);
  const gloom = GLOOMY.has(kind) ? 1 : 0;
  return { sun, cloudy: CLOUDY.has(kind), wind, dark: Math.max(1 - sun, gloom) };
}
