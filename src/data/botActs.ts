import type { PropId } from './botProps';

/**
 * #628: Bloombot acts out what Interact does. Each Interact verb has an act: a short procedural pose drawn over its
 * idle clip (BloombotVisuals), a little tool or thing in its hand (src/data/botProps.ts), and a small effect where
 * it works, thrown out to the sides and up so it shows from behind.
 *
 * The verbs (Game.interactCandidates, OldCity, Resting), and what each does:
 *
 *   held:        Salvage → rummage, Pry → pry, Gather → gather, Prune → prune (they loop while Interact is held,
 *                then finish)
 *   one press:   Dig up → dig · Harvest → harvest · Tend, Feed → tend · Repair, Mend → repair · Wake → wake
 *                Say hello, Talk to, Trade with, Give a gift to → greet · Read → read · Listen to → listen
 *                Look out, Look at → look · Open, Use, Pick up, Bring things to, Reset, Plant in,
 *                Choose what grows on → reach
 *   in a panel:  planting a seed (the planter) → plant · feeding, picking or pruning (the extras) → tend or harvest
 *   own poses:   Sit on, Meditate at, Sleep, Ride up and Ride down already have theirs, so they get no act
 *
 * A pose is a set of channels in degrees. Each channel is `[base, amp?, harmonic?, phase?]`: its value is
 * `base + amp × sin(harmonic × 2π t / period + phase)`, where `t` is seconds into the act. Reduced motion keeps the
 * base pose and drops the swings.
 */
export type ActId = 'rummage' | 'pry' | 'gather' | 'prune' | 'dig' | 'plant' | 'tend' | 'harvest' | 'repair' | 'wake' | 'greet' | 'read' | 'listen' | 'look' | 'reach';

/**
 * The channels. lean: the spine tips forward (back if negative); twist: it turns left (+) or right; knee: its knees
 * bend (the thighs come forward, the shins back) and it sinks so its feet stay on the ground, a crouch; head: pitch
 * down (+), yaw left (+), roll to its left (+); arms: raise forward (+), out to the side (+), elbow bend (+).
 */
export type ActChannel = 'lean' | 'twist' | 'knee' | 'headPitch' | 'headYaw' | 'headRoll' | 'lRaise' | 'lOut' | 'lElbow' | 'rRaise' | 'rOut' | 'rElbow';
export type Wave = readonly [base: number, amp?: number, harmonic?: number, phase?: number];

export interface ActEffect {
  /** 'burst' (dust, soil, chips, leaves, water) or 'sparkles' (the glowing ones) */
  kind: 'burst' | 'sparkles';
  /** on the ground just in front of Bloombot, at its hands, or at the working end of what it holds */
  at: 'ground' | 'hands' | 'tool';
  count: number;
  hex?: string;
  speed?: number;
  up?: number;
  size?: number;
  life?: number;
  gravity?: number;
  /**
   * Thrown so it shows from behind (the follow camera): out to either side by up to `fan`, and back toward the
   * camera by `back` (world units per second, on top of the burst's own scatter).
   */
  fan?: number;
  back?: number;
}

export interface ActDef {
  /** what it holds while it acts, and in which hand */
  prop?: { id: PropId; hand: 'left' | 'right' };
  /** seconds per swing (the loop's length while held) */
  period: number;
  /** a one-press act lasts this long (held acts loop until let go) */
  once: number;
  channels: Partial<Record<ActChannel, Wave>>;
  /** while it works: an effect every `every` seconds */
  tick?: ActEffect & { every: number };
  /** as it finishes (a hold that completes, or a one-press act at its end) */
  finish?: ActEffect;
}

/** how quickly an act eases in and out (seconds) */
export const ACT_EASE = { in: 0.16, out: 0.28 };

const DUST = '#8a755a';
const SOIL = '#7a5a3c';
const LEAF = '#7fc46a';
const STONE = '#6e6862';
const SPARK = '#ffcf6a';
const WATER = '#bfe6ff';

