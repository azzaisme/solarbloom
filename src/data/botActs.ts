/**
 * #628: Bloombot acts out what Interact does. Each Interact verb has an act: a short procedural pose drawn over its
 * idle clip (BloombotVisuals), with a small effect where its hands work.
 *
 * The verbs (Game.interactCandidates, OldCity, Resting), and what each does:
 *
 *   held:        Salvage → rummage, Pry → pry, Gather → gather (they loop while Interact is held, then finish)
 *   one press:   Dig up → dig · Harvest → harvest · Tend, Feed → tend · Repair, Mend → repair · Wake → wake
 *                Say hello, Talk to, Trade with, Give a gift to → greet · Read → read · Listen to → listen
 *                Look out, Look at → look · Open, Use, Pick up, Bring things to, Reset, Plant in,
 *                Choose what grows on → reach
 *   in a panel:  planting a seed (the planter) → plant · feeding, picking or pruning (the extras) → tend or harvest
 *   own poses:   Sit on, Meditate at, Sleep, Ride up and Ride down already have theirs, so they get no act
 *
 * A pose is a set of channels in degrees (crouch in world units). Each channel is
 * `[base, amp?, harmonic?, phase?]`: its value is `base + amp × sin(harmonic × 2π t / period + phase)`, where `t`
 * is seconds into the act. Reduced motion keeps the base pose and drops the swings.
 */
export type ActId = 'rummage' | 'pry' | 'gather' | 'dig' | 'plant' | 'tend' | 'harvest' | 'repair' | 'wake' | 'greet' | 'read' | 'listen' | 'look' | 'reach';

/**
 * The channels. lean: the spine tips forward (back if negative); twist: it turns left (+) or right; crouch: it
 * sinks (world units) with its knees bending by `knee`; head: pitch down (+), yaw left (+), roll to its left (+);
 * arms: raise forward (+), out to the side (+), elbow bend (+).
 */
export type ActChannel = 'lean' | 'twist' | 'crouch' | 'knee' | 'headPitch' | 'headYaw' | 'headRoll' | 'lRaise' | 'lOut' | 'lElbow' | 'rRaise' | 'rOut' | 'rElbow';
export type Wave = readonly [base: number, amp?: number, harmonic?: number, phase?: number];

export interface ActEffect {
  /** 'burst' (dust, soil, chips, leaves) or 'sparkles' (the glowing ones) */
  kind: 'burst' | 'sparkles';
  /** on the ground just in front of Bloombot, or at its hands */
  at: 'ground' | 'hands';
  count: number;
  hex?: string;
  speed?: number;
  up?: number;
  size?: number;
  life?: number;
  gravity?: number;
}

