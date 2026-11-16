import * as pc from 'playcanvas';
import type { CatSpot, CatVariant } from '../core/types';
import type { CatAnchor } from '../data/templates';
import type { Sim } from '../gameplay/Sim';
import { mat, PALETTE } from './Materials';
import { group, shape } from './Shapes';
import { ease, type Tweens } from './Tween';
import { MODELS } from './Models';

interface CatView {
  root: pc.Entity;
  paw: pc.Entity;
  head: pc.Entity;
  /** Rainbow Cat's halo (spins slowly) */
  halo?: pc.Entity;
  /** faint paw prints beside it once it has been hiding a while (Phase 5 E15 hint) */
  prints?: pc.Entity;
  anchorId: string;
  variant: CatVariant;
  spot: CatSpot;
  phase: number;
  /** Look 3.19: drawn with the hand-built model (its head doesn't tilt on its own) */
  model?: boolean;
}

/**
 * The Hidden Lucky Cat: a tiny white ceramic maneki-neko. Phase 5 E15: several can hide at once (a Lucky Cat
 * Invasion), keyed by cat id. Rarer cats differ in shape, not only colour: a Golden Cat wears a little crown and
 * holds a bigger coin, a Rainbow Cat has a floating halo and a star on its chest.
 */
export class CatVisuals {
  private views = new Map<string, CatView>();
  private time = 0;
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

  /** Ids of the cats on screen. */
  ids(): string[] {
    return [...this.views.keys()];
  }

  /** Click target centre (a little above the feet) of one cat (default: any). */
  targetWorld(catId?: string): pc.Vec3 | undefined {
    const v = catId ? this.views.get(catId) : this.views.values().next().value;
    if (!v) return undefined;
    const p = v.root.getPosition().clone();
    p.y += 0.14;
    return p;
  }

  show(spot: CatSpot, animate: boolean) {
    this.hide(spot.id, false);
    const a = this.sim.cat.anchor(spot.anchorId);
    if (!a) return;
    const variant = spot.variant ?? 'standard';
    const p = this.anchorWorld(a);
    const root = group(this.parent, `luckyCat-${spot.id}`, [p.x, p.y, p.z]);
    root.setEulerAngles(0, a.rotY, 0);
    const golden = variant === 'golden';
    const rainbow = variant === 'rainbow';
    // Look 3.19: the hand-built maneki-neko for white cats (its paw is its own part, so it still waves). A Golden
    // Cat stays procedural: gold all over with a crown and a bigger coin.
    const model = golden ? undefined : MODELS?.instantiate('lucky-cat');
    if (model) {
      model.setLocalScale(0.8, 0.8, 0.8);
      root.addChild(model);
      const paw = (model.findByName('paw') as pc.Entity | null) ?? group(model, 'paw');
      let halo: pc.Entity | undefined;
      if (rainbow) {
        halo = shape(root, 'torus', mat(PALETTE.pure.white, { emissive: PALETTE.glow.halo, emissiveIntensity: 0.9 }), { pos: [0, 0.42, 0], scale: [0.16, 0.03, 0.16] });
        const star = group(root, 'star', [0, 0.12, 0.11]);
        for (const r of [0, 45]) shape(star, 'box', mat(PALETTE.pure.white, { emissive: PALETTE.glow.star, emissiveIntensity: 0.8 }), { scale: [0.05, 0.05, 0.01], rot: [0, 0, r] });
      }
      const v: CatView = { root, paw, head: model, halo, anchorId: spot.anchorId, variant, spot, phase: this.views.size * 1.3, model: true };
      this.views.set(spot.id, v);
      if (animate) {
        root.setLocalScale(0.01, 0.01, 0.01);
        this.tweens.add(0.5, (k) => root.setLocalScale(k, k, k), { ease: ease.outBack });
      }
      return;
    }
    const white = golden ? mat(PALETTE.gold, { metal: 0.7, gloss: 0.9, emissive: PALETTE.trim.goldLow, emissiveIntensity: 0.25 }) : mat(PALETTE.cat, { gloss: 0.9 });
    const body = group(root, 'b');
    body.setLocalScale(0.85, 0.85, 0.85);
    shape(body, 'sphere', white, { pos: [0, 0.09, 0], scale: [0.17, 0.18, 0.14], shadow: true });
    const head = group(body, 'head', [0, 0.23, 0.01]);
    shape(head, 'sphere', white, { scale: [0.17, 0.14, 0.14], shadow: true });
    for (const s of [-1, 1]) {
      shape(head, 'cone', white, { pos: [s * 0.05, 0.08, 0], scale: [0.05, 0.06, 0.04], rot: [0, 0, -s * 15] });
      shape(head, 'cone', mat(PALETTE.pink), { pos: [s * 0.05, 0.08, 0.008], scale: [0.025, 0.035, 0.02], rot: [0, 0, -s * 15] });
      shape(head, 'sphere', mat(PALETTE.fauna.eye), { pos: [s * 0.035, 0.01, 0.065], scale: [0.018, 0.012, 0.01] });
    }
    shape(head, 'sphere', mat(PALETTE.pink), { pos: [0, -0.015, 0.07], scale: [0.015, 0.01, 0.01] });
    shape(body, 'cylinder', mat(PALETTE.catRed), { pos: [0, 0.17, 0], scale: [0.13, 0.02, 0.11] });
    const gold = mat(PALETTE.gold, { metal: 0.8, gloss: 0.9, emissive: PALETTE.trim.goldGlow, emissiveIntensity: 0.3 });
    shape(body, 'sphere', gold, { pos: [0, 0.155, 0.06], scale: 0.035 });
    // The koban coin: bigger on a Golden Cat.
    shape(body, 'sphere', mat(PALETTE.gold, { metal: 0.8, gloss: 0.9 }), { pos: [-0.04, 0.08, 0.07], scale: golden ? [0.09, 0.1, 0.025] : [0.06, 0.07, 0.02] });
    const paw = group(body, 'paw', [0.07, 0.17, 0.02]);
    shape(paw, 'capsule', white, { pos: [0, 0.05, 0], scale: [0.045, 0.06, 0.045] });
    shape(body, 'capsule', white, { pos: [-0.06, 0.03, -0.08], scale: [0.03, 0.06, 0.03], rot: [60, 0, 20] }); // tail
    if (golden) {
      // A little crown: a band and three points.
      shape(head, 'cylinder', gold, { pos: [0, 0.075, 0], scale: [0.09, 0.025, 0.09] });
      for (const k of [-1, 0, 1]) shape(head, 'cone', gold, { pos: [k * 0.03, 0.1, k === 0 ? 0.03 : 0.01], scale: [0.025, 0.04, 0.025] });
    }
    let halo: pc.Entity | undefined;
    if (rainbow) {
      // A floating halo and a star on the chest: readable without colour.
      halo = shape(root, 'torus', mat(PALETTE.pure.white, { emissive: PALETTE.glow.halo, emissiveIntensity: 0.9 }), { pos: [0, 0.42, 0], scale: [0.16, 0.03, 0.16] });
      const star = group(body, 'star', [0, 0.11, 0.135]);
      for (const r of [0, 45]) shape(star, 'box', mat(PALETTE.pure.white, { emissive: PALETTE.glow.star, emissiveIntensity: 0.8 }), { scale: [0.05, 0.05, 0.01], rot: [0, 0, r] });
    }
    const v: CatView = { root, paw, head, halo, anchorId: spot.anchorId, variant, spot, phase: this.views.size * 1.3 };
    this.views.set(spot.id, v);
    if (animate) {
      root.setLocalScale(0.01, 0.01, 0.01);
      this.tweens.add(0.5, (k) => root.setLocalScale(k, k, k), { ease: ease.outBack });
    }
  }

