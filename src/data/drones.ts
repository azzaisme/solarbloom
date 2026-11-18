// E23.6.3 (#392): what drones run on, by role. All data, no rules: the numbers are starting values for tuning.
// Each role draws from its hub: power from the grid (E23.3) while it works, and per job some water from a pipe or
// water beside the hub (E23.4) or some biomass from a Storage chest beside it (E23.5's item; the store, until then).

import type { DroneRole } from '../core/types';

export interface DroneSupply {
  /** grid power each working drone of this role draws (watts, as E23.3's consumers count them) */
  power: number;
  /** water units drawn per job from water within reach of the hub (a pipe or a body) */
  water?: number;
  /** biomass taken per job from the store, through a Storage chest beside the hub */
  biomass?: number;
}

/** What each role runs on. Scouts fly further and draw more; Cultivators till and water. */
export const DRONE_SUPPLY: Record<DroneRole | 'cultivator', DroneSupply> = {
  restorer: { power: 2, biomass: 1 },
  gardener: { power: 2, water: 2 },
  scout: { power: 4 },
  courier: { power: 2 },
  harvester: { power: 2 },
  spark: { power: 2 },
  cultivator: { power: 4, water: 2 },
};

export const DRONE_HUB = {
  /** a Storage chest within this many tiles of a hub feeds its biomass roles */
  chestReach: 4,
  /** water within this many tiles of a hub (a pipe, a canal, a pond) feeds its water roles */
  waterReach: 3,
};
