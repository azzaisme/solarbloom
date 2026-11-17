import { TUNING } from '../src/data/tuning';

/**
 * Region unlocks (18 Nov 2026) seal every newly revealed area until it is bought. Tests written before them
 * expect revealed areas to be open at once, so they run with the seal off; tests about unlocks (and bots
 * measuring pacing with them) switch it on with `withUnlocks` or `TUNING.city.unlock.enabled = true`.
 */
(TUNING.city.unlock as { enabled: boolean }).enabled = false;
