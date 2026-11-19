import { CHARGE } from './charge';
import { DAY_SECONDS } from './time';
/**
 * E23.3: the power grid's starting values (tuning lives here, not in code).
 *
 * Units: power is "watts" (an abstract unit per second); stored energy is watt-seconds. A game day is 48 minutes
 * of play (2880 s), so a night of about a third of a day is ~960 s.
 */

/** Consumers switch off in this order when a network runs short (first in the list goes dark first). */
export const SHED_ORDER = ['lamp', 'pump', 'helper', 'charger'] as const;
export type ShedClass = (typeof SHED_ORDER)[number];

export const POWER = {
  /** A game day in seconds of play (E23 rule 5): data/time's, the one game-day length. */
  daySeconds: DAY_SECONDS,
  /** How long a consumer's light/level takes to fade between on and off (seconds of play). */
  fadeSeconds: 2.5,
  /**
   * Pole links. Poles link to poles within the larger of their two ranges; any other grid machine attaches to a
   * pole whose centre is within `attachReach` tiles of its own centre. Machines whose footprints touch (diagonals
   * included) share a network without a pole.
   */
  pole: {
    /** Bloom Relays as poles: the relay's own range (TUNING.relay, plus Relay Lens) is used. */
    attachReach: 5,
  },
  /** Solar panel (E23.3.2.1): output at full sun. Cloud takes −20%; none at night. */
  solar: { output: 4, cloudFactor: 0.8 },
  /**
   * Wind turbine (E23.3.2.2): output at full wind (a storm). On flat ground a turbine gets `groundShare` of it;
   * each terrace level adds `perLevel` (rooftops count as `roofLevel`), up to the full output.
   */
  wind: { output: 10, groundShare: 0.5, perLevel: 0.25, roofLevel: 2 },
  /** Wind (0..1) while there is no weather system (before E23.7 lands): calm, so turbines stand still. */
  fallbackWind: 0,
  /** Battery (E23.3.2.1): stores surplus and covers deficits, up to `rate` either way. */
  battery: { capacity: 6000, rate: 20 }, // a night (~0.4 day, 1150 s) of a pump and a lamp is ~4600 W·s
  /** Charger (E23.3.3): bloombot's charge per second while it sits on a powered pad (CHARGE.meditatePerSecond is 6). */
  // rate: E23.2.1's meditating rate (data/charge); reach: how close to the pad's edge bloombot sits (tiles)
  charger: { rate: CHARGE.meditatePerSecond, reach: 0.75 },
  /** Helpers on the grid (E23.3.3, old-city rules): their draw while they stand. */
  helper: { droneHub: 4, cultivator: 4 },
  /**
   * E23.3.4 the Power view: powered electrical machines become pure-yellow holograms (the build preview's look;
   * `holo` is its opacity and emissive glow); `frame` is the width of the network's frame under each machine, a share of the build frame's, and `cable`
   * the radius in tiles of a pole-to-pole line and of a drop cable: thin, world-sized lines) while the rest
   * of the world darkens, easing over `fade` s. `darken` is how far, by day and by night (E23.7.5's moonlit night is
   * readable, not dark, so it darkens nearly as far as day; the lamps dim with the scene). At
   * full darken the sun, fill and sky light keep `light` of their strength and the exposure `exposure` of its own;
   * glows make up for the exposure only (emissive ignores the lights). Either alone barely shows by day: the Neutral
   * tone map and the display's gamma keep a sixth of the light looking bright.
   */
  /** `focus`: how near (tiles) the cursor must be to a network's machine or line for the view to highlight it */
  view: { focus: 1.2, holo: { opacity: 0.35, glow: 0.8 }, frame: 0.5, cable: [0.022, 0.012] as [number, number], darken: { day: 1, night: 0.85 }, light: 0.22, exposure: 0.45, fade: 0.3 },
  /** Starting draws per shed class (consumers may override with their own draw). */
  draw: { lamp: 0.5, pump: 3, helper: 4, charger: 6 } satisfies Record<ShedClass, number>,
};
