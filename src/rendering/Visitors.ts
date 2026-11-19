import * as pc from 'playcanvas';
import { VISIT, VISITORS, type Perch } from '../data/wildlife';
import type { Visit } from '../gameplay/Wildlife';
import { PALETTE } from './Materials';
import { group, vshape } from './Shapes';

/**
 * E23.2.4.2 (#415): the animals that come over while bloombot sits. Each flies or walks in from a few tiles away,
 * settles where its visit says (on bloombot's head, shoulders, lap or arm, beside it, sniffing in front, perched
 * nearby, or just passing), breathes or flutters there, and leaves when bloombot stands.
 *
 * Primitive placeholders at gameplay scale, in the style of the other fauna (Fauna.ts): `parts` animate (wings, or
 * the head). Pooled per kind (made the first time one comes, parked when gone); nothing here writes the sim.
 */
interface Actor {
  kind: string;
  root: pc.Entity;
  /** wings (fliers) or a head (walkers), animated while settled */
  parts: pc.Entity[];
  flies: boolean;
  used: boolean;
}

/** What the renderer needs to know about bloombot right now. */
export interface VisitHost {
  /** world position of a perch (BloombotVisuals.visitPoint) */
  point(p: Perch, out: pc.Vec3): pc.Vec3;
  /** bloombot's facing (radians, the walker's convention) */
  facing: number;
  /** ground height under a world position */
  groundY(x: number, z: number): number;
  /** while sitting on a bench: the seat top (visitors beside bloombot sit on it), else undefined */
  seatY?: number;
  reducedMotion: boolean;
}

const F = () => PALETTE.fauna;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export class Visitors {
  readonly root = new pc.Entity('visitors');
  private pool: Actor[] = [];
  private byVisit = new Map<Visit, Actor>();
  private clock = 0;
  private tmp = new pc.Vec3();
  private from = new pc.Vec3();

  constructor(parent: pc.Entity) {
    parent.addChild(this.root);
  }

  /** Per frame: place every visit's animal. `now` is sim time (visits are timed in it). */
  update(dt: number, now: number, visits: readonly Visit[], host: VisitHost) {
    this.clock += dt;
    // let go of animals whose visit is over
    for (const [v, a] of this.byVisit) {
      if (!visits.includes(v)) {
        a.used = false;
        a.root.enabled = false;
        this.byVisit.delete(v);
      }
    }
    for (const v of visits) {
      let a = this.byVisit.get(v);
      const goneAt = v.leave !== undefined ? v.leave + VISIT.leave : Infinity;
      if (now < v.start || now >= goneAt || (v.leave !== undefined && v.leave <= v.start)) {
        if (a) a.root.enabled = false;
        continue;
      }
      if (!a) this.byVisit.set(v, (a = this.take(v.id)));
      a.root.enabled = true;
      this.place(a, v, now, host);
    }
  }

  private place(a: Actor, v: Visit, now: number, h: VisitHost) {
    const target = this.target(v, h, this.tmp);
    // where it comes from (and goes back to): VISIT.from away, in the visit's own direction
    const fx = target.x + Math.cos(v.from) * VISIT.from;
    const fz = target.z + Math.sin(v.from) * VISIT.from;
    this.from.set(fx, h.groundY(fx, fz) + (a.flies ? 1.4 : 0), fz);
    let p: pc.Vec3;
    let k = 1; // 0 far, 1 at the perch
    let moving = false;
    let heading = h.facing;
    if (v.perch === 'passBy') {
      // passes through the perch and on to the far side, never settling
      const t = clamp01((now - v.start) / (v.arrive - v.start + VISIT.passSeconds));
      const ox = target.x * 2 - this.from.x;
      const oz = target.z * 2 - this.from.z;
      const s = t * 2;
      p = s <= 1 ? new pc.Vec3().lerp(this.from, target, smooth(s)) : new pc.Vec3().lerp(target, new pc.Vec3(ox, this.from.y, oz), smooth(s - 1));
      p.y += Math.sin(t * Math.PI * 6) * 0.06;
      heading = Math.atan2(ox - this.from.x, oz - this.from.z);
      moving = true;
    } else {
      if (now < v.arrive) k = smooth(clamp01((now - v.start) / (v.arrive - v.start)));
      if (v.leave !== undefined && now >= v.leave) k = 1 - smooth(clamp01((now - v.leave) / VISIT.leave));
      moving = k < 1;
      p = new pc.Vec3().lerp(this.from, target, k);
      if (moving) {
        // fliers swoop in on an arc, walkers hop along the ground
        if (a.flies) p.y += Math.sin(k * Math.PI) * 0.5;
        else p.y = Math.max(p.y, h.groundY(p.x, p.z)) + Math.abs(Math.sin(this.clock * 9)) * 0.04;
        const out = v.leave !== undefined && now >= v.leave;
        heading = out ? Math.atan2(this.from.x - target.x, this.from.z - target.z) : Math.atan2(target.x - this.from.x, target.z - this.from.z);
      } else heading = this.settledFacing(v.perch, h.facing);
    }
    a.root.setPosition(p);
    a.root.setEulerAngles(0, (heading * 180) / Math.PI, 0);
    this.animate(a, moving, h.reducedMotion);
  }

  /** Where a visit settles: its perch, spread out a little when several share one. */
  private target(v: Visit, h: VisitHost, out: pc.Vec3): pc.Vec3 {
    h.point(v.perch, out);
    if (v.slot) {
      const side = (v.slot % 2 ? 1 : -1) * Math.ceil(v.slot / 2) * VISIT.spacing;
      out.x += Math.cos(h.facing) * side;
      out.z -= Math.sin(h.facing) * side;
    }
    if (v.perch === 'beside' && h.seatY !== undefined) out.y = h.seatY; // up on the bench seat beside bloombot
    else if (v.perch === 'beside' || v.perch === 'sniff' || v.perch === 'perchNear') out.y = h.groundY(out.x, out.z);
    return out;
  }

  /** Settled visitors face the way bloombot does, or turn to it (sniffing, perched nearby). */
  private settledFacing(p: Perch, facing: number): number {
    if (p === 'sniff') return facing + Math.PI; // nose to bloombot
    if (p === 'perchNear') return facing + Math.PI * 0.75;
    if (p === 'beside') return facing + Math.PI / 2; // curled up along the seat
    return facing;
  }

  private animate(a: Actor, moving: boolean, still: boolean) {
    const t = this.clock;
    if (a.flies) {
      // wings beat in flight, and fold and flick now and then once settled
      const beat = still ? 0 : moving ? Math.sin(t * 28) * 55 : Math.max(0, Math.sin(t * 2.3)) ** 8 * 35;
      a.parts[0]?.setLocalEulerAngles(0, 0, beat);
      a.parts[1]?.setLocalEulerAngles(0, 0, -beat);
    } else {
      // walkers look about while settled (a slow breath for the curled-up ones)
      const look = still || moving ? 0 : Math.sin(t * 0.9) * 18;
      a.parts[0]?.setLocalEulerAngles(0, look, 0);
    }
  }

  private take(kind: string): Actor {
    let a = this.pool.find((x) => !x.used && x.kind === kind);
    if (!a) {
      a = make(this.root, kind);
      this.pool.push(a);
    }
    a.used = true;
    return a;
  }

  destroy() {
    this.root.destroy();
  }
}

