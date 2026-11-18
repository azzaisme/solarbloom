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
  /** A game day in seconds of play (E23 rule 5). The fallback clock uses it until E23.7's clock lands. */
  daySeconds: 48 * 60,
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
  /**
   * Region strengths (#377, E23.8.1): a matching machine in its region makes about 1.5×. Provisional until E23.8
   * owns the table (its `sim.regions?.strength?.(m, kind)` wins when present).
   */
  regionBoost: 1.5,
  /** Wind (0..1) while there is no weather system yet (before E23.7 lands): a steady breeze. */
  fallbackWind: 0.4,
  regionStrengths: { wind: ['saltwind', 'terraces', 'spireHeights'], solar: ['glasshouse', 'observatory'] } as Record<'wind' | 'solar', string[]>,
  /** Battery (E23.3.2.1): stores surplus and covers deficits, up to `rate` either way. */
  battery: { capacity: 6000, rate: 20 }, // a night (~0.4 day, 1150 s) of a pump and a lamp is ~4600 W·s
  /** Charger (E23.3.3): bloombot's charge per second while it sits on a powered pad (CHARGE.meditatePerSecond is 6). */
  charger: { rate: 6 },
  /** Helpers on the grid (E23.3.3, old-city rules): their draw while they stand. */
  helper: { droneHub: 4, cultivator: 4 },
  /** Starting draws per shed class (consumers may override with their own draw). */
  draw: { lamp: 0.5, pump: 3, helper: 4, charger: 6 } satisfies Record<ShedClass, number>,
};
