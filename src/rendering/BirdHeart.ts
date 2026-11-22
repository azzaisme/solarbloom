import * as pc from 'playcanvas';
import { BIRD_HEART } from '../data/birdHeart';
import { HeartFlight, type Box } from './HeartFlight';
import { mat, PALETTE } from './Materials';
import { group, shape } from './Shapes';

/** One bird: a root to place, and its two wings to flap (about its forward axis). */
export interface HeartBird {
  root: pc.Entity;
  wings: [pc.Entity, pc.Entity];
}

/** The camera the heart is laid out for: where a screen point lies at a depth, and which way it looks. */
export interface HeartCamera {
  screenToWorld(x: number, y: number, z: number, out?: pc.Vec3): pc.Vec3;
  readonly entity: { forward: pc.Vec3 };
}

/** A gull like the passing flocks' (Birds.ts), minus the beak: too small to see at this size. Three meshes. */
function gull(parent: pc.Entity): HeartBird {
  const b = group(parent, 'heart-bird');
  shape(b, 'sphere', mat(PALETTE.fauna.gull), { scale: [0.16, 0.1, 0.24] });
  const wings = [-1, 1].map((sd) => {
    const w = group(b, 'wing', [sd * 0.06, 0.02, 0]);
    shape(w, 'box', mat(PALETTE.pure.white, { doubleSided: true }), { pos: [sd * 0.14, 0, 0], scale: [0.28, 0.01, 0.12] });
    return w;
  }) as [pc.Entity, pc.Entity];
  return { root: b, wings };
}
/** The gull's wingspan at scale 1 (wing roots at ±0.06, each wing 0.28 long). */
const GULL_SPAN = 0.68;

/**
 * #689 (E27.5): the Great Bloom's heart of birds. `play` builds the flock and starts the flight (HeartFlight works out
 * where each bird is on screen); `update` lays each bird out at that screen point a set depth in front of the camera,
 * facing its heading with its back to the camera (so its wings show), banked into its turns and flapping. When the
 * flight ends every bird is destroyed: nothing is left over between blooms. Playing again while it flies does nothing.
 */
export class BirdHeart {
  private root?: pc.Entity;
  private birds: HeartBird[] = [];
  private flight?: HeartFlight;
  private phase: number[] = [];
  private p = new pc.Vec3();
  private q = new pc.Vec3();
  private f = new pc.Vec3();
  private up = new pc.Vec3();
  private side = new pc.Vec3();
  private look = new pc.Vec3();

  constructor(
    private parent: pc.Entity,
    private make: (parent: pc.Entity) => HeartBird = gull,
  ) {}

  get active(): boolean {
    return !!this.flight;
  }

  /** Starts the flight on a screen `w` × `h` (CSS pixels), the heart in `box`. False if one is already flying. */
  play(w: number, h: number, box: Box, calm: boolean): boolean {
    if (this.flight) return false;
    this.flight = new HeartFlight(w, h, box, calm);
    this.root = group(this.parent, 'bird-heart');
    this.birds = this.flight.slots.map(() => this.make(this.root!));
    this.phase = this.birds.map((_, i) => i * 0.37);
    for (const b of this.birds) b.root.enabled = false;
    return true;
  }

  update(dt: number, cam: HeartCamera) {
    const fl = this.flight;
    if (!fl) return;
    fl.step(dt);
    if (fl.done) return this.stop();
    const D = BIRD_HEART.depth;
    // world units per screen pixel at the flock's depth, for its size
    const mid = fl.box.y + fl.box.h / 2;
    const perPx = cam.screenToWorld(fl.w / 2 + 50, mid, D, this.q).distance(cam.screenToWorld(fl.w / 2 - 50, mid, D, this.p)) / 100;
    const size = (fl.spanPx * perPx) / GULL_SPAN;
    // the birds' backs face the camera, tipped a little toward the sky, so the wings read as a V from the front
    this.up.copy(cam.entity.forward).mulScalar(-1).normalize();
    fl.poses.forEach((ps, i) => {
      const b = this.birds[i];
      b.root.enabled = ps.shown;
      if (!ps.shown) return;
      const P = cam.screenToWorld(ps.x, ps.y, D, this.p);
      const A = cam.screenToWorld(ps.x + Math.cos(ps.heading) * 10, ps.y + Math.sin(ps.heading) * 10, D, this.q);
      this.f.sub2(A, P).normalize();
      // roll the back's normal about the heading by the bank
      this.side.cross(this.f, this.up);
      const c = Math.cos(ps.bank);
      const s = Math.sin(ps.bank);
      this.side.mulScalar(s).add(this.look.copy(this.up).mulScalar(c));
      b.root.setPosition(P);
      // lookAt points −z at the target: aim it behind, so the gull's +z (its beak end) leads
      b.root.lookAt(this.look.copy(P).sub(this.f), this.side);
      b.root.setLocalScale(size * ps.scale, size * ps.scale, size * ps.scale);
      this.phase[i] += dt * ps.flap * Math.PI * 2;
      const flap = Math.sin(this.phase[i]) * (ps.flap > BIRD_HEART.flap.glide + 0.2 ? 38 : 14);
      b.wings[0].setLocalEulerAngles(0, 0, -flap);
      b.wings[1].setLocalEulerAngles(0, 0, flap);
    });
  }

  /** Ends the flight now and removes every bird. */
  stop() {
    this.root?.destroy();
    this.root = undefined;
    this.birds = [];
    this.phase = [];
    this.flight = undefined;
  }
}
