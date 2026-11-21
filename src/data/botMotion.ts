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

/**
 * E26 (#671): Bloombot's movement drawn with more life (rendering/BotMoves), all over the clips on the rig. Degrees,
 * seconds and cells unless it says otherwise.
 */
export const MOVES = {
  /**
   * The upper body's lean forward, on a spring: it leans in to set off and, stopping, carries on forward a moment
   * and rocks back past upright before it settles (`hz` how quick, `damping` under 1 so it overshoots a little).
   */
  lean: { hz: 2.2, damping: 0.42, setOff: 7, stop: 11, most: 16 },
  /** the run: a forward lean, the arms trailing back with the elbows bent, the leaves streaming back */
  run: { lean: 9, armsBack: 38, elbows: 55, arms: 0.75, leaves: 28, flutter: 5, flutterHz: 9, clipSpeed: 1.25 },
  /** on a slope: leaning into the climb (per rise of one cell a cell), back a little going down; the swinging foot lifts */
  slope: { up: 14, down: 8, lift: 18 },
  /** wading: slower, careful steps lifted high, the arms out for balance, a little sway */
  wade: { clipSpeed: 0.7, lift: 22, armsOut: 38, armsUp: 12, arms: 0.8, sway: 3, ease: 4 },
  /** landing from a hover, climb or glide (and stepping off a lift, smaller): a crouch and a little hop back up */
  land: { dur: 0.55, knee: 26, hop: 0.06 },
  /** walking into a wall: a small recoil back and a lean back, then it stands rather than running in place */
  bump: { dur: 0.42, back: 0.07, lean: -9, look: -10, again: 0.9 },
  /** idle moments: the first after `after` seconds standing with no play input, then one every `every` seconds */
  idle: { after: 6, every: 6.5, fade: 0.15 },
  look: { dur: 2.8, yaw: 42, pitch: 6 },
  stretch: { dur: 2.4, raise: 170, out: 30, elbow: 8, lean: -10, head: -16 },
  shake: { dur: 1.5, roll: 6, hz: 8, head: 9, arms: 20 },
} as const;
