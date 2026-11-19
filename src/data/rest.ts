// E23.2.3 (#373): benches and meditating at chargers. All data, no rules: starting values for tuning.
// The charge each gives back per second lives with the charge (data/charge.ts: benchPerSecond, meditatePerSecond).
import type { MaterialCost } from './salvage';

export const REST = {
  /** mending an old park bench (it is broken until then) */
  mendCost: { scrap: 3 } as MaterialCost,
  /** "let time run faster" while sitting: the world runs this many times as fast (a game day is 48 minutes) */
  fastTime: 4,
  /** the calm view: the camera eases out to this zoom (1 = the usual follow) */
  calmZoom: 0.55,
  /** the calm view turns this many degrees a second round bloombot */
  orbitDegPerSecond: 2.5,
  /**
   * Where bloombot and a friend sit on a bench (world units from its middle): `out` forward of the seat's middle,
   * bloombot `along` to one end when a friend joins, the friend `friend` to the other end.
   */
  seat: { out: 0.04, along: 0.2, friend: 0.24 },
  /** meditating: bloombot sits this far out from the charger pad's edge (inside the pad's reach, POWER.charger) */
  padGap: 0.35,
  /** the music swells to this share above its level while sitting */
  musicSwell: 0.6,
  /**
   * Until E23.9.2's friendship lands (`sim.keepers.isFriend`), a Keeper counts as a friend once its story is settled.
   * (Friendship, three gifts it loves after it settles, is what earns a seat beside bloombot.)
   */
  friendFrom: 'settled' as const,
  /** the park bench's seat, world units above the ground (the model's seat at 0.46, drawn at 0.58) */
  benchSeat: 0.27,
};

/**
 * Bloombot's sitting clips (E23.10.2.5, e23-proof's art pass, #482): sit down, sit, stand up; meditate cross-legged.
 * In `sit` the hips are `seatHips` metres above the feet (model metres, before bloombot's 0.95 scale), so on a bench
 * bloombot is lifted by the seat's height less that, and its short legs dangle.
 */
export const BOT_CLIPS = { sitDown: 'sit-down', sit: 'sit', standUp: 'stand-up', meditate: 'meditate', seatHips: 0.203 } as const;

/** How far to lift bloombot so its hips rest on a seat `seat` world units high (`scale`: bloombot's model scale). */
export function seatLift(seat: number, scale: number): number {
  return Math.max(0, seat - BOT_CLIPS.seatHips * scale);
}
