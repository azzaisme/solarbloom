import { SAVE_VERSION } from '../core/GameState';
import type { GameState } from '../core/types';

/**
 * Save-format migrations, oldest first. Each step upgrades a save in place by one version.
 * Missing top-level fields are filled from a fresh state afterwards, so steps only handle
 * nested data that a shallow merge can't fix.
 */
const STEPS: Record<number, (s: GameState) => void> = {
  // v1 (Round 1) → v2 (Round 2): machines gain a charge meter; the cat gains a stash counter.
  1: (s) => {
    for (const m of s.machines) (m as { charge?: number }).charge ??= 0;
    (s.cat as { stash?: number }).stash ??= 0;
    s.cat.log ??= [];
  },
};

export function migrate(s: GameState) {
  while (s.version < SAVE_VERSION) {
    STEPS[s.version]?.(s);
    s.version++;
  }
}
