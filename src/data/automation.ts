// E23.6.4 (#393) and E23.6.5 (#394): automation. Jobs bloombot has done by hand a few times can be handed to
// machines and drones: supply crates hold things for them, courier drones carry between crates on routes the player
// sets, and the Assembler crafts by itself. No conveyor belts. All data, no rules: starting values for tuning.

import type { ItemId } from '../core/types';

/**
 * A job done by hand that, done a few times, opens its automation. The farm's jobs (gathering, harvesting, composting,
 * watering, feeding a digester) join this list with their machines (#441-#444).
 */
export type HandJob = 'carry' | 'craft';

export const HAND_JOBS: Record<HandJob, { name: string; times: number }> = {
  /** putting things in the store, or taking them out, at a way into it */
  carry: { name: 'Move things to and from the store', times: 8 },
  /** a component made at the crafting table */
  craft: { name: 'Make components at the crafting table', times: 12 },
};

export const AUTOMATION = {
  crate: {
    /** units a supply crate holds, every item together */
    capacity: 200,
  },
  route: {
    /** units one courier trip carries (Bigger baskets research adds `droneCarry` per level) */
    carry: 10,
    /** at most this many routes on one crate (as a source) */
    perCrate: 4,
    /** at most this many routes on the island */
    max: 60,
  },
  assembler: {
    /** grid power drawn while it crafts (E23.3 consumer, shed with the helpers) */
    draw: 4,
    /** crafting speed against the table's seconds (1 = the same) */
    speed: 1,
    /** an input or output crate is one within this many tiles of the Assembler's edge */
    crateReach: 2,
  },
  build: {
    /** building (and the table) takes from supply crates within this many tiles of bloombot, after the backpack */
    crateReach: 6,
  },
};

/** What a route may carry: one item, or everything in the source crate ('all'). */
export type RouteItem = ItemId | 'all';
