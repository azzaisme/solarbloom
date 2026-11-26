// E23.2.1 (#371): bloombot's charge, the only meter. All data, no rules: starting values for tuning.
// A full charge lasts about 10 minutes of active play (the `active` profile below, checked by tests/charge.test.ts).
// Walking is free; pulses, abilities and sprinting cost charge. At zero bloombot walks on, slower, and can't pulse.

import { FARM_USES } from './farm';

/** a full charge with no research (the meter's 100%) */
const FULL = 100;

export interface EdibleDef {
  /** the backpack item eaten (E23.5.1's farm items) */
  id: 'biomass' | 'food' | 'fruit' | 'honey';
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
    // #785: fruit from fruit trees, a sweet snack
    { id: 'fruit', name: 'Fruit', charge: FARM_USES.fruit.charge * FULL, seconds: 3 },
    { id: 'food', name: 'Food', charge: FARM_USES.food.charge * FULL, seconds: 3 },
    { id: 'biomass', name: 'Greens', charge: FARM_USES.biomass.charge * FULL, seconds: 2 },
  ] as EdibleDef[],
  /** E23.3.3: sitting and meditating at a charger, per second (fast, free, on the grid) */
  meditatePerSecond: 6,
  /**
   * Home: standing still for a moment by the fountain or the house trickles charge back, so bloombot is never stuck
   * with an empty charge and an empty backpack. Benches (E23.2.3) trickle too, and sleeping (E23.7) fills it.
   */
  home: { radius: 3, perSecond: 0.5, stillSeconds: 1.5 },
  /** E23.2.3: sitting on a bench, per second (a trickle) */
  benchPerSecond: 0.4,
  /** the active-play profile a full charge is sized for: a pulse every few seconds, sprinting part of the time */
  active: { pulseEverySeconds: 8, sprintShare: 0.25, minutes: 10 },
} as const;
