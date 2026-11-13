import * as pc from 'playcanvas';
import type { CatAnchor } from '../data/rooftops';
import type { Sim } from '../gameplay/Sim';
import { mat, PALETTE } from './Materials';
import { group, shape } from './Shapes';
import { ease, type Tweens } from './Tween';

/** The Hidden Lucky Cat: a tiny white ceramic maneki-neko. */
export class CatVisuals {
  root?: pc.Entity;
  private paw?: pc.Entity;
  private head?: pc.Entity;
  private time = 0;
  private anchorId?: string;
  reducedMotion = false;
  /** Accessibility: softer, smaller sparkles. */
  softSparkle = false;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private tweens: Tweens,
  ) {}

  anchorWorld(a: CatAnchor): pc.Vec3 {
    const r = this.sim.grid.roof(a.roofId)!;
    return new pc.Vec3(r.origin[0] + a.pos[0], r.origin[1] + r.height + a.pos[1], r.origin[2] + a.pos[2]);
  }

  /** Click target centre (a little above the feet). */
  targetWorld(): pc.Vec3 | undefined {
    if (!this.root) return undefined;
    const p = this.root.getPosition().clone();
    p.y += 0.14;
    return p;
  }

  show(anchorId: string, animate: boolean) {
    this.hide(false);
    const a = this.sim.cat.anchor(anchorId);
    if (!a) return;
    this.anchorId = anchorId;
    const p = this.anchorWorld(a);
    const root = group(this.parent, 'luckyCat', [p.x, p.y, p.z]);
    root.setEulerAngles(0, a.rotY, 0);
    const white = mat(PALETTE.cat, { gloss: 0.9 });
    const body = group(root, 'b');
    body.setLocalScale(0.85, 0.85, 0.85);
    shape(body, 'sphere', white, { pos: [0, 0.09, 0], scale: [0.17, 0.18, 0.14], shadow: true });
    const head = group(body, 'head', [0, 0.23, 0.01]);
    shape(head, 'sphere', white, { scale: [0.17, 0.14, 0.14], shadow: true });
    for (const s of [-1, 1]) {
      shape(head, 'cone', white, { pos: [s * 0.05, 0.08, 0], scale: [0.05, 0.06, 0.04], rot: [0, 0, -s * 15] });
      shape(head, 'cone', mat(PALETTE.pink), { pos: [s * 0.05, 0.08, 0.008], scale: [0.025, 0.035, 0.02], rot: [0, 0, -s * 15] });
      shape(head, 'sphere', mat('#2b2b33'), { pos: [s * 0.035, 0.01, 0.065], scale: [0.018, 0.012, 0.01] });
    }
    shape(head, 'sphere', mat(PALETTE.pink), { pos: [0, -0.015, 0.07], scale: [0.015, 0.01, 0.01] });
    shape(body, 'cylinder', mat(PALETTE.catRed), { pos: [0, 0.17, 0], scale: [0.13, 0.02, 0.11] });
    shape(body, 'sphere', mat(PALETTE.gold, { metal: 0.8, gloss: 0.9, emissive: '#a07a20', emissiveIntensity: 0.3 }), { pos: [0, 0.155, 0.06], scale: 0.035 });
    shape(body, 'sphere', mat(PALETTE.gold, { metal: 0.8, gloss: 0.9 }), { pos: [-0.04, 0.08, 0.07], scale: [0.06, 0.07, 0.02] }); // koban coin
    const paw = group(body, 'paw', [0.07, 0.17, 0.02]);
    shape(paw, 'capsule', white, { pos: [0, 0.05, 0], scale: [0.045, 0.06, 0.045] });
    this.paw = paw;
    this.head = head;
    shape(body, 'capsule', white, { pos: [-0.06, 0.03, -0.08], scale: [0.03, 0.06, 0.03], rot: [60, 0, 20] }); // tail
    this.root = root;
    if (animate) {
      root.setLocalScale(0.01, 0.01, 0.01);
      this.tweens.add(0.5, (k) => root.setLocalScale(k, k, k), { ease: ease.outBack });
    }
  }

  hide(celebrate: boolean) {
    const root = this.root;
    if (!root) return;
    this.root = undefined;
    this.anchorId = undefined;
    if (!celebrate) {
      root.destroy();
      return;
    }
    const p0 = root.getPosition().clone();
    this.tweens.add(0.7, (k) => {
      root.setPosition(p0.x, p0.y + Math.sin(k * Math.PI) * 0.6, p0.z);
      root.setEulerAngles(0, k * 720, 0);
      const s = k < 0.7 ? 1 + k * 0.6 : (1 - k) * 4.2;
      root.setLocalScale(s, s, s);
    }, { ease: ease.linear, done: () => root.destroy() });
  }

  currentAnchor() {
    return this.anchorId;
  }

  update(dt: number) {
    this.time += dt;
    if (!this.paw || !this.root) return;
    const t = this.time;
    // Wave in short bursts — a hint, not a beacon.
    const phase = t % 4;
    const waving = phase < 1.2 && !this.reducedMotion;
    this.paw.setLocalEulerAngles(waving ? -20 + Math.sin(phase * 14) * 35 : -10, 0, 0);
    if (this.head && !this.reducedMotion) this.head.setLocalEulerAngles(0, 0, Math.sin(t * 1.3) * 6);
  }
}
