import * as pc from 'playcanvas';
import type { MachineData, MachineType } from '../core/types';
import { COMPOST } from '../data/compost';
import { CROPS, PLANTER, type CropId } from '../data/crops';
import type { PlanterLook } from '../gameplay/FarmSystem';
import { EXTRA_TYPES, isExtra } from '../gameplay/FarmExtras';
import type { Sim } from '../gameplay/Sim';
import { mat, PALETTE } from './Materials';
import { SLAB_TOP } from './SceneBuilder';
import { group, shape } from './Shapes';

/** Soil height inside the planter-bed model at its game scale (metres above the ground). */
const SOIL = 0.37;
/** How tall each stage stands (sprout … ripe). */
const HEIGHT = [0, 0.12, 0.24, 0.34, 0.4];
/** Plants per bed, on a 3 × 2 grid inside the box. */
const SPOTS: [number, number][] = [
  [-0.26, -0.15],
  [0, -0.15],
  [0.26, -0.15],
  [-0.26, 0.15],
  [0, 0.15],
  [0.26, 0.15],
];

/** The farm machines whose live state is drawn here. */
const FARM_TYPES: MachineType[] = ['planter', 'compostBin', 'bioDigester', ...EXTRA_TYPES];

interface CropView {
  root: pc.Entity;
  key: string;
}

/**
 * E23.5.2: what grows in each planter, drawn from primitives on top of the planter-bed model: sprouts, then
 * leafy plants, then flowers, then fruit in the crop's own colour. A thirsty bed droops and dulls (show, don't
 * tell); a trellis stands behind the plants, a flooded bed shows water. Rebuilt only when a bed's look changes.
 */