/** Builds one visitor's placeholder body. The root sits at the feet (or under the belly), facing +z. */
function make(parent: pc.Entity, kind: string): Actor {
  const def = VISITORS.find((v) => v.id === kind)!;
  const root = group(parent, `visitor-${kind}`);
  const body = group(root, 'body');
  const f = F();
  const eyes = (p: pc.Entity, x: number, y: number, z: number, s = 0.007) => {
    for (const side of [-1, 1]) vshape(p, 'sphere', f.eye, { pos: [side * x, y, z], scale: s });
  };
  const wings = (p: pc.Entity, col: string, span: number, y: number, chord = span * 0.7, round = false) =>
    [-1, 1].map((side) => {
      const w = group(p, side < 0 ? 'wingR' : 'wingL', [side * 0.01, y, 0]);
      vshape(w, round ? 'sphere' : 'box', col, { pos: [side * span * 0.5, 0, 0], scale: [span, 0.006, chord] });
      return w;
    });
  const bird = (col: string, breast: string, s: number, beak: string, tail = 0.05) => {
    body.setLocalScale(s, s, s);
    vshape(body, 'sphere', col, { pos: [0, 0.05, 0], scale: [0.06, 0.055, 0.085] });
    vshape(body, 'sphere', breast, { pos: [0, 0.042, 0.018], scale: [0.045, 0.04, 0.05] });
    const head = group(body, 'head', [0, 0.088, 0.035]);
    vshape(head, 'sphere', col, { scale: 0.045 });
    vshape(head, 'cone', beak, { pos: [0, 0, 0.03], scale: [0.012, 0.028, 0.012], rot: [90, 0, 0] });
    eyes(head, 0.016, 0.008, 0.016, 0.006);
    vshape(body, 'box', col, { pos: [0, 0.06, -0.065], scale: [0.03, 0.008, tail], rot: [-18, 0, 0] });
    return wings(body, col, 0.07, 0.065, 0.06);
  };
  let parts: pc.Entity[] = [];
  switch (kind) {
    case 'butterfly':
    case 'swallowtail': {
      const [a, b] = kind === 'butterfly' ? [f.butterflyBlue, f.breast] : [f.swallowtail[0], f.swallowtail[2]];
      body.setLocalScale(1.4, 1.4, 1.4);
      vshape(body, 'capsule', f.swallowtail[1], { pos: [0, 0.02, 0], scale: [0.008, 0.035, 0.008], rot: [90, 0, 0] });
      parts = wings(body, a, 0.045, 0.022, 0.04, true);
      for (const w of parts) vshape(w, 'sphere', b, { pos: [w.name === 'wingL' ? 0.03 : -0.03, 0.001, -0.012], scale: [0.018, 0.006, 0.016] });
      break;
    }
    case 'bumblebee': {
      const [y, d, w] = f.bumble;
      body.setLocalScale(1.4, 1.4, 1.4);
      vshape(body, 'sphere', y, { pos: [0, 0.02, 0], scale: [0.022, 0.02, 0.03] });
      vshape(body, 'sphere', d, { pos: [0, 0.02, -0.012], scale: [0.02, 0.018, 0.012] });
      vshape(body, 'sphere', d, { pos: [0, 0.022, 0.02], scale: 0.013 });
      parts = wings(body, w, 0.025, 0.035, 0.016, true);
      break;
    }
    case 'songbird':
      parts = bird(f.birds[1], f.breast, 1.5, f.beak);
      break;
    case 'magpie':
      parts = bird(f.magpie[0], f.magpie[1], 1.7, f.magpie[0], 0.11);
      for (const w of parts) vshape(w, 'box', f.magpie[2], { pos: [w.name === 'wingL' ? 0.03 : -0.03, 0.004, 0], scale: [0.03, 0.004, 0.03] });
      break;
    case 'kingfisher':
      parts = bird(f.kingfisher[0], f.kingfisher[1], 1.4, f.eye, 0.03);
      break;
    case 'owl': {
      const [coat, face, eye] = f.owl;
      body.setLocalScale(1.6, 1.6, 1.6);
      vshape(body, 'sphere', coat, { pos: [0, 0.07, 0], scale: [0.07, 0.085, 0.065] });
      vshape(body, 'sphere', face, { pos: [0, 0.075, 0.035], scale: [0.05, 0.06, 0.03] });
      const head = group(body, 'head', [0, 0.13, 0.005]);
      vshape(head, 'sphere', coat, { scale: [0.06, 0.05, 0.055] });
      vshape(head, 'sphere', face, { pos: [0, 0, 0.03], scale: [0.045, 0.035, 0.02] });
      for (const s of [-1, 1]) vshape(head, 'sphere', eye, { pos: [s * 0.016, 0.004, 0.045], scale: 0.012 });
      eyes(head, 0.016, 0.004, 0.052, 0.006);
      for (const s of [-1, 1]) vshape(head, 'cone', coat, { pos: [s * 0.03, 0.035, 0], scale: [0.012, 0.025, 0.012] });
      parts = wings(body, coat, 0.06, 0.08, 0.07);
      break;
    }
    case 'hedgehog': {
      const [spines, face, nose] = f.hedgehog;
      body.setLocalScale(1.4, 1.4, 1.4);
      vshape(body, 'sphere', spines, { pos: [0, 0.045, -0.005], scale: [0.065, 0.05, 0.075] });
      for (let i = 0; i < 6; i++) vshape(body, 'cone', spines, { pos: [Math.sin(i) * 0.03, 0.07 + (i % 2) * 0.01, -0.03 + i * 0.012], scale: [0.012, 0.03, 0.012], rot: [-30 + i * 4, 0, Math.sin(i) * 25] });
      const head = group(body, 'head', [0, 0.035, 0.06]);
      vshape(head, 'sphere', face, { scale: [0.035, 0.03, 0.04] });
      vshape(head, 'sphere', nose, { pos: [0, -0.002, 0.04], scale: 0.009 });
      eyes(head, 0.016, 0.012, 0.022, 0.006);
      parts = [head];
      break;
    }
    case 'squirrel': {
      const [fur, belly] = f.squirrel;
      body.setLocalScale(1.5, 1.5, 1.5);
      vshape(body, 'sphere', fur, { pos: [0, 0.045, 0], scale: [0.045, 0.05, 0.07] });
      vshape(body, 'sphere', belly, { pos: [0, 0.04, 0.02], scale: [0.03, 0.035, 0.04] });
      const head = group(body, 'head', [0, 0.085, 0.045]);
      vshape(head, 'sphere', fur, { scale: 0.035 });
      for (const s of [-1, 1]) vshape(head, 'cone', fur, { pos: [s * 0.015, 0.03, -0.005], scale: [0.01, 0.018, 0.01] });
      eyes(head, 0.015, 0.008, 0.022, 0.006);
      vshape(body, 'capsule', fur, { pos: [0, 0.1, -0.07], scale: [0.03, 0.09, 0.03], rot: [-25, 0, 0] });
      parts = [head];
      break;
    }
    case 'fox':
    case 'fawn': {
      const [coat, light, dark] = kind === 'fox' ? f.fox : f.fawn;
      const s = kind === 'fox' ? 1.6 : 1.5;
      body.setLocalScale(s, s, s);
      // the fox curls up (low, round); the fawn lies down with its legs tucked under
      vshape(body, 'sphere', coat, { pos: [0, 0.045, 0], scale: [0.09, 0.055, 0.12] });
      vshape(body, 'sphere', light, { pos: [0, 0.035, 0.03], scale: [0.06, 0.035, 0.07] });
      const head = group(body, 'head', [0, 0.09, 0.09]);
      vshape(head, 'sphere', coat, { scale: [0.045, 0.045, 0.05] });
      vshape(head, 'cone', coat, { pos: [0, -0.008, 0.05], scale: [0.025, 0.05, 0.022], rot: [90, 0, 0] });
      vshape(head, 'sphere', dark, { pos: [0, -0.008, 0.075], scale: 0.009 });
      for (const sd of [-1, 1]) vshape(head, kind === 'fox' ? 'cone' : 'capsule', kind === 'fox' ? coat : light, { pos: [sd * 0.025, 0.045, -0.01], scale: kind === 'fox' ? [0.016, 0.035, 0.012] : [0.012, 0.04, 0.008], rot: [0, 0, sd * (kind === 'fox' ? 12 : 50)] });
      eyes(head, 0.018, 0.012, 0.035, 0.007);
      if (kind === 'fox') {
        vshape(body, 'capsule', coat, { pos: [0.06, 0.04, -0.09], scale: [0.04, 0.12, 0.04], rot: [80, 0, 60] }); // the brush, wrapped round
        vshape(body, 'sphere', light, { pos: [0.11, 0.04, -0.03], scale: 0.025 });
      } else for (let i = 0; i < 5; i++) vshape(body, 'sphere', light, { pos: [Math.sin(i * 2.4) * 0.05, 0.075, -0.05 + i * 0.025], scale: 0.01 }); // dappled back
      parts = [head];
      break;
    }
    case 'frog': {
      const [skin, belly] = f.frog;
      body.setLocalScale(1.3, 1.3, 1.3);
      vshape(body, 'sphere', skin, { pos: [0, 0.025, 0], scale: [0.05, 0.03, 0.055] });
      vshape(body, 'sphere', belly, { pos: [0, 0.018, 0.012], scale: [0.04, 0.02, 0.04] });
      for (const s of [-1, 1]) vshape(body, 'sphere', skin, { pos: [s * 0.02, 0.05, 0.025], scale: 0.015 });
      eyes(body, 0.02, 0.058, 0.032, 0.007);
      for (const s of [-1, 1]) vshape(body, 'sphere', skin, { pos: [s * 0.045, 0.012, -0.02], scale: [0.02, 0.012, 0.035] });
      parts = [body];
      break;
    }
    case 'otter': {
      const [coat, light, dark] = f.otter;
      body.setLocalScale(1.5, 1.5, 1.5);
      vshape(body, 'capsule', coat, { pos: [0, 0.045, 0], scale: [0.06, 0.16, 0.06], rot: [90, 0, 0] });
      vshape(body, 'sphere', light, { pos: [0, 0.04, 0.05], scale: [0.045, 0.03, 0.05] });
      const head = group(body, 'head', [0, 0.07, 0.1]);
      vshape(head, 'sphere', coat, { scale: [0.04, 0.035, 0.042] });
      vshape(head, 'sphere', light, { pos: [0, -0.01, 0.03], scale: [0.025, 0.018, 0.02] });
      vshape(head, 'sphere', dark, { pos: [0, -0.002, 0.045], scale: 0.008 });
      eyes(head, 0.017, 0.01, 0.03, 0.006);
      vshape(body, 'cone', coat, { pos: [0, 0.03, -0.13], scale: [0.03, 0.08, 0.02], rot: [-90, 0, 0] });
      parts = [head];
      break;
    }
  }
  root.enabled = false;
  return { kind, root, parts, flies: !!def.flies, used: false };
}
