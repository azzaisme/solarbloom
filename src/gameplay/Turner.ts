import { TURN } from '../data/botMotion';

/** An angle in (-π, π]. */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * E26 (#670): Bloombot's one turner. Everything that wants Bloombot to face somewhere asks it (`face`, `faceTo`); only
 * it changes the pose's facing, a little each frame: speeding up to a top rate and slowing down as it gets there, so
 * no turn is ever a snap. Its speed is planned to stop exactly on the goal (it brakes in time).
 *
 * A facing set from outside (a save loaded, a test placing Bloombot) is taken as it is: the turner adopts it and
 * stops turning.
 */
export class Turner {
  /** where it wants to face */
  goal: number;
  /** how fast it turns now, radians a second (+ turns toward its left) */
  vel = 0;
  private last: number;

  constructor(
    private pose: { facing: number },
    private rate: number = TURN.rate,
    private accel: number = TURN.accel,
  ) {
    this.goal = pose.facing;
    this.last = pose.facing;
  }

  /** Turn to face an angle (radians, 0 = +z). */
  face(angle: number) {
    this.adopt();
    this.goal = wrapAngle(angle);
  }

  /** Turn to face the point (x, z) from (fromX, fromZ). */
  faceTo(fromX: number, fromZ: number, x: number, z: number) {
    if (Math.abs(x - fromX) < 1e-6 && Math.abs(z - fromZ) < 1e-6) return;
    this.face(Math.atan2(x - fromX, z - fromZ));
  }

  /** How far it still has to turn, signed (radians). */
  get left(): number {
    this.adopt();
    return wrapAngle(this.goal - this.pose.facing);
  }

  get turning(): boolean {
    return Math.abs(this.left) > 1e-3 || Math.abs(this.vel) > 1e-3;
  }

  /** A facing set from outside: keep it. */
  private adopt() {
    if (this.pose.facing === this.last) return;
    this.goal = wrapAngle(this.pose.facing);
    this.vel = 0;
    this.last = this.pose.facing;
  }

  update(dt: number) {
    this.adopt();
    if (dt <= 0) return;
    const d = wrapAngle(this.goal - this.pose.facing);
    // the speed that still stops on the goal: v² = 2·a·d
    const want = Math.sign(d) * Math.min(this.rate, Math.sqrt(2 * this.accel * Math.abs(d)));
    const dv = want - this.vel;
    this.vel += Math.sign(dv) * Math.min(Math.abs(dv), this.accel * dt);
    let step = this.vel * dt;
    if ((Math.abs(d) < 1e-4 && Math.abs(this.vel) < 0.05) || (Math.sign(step) === Math.sign(d) && Math.abs(step) >= Math.abs(d))) {
      step = d;
      this.vel = 0;
    }
    this.pose.facing = wrapAngle(this.pose.facing + step);
    this.last = this.pose.facing;
  }
}

/**
 * E26 (#670): how fast Bloombot moves while it turns. A change of direction bigger than `pivotAt` stops it (braking,
 * never sliding backwards) to pivot on the spot until it faces within `setOff` of the new way; between those it slows;
 * small corrections keep its speed. Speed changes at `speedUp` and `brake`, so it never jumps.
 */
export class Stride {
  /** its speed now, cells a second */
  pace = 0;
  /** stopped (or stopping) to pivot before setting off */
  pivoting = false;

  /** The speed for this frame, given the speed it wants and how far its facing is off the way it wants to go. */
  step(dt: number, want: number, off: number): number {
    const a = Math.abs(off);
    if (want <= 0) this.pivoting = false;
    else if (a > TURN.pivotAt) this.pivoting = true;
    else if (a <= TURN.setOff) this.pivoting = false;
    const k = this.pivoting ? 0 : a <= TURN.setOff ? 1 : 1 - (1 - TURN.turnSlow) * smooth((a - TURN.setOff) / (TURN.pivotAt - TURN.setOff));
    const target = Math.max(0, want * k);
    if (target > this.pace) this.pace = Math.min(target, this.pace + TURN.speedUp * dt);
    else this.pace = Math.max(target, this.pace - TURN.brake * dt);
    return this.pace;
  }

  stop() {
    this.pace = 0;
    this.pivoting = false;
  }
}

function smooth(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
}
