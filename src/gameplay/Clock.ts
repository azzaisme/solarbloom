import type { ClockState, GameState } from '../core/types';
import { DAY, DAY_SECONDS } from '../data/time';
import type { Sim } from './Sim';

/** What sleeping needs from bloombot's charge (E23.2.1). */
interface ChargeLike {
  sleep?(): void;
}

/**
 * E23.7.1 (#395): the game-day clock. One clock that every timer uses.
 *
 * Two clocks live here, and they only differ in "follow my clock" mode:
 * - **The game clock** (`gameDay`, `gameSeconds`, `elapsedDays`): sim time plus the offset sleeping adds. Every
 *   timer counts on it, in game days (data/time `gameDays`), in both modes, so a crop takes the same play time
 *   whichever mode is on.
 * - **The light clock** (`dayFraction`, `isDay`, `isNight`, `sunHeight`, `daylight`, `solarFactor`, `hour`): what
 *   time of day it looks like. In the game's own day it is the game clock; in "follow my clock" mode it is the
 *   real local time (06:00 is dawn, 22:00 dusk: the same 2:1 split as the 32 + 16 minute game day).
 *
 * Fraction 0 is dawn; `DAY.dayShare` (2/3) is dusk; 1 is the next dawn.
 *
 * Read through `sim.clock`. The world pauses when the game is closed or paused, so the game clock does too.
 */
export class Clock {
  /** the real clock (tests set their own) */
  now: () => Date = () => new Date();
  private wasDay?: boolean;

  constructor(private sim: Sim) {}

  private get st(): ClockState | undefined {
    return this.sim.state.clock;
  }

  /** Writable clock state (made on first write, so saves without it stay as they were). */
  private get writable(): ClockState {
    return (this.sim.state.clock ??= { offset: startOffset() });
  }

  // ───────────── the game clock (timers) ─────────────

  /** Game seconds since the first dawn: sim time plus what sleeping skipped. */
  gameSeconds(): number {
    return gameSecondsOf(this.sim.state);
  }

  /** The game day, from 1. Always the game clock, in both modes. */
  gameDay(): number {
    return gameDayOf(this.sim.state);
  }

  /** Game days of play so far (sim time in game days: what timers count; sleeping doesn't add to it). */
  get days(): number {
    return this.sim.state.time / DAY_SECONDS;
  }

  /**
   * Where the GAME day is (0 dawn … 2/3 dusk … 1), ignoring "follow my clock". Growth and other timers that care
   * about day and night (night-only crops, E23.5) read this, so they take the same play time in both modes.
   */
  gameDayFraction(): number {
    return gameFraction(this.sim.state);
  }

  /** Is it night on the game clock (whatever the sky shows in "follow my clock" mode)? */
  gameIsNight(): boolean {
    return this.gameDayFraction() >= DAY.dayShare;
  }

  gameIsDay(): boolean {
    return !this.gameIsNight();
  }

  /** Game days of play since `since` (sim time), for timers: `clock.elapsedDays(t0) >= 2`. */
  elapsedDays(since: number): number {
    return (this.sim.state.time - since) / DAY_SECONDS;
  }

  // ───────────── the light clock (sky, light, solar) ─────────────

  /** "Follow my clock": sky, light and solar follow the real clock. */
  get real(): boolean {
    return !!this.st?.real;
  }

  set real(on: boolean) {
    if (on === this.real) return;
    this.writable.real = on || undefined;
    this.sim.bus.emit('clock.mode', { real: on });
  }

  /** Where the day is, 0 (dawn) … 2/3 (dusk) … 1. Follows the real clock in "follow my clock" mode. */
  dayFraction(): number {
    return this.real ? realFraction(this.now()) : gameFraction(this.sim.state);
  }

  /** Daylight (from dawn to dusk). */
  isDay(): boolean {
    return this.dayFraction() < DAY.dayShare;
  }

  isNight(): boolean {
    return !this.isDay();
  }

  /** How high the sun is, 0 (on the horizon, or night) … 1 (noon). */
  sunHeight(): number {
    return sunHeightAt(this.dayFraction());
  }

