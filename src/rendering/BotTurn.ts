import type * as pc from 'playcanvas';
import { TURN_LOOK } from '../data/botMotion';
import { boneOf, turnBone } from './BotActs';

/**
 * E26 (#670): how a turn looks, worked out each frame (pure, so tests can read it) and drawn over the clip like the
 * acts. The head turns toward the new way first and the upper body follows a little; turning on the spot, the feet
 * take little steps, one lifting as the other sets down; moving through a curve, it leans in. Reduced motion keeps
 * the head leading (it says where Bloombot is going) and drops the steps' lift and the lean.
 */
export interface TurnLook {
  /** degrees, + toward its left */
  headYaw: number;
  twist: number;
  /** each foot's lift, degrees */
  stepL: number;
  stepR: number;
  /** degrees, + leans toward its left */
  lean: number;
}

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

/**
 * `left`: how far it still has to turn (radians, + toward its left); `vel`: how fast it turns (radians a second);
 * `speed`: how fast it moves (cells a second); `phase`: the steps' running phase (radians, see `stepPhase`).
 */
export function turnLook(left: number, vel: number, speed: number, phase: number, reduced: boolean, out: TurnLook = { headYaw: 0, twist: 0, stepL: 0, stepR: 0, lean: 0 }): TurnLook {
  const L = TURN_LOOK;
  const deg = (left * 180) / Math.PI;
  out.headYaw = Math.max(-L.headLead, Math.min(L.headLead, deg));
  out.twist = out.headYaw * L.twist;
  // stepping: turning fast enough while (nearly) standing
  const w = reduced ? 0 : smooth((Math.abs(vel) - L.stepFrom * 0.5) / (L.stepFrom * 0.5)) * (1 - smooth(speed / L.stillBelow));
  const s = Math.sin(phase);
  out.stepL = Math.max(0, s) * L.lift * w;
  out.stepR = Math.max(0, -s) * L.lift * w;
  out.lean = reduced ? 0 : Math.max(-L.leanMost, Math.min(L.leanMost, vel * speed * L.lean));
  return out;
}

/** The steps' phase after turning `turned` radians more: half a cycle per step, so each foot steps in turn. */
export function stepPhase(phase: number, turned: number): number {
  return (phase + (Math.abs(turned) / TURN_LOOK.stepEvery) * Math.PI) % (Math.PI * 2);
}

/**
 * Draws the look on the rig, over the clip, after any act (and not while seated). `facer` is turned the way
 * Bloombot faces (its own left is the facer's +x); the lean is the caller's (it tips the model's holder).
 */
export function applyTurnLook(rig: pc.GraphNode, facer: pc.GraphNode, t: TurnLook, axes: { right: pc.Vec3; up: pc.Vec3 }) {
  axes.right.copy(facer.right);
  axes.up.copy(facer.up);
  const head = boneOf(rig, 'Head');
  if (!head) return;
  // the head leads by most of it; the spine takes the twist, shared down its joints
  turnBone(head, axes.up, t.headYaw - t.twist);
  for (const n of ['Spine', 'Spine01', 'Spine02']) turnBone(boneOf(rig, n), axes.up, t.twist / 3);
  // a step: the thigh comes up, the shin back, the foot level
  for (const [side, lift] of [
    ['Left', t.stepL],
    ['Right', t.stepR],
  ] as const) {
    if (lift <= 0) continue;
    turnBone(boneOf(rig, `${side}UpLeg`), axes.right, -lift);
    turnBone(boneOf(rig, `${side}Leg`), axes.right, lift * 1.6);
    turnBone(boneOf(rig, `${side}Foot`), axes.right, -lift * 0.6);
  }
}
