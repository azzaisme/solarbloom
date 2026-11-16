import * as pc from 'playcanvas';
import type { MachineData } from '../core/types';
import { GROUND } from '../core/GameState';
import type { Sim } from '../gameplay/Sim';
import { color, mat, PALETTE, uniqueMat } from './Materials';
import { group, shape } from './Shapes';
import { TUNING } from '../data/tuning';
import { SLAB_TOP } from './SceneBuilder';
import { ease, type Tweens } from './Tween';
import { foliageMaterial, treeMesh } from './Foliage';
import { treeGeo } from './TreeGen';
import { machineRunning } from './FaunaPlan';

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
  /** Reservoir: water surface inside the cistern / garden basin. */
  water?: pc.Entity;
  /** Elder Tree: the dormant bare branches (hidden once its canopy unfolds). */
  bare?: pc.Entity;
  /** Which Core model this is (decides how it wakes). */
  coreKind?: 'crystal' | 'cistern' | 'elder' | 'fountain';
  level: number;
  /** the upgrade levels its extras were built for (Phase 4 E09.6) */
  vkey?: string;
  extras: pc.Entity;
  /** panels built with the model (not upgrade extras): the base panel, plus a Solar Array's two wings */
  basePanels?: number;
  /** Phase 5 E14: a superstructure (its own model, stages and animation; no tier-1 update logic) */
  super?: { stage: number; head?: pc.Entity; spin: pc.Entity[]; bob: pc.Entity[]; glow: pc.Entity[]; scaffold?: pc.Entity };
  /** Phase 5 E13: the floating crown gem of a tier-2 machine */
  crown?: pc.Entity;
  /** joined its region's dynamic batch (after its build animation) */
  batched?: boolean;
  /** Phase 5 E16: really working right now (refreshed twice a second), and when its next active wisp is due */
  running?: boolean;
  wispAt?: number;
}

const orbOn = () => mat(PALETTE.core.orbOn, { emissive: PALETTE.core.glow, emissiveIntensity: 1.6 });
const orbOff = () => mat(PALETTE.core.orbOff, { gloss: 0.6 });
const panelMat = () => mat(PALETTE.panel, { gloss: 0.85, metal: 0.2 });
const panelBoost = () => mat(PALETTE.panelGlint, { gloss: 0.9, emissive: PALETTE.glow.panel, emissiveIntensity: 0.6 });