export class CropVisuals {
  private views = new Map<string, CropView>();
  private since = 0;
  reducedMotion = false;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
  ) {
    sim.bus.on('planter.changed', ({ machineId }) => this.refresh(machineId));
    sim.bus.on('farm.machine', ({ machineId }) => this.refresh(machineId));
    sim.bus.on('machine.removed', ({ machine }) => this.drop(machine.id));
  }

  private worldOf(m: MachineData): [number, number, number] {
    const r = this.sim.grid.roof(m.roofId)!;
    return [r.origin[0] + m.x + 0.5, r.origin[1] + r.height + SLAB_TOP + this.sim.grid.groundOffset(m.roofId, m.x, m.z), r.origin[2] + m.z + 0.5];
  }

  private keyOf(lk: PlanterLook, m: MachineData): string {
    const st = this.sim.farm.bed(m);
    return `${lk.crop ?? ''}|${lk.stage}|${lk.wilting ? 1 : 0}|${st.trellis ? 1 : 0}|${st.flooded ? 1 : 0}|${st.fed ? 1 : 0}`;
  }

  private drop(id: string) {
    this.anims.delete(id);
    this.views.get(id)?.root.destroy();
    this.views.delete(id);
  }

  /** Rebuilds one farm machine's live look (a planter's crop, a bin's heap, a digester's glow) if it changed. */
  refresh(id: string) {
    const m = this.sim.machine(id);
    if (!m || !FARM_TYPES.includes(m.type)) return this.drop(id);
    const lk = m.type === 'planter' ? this.sim.farm.look(m) : undefined;
    const key = lk ? this.keyOf(lk, m) : this.machineKey(m);
    const v = this.views.get(id);
    if (v && v.key === key) return;
    this.drop(id);
    const root = group(this.parent, `crop-${id}`, this.worldOf(m));
    if (lk) this.build(root, m, lk);
    else if (m.type === 'compostBin') this.buildBin(root, m);
    else if (m.type === 'bioDigester') this.buildDigester(root, m);
    else this.buildExtra(root, m);
    this.views.set(id, { root, key });
  }

  /** E23.5.4: an extra's look changes with what is ready, and with its creature moving in or out (or flying). */
  private extraKey(m: MachineData): string {
    const x = this.sim.farmExtras;
    const st = x.st(m);
    if (m.type === 'beehive') return `${x.hiveSettled(m) ? 1 : 0}|${Math.min(1, Math.floor(st.ready ?? 0))}`;
    if (m.type === 'fishPond') return `${x.pondFilled(m) ? 1 : 0}`;
    if (m.type === 'orchard') return `${x.fruitReady(m) ? 1 : 0}|${x.overgrown(m) ? 1 : 0}|${(st.age ?? 0) >= 0.01 ? 1 : 0}`;
    if (m.type === 'mushroomLog') return `${(st.ready ?? 0) >= 1 ? 2 : x.logGrowing(m) ? 1 : 0}`;
    if (m.type === 'wormBin') return `${(st.fed ?? 0) > 0 ? 1 : 0}`;
    return `${x.creatureOut(m) ? 1 : 0}`;
  }

  /** Things that move every frame (bees, fish, bats, butterflies, a hedgehog shuffling), by machine id. */
  private anims = new Map<string, { e: pc.Entity; at: (t: number) => [number, number, number, number?] }[]>();
  private time = 0;

  private buildExtra(root: pc.Entity, m: MachineData) {
    const x = this.sim.farmExtras;
    const st = x.st(m);
    const seed = (m.x * 7 + m.z * 13) % 10;
    const list: { e: pc.Entity; at: (t: number) => [number, number, number, number?] }[] = [];
    this.anims.set(m.id, list);
    const anim = (e: pc.Entity, at: (t: number) => [number, number, number, number?]) => list.push({ e, at });
    switch (m.type) {
      case 'beehive': {
        if ((st.ready ?? 0) >= 1) shape(root, 'sphere', mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 0.2 }), { pos: [0, 0.16, 0.24], scale: [0.14, 0.08, 0.06] });
        if (x.hiveSettled(m))
          for (let i = 0; i < 4; i++) {
            const bee = shape(root, 'sphere', mat(PALETTE.gold), { scale: [0.055, 0.045, 0.07] });
            anim(bee, (t) => {
              const a = t * (1.2 + i * 0.3) + i * 1.7 + seed;
              return [Math.cos(a) * (0.35 + i * 0.08), 0.5 + Math.sin(a * 2.3) * 0.12, Math.sin(a) * (0.35 + i * 0.08)];
            });
          }
        return;
      }
      case 'fishPond': {
        if (!x.pondFilled(m)) return;
        shape(root, 'cylinder', mat(PALETTE.water, { gloss: 0.9, opacity: 0.8 }), { pos: [0, 0.07, 0], scale: [0.74, 0.01, 0.74] });
        for (let i = 0; i < 2; i++) {
          const fish = shape(root, 'sphere', mat(PALETTE.terracotta, { gloss: 0.6 }), { scale: [0.1, 0.03, 0.04] });
          anim(fish, (t) => {
            const a = t * 0.6 + i * Math.PI + seed;
            return [Math.cos(a) * 0.22, 0.06, Math.sin(a) * 0.22, (-a * 180) / Math.PI];
          });
        }
        return;
      }
      case 'orchard': {
        if (x.overgrown(m)) for (const [px, py, pz] of [[0.28, 0.98, 0.16], [-0.26, 1.02, 0.18], [0.05, 1.22, -0.2]] as const) shape(root, 'sphere', mat(PALETTE.shrubLeaf[0]), { pos: [px, py, pz], scale: 0.3 });
        if (x.fruitReady(m)) for (const [px, py, pz] of [[0.2, 0.8, 0.26], [-0.22, 0.9, 0.22], [0.1, 1.1, 0.28], [-0.05, 0.75, -0.3], [0.28, 1.0, -0.12]] as const) shape(root, 'sphere', mat(PALETTE.flowerCosmos[3]), { pos: [px, py, pz], scale: 0.07 });
        return;
      }
      case 'mushroomLog': {
        const up = (st.ready ?? 0) >= 1 ? 1 : x.logGrowing(m) ? 0.45 : 0;
        if (!up) return;
        for (const [px, pz] of [[-0.2, 0.08], [0.05, 0.12], [0.22, 0.06], [-0.05, -0.12]] as const) {
          shape(root, 'cylinder', mat(PALETTE.stoneCreamTop), { pos: [px, 0.28 + 0.06 * up, pz], scale: [0.04, 0.12 * up, 0.04] });
          shape(root, 'sphere', mat(PALETTE.terracotta), { pos: [px, 0.28 + 0.12 * up, pz], scale: [0.15 * up, 0.07 * up, 0.15 * up] });
        }
        return;
      }
      case 'wormBin': {
        if ((st.fed ?? 0) > 0) shape(root, 'box', mat(PALETTE.soilDark), { pos: [0, 0.445, 0.05], rot: [-12, 0, 0], scale: [0.5, 0.02, 0.3] });
        return;
      }
      case 'birdBox': {
        if (!x.creatureOut(m)) return;
        const bird = group(root, 'bird');
        bird.setLocalScale(1.4, 1.4, 1.4);
        shape(bird, 'sphere', mat(PALETTE.terracotta), { scale: [0.07, 0.06, 0.09] });
        shape(bird, 'sphere', mat(PALETTE.stoneCreamTop), { pos: [0, 0.04, 0.05], scale: 0.05 });
        shape(bird, 'cone', mat(PALETTE.gold), { pos: [0, 0.04, 0.09], rot: [90, 0, 0], scale: [0.02, 0.04, 0.02] });
        anim(bird, (t) => [0, 0.92 + Math.abs(Math.sin(t * 3 + seed)) * 0.02, 0.18, Math.sin(t * 0.7 + seed) * 40]);
        return;
      }
      case 'batBox': {
        if (!x.creatureOut(m)) return;
        for (let i = 0; i < 2; i++) {
          const bat = group(root, 'bat');
          shape(bat, 'sphere', mat(PALETTE.darkFace), { scale: [0.05, 0.04, 0.06] });
          for (const s of [-1, 1]) shape(bat, 'box', mat(PALETTE.darkFace), { pos: [s * 0.08, 0, 0], rot: [0, 0, s * 15], scale: [0.12, 0.01, 0.07] });
          anim(bat, (t) => {
            const a = t * (1.6 + i * 0.4) + i * 2 + seed;
            return [Math.cos(a) * 1.4, 1.6 + Math.sin(a * 1.7) * 0.25, Math.sin(a) * 1.4, (-a * 180) / Math.PI];
          });
        }
        return;
      }
      case 'hedgehogHouse': {
        if (!x.creatureOut(m)) return;
        const hog = group(root, 'hedgehog');
        hog.setLocalScale(1.3, 1.3, 1.3);
        shape(hog, 'sphere', mat(PALETTE.woodDead), { pos: [0, 0.06, 0], scale: [0.14, 0.1, 0.18] });
        shape(hog, 'cone', mat(PALETTE.stoneCreamTop), { pos: [0, 0.05, 0.11], rot: [90, 0, 0], scale: [0.05, 0.07, 0.05] });
        anim(hog, (t) => {
          const a = Math.sin(t * 0.25 + seed) * 0.9;
          return [0.42 * Math.cos(a), 0, 0.42 * Math.sin(a) + 0.1, 90 - (a * 180) / Math.PI];
        });
        return;
      }
      case 'butterflyGarden': {
        if (!x.creatureOut(m)) return;
        const colours = [PALETTE.flowerCosmos[0], PALETTE.flowerSunflower[0], PALETTE.flowerLavender[0]];
        for (let i = 0; i < 3; i++) {
          const fly = group(root, 'butterfly');
          for (const s of [-1, 1]) shape(fly, 'box', mat(colours[i], { emissive: colours[i], emissiveIntensity: 0.25 }), { pos: [s * 0.05, 0, 0], rot: [0, 0, s * 25], scale: [0.09, 0.006, 0.08] });
          anim(fly, (t) => {
            const a = t * (0.8 + i * 0.25) + i * 2.1 + seed;
            return [Math.cos(a) * 0.35, 0.35 + Math.abs(Math.sin(t * 6 + i)) * 0.08 + Math.sin(a * 2) * 0.06, Math.sin(a * 1.3) * 0.35, (-a * 180) / Math.PI];
          });
        }
        return;
      }
    }
  }

  /** E23.5.3: a bin's look changes with how full its heap is and whether fertiliser is ready; a digester's with its mood. */
  private machineKey(m: MachineData): string {
    if (m.type === 'bioDigester') return this.sim.compost.mood(m);
    if (isExtra(m.type)) return this.extraKey(m);
    const st = this.sim.compost.bin(m);
    const heap = Math.min(4, Math.ceil(((st.feed ?? 0) + (st.compost ?? 0) * COMPOST.perCompost) / 8));
    return `${heap}|${(st.fertiliser ?? 0) >= 1 ? 1 : 0}`;
  }

  /** The heap inside a compost bin (taller the fuller), and a little sack on top once fertiliser is ready. */
  private buildBin(root: pc.Entity, m: MachineData) {
    const st = this.sim.compost.bin(m);
    const amount = (st.feed ?? 0) + (st.compost ?? 0) * COMPOST.perCompost;
    const h = Math.min(0.42, 0.06 + (amount / COMPOST.feedCapacity) * 0.4);
    if (amount > 0) {
      shape(root, 'sphere', mat(PALETTE.soilDark), { pos: [0, 0.1 + h / 2, 0], scale: [0.62, h, 0.62] });
      // fresh clippings on top
      if ((st.feed ?? 0) > 0) for (const [x, z] of [[-0.12, 0.05], [0.1, -0.08], [0.02, 0.14]] as const) shape(root, 'cone', mat(PALETTE.leafFin), { pos: [x, 0.1 + h, z], rot: [70, x * 300, 0], scale: [0.08, 0.12, 0.04] });
    }
    if ((st.fertiliser ?? 0) >= 1) {
      // a tied sack of fertiliser leaning on the front, with a gold tie
      shape(root, 'sphere', mat(PALETTE.terracotta), { pos: [0.18, 0.72, 0.18], scale: [0.2, 0.24, 0.18], shadow: true });
      shape(root, 'cylinder', mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 0.25 }), { pos: [0.18, 0.84, 0.18], scale: [0.08, 0.03, 0.08] });
    }
  }

  /** The digester's window: dark when empty, a soft green glow while it runs, dim while fed and waiting. */
  private buildDigester(root: pc.Entity, m: MachineData) {
    const mood = this.sim.compost.mood(m);
    const glow = mood === 'running' ? mat(PALETTE.leafFin, { emissive: PALETTE.leafFin, emissiveIntensity: 1.4 }) : mood === 'idle' ? mat(PALETTE.leafFin, { emissive: PALETTE.leafFin, emissiveIntensity: 0.3 }) : mat(PALETTE.darkFace, { gloss: 0.7 });
    shape(root, 'cylinder', glow, { pos: [0, 0.34, 0.33], rot: [90, 0, 0], scale: [0.18, 0.02, 0.18] });
  }

  rebuildAll() {
    for (const id of [...this.views.keys()]) this.drop(id);
    for (const type of FARM_TYPES) for (const m of this.sim.machinesOfType(type)) this.refresh(m.id);
  }

  private build(root: pc.Entity, m: MachineData, lk: PlanterLook) {
    const st = this.sim.farm.bed(m);
    if (st.flooded) shape(root, 'box', mat(PALETTE.water, { gloss: 0.9, opacity: 0.55 }), { pos: [0, SOIL + 0.025, 0], scale: [0.74, 0.012, 0.5] });
    if (st.fed) shape(root, 'box', mat(PALETTE.soilDark), { pos: [0, SOIL + 0.012, 0], scale: [0.72, 0.01, 0.48] });
    if (st.trellis) {
      const wood = mat(PALETTE.woodPlank);
      for (const x of [-0.32, 0.32]) shape(root, 'cylinder', wood, { pos: [x, SOIL + 0.25, -0.24], scale: [0.025, 0.5, 0.025] });
      for (const y of [0.2, 0.36, 0.5]) shape(root, 'box', wood, { pos: [0, SOIL + y, -0.24], scale: [0.66, 0.018, 0.018] });
    }
    if (!lk.crop) return;
    const def = CROPS[lk.crop as CropId];
    const h = HEIGHT[lk.stage] ?? 0.1;
    // a thirsty bed droops and dulls
    const leaf = mat(lk.wilting ? PALETTE.bladeTip[0] : def.leaf, { gloss: 0.3 });
    const fruit = mat(def.fruit, { gloss: 0.5 });
    const droop = lk.wilting ? 22 : 0;
    for (let i = 0; i < SPOTS.length; i++) {
      const [x, z] = SPOTS[i];
      const p = group(root, 'plant', [x, SOIL, z]);
      p.setLocalEulerAngles(droop * (i % 2 ? 1 : -1), i * 47, 0);
      // leaves: two crossed cones that grow with the stage
      shape(p, 'cone', leaf, { pos: [0, h / 2, 0], scale: [0.08 + h * 0.45, h, 0.06 + h * 0.3] });
      shape(p, 'cone', leaf, { pos: [0, h / 2, 0], rot: [0, 90, 0], scale: [0.08 + h * 0.45, h * 0.85, 0.06 + h * 0.3] });
      if (lk.stage >= 3) {
        // flowers, then fruit at ripe
        const r = lk.ripe ? 0.1 : 0.045;
        shape(p, 'sphere', fruit, { pos: [0.02, h * (lk.ripe ? 0.75 : 1), 0], scale: r });
      }
    }
    if (lk.ripe && PLANTER.stages > 3) shape(root, 'box', mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 0.15 }), { pos: [0, SOIL - 0.02, 0.27], scale: [0.6, 0.012, 0.01] });
  }

  /** Per frame: picks up planters built or loaded since, and a bed's wilting turning on or off (checked twice a second). */
  update(dt: number) {
    // creatures and bees move every frame (still with reduced motion: they just hold their place)
    this.time += this.reducedMotion ? 0 : dt;
    for (const list of this.anims.values())
      for (const a of list) {
        const [x, y, z, yaw] = a.at(this.time);
        a.e.setLocalPosition(x, y, z);
        if (yaw !== undefined) a.e.setLocalEulerAngles(0, yaw, 0);
      }
    this.since += dt;
    if (this.since < 0.5) return;
    this.since = 0;
    const seen = new Set<string>();
    for (const type of FARM_TYPES)
      for (const m of this.sim.machinesOfType(type)) {
        seen.add(m.id);
        this.refresh(m.id);
      }
    for (const id of [...this.views.keys()]) if (!seen.has(id)) this.drop(id);
  }
}