export const ACTS: Record<ActId, ActDef> = {
  // Salvage: bent right over the pile, bobbing, one hand rummaging while the other holds the sack open out to the
  // side; dust and bits of stone kicked out both sides
  rummage: {
    prop: { id: 'sack', hand: 'left' },
    period: 0.5,
    once: 0.8,
    channels: { lean: [38, 10, 2], twist: [0, 16], knee: [30, 12, 2], headPitch: [18, 8, 2], lRaise: [30], lOut: [42], lElbow: [30], rRaise: [72, 34], rElbow: [30, 26, 1, 1.6], rOut: [8, 8] },
    tick: { kind: 'burst', at: 'ground', every: 0.22, count: 6, hex: DUST, speed: 0.5, up: 2.2, size: 0.09, life: 0.75, gravity: 4, fan: 1.3, back: 0.5 },
    finish: { kind: 'burst', at: 'ground', count: 14, hex: STONE, speed: 0.7, up: 2.8, size: 0.08, life: 0.8, fan: 1.6, back: 0.6 },
  },
  // Pry: feet set, the bar's foot under the rubble, leaning right back and heaving; grit thrown out each heave
  pry: {
    prop: { id: 'bar', hand: 'right' },
    period: 0.8,
    once: 1.2,
    channels: { lean: [-16, 16], twist: [-10, 8], knee: [38, 14], headPitch: [4, -10], lRaise: [74, 12], lElbow: [22, -14], rRaise: [70, 12], rElbow: [22, -14], lOut: [6], rOut: [26] },
    tick: { kind: 'burst', at: 'tool', every: 0.4, count: 7, hex: STONE, speed: 0.6, up: 2.4, size: 0.08, life: 0.75, gravity: 5, fan: 1.4, back: 0.3 },
    finish: { kind: 'burst', at: 'tool', count: 22, hex: DUST, speed: 1.2, up: 3.2, size: 0.1, life: 1.0, fan: 1.8, back: 0.8 },
  },
  // Gather: stooped, one hand picking, the basket out on the other arm; bits of leaf up and out
  gather: {
    prop: { id: 'basket', hand: 'left' },
    period: 0.6,
    once: 0.9,
    channels: { lean: [30, 8, 2], twist: [0, 12], knee: [24, 10, 2], headPitch: [20, 6, 2], headYaw: [0, 10], lRaise: [18], lOut: [40], lElbow: [20], rRaise: [70, 18, 2], rElbow: [26, -20, 2], rOut: [10, 10] },
    tick: { kind: 'burst', at: 'hands', every: 0.3, count: 5, hex: LEAF, speed: 0.4, up: 2.0, size: 0.06, life: 0.8, gravity: 3, fan: 1.0, back: 0.3 },
    finish: { kind: 'sparkles', at: 'tool', count: 8, life: 0.8 },
  },
  // E27.2 (#680) Prune: up close to the plant, the shears held out at chest height and snipping fast, the other hand
  // steadying a branch; head tipped to see the cut, leaves falling from each snip and a little shower as it finishes
  prune: {
    prop: { id: 'shears', hand: 'right' },
    period: 0.36,
    once: 1.0,
    channels: { lean: [16, 4, 2], twist: [0, 14, 1], knee: [10, 6, 2], headPitch: [8, 6, 2], headYaw: [0, 12, 1], headRoll: [8], rRaise: [96, 10, 1], rElbow: [30, 26, 2], rOut: [8, 10, 1], lRaise: [104], lElbow: [22, 8, 2], lOut: [-6] },
    tick: { kind: 'burst', at: 'tool', every: 0.18, count: 4, hex: LEAF, speed: 0.35, up: 0.6, size: 0.06, life: 1.0, gravity: 2.5, fan: 1.1, back: 0.3 },
    finish: { kind: 'burst', at: 'tool', count: 16, hex: LEAF, speed: 0.6, up: 1.4, size: 0.07, life: 1.2, gravity: 2.5, fan: 1.6, back: 0.6 },
  },
  // Dig up: right down in a crouch, the trowel scooping; soil flung back over its shoulders
  dig: {
    prop: { id: 'trowel', hand: 'right' },
    period: 0.55,
    once: 1.1,
    channels: { lean: [40, 12], knee: [56, 10], headPitch: [18, 6], lRaise: [60, 20], lElbow: [30], lOut: [20], rRaise: [74, 38], rElbow: [20, 16, 1, 1.6], rOut: [12] },
    tick: { kind: 'burst', at: 'tool', every: 0.27, count: 7, hex: SOIL, speed: 0.4, up: 3.0, size: 0.09, life: 0.8, gravity: 5, fan: 0.9, back: 1.4 },
    finish: { kind: 'sparkles', at: 'ground', count: 10 },
  },
  // Planting a seed: down on its heels, the trowel pressing the soil firm
  plant: {
    prop: { id: 'trowel', hand: 'right' },
    period: 0.5,
    once: 1.1,
    channels: { lean: [30, 8, 2], knee: [66, 6, 2], headPitch: [24, 4, 2], rRaise: [76, 12, 2], rElbow: [18, -16, 2], rOut: [10], lRaise: [30], lOut: [30] },
    tick: { kind: 'burst', at: 'tool', every: 0.5, count: 6, hex: SOIL, speed: 0.4, up: 1.6, size: 0.06, life: 0.6, gravity: 4, fan: 1.1, back: 0.4 },
    finish: { kind: 'sparkles', at: 'ground', count: 8 },
  },
  // Tend and feed: the watering can held out to the side and tipped, a little shower from the spout
  tend: {
    prop: { id: 'can', hand: 'right' },
    period: 0.6,
    once: 1.3,
    channels: { lean: [18, 5, 2], twist: [0, 8], knee: [12, 6, 2], headPitch: [14], headRoll: [14, 6], rRaise: [58, 8, 2], rOut: [46], rElbow: [26, 8, 2], lRaise: [14], lOut: [10] },
    tick: { kind: 'burst', at: 'tool', every: 0.12, count: 3, hex: WATER, speed: 0.15, up: 0.2, size: 0.04, life: 0.45, gravity: 6 },
    finish: { kind: 'sparkles', at: 'ground', count: 6 },
  },
  // Harvest: reaching up into the plant and tugging back, the basket on the other arm
  harvest: {
    prop: { id: 'basket', hand: 'left' },
    period: 0.5,
    once: 1.0,
    channels: { lean: [8, 14], knee: [8, 10, 2], headPitch: [-10, 6], lRaise: [18], lOut: [40], lElbow: [20], rRaise: [118, -24], rElbow: [16, 16], rOut: [12] },
    tick: { kind: 'burst', at: 'hands', every: 0.5, count: 5, hex: LEAF, speed: 0.5, up: 2.0, size: 0.06, life: 0.8, gravity: 4, fan: 1.0, back: 0.3 },
    finish: { kind: 'sparkles', at: 'tool', count: 8 },
  },
  // Repair and mend: the spanner raised high and brought down, a spark at each knock
  repair: {
    prop: { id: 'wrench', hand: 'right' },
    period: 0.4,
    once: 1.2,
    channels: { lean: [22, 6], knee: [16, 10], headPitch: [16, 4], rRaise: [110, 50], rElbow: [40, -30], rOut: [16], lRaise: [48], lElbow: [34] },
    tick: { kind: 'burst', at: 'tool', every: 0.4, count: 6, hex: SPARK, speed: 1.2, up: 2.0, size: 0.04, life: 0.45, gravity: 6, fan: 0.8 },
    finish: { kind: 'sparkles', at: 'tool', count: 8 },
  },
  // Wake a landmark: rising tall, a glow held out in both palms
  wake: {
    prop: { id: 'orb', hand: 'right' },
    period: 0.5,
    once: 1.1,
    channels: { lean: [-6, 6], knee: [14, 10], headPitch: [-10, 4], lRaise: [104, 8], lElbow: [8], rRaise: [104, 8], rElbow: [8], lOut: [10], rOut: [4] },
    tick: { kind: 'sparkles', at: 'tool', every: 0.25, count: 3 },
    finish: { kind: 'sparkles', at: 'tool', count: 14 },
  },
  // Say hello and talk: a little bounce and a wave, holding up a flower
  greet: {
    prop: { id: 'flower', hand: 'right' },
    period: 0.36,
    once: 1.3,
    channels: { twist: [0, 10], knee: [8, 8, 2], headRoll: [12, 8], headPitch: [-8], rOut: [150], rRaise: [24], rElbow: [24, 28], lRaise: [8] },
    finish: { kind: 'sparkles', at: 'tool', count: 5 },
  },
  // Read a page: holding it up, head bent over it, nodding along
  read: {
    prop: { id: 'page', hand: 'right' },
    period: 1.4,
    once: 1.6,
    channels: { lean: [12, 3, 2], headPitch: [30, 5, 2], headYaw: [0, 10], lRaise: [60], lElbow: [74], rRaise: [60], rElbow: [74], lOut: [-6], rOut: [-6] },
    finish: { kind: 'sparkles', at: 'tool', count: 4 },
  },
  // Listen: head tipped right over, a shell held to its ear
  listen: {
    prop: { id: 'shell', hand: 'left' },
    period: 1.4,
    once: 1.6,
    channels: { lean: [10], twist: [0, 8], knee: [6, 4], headRoll: [-26, 5], lOut: [84], lRaise: [40], lElbow: [100] },
    finish: { kind: 'sparkles', at: 'tool', count: 4 },
  },
  // Look out: the spyglass up, turning to sweep left and right
  look: {
    prop: { id: 'spyglass', hand: 'right' },
    period: 1.6,
    once: 1.8,
    channels: { lean: [-6], twist: [0, 22], headPitch: [-10], headYaw: [0, 24], rRaise: [140], rElbow: [40], rOut: [-12], lRaise: [40], lOut: [16] },
    finish: { kind: 'sparkles', at: 'tool', count: 3 },
  },
  // Open, use, pick up, hand over: a quick bob and reach forward with both hands (what it opens is the thing in hand)
  reach: {
    period: 0.7,
    once: 0.8,
    channels: { lean: [20, 8], knee: [16, 8], headPitch: [10], lRaise: [76], lElbow: [16], lOut: [10], rRaise: [76], rElbow: [16], rOut: [10] },
    finish: { kind: 'sparkles', at: 'hands', count: 4 },
  },
};

