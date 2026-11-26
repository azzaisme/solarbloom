import type { GameState } from '../core/types';
import { SEASON_DAYS, SEASON_WORDS, SEASONS, SNOW_BUILD, seasonLine, type Season } from '../data/seasons';
import type { WeatherKind } from '../data/weather';
import { DAY_SECONDS } from '../data/time';
import { gameDayOf, gameSecondsOf } from './Clock';
import type { Sim } from './Sim';

/** Where the year is: the season, how far through it (0 … 1), its day (1 … SEASON_DAYS) and the year (from 1). */
export interface SeasonNow {
  season: Season;
  progress: number;
  day: number;
  year: number;
}

/**
 * #830: the seasons, on the game clock. Spring, summer, autumn and winter, `SEASON_DAYS` game days each, in that
 * order. The year starts on `state.seasons.startDay` (day 1 for a new garden, so it starts in spring); a garden saved
 * before seasons existed starts a fresh spring on the day it is first loaded. Because the season is worked out from
 * the game clock (play, plus the night sleeping skips), it saves, loads and moves on exactly as every timer does.
 *
 * The API other systems use (read through `sim.seasons`):
 * - `season()`, `progress()`, `dayOfSeason()`, `year()`, `next()`, `label()`, `now()`
 * - `seasonOnDay(day)`: the season of any game day (the weather picks each day's kind by it)
 * - the bus event `season.changed` `{ season, from, year }`, on the step a new season starts (never on loading)
 *
 * Seasons never make the game harder. `cozy` (the Cozy Mode setting) also keeps winter's short days from slowing
 * the solar panels (data/seasons WINTER_COZY, applied by the weather).
 */
export class Seasons {
  /** the Cozy Mode setting (Game sets it, as for the decay) */
  cozy = false;
  private last?: Season;

  constructor(private sim: Sim) {
    // a new garden (day 1) starts in spring; a garden from before seasons starts a fresh spring today
    sim.state.seasons ??= { startDay: gameDayOf(sim.state) };
  }

  setCozyMode(on: boolean) {
    this.cozy = on;
  }

  /** Everything at once. */
  now(): SeasonNow {
    return seasonOf(this.sim.state);
  }

  season(): Season {
    return this.now().season;
  }

  /** 0 … 1 through the current season, smoothly on the game clock. */
  progress(): number {
    return this.now().progress;
  }

  /** The day of the season, 1 … SEASON_DAYS. */
  dayOfSeason(): number {
    return this.now().day;
  }

  /** The year, from 1. */
  year(): number {
    return this.now().year;
  }

  /** The season after this one. */
  next(): Season {
    return nextSeason(this.season());
  }

  /** "Spring" */
  label(): string {
    return SEASON_WORDS[this.season()].name;
  }

  /** The HUD's line: "Spring, day 2 of 3". */
  line(): string {
    const n = this.now();
    return seasonLine(n.season, n.day);
  }

  /** The season on a game day (from 1). */
  seasonOnDay(day: number): Season {
    return seasonOnDayOf(this.sim.state, day);
  }

  /**
   * Test and photo hook: moves the year so that today is `day` of `season` (the clock itself never moves, so no
   * timer is skipped). Saved like any season, and the change of season is announced on the next step.
   */
  jumpTo(season: Season, day = 1) {
    const today = gameDayOf(this.sim.state);
    const idx = SEASONS.indexOf(season);
    const d = Math.max(1, Math.min(SEASON_DAYS, Math.floor(day)));
    // today must be day index idx * SEASON_DAYS + (d - 1) of the year
    this.sim.state.seasons = { startDay: today - (idx * SEASON_DAYS + d - 1) };
  }

  /**
   * #830: how much snow lies on the garden now, 0 (none) … 1 (all white). Worked out from the winter's weather so
   * far (each day's weather is fixed by the seed, so a reload, sleeping or a photo always shows the same snow):
   * snowy days lay it down, dry days melt some, and spring melts the rest.
   */
  snowCover(): number {
    const n = this.now();
    if (n.season !== 'winter' && n.season !== 'spring') return 0;
    const today = gameDayOf(this.sim.state);
    const f = this.sim.clock.gameDayFraction();
    const winterStart = n.season === 'winter' ? today - (n.day - 1) : today - (n.day - 1) - SEASON_DAYS;
    const kindOn = (day: number): WeatherKind => (day === today ? this.sim.weather.kind() : this.sim.weather.kindOn(day));
    const cover = snowBuild(winterStart, n.season === 'winter' ? today : winterStart + SEASON_DAYS - 1, n.season === 'winter' ? f : 1, kindOn);
    if (n.season === 'winter') return cover;
    const into = n.day - 1 + f; // game days into spring
    return Math.max(0, cover * (1 - into / SNOW_BUILD.springMeltDays));
  }

  /** Per sim step: announces a new season. */
  tick() {
    const n = this.now();
    if (this.last !== undefined && n.season !== this.last) this.sim.bus.emit('season.changed', { season: n.season, from: this.last, year: n.year });
    this.last = n.season;
  }
}

/**
 * #830: snow cover after the winter days `from` … `to` (the last day only `lastShare` of the way through), each day's
 * weather from `kindOn`: a snowy day adds SNOW_BUILD.perSnowDay, a dry one melts by its weather.
 */
export function snowBuild(from: number, to: number, lastShare: number, kindOn: (day: number) => WeatherKind): number {
  let c = 0;
  for (let d = from; d <= to; d++) {
    const share = d === to ? lastShare : 1;
    const k = kindOn(d);
    c = k === 'snow' ? c + SNOW_BUILD.perSnowDay * share : c - SNOW_BUILD.melt[k] * share;
    c = Math.min(1, Math.max(0, c));
  }
  return c;
}

export function nextSeason(s: Season): Season {
  return SEASONS[(SEASONS.indexOf(s) + 1) % SEASONS.length];
}

/** The game day the year started on (a state without seasons yet: today, a fresh spring). */
function startOf(state: Pick<GameState, 'time' | 'clock' | 'seasons'>): number {
  return state.seasons?.startDay ?? gameDayOf(state);
}

/** The season on a game day, for a state (no Sim needed). */
export function seasonOnDayOf(state: Pick<GameState, 'time' | 'clock' | 'seasons'>, day: number): Season {
  const i = Math.floor((day - startOf(state)) / SEASON_DAYS);
  return SEASONS[((i % SEASONS.length) + SEASONS.length) % SEASONS.length];
}

/** Where the year is in a state (no Sim needed: the save list and tests read it). */
export function seasonOf(state: Pick<GameState, 'time' | 'clock' | 'seasons'>): SeasonNow {
  const days = gameSecondsOf(state) / DAY_SECONDS - (startOf(state) - 1); // game days since the year began
  const len = SEASON_DAYS * SEASONS.length;
  const yearDays = ((days % len) + len) % len;
  const i = Math.min(SEASONS.length - 1, Math.floor(yearDays / SEASON_DAYS));
  const into = yearDays - i * SEASON_DAYS;
  return {
    season: SEASONS[i],
    progress: Math.min(1, Math.max(0, into / SEASON_DAYS)),
    day: Math.min(SEASON_DAYS, Math.floor(into) + 1),
    year: Math.floor(days / len) + 1,
  };
}
