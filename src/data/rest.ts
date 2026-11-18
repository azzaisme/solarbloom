// E23.2.3 (#373): benches and meditating at chargers. All data, no rules: starting values for tuning.
// The charge each gives back per second lives with the charge (data/charge.ts: benchPerSecond, meditatePerSecond).
import type { MaterialCost } from './salvage';

export const REST = {
  /** mending an old park bench (it is broken until then) */
  mendCost: { scrap: 3 } as MaterialCost,
  /** "let time run faster" while sitting: the world runs this many times as fast (a game day is 48 minutes) */
  fastTime: 4,
  /** the calm view: the camera eases out to this zoom (1 = the usual follow) and lifts this many degrees */
  calmZoom: 0.55,
  /** seconds the camera takes to ease out and back */
  ease: 1.4,
  /** the music swells to this share above its level while sitting */
  musicSwell: 0.6,
  /** Keepers at this step or later are friends and may sit beside bloombot */
  friendFrom: 'request2' as const,
};
