// E26 (#670): how Bloombot turns. One turner (gameplay/Turner) eases its facing toward where it wants to face, at a
// capped rate, and the controller slows or stops it to pivot before a big change of direction. BotTurn (rendering)
// draws the turn: the head leading, little steps on the spot, a lean into curves.

const DEG = Math.PI / 180;

export const TURN = {
  /** top turning speed, radians a second (about 570°/s) */
  rate: 10,
  /** how fast the turn speeds up and slows down, radians a second² (it eases in and out at this) */
  accel: 48,
  /**
   * Picked for #670: an about-turn from standing takes about half a second, a 90° turn about a third, a 30°
   * correction about a fifth. Slower than that and keys and the pad feel heavy; faster and it reads as a snap.
   */
  /** a change of direction bigger than this stops Bloombot to pivot on the spot first */
  pivotAt: 90 * DEG,
  /** once pivoting, it sets off again when it faces within this of the new way */
  setOff: 30 * DEG,
  /** steering, Bloombot moves at most this far off the way it faces (no sliding sideways while it turns) */
  slide: 25 * DEG,
  /** between `setOff` and `pivotAt` off the new way it slows to this share of its speed */
  turnSlow: 0.45,
  /** speeding up and braking, cells a second² (a run stops in under a cell) */
  speedUp: 16,
  brake: 14,
  /** arriving somewhere to act: it turns to face the thing first, then acts (or acts anyway after this long) */
  faceFirst: { within: 15 * DEG, wait: 0.7 },
} as const;

/** How the turn is drawn (degrees, unless it says otherwise). */
export const TURN_LOOK = {
  /** the head turns toward the new way first, up to this far, and the upper body follows by `twist` of that */
  headLead: 35,
  twist: 0.35,
  /** stepping on the spot: one step per this much turned (radians), each foot lifted up to `lift` degrees */
  stepEvery: 40 * DEG,
  lift: 16,
  /** stepping shows from this turning speed (radians a second) while it moves slower than `stillBelow` (cells/s) */
  stepFrom: 1.2,
  stillBelow: 0.6,
  /** leaning into a curve: `lean` degrees per (radian a second × cell a second), never more than `leanMost` */
  lean: 0.55,
  leanMost: 9,
  /** how fast the lean follows (per second, exponential): it settles rather than flicks */
  leanEase: 8,
} as const;