export interface ActDef {
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

const DUST = '#c9b48f';
const SOIL = '#7a5a3c';
const LEAF = '#7fc46a';
const STONE = '#a89c8c';
const SPARK = '#ffcf6a';

export const ACTS: Record<ActId, ActDef> = {
  // Salvage: bent over the pile, both hands rummaging in turn, a puff of dust and bits of scrap flying
  rummage: {
    period: 0.5,
    once: 0.8,
    channels: { lean: [30, 8, 2], twist: [0, 14], crouch: [0.05, 0.015, 2], knee: [18, 4, 2], headPitch: [16, 6, 2], lRaise: [62, 30], lElbow: [34, 22, 1, 1.6], rRaise: [62, -30], rElbow: [34, -22, 1, 1.6], lOut: [10], rOut: [10] },
    tick: { kind: 'burst', at: 'ground', every: 0.25, count: 4, hex: DUST, speed: 0.6, up: 1.4, size: 0.05, life: 0.55, gravity: 4 },
    finish: { kind: 'burst', at: 'ground', count: 10, hex: STONE, speed: 0.9, up: 2.2, size: 0.06, life: 0.7 },
  },
  // Pry: feet set, both hands on the lever, leaning back and heaving; grit and chips at each heave
  pry: {
    period: 0.8,
    once: 1.2,
    channels: { lean: [-10, 14], crouch: [0.06, 0.02], knee: [22, 8], headPitch: [6, -8], lRaise: [80, 10], lElbow: [18, -12], rRaise: [80, 10], rElbow: [18, -12], lOut: [4], rOut: [4] },
    tick: { kind: 'burst', at: 'ground', every: 0.4, count: 5, hex: STONE, speed: 0.8, up: 1.6, size: 0.05, life: 0.6, gravity: 5 },
    finish: { kind: 'burst', at: 'ground', count: 16, hex: DUST, speed: 1.4, up: 2.6, size: 0.08, life: 0.9 },
  },
  // Gather: one hand picking at the clippings, the other held in front like a basket; bits of leaf
  gather: {
    period: 0.6,
    once: 0.9,
    channels: { lean: [24, 6, 2], twist: [0, 10], crouch: [0.03, 0.01, 2], headPitch: [20, 4, 2], headYaw: [0, 10], lRaise: [44], lElbow: [70], rRaise: [66, 16, 2], rElbow: [26, -18, 2], rOut: [6, 8] },
    tick: { kind: 'burst', at: 'hands', every: 0.3, count: 3, hex: LEAF, speed: 0.4, up: 1.2, size: 0.045, life: 0.6, gravity: 3 },
    finish: { kind: 'sparkles', at: 'hands', count: 6, life: 0.7 },
  },
  // Dig up: crouched, both hands scooping together, soil flying
  dig: {
    period: 0.55,
    once: 1.1,
    channels: { lean: [34, 10], crouch: [0.08, 0.02], knee: [26, 6], headPitch: [18, 6], lRaise: [72, 34], lElbow: [20, 14, 1, 1.6], rRaise: [72, 34], rElbow: [20, 14, 1, 1.6], lOut: [12], rOut: [12] },
    tick: { kind: 'burst', at: 'ground', every: 0.27, count: 5, hex: SOIL, speed: 0.8, up: 1.8, size: 0.05, life: 0.6, gravity: 5 },
    finish: { kind: 'sparkles', at: 'ground', count: 8 },
  },
  // Planting a seed: down low, one hand pressing it into the soil
  plant: {
    period: 0.5,
    once: 1.1,
    channels: { lean: [26, 4, 2], crouch: [0.12, 0.015, 2], knee: [34], headPitch: [24, 4, 2], rRaise: [74, 8, 2], rElbow: [18, -14, 2], lRaise: [24], lOut: [16] },
    tick: { kind: 'burst', at: 'hands', every: 0.5, count: 4, hex: SOIL, speed: 0.4, up: 0.9, size: 0.045, life: 0.5, gravity: 4 },
    finish: { kind: 'sparkles', at: 'ground', count: 6 },
  },
  // Tend and feed: a gentle pat, head tipped fondly to one side
  tend: {
    period: 0.6,
    once: 1.2,
    channels: { lean: [16, 4, 2], twist: [0, 6], headPitch: [12], headRoll: [14, 6], rRaise: [60, 10, 2], rElbow: [30, 10, 2], lRaise: [14] },
    tick: { kind: 'sparkles', at: 'hands', every: 0.6, count: 2 },
    finish: { kind: 'sparkles', at: 'hands', count: 5 },
  },
  // Harvest: reaching up into the plant, then a tug back
  harvest: {
    period: 0.5,
    once: 1.0,
    channels: { lean: [10, 10], crouch: [0, 0.015, 2], headPitch: [-8, 4], lRaise: [100, -20], lElbow: [16, 14], rRaise: [100, -20], rElbow: [16, 14], lOut: [10], rOut: [10] },
    tick: { kind: 'burst', at: 'hands', every: 0.5, count: 3, hex: LEAF, speed: 0.5, up: 1.4, size: 0.05, life: 0.6, gravity: 4 },
    finish: { kind: 'sparkles', at: 'hands', count: 7 },
  },
  // Repair and mend: tapping it back together, a spark at each tap
  repair: {
    period: 0.4,
    once: 1.2,
    channels: { lean: [18, 4], crouch: [0.04, 0.015], headPitch: [16, 4], rRaise: [80, 28], rElbow: [40, -24], lRaise: [48], lElbow: [34] },
    tick: { kind: 'burst', at: 'hands', every: 0.4, count: 4, hex: SPARK, speed: 1, up: 1.4, size: 0.035, life: 0.4, gravity: 6 },
    finish: { kind: 'sparkles', at: 'hands', count: 6 },
  },
  // Wake a landmark: both palms pushed forward, a glow at the hands
  wake: {
    period: 0.5,
    once: 1.1,
    channels: { lean: [12, 6], headPitch: [-6, 3], lRaise: [96, 6], lElbow: [8], rRaise: [96, 6], rElbow: [8], lOut: [8], rOut: [8] },
    tick: { kind: 'sparkles', at: 'hands', every: 0.35, count: 2 },
    finish: { kind: 'sparkles', at: 'hands', count: 10 },
  },
  // Say hello and talk: a wave, head tipped
  greet: {
    period: 0.36,
    once: 1.2,
    channels: { twist: [0, 8], headRoll: [10, 6], headPitch: [-8], rOut: [150], rRaise: [20], rElbow: [24, 28], lRaise: [6] },
    finish: { kind: 'sparkles', at: 'hands', count: 3 },
  },
  // Read a page: holding it up, head down over it
  read: {
    period: 1.4,
    once: 1.5,
    channels: { lean: [10], headPitch: [30, 3], headYaw: [0, 8], lRaise: [56], lElbow: [74], rRaise: [56], rElbow: [74], lOut: [-6], rOut: [-6] },
    finish: { kind: 'sparkles', at: 'hands', count: 3 },
  },
  // Listen: head tipped right over, a hand by its ear
  listen: {
    period: 1.4,
    once: 1.5,
    channels: { lean: [10], twist: [0, 6], headRoll: [-24, 4], lOut: [80], lRaise: [40], lElbow: [100] },
    finish: { kind: 'sparkles', at: 'hands', count: 3 },
  },
  // Look out: a hand up by its visor, turning to look left and right
  look: {
    period: 1.6,
    once: 1.7,
    channels: { lean: [-4], twist: [0, 14], headPitch: [-10], headYaw: [0, 26], rRaise: [150], rElbow: [30], rOut: [-12] },
    finish: { kind: 'sparkles', at: 'hands', count: 2 },
  },
  // Open, use, pick up, hand over: a quick reach forward
  reach: {
    period: 0.7,
    once: 0.7,
    channels: { lean: [14, 6], headPitch: [8], lRaise: [70], lElbow: [16], rRaise: [70], rElbow: [16] },
    finish: { kind: 'sparkles', at: 'hands', count: 2 },
  },
};

/** The verbs that are held (OldCity.startHold's kinds) and their acts. */
export const HOLD_ACTS: Record<string, ActId> = { salvage: 'rummage', pry: 'pry', gather: 'gather' };

/** The act for an Interact verb (the prompt's verb), or undefined for the ones with poses of their own. */
export function actForVerb(verb: string): ActId | undefined {
  return VERB_ACTS[verb];
}

export const VERB_ACTS: Record<string, ActId | undefined> = {
  Salvage: 'rummage',
  Pry: 'pry',
  Gather: 'gather',
  'Dig up': 'dig',
  Harvest: 'harvest',
  Tend: 'tend',
  Feed: 'tend',
  Repair: 'repair',
  Mend: 'repair',
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
};
