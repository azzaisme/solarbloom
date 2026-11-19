import { DAY_SECONDS } from '../data/time';
import { WEATHER, WEATHER_KINDS, WEATHER_ODDS, WEATHER_RULES, WEATHER_WORDS, type WeatherEffects, type WeatherKind } from '../data/weather';
import type { Rng } from '../core/Rng';
import type { Sim } from './Sim';

/** What a storm's lightning needs from the grid (E23.3): trip one pole, which bloombot resets with one press. */
interface PowerLike {
  trip?(rng: Rng): string | undefined;
}

/**
 * E23.7.2 (#396): the weather. One kind per game day, picked at dawn from the seed and the day number, so it never
 * depends on what the player did and the forecast (`forecast()`, tomorrow's) is always right. Every effect is a row
 * in data/weather; systems read the share they care about (`solar()`, `wind()`, `rain()`, `bloomSpeed()`, ...).
 * Nothing the weather does ever destroys anything: a storm's lightning can only trip a power pole.
 *
 * Read through `sim.weather`.
 */
export class Weather {
  private forced?: { kind: WeatherKind; until: number };
  private lastDay = 0;
  private lastKind?: WeatherKind;
  /** the first tick after loading (past strikes are skipped) */
  private fresh = true;
  private struck = new Set<string>();

  constructor(private sim: Sim) {}


  /** The weather on a game day (deterministic: the seed and the day). */
  kindOn(day: number): WeatherKind {
    if (day <= 1) return WEATHER_RULES.firstDay;
    const raw = rawKind(this.sim.state.seed, day);
    if (raw === 'storm' && (day < WEATHER_RULES.noStormBeforeDay || rawKind(this.sim.state.seed, day - 1) === 'storm')) return 'rain';
    return raw;
  }

  /** The weather now. */
  kind(): WeatherKind {
    if (this.forced && this.sim.state.time < this.forced.until) return this.forced.kind;
    return this.kindOn(this.sim.clock.gameDay());
  }

  /** Tomorrow's weather: what the forecast at the house says. */
  forecast(): WeatherKind {
    return this.kindOn(this.sim.clock.gameDay() + 1);
  }

  /** The whole row of effects now. */
  effects(): WeatherEffects {
    return WEATHER[this.kind()];
  }

  /** Solar share (folded into `sim.clock.solarFactor()`). */
  solar(): number {
    return this.effects().solar;
  }

  /** Wind turbine share, 0 … 1. */
  wind(): number {
    return this.effects().wind;
  }

  /** Rain falling now (0 dry, 1 steady rain, 2 a storm's downpour). */
  rain(): number {
    return this.effects().rain;
  }

  bloomSpeed(): number {
    return this.effects().bloomSpeed;
  }

  /** For the grid (E23.3's PowerEnv reads `current()`). */
  current(): { kind: WeatherKind; wind: number; solar: number; rain: number } {
    const e = this.effects();
    return { kind: this.kind(), wind: e.wind, solar: e.solar, rain: e.rain };
  }

  /** The weather's name ("Rain"). */
  label(): string {
    return WEATHER_WORDS[this.kind()].name;
  }

  /** Test hook (E23.10): hold a weather for some seconds of sim time. */
  forceForTest(kind: WeatherKind, seconds: number) {
    this.forced = { kind, until: this.sim.state.time + seconds };
    this.tick(); // a forced storm blows in at once
  }

  /** The times of day (fractions of the game day) lightning strikes on a day with this weather. */
  strikesOn(day: number, kind: WeatherKind = this.kindOn(day)): number[] {
    const n = WEATHER[kind].lightning;
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(0.1 + 0.8 * hash01(this.sim.state.seed ^ 0x51ed, day * 7 + i));
    return out.sort((a, b) => a - b);
  }

  /** Per sim step: a new day's weather (and a storm blowing in), lightning at its times. */
  tick() {
    const s = this.sim;
    const day = s.clock.gameDay();
    const kind = this.kind();
    if (day !== this.lastDay || kind !== this.lastKind) {
      const first = this.lastDay === 0 && !this.forced;
      const newDay = day !== this.lastDay;
      this.lastDay = day;
      this.lastKind = kind;
      if (newDay) this.struck.clear();
      if (!first) {
        s.bus.emit('weather.changed', { kind, day });
        if (WEATHER[kind].blowsInSalvage) s.bus.emit('weather.storm', { day });
      }
    }
    const strikes = this.strikesOn(day, kind);
    const g = s.clock.gameSeconds() / DAY_SECONDS;
    const f = g - Math.floor(g);
    for (let i = 0; i < strikes.length; i++) {
      const key = `${day}:${i}`;
      // a strike that passed before the game loaded (or before sleeping skipped over it) doesn't fire late
      if (this.fresh && f >= strikes[i]) this.struck.add(key);
      if (f >= strikes[i] && !this.struck.has(key)) {
        this.struck.add(key);
        // E23.3's grid trips one working pole (deterministic: the sim's own rng); one press resets it
        const pole = (s as unknown as { power?: PowerLike }).power?.trip?.(s.rng);
        s.bus.emit('weather.lightning', { day, poleId: pole });
      }
    }
    this.fresh = false;
  }
}

/** A day's weather before the rules (weighted by WEATHER_ODDS). */
function rawKind(seed: number, day: number): WeatherKind {
  const total = WEATHER_KINDS.reduce((a, k) => a + WEATHER_ODDS[k], 0);
  let r = hash01(seed, day) * total;
  for (const k of WEATHER_KINDS) {
    r -= WEATHER_ODDS[k];
    if (r < 0) return k;
  }
  return 'sunny';
}

/** 0 … 1 from a seed and a number (mulberry32 on the pair). */
export function hash01(seed: number, n: number): number {
  let t = (seed ^ Math.imul(n + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  t = (t + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
