import * as pc from 'playcanvas';
import { group, shape } from './Shapes';
import { mat, PALETTE } from './Materials';

interface Bird {
  root: pc.Entity;
  wings: pc.Entity[];
  offset: pc.Vec3;
  phase: number;
}

/**
 * Phase 4 E09.4: now and then a small flock of birds crosses the view, once life is coming back (the park at half
 * restored or more). Pooled (made once), no per-frame allocation, and off with reduced motion.
 */
export class Birds {
  private flock: Bird[] = [];
  private root: pc.Entity;
  private wait = 12;
  private t = 0;
  private flying = false;
  private from = new pc.Vec3();
  private dir = new pc.Vec3();
  private pos = new pc.Vec3();
  reducedMotion = false;
  /** Phase 5 E16: songbirds have arrived (20 thriving tree tiles): flocks pass more often. */
  resident = false;

  constructor(parent: pc.Entity) {
    this.root = group(parent, 'birds');
    this.root.enabled = false;
    for (let i = 0; i < 5; i++) {
      const b = group(this.root, 'bird');
      shape(b, 'sphere', mat(PALETTE.fauna.gull), { scale: [0.16, 0.1, 0.24] });
      shape(b, 'sphere', mat(PALETTE.fauna.gullBeak), { pos: [0, 0, 0.13], scale: [0.05, 0.04, 0.06] });
      const wings = [-1, 1].map((sd) => {
        const w = group(b, 'wing', [sd * 0.06, 0.02, 0]);
        shape(w, 'box', mat(PALETTE.pure.white, { doubleSided: true }), { pos: [sd * 0.14, 0, 0], scale: [0.28, 0.01, 0.12] });
        w.tags.add(sd < 0 ? 'L' : 'R');
        return w;
      });
      this.flock.push({ root: b, wings, offset: new pc.Vec3(((i % 3) - 1) * 0.6, (i % 2) * 0.25, -Math.floor(i / 2) * 0.55), phase: i * 1.3 });
    }
  }

  /** `center`: where the camera looks; `alive`: whether the world is lively enough for birds. */
  update(dt: number, center: { x: number; y: number; z: number }, alive: boolean) {
    if (this.reducedMotion || !alive) {
      this.root.enabled = false;
      this.flying = false;
      return;
    }
    if (!this.flying) {
      this.wait -= dt;
      if (this.wait > 0) return;
      // A pass across the view, from one side to the other.
      const a = Math.random() * Math.PI * 2;
      this.dir.set(Math.cos(a), 0, Math.sin(a));
      this.from.set(center.x - this.dir.x * 22, center.y + 4.5, center.z - this.dir.z * 22);
      this.t = 0;
      this.flying = true;
      this.root.enabled = true;
      this.root.setLocalEulerAngles(0, (Math.atan2(this.dir.x, this.dir.z) * 180) / Math.PI, 0);
    }
    this.t += dt;
    const speed = 3.2;
    this.pos.set(this.from.x + this.dir.x * this.t * speed, this.from.y + Math.sin(this.t * 0.8) * 0.4, this.from.z + this.dir.z * this.t * speed);
    this.root.setPosition(this.pos);
    for (const b of this.flock) {
      b.root.setLocalPosition(b.offset.x, b.offset.y + Math.sin(this.t * 2 + b.phase) * 0.08, b.offset.z);
      const flap = Math.sin(this.t * 12 + b.phase) * 40;
      for (const w of b.wings) w.setLocalEulerAngles(0, 0, w.tags.has('L') ? -flap : flap);
    }
    if (this.t * speed > 44) {
      this.flying = false;
      this.root.enabled = false;
      this.wait = this.resident ? 12 + Math.random() * 12 : 25 + Math.random() * 25;
    }
  }
}
