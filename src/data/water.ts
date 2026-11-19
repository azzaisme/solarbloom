// E23.4 (#358): the water network's numbers. Starting values for tuning; every rate is per game day.

import type { RegionId } from './oldcity';
import { DAY_SECONDS } from './time';

export const WATER_NET = {
  /** E23 rule 5: a game day (E23.7.1's clock: 48 minutes of play); every rate here is per game day */
  daySeconds: DAY_SECONDS,
  /** how much one water tile holds (units; a planter's or a pump's draw is counted in these) */
  perTile: 20,
  /** the sim updates levels this often (seconds of sim time), not every step */
  step: 1,
  /**
   * E23.7.2's weather (`sim.weather.rain()`: 1 a day's steady rain, 2 a storm's downpour) refills every body by this
   * share of its capacity per game day for each unit of rain. Its `effects().evaporation` is the sun's share per day.
   */
  rainShare: 3,
  /** E23.7.2's sunny days evaporate a little (`effects().evaporation`, a share of capacity per game day), but evaporation
   * alone never takes a body below this (weather never empties a pond: cozy wins) */
  evaporationFloor: 0.5,
  /** E23.4.1: springs top up the water of these regions by this share of capacity per game day, any weather */
  springs: { cistern: 1.5 } as Partial<Record<RegionId, number>>,
  /** springs only run once this region's landmark is awake (the Old Cistern holds water again) */
  springsNeedLandmark: true,
  /** the level a body starts at before anything has touched it (default full); the dry basin starts empty */
  startLevel: { cistern: 0 } as Partial<Record<RegionId, number>>,
  /** a tile is watered when a body this close (tiles, square reach) has more than `dryBelow` of its capacity */
  reach: 3,
  dryBelow: 0.08,
  /** largest body one flood fill walks (safety cap) */
  maxTiles: 6000,
  /** what the helpers draw (units per tile they work); planters and pumps bring their own (E23.5, E23.4.2) */
  draw: { cultivatorPerTile: 2, gardenerPerTile: 1 },
  /**
   * E23.4.4: land around low water fades. Restored ground within `fadeReach` of a body below `fadeBelow` shows up to
   * `fadeSteps` bloom stages less (lush → flowers → plain restored), more the emptier it is. Never below restored.
   */
  fadeReach: 5,
  fadeBelow: 0.35,
  fadeSteps: 2,
  /** the drained bed shows in this many steps (the renderer rebuilds a body's look only when its step changes) */
  lookSteps: 10,
};
