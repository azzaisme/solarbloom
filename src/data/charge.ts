// E23.2.1 (#371): bloombot's charge, the only meter. All data, no rules: starting values for tuning.
// A full charge lasts about 10 minutes of active play (the `active` profile below, checked by tests/charge.test.ts).
// Walking is free; pulses, abilities and sprinting cost charge. At zero bloombot walks on, slower, and can't pulse.

import { COOKING, MEAL_IDS, RECIPES, type MealId } from './cooking';
import { FARM_USES } from './farm';
import { FRUIT_IDS, FRUITS, type FruitId } from './fruit';

/** a full charge with no research (the meter's 100%) */
const FULL = 100;

export interface EdibleDef {
  /** the backpack item eaten (E23.5.1's farm items) */
  id: 'biomass' | 'food' | FruitId | 'honey' | MealId;
  name: string;
  /** charge one unit gives back (from E23.5.1's FARM_USES: its share of a full battery) */
  charge: number;
  /** seconds it takes to eat one unit (the charge arrives over this time) */
  seconds: number;
}

export const CHARGE = {
  /** a full charge */
  max: FULL,
  /** E23.6.2 research: each battery cell adds this much to the full charge */
  cellCapacity: 25,
  /** E23.6.2 research: each efficiency step takes this share off every cost (multiplies) */
  efficiencyStep: 0.1,
  /** charge one pulse uses (the load it carries is paid separately, E23.2.2) */
  pulse: 1,
  /** charge a second of sprinting (hovering) uses, while moving */
  sprintPerSecond: 1 / 6,
  /** E23.6.7: sprinting on a laid path uses this share (until e23-craft's PATHS.sprintChargeShare is on sim.paths) */
  pathSprintShare: 0.6,
  /** charge each use of an ability costs */
  ability: { pry: 3, hover: 0, climb: 2, glide: 2 } as Record<string, number>,
  /** at zero: walking speed is this share of a normal walk (never stranded) */
  lowPowerWalk: 0.7,
  /** at or below this share of a full charge the meter shows it is running low */
  lowShare: 0.2,
  /** what bloombot can eat anywhere, best first when eating picks for you (slow, uses items) */
  edibles: [
    // E23.5.4.1: honey from beehives, a strong snack
    { id: 'honey', name: 'Honey', charge: FARM_USES.honey.charge * FULL, seconds: 3 },
    // #785: fruit from fruit trees, sweet snacks between Honey and Food (the sweetest first)
    ...[...FRUIT_IDS].sort((a, b) => FRUITS[b].sweet - FRUITS[a].sweet).map((f): EdibleDef => ({ id: f, name: FRUITS[f].name, charge: FARM_USES[f].charge * FULL, seconds: 3 })),
    { id: 'food', name: 'Food', charge: FARM_USES.food.charge * FULL, seconds: 3 },
    { id: 'biomass', name: 'Greens', charge: FARM_USES.biomass.charge * FULL, seconds: 2 },
    // #874: meals from the stove, last: a snack picked for you eats the raw food first and leaves the meals (for a
    // Keeper, or to eat on purpose from the backpack)
    ...MEAL_IDS.map((m): EdibleDef => ({ id: m, name: RECIPES[m].name, charge: RECIPES[m].charge, seconds: COOKING.eatSeconds })),
  ] as EdibleDef[],
  /**
   * #784: the charging sources, fastest first, and the order must hold (tests/charging-order.test.ts): a Charger
   * (the payoff for building), then a bench (a clearly felt trickle, 2 a second), then the fountain or the house
   * (1 a second, so Bloombot is never stuck). Knacks multiply them (Pylon the Charger, Gable both kinds of rest):
   * the Charger is quick enough that one starting Solar Panel (2/3 of its draw, less in cloud) still beats a bench
   * with Gable's Easy rest.
   */
  /** E23.3.3: sitting and meditating at a charger, per second at full power (fast, free, on the grid) */
  meditatePerSecond: 10,
  /**
   * Home: standing still for a moment by the fountain or the house trickles charge back, so bloombot is never stuck
   * with an empty charge and an empty backpack. Benches (E23.2.3) trickle too, and sleeping (E23.7) fills it.
   */
  home: { radius: 3, perSecond: 1, stillSeconds: 1.5 },
  /** E23.2.3 / #784: sitting on a bench, per second (a trickle the player can see the meter rise with) */
  benchPerSecond: 2,
  /**
   * #784: so the player sees Bloombot charging, from any source: it counts as charging for `holdSeconds` after the
   * last charge came in (sources tick at different points of a frame); sparkles rise from it every `sparkleEvery`
   * seconds, `sparkles` at a time, `lift` tiles above its feet.
   */
  feedback: { holdSeconds: 0.35, sparkleEvery: 0.32, sparkles: 3, lift: 0.55 },
  /** the active-play profile a full charge is sized for: a pulse every few seconds, sprinting part of the time */
  active: { pulseEverySeconds: 8, sprintShare: 0.25, minutes: 10 },
} as const;
