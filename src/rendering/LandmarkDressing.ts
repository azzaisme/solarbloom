/**
 * P7-E31 (#749–#753): a landmark's dressing and its three looks.
 *
 * Every region's landmark is a hand-built model on a 2×2 footprint. Until now it looked the same asleep and awake
 * (only the floating leaf emblem above it changed). The dressing tells the place's story in three stages
 * (data/landmarks `landmarkStage`):
 *
 * - ruined: the model's own palette dulled to a dusty grey (E20.6's neglected props, a touch darker), dry ivy, dark
 *   lanterns, a cold beacon;
 * - restoring (its region greening toward the landmark's need): the stone warms back step by step, the ivy greens,
 *   the lanterns hold a faint ember (and pulse gold when it is ready to wake);
 * - thriving (woken): the model's own ivory and gold, living ivy in flower, pots in bloom, lanterns lit; the Sea Lock
 *   opens its gate leaves and turns its gear, and its beacon lights the canal's mouth.
 *
 * One material language for every landmark (#750): ivory stone footings, timber posts, gold brackets, lantern glass,
 * living green. Everything stands inside the footprint (the landmark's tiles are already occupied) or on water nobody
 * walks (#754); nothing is saved or read by the simulation. Materials are per landmark and change in place, so the
 * dressing joins its region's machine batch like the rest of the landmark.
 */
import * as pc from 'playcanvas';
import { LANDMARK_LOOK, landmarkDress, type LandmarkDress, type LandmarkStage } from '../data/landmarks';
import { color, glow, uniqueMat } from './Materials';
import { PALETTE } from './Palette';
import { group } from './Shapes';
import { ball, part, rbox, rcyl } from './MachineParts';
import { MODELS } from './Models';
import { ease, type Tweens } from './Tween';

