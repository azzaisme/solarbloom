// E23.2.4 (#374): wildlife visits by diversity. All data, no rules: starting values for tuning.
// While bloombot sits (a bench or a charger), animals come over: the more diverse the area, the more come and the
// closer they get. Animals are wild: visits alone never tame one (friendship is E23.2.5). No visitor is ever a cat.

export type DiversityTier = 'bare' | 'variety' | 'lively' | 'thriving' | 'rare';
export const TIERS: readonly DiversityTier[] = ['bare', 'variety', 'lively', 'thriving', 'rare'];
export const TIER_NAMES: Record<DiversityTier, string> = { bare: 'Bare', variety: 'Some variety', lively: 'Lively', thriving: 'Thriving', rare: 'Rare mix' };

/** E23.2.4.1: the area diversity score's weights, and the score each tier starts at. */
export const DIVERSITY = {
  /**
   * each kind of plant growing in the area: grass, wildflowers, shrubs, a wildflower meadow, the region's rare
   * plant, a grove, each tree species in bloom, water plants
   */
  perKind: 6,
  /** the share of the area's restored ground in bloom (flowers or more), times this */
  bloom: 30,
  /** each kind of fauna that has arrived on the island (butterflies, songbirds, koi, robots) */
  perFauna: 4,
  /** each wildlife home built in the area (E23.5.4.5) */
  perHome: 8,
  /** pollinators drawn by what loaded pulses grew in the area: this much per 10 */
  perTenPollinators: 3,
  /** a tier starts at this score ("rare mix" also needs the kinds below) */
  tiers: { bare: 0, variety: 12, lively: 30, thriving: 52, rare: 52 } as Record<DiversityTier, number>,
  /** "rare mix": thriving, with at least this many kinds of plant, a rare plant among them */
  rareKinds: 7,
  /** restored tiles an area needs before it counts as anything but bare */
  minRestored: 6,
  /** machine types that count as wildlife homes (E23.5.4.5 builds them) */
  homeTypes: ['birdBox', 'bugHotel', 'hedgehogHouse', 'batBox', 'beehive', 'wildlifeHome', 'fishPond'] as readonly string[],
};

/**
 * Where on (or beside) bloombot a visitor settles. The ones on bloombot follow its rig (VISIT_POINTS): head and
 * nest on the head, the shoulders, the lap (the hips, forward), landOn on a forearm.
 */
export type Perch = 'passBy' | 'landOn' | 'perchNear' | 'sniff' | 'head' | 'shoulderL' | 'shoulderR' | 'beside' | 'lap' | 'nest';

/** E23.2.4.2: the lowest tier each way of visiting happens at (the table in #374). */
export const PERCH_FROM: Record<Perch, DiversityTier> = {
  passBy: 'bare', // nothing, or a butterfly passes
  landOn: 'variety', // a butterfly lands on bloombot
  perchNear: 'variety', // a bird perches nearby
  head: 'lively', // birds on head and shoulders
  shoulderL: 'lively',
  shoulderR: 'lively',
  sniff: 'lively', // a hedgehog or squirrel sniffs
  beside: 'thriving', // a fox curls up beside it
  lap: 'thriving', // a frog in its lap
  nest: 'thriving', // birds nest on its head
};

/** Perches that take one visitor at a time (the rest have room for a few, spaced out). */
export const SINGLE_PERCHES: readonly Perch[] = ['head', 'nest', 'shoulderL', 'shoulderR', 'lap', 'landOn', 'beside'];
/** Perches on bloombot itself (climbing on it). */
export const ON_BOT: readonly Perch[] = ['landOn', 'head', 'shoulderL', 'shoulderR', 'lap', 'nest'];

export interface VisitorDef {
  id: string;
  name: string;
  icon: string;
  /** the lowest tier it comes at */
  from: DiversityTier;
  /** how it likes to visit, best first: it takes the first perch the tier allows and nobody holds */
  perches: Perch[];
  /** flies in (else walks or hops) */
  flies?: boolean;
  /** only at night (else any time) */
  night?: boolean;
  /** only found in the most diverse places (marked in the log) */
  rare?: boolean;
  /** how big it is (its radius in world units at gameplay scale), for keeping clear of bloombot's body */
  size: number;
}

