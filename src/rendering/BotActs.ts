import * as pc from 'playcanvas';
import { ACTS, type ActChannel, type ActId } from '../data/botActs';

/**
 * #628: Bloombot's acts (src/data/botActs.ts) as poses: `actPose` works out each channel's value at a moment (pure, so
 * tests can read it), and `applyActPose` turns the rig's bones by it, every frame after the animation has run (as
 * SeatPose bends the legs), so an act is drawn over whatever clip plays underneath.
 */
export type ActPose = Record<ActChannel, number>;

const CHANNELS: readonly ActChannel[] = ['lean', 'twist', 'knee', 'headPitch', 'headYaw', 'headRoll', 'lRaise', 'lOut', 'lElbow', 'rRaise', 'rOut', 'rElbow'];

export function emptyPose(): ActPose {
  return Object.fromEntries(CHANNELS.map((c) => [c, 0])) as ActPose;
}

/**
 * The pose `t` seconds into an act, scaled by `weight` (0 … 1, the ease in and out). Reduced motion keeps the base
 * pose and drops the swings.
 */
export function actPose(act: ActId, t: number, weight: number, reducedMotion: boolean, out: ActPose = emptyPose()): ActPose {
  const d = ACTS[act];
  const s = ((t / d.period) % 1) * Math.PI * 2;
  for (const c of CHANNELS) {
    const w = d.channels[c];
    if (!w) {
      out[c] = 0;
      continue;
    }
    const [base, amp = 0, h = 1, ph = 0] = w;
    out[c] = (base + (reducedMotion ? 0 : amp * Math.sin(h * s + ph))) * weight;
  }
  return out;
}

const RIGHT = new pc.Vec3();
const FWD = new pc.Vec3();
const UP = new pc.Vec3();
const SIDE = new pc.Vec3();
const DIR = new pc.Vec3();
const ARM = new pc.Vec3();
const BEND = new pc.Vec3();
const NOW = new pc.Vec3();
const Q = new pc.Quat();
const R = new pc.Quat();
const PART = new pc.Quat();
const bones = new WeakMap<pc.GraphNode, Map<string, pc.GraphNode | null>>();

function bone(rig: pc.GraphNode, name: string): pc.GraphNode | null {
  let m = bones.get(rig);
  if (!m) bones.set(rig, (m = new Map()));
  if (!m.has(name)) m.set(name, rig.findByName(name));
  return m.get(name)!;
}

/** Turns a bone by `deg` about a world axis (its children follow). */
function turn(b: pc.GraphNode | null, axis: pc.Vec3, deg: number) {
  if (!b || !deg) return;
  Q.setFromAxisAngle(axis, deg);
  b.setRotation(R.copy(Q).mul(b.getRotation()));
}

/**
 * Turns `node` so the line from it to `tip` points `weight` of the way from where the clip has it to `dir` (world),
 * which works whatever way the rig's own axes face (as SeatPose bends the legs).
 */
function aim(node: pc.GraphNode | null, tip: pc.GraphNode | null, dir: pc.Vec3, weight: number) {
  if (!node || !tip || weight <= 0) return;
  const from = NOW.copy(tip.getPosition()).sub(node.getPosition());
  if (from.lengthSq() < 1e-12) return;
  from.normalize();
  Q.setFromDirections(from, dir);
  const turnBy = weight < 1 ? PART.slerp(pc.Quat.IDENTITY, Q, weight) : Q;
  node.setRotation(R.copy(turnBy).mul(node.getRotation()));
}

/**
 * Draws a pose (from `actPose` at weight 1) on the rig, `weight` of the way from the clip underneath. `facer` is
 * turned the way Bloombot faces (its front is the facer's local +z, so its own left is the facer's +x). Turning
 * about +x by a positive angle tips anything pointing up toward the front. The arms are aimed: each upper arm
 * points down, raised `raise` degrees toward the front and `out` degrees out to its side; each forearm bends
 * `elbow` degrees from it, toward the front while the arm hangs and upward as it rises. The knees bend in place:
 * the caller sinks the model so its feet stay down (BloombotVisuals). False when the rig has no hips.
 */
export function applyActPose(rig: pc.GraphNode, facer: pc.GraphNode, p: ActPose, weight = 1): boolean {
  if (!bone(rig, 'Hips') || weight <= 0) return false;
  const w = weight;
  RIGHT.copy(facer.right); // +x: Bloombot's left
  FWD.copy(facer.forward).mulScalar(-1); // +z: its front
  UP.copy(facer.up);
  // the spine: lean and twist, shared down its three joints
  for (const n of ['Spine', 'Spine01', 'Spine02']) {
    turn(bone(rig, n), UP, (p.twist * w) / 3);
    turn(bone(rig, n), RIGHT, (p.lean * w) / 3);
  }
  // the knees: the thighs come forward, the shins back, the feet level again
  if (p.knee) {
    for (const side of ['Left', 'Right']) {
      turn(bone(rig, `${side}UpLeg`), RIGHT, -p.knee * w);
      turn(bone(rig, `${side}Leg`), RIGHT, p.knee * 2 * w);
      turn(bone(rig, `${side}Foot`), RIGHT, -p.knee * w);
    }
  }
  const head = bone(rig, 'Head');
  turn(head, UP, p.headYaw * w);
  turn(head, RIGHT, p.headPitch * w);
  turn(head, FWD, -p.headRoll * w);
  for (const [side, raise, outward, elbow, sign] of [
    ['Left', p.lRaise, p.lOut, p.lElbow, 1],
    ['Right', p.rRaise, p.rOut, p.rElbow, -1],
  ] as const) {
    // an arm the act leaves alone keeps the clip's
    if (!raise && !outward && !elbow) continue;
    const r = (raise * Math.PI) / 180;
    const o = (outward * Math.PI) / 180;
    SIDE.copy(RIGHT).mulScalar(sign);
    ARM.copy(FWD).mulScalar(Math.sin(r) * Math.cos(o)).add(DIR.copy(UP).mulScalar(-Math.cos(r) * Math.cos(o))).add(NOW.copy(SIDE).mulScalar(Math.sin(o))).normalize();
    const arm = bone(rig, `${side}Arm`);
    const fore = bone(rig, `${side}ForeArm`);
    const hand = bone(rig, `${side}Hand`);
    aim(arm, fore, ARM, w);
    // the elbow bends toward the front while the arm hangs, toward up as it is raised
    BEND.copy(FWD).mulScalar(Math.cos(r)).add(DIR.copy(UP).mulScalar(Math.sin(r)));
    BEND.sub(DIR.copy(ARM).mulScalar(BEND.dot(ARM)));
    if (BEND.lengthSq() < 1e-6) BEND.copy(UP);
    BEND.normalize();
    const e = (elbow * Math.PI) / 180;
    DIR.copy(ARM).mulScalar(Math.cos(e)).add(BEND.mulScalar(Math.sin(e))).normalize();
    aim(fore, hand, DIR, w);
  }
  return true;
}

/** E26 (#670): the rig's bone by name (cached), and a bone turned about a world axis, for BotTurn. */
export const boneOf = bone;
export const turnBone = turn;