  /** Phase 5 E15: faint paw prints on the ground in front of a cat that has been hiding a while (no beacon). */
  setHint(catId: string, on: boolean) {
    const v = this.views.get(catId);
    if (!v || !!v.prints === on) return;
    if (!on) {
      v.prints!.destroy();
      v.prints = undefined;
      return;
    }
    const prints = group(v.root, 'prints');
    const m = mat(PALETTE.fauna.catBlanket, { gloss: 0.1 });
    for (let i = 0; i < 4; i++) shape(prints, 'cylinder', m, { pos: [(i % 2 ? 0.05 : -0.05), 0.003, 0.18 + i * 0.13], scale: [0.045, 0.004, 0.055] });
    v.prints = prints;
  }

  hide(catId: string, celebrate: boolean) {
    const v = this.views.get(catId);
    if (!v) return;
    this.views.delete(catId);
    const root = v.root;
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

  /** Look 3.19: redraw every cat on screen (the hand-built model has loaded). Paw-print hints come back on their own. */
  rebuildAll() {
    for (const v of [...this.views.values()]) this.show(v.spot, false);
  }

  hideAll() {
    for (const id of this.ids()) this.hide(id, false);
  }

  anchorOf(catId: string) {
    return this.views.get(catId)?.anchorId;
  }

  update(dt: number) {
    this.time += dt;
    for (const v of this.views.values()) {
      const t = this.time + v.phase;
      // Wave in short bursts — a hint, not a beacon.
      const phase = t % 4;
      const waving = phase < 1.2 && !this.reducedMotion;
      v.paw.setLocalEulerAngles(waving ? -20 + Math.sin(phase * 14) * 35 : -10, 0, 0);
      if (!this.reducedMotion) {
        if (!v.model) v.head.setLocalEulerAngles(0, 0, Math.sin(t * 1.3) * 6);
        if (v.halo) v.halo.setLocalEulerAngles(0, t * 40, 0);
      }
    }
  }
}
