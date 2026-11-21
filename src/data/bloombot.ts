// E25 (#630): Bloombot grows. Words and numbers only; the systems that read them say where.

/**
 * #622: greening the park grows Bloombot. Before the fountain's first step there was nothing to grow into; now each
 * of three park milestones gives a small first growth, kept for good once earned (gameplay/ParkGrowth). Each shows
 * on Bloombot as a part (rendering/BloombotVisuals) and on its page in the backpack (ui/BloombotPage).
 */
export interface ParkGrowthDef {
  /** 1, 2, 3: the order they come in */
  step: number;
  id: 'spill' | 'thrift' | 'quick';
  /** park tiles brought back to life */
  tiles: number;
  name: string;
  /** what it does for Bloombot, one plain sentence */
  does: string;
  /** the part of Bloombot it shows on */
  part: 'bud' | 'collar' | 'cuffs';
}

export const PARK_GROWTH: readonly ParkGrowthDef[] = [
  { step: 1, id: 'spill', tiles: 20, name: 'Spreading pulse', does: 'A pulse on dry ground wakes the patch beside it too.', part: 'bud' },
  { step: 2, id: 'thrift', tiles: 40, name: 'Steady charge', does: 'Pulses, moves and running use a tenth less charge.', part: 'collar' },
  { step: 3, id: 'quick', tiles: 60, name: 'Nimble hands', does: 'Digging things out of a junk pile takes a quarter less time.', part: 'cuffs' },
];

export const PARK_GROWTH_TUNING = {
  /** Spreading pulse: tiles beside the pulsed one that it wakes too */
  spill: 1,
  /** Steady charge: what charge costs, as a share of before */
  chargeFactor: 0.9,
  /** Nimble hands: how long a salvage hold takes, as a share of before */
  holdFactor: 0.75,
  /** how often the park is counted (sim seconds) */
  checkEvery: 0.5,
};
