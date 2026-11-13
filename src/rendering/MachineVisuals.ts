import * as pc from 'playcanvas';
import type { MachineData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { color, mat, PALETTE, uniqueMat } from './Materials';
import { group, shape } from './Shapes';
import { TUNING } from '../data/tuning';
import { SLAB_TOP } from './SceneBuilder';
import { ease, type Tweens } from './Tween';

interface MachineView {
  m: MachineData;
  root: pc.Entity;
  body: pc.Entity;
  spin: pc.Entity[];
  bob: pc.Entity[];
  panel?: pc.Entity[];
  butterflies?: pc.Entity[];
  light?: pc.Entity;
  coreMat?: pc.StandardMaterial;
  coreBase?: pc.StandardMaterial;
  rings?: pc.Entity[];
  orbs?: pc.Entity[];
  canopy?: pc.Entity;
  level: number;
  extras: pc.Entity;
}

const orbOn = () => mat('#b6ffe0', { emissive: '#7cf7c8', emissiveIntensity: 1.6 });
const orbOff = () => mat('#3f6b4a', { gloss: 0.6 });
const panelMat = () => mat(PALETTE.panel, { gloss: 0.85, metal: 0.2 });
const panelBoost = () => mat(PALETTE.panelGlint, { gloss: 0.9, emissive: '#ffd56a', emissiveIntensity: 0.6 });

/** Procedural low-poly machine models. Visual upgrades (bigger arrays, antennas, flowers) follow upgrade levels. */
export class MachineVisuals {
  private views = new Map<string, MachineView>();
  private time = 0;
  reducedMotion = false;
  /** Called when a newly built machine "powers on" (for VFX + sound). */
  onActivated?: (m: MachineData, at: pc.Vec3) => void;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private tweens: Tweens,
  ) {}

  worldOf(m: MachineData): [number, number, number] {
    const r = this.sim.grid.roof(m.roofId)!;
    return [r.origin[0] + m.x + m.size / 2, r.origin[1] + r.height + SLAB_TOP, r.origin[2] + m.z + m.size / 2];
  }

  view(id: string) {
    return this.views.get(id);
  }

  buildAll() {
    for (const m of this.sim.state.machines) this.add(m, false);
  }

  add(m: MachineData, animate: boolean) {
    const root = group(this.parent, `machine-${m.id}`, this.worldOf(m));
    const body = group(root, 'body');
    const v: MachineView = { m, root, body, spin: [], bob: [], level: -1, extras: group(body, 'extras') };
    switch (m.type) {
      case 'solar':
        this.solar(v);
        break;
      case 'condenser':
        this.condenser(v);
        break;
      case 'pollinator':
        this.pollinator(v);
        break;
      case 'droneHub':
        this.hub(v);
        break;
      case 'motherTree':
        this.motherTree(v);
        break;
      case 'core':
        this.core(v);
        break;
    }
    this.views.set(m.id, v);
    this.applyUpgrades(v);
    if (animate) this.playBuild(v);
  }

  /** Three beats: foundation pops up, the white shell unfolds, the light switches on. */
  private playBuild(v: MachineView) {
    const { root, body, m } = v;
    const s = m.size;
    const pad = shape(root, 'box', mat(PALETTE.shell), { pos: [0, 0.02, 0], scale: [0.01, 0.04, 0.01] });
    const tw = this.tweens;
    // 1. Foundation
    tw.add(0.28, (k) => pad.setLocalScale(s * 0.94 * k, 0.04 + 0.08 * Math.sin(k * Math.PI), s * 0.94 * k), { ease: ease.outBack });
    // 2. Shell unfolds: rises flat, widens, then stands up with a quarter twist
    body.setLocalScale(0.01, 0.01, 0.01);
    tw.add(0.5, (k) => {
      const xz = Math.min(1, k * 1.6);
      body.setLocalScale(xz, Math.max(0.01, k), xz);
      body.setLocalEulerAngles(0, (1 - k) * -90, 0);
    }, { delay: 0.22, ease: ease.outBack });
    tw.add(0.35, (k) => body.setLocalPosition(0, Math.sin(k * Math.PI) * 0.25, 0), { delay: 0.25 });
    // 3. Light activates
    const lamp = v.light;
    const orig = lamp ? lamp.getLocalScale().clone() : undefined;
    if (lamp) lamp.enabled = false;
    tw.add(0.4, (k) => {
      if (lamp && orig) {
        lamp.enabled = true;
        const f = 1 + Math.sin(k * Math.PI) * 2.5;
        lamp.setLocalScale(orig.x * f, orig.y * f, orig.z * f);
      }
    }, {
      delay: 0.75,
      done: () => {
        if (lamp && orig) lamp.setLocalScale(orig);
        tw.add(0.3, (k) => pad.setLocalScale(s * 0.94 * (1 - k), 0.04, s * 0.94 * (1 - k)), { done: () => pad.destroy() });
        this.onActivated?.(m, root.getPosition().clone());
      },
    });
  }

  private solar(v: MachineView) {
    const b = v.body;
    shape(b, 'cylinder', mat(PALETTE.shell), { pos: [0, 0.05, 0], scale: [0.5, 0.1, 0.5], shadow: true });
    shape(b, 'cylinder', mat(PALETTE.white), { pos: [0, 0.22, 0], scale: [0.09, 0.3, 0.09], shadow: true });
    const tilt = group(b, 'tilt', [0, 0.4, 0]);
    tilt.setLocalEulerAngles(-28, 45, 0);
    shape(tilt, 'box', mat(PALETTE.white), { scale: [0.86, 0.05, 0.66], shadow: true });
    const cells = shape(tilt, 'box', panelMat(), { pos: [0, 0.03, 0], scale: [0.78, 0.02, 0.58] });
    shape(tilt, 'box', mat(PALETTE.gold, { metal: 0.6, gloss: 0.7 }), { pos: [0, 0.035, -0.31], scale: [0.86, 0.02, 0.03] });
    for (let i = -1; i <= 1; i++) shape(tilt, 'box', mat(PALETTE.panelGlint), { pos: [i * 0.26, 0.042, 0], scale: [0.012, 0.005, 0.58] });
    v.panel = [cells];
    v.light = shape(b, 'sphere', mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 1 }), { pos: [0.2, 0.12, 0.2], scale: 0.06 });
    if (v.m.starter) shape(b, 'box', mat(PALETTE.rust), { pos: [-0.18, 0.12, 0.16], scale: [0.12, 0.05, 0.1], rot: [0, 30, 0] });
  }

  private condenser(v: MachineView) {
    const b = v.body;
    shape(b, 'cylinder', mat(PALETTE.shell), { pos: [0, 0.08, 0], scale: [0.66, 0.16, 0.66], shadow: true });
    shape(b, 'cylinder', mat(PALETTE.white), { pos: [0, 0.32, 0], scale: [0.5, 0.36, 0.5], shadow: true });
    shape(b, 'torus', mat(PALETTE.gold, { metal: 0.6, gloss: 0.7 }), { pos: [0, 0.5, 0], scale: [0.85, 0.3, 0.85] });
    shape(b, 'sphere', mat(PALETTE.glass, { opacity: 0.45, gloss: 0.95 }), { pos: [0, 0.74, 0], scale: 0.5 });
    const water = shape(b, 'sphere', mat(PALETTE.water, { emissive: '#2aa6d6', emissiveIntensity: 0.4, gloss: 0.9 }), { pos: [0, 0.7, 0], scale: 0.3 });
    v.bob.push(water);
    v.light = shape(b, 'sphere', mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.5 }), { pos: [0, 0.17, 0.33], scale: 0.05 });
    for (let i = 0; i < 3; i++) {
      const fin = group(b, 'fin');
      fin.setLocalEulerAngles(0, i * 120, 0);
      shape(fin, 'box', mat(PALETTE.shell), { pos: [0.3, 0.32, 0], scale: [0.1, 0.3, 0.03], shadow: true });
    }
  }

  private pollinator(v: MachineView) {
    const b = v.body;
    shape(b, 'box', mat(PALETTE.white), { pos: [0, 0.13, 0], scale: [0.84, 0.26, 0.84], shadow: true });
    shape(b, 'box', mat(PALETTE.soil), { pos: [0, 0.265, 0], scale: [0.74, 0.02, 0.74] });
    for (let i = 0; i < 9; i++) {
      const x = ((i % 3) - 1) * 0.24;
      const z = (Math.floor(i / 3) - 1) * 0.24;
      const h = 0.18 + ((i * 37) % 10) / 60;
      const f = group(b, 'f', [x, 0.27, z]);
      shape(f, 'cylinder', mat(PALETTE.stem), { pos: [0, h / 2, 0], scale: [0.025, h, 0.025] });
      shape(f, 'sphere', mat(PALETTE.flower[i % PALETTE.flower.length], { gloss: 0.5 }), { pos: [0, h, 0], scale: [0.15, 0.1, 0.15], shadow: true });
      shape(f, 'sphere', mat(PALETTE.flowerCore), { pos: [0, h + 0.04, 0], scale: 0.05 });
      v.bob.push(f);
    }
    v.light = shape(b, 'sphere', mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 1.2 }), { pos: [0.34, 0.46, -0.27], scale: 0.04 });
    // Bee house
    shape(b, 'box', mat(PALETTE.gold), { pos: [0.34, 0.45, -0.34], scale: [0.12, 0.16, 0.12], shadow: true });
    shape(b, 'cone', mat(PALETTE.trunk), { pos: [0.34, 0.57, -0.34], scale: [0.16, 0.1, 0.16] });
    v.butterflies = [];
    for (let i = 0; i < 2; i++) {
      const bf = group(v.root, 'butterfly');
      const col = i ? PALETTE.flower[1] : PALETTE.pink;
      for (const s of [-1, 1]) {
        const wing = group(bf, 'wing');
        shape(wing, 'box', mat(col, { doubleSided: true }), { pos: [s * 0.05, 0, 0], scale: [0.09, 0.005, 0.07] });
        wing.tags.add(s < 0 ? 'L' : 'R');
      }
      v.butterflies.push(bf);
    }
  }

  private hub(v: MachineView) {
    const b = v.body;
    shape(b, 'box', mat(PALETTE.shell), { pos: [0, 0.09, 0], scale: [1.7, 0.18, 1.7], shadow: true });
    for (const [x, z] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]])
      shape(b, 'cylinder', mat(PALETTE.shell), { pos: [x, 0.09, z], scale: [0.3, 0.18, 0.3] });
    shape(b, 'cylinder', mat(PALETTE.darkFace, { gloss: 0.6 }), { pos: [0.1, 0.19, 0.1], scale: [1.1, 0.02, 1.1] });
    const ring = shape(b, 'torus', mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.2 }), { pos: [0.1, 0.2, 0.1], scale: [1.55, 0.12, 1.55] });
    v.rings = [ring];
    shape(b, 'box', mat(PALETTE.white), { pos: [-0.6, 0.45, -0.6], scale: [0.36, 0.6, 0.36], shadow: true });
    shape(b, 'box', mat(PALETTE.darkFace), { pos: [-0.6, 0.55, -0.41], scale: [0.24, 0.14, 0.02] });
    const ant = shape(b, 'cylinder', mat(PALETTE.white), { pos: [-0.6, 0.95, -0.6], scale: [0.03, 0.4, 0.03] });
    void ant;
    v.light = shape(b, 'sphere', mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 1.5 }), { pos: [-0.6, 1.17, -0.6], scale: 0.08 });
    for (const [x, z] of [[0.7, -0.62], [-0.62, 0.72]]) shape(b, 'sphere', mat(PALETTE.leafFin), { pos: [x, 0.26, z], scale: [0.32, 0.14, 0.2] });
  }

  private motherTree(v: MachineView) {
    const b = v.body;
    // Round white planter ring, a twisting trunk, layered canopy and charge orbs.
    shape(b, 'cylinder', mat(PALETTE.shell), { pos: [0, 0.1, 0], scale: [1.7, 0.2, 1.7], shadow: true });
    shape(b, 'cylinder', mat(PALETTE.soil), { pos: [0, 0.205, 0], scale: [1.5, 0.02, 1.5] });
    for (let i = 0; i < 3; i++) {
      const seg = shape(b, 'cylinder', mat(PALETTE.trunk), { pos: [Math.sin(i) * 0.06, 0.45 + i * 0.36, Math.cos(i) * 0.06], scale: [0.32 - i * 0.05, 0.42, 0.32 - i * 0.05], rot: [6 - i * 5, i * 30, 8 - i * 6], shadow: true });
      void seg;
    }
    for (let r = 0; r < 4; r++) {
      const a = r * 1.7;
      shape(b, 'capsule', mat(PALETTE.trunk), { pos: [Math.cos(a) * 0.3, 0.28, Math.sin(a) * 0.3], scale: [0.07, 0.12, 0.07], rot: [Math.sin(a) * 70, 0, Math.cos(a) * 70] });
    }
    const canopy = group(b, 'canopy', [0, 1.55, 0]);
    const leaves: [number, number, number, number, string][] = [
      [0, 0.3, 0, 1.25, PALETTE.shrub[0]],
      [0.45, 0.05, 0.2, 0.85, PALETTE.shrub[1]],
      [-0.42, 0.1, -0.15, 0.9, PALETTE.shrub[2]],
      [0.1, 0.05, -0.48, 0.8, PALETTE.shrub[1]],
      [-0.2, 0.0, 0.45, 0.8, PALETTE.shrub[0]],
      [0, 0.75, 0, 0.75, '#5fc25a'],
    ];
    for (const [x, y, z, sz, c] of leaves) shape(canopy, 'sphere', mat(c), { pos: [x, y, z], scale: [sz, sz * 0.78, sz], shadow: true });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      shape(canopy, 'sphere', mat(PALETTE.flower[i % 5]), { pos: [Math.cos(a) * 0.62, 0.15 + (i % 2) * 0.3, Math.sin(a) * 0.62], scale: 0.1 });
    }
    v.canopy = canopy;
    // Charge orbs hang in the canopy; they light up as the tree charges.
    v.orbs = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const o = shape(canopy, 'sphere', mat('#3f6b4a', { gloss: 0.6 }), { pos: [Math.cos(a) * 0.55, -0.22 + (i % 2) * 0.12, Math.sin(a) * 0.55], scale: 0.12 });
      v.orbs.push(o);
    }
    v.light = shape(b, 'sphere', mat('#7cf7c8', { emissive: '#7cf7c8', emissiveIntensity: 1.2 }), { pos: [0, 0.24, 0.72], scale: 0.07 });
  }

  /** Bloom Pulse: canopy swells and the orbs flash. */
  pulseTree(id: string) {
    const v = this.views.get(id);
    if (!v?.canopy) return;
    const c = v.canopy;
    this.tweens.cancel(c);
    this.tweens.add(0.9, (k) => {
      const s = 1 + Math.sin(k * Math.PI) * 0.25 * (1 - k * 0.5);
      c.setLocalScale(s, s, s);
    }, { owner: c, ease: ease.linear, done: () => c.setLocalScale(1, 1, 1) });
  }

  private core(v: MachineView) {
    const b = v.body;
    v.coreBase = uniqueMat(PALETTE.coreDormant, { gloss: 0.3 });
    v.coreMat = uniqueMat('#8a9097', { gloss: 0.8, emissive: '#000000', emissiveIntensity: 1 });
    shape(b, 'box', v.coreBase, { pos: [0, 0.1, 0], scale: [1.7, 0.2, 1.7], shadow: true });
    shape(b, 'box', v.coreBase, { pos: [0, 0.32, 0], scale: [1.25, 0.24, 1.25], shadow: true });
    const ob = shape(b, 'box', v.coreBase, { pos: [0, 0.95, 0], scale: [0.42, 1.1, 0.42], rot: [0, 45, 0], shadow: true });
    void ob;
    const crystal = group(b, 'crystal', [0, 1.85, 0]);
    shape(crystal, 'cone', v.coreMat, { pos: [0, 0.22, 0], scale: [0.42, 0.44, 0.42], shadow: true });
    shape(crystal, 'cone', v.coreMat, { pos: [0, -0.18, 0], scale: [0.42, 0.36, 0.42], rot: [180, 0, 0], shadow: true });
    v.spin.push(crystal);
    v.rings = [];
    for (let i = 0; i < 2; i++) {
      const r = shape(b, 'torus', mat(PALETTE.coreGlow, { emissive: PALETTE.coreGlow, emissiveIntensity: 1.5 }), { pos: [0, 1.4 + i * 0.5, 0], scale: [1.1 - i * 0.3, 0.1, 1.1 - i * 0.3] });
      r.enabled = false;
      v.rings.push(r);
    }
    // cracks
    shape(b, 'box', mat(PALETTE.crack), { pos: [0.22, 0.9, 0.0], scale: [0.02, 0.6, 0.02], rot: [0, 45, 12] });
  }

  /** "World-as-upgrade-tree": upgrades visibly change machines. */
  applyUpgrades(v: MachineView) {
    const u = this.sim.upgrades;
    const lvl =
      v.m.type === 'solar' ? u.level('solarArray') : v.m.type === 'droneHub' ? u.level('droneSpeed') : v.m.type === 'pollinator' ? u.level('pollinatorReach') : 0;
    if (lvl === v.level) return;
    v.level = lvl;
    v.extras.destroy();
    v.extras = group(v.body, 'extras');
    const ex = v.extras;
    if (v.m.type === 'solar') {
      // Extra wing panels per Solar Array level
      for (let i = 0; i < lvl; i++) {
        const side = i % 2 ? -1 : 1;
        const w = group(ex, 'wing', [side * 0.33 * (1 + Math.floor(i / 2) * 0.4), 0.48 + i * 0.06, -0.05]);
        w.setLocalEulerAngles(-28, 45, side * 12);
        shape(w, 'box', mat(PALETTE.white), { scale: [0.36, 0.04, 0.5], shadow: true });
        const c = shape(w, 'box', panelMat(), { pos: [0, 0.025, 0], scale: [0.31, 0.02, 0.44] });
        v.panel!.push(c);
      }
    } else if (v.m.type === 'droneHub') {
      for (let i = 0; i < lvl; i++) {
        shape(ex, 'cylinder', mat(PALETTE.white), { pos: [-0.6 + 0.12 * (i + 1), 0.95 + i * 0.1, -0.6], scale: [0.02, 0.5 + i * 0.15, 0.02] });
        shape(ex, 'sphere', mat(PALETTE.leafFin), { pos: [-0.6, 0.8, -0.6 + 0.2 * (i + 1)], scale: [0.25, 0.06, 0.12], rot: [0, 30 * i, 20] });
      }
    } else if (v.m.type === 'pollinator') {
      for (let i = 0; i < lvl * 4; i++) {
        const a = (i / (lvl * 4)) * Math.PI * 2;
        shape(ex, 'sphere', mat(PALETTE.flower[i % 5]), { pos: [Math.cos(a) * 0.46, 0.3, Math.sin(a) * 0.46], scale: 0.1 });
      }
    }
  }

  refreshUpgrades() {
    for (const v of this.views.values()) this.applyUpgrades(v);
  }

  /** Core look: dormant / ready (pulsing gold) / awakened. */
  setCoreState(state: 'dormant' | 'ready' | 'awake', instant = false) {
    const v = [...this.views.values()].find((x) => x.m.type === 'core');
    if (!v || !v.coreMat || !v.coreBase) return;
    v.root.tags.remove('ready', 'awake', 'dormant');
    v.root.tags.add(state);
    if (state === 'awake') {
      const from = v.coreBase.diffuse.clone();
      const to = color(PALETTE.white);
      this.tweens.add(instant ? 0.01 : 1.2, (k) => {
        v.coreBase!.diffuse = new pc.Color().lerp(from, to, k);
        v.coreBase!.update();
        v.coreMat!.diffuse = new pc.Color().lerp(color('#8a9097'), color(PALETTE.coreGlow), k);
        v.coreMat!.emissive = new pc.Color().lerp(new pc.Color(0, 0, 0), color(PALETTE.coreGlow), k);
        v.coreMat!.emissiveIntensity = 1.2;
        v.coreMat!.update();
      });
      v.rings!.forEach((r) => (r.enabled = true));
    }
  }

  coreWorld(): [number, number, number] | undefined {
    const v = [...this.views.values()].find((x) => x.m.type === 'core');
    if (!v) return undefined;
    const p = v.root.getPosition();
    return [p.x, p.y + 1.8, p.z];
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    const now = this.sim.time;
    const rm = this.reducedMotion;
    for (const v of this.views.values()) {
      switch (v.m.type) {
        case 'solar': {
          const boosted = v.m.boostUntil > now || this.sim.production.frenzyActive();
          const m = boosted ? panelBoost() : panelMat();
          for (const p of v.panel!) if (p.render!.material !== m) p.render!.material = m;
          const s = 0.05 + (boosted ? 0.025 * (1 + Math.sin(t * 10)) : 0.01 * Math.sin(t * 2));
          v.light!.setLocalScale(s, s, s);
          break;
        }
        case 'condenser': {
          if (!rm) v.bob[0].setLocalPosition(0, 0.7 + Math.sin(t * 2 + v.root.getPosition().x) * 0.03, 0);
          // Water level shows the watering charge.
          const f = 0.35 + 0.65 * Math.min(1, (v.m.charge ?? 0) / TUNING.condenser.threshold);
          v.bob[0].setLocalScale(0.3 * f + 0.06, 0.3 * f + 0.06, 0.3 * f + 0.06);
          break;
        }
        case 'motherTree': {
          const lit = Math.round(((v.m.charge ?? 0) / TUNING.motherTree.threshold) * v.orbs!.length);
          v.orbs!.forEach((o, i) => {
            const on = i < lit;
            const want = on ? orbOn() : orbOff();
            if (o.render!.material !== want) o.render!.material = want;
            const sc = on ? 0.12 + (rm ? 0 : Math.sin(t * 4 + i) * 0.015) : 0.1;
            o.setLocalScale(sc, sc, sc);
          });
          if (!rm && v.canopy && !this.tweens.has(v.canopy)) v.canopy.setLocalEulerAngles(Math.sin(t * 0.8) * 1.5, 0, Math.cos(t * 0.6) * 1.5);
          break;
        }
        case 'pollinator': {
          if (rm) break;
          v.bob.forEach((f, i) => f.setLocalEulerAngles(Math.sin(t * 1.8 + i) * 6, 0, Math.cos(t * 1.4 + i) * 6));
          v.butterflies!.forEach((bf, i) => {
            const a = t * (0.9 + i * 0.3) + i * 3;
            const r = 0.55 + Math.sin(t * 0.7 + i) * 0.25 + this.sim.upgrades.pollinatorReach * 0.15;
            bf.setLocalPosition(Math.cos(a) * r, 0.65 + Math.sin(t * 2.3 + i) * 0.15, Math.sin(a) * r);
            bf.setLocalEulerAngles(0, (-a * 180) / Math.PI, 0);
            const flap = Math.sin(t * 22 + i) * 55;
            for (const w of bf.children as pc.Entity[]) w.setLocalEulerAngles(0, 0, w.tags.has('L') ? flap : -flap);
          });
          break;
        }
        case 'droneHub': {
          const s = 0.07 + 0.03 * Math.max(0, Math.sin(t * 4));
          v.light!.setLocalScale(s, s, s);
          if (!rm) v.rings![0].setLocalEulerAngles(0, t * 30, 0);
          break;
        }
        case 'core': {
          const awake = v.root.tags.has('awake');
          const ready = v.root.tags.has('ready');
          if (!rm) v.spin[0].setLocalEulerAngles(0, t * (awake ? 50 : 8), 0);
          v.spin[0].setLocalPosition(0, 1.85 + (awake || ready ? Math.sin(t * 2) * 0.08 : 0), 0);
          if (ready && !awake) {
            v.coreMat!.emissive = color(PALETTE.gold);
            v.coreMat!.emissiveIntensity = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * 4));
            v.coreMat!.update();
          }
          if (awake && !rm)
            v.rings!.forEach((r, i) => {
              r.setLocalEulerAngles(Math.sin(t + i) * 20, t * (40 + i * 30), Math.cos(t * 0.8 + i) * 20);
              r.setLocalPosition(0, 1.4 + i * 0.5 + Math.sin(t * 1.5 + i) * 0.1, 0);
            });
          break;
        }
      }
    }
  }
}
