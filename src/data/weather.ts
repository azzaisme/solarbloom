/**
 * E23.7.2 (#396): the weather. Every kind helps one part of the farm and challenges another; nothing it does ever
 * destroys anything. Starting values for tuning (E23 rule 9). Replaces E21.21's "rain doubles water income".
 *
 * The weather is one kind per game day, chosen at dawn from the seed and the day, so the forecast at the house is
 * always right about tomorrow.
 */
export type WeatherKind = 'sunny' | 'cloudy' | 'rain' | 'wind' | 'storm' | 'fog';
export const WEATHER_KINDS: readonly WeatherKind[] = ['sunny', 'cloudy', 'rain', 'wind', 'storm', 'fog'];

export interface WeatherEffects {
  /** share of solar output (times the time of day) */
  solar: number;
  /** wind turbine share, 0 … 1 */
  wind: number;
  /** rain falling: water into ponds and reservoirs, and planters watered, in units of a day's steady rain (0 = dry) */
  rain: number;
  /** how fast planters dry out (1 = normal) */
  planterDrying: number;
  /** share of a pond's water lost to the sun over a game day */
  evaporation: number;
  /** how fast restoring ground blooms (1 = normal) */
  bloomSpeed: number;
  /** biomass gathered per take (1 = normal): blown leaves on windy days */
  gatherBonus: number;
  /** salvage piles blown full at once at the start of the day (storms) */
  blowsInSalvage: boolean;
  /** chances over the day that lightning trips a power pole (reset with one press; nothing is lost) */
  lightning: number;
  /** how far the view reaches (1 = normal) */
  view: number;
  /** fog-only finds and fauna are out */
  fogFinds: boolean;
  /** how grey the sky is, 0 clear … 1 storm (presentation) */
  overcast: number;
}

export const WEATHER: Record<WeatherKind, WeatherEffects> = {
  sunny: { solar: 1, wind: 0.15, rain: 0, planterDrying: 1.5, evaporation: 0.05, bloomSpeed: 1, gatherBonus: 1, blowsInSalvage: false, lightning: 0, view: 1, fogFinds: false, overcast: 0 },
  cloudy: { solar: 0.8, wind: 0.3, rain: 0, planterDrying: 1, evaporation: 0, bloomSpeed: 1, gatherBonus: 1, blowsInSalvage: false, lightning: 0, view: 1, fogFinds: false, overcast: 0.45 },
  rain: { solar: 0.35, wind: 0.3, rain: 1, planterDrying: 0, evaporation: 0, bloomSpeed: 1.5, gatherBonus: 1, blowsInSalvage: false, lightning: 0, view: 0.85, fogFinds: false, overcast: 0.7 },
  wind: { solar: 0.9, wind: 0.85, rain: 0, planterDrying: 1.2, evaporation: 0, bloomSpeed: 1, gatherBonus: 2, blowsInSalvage: false, lightning: 0, view: 1, fogFinds: false, overcast: 0.2 },
  storm: { solar: 0, wind: 1, rain: 2, planterDrying: 0, evaporation: 0, bloomSpeed: 1.25, gatherBonus: 1.5, blowsInSalvage: true, lightning: 2, view: 0.7, fogFinds: false, overcast: 1 },
  fog: { solar: 0.6, wind: 0.05, rain: 0, planterDrying: 0.7, evaporation: 0, bloomSpeed: 1, gatherBonus: 1, blowsInSalvage: false, lightning: 0, view: 0.55, fogFinds: true, overcast: 0.5 },
};

/** How often each kind comes up (weights). Day 1 is always sunny: the first morning is a gentle one. */
export const WEATHER_ODDS: Record<WeatherKind, number> = { sunny: 34, cloudy: 22, rain: 18, wind: 12, storm: 6, fog: 8 };

/** A storm never follows a storm (and never comes in the first days, before bloombot has a home). */
export const WEATHER_RULES = { firstDay: 'sunny' as WeatherKind, noStormBeforeDay: 4 };

/** Words for the forecast and the minimap rim. */
export const WEATHER_WORDS: Record<WeatherKind, { name: string; forecast: string }> = {
  sunny: { name: 'Sunny', forecast: 'Tomorrow: sunshine. Full sun for the panels; planters will be thirsty.' },
  cloudy: { name: 'Cloudy', forecast: 'Tomorrow: cloud. The panels will run a little low.' },
  rain: { name: 'Rain', forecast: 'Tomorrow: rain. Ponds fill and the planters water themselves.' },
  wind: { name: 'Windy', forecast: 'Tomorrow: wind. Turbines will spin, and leaves will blow about.' },
  storm: { name: 'Storm', forecast: 'Tomorrow: a storm. Turbines at full, no sun, and the wind may blow in salvage.' },
  fog: { name: 'Fog', forecast: 'Tomorrow: fog. Short views, and strange things about.' },
};