  /** How light it is, 0 (deep night) … 1 (full day), with a short dawn and dusk either side of the horizon. */
  daylight(): number {
    return daylightAt(this.dayFraction());
  }

  /**
   * Solar output now, 0 … 1: zero at night, ramping up through the morning and down through the evening, times
   * the weather's solar share (E23.7.2). The grid (E23.3) multiplies a panel's output by this.
   */
  solarFactor(): number {
    return solarAt(this.dayFraction()) * (this.sim.weather?.solar() ?? 1);
  }

  /** The clock face: hours and minutes (06:00 is dawn). */
  hour(): number {
    return Math.floor(clockHours(this.dayFraction()));
  }

  minute(): number {
    return Math.floor((clockHours(this.dayFraction()) % 1) * 60);
  }

  // ───────────── sleeping ─────────────

  /** Bloombot may sleep from dusk until dawn. */
  canSleep(): boolean {
    return this.dayFraction() >= DAY.dayShare - DAY.twilight;
  }

  /**
   * E23.7.1.3: sleeps in the house to the next morning with a full charge. In the game's own day the clock skips
   * ahead to just after dawn (timers don't run while asleep: nothing is skipped but the dark). In "follow my clock"
   * mode the sky can't be hurried, so sleeping is a rest: a full charge, and the night carries on.
   */
  sleep(): boolean {
    if (!this.canSleep()) return false;
    const s = this.sim;
    const from = this.gameDay();
    if (!this.real) {
      const f = gameFraction(s.state);
      const skip = (1 - f + DAY.wakeFraction) * DAY_SECONDS;
      this.writable.offset += skip;
    }
    // E23.2.1 owns the charge (`sim.charge.sleep()`: full); coded against a small optional interface until it lands
    (s as unknown as { charge?: ChargeLike }).charge?.sleep?.();
    s.bus.emit('clock.slept', { from, day: this.gameDay(), real: this.real });
    this.tick(); // dawn arrives at once
    return true;
  }

  /** Per sim step: dawn and dusk events. */
  tick() {
    const day = this.isDay();
    if (this.wasDay !== undefined && day !== this.wasDay) this.sim.bus.emit(day ? 'clock.dawn' : 'clock.dusk', { day: this.gameDay() });
    this.wasDay = day;
  }
}

/** A new game starts on a fresh morning. */
export function startOffset(): number {
  return DAY.startFraction * DAY_SECONDS;
}

/** Game seconds of a state (no Sim needed: the save list and the menu read it). */
export function gameSecondsOf(state: Pick<GameState, 'time' | 'clock'>): number {
  return (state.time ?? 0) + (state.clock?.offset ?? startOffset());
}

/** The game day of a state, from 1. */
export function gameDayOf(state: Pick<GameState, 'time' | 'clock'>): number {
  return Math.floor(gameSecondsOf(state) / DAY_SECONDS) + 1;
}

export function gameFraction(state: Pick<GameState, 'time' | 'clock'>): number {
  const g = gameSecondsOf(state) / DAY_SECONDS;
  return g - Math.floor(g);
}

/** The real local time as a day fraction (06:00 → 0). */
export function realFraction(d: Date): number {
  const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  const f = (h - DAY.dawnHour) / 24;
  return f - Math.floor(f);
}

/** Clock hours (0 … 24) at a day fraction. */
export function clockHours(f: number): number {
  return (DAY.dawnHour + f * 24) % 24;
}

export function sunHeightAt(f: number): number {
  return f < DAY.dayShare ? Math.sin((Math.PI * f) / DAY.dayShare) : 0;
}

/** 0 … 1 light: full by mid-morning, fading through dusk, a little light either side of the horizon. */
export function daylightAt(f: number): number {
  const tw = DAY.twilight;
  // distance into the day from the nearer horizon (negative: still night)
  const d = f < DAY.dayShare ? Math.min(f, DAY.dayShare - f) : -Math.min(f - DAY.dayShare, 1 - f);
  const x = (d + tw) / (tw * 3);
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/** Solar output at a day fraction, before the weather: zero at night, full from mid-morning to mid-afternoon. */
export function solarAt(f: number): number {
  return Math.min(1, sunHeightAt(f) / 0.5);
}
