import { MOVES } from '../data/botMotion';
import { emptyPose, type ActPose } from './BotActs';

/**
 * E26 (#671): Bloombot's movement with more life, worked out each frame (pure, so tests can read it) and drawn over
 * the clips by BloombotVisuals, as the acts are:
 * - setting off it leans in; stopping, its upper body carries on forward, rocks back past upright and settles;
 * - walk and run blend by speed (the run clip's weight), the run leaning forward, arms trailing, leaves streaming;
 * - on a slope it leans into the climb and lifts its swinging foot; wading it steps slow and high, arms out;
 * - landing from a hover, climb or glide it crouches and hops back up; walking into a wall it recoils and stands;
 * - standing a while with no play input, now and then an idle moment: looking around, a stretch, shaking off dust.
 * Reduced motion keeps the walk and run blend, the leans and the careful wade, and drops the overshoot, the hop, the
 * recoil and the livelier idles (it only looks around).
 */
export interface MoveIn {
  /** speed now, cells a second */
  pace: number;
  /** how fast the speed changes, cells a second² (+ speeding up) */
  accel: number;
  /** the walking and running speeds (cells a second): the run blends in between them */
  walk: number;
  run: number;
  /** rise per cell along the way it moves (+ uphill), about -1 … 1 */
  climb: number;
  wading: boolean;
  /** seconds standing still with no play input (0 while there is) */
  still: number;
  reduced: boolean;
}

export type IdleKind = 'look' | 'stretch' | 'shake';

export interface MoveLook {
  /** the run clip's weight: 0 walking … 1 running */
  run: number;
  /** how much of a careful wade it is now (0 … 1): the walk clip slows by MOVES.wade.clipSpeed */
  wade: number;
  /** body channels (lean, knee, head, twist), drawn at full weight */
  body: ActPose;
  /** arm channels, drawn at `armW` (0 leaves the clip's arms as they are) */
  arms: ActPose;
  armW: number;
  /** the swinging foot's extra lift, degrees */
  swingLift: number;
  /** the leaves' trail back (degrees) */
  leaves: number;
  /** the whole model: up (a hop), back (a recoil, world units) and a roll toward its left (degrees) */
  up: number;
  back: number;
  roll: number;
  /** the idle moment under way, if any */
  idle?: IdleKind;
}

const ARM_CHANNELS = ['lRaise', 'lOut', 'lElbow', 'rRaise', 'rOut', 'rElbow'] as const;
const ORDER: readonly IdleKind[] = ['look', 'stretch', 'look', 'shake'];
const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
/** 0 → 1 → 0 over a moment: eased in over `inn` of it, out over the last `out` */
const bell = (k: number, inn: number, out: number) => (k <= 0 || k >= 1 ? 0 : Math.min(smooth(k / inn), smooth((1 - k) / out)));

export class BotMoves {
  /** the spine's lean (degrees, + forward) and how fast it moves, on its spring */
  lean = 0;
  private leanVel = 0;
  private wade = 0;
  private landT = -1;
  private landSize = 1;
  private bumpT = -1;
  private sinceBump = 99;
  private idleT = -1;
  private idleKind: IdleKind = 'look';
  private idleNext: number = MOVES.idle.after;
  private idleCount = 0;
  private idleFade = 0;
  private clock = 0;
  readonly look: MoveLook = { run: 0, wade: 0, body: emptyPose(), arms: emptyPose(), armW: 0, swingLift: 0, leaves: 0, up: 0, back: 0, roll: 0 };

  /** Landed from a hover, climb or glide (`size` 1), or stepped off a lift (smaller). */
  land(size = 1) {
    this.landT = 0;
    this.landSize = size;
  }

  /** Walked into a wall. False when it bumped a moment ago (holding into the wall doesn't keep bumping). */
  bump(): boolean {
    if (this.sinceBump < MOVES.bump.again) return false;
    this.bumpT = 0;
    this.sinceBump = 0;
    return true;
  }

