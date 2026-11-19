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
  /**
   * until then that water is dormant (dry, whatever the weather); waking the landmark fills it from empty to full
   * over this many seconds, so the player sees the payoff, then the springs keep it topped up
   */
  wakeRush: 40,
  /** the level a body starts at before anything has touched it (default full); the dry basin starts empty */
  startLevel: { cistern: 0 } as Partial<Record<RegionId, number>>,
  /** a tile is watered when a body this close (tiles, square reach) has more than `dryBelow` of its capacity */
  reach: 3,
  dryBelow: 0.08,
  /** below this share a body's land starts to fade (E23.4.4), and the advisor (E23.1.5) calls its area short of water */
  fadeBelow: 0.35,
  /** largest body one flood fill walks (safety cap) */
  maxTiles: 6000,
  /** what the helpers draw (units per tile they work); planters and pumps bring their own (E23.5, E23.4.2) */
  draw: { cultivatorPerTile: 2, gardenerPerTile: 1 },
  /**
   * E23.4.4: land around low water fades. Restored ground within `fadeReach` of a body below `fadeBelow` shows up to
   * `fadeSteps` bloom stages less, more the emptier it is: the whole bloom range (TUNING's maxBloom 4 down to 1), so
   * at empty water even the lushest land shows plain restored ground and its flowers close. Never below restored.
   */
  fadeReach: 5,
  fadeSteps: 3,
  /** E23.4.2.1: a reservoir: what it holds, how fast a canal or pond on its bank fills it (share of capacity per game day) */
  reservoir: { capacity: 400, bankFillPerDay: 2, startLevel: 0 },
  /**
   * E23.4.2.2: a pump stands on a bank and pushes water from that body into the pipes it touches: up to this many
   * units per game day into reservoirs on the line, uphill or across any distance. Grid power (E23.3) it draws.
   */
  pump: { perDay: 1200, power: 3 },
  /** E23.4.2.3: a higher reservoir feeds a lower one down a pipe with no pump, this many units per game day */
  gravityPerDay: 600,
  /** E23.6.1: one crafted Pipe (the crafting table makes 4 from 1 Copper and 2 Clay) lays one pipe tile */
  pipe: { cost: { pipe: 1 } },
  /** a tile is fed by a pipe when a fed pipe tile is within this many tiles (square reach) */
  pipeReach: 1,
  /** the drained bed shows in this many steps (the renderer rebuilds a body's look only when its step changes) */
  lookSteps: 10,
};
