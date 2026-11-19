import * as pc from 'playcanvas';

/**
 * E23.2.3: seated poses bent by hand on the shared character rig (bloombot's and the Keepers': Hips, LeftUpLeg,
 * LeftLeg, LeftFoot, LeftToeBase and the right side's), for models without sitting clips. Run every frame after
 * the animation has played (the anim system writes the bones first). Each bone is turned in world space so the
 * line to its child points a chosen way, which works whatever way the rig's own axes face.
 */
export type SeatKind = 'sit' | 'meditate';

const A = new pc.Vec3();
const B = new pc.Vec3();
const C = new pc.Vec3();
const D = new pc.Vec3();
const E = new pc.Vec3();
const F = new pc.Vec3();
const O = new pc.Vec3();
const S = new pc.Vec3();
const Q = new pc.Quat();
const R = new pc.Quat();

/** Turns `node` (in world space) so the line from it to `tip` points along `dir`. */
function aim(node: pc.GraphNode | null, tip: pc.GraphNode | null, dir: pc.Vec3) {
  if (!node || !tip) return;
  const from = A.copy(tip.getPosition()).sub(node.getPosition());
  if (from.lengthSq() < 1e-12) return;
  from.normalize();
  Q.setFromDirections(from, B.copy(dir).normalize());
  node.setRotation(R.copy(Q).mul(node.getRotation()));
}

/** A rig's bones by name, found once per rig. */
const cache = new WeakMap<pc.GraphNode, Map<string, pc.GraphNode | null>>();
function bone(rig: pc.GraphNode, name: string): pc.GraphNode | null {
  let m = cache.get(rig);
  if (!m) cache.set(rig, (m = new Map()));
  if (!m.has(name)) m.set(name, rig.findByName(name));
  return m.get(name)!;
}

/**
 * Bends the legs of `rig` into a seated pose. `facer`: the entity whose +z is the way the character faces.
 * 'sit': thighs forward along a seat, shins hanging, feet forward. 'meditate': thighs out to the sides, shins
 * crossed in front. False when the rig has no hips (nothing to bend).
 */
export function foldLegs(rig: pc.GraphNode, facer: pc.GraphNode, kind: SeatKind): boolean {
  if (!bone(rig, 'Hips')) return false;
  const fwd = F.copy(facer.forward).mulScalar(-1); // an entity's forward is -z; the characters face +z
  const right = S.copy(facer.right);
  const down = pc.Vec3.DOWN;
  for (const side of ['Left', 'Right'] as const) {
    const out = O.copy(right).mulScalar(side === 'Right' ? 1 : -1);
    const thigh = bone(rig, `${side}UpLeg`);
    const shin = bone(rig, `${side}Leg`);
    const foot = bone(rig, `${side}Foot`);
    const toe = bone(rig, `${side}ToeBase`);
    if (kind === 'sit') {
      aim(thigh, shin, D.copy(fwd).add(E.copy(down).mulScalar(0.12)).add(C.copy(out).mulScalar(0.08)));
      aim(shin, foot, D.copy(down).add(E.copy(fwd).mulScalar(0.2)));
      aim(foot, toe, D.copy(fwd).add(E.copy(down).mulScalar(0.3)));
    } else {
      aim(thigh, shin, D.copy(fwd).mulScalar(0.75).add(E.copy(out).mulScalar(0.65)).add(C.copy(down).mulScalar(0.12)));
      aim(shin, foot, D.copy(out).mulScalar(-1).add(E.copy(fwd).mulScalar(0.3)).add(C.copy(down).mulScalar(0.05)));
      aim(foot, toe, D.copy(fwd).add(E.copy(out).mulScalar(-0.6)));
    }
  }
  return true;
}

/** How high the rig's hips joint is above `base` (world units): lower the model by this to sit it down. */
export function hipsAbove(rig: pc.GraphNode, base: pc.GraphNode): number {
  const h = bone(rig, 'Hips');
  return h ? h.getPosition().y - base.getPosition().y : 0;
}

/** The hips joint's height above the seat (or the ground) once seated, world units. */
export const SEAT_HIPS = { sit: 0.06, meditate: 0.08 } as const;
