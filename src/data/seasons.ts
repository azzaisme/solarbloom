import type { WeatherKind } from './weather';

/**
 * #830: the seasons. Spring, summer, autumn and winter, three game days each (a year is twelve game days, about ten
 * hours of play), in that order. A new garden starts on the first morning of spring. Starting values
 * for tuning (E23 rule 9: numbers live in data).
 *
 * The season runs on the game clock (data/time), so it moves with play and with sleeping, exactly like every other
 * timer. Nothing a season does ever makes the game harder: winter is quiet and pretty, never a punishment (see
 * `WINTER_COZY` for what Cozy Mode softens further).
 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Game days in each season. */
export const SEASON_DAYS = 3;

/**
 * How often each weather comes up in each season (weights, like data/weather's WEATHER_ODDS, which is the year's
 * average). Spring brings showers, summer sun, autumn wind, winter snow. Snow only falls in winter, and winter has no
 * storms: its weather is the gentlest of the year.
 */
export const SEASON_WEATHER_ODDS: Record<Season, Record<WeatherKind, number>> = {
  spring: { sunny: 28, cloudy: 20, rain: 32, wind: 8, storm: 4, fog: 8, snow: 0 },
  summer: { sunny: 56, cloudy: 16, rain: 10, wind: 8, storm: 6, fog: 4, snow: 0 },
  autumn: { sunny: 22, cloudy: 22, rain: 14, wind: 26, storm: 6, fog: 10, snow: 0 },
  winter: { sunny: 24, cloudy: 22, rain: 4, wind: 6, storm: 0, fog: 10, snow: 34 },
};

/**
 * #830: Cozy Mode in winter. Winter never punishes anyone, but with Cozy Mode on its short grey days don't even slow
 * the solar panels: a winter day gives the panels at least this share of their sunny output, whatever the sky.
 */
export const WINTER_COZY = { solarFloor: 0.8 };

/** Words: the HUD's season line and the warm toast when a new season arrives (docs/design/PLAIN_WORDS.md). */
export const SEASON_WORDS: Record<Season, { name: string; icon: string; arrive: string; detail: string }> = {
  spring: {
    name: 'Spring',
    icon: '🌸',
    arrive: 'Spring is here',
    detail: 'Blossom opens on the trees, the grass greens up and soft showers come and go.',
  },
  summer: {
    name: 'Summer',
    icon: '☀️',
    arrive: 'Summer has come',
    detail: 'Long sunny days: the panels drink up the light and the trees are in full leaf.',
  },
  autumn: {
    name: 'Autumn',
    icon: '🍂',
    arrive: 'Autumn is turning the leaves',
    detail: 'The trees go gold and red, and the wind sends their leaves drifting down.',
  },
  winter: {
    name: 'Winter',
    icon: '❄️',
    arrive: 'Winter has settled in',
    detail: 'A little frost and the odd snowfall. Nothing in your garden minds the cold.',
  },
};

/** The HUD's season line: "Spring, day 2 of 3". */
export function seasonLine(season: Season, day: number): string {
  return `${SEASON_WORDS[season].name}, day ${day} of ${SEASON_DAYS}`;
}

/**
 * #830: how each season looks, from summer's full green (all zeros) to winter's bare trees and frost. The renderer
 * (rendering/SeasonLook) eases from one season's look to the next over the last `blend` of each season, so the world
 * changes gradually and never pops. Colours live in rendering/Palette (`PALETTE.season`).
 *
 * - `grass`: how far green grass, lawns, shrubs and leaves shift toward the season's grass colour (0 … 1)
 * - `autumn`: share of deciduous leaves turned gold, orange and red
 * - `bare`: share of deciduous leaves fallen (winter's bare branches)
 * - `blossom`: share of deciduous crowns in pink and white blossom
 * - `frost`: frost and a light dusting of snow on upward faces (0 … 1); a winter morning has a touch more
 * - `leafFall`: how many leaves drift down from the trees (1 = the summer's odd leaf)
 */
export interface SeasonLookDef {
  grass: number;
  autumn: number;
  bare: number;
  blossom: number;
  frost: number;
  leafFall: number;
}
export const SEASON_LOOK: Record<Season, SeasonLookDef> = {
  spring: { grass: 0.5, autumn: 0, bare: 0, blossom: 0.42, frost: 0, leafFall: 1.4 },
  summer: { grass: 0, autumn: 0, bare: 0, blossom: 0, frost: 0, leafFall: 1 },
  autumn: { grass: 0.7, autumn: 0.85, bare: 0.2, blossom: 0, frost: 0, leafFall: 4 },
  winter: { grass: 0.55, autumn: 0.35, bare: 0.86, blossom: 0, frost: 0.32, leafFall: 0.25 },
};

/** The look's timing: the last `blend` of each season eases into the next; a winter dawn adds `dawnFrost`. */
export const SEASON_LOOK_TIMING = { blend: 0.34, dawnFrost: 0.3 };
