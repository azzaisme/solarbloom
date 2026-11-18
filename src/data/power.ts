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
  /** Wind turbine (E23.3.2.2): output at full wind. */
  wind: { output: 10 },
  /** Battery (E23.3.2.1): stores surplus and covers deficits, up to `rate` either way. */
  battery: { capacity: 4000, rate: 20 },
  /** Starting draws per shed class (consumers may override with their own draw). */
  draw: { lamp: 0.5, pump: 3, helper: 4, charger: 6 } satisfies Record<ShedClass, number>,
};