/** A model material and the colours it is lerped between. */
interface Tinted {
  m: pc.StandardMaterial;
  diffuse: pc.Color;
  emissive: pc.Color;
  emissiveIntensity: number;
  gloss: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export class LandmarkDressing {
  readonly root: pc.Entity;
  readonly dress: LandmarkDress;
  stage: LandmarkStage = 'ruined';
  /** how restored it looks (0 ruined → 1 thriving) */
  k = 0;
  /** ready to wake: the lanterns pulse gold */
  ready = false;
  private tinted: Tinted[] = [];
  private ivyMat: pc.StandardMaterial;
  private lanternMats: pc.StandardMaterial[] = [];
  private blooms: pc.Entity;
  private leaves: pc.Entity[] = [];
  private gear?: pc.Entity;
  private open = 0;
  private gearAngle = 0;
  private beaconLamp?: pc.StandardMaterial;
  private beaconHalo?: pc.Entity;
  private lit = 0;

  /**
   * `parent` is the landmark's root (at its footprint's centre, on its ground); `model` its model entity as placed
   * (scaled), whose materials are swapped for this landmark's own tinted copies.
   */
  constructor(
    parent: pc.Entity,
    readonly kind: string,
    model: pc.Entity | undefined,
    private tweens: Tweens,
  ) {
    this.dress = landmarkDress(kind);
    this.root = group(parent, 'landmark-dressing');
    if (model) this.tintModel(model);
    const L = PALETTE.landmark;
    this.ivyMat = uniqueMat(L.ivyDry, { gloss: 0.25 });
    this.blooms = group(this.root, 'blooms');
    this.apron();
    this.lanterns();
    this.ivy();
    this.pots();
    this.beacon();
    if (model && this.dress.lock) this.lockParts(model);
    this.blooms.enabled = false;
    this.apply();
  }

  /** The model's materials, one copy each for this landmark, so its look can change without touching other props. */
  private tintModel(model: pc.Entity) {
    const copies = new Map<pc.Material, pc.StandardMaterial>();
    for (const r of model.findComponents('render') as pc.RenderComponent[])
      for (const mi of r.meshInstances) {
        const src = mi.material as pc.StandardMaterial;
        let c = copies.get(src);
        if (!c) {
          c = src.clone() as pc.StandardMaterial;
          copies.set(src, c);
          this.tinted.push({ m: c, diffuse: src.diffuse.clone(), emissive: src.emissive.clone(), emissiveIntensity: src.emissiveIntensity, gloss: src.gloss });
        }
        mi.material = c;
      }
  }

  /** Stone slabs under the model (a cleaner footing than the bare tile), tinted with the model. */
  private apron() {
    const a = this.dress.apron;
    if (!a) return;
    const L = PALETTE.landmark;
    const slab = uniqueMat(L.apron, { gloss: 0.3 });
    const seam = uniqueMat(L.apronSeam, { gloss: 0.2 });
    this.track(slab);
    this.track(seam);
    part(this.root, rbox(a.hx * 2, 0.05, a.hz * 2, 0.02), seam, { pos: [0, 0.005, 0], receive: true });
    // four slabs with a seam between them (reads as laid stone, not a plastic mat)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) part(this.root, rbox(a.hx - 0.04, 0.05, a.hz - 0.04, 0.02), slab, { pos: [(sx * a.hx) / 2, 0.012, (sz * a.hz) / 2] });
  }

  /** A material whose colour follows the model's tint. */
  private track(m: pc.StandardMaterial) {
    this.tinted.push({ m, diffuse: m.diffuse.clone(), emissive: m.emissive.clone(), emissiveIntensity: m.emissiveIntensity, gloss: m.gloss });
  }

  /** Lantern posts: a stone footing, a timber post, a gold bracket and the lantern model (or a glass box). */
  private lanterns() {
    const L = PALETTE.landmark;
    const footing = uniqueMat(L.footing, { gloss: 0.3 });
    const post = uniqueMat(L.post, { gloss: 0.25 });
    const brass = uniqueMat(PALETTE.gold, { metal: 0.6, gloss: 0.7 });
    for (const m of [footing, post, brass]) this.track(m);
    for (const s of this.dress.lanterns) {
      const g = group(this.root, 'lantern-post', [s.x, 0, s.z]);
      part(g, rcyl(0.11, 0, 0.1, 0.02, 0.01, 10), footing, { shadow: true });
      part(g, rbox(0.07, s.h, 0.07, 0.015), post, { pos: [0, 0.1 + s.h / 2, 0], shadow: true });
      part(g, rbox(0.05, 0.03, 0.2, 0.01), brass, { pos: [0, 0.1 + s.h - 0.04, 0.07] });
      const hook = group(g, 'hook', [0, 0.1 + s.h - 0.05, 0.15]);
      const glass = uniqueMat(L.lamp, { gloss: 0.8, emissive: L.lampGlow, emissiveIntensity: 1 });
      glass.emissiveIntensity = 0;
      glass.update();
      this.lanternMats.push(glass);
      const model = MODELS?.instantiate('lantern');
      if (model) {
        model.setLocalScale(0.55, 0.55, 0.55);
        hook.addChild(model);
        this.tintModel(model);
        const gl = model.findByName('glass') as pc.Entity | null;
        for (const r of (gl?.findComponents('render') ?? []) as pc.RenderComponent[]) for (const mi of r.meshInstances) mi.material = glass;
      } else {
        part(hook, rbox(0.09, 0.14, 0.09, 0.015), glass, { pos: [0, -0.1, 0] });
        part(hook, rbox(0.12, 0.025, 0.12, 0.01), brass, { pos: [0, -0.02, 0] });
      }
    }
  }

  /** Ivy patches on the model: dry and sparse when ruined, green when restored, flowering when thriving. */
  private ivy() {
    const fl = PALETTE.landmark.potFlowers;
    let i = 0;
    for (const p of this.dress.ivy) {
      for (let j = 0; j < 4; j++) {
        const a = i * 2.39 + j * 1.7;
        const q: [number, number, number] = [p.x + Math.cos(a) * p.r * 0.6, p.y + Math.sin(a * 1.3) * p.r * 0.8, p.z + 0.02 * j];
        const s = p.r * (0.55 + 0.15 * ((i + j) % 3));
        part(this.root, ball(4, 6), this.ivyMat, { pos: q, scale: [s, s * 0.8, s * 0.45], rot: [0, 0, (i + j) * 37] });
        if (j % 2 === 0) part(this.blooms, ball(4, 6), uniqueMat(fl[(i + j) % 2], { gloss: 0.3 }), { pos: [q[0], q[1] + s * 0.3, q[2] + s * 0.25], scale: [0.06, 0.045, 0.06] });
      }
      i++;
    }
  }

  /** Clay pots at the front, bare soil until the landmark thrives, then a two-colour bed. */
  private pots() {
    const L = PALETTE.landmark;
    const clay = uniqueMat(L.pot, { gloss: 0.3 });
    this.track(clay);
    let i = 0;
    for (const p of this.dress.pots) {
      part(this.root, rcyl(0.1, 0, 0.16, 0.02, 0.01, 10), clay, { pos: [p.x, 0, p.z], shadow: true });
      part(this.root, ball(4, 6), this.ivyMat, { pos: [p.x, 0.2, p.z], scale: [0.16, 0.1, 0.16] });
      for (let j = 0; j < 3; j++) {
        const a = j * 2.1 + i;
        part(this.blooms, ball(4, 6), uniqueMat(L.potFlowers[(i + j) % 2], { gloss: 0.3 }), { pos: [p.x + Math.cos(a) * 0.05, 0.25, p.z + Math.sin(a) * 0.05], scale: [0.06, 0.04, 0.06] });
      }
      i++;
    }
  }

  /** The Sea Lock's beacon: the sea-lock-light model on a rock off the shore, its lamp lit when the lock thrives. */
  private beacon() {
    const b = this.dress.beacon;
    if (!b) return;
    const L = PALETTE.landmark;
    const g = group(this.root, 'beacon', [b.dx, 0, b.dz]);
    const rock = uniqueMat(L.rock, { gloss: 0.2 });
    part(g, ball(5, 8), rock, { pos: [0, -0.25, 0], scale: [b.rock * 1.6, 0.7, b.rock * 1.4], shadow: true });
    part(g, ball(4, 7), rock, { pos: [b.rock * 0.55, -0.2, b.rock * 0.4], scale: [b.rock * 0.8, 0.5, b.rock * 0.7], rot: [0, 30, 0] });
    const model = MODELS?.instantiateMerged('sea-lock-light');
    const h = 5 * b.scale; // the model is 5 m tall
    if (model) {
      model.setLocalScale(b.scale, b.scale, b.scale);
      model.setLocalPosition(0, 0.05, 0);
      g.addChild(model);
      this.tintModel(model);
    } else {
      // stand-in: an ivory tower with a lamp room
      const st = uniqueMat(L.footing, { gloss: 0.3 });
      this.track(st);
      part(g, rcyl(0.3, 0.05, h * 0.7, 0.02, 0.01, 12), st, { shadow: true });
    }
    // the lamp: a glass drum round the lamp room that lights up (and a soft halo once it thrives)
    this.beaconLamp = uniqueMat(L.lamp, { gloss: 0.9, emissive: L.lampGlow, emissiveIntensity: 1 });
    this.beaconLamp.emissiveIntensity = 0;
    this.beaconLamp.update();
    part(g, rcyl(0.5 * b.scale * 1.05, h * 0.62, h * 0.74, 0.01, 0.01, 16), this.beaconLamp, {});
    this.beaconHalo = part(g, ball(6, 10), uniqueMat(L.lampGlow, { emissive: L.lampGlow, emissiveIntensity: 1.2, opacity: 0.18 }), { pos: [0, h * 0.68, 0], scale: 0.0001 });
    this.beaconHalo.enabled = false;
  }

  /** The lock's gate leaves and gear, found by name in its model (they move when it wakes). */
  private lockParts(model: pc.Entity) {
    const lk = this.dress.lock!;
    for (const n of lk.leaves) {
      const e = model.findByName(n) as pc.Entity | null;
      if (e) this.leaves.push(e);
    }
    this.gear = (model.findByName(lk.gear) as pc.Entity | null) ?? undefined;
  }

  /** Shows the look for `stage` at `k` (eased over `dur` seconds, or at once). */
  set(stage: LandmarkStage, k: number, instant = false) {
    if (this.stage === 'thriving' && stage !== 'thriving') return; // a woken landmark never goes back
    this.tweens.cancel(this);
    const k0 = this.k;
    this.stage = stage;
    if (stage === 'thriving') return this.wake(instant);
    if (instant || Math.abs(k - k0) < 1e-3) {
      this.k = k;
      this.apply();
      return;
    }
    this.tweens.add(1.2, (t) => {
      this.k = lerp(k0, k, t);
      this.apply();
    }, { owner: this });
  }

  /**
   * #753: the wake. The stone washes clean to its own ivory and gold, the ivy greens and flowers, the lanterns light
   * one after another, and (the Sea Lock) the gate leaves swing open and the beacon lights.
   */
  private wake(instant: boolean) {
    const W = LANDMARK_LOOK.wake;
    const k0 = this.k;
    const showBlooms = () => {
      const bl = this.blooms;
      if (bl.enabled) return;
      bl.enabled = true;
      if (instant) return bl.setLocalScale(1, 1, 1);
      bl.setLocalScale(0.001, 0.001, 0.001);
      this.tweens.add(0.9, (t) => bl.setLocalScale(Math.max(0.001, t), Math.max(0.001, t), Math.max(0.001, t)), { delay: W.wash * 0.6, ease: ease.outBack });
    };
    if (instant) {
      this.k = 1;
      this.lit = this.lanternMats.length;
      this.open = 1;
      this.apply();
      showBlooms();
      return;
    }
    this.tweens.add(W.wash, (t) => {
      this.k = lerp(k0, 1, t);
      this.apply();
    }, { owner: this });
    this.lanternMats.forEach((_, i) =>
      this.tweens.add(0.4, () => {}, {
        delay: W.lanternDelay + i * W.lanternStep,
        done: () => {
          this.lit = Math.max(this.lit, i + 1);
          this.apply();
        },
      }),
    );
    if (this.leaves.length) this.tweens.add(W.open, (t) => ((this.open = t), this.pose()), { delay: W.openDelay, ease: ease.inOutCubic });
    showBlooms();
  }

  /** Every material and part for the current k / stage. */
  private apply() {
    const k = this.k;
    const R = LANDMARK_LOOK;
    const T = R.ruinTint;
    for (const t of this.tinted) {
      const m = t.m;
      const c = t.diffuse;
      const grey = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      const ruin = (v: number, i: number) => (v + (grey - v) * R.ruinDesat) * R.ruinDark * T[i];
      m.diffuse.set(lerp(ruin(c.r, 0), c.r, k), lerp(ruin(c.g, 1), c.g, k), lerp(ruin(c.b, 2), c.b, k));
      m.gloss = t.gloss * lerp(LANDMARK_LOOK.ruinGloss, 1, k);
      // the model's own glows (lit windows, lamps) only come back as it thrives
      m.emissive.copy(t.emissive);
      m.emissiveIntensity = t.emissiveIntensity * (this.stage === 'thriving' ? k : 0);
      m.update();
    }
    const L = PALETTE.landmark;
    this.ivyMat.diffuse.lerp(color(L.ivyDry), color(L.ivyLive), Math.min(1, k * 1.25));
    this.ivyMat.update();
    this.lanterns_();
    if (this.beaconLamp) {
      const on = this.stage === 'thriving' ? k : 0;
      this.beaconLamp.emissiveIntensity = glow(LANDMARK_LOOK.beaconGlow) * on;
      this.beaconLamp.update();
      if (this.beaconHalo) {
        this.beaconHalo.enabled = on > 0.01;
        const s = 0.75 * on + 0.0001;
        this.beaconHalo.setLocalScale(s, s, s);
      }
    }
    this.pose();
  }

  private lanterns_(pulse = 0) {
    const G = LANDMARK_LOOK.lanternGlow;
    this.lanternMats.forEach((m, i) => {
      const thriving = this.stage === 'thriving' && i < this.lit;
      const ember = this.stage === 'restoring' ? G.restoring * Math.min(1, this.k / LANDMARK_LOOK.restoringK[1]) : 0;
      m.emissiveIntensity = thriving ? glow(G.thriving) : ember + (this.ready ? pulse : 0);
      m.update();
    });
  }

  /** The gate leaves (open swings them back toward the walls) and the gear. */
  private pose() {
    const lk = this.dress.lock;
    if (!lk) return;
    const [l, r] = this.leaves;
    // each leaf hangs from its outer hinge: positive yaw swings the left leaf's free edge back (-z), away from the sea
    l?.setLocalEulerAngles(0, lk.open * this.open, 0);
    r?.setLocalEulerAngles(0, -lk.open * this.open, 0);
    this.gear?.setLocalEulerAngles(this.gearAngle, 0, 0);
  }

  /** Per frame: the gear turns while the gate opens and then idles; a ready landmark's lanterns pulse gold. */
  update(dt: number, t: number, reducedMotion: boolean) {
    if (this.gear && this.stage === 'thriving' && !reducedMotion) {
      const lk = this.dress.lock!;
      const opening = this.open > 0 && this.open < 1;
      this.gearAngle = (this.gearAngle + dt * lk.gearSpin * (opening ? 3 : 0.15)) % 360;
      this.gear.setLocalEulerAngles(this.gearAngle, 0, 0);
    }
    if (this.ready && this.stage !== 'thriving') this.lanterns_(reducedMotion ? 0.5 : 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * 4)));
  }
}