/** The verbs that are held (OldCity.startHold's kinds) and their acts. */
export const HOLD_ACTS: Record<string, ActId> = { salvage: 'rummage', pry: 'pry', gather: 'gather', prune: 'prune', pick: 'harvest' };

/** The act for an Interact verb (the prompt's verb), or undefined for the ones with poses of their own. */
export function actForVerb(verb: string): ActId | undefined {
  return VERB_ACTS[verb];
}

export const VERB_ACTS: Record<string, ActId | undefined> = {
  Salvage: 'rummage',
  Pry: 'pry',
  'Pry open': 'pry', // #626: a vault door (Pry II)
  Gather: 'gather',
  Prune: 'prune', // E27.2 (#680): an orchard, the roses, a parklet's planters
  'Dig up': 'dig',
  Harvest: 'harvest',
  Pick: 'harvest', // #785: ripe fruit off a fruit tree
  Tend: 'tend',
  Feed: 'tend',
  Repair: 'repair',
  Mend: 'repair',
  Grow: 'repair', // #782: the house's next level
  'Go inside': 'reach', // #782: the house's door, opened
  'Go outside': 'reach',
  Wake: 'wake',
  'Say hello': 'greet',
  'Talk to': 'greet',
  'Trade with': 'greet',
  'Give a gift to': 'greet',
  Read: 'read',
  'Listen to': 'listen',
  'Look out': 'look',
  'Look at': 'look',
  Open: 'reach',
  Use: 'reach',
  'Pick up': 'reach',
  'Bring things to': 'reach',
  Reset: 'reach',
  'Plant in': 'reach',
  'Choose what grows on': 'reach',
  'Sit on': undefined,
  'Meditate at': undefined,
  Sleep: undefined,
  'Ride up': undefined,
  'Ride down': undefined,
  // E25 (#626): the trips the level II moves take are their own motion (Bloombot hovers, climbs or glides there)
  'Hover over to': undefined,
  'Hover back to': undefined,
  'Glide over to': undefined,
  'Glide down to': undefined,
  'Climb up onto': undefined,
  'Climb down': undefined,
};
