import * as pc from 'playcanvas';
import type { MachineData, MachineType } from '../core/types';
import { COMPOST } from '../data/compost';
import { CROP_SEEDLING, cropModels, CROPS, PLANTER, type CropId } from '../data/crops';
import { MODELS } from './Models';
import type { PlanterLook } from '../gameplay/FarmSystem';
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
const FARM_TYPES: MachineType[] = ['planter', 'compostBin', 'bioDigester'];
/** A model's size in metres (its render bounds, at scale 1). */
function modelSize(e: pc.Entity): { x: number; y: number; z: number } {
  let aabb: pc.BoundingBox | undefined;
  for (const r of e.findComponents('render') as pc.RenderComponent[])
    for (const mi of r.meshInstances) {
      if (!aabb) {
        aabb = new pc.BoundingBox();
        aabb.copy(mi.aabb);
      } else aabb.add(mi.aabb);
    }
  if (!aabb) return { x: 0.3, y: 0.3, z: 0.3 };
  const h = aabb.halfExtents;
  return { x: h.x * 2, y: h.y * 2, z: h.z * 2 };
}

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
    const models = lk.crop && MODELS?.has(cropModels(lk.crop)[0]) ? 1 : 0; // rebuild once the crop models load
    return `${lk.crop ?? ''}|${lk.stage}|${lk.wilting ? 1 : 0}|${st.trellis ? 1 : 0}|${st.flooded ? 1 : 0}|${st.fed ? 1 : 0}|${models}`;
  }

  private drop(id: string) {
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
    else this.buildDigester(root, m);
    this.views.set(id, { root, key });
  }

  /** E23.5.3: a bin's look changes with how full its heap is and whether fertiliser is ready; a digester's with its mood. */
  private machineKey(m: MachineData): string {
    if (m.type === 'bioDigester') return this.sim.compost.mood(m);
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
    if (this.buildModels(root, lk)) return;
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

  /**
   * E23.10's crop models (#466), when loaded: the shared seedling at the first stage, then the crop's own plant, smaller
   * while growing with its fruit or flower heads hidden, full size with them at ripe. As many plants as the soil
   * (0.72 × 0.48 m) holds at their real size. A thirsty bed droops. Returns false until the models are in.
   */
  private buildModels(root: pc.Entity, lk: PlanterLook): boolean {
    const names = cropModels(lk.crop as CropId);
    if (!MODELS || !names.every((n) => MODELS!.has(n)) || !MODELS.has(CROP_SEEDLING)) return false;
    const seedling = lk.stage <= 1;
    const name0 = seedling ? CROP_SEEDLING : names[0];
    const probe = MODELS.instantiate(name0);
    if (!probe) return false;
    const box = modelSize(probe);
    probe.destroy();
    const W = 0.72;
    const D = 0.48;
    const cols = Math.max(1, Math.min(3, Math.floor(W / Math.max(0.05, box.x))));
    const rows = Math.max(1, Math.min(2, Math.floor(D / Math.max(0.05, box.z))));
    const fit = Math.min(1, W / (cols * box.x), D / (rows * box.z)) * 0.95;
    // growing stages: 55% then 80% of full size; ripe: full size with fruit
    const grow = seedling ? 1 : lk.ripe ? 1 : lk.stage === 2 ? 0.55 : 0.8;
    const droop = lk.wilting ? 18 : 0;
    let i = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++, i++) {
        const e = MODELS.instantiate(seedling ? CROP_SEEDLING : names[i % names.length]);
        if (!e) continue;
        const x = (c + 0.5) * (W / cols) - W / 2;
        const z = (r + 0.5) * (D / rows) - D / 2;
        const p = group(root, 'plant', [x, SOIL, z]);
        p.addChild(e);
        const s = fit * grow;
        e.setLocalScale(s, s, s);
        p.setLocalEulerAngles(droop * (i % 2 ? 1 : -1), (i * 97) % 360, 0);
        if (!seedling && !lk.ripe) {
          const fruit = e.findByName('fruit') as pc.Entity | null;
          if (fruit) fruit.enabled = false;
        }
      }
    return true;
  }

  /** Per frame: picks up planters built or loaded since, and a bed's wilting turning on or off (checked twice a second). */
  update(dt: number) {
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
