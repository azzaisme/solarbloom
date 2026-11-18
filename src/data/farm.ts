// E23.5 (#359): the farm. Biomass, food, compost and fertiliser are backpack items (E23.5.1); all numbers here
// are the epic's starting values for tuning. No rules live here.

import type { MaterialId } from '../core/types';

/** E23 rule 5: a game day is 48 minutes of play. Every farm timer counts in game days. */
export const DAY_SECONDS = 48 * 60;

/**
 * Game days since the start, as a fraction. E23.7 (e23-time) owns the clock: once the sim carries one with a
 * `days` reading it wins; until then a game day is simply 48 minutes of sim time.
 */
export function gameDays(sim: { time: number; clock?: { days?: number } }): number {
  return sim.clock?.days ?? sim.time / DAY_SECONDS;
}

/** The four farm items, in backpack order. */
export const FARM_ITEMS = ['biomass', 'food', 'compost', 'fertiliser', 'honey'] as const satisfies readonly MaterialId[];
export type FarmItem = (typeof FARM_ITEMS)[number];

export function isFarmItem(m: string): m is FarmItem {
  return (FARM_ITEMS as readonly string[]).includes(m);
}

/**
 * What each item is good for, for E23.2 (charge) and E23.6 (recipes) to read. `charge`: bloombot's charge from
 * eating one (share of a full battery, 0–1); `load`: it can ride a loaded pulse (E23.2.2).
 */
export const FARM_USES: Record<FarmItem, { charge: number; load: boolean; blurb: string }> = {
  biomass: { charge: 0.04, load: false, blurb: 'Clippings, leaves and spent crops. Bloombot can eat it, compost it or feed a digester.' },
  food: { charge: 0.12, load: false, blurb: 'Grown in planters. Better charge than biomass, and Keepers love a gift of it.' },
  compost: { charge: 0, load: false, blurb: 'From the compost bin. Given time it turns into fertiliser.' },
  fertiliser: { charge: 0, load: true, blurb: 'Pulsed into the ground for full bloom, big trees and rare flowers.' },
  // E23.5.4.1: a strong snack
  honey: { charge: 0.25, load: false, blurb: 'From beehives. A strong snack: much more charge than food.' },
};

/** E23.5.1: gathering biomass from restored ground (hold Interact facing it). */
export const GATHER = {
  /** a tile needs at least this bloom (1 grass, 2 flowers, 3 shrubs) before there is anything to clip */
  minBloom: 2,
  /** biomass one gather gives at bloom 2; each bloom above adds `perBloom` */
  base: 2,
  perBloom: 1,
  /** seconds Interact is held to gather (like salvaging) */
  holdSeconds: 0.6,
  /** game days until a clipped tile can be gathered again (0.25 = 12 minutes of play) */
  regrowDays: 0.25,
};