/** Procedural low-poly machine models. Visual upgrades (bigger arrays, antennas, flowers) follow upgrade levels. */
export class MachineVisuals {
  private views = new Map<string, MachineView>();
  private time = 0;
  reducedMotion = false;
  /**
   * Phase 5 E16: a running machine in view gives off a small wisp now and then (sun glints, mist, pollen).
   * Pooled particles (Vfx), at most `wispsPerSecond` across the view; nothing with reduced motion.
   */
  onWisp?: (m: MachineData, at: pc.Vec3) => void;
  wispsPerSecond = 5;
  private wispBudget = 0;
  private runCheck = 0;
  /** Called when a newly built machine "powers on" (for VFX + sound). */
  onActivated?: (m: MachineData, at: pc.Vec3) => void;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private tweens: Tweens,
    /** When given, city machines are merged into per-region dynamic batches (draw-call budget). */
    private batcher?: pc.BatchManager,
  ) {}

  /** Region size (tiles) of one machine batch group: a build or upgrade only re-batches its own region. */
  static readonly BATCH_REGION = 64;
  private batchGroups = new Map<string, number>();

  private batchGroupFor(m: MachineData): number | undefined {
    if (!this.batcher || m.roofId !== GROUND || m.type === 'core') return undefined;
    const R = MachineVisuals.BATCH_REGION;
    const key = `${Math.floor(m.x / R)}:${Math.floor(m.z / R)}`;
    let id = this.batchGroups.get(key);
    if (id === undefined) {
      id = this.batcher.addGroup(`machines:${key}`, true, R).id;
      this.batchGroups.set(key, id);
    }
    return id;
  }

  /**
   * Merges a machine's parts into its region's batch. Parts whose material swaps at runtime (solar panels,
   * Mother Tree orbs) and the status light (toggled during builds) stay separate.
   */
  private batch(v: MachineView) {
    const id = this.batchGroupFor(v.m);
    if (id === undefined) return;
    v.batched = true;
    const skip = new Set<pc.Entity>([...(v.panel ?? []), ...(v.orbs ?? []), ...(v.light ? [v.light] : [])]);
    const walk = (e: pc.Entity) => {
      if (skip.has(e)) return;
      if (e.render && e.render.batchGroupId !== id) e.render.batchGroupId = id;
      for (const c of e.children) walk(c as pc.Entity);
    };
    walk(v.root);
  }

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
    if ((m.tier ?? 1) >= 3) {
      this.superModel(v);
      this.views.set(m.id, v);
      if (animate) this.playBuild(v);
      return;
    }
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
      case 'core': {
        const lk = this.landmarkKind(m);
        const kind = lk === 'cistern' ? 'cistern' : lk === 'elder' ? 'elder' : lk === 'fountain' || lk === 'lock' ? 'fountain' : 'crystal';
        v.coreKind = kind;
        if (kind === 'cistern') this.cistern(v);
        else if (kind === 'elder') this.elderTree(v);
        else if (kind === 'fountain') this.fountain(v);
        else this.core(v);
        break;
      }
      case 'reservoirGarden':
        this.reservoirGarden(v);
        break;
      case 'relay':
        this.relay(v);
        break;
    }
    if ((m.tier ?? 1) >= 2) this.tier2(v);
    this.views.set(m.id, v);
    this.applyUpgrades(v);
    if (animate) {
      this.playBuild(v);
      this.tweens.add(1.4, () => {}, { done: () => this.views.get(m.id) === v && this.batch(v) });
    } else this.batch(v);
  }

  /**
   * Phase 5 E13: a tier-2 machine reads bigger and richer: its body grows, a gold-trimmed cream plinth sits under
   * it and a gem in its family colour floats above (solar gold, water cyan, garden pink, drone mint).
   */
  private tier2(v: MachineView) {
    const s = v.m.size;
    v.body.setLocalScale(1.16, 1.16, 1.16);
    const gem = PALETTE.glow.gem[v.m.type as string] ?? PALETTE.glow.gem.solar;
    shape(v.root, 'cylinder', mat(PALETTE.shell), { pos: [0, 0.03, 0], scale: [s * 0.98, 0.06, s * 0.98], shadow: true });
    shape(v.root, 'torus', mat(PALETTE.gold, { metal: 0.6, gloss: 0.75 }), { pos: [0, 0.06, 0], scale: [s * 1.0, 0.06, s * 1.0] });
    // Family touches that make the three-in-one readable.
    const tilt = v.spin[0];
    if (v.m.type === 'solar' && tilt) {
      for (const side of [-1, 1]) {
        const wing = group(tilt, 'wing', [side * 0.66, 0.02, 0]);
        wing.setLocalEulerAngles(0, 0, side * 14);
        shape(wing, 'box', mat(PALETTE.white), { scale: [0.46, 0.05, 0.62], shadow: true });
        const cells = shape(wing, 'box', panelMat(), { pos: [0, 0.03, 0], scale: [0.4, 0.02, 0.54] });
        shape(wing, 'box', mat(PALETTE.gold, { metal: 0.6, gloss: 0.7 }), { pos: [0, 0.035, -0.29], scale: [0.46, 0.02, 0.03] });
        v.panel?.push(cells);
      }
      v.basePanels = v.panel?.length;
    } else if (v.m.type === 'condenser') {
      for (const side of [-1, 1]) {
        shape(v.body, 'cylinder', mat(PALETTE.white), { pos: [side * 0.36, 0.22, side * -0.18], scale: [0.2, 0.36, 0.2], shadow: true });
        shape(v.body, 'sphere', mat(PALETTE.water, { emissive: PALETTE.aqua.deep, emissiveIntensity: 0.5, gloss: 0.9 }), { pos: [side * 0.36, 0.44, side * -0.18], scale: 0.16 });
      }
    } else if (v.m.type === 'pollinator') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        shape(v.body, 'sphere', mat(i % 2 ? PALETTE.flowers.pastelPink : PALETTE.flowers.pastelYellow), { pos: [Math.cos(a) * 0.42, 0.16, Math.sin(a) * 0.42], scale: [0.16, 0.1, 0.16] });
      }
    } else if (v.m.type === 'droneHub') {
      shape(v.body, 'cylinder', mat(PALETTE.white), { pos: [0.6, 0.5, 0.6], scale: [0.26, 0.7, 0.26], shadow: true });
      shape(v.body, 'torus', mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.2 }), { pos: [0.6, 0.86, 0.6], scale: [0.4, 0.08, 0.4] });
    }
    const crown = group(v.root, 'crown', [0, 1.0 + (s - 1) * 0.3, 0]);
    shape(crown, 'sphere', mat(gem, { emissive: gem, emissiveIntensity: 1.3, gloss: 0.9 }), { pos: [0, 0, 0], scale: [0.16, 0.22, 0.16] });
    shape(crown, 'torus', mat(PALETTE.gold, { metal: 0.6, gloss: 0.75 }), { pos: [0, 0, 0], scale: [0.3, 0.05, 0.3] });
    v.crown = crown;
  }

  /**
   * Phase 5 E14: superstructure models. Cream rounded shells, solar gold and water cyan accents, foliage. While
   * under construction: a foundation slab with scaffold poles (stage 1), then the structure half-raised inside its
   * scaffold (stage 2); built, the full model.
   */
  private superModel(v: MachineView) {
    const m = v.m;
    const s = m.size;
    const stage = m.project ? m.project.stage : 3;
    const sv: NonNullable<MachineView['super']> = { stage, spin: [], bob: [], glow: [] };
    v.super = sv;
    const b = v.body;
    // Foundation: a rounded cream plinth with a gold rim (every stage).
    shape(v.root, 'cylinder', mat(PALETTE.shell), { pos: [0, 0.06, 0], scale: [s * 0.96, 0.12, s * 0.96], shadow: true });
    shape(v.root, 'torus', mat(PALETTE.gold, { metal: 0.6, gloss: 0.75 }), { pos: [0, 0.12, 0], scale: [s * 0.97, 0.08, s * 0.97] });
    if (stage < 3) {
      const sc = group(v.root, 'scaffold');
      const h = stage === 1 ? 0.9 : 1.8;
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) shape(sc, 'box', mat(PALETTE.wood.light), { pos: [x * s * 0.42, h / 2, z * s * 0.42], scale: [0.06, h, 0.06], shadow: true });
      for (const y of stage === 1 ? [0.5] : [0.6, 1.4]) for (const [x, z, rx] of [[0, -1, 0], [0, 1, 0], [-1, 0, 90], [1, 0, 90]]) shape(sc, 'box', mat(PALETTE.wood.pale), { pos: [x * s * 0.42, y, z * s * 0.42], scale: [s * 0.84, 0.05, 0.05], rot: [0, rx, 0] });
      sv.scaffold = sc;
      if (stage === 1) return; // just the foundation
      b.setLocalScale(0.62, 0.62, 0.62);
    }
    if (m.type === 'solar') {
      // Solar Megaflower: a giant sunflower whose petals are solar panels, its gold face tracking the sun.
      shape(b, 'cylinder', mat(PALETTE.white), { pos: [0, 0.8, 0], scale: [0.16, 1.5, 0.16], shadow: true });
      for (const side of [-1, 1]) shape(b, 'sphere', mat(PALETTE.leafFin), { pos: [side * 0.32, 0.7, 0], scale: [0.5, 0.08, 0.24], rot: [0, 0, side * -25], shadow: true });
      const head = group(b, 'head', [0, 1.65, 0]);
      head.setLocalEulerAngles(-35, 45, 0);
      shape(head, 'cylinder', mat(PALETTE.gold, { metal: 0.5, gloss: 0.8, emissive: PALETTE.trim.amber, emissiveIntensity: 0.25 }), { scale: [0.7, 0.14, 0.7], shadow: true });
      shape(head, 'cylinder', mat(PALETTE.metal.bronze), { pos: [0, 0.08, 0], scale: [0.5, 0.04, 0.5] });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * 360;
        const pet = group(head, 'petal');
        pet.setLocalEulerAngles(0, a, 0);
        shape(pet, 'box', mat(PALETTE.white), { pos: [0.66, 0, 0], scale: [0.62, 0.05, 0.3], rot: [0, 0, -8], shadow: true });
        const cell = shape(pet, 'box', mat(PALETTE.panel, { gloss: 0.85, metal: 0.2 }), { pos: [0.68, 0.03, 0], scale: [0.54, 0.02, 0.24], rot: [0, 0, -8] });
        sv.glow.push(cell);
      }
      sv.head = head;
    } else if (m.type === 'condenser') {
      // Water Nexus: a cream tower under a glass dome full of swirling water, rings of cyan around it.
      shape(b, 'cylinder', mat(PALETTE.white), { pos: [0, 0.55, 0], scale: [1.0, 0.9, 1.0], shadow: true });
      shape(b, 'torus', mat(PALETTE.gold, { metal: 0.6, gloss: 0.75 }), { pos: [0, 1.0, 0], scale: [1.08, 0.18, 1.08] });
      shape(b, 'sphere', mat(PALETTE.glass, { opacity: 0.4, gloss: 0.95 }), { pos: [0, 1.45, 0], scale: 1.0 });
      const water = shape(b, 'sphere', mat(PALETTE.water, { emissive: PALETTE.aqua.deep, emissiveIntensity: 0.6, gloss: 0.9 }), { pos: [0, 1.4, 0], scale: 0.62 });
      sv.bob.push(water);
      for (let i = 0; i < 3; i++) {
        const r = shape(b, 'torus', mat(PALETTE.water, { emissive: PALETTE.water, emissiveIntensity: 1.1 }), { pos: [0, 0.4 + i * 0.32, 0], scale: [1.35 + i * 0.1, 0.05, 1.35 + i * 0.1] });
        sv.spin.push(r);
      }
      for (const [x, z] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]) shape(b, 'cylinder', mat(PALETTE.white), { pos: [x, 0.35, z], scale: [0.18, 0.5, 0.18], shadow: true });
    } else if (m.type === 'pollinator') {
      // Tree of Life: a towering radiant tree (real foliage: it sways and turns see-through over the cursor).
      shape(b, 'cylinder', mat(PALETTE.soil), { pos: [0, 0.15, 0], scale: [s * 0.82, 0.04, s * 0.82] });
      const tree = new pc.Entity('treeOfLife');
      tree.addComponent('render', { meshInstances: [new pc.MeshInstance(treeMesh(this.device(), treeGeo('oak', 4, 1, 1)), foliageMaterial())], castShadows: true, receiveShadows: true });
      tree.setLocalPosition(0, 0.12, 0);
      tree.setLocalScale(2.5, 2.5, 2.5);
      b.addChild(tree);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const orb = shape(b, 'sphere', mat(PALETTE.glow.sun, { emissive: PALETTE.glow.amber, emissiveIntensity: 1.4 }), { pos: [Math.cos(a) * 1.2, 1.6 + (i % 3) * 0.5, Math.sin(a) * 1.2], scale: 0.1 });
        sv.bob.push(orb);
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        shape(b, 'sphere', mat(i % 2 ? PALETTE.flowers.pastelPink : PALETTE.flowers.pastelYellow), { pos: [Math.cos(a) * 1.25, 0.2, Math.sin(a) * 1.25], scale: [0.16, 0.1, 0.16] });
      }
    } else if (m.type === 'droneHub') {
      // Drone Megahub: a cream dome hangar with a cyan landing ring, a gold mast and drones parked on the rim.
      shape(b, 'sphere', mat(PALETTE.shell), { pos: [0, 0.2, 0], scale: [1.7, 1.0, 1.7], shadow: true });
      shape(b, 'cylinder', mat(PALETTE.darkFace, { gloss: 0.6 }), { pos: [0, 0.72, 0], scale: [0.7, 0.03, 0.7] });
      const ring = shape(b, 'torus', mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.3 }), { pos: [0, 0.74, 0], scale: [0.9, 0.08, 0.9] });
      sv.spin.push(ring);
      shape(b, 'cylinder', mat(PALETTE.gold, { metal: 0.6, gloss: 0.75 }), { pos: [0.55, 1.2, -0.55], scale: [0.05, 1.2, 0.05] });
      const dish = group(b, 'dish', [0.55, 1.85, -0.55]);
      dish.setLocalEulerAngles(-35, 45, 0);
      shape(dish, 'cylinder', mat(PALETTE.white, { gloss: 0.7 }), { scale: [0.45, 0.04, 0.45] });
      sv.head = dish;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const d = shape(b, 'sphere', mat(PALETTE.white), { pos: [Math.cos(a) * 0.95, 0.55, Math.sin(a) * 0.95], scale: [0.18, 0.1, 0.18] });
        sv.bob.push(d);
      }
    }
  }

  private device(): pc.GraphicsDevice {
    return pc.AppBase.getApplication()!.graphicsDevice;
  }

  /** Phase 5 E14: a superstructure's stage changed: rebuild its model; on completion it unfolds. */
  superStage(m: MachineData, stage: number) {
    const old = this.views.get(m.id);
    old?.root.destroy();
    this.views.delete(m.id);
    this.add(m, false);
    const v = this.views.get(m.id)!;
    if (this.reducedMotion) return;
    if (stage >= 3) {
      v.body.setLocalScale(0.3, 0.05, 0.3);
      this.tweens.add(1.1, (k) => v.body.setLocalScale(0.3 + 0.7 * k, 0.05 + 0.95 * k, 0.3 + 0.7 * k), { ease: ease.outElastic });
    } else {
      v.root.setLocalScale(0.9, 0.9, 0.9);
      this.tweens.add(0.5, (k) => v.root.setLocalScale(0.9 + 0.1 * k, 0.9 + 0.1 * k, 0.9 + 0.1 * k), { ease: ease.outBack });
    }
  }

  /** Phase 5 E14: the ability fired: the model pulses (presentation only). */
  superPulse(id: string) {
    const v = this.views.get(id);
    if (!v || this.reducedMotion) return;
    this.tweens.add(0.6, (k) => {
      const p = 1 + 0.12 * Math.sin(k * Math.PI);
      v.body.setLocalScale(p, p, p);
    });
  }

  /** Removes a machine's model (merged away). With `to`, it flies into that point and shrinks first. */
  remove(id: string, to?: [number, number, number], delay = 0) {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    if (!to || this.reducedMotion) return void v.root.destroy();
    const from = v.root.getPosition().clone();
    this.tweens.add(
      0.42,
      (k) => {
        const h = Math.sin(k * Math.PI) * 0.8;
        v.root.setPosition(from.x + (to[0] - from.x) * k, from.y + (to[1] - from.y) * k + h, from.z + (to[2] - from.z) * k);
        const sc = 1 - k * 0.85;
        v.root.setLocalScale(sc, sc, sc);
      },
      { delay, ease: ease.inOutCubic, done: () => v.root.destroy() },
    );
  }

  /**
   * Phase 5 E13: the partners fly into the anchor, then the anchor is rebuilt as its new tier and bounces up
   * bigger. Returns the seconds until the new machine lands (for the sound and sparkles).
   */
  merged(anchor: MachineData, consumed: MachineData[]): number {
    const at = this.worldOf(anchor);
    consumed.forEach((c, i) => this.remove(c.id, at, i * 0.06));
    const old = this.views.get(anchor.id);
    const land = this.reducedMotion ? 0 : 0.5;
    const rebuild = () => {
      old?.root.destroy();
      this.views.delete(anchor.id);
      const m = this.sim.machine(anchor.id);
      if (!m) return;
      this.add(m, false);
      const v = this.views.get(anchor.id)!;
      if (this.reducedMotion) return;
      v.root.setLocalScale(0.4, 0.4, 0.4);
      this.tweens.add(0.7, (k) => {
        const sc = 0.4 + 0.6 * k;
        v.root.setLocalScale(sc, sc, sc);
      }, { ease: ease.outElastic ?? ease.outBack });
    };
    if (land) {
      old?.root && this.tweens.add(land, (k) => old.root.setLocalScale(1 + 0.25 * Math.sin(k * Math.PI * 3) * k, 1 - 0.2 * k, 1 + 0.25 * Math.sin(k * Math.PI * 3) * k), { done: rebuild });
      if (!old) rebuild();
    } else rebuild();
    return land;
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
    v.spin.push(tilt); // Phase 4 E09.3: the panel slowly tracks the sun
    v.light = shape(b, 'sphere', mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 1 }), { pos: [0.2, 0.12, 0.2], scale: 0.06 });
    if (v.m.starter) shape(b, 'box', mat(PALETTE.rust), { pos: [-0.18, 0.12, 0.16], scale: [0.12, 0.05, 0.1], rot: [0, 30, 0] });
  }

  private condenser(v: MachineView) {
    const b = v.body;
    shape(b, 'cylinder', mat(PALETTE.shell), { pos: [0, 0.08, 0], scale: [0.66, 0.16, 0.66], shadow: true });
    shape(b, 'cylinder', mat(PALETTE.white), { pos: [0, 0.32, 0], scale: [0.5, 0.36, 0.5], shadow: true });
    shape(b, 'torus', mat(PALETTE.gold, { metal: 0.6, gloss: 0.7 }), { pos: [0, 0.5, 0], scale: [0.85, 0.3, 0.85] });
    shape(b, 'sphere', mat(PALETTE.glass, { opacity: 0.45, gloss: 0.95 }), { pos: [0, 0.74, 0], scale: 0.5 });
    const water = shape(b, 'sphere', mat(PALETTE.water, { emissive: PALETTE.aqua.deep, emissiveIntensity: 0.4, gloss: 0.9 }), { pos: [0, 0.7, 0], scale: 0.3 });
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
      [0, 0.75, 0, 0.75, PALETTE.leaf.bright],
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
      const o = shape(canopy, 'sphere', mat(PALETTE.core.orbOff, { gloss: 0.6 }), { pos: [Math.cos(a) * 0.55, -0.22 + (i % 2) * 0.12, Math.sin(a) * 0.55], scale: 0.12 });
      v.orbs.push(o);
    }
    v.light = shape(b, 'sphere', mat(PALETTE.core.glow, { emissive: PALETTE.core.glow, emissiveIntensity: 1.2 }), { pos: [0, 0.24, 0.72], scale: 0.07 });
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
    v.coreMat = uniqueMat(PALETTE.core.steel, { gloss: 0.8, emissive: PALETTE.pure.black, emissiveIntensity: 1 });
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

  private landmarkKind(m: MachineData): string {
    const id = this.sim.areas.areaOf({ roofId: m.roofId, x: m.x, z: m.z });
    return id ? this.sim.areas.info(id).landmarkKind : '';
  }

  /** The park's dry fountain: a cracked stone basin that fills and sprays when it wakes. */
  private fountain(v: MachineView) {
    const b = v.body;
    v.coreBase = uniqueMat(PALETTE.core.base, { gloss: 0.25 });
    v.coreMat = uniqueMat(PALETTE.core.slate, { gloss: 0.8, emissive: PALETTE.pure.black, emissiveIntensity: 1 });
    shape(b, 'cylinder', v.coreBase, { pos: [0, 0.16, 0], scale: [1.8, 0.32, 1.8], shadow: true });
    shape(b, 'torus', v.coreBase, { pos: [0, 0.32, 0], scale: [1.8, 0.16, 1.8] });
    shape(b, 'cylinder', mat(PALETTE.core.deck), { pos: [0, 0.31, 0], scale: [1.6, 0.02, 1.6] });
    const water = shape(b, 'cylinder', mat(PALETTE.water, { gloss: 0.9, opacity: 0.85 }), { pos: [0, 0.2, 0], scale: [1.58, 0.02, 1.58] });
    water.enabled = false;
    v.water = water;
    shape(b, 'cylinder', v.coreBase, { pos: [0, 0.65, 0], scale: [0.22, 0.7, 0.22], shadow: true });
    shape(b, 'cylinder', v.coreBase, { pos: [0, 1.02, 0], scale: [0.7, 0.1, 0.7], shadow: true });
    const crystal = group(b, 'crystal', [0, 1.22, 0]);
    shape(crystal, 'sphere', v.coreMat, { scale: [0.22, 0.3, 0.22], shadow: true });
    v.spin.push(crystal);
    v.rings = [];
    for (let i = 0; i < 2; i++) {
      const r = shape(b, 'torus', mat(PALETTE.water, { emissive: PALETTE.water, emissiveIntensity: 1.2 }), { pos: [0, 1.1 + i * 0.3, 0], scale: [0.8 - i * 0.25, 0.06, 0.8 - i * 0.25] });
      r.enabled = false;
      v.rings.push(r);
    }
    shape(b, 'box', mat(PALETTE.crack), { pos: [0.55, 0.2, 0.6], scale: [0.03, 0.3, 0.03], rot: [0, 45, 14] });
  }

  /** The Reservoir's Old Cistern: a big round tank, dry and rusty until it wakes. */
  private cistern(v: MachineView) {
    const b = v.body;
    v.coreBase = uniqueMat(PALETTE.core.baseWarm, { gloss: 0.25 });
    v.coreMat = uniqueMat(PALETTE.core.slate, { gloss: 0.8, emissive: PALETTE.pure.black, emissiveIntensity: 1 });
    shape(b, 'cylinder', v.coreBase, { pos: [0, 0.45, 0], scale: [1.7, 0.9, 1.7], shadow: true });
    shape(b, 'torus', v.coreBase, { pos: [0, 0.9, 0], scale: [1.72, 0.14, 1.72] });
    for (let i = 0; i < 3; i++) shape(b, 'torus', mat(PALETTE.core.ring), { pos: [0, 0.2 + i * 0.25, 0], scale: [1.74, 0.05, 1.74] });
    shape(b, 'cylinder', mat(PALETTE.metal.drain), { pos: [0, 0.88, 0], scale: [1.5, 0.02, 1.5] });
    const water = shape(b, 'cylinder', mat(PALETTE.water, { gloss: 0.9, opacity: 0.85 }), { pos: [0, 0.3, 0], scale: [1.48, 0.02, 1.48] });
    water.enabled = false;
    v.water = water;
    // spout + pipe down to the roof
    shape(b, 'cylinder', mat(PALETTE.white), { pos: [0.95, 0.6, 0], scale: [0.14, 0.2, 0.14], rot: [0, 0, 90] });
    shape(b, 'box', mat(PALETTE.white), { pos: [1.02, 0.3, 0], scale: [0.1, 0.6, 0.1] });
    // gauge crystal: lights up when the cistern wakes
    const crystal = group(b, 'crystal', [0, 1.35, 0]);
    shape(crystal, 'sphere', v.coreMat, { scale: [0.3, 0.42, 0.3], shadow: true });
    v.spin.push(crystal);
    v.rings = [];
    for (let i = 0; i < 2; i++) {
      const r = shape(b, 'torus', mat(PALETTE.water, { emissive: PALETTE.water, emissiveIntensity: 1.2 }), { pos: [0, 1.2 + i * 0.4, 0], scale: [1.0 - i * 0.3, 0.08, 1.0 - i * 0.3] });
      r.enabled = false;
      v.rings.push(r);
    }
    shape(b, 'box', mat(PALETTE.crack), { pos: [0.6, 0.5, 0.62], scale: [0.03, 0.5, 0.03], rot: [0, 45, 14] });
  }

  /** The Canopy's Elder Tree: bare and dormant, with a charge ring of seed-lights around its roots. */
  private elderTree(v: MachineView) {
    const b = v.body;
    v.coreBase = uniqueMat(PALETTE.core.baseEarth, { gloss: 0.2 });
    v.coreMat = uniqueMat(PALETTE.core.moss, { gloss: 0.5, emissive: PALETTE.pure.black, emissiveIntensity: 1 });
    shape(b, 'cylinder', mat(PALETTE.core.plinth), { pos: [0, 0.08, 0], scale: [1.85, 0.16, 1.85], shadow: true });
    for (let i = 0; i < 4; i++)
      shape(b, 'cylinder', v.coreBase, { pos: [Math.sin(i * 1.3) * 0.08, 0.45 + i * 0.5, Math.cos(i * 1.3) * 0.08], scale: [0.62 - i * 0.1, 0.56, 0.62 - i * 0.1], rot: [5 - i * 3, i * 25, 6 - i * 4], shadow: true });
    for (let r = 0; r < 5; r++) {
      const a = r * 1.25;
      shape(b, 'capsule', v.coreBase, { pos: [Math.cos(a) * 0.5, 0.2, Math.sin(a) * 0.5], scale: [0.12, 0.26, 0.12], rot: [Math.sin(a) * 75, 0, Math.cos(a) * 75] });
    }
    const bare = group(b, 'bare', [0, 2.2, 0]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 360;
      const br = group(bare, 'branch');
      br.setLocalEulerAngles(0, a, 0);
      shape(br, 'cylinder', v.coreBase, { pos: [0.35, 0.25, 0], scale: [0.08, 0.8, 0.08], rot: [0, 0, -50], shadow: true });
      shape(br, 'cylinder', v.coreBase, { pos: [0.62, 0.62, 0], scale: [0.05, 0.4, 0.05], rot: [0, 0, -15] });
    }
    v.bare = bare;
    const canopy = group(b, 'canopy', [0, 2.45, 0]);
    const leaves: [number, number, number, number, string][] = [
      [0, 0.4, 0, 2.3, PALETTE.shrub[0]],
      [0.8, 0.0, 0.35, 1.5, PALETTE.shrub[1]],
      [-0.75, 0.1, -0.3, 1.6, PALETTE.shrub[2]],
      [0.2, 0.05, -0.85, 1.4, PALETTE.shrub[1]],
      [-0.35, 0.0, 0.8, 1.4, PALETTE.shrub[0]],
      [0, 1.1, 0, 1.3, PALETTE.leaf.bright],
    ];
    for (const [x, y, z, sz, c] of leaves) shape(canopy, 'sphere', mat(c), { pos: [x, y, z], scale: [sz, sz * 0.75, sz], shadow: true });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      shape(canopy, 'sphere', mat(PALETTE.flower[i % 5]), { pos: [Math.cos(a) * 1.1, 0.2 + (i % 3) * 0.3, Math.sin(a) * 1.1], scale: 0.16 });
    }
    canopy.setLocalScale(0.0001, 0.0001, 0.0001);
    canopy.enabled = false;
    v.canopy = canopy;
    // Charge ring: one seed-light per point of charge, around the roots (readable from any zoom).
    v.orbs = [];
    const n = TUNING.neighbourhood.canopy.threshold;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      v.orbs.push(shape(b, 'sphere', orbOff(), { pos: [Math.cos(a) * 0.86, 0.2, Math.sin(a) * 0.86], scale: 0.12 }));
    }
    v.rings = [];
    const crystal = group(b, 'crystal', [0, 1.4, 0]);
    shape(crystal, 'sphere', v.coreMat, { pos: [0, 0, 0.3], scale: [0.16, 0.2, 0.1] });
    v.spin.push(crystal);
  }

  /** Reservoir Garden: a white basin with a lily pad garden; its water level shows the Overflow fill. */
  private reservoirGarden(v: MachineView) {
    const b = v.body;
    shape(b, 'cylinder', mat(PALETTE.shell), { pos: [0, 0.14, 0], scale: [0.86, 0.28, 0.86], shadow: true });
    shape(b, 'torus', mat(PALETTE.white), { pos: [0, 0.28, 0], scale: [0.86, 0.1, 0.86] });
    v.water = shape(b, 'cylinder', mat(PALETTE.water, { gloss: 0.9, emissive: PALETTE.aqua.abyss, emissiveIntensity: 0.3 }), { pos: [0, 0.12, 0], scale: [0.74, 0.02, 0.74] });
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      v.bob.push(shape(b, 'cylinder', mat(PALETTE.leaf.mid), { pos: [Math.cos(a) * 0.2, 0.26, Math.sin(a) * 0.2], scale: [0.18, 0.015, 0.18] }));
    }
    shape(b, 'sphere', mat(PALETTE.flowers.blush), { pos: [0.18, 0.3, 0.05], scale: 0.07 });
    // little fountain spout
    shape(b, 'cylinder', mat(PALETTE.white), { pos: [0, 0.38, 0], scale: [0.08, 0.3, 0.08] });
    v.light = shape(b, 'sphere', mat(PALETTE.water, { emissive: PALETTE.water, emissiveIntensity: 1.4 }), { pos: [0, 0.56, 0], scale: 0.07 });
  }

  /** Bloom Relay: a slim white mast with a leafy dish and a glowing tip. */
  private relay(v: MachineView) {
    const b = v.body;
    shape(b, 'cylinder', mat(PALETTE.shell), { pos: [0, 0.06, 0], scale: [0.6, 0.12, 0.6], shadow: true });
    shape(b, 'cylinder', mat(PALETTE.white), { pos: [0, 0.6, 0], scale: [0.09, 1.0, 0.09], shadow: true });
    shape(b, 'torus', mat(PALETTE.leaf.mid), { pos: [0, 0.95, 0], scale: [0.42, 0.08, 0.42] });
    shape(b, 'cone', mat(PALETTE.white), { pos: [0, 1.12, 0], scale: [0.3, 0.16, 0.3] });
    v.light = shape(b, 'sphere', mat(PALETTE.glow.cyanPale, { emissive: PALETTE.glow.cyanPale, emissiveIntensity: 1.6 }), { pos: [0, 1.28, 0], scale: 0.1 });
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      v.bob.push(shape(b, 'sphere', mat(PALETTE.flower[i % PALETTE.flower.length]), { pos: [Math.cos(a) * 0.22, 0.16, Math.sin(a) * 0.22], scale: 0.07 }));
    }
  }

  /** Reservoir Overflow: the basin spills over with a splash. */
  splash(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    this.tweens.cancel(v.body);
    this.tweens.add(0.6, (k) => {
      const s = 1 + Math.sin(k * Math.PI) * 0.18;
      v.body.setLocalScale(s, 1 / s, s);
    }, { owner: v.body, ease: ease.linear, done: () => v.body.setLocalScale(1, 1, 1) });
  }

  /** Canopy Burst: the Elder Tree swells. */
  burstTree(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    const target = v.canopy?.enabled ? v.canopy : v.bare;
    if (!target) return;
    const base = target.getLocalScale().clone();
    this.tweens.add(0.9, (k) => {
      const s = 1 + Math.sin(k * Math.PI) * 0.2;
      target.setLocalScale(base.x * s, base.y * s, base.z * s);
    }, { ease: ease.linear, done: () => target.setLocalScale(base) });
  }

  /**
   * "World-as-upgrade-tree": upgrades visibly change machines' silhouettes (Phase 4 E09.6: every machine type).
   * Solar Array adds wing panels; Water Bloom adds tanks and a mist ring; Drone Dash antennas, Drone Squad
   * landing pads, Drone Sweep sweeper arms and Work Radius a taller mast and dish; Pollinator Reach and Rich Soil
   * more flowers; Mother Tree Resonance a wider canopy with gold lanterns; Relay Lens a lens ring on the mast.
   */
  applyUpgrades(v: MachineView) {
    const u = this.sim.upgrades;
    // Phase 5 E12: machine upgrades are per machine, so each machine shows its own levels (Rich Soil stays global).
    // Silhouette extras are capped so long-tail levels never pile up meshes.
    const L = (id: string) => Math.min(6, id === 'richSoil' ? u.level(id) : u.levelOf(v.m, id));
    const key =
      v.m.type === 'solar' ? `${L('solarArray')}`
      : v.m.type === 'droneHub' ? `${L('droneSpeed')}|${L('secondDrone')}|${L('droneSweep')}|${L('droneRadius')}`
      : v.m.type === 'pollinator' ? `${L('pollinatorReach')}|${L('richSoil')}`
      : v.m.type === 'condenser' ? `${L('waterBloom')}`
      : v.m.type === 'motherTree' ? `${L('treeResonance')}`
      : v.m.type === 'relay' ? `${L('relayLens')}`
      : '';
    if (key === v.vkey) return;
    v.vkey = key;
    v.level = Number(key.split('|')[0]) || 0;
    v.extras.destroy();
    v.extras = group(v.body, 'extras');
    // The old wing panels were just destroyed: keep only the base panel (Phase 4 E11: a second Solar Array level
    // used to leave destroyed panels in this list, and the next frame crashed on them).
    if (v.panel) v.panel = v.panel.slice(0, v.basePanels ?? 1);
    if (v.batched) this.tweens.add(0.01, () => {}, { done: () => this.views.get(v.m.id) === v && this.batch(v) }); // once the new extras exist
    const ex = v.extras;
    if (v.m.type === 'solar') {
      // Extra wing panels per Solar Array level: two rows of up to three, fanning out.
      const lvl = L('solarArray');
      for (let i = 0; i < lvl; i++) {
        const side = i % 2 ? -1 : 1;
        const row = Math.floor(i / 2);
        // Fanned out sideways along the panel's long edge (a wider array), not stacked upwards.
        const w = group(ex, 'wing', [side * (0.3 + row * 0.26), 0.42 + row * 0.02, side * (0.3 + row * 0.26) * -0.15]);
        w.setLocalEulerAngles(-28, 45, side * 8);
        shape(w, 'box', mat(PALETTE.white), { scale: [0.36, 0.04, 0.5], shadow: true });
        const c = shape(w, 'box', panelMat(), { pos: [0, 0.025, 0], scale: [0.31, 0.02, 0.44] });
        v.panel!.push(c);
      }
      if (lvl >= 4) shape(ex, 'cylinder', mat(PALETTE.gold, { metal: 0.6, gloss: 0.7 }), { pos: [0, 0.11, 0], scale: [0.56, 0.03, 0.56] });
    } else if (v.m.type === 'droneHub') {
      const dash = L('droneSpeed');
      for (let i = 0; i < dash; i++) {
        shape(ex, 'cylinder', mat(PALETTE.white), { pos: [-0.6 + 0.12 * (i + 1), 0.95 + i * 0.1, -0.6], scale: [0.02, 0.5 + i * 0.15, 0.02] });
        shape(ex, 'sphere', mat(PALETTE.leafFin), { pos: [-0.6, 0.8, -0.6 + 0.2 * (i + 1)], scale: [0.25, 0.06, 0.12], rot: [0, 30 * i, 20] });
      }
      // Drone Squad: a glowing landing pad per extra drone.
      // Phase 5 E12 raised Drone Squad to 4 levels (5 drones): a pad for each (the third level used to crash here).
      const pads: [number, number][] = [[0.62, 0.62], [0.62, -0.25], [-0.25, 0.62], [0.05, 0.05]];
      for (let i = 0; i < Math.min(pads.length, L('secondDrone')); i++) {
        const [x, z] = pads[i];
        shape(ex, 'cylinder', mat(PALETTE.shell), { pos: [x, 0.22, z], scale: [0.42, 0.06, 0.42], shadow: true });
        shape(ex, 'torus', mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1 }), { pos: [x, 0.26, z], scale: [0.36, 0.08, 0.36] });
      }
      // Drone Sweep: little sweeper arms with leafy brushes either side of the tower.
      for (let i = 0; i < L('droneSweep'); i++) {
        const arm = group(ex, 'sweep', [-0.6, 0.35 + i * 0.12, -0.6]);
        arm.setLocalEulerAngles(0, 45 + i * 90, 0);
        shape(arm, 'box', mat(PALETTE.white), { pos: [0.32, 0, 0], scale: [0.5, 0.04, 0.05] });
        shape(arm, 'sphere', mat(PALETTE.shrub[1]), { pos: [0.6, -0.04, 0], scale: [0.16, 0.1, 0.16] });
      }
      // Work Radius: a taller mast and a dish.
      const rad = L('droneRadius');
      if (rad > 0) {
        shape(ex, 'cylinder', mat(PALETTE.white), { pos: [-0.6, 1.2 + rad * 0.12, -0.6], scale: [0.025, 0.3 + rad * 0.25, 0.025] });
        const dish = group(ex, 'dish', [-0.6, 1.3 + rad * 0.25, -0.6]);
        dish.setLocalEulerAngles(-35, 45, 0);
        shape(dish, 'cylinder', mat(PALETTE.white, { gloss: 0.7 }), { scale: [0.2 + rad * 0.06, 0.03, 0.2 + rad * 0.06] });
      }
    } else if (v.m.type === 'pollinator') {
      const lvl = L('pollinatorReach');
      for (let i = 0; i < lvl * 4; i++) {
        const a = (i / (lvl * 4)) * Math.PI * 2;
        shape(ex, 'sphere', mat(PALETTE.flower[i % 5]), { pos: [Math.cos(a) * 0.46, 0.3, Math.sin(a) * 0.46], scale: 0.1 });
      }
      // Rich Soil: the bed spills over with taller blooms.
      for (let i = 0; i < Math.min(6, L('richSoil')); i++) {
        const a = i * 1.05 + 0.4;
        const h = 0.34 + (i % 3) * 0.06;
        shape(ex, 'cylinder', mat(PALETTE.stem), { pos: [Math.cos(a) * 0.3, 0.27 + h / 2, Math.sin(a) * 0.3], scale: [0.02, h, 0.02] });
        shape(ex, 'sphere', mat(i % 2 ? PALETTE.flowers.radiant[1] : PALETTE.flower[(i + 2) % 5]), { pos: [Math.cos(a) * 0.3, 0.27 + h, Math.sin(a) * 0.3], scale: [0.13, 0.09, 0.13] });
      }
    } else if (v.m.type === 'condenser') {
      // Water Bloom: an extra tank per level and a ring of mist beads.
      const lvl = L('waterBloom');
      for (let i = 0; i < lvl; i++) {
        const a = i * Math.PI + 0.8;
        shape(ex, 'cylinder', mat(PALETTE.white), { pos: [Math.cos(a) * 0.36, 0.22, Math.sin(a) * 0.36], scale: [0.18, 0.3, 0.18], shadow: true });
        shape(ex, 'sphere', mat(PALETTE.water, { emissive: PALETTE.aqua.deep, emissiveIntensity: 0.5, gloss: 0.9 }), { pos: [Math.cos(a) * 0.36, 0.42, Math.sin(a) * 0.36], scale: 0.14 });
      }
      if (lvl > 0)
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          shape(ex, 'sphere', mat(PALETTE.aqua.mist, { opacity: 0.7 }), { pos: [Math.cos(a) * 0.42, 0.95, Math.sin(a) * 0.42], scale: 0.05 });
        }
    } else if (v.m.type === 'motherTree') {
      // Resonance: a wider canopy and glowing gold lanterns.
      const lvl = L('treeResonance');
      if (lvl > 0 && v.canopy) {
        const c = group(ex, 'canopyPlus', [0, 1.55, 0]);
        for (let i = 0; i < 4 * lvl; i++) {
          const a = (i / (4 * lvl)) * Math.PI * 2;
          shape(c, 'sphere', mat(PALETTE.shrub[i % 3]), { pos: [Math.cos(a) * (0.75 + lvl * 0.1), 0.05 + (i % 2) * 0.2, Math.sin(a) * (0.75 + lvl * 0.1)], scale: [0.55, 0.42, 0.55], shadow: true });
        }
        for (let i = 0; i < 3 * lvl; i++) {
          const a = (i / (3 * lvl)) * Math.PI * 2 + 0.5;
          shape(c, 'sphere', mat(PALETTE.glow.amber, { emissive: PALETTE.glow.gold, emissiveIntensity: 1.2 }), { pos: [Math.cos(a) * 0.95, -0.35, Math.sin(a) * 0.95], scale: 0.09 });
        }
      }
    } else if (v.m.type === 'relay') {
      const lvl = L('relayLens');
      for (let i = 0; i < lvl; i++) shape(ex, 'torus', mat(PALETTE.glow.cyanPale, { emissive: PALETTE.glow.cyanPale, emissiveIntensity: 0.8, opacity: 0.8 }), { pos: [0, 1.02 + i * 0.12, 0], scale: [0.5 + i * 0.1, 0.05, 0.5 + i * 0.1] });
    }
  }

  refreshUpgrades() {
    for (const v of this.views.values()) this.applyUpgrades(v);
  }

  /** Core look: dormant / ready (pulsing gold) / awakened. */
  setCoreState(state: 'dormant' | 'ready' | 'awake', instant = false, roofId = GROUND) {
    const v = this.coreView(roofId);
    if (v) this.applyCoreState(v, state, instant);
  }

  /** A specific landmark (city areas have many Cores on one layer). */
  setLandmarkState(machineId: string, state: 'dormant' | 'ready' | 'awake', instant = false) {
    const v = this.views.get(machineId);
    if (v) this.applyCoreState(v, state, instant);
  }

  private applyCoreState(v: MachineView, state: 'dormant' | 'ready' | 'awake', instant: boolean) {
    if (!v.coreMat || !v.coreBase) return;
    if (v.root.tags.has('awake') && state !== 'awake') return;
    v.root.tags.remove('ready', 'awake', 'dormant');
    v.root.tags.add(state);
    if (state === 'awake' && (v.coreKind === 'cistern' || v.coreKind === 'fountain')) {
      const from = v.coreBase.diffuse.clone();
      this.tweens.add(instant ? 0.01 : 1.4, (k) => {
        v.coreBase!.diffuse = new pc.Color().lerp(from, color(PALETTE.white), k);
        v.coreBase!.update();
        v.coreMat!.emissive = new pc.Color().lerp(new pc.Color(0, 0, 0), color(PALETTE.water), k);
        v.coreMat!.update();
        if (v.water) {
          v.water.enabled = true;
          v.water.setLocalPosition(0, v.coreKind === 'fountain' ? 0.2 + 0.1 * k : 0.3 + 0.55 * k, 0);
        }
      });
      v.rings!.forEach((r) => (r.enabled = true));
      return;
    }
    if (state === 'awake' && v.coreKind === 'elder') {
      const from = v.coreBase.diffuse.clone();
      this.tweens.add(instant ? 0.01 : 1.6, (k) => {
        v.coreBase!.diffuse = new pc.Color().lerp(from, color(PALETTE.trunk), k);
        v.coreBase!.update();
      });
      const c = v.canopy!;
      c.enabled = true;
      this.tweens.add(instant ? 0.01 : 2.2, (k) => c.setLocalScale(Math.max(0.0001, k), Math.max(0.0001, k), Math.max(0.0001, k)), {
        delay: instant ? 0 : 0.4,
        ease: ease.outBack,
        done: () => {
          if (v.bare) v.bare.enabled = false;
        },
      });
      return;
    }
    if (state === 'awake') {
      const from = v.coreBase.diffuse.clone();
      const to = color(PALETTE.white);
      this.tweens.add(instant ? 0.01 : 1.2, (k) => {
        v.coreBase!.diffuse = new pc.Color().lerp(from, to, k);
        v.coreBase!.update();
        v.coreMat!.diffuse = new pc.Color().lerp(color(PALETTE.core.steel), color(PALETTE.coreGlow), k);
        v.coreMat!.emissive = new pc.Color().lerp(new pc.Color(0, 0, 0), color(PALETTE.coreGlow), k);
        v.coreMat!.emissiveIntensity = 1.2;
        v.coreMat!.update();
      });
      v.rings!.forEach((r) => (r.enabled = true));
    }
  }

  private coreView(roofId: string) {
    return [...this.views.values()].find((x) => x.m.type === 'core' && x.m.roofId === roofId);
  }

  /** World point above a Core (by roof, or a specific landmark machine id). */
  coreWorld(roofId = GROUND, machineId?: string): [number, number, number] | undefined {
    const v = machineId ? this.views.get(machineId) : this.coreView(roofId);
    if (!v) return undefined;
    const p = v.root.getPosition();
    return [p.x, p.y + 1.8, p.z];
  }

  /**
   * Animates the machines. With `view` (the visible ground rectangle), ground machines outside it are skipped:
   * a big city has thousands of machines and only a few hundred are ever on screen.
   */
  update(dt: number, view?: { x0: number; x1: number; z0: number; z1: number }) {
    this.time += dt;
    const t = this.time;
    const now = this.sim.time;
    const rm = this.reducedMotion;
    const M = 3;
    // Phase 5 E16: which machines really run (twice a second), and a shared budget of active wisps.
    this.runCheck -= dt;
    const recheck = this.runCheck <= 0;
    if (recheck) this.runCheck = 0.5;
    this.wispBudget = Math.min(this.wispsPerSecond, this.wispBudget + dt * this.wispsPerSecond);
    for (const v of this.views.values()) {
      if (view && v.m.roofId === GROUND && (v.m.x + v.m.size < view.x0 - M || v.m.x > view.x1 + M || v.m.z + v.m.size < view.z0 - M || v.m.z > view.z1 + M)) continue;
      if (recheck || v.running === undefined) v.running = machineRunning(this.sim, v.m);
      if (v.running && !rm && this.onWisp && !v.super && (v.wispAt ?? 0) <= t && this.wispBudget >= 1) {
        // seeded spacing per machine (2–4 s), so a field of panels doesn't sparkle in step
        v.wispAt = t + 2 + ((v.m.x * 31 + v.m.z * 17) % 20) / 10;
        if (v.m.type === 'solar' || v.m.type === 'condenser' || v.m.type === 'pollinator' || v.m.type === 'droneHub') {
          this.wispBudget -= 1;
          const p = v.root.getPosition();
          this.onWisp(v.m, new pc.Vec3(p.x, p.y + (v.m.type === 'condenser' ? 1.0 : 0.7) * ((v.m.tier ?? 1) > 1 ? 1.3 : 1), p.z));
        }
      }
      if (v.super) {
        const sv = v.super;
        if (!rm) {
          if (sv.head && v.m.type === 'solar') sv.head.setLocalEulerAngles(-35 + Math.sin(t * 0.25 + v.m.x) * 6, 45 + Math.sin(t * 0.18 + v.m.z) * 18, 0);
          if (sv.head && v.m.type === 'droneHub') sv.head.setLocalEulerAngles(-35, t * 25, 0);
          sv.spin.forEach((e, i) => e.setLocalEulerAngles(0, t * (30 + i * 15) * (i % 2 ? -1 : 1), 0));
          sv.bob.forEach((e, i) => {
            const p = e.getLocalPosition();
            e.setLocalPosition(p.x, p.y + Math.sin(t * 1.7 + i) * 0.002, p.z);
          });
        }
        continue;
      }
      if (v.crown && !rm) {
        v.crown.setLocalEulerAngles(0, t * 60, 0);
        v.crown.setLocalPosition(0, 1.0 + (v.m.size - 1) * 0.3 + Math.sin(t * 1.6 + v.m.x) * 0.06, 0);
      }
      switch (v.m.type) {
        case 'solar': {
          const boosted = v.m.boostUntil > now || this.sim.production.surgeActive();
          const m = boosted ? panelBoost() : panelMat();
          for (const p of v.panel!) if (p.render && p.render.material !== m) p.render.material = m;
          if (!rm && v.spin[0]) v.spin[0].setLocalEulerAngles(-28 + Math.sin(t * 0.25 + v.m.x) * 5, 45 + Math.sin(t * 0.18 + v.m.z) * 14, 0);
          const s = (v.running ? 0.05 : 0.04) + (boosted ? 0.025 * (1 + Math.sin(t * 10)) : v.running ? 0.01 * Math.sin(t * 2) : 0);
          v.light!.setLocalScale(s, s, s);
          break;
        }
        case 'condenser': {
          if (!rm && v.running) v.bob[0].setLocalPosition(0, 0.7 + Math.sin(t * 2 + v.root.getPosition().x) * 0.03, 0);
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
            const r = 0.55 + Math.sin(t * 0.7 + i) * 0.25 + this.sim.upgrades.pollinatorReach(v.m) * 0.15;
            bf.setLocalPosition(Math.cos(a) * r, 0.65 + Math.sin(t * 2.3 + i) * 0.15, Math.sin(a) * r);
            bf.setLocalEulerAngles(0, (-a * 180) / Math.PI, 0);
            const flap = Math.sin(t * 22 + i) * 55;
            for (const w of bf.children as pc.Entity[]) w.setLocalEulerAngles(0, 0, w.tags.has('L') ? flap : -flap);
          });
          break;
        }
        case 'droneHub': {
          // Phase 5 E16: the beacon blinks and the pad ring turns only while its drones are out working.
          const s = v.running ? 0.07 + 0.03 * Math.max(0, Math.sin(t * 4)) : 0.065 + 0.005 * Math.sin(t * 1.2);
          v.light!.setLocalScale(s, s, s);
          if (!rm && v.running) v.rings![0].setLocalEulerAngles(0, t * 30, 0);
          break;
        }
        case 'reservoirGarden': {
          const f = Math.min(1, (v.m.charge ?? 0) / TUNING.neighbourhood.reservoir.threshold);
          v.water!.setLocalPosition(0, 0.08 + 0.18 * f, 0);
          if (!rm) v.bob.forEach((p, i) => p.setLocalPosition(Math.cos(i * 2.1 + t * 0.3) * 0.2, 0.1 + 0.18 * f + 0.03, Math.sin(i * 2.1 + t * 0.3) * 0.2));
          const s = 0.06 + (f >= 1 ? 0.03 * (1 + Math.sin(t * 8)) : 0.01 * Math.sin(t * 2));
          v.light!.setLocalScale(s, s, s);
          break;
        }
        case 'core': {
          if (v.coreKind !== 'crystal') {
            this.updateRoofCore(v, t, rm);
            break;
          }
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

  private updateRoofCore(v: MachineView, t: number, rm: boolean) {
    const awake = v.root.tags.has('awake');
    const ready = v.root.tags.has('ready');
    if (v.coreKind === 'elder') {
      // Elder Tree charge ring: lit seeds = charge.
      const lit = Math.round(Math.min(1, (v.m.charge ?? 0) / TUNING.neighbourhood.canopy.threshold) * v.orbs!.length);
      v.orbs!.forEach((o, i) => {
        const on = i < lit;
        const want = on ? orbOn() : orbOff();
        if (o.render!.material !== want) o.render!.material = want;
        const sc = on ? 0.13 + (rm ? 0 : Math.sin(t * 4 + i) * 0.02) : 0.1;
        o.setLocalScale(sc, sc, sc);
      });
      if (!rm && v.canopy?.enabled && !this.tweens.has(v.canopy)) v.canopy.setLocalEulerAngles(Math.sin(t * 0.6) * 1.2, 0, Math.cos(t * 0.5) * 1.2);
    } else if (!rm) v.spin[0].setLocalEulerAngles(0, t * (awake ? 40 : 6), 0);
    if (ready && !awake) {
      v.coreMat!.emissive = color(PALETTE.gold);
      v.coreMat!.emissiveIntensity = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * 4));
      v.coreMat!.update();
    }
    if (awake && !rm)
      v.rings!.forEach((r, i) => {
        r.setLocalEulerAngles(0, t * (30 + i * 20), 0);
        r.setLocalPosition(0, 1.2 + i * 0.4 + Math.sin(t * 1.5 + i) * 0.08, 0);
      });
  }
}