  get bumping(): boolean {
    return this.bumpT >= 0;
  }

  update(dt: number, m: MoveIn): MoveLook {
    const o = this.look;
    const M = MOVES;
    this.clock += dt;
    this.sinceBump += dt;
    const body = o.body;
    const arms = o.arms;
    for (const k of Object.keys(body) as (keyof ActPose)[]) {
      body[k] = 0;
      arms[k] = 0;
    }
    // walk → run, by speed
    o.run = smooth((m.pace - m.walk) / Math.max(0.01, m.run - m.walk));
    this.wade += ((m.wading ? 1 : 0) - this.wade) * Math.min(1, dt * M.wade.ease);
    const wade = this.wade;
    o.wade = wade;

    // the lean: the run's and the slope's, plus leaning in to set off and carrying on forward when it stops
    const climb = Math.max(-1, Math.min(1, m.climb)) * Math.min(1, m.pace / 0.5);
    let goal = M.run.lean * o.run + (climb > 0 ? M.slope.up * climb : M.slope.down * climb);
    if (!m.reduced) {
      if (m.accel > 0.5 && m.pace > 0.05) goal += M.lean.setOff * Math.min(1, m.accel / 16);
      if (m.accel < -0.5) goal += M.lean.stop * Math.min(1, -m.accel / 14);
      const w = 2 * Math.PI * M.lean.hz;
      // a spring, stepped in small pieces so a long frame stays steady
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.leanVel += (w * w * (goal - this.lean) - 2 * M.lean.damping * w * this.leanVel) * h;
        this.lean += this.leanVel * h;
      }
    } else {
      this.leanVel = 0;
      this.lean += (goal - this.lean) * Math.min(1, dt * 6);
    }
    this.lean = Math.max(-M.lean.most, Math.min(M.lean.most, this.lean));
    body.lean = this.lean;

    // arms: trailing in the run, out for balance wading (mixed by how much of each)
    let aw = 0;
    const mix = (w: number, raise: number, out: number, elbow: number) => {
      if (w <= 0) return;
      arms.lRaise += raise * w;
      arms.rRaise += raise * w;
      arms.lOut += out * w;
      arms.rOut += out * w;
      arms.lElbow += elbow * w;
      arms.rElbow += elbow * w;
      aw += w;
    };
    mix(o.run * M.run.arms, -M.run.armsBack, 4, M.run.elbows);
    mix(wade * M.wade.arms * (1 - o.run), M.wade.armsUp, M.wade.armsOut, 10);

    o.swingLift = M.wade.lift * wade + M.slope.lift * Math.max(0, climb);
    o.leaves = (M.run.leaves + (m.reduced ? 0 : M.run.flutter * Math.sin(this.clock * Math.PI * 2 * M.run.flutterHz))) * o.run;
    o.up = 0;
    o.back = 0;
    o.roll = m.reduced ? 0 : Math.sin(this.clock * Math.PI * 2 * 0.9) * M.wade.sway * wade * Math.min(1, m.pace);

    // landing: a crouch, then a little hop back up
    if (this.landT >= 0) {
      this.landT += dt;
      const k = this.landT / M.land.dur;
      if (k >= 1) this.landT = -1;
      else {
        const crouch = k < 0.25 ? smooth(k / 0.25) : 1 - smooth((k - 0.25) / 0.4);
        body.knee += M.land.knee * this.landSize * crouch * (m.reduced ? 0.5 : 1);
        if (!m.reduced && k > 0.35 && k < 0.8) o.up += Math.sin((Math.PI * (k - 0.35)) / 0.45) * M.land.hop * this.landSize;
      }
    }
    // a bump: back a little and a lean back, the head up
    if (this.bumpT >= 0) {
      this.bumpT += dt;
      const k = this.bumpT / M.bump.dur;
      if (k >= 1) this.bumpT = -1;
      else if (!m.reduced) {
        const e = k < 0.2 ? smooth(k / 0.2) : 1 - smooth((k - 0.2) / 0.8);
        o.back += M.bump.back * e;
        body.lean += M.bump.lean * e;
        body.headPitch += M.bump.look * e;
      }
    }

