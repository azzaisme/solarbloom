import * as pc from 'playcanvas';
import { PROPS, type PropColour, type PropId } from '../data/botProps';
import { mat, PALETTE } from './Materials';

/**
 * #628: a prop Bloombot holds while it acts (src/data/botProps.ts), built from primitives in the shared cached
 * materials, and kept in its fist every frame: the grip frame runs along the forearm, so it turns with the arm.
 */
function colourMat(c: PropColour): pc.StandardMaterial {
  if (c === 'glow') return mat(PALETTE.botProps.glow, { unlit: true, emissiveIntensity: 1.4 });
  const hex = PALETTE.botProps[c];
  return mat(hex, { gloss: c === 'metal' || c === 'metalDark' || c === 'brass' ? 0.6 : 0.3, metal: c === 'metal' || c === 'metalDark' || c === 'brass' ? 0.5 : 0 });
}

export class BotProp {
  readonly root: pc.Entity;
  private readonly inner: pc.Entity;
  private readonly tipLocal: pc.Vec3;

  constructor(
    readonly id: PropId,
    parent: pc.Entity,
  ) {
    const d = PROPS[id];
    this.root = new pc.Entity(`prop-${id}`);
    this.inner = new pc.Entity('grip');
    this.root.addChild(this.inner);
    if (d.turn) this.inner.setLocalEulerAngles(d.turn[0], d.turn[1], d.turn[2]);
    for (const p of d.pieces) {
      const e = new pc.Entity(p.shape);
      e.addComponent('render', { type: p.shape, material: colourMat(p.colour), castShadows: true, receiveShadows: false });
      e.setLocalPosition(p.at[0], p.at[1], p.at[2]);
      e.setLocalScale(p.size[0], p.size[1], p.size[2]);
      if (p.euler) e.setLocalEulerAngles(p.euler[0], p.euler[1], p.euler[2]);
      this.inner.addChild(e);
    }
    this.tipLocal = new pc.Vec3(d.tip[0], d.tip[1], d.tip[2]);
    parent.addChild(this.root);
  }

  private static readonly Y = new pc.Vec3();
  private static readonly Z = new pc.Vec3();
  private static readonly X = new pc.Vec3();
  private static readonly M = new pc.Mat4();
  private static readonly Q = new pc.Quat();

  /**
   * Puts it in the fist: at `hand`, its grip frame along the line from `fore` (the forearm joint) to the hand, its +z
   * as near to `up` as that allows.
   */
  place(fore: pc.Vec3, hand: pc.Vec3, up: pc.Vec3) {
    const { Y, Z, X, M, Q } = BotProp;
    Y.copy(hand).sub(fore);
    if (Y.lengthSq() < 1e-10) return;
    Y.normalize();
    Z.copy(up).sub(X.copy(Y).mulScalar(up.dot(Y)));
    if (Z.lengthSq() < 1e-6) Z.set(0, 0, 1).sub(X.copy(Y).mulScalar(Y.z));
    Z.normalize();
    X.cross(Y, Z);
    const d = M.data;
    d[0] = X.x; d[1] = X.y; d[2] = X.z; d[3] = 0;
    d[4] = Y.x; d[5] = Y.y; d[6] = Y.z; d[7] = 0;
    d[8] = Z.x; d[9] = Z.y; d[10] = Z.z; d[11] = 0;
    d[12] = 0; d[13] = 0; d[14] = 0; d[15] = 1;
    Q.setFromMat4(M);
    this.root.setPosition(hand);
    this.root.setRotation(Q);
  }

  /** Its working end, in the world (where its effects come from). */
  tip(out: pc.Vec3): pc.Vec3 {
    return this.inner.getWorldTransform().transformPoint(this.tipLocal, out);
  }

  /** Shrinks it in and out as the act eases (0 … 1). */
  grow(k: number) {
    const s = Math.max(0.001, k);
    this.root.setLocalScale(s, s, s);
  }

  destroy() {
    this.root.destroy();
  }
}