/** E23.2.4.2: who comes, from which tier, and how. Butterflies, bees and birds first: they come to bare ground too. */
export const VISITORS: VisitorDef[] = [
  { id: 'butterfly', name: 'Butterfly', icon: '🦋', from: 'bare', perches: ['landOn', 'passBy'], flies: true, size: 0.05 },
  { id: 'songbird', name: 'Songbird', icon: '🐦', from: 'variety', perches: ['nest', 'head', 'shoulderL', 'shoulderR', 'perchNear'], flies: true, size: 0.07 },
  { id: 'bumblebee', name: 'Bumblebee', icon: '🐝', from: 'variety', perches: ['landOn', 'passBy'], flies: true, size: 0.035 },
  { id: 'hedgehog', name: 'Hedgehog', icon: '🦔', from: 'lively', perches: ['sniff', 'beside'], size: 0.09 },
  { id: 'squirrel', name: 'Squirrel', icon: '🐿️', from: 'lively', perches: ['shoulderR', 'sniff', 'beside'], size: 0.08 },
  { id: 'magpie', name: 'Magpie', icon: '🐦‍⬛', from: 'lively', perches: ['shoulderL', 'perchNear'], flies: true, size: 0.09 },
  { id: 'fox', name: 'Fox', icon: '🦊', from: 'thriving', perches: ['beside', 'sniff'], size: 0.16 },
  { id: 'frog', name: 'Frog', icon: '🐸', from: 'thriving', perches: ['lap', 'sniff'], size: 0.06 },
  { id: 'owl', name: 'Owl', icon: '🦉', from: 'thriving', perches: ['head', 'perchNear'], flies: true, night: true, size: 0.1 },
  { id: 'otter', name: 'Otter', icon: '🦦', from: 'thriving', perches: ['beside', 'sniff'], size: 0.13 },
  { id: 'kingfisher', name: 'Kingfisher', icon: '🐦', from: 'rare', perches: ['shoulderR', 'perchNear'], flies: true, rare: true, size: 0.06 },
  { id: 'fawn', name: 'Red deer fawn', icon: '🦌', from: 'rare', perches: ['beside', 'perchNear'], rare: true, size: 0.22 },
  { id: 'swallowtail', name: 'Swallowtail', icon: '🦋', from: 'rare', perches: ['nest', 'landOn', 'passBy'], flies: true, rare: true, size: 0.06 },
];

/**
 * E23.10 (batch B4): how each visitor's own model is drawn (assets/raw/models/visitors/<id>.glb; the primitive
 * placeholder stands in for any kind without one). `length`: its longest side in world units (the model is scaled
 * to it, centred over its feet); `turn`: degrees to turn it so it faces +z like the placeholders; `lift`: raised by
 * this (world units), for one that should hover over its perch.
 */
export const VISITOR_LOOK: Record<string, { length: number; turn?: number; lift?: number }> = {
  butterfly: { length: 0.09 },
  songbird: { length: 0.15 },
  bumblebee: { length: 0.06 },
  hedgehog: { length: 0.2 },
  squirrel: { length: 0.22 },
  magpie: { length: 0.24 },
  fox: { length: 0.36 },
  frog: { length: 0.12 },
  owl: { length: 0.2 },
  otter: { length: 0.36 },
  kingfisher: { length: 0.14 },
  fawn: { length: 0.42 },
  swallowtail: { length: 0.1 },
};

/** E23.2.4.2: how many come over while bloombot sits, and their timing. */
export const VISIT = {
  /** how many visit, by tier (one after another, a few seconds apart) */
  count: { bare: 1, variety: 2, lively: 4, thriving: 6, rare: 7 } as Record<DiversityTier, number>,
  /** a bare area: a butterfly passes only this share of the times bloombot sits */
  bareChance: 0.6,
  /** seconds before the first arrives, then between arrivals */
  first: 2,
  every: 3.5,
  /** seconds to fly or walk in, and to leave once bloombot stands */
  approach: 2.4,
  leave: 1.6,
  /** how far away they come from (world units) */
  from: 5,
  /** a passer-by is gone again after this many seconds */
  passSeconds: 4,
  /** a visitor stays near bloombot this far apart from the next one at a shared perch (world units) */
  spacing: 0.32,
};

/**
 * Where each perch is, relative to bloombot. `bone`: the rig bone it rides (head, shoulders, hips, forearm); the
 * offset is in bloombot's own space (x to its left, y up, z forward), in world units. Without the rig (the
 * stand-in) the `fallback` offset from bloombot's feet is used. `clear`: how far the perch point sits from the
 * body's surface, so a visitor no bigger than that never sinks into bloombot (tests/wildlife.test.ts checks it).
 */
export const VISIT_POINTS: Record<Perch, { bone?: string; offset: [number, number, number]; fallback: [number, number, number]; clear: number }> = {
  head: { bone: 'head_end', offset: [0, 0.03, -0.02], fallback: [0, 0.78, 0], clear: 0.12 },
  nest: { bone: 'head_end', offset: [0, 0.03, 0.02], fallback: [0, 0.8, 0], clear: 0.12 },
  shoulderL: { bone: 'LeftShoulder', offset: [0.07, 0.11, 0], fallback: [0.17, 0.5, 0], clear: 0.1 },
  shoulderR: { bone: 'RightShoulder', offset: [-0.07, 0.11, 0], fallback: [-0.17, 0.5, 0], clear: 0.1 },
  lap: { bone: 'Hips', offset: [0, 0.07, 0.15], fallback: [0, 0.32, 0.16], clear: 0.07 },
  landOn: { bone: 'LeftForeArm', offset: [0, 0.05, 0], fallback: [0.2, 0.38, 0.06], clear: 0.06 },
  // beside bloombot on its right: up on the bench seat when it is free, else on the ground (a friend Keeper sits on
  // bloombot's left, on the seat). Back 0.14: the seat's middle, as bloombot sits forward on it (REST.seat.out 0.16)
  beside: { offset: [-0.42, 0, -0.14], fallback: [-0.42, 0, -0.14], clear: 0.24 },
  sniff: { offset: [0.12, 0, 0.5], fallback: [0.12, 0, 0.5], clear: 0.3 },
  perchNear: { offset: [-0.9, 0, 0.6], fallback: [-0.9, 0, 0.6], clear: 0.6 },
  passBy: { offset: [0, 0.6, 0.7], fallback: [0, 0.6, 0.7], clear: 0.5 },
};
