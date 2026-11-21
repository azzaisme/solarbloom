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

/**
 * #625: each Keeper, once woken, teaches Bloombot one small knack tied to its place, in its own voice (`taught`, said
 * between what it remembers and what it first asks for). A knack is Bloombot's for good from the moment its Keeper
 * wakes: gameplay/Knacks reads the Keepers' steps, so an old save's woken Keepers have taught theirs already. Each
 * shows as a bead on Bloombot (data/botParts, `knacks`) and as a row on its page (ui/BloombotPage).
 */
export type KnackKeeper = 'pylon' | 'tally' | 'tide' | 'moss' | 'sluice' | 'tock' | 'gable' | 'fern' | 'vega' | 'atlas';

export interface KnackDef {
  /** the Keeper who teaches it (its id) */
  keeper: KnackKeeper;
  name: string;
  /** what it does for Bloombot, one plain sentence */
  does: string;
  /** the Keeper's line when it teaches it, in its own voice */
  taught: string;
}

/** In map order, the order the page lists them and Bloombot wears them. */
export const KNACKS: readonly KnackDef[] = [
  { keeper: 'pylon', name: 'Quick charge', does: 'Sitting at a charger fills Bloombot a fifth faster.', taught: "Here's a trick. Sit square on a charger and the power comes in quicker." },
  { keeper: 'tally', name: 'Eye for value', does: 'Every fourth dig at a junk pile turns up one extra piece.', taught: "Junk is never just junk. Look twice and there's one more good piece in there." },
  { keeper: 'tide', name: 'Beachcomber', does: 'Junk piles you have dug fill back up a fifth sooner.', taught: 'The sea always brings things back. The piles you dig will fill up again sooner than you think.' },
  { keeper: 'moss', name: 'Green thumb', does: 'Bloombot gathers a quarter more Greens from each patch.', taught: 'Mm. Clip just above the leaf. More comes away that way.' },
  { keeper: 'sluice', name: 'Float along', does: 'Running uses a quarter less charge.', taught: "Float, don't push. The water taught me that. Sorry. You'll go further on the same charge." },
  { keeper: 'tock', name: 'Good timing', does: 'The Mega Pulse is ready a quarter sooner.', taught: 'Pulse on the beat and it adds up. Your big pulse will be ready sooner. Promptly.' },
  { keeper: 'gable', name: 'Easy rest', does: 'Resting by the fountain or on a bench brings charge back twice as fast.', taught: 'Sit down and look at the view. You rest twice as well when you stop properly.' },
  { keeper: 'fern', name: 'Warm hands', does: 'Crops in planters grow a fifth faster.', taught: 'Talk to your plants a little while they grow. Sorry. It really does help.' },
  { keeper: 'vega', name: 'Starlight', does: 'At night, pulses and running use a fifth less charge.', taught: "The stars never hurry. At night, you won't run down so fast either." },
  { keeper: 'atlas', name: 'Strong back', does: 'Bloombot carries 10 more of each thing.', taught: 'Lift with your legs. You can carry more than you think.' },
];

export const KNACK_TUNING = {
  /** Quick charge: a charger's rate, as a share of before */
  charger: 1.2,
  /** Eye for value: every this many digs, one extra piece */
  digEvery: 4,
  /** Beachcomber: how fast piles refill, as a share of before */
  refill: 1.2,
  /** Green thumb: Greens per gather, as a share of before */
  gather: 1.25,
  /** Float along: running's charge, as a share of before */
  run: 0.75,
  /** Good timing: what one pulse adds to the Mega Pulse (40 pulses become 30) */
  mega: 4 / 3,
  /** Easy rest: resting at home or on a bench, as a share of before */
  rest: 2,
  /** Warm hands: crop growth, as a share of before */
  crops: 1.2,
  /** Starlight: charge at night, as a share of before (pulses and running) */
  night: 0.8,
  /** Strong back: more of each thing in the backpack */
  carry: 10,
};