    // idle moments, only after standing a while with no play input; any input ends one at once (a quick fade)
    if (m.still <= 0 || m.pace > 0.05) {
      if (this.idleT >= 0) this.idleFade = Math.max(0, this.idleFade - dt / M.idle.fade);
      if (this.idleFade <= 0) this.idleT = -1;
      this.idleNext = M.idle.after;
      if (m.still <= 0) this.idleCount = 0;
    } else if (this.idleT < 0 && m.still >= this.idleNext) {
      this.idleKind = m.reduced ? 'look' : ORDER[this.idleCount % ORDER.length];
      this.idleCount++;
      this.idleT = 0;
      this.idleFade = 1;
    }
    o.armW = Math.min(1, aw);
    if (aw > 1e-6) for (const c of ARM_CHANNELS) arms[c] /= aw;
    o.idle = undefined;
    if (this.idleT >= 0) {
      this.idleT += m.still > 0 && m.pace <= 0.05 ? dt : 0;
      const kind = this.idleKind;
      const d = M[kind].dur;
      const k = this.idleT / d;
      if (k >= 1 && this.idleFade > 0 && m.still > 0) {
        this.idleT = -1;
        this.idleNext = m.still + M.idle.every;
      } else {
        o.idle = kind;
        this.drawIdle(kind, Math.min(1, k), this.idleT, this.idleFade, m.reduced);
      }
    }
    return o;
  }

  /** An idle moment `k` (0 … 1) of the way through, `t` seconds in, faded by `fade`. */
  private drawIdle(kind: IdleKind, k: number, t: number, fade: number, reduced: boolean) {
    const o = this.look;
    const body = o.body;
    const M = MOVES;
    if (kind === 'look') {
      // a look one way, then the other, then back
      const e = bell(k, 0.15, 0.2) * fade;
      body.headYaw += M.look.yaw * Math.sin(k * Math.PI * 2) * e;
      body.twist += M.look.yaw * 0.25 * Math.sin(k * Math.PI * 2) * e;
      body.headPitch += -M.look.pitch * Math.sin(k * Math.PI) * e;
      return;
    }
    if (kind === 'stretch') {
      const e = bell(k, 0.3, 0.3) * fade;
      body.lean += M.stretch.lean * e;
      body.headPitch += M.stretch.head * e;
      this.armsTo(M.stretch.raise, M.stretch.out, M.stretch.elbow, e);
      return;
    }
    if (reduced) return;
    // shaking off dust: a quick wiggle side to side that dies away, the head and arms loose with it
    const e = bell(k, 0.1, 0.45) * fade;
    const s = Math.sin(t * Math.PI * 2 * M.shake.hz);
    o.roll += M.shake.roll * s * e;
    body.headRoll += M.shake.head * s * e;
    body.twist += M.shake.roll * 0.8 * Math.sin(t * Math.PI * 2 * M.shake.hz + 1) * e;
    this.armsTo(0, M.shake.arms * (1 + 0.5 * s), 20, e * 0.6);
  }

  /** Blends the arms `w` of the way to a pose (from whatever held them, or from the clip's own). */
  private armsTo(raise: number, out: number, elbow: number, w: number) {
    const o = this.look;
    const a = o.arms;
    if (w <= 0) return;
    const was = o.armW;
    const k = was > 0 ? w : 1;
    a.lRaise += (raise - a.lRaise) * k;
    a.rRaise += (raise - a.rRaise) * k;
    a.lOut += (out - a.lOut) * k;
    a.rOut += (out - a.rOut) * k;
    a.lElbow += (elbow - a.lElbow) * k;
    a.rElbow += (elbow - a.rElbow) * k;
    o.armW = Math.max(was, w);
  }
}
