import * as pc from 'playcanvas';
import type { MachineData } from '../core/types';
import { GROUND } from '../core/GameState';
import { CHUNK } from '../core/Hash';
import { chunkKey } from '../core/Grid';
import type { Sim } from '../gameplay/Sim';
import { color, glow, mat, PALETTE, uniqueMat } from './Materials';
import { group, shape, vshape, type ShapeOpts } from './Shapes';
import { TUNING } from '../data/tuning';
import { SLAB_TOP } from './SceneBuilder';
import { ease, type Tweens } from './Tween';
import { foliageMaterial, FoliageBuilder, treeMesh } from './Foliage';
import { flowerGeo, leafyShrubGeo, type FlowerSpecies } from './Flora';
import { treeGeo } from './TreeGen';
import { machineRunning } from './FaunaPlan';
import { arcPath, ball, bezier, dome, latheAuto, matOf, part, rbox, rcyl, ring, setMat, tube } from './MachineParts';
import { cultivatorDock } from './CultivatorVisuals';
import { tankId } from '../gameplay/WaterPipes';
import { oldCityModel, MODELS } from './Models';

interface MachineView {
  /** E21.6: how full the Old City fountain may get (a trickle at tier 1) */
  fountainCap?: number;
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
  /** Mother Tree: the tree itself (the park's own tree geometry, swaying and see-through like every other tree) */
  tree?: pc.Entity;
  /** Reservoir: water surface inside the cistern / garden basin. */
  water?: pc.Entity;
  /** Elder Tree: the dormant bare branches (hidden once its canopy unfolds). */
  bare?: pc.Entity;
  /** Which Core model this is (decides how it wakes). */
  coreKind?: 'crystal' | 'cistern' | 'elder' | 'fountain';
  /** The fountain's dry / flowing parts (see `fountain`). */
  fountain?: FountainFx;
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
  /** E23.3.2: a wind turbine's rotor angle (degrees), turned by its output */
  turn?: number;
  /** Look 3.12 Core gazebo: the vines on its arch (dry while dormant), their leaf material, and the flowers */
  vines?: pc.Entity;
  vineMat?: pc.StandardMaterial;
  blooms?: pc.Entity;
  /** Look 3.19: the hand-built model standing in for the procedural body (when loaded) */
  model?: pc.Entity;
  /** Mother Tree: its procedural planter ring (the collar model replaces it), and how far the tree was raised to stand in the collar */
  planter?: pc.Entity;
  treeLift?: number;
}

/**
 * Look 3.19: which hand-built model draws each machine or landmark, and its scale (the models are full size; a
 * machine fits its footprint). Landmarks follow their area's landmark kind. No model: the procedural look stays
 * (solar panels, the Elder Tree and the authored landmarks).
 */
export const MACHINE_MODELS: Record<string, [string, number]> = {
  condenser: ['water-condenser', 0.85],
  pollinator: ['pollinator-garden', 0.55],
  droneHub: ['drone-hub', 1.0],
  reservoirGarden: ['reservoir-basin', 0.55],
  relay: ['bloom-relay', 0.72],
  // E21: the Storage Chest and the Reclaimer (data/oldcity MODEL_NAMES; a stand-in until the files land)
  chest: ['storage-chest', 1.0],
  reclaimer: ['reclaimer', 1.0],
};
/** The Mother Tree's collar model: its scale (the planter fits the procedural ring, radius 0.85) and planter top (model metres). */
const MotherCollar = { scale: 1.12, top: 0.84 };
const LANDMARK_MODELS: Record<string, [string, number]> = {
  fountain: ['dry-fountain', 0.56],
  lock: ['lock-gate', 0.62],
  cistern: ['old-cistern', 0.66],
  crystal: ['rooftop-core', 0.95],
  mast: ['signal-mast', 0.6],
  clock: ['clock-tower', 0.62],
  hall: ['market-hall', 0.46],
  // E21.4: the Old City's own landmarks (data/oldcity MODEL_NAMES; a stand-in until the files land)
  sealock: ['lock-gate', 0.62],
  greenhouse: ['great-greenhouse', 0.5],
  observatory: ['sky-observatory', 0.5],
  // the Spire's own tower (15 m on a 6 x 6 footprint) stands with #352's terraces; the landmark core shows it at half size
  spire: ['solar-spire', 0.5],
};

const orbOn = () => mat(PALETTE.orbLit, { emissive: PALETTE.coreGlow, emissiveIntensity: 1.6 });
const orbOff = () => mat(PALETTE.orbDark, { gloss: 0.6 });
/** E23.4.2: a pump's lamp, running and idle. */
const pumpOn = () => mat(PALETTE.water, { emissive: PALETTE.waterGlow, emissiveIntensity: 1.4 });
const pumpOff = () => mat(PALETTE.orbDark, { gloss: 0.6 });
/** E23.4.2.1: a reservoir tank's heights: its floor, its rim, and its gauge's span. */
const TANK = { floor: 0.14, top: 0.72, gauge0: 0.16, gauge1: 0.66 };
// matte enough to read navy while tilted toward the sun (glossy, it mirrored the sky and read white)
const panelMat = () => mat(PALETTE.panel, { gloss: 0.45, metal: 0 });
// boosted: the cells keep their blue with a warm glow (at 0.6 the gold washed them out to near white inside the cream frame)
const panelBoost = () => mat(PALETTE.panelGlint, { gloss: 0.5, emissive: PALETTE.panelBoostGlow, emissiveIntensity: 0.28 });

/**
 * Look 3.12 machine materials: warm cream ceramic bodies, brushed metal frames, gold trim, dark seams and vents,
 * glowing water. All cached (`mat()`), so machines keep merging into their region batches.
 */
const cream = () => mat(PALETTE.shell, { gloss: 0.45 });
const creamSeam = () => mat(PALETTE.shellLow, { gloss: 0.3 });
const metal = () => mat(PALETTE.machineMetal, { metal: 0.7, gloss: 0.62 });
const darkMetal = () => mat(PALETTE.facadeDark, { metal: 0.6, gloss: 0.5 });
const gold = () => mat(PALETTE.gold, { metal: 0.6, gloss: 0.75 });
const vent = () => mat(PALETTE.darkFace, { gloss: 0.5 });
const cable = () => mat(PALETTE.grille, { gloss: 0.4 });
const gridLine = () => mat(PALETTE.panelGrid, { metal: 0.4, gloss: 0.7 });
const glassMat = () => mat(PALETTE.glass, { opacity: 0.3, gloss: 0.95 });
const waterGlow = () => mat(PALETTE.water, { emissive: PALETTE.waterGlow, emissiveIntensity: 1.2, gloss: 0.9 });
const leafMat = (i = 0) => mat([PALETTE.shrub[1], PALETTE.leafFin, PALETTE.shrub[0]][i % 3], { gloss: 0.3 });
/** Unit stem / rod (diameter 1, height 1, centred): scale it like the 'cylinder' primitive. */
const rod = () => rcyl(0.5, -0.5, 0.5, 0, 0, 8);
/** Unit cone (diameter 1, height 1, base at -0.5). */
const coneMesh = () => latheAuto('cone', [[0, -0.5], [0.5, -0.5], [0.5, -0.5], [0, 0.5]], 12);

/** Little bolt heads (close-range detail). */
function bolts(parent: pc.Entity, pts: [number, number, number][], size = 0.03, m = darkMetal()) {
  for (const p of pts) part(parent, ball(3, 6), m, { pos: p, scale: [size, size * 0.6, size] });
}

/**
 * A solar panel in the reference's style: a chunky, rounded cream frame around a few large blue cells (the sheet is
 * returned: it swaps material when boosted), a silver cell grid, and small gold caps on the corners.
 */
function solarPanel(parent: pc.Entity, w: number, d: number, cols: number, rows: number, withCaps = true): pc.Entity {
  // the rim scales with the panel, so small upgrade panels keep the same chunky look
  const rim = Math.min(0.075, Math.min(w, d) * 0.11);
  part(parent, rbox(w, 0.06, d, rim * 0.6), cream(), { shadow: true });
  const iw = w - rim * 2, id = d - rim * 2;
  const cells = shape(parent, 'box', panelMat(), { pos: [0, 0.024, 0], scale: [iw, 0.02, id] });
  for (let i = 1; i < cols; i++) shape(parent, 'box', gridLine(), { pos: [-iw / 2 + (iw * i) / cols, 0.035, 0], scale: [0.012, 0.004, id] });
  for (let i = 1; i < rows; i++) shape(parent, 'box', gridLine(), { pos: [0, 0.035, -id / 2 + (id * i) / rows], scale: [iw, 0.004, 0.012] });
  if (withCaps) {
    const c = rim * 0.9;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      part(parent, rbox(c, 0.022, c, c * 0.3), gold(), { pos: [sx * (w / 2 - c / 2 - 0.004), 0.034, sz * (d / 2 - c / 2 - 0.004)] });
  }
  return cells;
}

/** The fountain's two looks: `dry` shows until it wakes, `wet` and `lush` after; `k` is how far it has woken (0–1). */
/** E21.6: the fountain's tier looks: how full a trickle is, and how much the lit and blooming looks glow and grow. */
const FOUNTAIN_LOOK = { trickle: 0.35, litHalo: 1.45, bloomHalo: 1.8, bloomBeds: 1.35, litGlow: 1.7, trimGlow: 0.35 };

interface FountainFx {
  k: number;
  trim: pc.StandardMaterial;
  dry: pc.Entity;
  wet: pc.Entity;
  lush: pc.Entity;
  falls: pc.Entity[];
  ripples: pc.Entity[];
  sparks: pc.Entity[];
  drops: pc.Entity[];
  halo: pc.Entity;
  /** with the hand-built dry model standing in: the procedural parts hidden until it wakes */
  hidden?: pc.Entity[];
}

// Fountain geometry (local units; the model sits on a 2×2 footprint, so radius 1 is the footprint's edge).
const FOUNTAIN = {
  /** basin water: its radius, and the surface height dry (hidden in the stone) and full. Fauna's koi pond matches. */
  waterR: 0.79,
  waterDry: 0.345,
  waterFull: 0.4,
  /** the two falls: from a bowl's rim (r0, y0) out and down to the water below (r1, y1) */
  falls: [
    { n: 10, r0: 0.5, y0: 0.87, r1: 0.6, y1: 0.4 },
    { n: 7, r0: 0.3, y0: 1.21, r1: 0.38, y1: 0.88 },
  ],
  sproutY: 1.4,
};

// Shared meshes the primitives can't give (thin rims, flared bowls, ribbons of falling water). Made once; the cache
// holds its own reference so the engine never frees one that a later fountain needs.
const fxMeshes = new Map<string, pc.Mesh>();
/** A fountain flower bed's planting: the park's own leafy shrubs and flowers, one mesh per corner variant. */
/**
 * The Mother Tree: a Radiant oak from the same generator as the park's trees (close-up detail: leaf clusters), larger
 * than any of them (two variants grown into one for a full crown), with flowers growing in its planter. `scale` is the oak's size, `crown` where its charge orbs
 * hang (height and radius, in the machine's space before the collar lift), `resonance` how much wider each level of
 * Mother Tree Resonance makes it.
 */
const MOTHER = { species: 'oak' as const, variant: 1, scale: 1.85, crown: [1.5, 1.05] as [number, number], resonance: 0.07 };

let motherMeshCache: pc.Mesh | undefined;
function motherMesh(device: pc.GraphicsDevice): pc.Mesh {
  if (motherMeshCache) return motherMeshCache;
  const fb = new FoliageBuilder();
  // Two oaks grown into one, turned apart: a fuller, rounder crown than any single park tree (the trunks overlap).
  fb.add(treeGeo(MOTHER.species, 4, MOTHER.variant, 2), 0, 0, 0, 0, 1);
  fb.add(treeGeo(MOTHER.species, 4, MOTHER.variant + 2, 2), 0, 0, 0, Math.PI * 0.9, 0.92);
  // A ring of flowers in the planter (scaled down with the tree: these sit at the soil, 0.2 up in tree space / scale).
  const kinds: FlowerSpecies[] = ['cosmos', 'daisy', 'lavender', 'wild', 'cosmos', 'daisy', 'wild', 'lavender'];
  const S = MOTHER.scale;
  kinds.forEach((k, i) => {
    const a = (i / kinds.length) * Math.PI * 2 + 0.2;
    const r = (0.5 + (i % 2) * 0.12) / S;
    fb.add(flowerGeo(k, i, true, i, 1), Math.cos(a) * r, 0.01 / S, Math.sin(a) * r, a * 2.3, 0.9 / S);
  });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 1.1;
    fb.add(leafyShrubGeo(i + 2, 1, i !== 1), (Math.cos(a) * 0.56) / S, 0, (Math.sin(a) * 0.56) / S, a, 0.5 / S);
  }
  motherMeshCache = fb.build(device)!;
  motherMeshCache.incRefCount(); // shared by every Mother Tree, kept for the session
  return motherMeshCache;
}

const bedMeshes = new Map<number, pc.Mesh>();
function bedMesh(device: pc.GraphicsDevice, c: number): pc.Mesh {
  let m = bedMeshes.get(c);
  if (!m) {
    const fb = new FoliageBuilder();
    fb.add(leafyShrubGeo(c, 1, true), 0.02, 0.04, -0.2, c * 1.9, 0.62);
    fb.add(leafyShrubGeo(c + 2, 1, c % 2 === 0), 0.04, 0.04, 0.2, c * 2.7 + 1, 0.54);
    const kinds: FlowerSpecies[] = ['cosmos', 'daisy', 'lavender', 'wild'];
    const spots: [number, number][] = [[-0.14, -0.3], [-0.16, -0.06], [-0.13, 0.12], [-0.15, 0.32], [0.16, 0], [0.14, 0.36], [0.15, -0.38]];
    spots.forEach(([x, z], i) => fb.add(flowerGeo(kinds[(i + c) % kinds.length], i + c, true, i, 1), x, 0.05, z, i * 1.7 + c, 0.95));
    m = fb.build(device)!;
    m.incRefCount();
    bedMeshes.set(c, m);
  }
  return m;
}

function fxMesh(device: pc.GraphicsDevice, key: string, make: () => pc.Geometry): pc.Mesh {
  let m = fxMeshes.get(key);
  if (!m) {
    m = pc.Mesh.fromGeometry(device, make());
    m.incRefCount();
    fxMeshes.set(key, m);
  }
  return m;
}

/** `n` ribbons of water arcing from a rim (radius r0, at y = 0) out to radius r1 and down by `drop`. */
function fallsGeometry(n: number, r0: number, r1: number, drop: number): pc.Geometry {
  const S = 5;
  const half = (Math.PI / n) * 0.55;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const base = positions.length / 3;
    for (let j = 0; j <= S; j++) {
      const u = j / S;
      const r = r0 + (r1 - r0) * Math.sqrt(u);
      // the ribbon narrows a little as it falls
      const w = half * (1 - 0.3 * u);
      for (const side of [-1, 1]) {
        positions.push(Math.cos(a + side * w) * r, -drop * u * u, Math.sin(a + side * w) * r);
        normals.push(Math.cos(a) * 0.9, 0.44, Math.sin(a) * 0.9);
      }
      if (j < S) indices.push(base + j * 2, base + j * 2 + 1, base + j * 2 + 2, base + j * 2 + 1, base + j * 2 + 3, base + j * 2 + 2);
    }
  }
  const g = new pc.Geometry();
  g.positions = positions;
  g.normals = normals;
  g.indices = indices;
  return g;
}

function meshShape(parent: pc.Entity, mesh: pc.Mesh, material: pc.Material, o: ShapeOpts = {}): pc.Entity {
  const e = new pc.Entity(o.name ?? 'mesh');
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: o.shadow ?? false, receiveShadows: o.receive ?? true });
  if (o.pos) e.setLocalPosition(o.pos[0], o.pos[1], o.pos[2]);
  if (o.scale !== undefined) {
    if (typeof o.scale === 'number') e.setLocalScale(o.scale, o.scale, o.scale);
    else e.setLocalScale(o.scale[0], o.scale[1], o.scale[2]);
  }
  if (o.rot) e.setLocalEulerAngles(o.rot[0], o.rot[1], o.rot[2]);
  parent.addChild(e);
  return e;
}

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
    if (!this.batcher || m.roofId !== GROUND) return undefined;
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
      if (skip.has(e) || !e.enabled) return; // Look 3.19: procedural parts hidden under a model stay out
      if (e.render && e.render.batchGroupId !== id) e.render.batchGroupId = id;
      for (const c of e.children) walk(c as pc.Entity);
    };
    walk(v.root);
  }

  worldOf(m: MachineData): [number, number, number] {
    const r = this.sim.grid.roof(m.roofId)!;
    // E21.24: a machine stands on its terrace
    return [r.origin[0] + m.x + m.size / 2, r.origin[1] + r.height + SLAB_TOP + this.sim.grid.groundOffset(m.roofId, m.x, m.z), r.origin[2] + m.z + m.size / 2];
  }

  view(id: string) {
    return this.views.get(id);
  }

  buildAll() {
    if (this.streaming) return; // models are built when the view reaches them (see `stream`)
    for (const m of this.sim.state.machines) this.add(m, false);
  }

  /**
   * City 07 (#8): in the city, machines only have models near the view. A machine's model is about 50
   * entities, so a 1,000-area city (5,000 machines) held 250,000 entities, 2 GB of heap and every landmark's draw
   * calls for ground the player wasn't looking at. Models are built a chunk at a time as the view approaches
   * (nearest first, a few milliseconds per frame) and dropped once it has moved well away.
   */
  streaming = false;
  /** The look a landmark should have when its model streams in (the area's state lives in the simulation). */
  landmarkState?: (m: MachineData) => 'dormant' | 'ready' | 'awake';
  /** Tiles beyond the view where models are built, and the wider band where existing ones are kept. */
  static readonly STREAM_MARGIN = 20;
  static readonly STREAM_KEEP = 44;
  static readonly STREAM_MS = 3;
  private streamKey = '';
  private streamQueue: string[] = [];
  private streamed = false;

  get loadedCount() {
    return this.views.size;
  }

  /** Regions whose machines all have models and have joined their batch. */
  private regionsLoaded = new Set<string>();
  /** The region being built: its machines still to do, and the models built so far (not yet batched). */
  private regionJob?: { key: string; todo: MachineData[]; built: MachineView[] };
  private deferBatch = false;

  /**
   * Machines stream a whole batch region (64×64 tiles) at a time, and a region's models join its batch together,
   * once, when the last one is built. Adding them a chunk at a time made the engine regenerate the region's batches
   * (vertex data, a material clone and a shader per batch) on almost every frame of a pan: 28 ms a frame.
   */
  private stream(view: { x0: number; x1: number; z0: number; z1: number }) {
    const R = MachineVisuals.BATCH_REGION;
    const A = MachineVisuals.STREAM_MARGIN;
    const K = MachineVisuals.STREAM_KEEP;
    const span = (m: number) => [Math.floor((view.x0 - m) / R), Math.floor((view.x1 + m) / R), Math.floor((view.z0 - m) / R), Math.floor((view.z1 + m) / R)];
    const [ax0, ax1, az0, az1] = span(A);
    const [kx0, kx1, kz0, kz1] = span(K);
    const key = `${ax0}|${ax1}|${az0}|${az1}|${kx0}|${kx1}|${kz0}|${kz1}`;
    if (key !== this.streamKey) {
      this.streamKey = key;
      const kept = (rx: number, rz: number) => rx >= kx0 && rx <= kx1 && rz >= kz0 && rz <= kz1;
      // Drop whole regions the view has left well behind (their batch empties in one go).
      for (const [id, v] of this.views) {
        const m = v.m;
        let out: boolean;
        if (m.roofId === GROUND) out = !kept(Math.floor(m.x / R), Math.floor(m.z / R));
        else {
          const [x, , z] = this.worldOf(m);
          out = x < view.x0 - K || x > view.x1 + K || z < view.z0 - K || z > view.z1 + K;
        }
        if (out) {
          v.root.destroy();
          this.views.delete(id);
        }
      }
      for (const k of this.regionsLoaded) {
        const [rx, rz] = k.split(':').map(Number);
        if (!kept(rx, rz)) this.regionsLoaded.delete(k);
      }
      if (this.regionJob) {
        const [rx, rz] = this.regionJob.key.split(':').map(Number);
        if (!kept(rx, rz)) this.regionJob = undefined; // the camera left before it finished
      }
      // machines on rooftop clusters (few, never batched, and not in the ground's chunk index by world position)
      for (const m of this.sim.state.machines) {
        if (m.roofId === GROUND || this.views.has(m.id)) continue;
        const [x, , z] = this.worldOf(m);
        if (x >= view.x0 - A && x <= view.x1 + A && z >= view.z0 - A && z <= view.z1 + A) this.streamIn(m);
      }
      const mx = (view.x0 + view.x1) / 2 / R - 0.5;
      const mz = (view.z0 + view.z1) / 2 / R - 0.5;
      const todo: { key: string; d: number }[] = [];
      for (let rz = az0; rz <= az1; rz++)
        for (let rx = ax0; rx <= ax1; rx++) {
          const k = `${rx}:${rz}`;
          if (!this.regionsLoaded.has(k) && this.regionJob?.key !== k) todo.push({ key: k, d: Math.hypot(rx - mx, rz - mz) });
        }
      todo.sort((a, b) => a.d - b.d);
      this.streamQueue = todo.map((t) => t.key);
    }
    // The first pass (a load) builds everything in view at once; after that, within a small budget per frame.
    const t0 = performance.now();
    for (;;) {
      if (!this.regionJob) {
        const k = this.streamQueue.shift();
        if (k === undefined) break;
        this.regionJob = { key: k, todo: this.regionMachines(k), built: [] };
      }
      const job = this.regionJob;
      while (job.todo.length) {
        const m = job.todo.pop()!;
        if (this.views.has(m.id)) continue;
        this.deferBatch = true;
        this.streamIn(m);
        this.deferBatch = false;
        const v = this.views.get(m.id);
        if (v) job.built.push(v);
        if (this.streamed && performance.now() - t0 > MachineVisuals.STREAM_MS) break;
      }
      if (job.todo.length) break; // out of time: carries on next frame
      for (const v of job.built) if (this.views.get(v.m.id) === v) this.batch(v); // the region batches once
      this.regionsLoaded.add(job.key);
      this.regionJob = undefined;
      if (this.streamed && performance.now() - t0 > MachineVisuals.STREAM_MS) break;
    }
    this.streamed = true;
  }

  /** Ground machines standing in a batch region (by their origin tile, as `batchGroupFor` groups them). */
  private regionMachines(key: string): MachineData[] {
    const R = MachineVisuals.BATCH_REGION;
    const [rx, rz] = key.split(':').map(Number);
    const out: MachineData[] = [];
    const per = R / CHUNK;
    for (let cz = rz * per; cz < (rz + 1) * per; cz++)
      for (let cx = rx * per; cx < (rx + 1) * per; cx++)
        for (const m of this.sim.grid.machinesInChunk(chunkKey(GROUND, cx, cz)))
          if (Math.floor(m.x / R) === rx && Math.floor(m.z / R) === rz && !out.includes(m)) out.push(m);
    return out;
  }

  private streamIn(m: MachineData) {
    this.add(m, false);
    const v = this.views.get(m.id);
    if (!v || m.type !== 'core') return;
    const state = this.landmarkState?.(m) ?? 'dormant';
    if (state !== 'dormant') this.applyCoreState(v, state, true);
  }

  /** Look 3.19: rebuild every machine (the hand-built models have loaded). */
  rebuildAll() {
    // landmarks keep their state (a fountain that already flows must not come back as its dry model)
    const states = new Map<string, 'ready' | 'awake'>();
    const loaded: MachineData[] = [];
    for (const [id, v] of this.views) {
      if (v.root.tags.has('awake')) states.set(id, 'awake');
      else if (v.root.tags.has('ready')) states.set(id, 'ready');
      loaded.push(v.m);
      v.root.destroy();
    }
    this.views.clear();
    for (const m of loaded) this.add(m, false); // only the models that exist (in the city, those near the view)
    for (const [id, state] of states) this.setLandmarkState(id, state, true);
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
        else if (kind === 'fountain') lk === 'lock' ? this.basin(v) : this.fountain(v);
        else this.core(v);
        break;
      }
      case 'reservoirGarden':
        this.reservoirGarden(v);
        break;
      case 'relay':
        this.relay(v);
        break;
      case 'cultivator': // Look 6.9: the dock (its tillers are drawn by CultivatorVisuals)
        cultivatorDock(v.body);
        break;
      case 'reservoir': // E23.4.2.1
        this.waterTank(v);
        break;
      case 'pump': // E23.4.2.2
        this.pump(v);
        break;
    }
    this.applyModel(v);
    if ((m.tier ?? 1) >= 2) this.tier2(v);
    this.views.set(m.id, v);
    this.applyUpgrades(v);
    if (animate) {
      this.playBuild(v);
      this.tweens.add(1.4, () => {}, { done: () => this.views.get(m.id) === v && this.batch(v) });
    } else if (!this.deferBatch) this.batch(v);
  }

  /**
   * Phase 5 E13: a tier-2 machine reads bigger and richer: its body grows, a gold-trimmed cream plinth sits under
   * it and a gem in its family colour floats above (solar gold, water cyan, garden pink, drone mint).
   */
  private tier2(v: MachineView) {
    const s = v.m.size;
    v.body.setLocalScale(1.16, 1.16, 1.16);
    const gem = { solar: PALETTE.gemSolar, condenser: PALETTE.gemWater, pollinator: PALETTE.gemGarden, droneHub: PALETTE.gemDrone }[v.m.type as string] ?? PALETTE.gemSolar;
    part(v.root, rcyl(s * 0.49, 0, 0.06, 0.02, 0.005, 24), cream(), { shadow: true });
    part(v.root, ring(32, 6), gold(), { pos: [0, 0.06, 0], scale: [s * 1.0, 0.06, s * 1.0] });
    // Family touches that make the three-in-one readable.
    const tilt = v.spin[0];
    if (v.m.type === 'solar' && tilt) {
      for (const side of [-1, 1]) {
        const wing = group(tilt, 'wing', [side * 0.68, 0.02, 0]);
        wing.setLocalEulerAngles(0, 0, side * 14);
        part(wing, rbox(0.06, 0.03, 0.2, 0.01), darkMetal(), { pos: [-side * 0.25, -0.01, 0] });
        v.panel?.push(solarPanel(wing, 0.46, 0.62, 3, 4, false));
      }
      v.basePanels = v.panel?.length;
    } else if (v.m.type === 'condenser') {
      // twin glass columns of water, piped into the lid (right and back of the tank)
      for (const a of [-Math.PI / 4, (5 * Math.PI) / 4]) {
        const col = group(v.body, 'column', [Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42]);
        col.setLocalEulerAngles(0, (-a * 180) / Math.PI, 0);
        part(col, rcyl(0.1, 0, 0.1, 0.02, 0.005, 14), cream(), { shadow: true });
        part(col, rcyl(0.06, 0.1, 0.62, 0.02, 0, 12), waterGlow(), {});
        part(col, rcyl(0.075, 0.1, 0.64, 0, 0, 14), glassMat(), {});
        part(col, rcyl(0.09, 0.62, 0.7, 0.02, 0.01, 14), metal(), { shadow: true });
        part(col, tube('t2pipe', bezier([0, 0.7, 0], [0, 0.98, 0], [-0.3, 0.93, 0], 6), 0.02, { sides: 6 }), metal(), {});
      }
    } else if (v.m.type === 'pollinator') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        part(v.body, ball(5, 8), mat(i % 2 ? PALETTE.bloomPink : PALETTE.bloomCream), { pos: [Math.cos(a) * 0.42, 0.16, Math.sin(a) * 0.42], scale: [0.16, 0.1, 0.16] });
      }
    } else if (v.m.type === 'droneHub') {
      part(v.body, rcyl(0.13, 0.15, 0.85, 0.04, 0.01, 16), cream(), { pos: [0.6, 0, 0.6], shadow: true });
      part(v.body, rcyl(0.135, 0.5, 0.515, 0.004, 0.004, 16), creamSeam(), { pos: [0.6, 0, 0.6] });
      part(v.body, ring(20, 5), mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.2 }), { pos: [0.6, 0.86, 0.6], scale: [0.4, 0.08, 0.4] });
    }
    const crown = group(v.root, 'crown', [0, 1.15 + (s - 1) * 0.3, 0]);
    part(crown, ball(6, 8), mat(gem, { emissive: gem, emissiveIntensity: 1.3, gloss: 0.9 }), { pos: [0, 0, 0], scale: [0.16, 0.22, 0.16] });
    part(crown, ring(20, 5), gold(), { pos: [0, 0, 0], scale: [0.3, 0.05, 0.3] });
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
    part(v.root, rcyl(s * 0.48, 0, 0.12, 0.035, 0.01, 32), cream(), { shadow: true });
    part(v.root, rcyl(s * 0.482, 0.05, 0.064, 0.005, 0.005, 32), creamSeam(), {});
    part(v.root, ring(36, 6), gold(), { pos: [0, 0.12, 0], scale: [s * 0.97, 0.08, s * 0.97] });
    if (stage < 3) {
      const sc = group(v.root, 'scaffold');
      const h = stage === 1 ? 0.9 : 1.8;
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) shape(sc, 'box', mat(PALETTE.scaffold), { pos: [x * s * 0.42, h / 2, z * s * 0.42], scale: [0.06, h, 0.06], shadow: true });
      for (const y of stage === 1 ? [0.5] : [0.6, 1.4]) for (const [x, z, rx] of [[0, -1, 0], [0, 1, 0], [-1, 0, 90], [1, 0, 90]]) shape(sc, 'box', mat(PALETTE.scaffoldRail), { pos: [x * s * 0.42, y, z * s * 0.42], scale: [s * 0.84, 0.05, 0.05], rot: [0, rx, 0] });
      sv.scaffold = sc;
      if (stage === 1) return; // just the foundation
      b.setLocalScale(0.62, 0.62, 0.62);
    }
    if (m.type === 'solar') {
      // Solar Megaflower: a giant sunflower whose petals are solar panels, its gold face tracking the sun.
      part(b, latheAuto('megaStem', [[0.13, 0.1], [0.1, 0.3], [0.085, 1.0], [0.07, 1.6]], 12), cream(), { shadow: true });
      for (const y of [0.45, 1.1]) part(b, rcyl(0.11, y, y + 0.04, 0.012, 0.012, 12), gold(), {});
      for (const side of [-1, 1]) part(b, ball(5, 10), mat(PALETTE.leafFin), { pos: [side * 0.32, 0.7, 0], scale: [0.5, 0.08, 0.24], rot: [0, 0, side * -25], shadow: true });
      const head = group(b, 'head', [0, 1.65, 0]);
      head.setLocalEulerAngles(35, 45, 0);
      part(head, rcyl(0.36, -0.07, 0.07, 0.03, 0.03, 24), mat(PALETTE.gold, { metal: 0.5, gloss: 0.8, emissive: PALETTE.sunflowerGlow, emissiveIntensity: 0.25 }), { shadow: true });
      part(head, dome(0.25, 0.05, 0.07, 20), mat(PALETTE.seedFace), {});
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * 360;
        const pet = group(head, 'petal');
        pet.setLocalEulerAngles(0, a, 0);
        const tilt = group(pet, 'tilt', [0.67, 0.0, 0]);
        tilt.setLocalEulerAngles(0, 0, -8);
        sv.glow.push(solarPanel(tilt, 0.62, 0.3, 3, 1, false));
      }
      sv.head = head;
    } else if (m.type === 'condenser') {
      // Water Nexus: a cream tower under a glass dome full of swirling water, rings of cyan around it.
      part(b, rcyl(0.5, 0.1, 1.0, 0.06, 0.01, 28), cream(), { shadow: true });
      part(b, rcyl(0.505, 0.5, 0.515, 0.004, 0.004, 28), creamSeam(), {});
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.26;
        part(b, rbox(0.03, 0.22, 0.08, 0.012), vent(), { pos: [Math.cos(a) * 0.5, 0.3, Math.sin(a) * 0.5], rot: [0, (-a * 180) / Math.PI, 0] });
      }
      part(b, ring(32, 6), gold(), { pos: [0, 1.0, 0], scale: [1.08, 0.18, 1.08] });
      part(b, ball(12, 16), glassMat(), { pos: [0, 1.45, 0], scale: 1.0 });
      const water = part(b, ball(9, 12), waterGlow(), { pos: [0, 1.4, 0], scale: 0.62 });
      sv.bob.push(water);
      part(b, dome(0.14, 0.08, 1.93, 14), metal(), {});
      for (let i = 0; i < 3; i++) {
        const r = part(b, ring(32, 5, 0.12), mat(PALETTE.water, { emissive: PALETTE.water, emissiveIntensity: 1.1 }), { pos: [0, 0.4 + i * 0.32, 0], scale: [1.35 + i * 0.1, 0.05, 1.35 + i * 0.1] });
        sv.spin.push(r);
      }
      for (const [x, z] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]) {
        part(b, rcyl(0.09, 0.1, 0.6, 0.03, 0.01, 12), cream(), { pos: [x, 0, z], shadow: true });
        part(b, ball(5, 8), waterGlow(), { pos: [x, 0.64, z], scale: 0.1 });
      }
    } else if (m.type === 'pollinator') {
      // Tree of Life: a towering radiant tree (real foliage: it sways and turns see-through over the cursor).
      part(b, rcyl(s * 0.41, 0.13, 0.17, 0.01, 0, 28), mat(PALETTE.soil), {});
      const tree = new pc.Entity('treeOfLife');
      tree.addComponent('render', { meshInstances: [new pc.MeshInstance(treeMesh(this.device(), treeGeo('oak', 4, 1, 1)), foliageMaterial())], castShadows: true, receiveShadows: true });
      tree.setLocalPosition(0, 0.12, 0);
      tree.setLocalScale(2.5, 2.5, 2.5);
      b.addChild(tree);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const orb = part(b, ball(5, 8), mat(PALETTE.treeOrb, { emissive: PALETTE.lanternGlow, emissiveIntensity: 1.4 }), { pos: [Math.cos(a) * 1.2, 1.6 + (i % 3) * 0.5, Math.sin(a) * 1.2], scale: 0.1 });
        sv.bob.push(orb);
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        part(b, ball(4, 8), mat(i % 2 ? PALETTE.bloomPink : PALETTE.bloomCream), { pos: [Math.cos(a) * 1.25, 0.2, Math.sin(a) * 1.25], scale: [0.16, 0.1, 0.16] });
      }
    } else if (m.type === 'droneHub') {
      // Drone Megahub: a cream dome hangar with a cyan landing ring, a gold mast and drones parked on the rim.
      part(b, dome(0.85, 0.55, 0.12, 28), cream(), { shadow: true });
      part(b, rcyl(0.86, 0.12, 0.2, 0.02, 0.01, 28), creamSeam(), {});
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        part(b, rbox(0.02, 0.05, 0.18, 0.006), creamSeam(), { pos: [Math.cos(a) * 0.84, 0.26, Math.sin(a) * 0.84], rot: [0, (-a * 180) / Math.PI, -25] });
      }
      part(b, rcyl(0.35, 0.66, 0.71, 0.01, 0, 24), mat(PALETTE.darkFace, { gloss: 0.6 }), {});
      const pad = part(b, ring(28, 6), mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.3 }), { pos: [0, 0.72, 0], scale: [0.9, 0.08, 0.9] });
      sv.spin.push(pad);
      part(b, rod(), gold(), { pos: [0.55, 1.2, -0.55], scale: [0.05, 1.2, 0.05] });
      const dish = group(b, 'dish', [0.55, 1.85, -0.55]);
      dish.setLocalEulerAngles(-35, 45, 0);
      part(dish, latheAuto('megaDish', [[0, -0.04], [0.1, -0.02], [0.2, 0.02], [0.24, 0.05], [0.24, 0.05], [0.21, 0.04], [0.1, 0.0], [0, -0.01]], 16), mat(PALETTE.white, { gloss: 0.7 }), {});
      part(dish, rod(), metal(), { pos: [0, 0.1, 0], scale: [0.015, 0.2, 0.015] });
      sv.head = dish;
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const d = part(b, ball(5, 8), mat(PALETTE.white), { pos: [Math.cos(a) * 0.95, 0.55, Math.sin(a) * 0.95], scale: [0.18, 0.1, 0.18] });
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

  /**
   * Solar Panel, in the reference's style (target-look.png): a chunky cream base box with a seam and a gold band, a
   * short thick cream pedestal with a collar, a cream hinge block, and an angled panel with a thick rounded cream
   * frame around 4×2 large cells. The pedestal is a middle height, so the tilted panel's low edge (~0.4) still
   * clears the edge balustrades and railings (~0.35). The panel faces the sun (from the camera side) and tracks it.
   */
  private solar(v: MachineView) {
    const b = v.body;
    // base box: a solid cream block (the reference's cabinet), a darker seam low down and a thin gold trim near the top
    part(b, rbox(0.56, 0.2, 0.56, 0.05), cream(), { pos: [0, 0.1, 0], shadow: true });
    part(b, rbox(0.565, 0.014, 0.565, 0.006), creamSeam(), { pos: [0, 0.05, 0] });
    part(b, rbox(0.566, 0.012, 0.566, 0.04), gold(), { pos: [0, 0.172, 0] });
    // short, thick pedestal with a collar at its foot and a cap under the hinge
    part(b, rbox(0.24, 0.07, 0.24, 0.03), cream(), { pos: [0, 0.245, 0], shadow: true });
    part(b, rbox(0.18, 0.24, 0.18, 0.04), cream(), { pos: [0, 0.38, 0], shadow: true });
    part(b, rbox(0.22, 0.04, 0.22, 0.015), creamSeam(), { pos: [0, 0.5, 0] });
    // cable from the base box to a little junction box (which carries the status light)
    part(b, tube('solarCable', bezier([0.1, 0.22, 0.08], [0.26, 0.2, 0.1], [0.25, 0.12, 0.24], 7), 0.014, { sides: 6 }), cable(), {});
    part(b, rbox(0.1, 0.05, 0.08, 0.015), creamSeam(), { pos: [0.25, 0.12, 0.25] });
    const tilt = group(b, 'tilt', [0, 0.6, 0]);
    tilt.setLocalEulerAngles(28, 45, 0);
    // hinge: a cream block on a short metal axle
    part(tilt, rcyl(0.03, -0.12, 0.12, 0.01, 0.01, 10), metal(), { pos: [0, -0.06, 0], rot: [0, 0, 90] });
    part(tilt, rbox(0.2, 0.05, 0.12, 0.02), cream(), { pos: [0, -0.04, 0] });
    const cells = solarPanel(tilt, 0.92, 0.66, 4, 2);
    v.panel = [cells];
    v.spin.push(tilt); // Phase 4 E09.3: the panel slowly tracks the sun
    v.light = part(b, ball(5, 8), mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 1 }), { pos: [0.22, 0.14, 0.22], scale: 0.05 });
    if (v.m.starter) shape(b, 'box', mat(PALETTE.rust), { pos: [-0.18, 0.085, 0.16], scale: [0.12, 0.02, 0.1], rot: [0, 30, 0] });
  }

  /**
   * Look 3.12 Water Condenser: a cream body on a bevelled plinth with a cloud-icon panel facing the viewer, a glass
   * tank of glowing water (its level shows the watering charge; a swirl and bubbles move in it), a metal lid with a
   * handle, and a pipe down the side with a gold valve wheel.
   * Meshy hook: assets/raw/condenser/water-condenser.glb, loaded like the drone (DroneVisuals MODEL_URL).
   */
  private condenser(v: MachineView) {
    const b = v.body;
    part(b, rcyl(0.4, 0, 0.1, 0.03, 0.01, 20), cream(), { shadow: true });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      bolts(b, [[Math.cos(a) * 0.36, 0.1, Math.sin(a) * 0.36]], 0.03);
    }
    part(b, rcyl(0.32, 0.1, 0.42, 0.04, 0, 18), cream(), { shadow: true });
    part(b, rcyl(0.325, 0.2, 0.212, 0, 0, 18), creamSeam(), {});
    // front: the cloud panel and the status light (turned to face the camera, which looks from +x +z)
    const face = group(b, 'face');
    face.setLocalEulerAngles(0, 45, 0);
    part(face, rbox(0.22, 0.17, 0.05, 0.02), vent(), { pos: [0, 0.27, 0.305] });
    const cloud = mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.3 });
    for (const [x, y, s] of [[-0.04, 0.255, 0.065], [0.035, 0.255, 0.07], [-0.005, 0.28, 0.08]] as const) part(face, ball(5, 8), cloud, { pos: [x, y, 0.33], scale: [s, s, 0.02] });
    part(face, rbox(0.12, 0.03, 0.015, 0.006), cloud, { pos: [0, 0.24, 0.333] });
    v.light = part(face, ball(5, 8), mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.5 }), { pos: [0.085, 0.33, 0.335], scale: 0.03 });
    // vents on the back
    const back = group(b, 'vents');
    back.setLocalEulerAngles(0, 225, 0);
    for (let i = 0; i < 3; i++) part(back, rbox(0.16, 0.018, 0.03, 0.008), vent(), { pos: [0, 0.22 + i * 0.045, 0.31] });
    // the tank: metal bands, glass, glowing water (scaled by the charge), a swirl and bubbles
    part(b, rcyl(0.285, 0.42, 0.47, 0.015, 0.015, 16), metal(), {});
    const water = group(b, 'water', [0, 0.47, 0]);
    part(water, rcyl(0.22, 0, 0.36, 0.025, 0.01, 16), waterGlow(), {});
    v.water = water;
    const swirl = part(b, ring(16, 4, 0.12), mat(PALETTE.waterSwirl, { emissive: PALETTE.waterSwirlGlow, emissiveIntensity: 1.4 }), { pos: [0, 0.6, 0], scale: [0.4, 0.12, 0.4], rot: [8, 0, 0] });
    v.bob.push(swirl);
    for (let i = 0; i < 3; i++) v.bob.push(part(b, ball(3, 6), mat(PALETTE.waterBubble, { emissive: PALETTE.relayGlow, emissiveIntensity: 1 }), { pos: [0.08 - i * 0.07, 0.55 + i * 0.08, 0.05 * i], scale: 0.035 }));
    part(b, rcyl(0.25, 0.47, 0.86, 0, 0, 16), glassMat(), {});
    part(b, rcyl(0.285, 0.85, 0.9, 0.015, 0.015, 16), metal(), {});
    part(b, dome(0.27, 0.09, 0.9, 16), metal(), { shadow: true });
    part(b, tube('condHandle', arcPath(0.07, 0, 6), 0.012, { sides: 6 }), darkMetal(), { pos: [0, 0.975, 0], rot: [0, 45, 0] });
    bolts(b, [0, 1, 2, 3].map((i) => [Math.cos(i * 1.571 + 0.785) * 0.27, 0.88, Math.sin(i * 1.571 + 0.785) * 0.27] as [number, number, number]), 0.028, gold());
    // side pipe with a valve (on the viewer's left, like the reference)
    const pipes = group(b, 'pipes');
    pipes.setLocalEulerAngles(0, -135, 0);
    const pipe = [...bezier([0.25, 0.78, 0], [0.4, 0.78, 0], [0.4, 0.62, 0], 5), ...bezier([0.4, 0.55, 0], [0.4, 0.3, 0], [0.4, 0.1, 0], 2).slice(0, 3)] as [number, number, number][];
    part(pipes, tube('condPipe', pipe, 0.026, { sides: 8 }), metal(), { shadow: true });
    for (const y of [0.3, 0.68]) part(pipes, rcyl(0.036, y, y + 0.03, 0.008, 0.008, 10), darkMetal(), { pos: [0.4, 0, 0] });
    part(pipes, rod(), darkMetal(), { pos: [0.44, 0.47, 0], scale: [0.015, 0.06, 0.015], rot: [0, 0, 90] });
    part(pipes, ring(14, 4, 0.12), gold(), { pos: [0.475, 0.47, 0], scale: [0.11, 0.11, 0.11], rot: [0, 0, 90] });
    part(pipes, tube('condPipe2', bezier([0.3, 0.2, 0.12], [0.42, 0.2, 0.12], [0.44, 0.1, 0.16], 4), 0.02, { sides: 6 }), metal(), {});
  }

  private pollinator(v: MachineView) {
    const b = v.body;
    // a bevelled cream planter with a seam, a lip and corner bolts
    part(b, rbox(0.84, 0.24, 0.84, 0.05), cream(), { pos: [0, 0.12, 0], shadow: true });
    part(b, rbox(0.845, 0.014, 0.845, 0.006), creamSeam(), { pos: [0, 0.1, 0] });
    part(b, rbox(0.88, 0.05, 0.88, 0.022), cream(), { pos: [0, 0.245, 0] });
    bolts(b, [[-0.4, 0.272, -0.4], [0.4, 0.272, -0.4], [-0.4, 0.272, 0.4], [0.4, 0.272, 0.4]], 0.028, gold());
    part(b, rbox(0.76, 0.02, 0.76, 0.008), mat(PALETTE.soil), { pos: [0, 0.265, 0] });
    for (let i = 0; i < 9; i++) {
      const x = ((i % 3) - 1) * 0.24;
      const z = (Math.floor(i / 3) - 1) * 0.24;
      const h = 0.18 + ((i * 37) % 10) / 60;
      const f = group(b, 'f', [x, 0.27, z]);
      part(f, rod(), mat(PALETTE.stem), { pos: [0, h / 2, 0], scale: [0.025, h, 0.025] });
      part(f, ball(3, 6), leafMat(i), { pos: [0.03, h * 0.45, 0], scale: [0.08, 0.02, 0.04], rot: [0, i * 40, 20] });
      part(f, ball(4, 8), mat(PALETTE.flower[i % PALETTE.flower.length], { gloss: 0.5 }), { pos: [0, h, 0], scale: [0.15, 0.08, 0.15], shadow: true });
      part(f, ball(3, 6), mat(PALETTE.flowerCore), { pos: [0, h + 0.035, 0], scale: [0.05, 0.03, 0.05] });
      v.bob.push(f);
    }
    v.light = part(b, ball(5, 8), mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 1.2 }), { pos: [0.34, 0.46, -0.27], scale: 0.04 });
    // Bee house: a little gold box on a post, with a roof and a dark entrance
    part(b, rod(), metal(), { pos: [0.34, 0.31, -0.34], scale: [0.025, 0.1, 0.025] });
    part(b, rbox(0.13, 0.15, 0.13, 0.025), gold(), { pos: [0.34, 0.43, -0.34], shadow: true });
    part(b, ball(4, 6), vent(), { pos: [0.34, 0.43, -0.27], scale: [0.04, 0.04, 0.01] });
    part(b, coneMesh(), mat(PALETTE.trunk), { pos: [0.34, 0.55, -0.34], scale: [0.19, 0.1, 0.19] });
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
    // bevelled pad with rounded corner posts, a seam and vent slats along the front edges
    part(b, rbox(1.7, 0.18, 1.7, 0.06), cream(), { pos: [0, 0.09, 0], shadow: true });
    part(b, rbox(1.705, 0.014, 1.705, 0.006), creamSeam(), { pos: [0, 0.07, 0] });
    for (const [x, z] of [[-0.85, -0.85], [0.85, -0.85], [-0.85, 0.85], [0.85, 0.85]]) {
      part(b, rcyl(0.15, 0, 0.22, 0.04, 0.01, 14), cream(), { pos: [x, 0, z], shadow: true });
      bolts(b, [[x, 0.222, z]], 0.05, gold());
    }
    for (let i = 0; i < 4; i++) {
      part(b, rbox(0.2, 0.025, 0.02, 0.008), vent(), { pos: [-0.3 + i * 0.25, 0.1, 0.851] });
      part(b, rbox(0.02, 0.025, 0.2, 0.008), vent(), { pos: [0.851, 0.1, -0.3 + i * 0.25] });
    }
    part(b, rcyl(0.56, 0.17, 0.2, 0.01, 0, 28), mat(PALETTE.darkFace, { gloss: 0.6 }), { pos: [0.1, 0, 0.1] });
    const pad = part(b, ring(32, 6), mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.2 }), { pos: [0.1, 0.2, 0.1], scale: [1.55, 0.12, 1.55] });
    v.rings = [pad];
    // control tower: bevelled, a screen, vents, a metal cap and antenna
    part(b, rbox(0.38, 0.62, 0.38, 0.05), cream(), { pos: [-0.6, 0.45, -0.6], shadow: true });
    part(b, rbox(0.24, 0.14, 0.03, 0.012), vent(), { pos: [-0.6, 0.55, -0.41] });
    part(b, rbox(0.16, 0.012, 0.01, 0.004), mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.2 }), { pos: [-0.6, 0.56, -0.393] });
    for (let i = 0; i < 3; i++) part(b, rbox(0.03, 0.02, 0.2, 0.008), vent(), { pos: [-0.41, 0.36 + i * 0.05, -0.6] });
    part(b, rbox(0.42, 0.05, 0.42, 0.02), metal(), { pos: [-0.6, 0.78, -0.6], shadow: true });
    part(b, rod(), metal(), { pos: [-0.6, 0.97, -0.6], scale: [0.03, 0.36, 0.03] });
    v.light = part(b, ball(5, 8), mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 1.5 }), { pos: [-0.6, 1.17, -0.6], scale: 0.08 });
    for (const [x, z] of [[0.7, -0.62], [-0.62, 0.72]]) part(b, ball(5, 8), mat(PALETTE.leafFin), { pos: [x, 0.26, z], scale: [0.32, 0.14, 0.2] });
  }

  private motherTree(v: MachineView) {
    const b = v.body;
    // Round white planter ring, a twisting trunk, layered canopy and charge orbs.
    const pl = group(b, 'planter');
    part(pl, rcyl(0.85, 0, 0.2, 0.05, 0.01, 28), cream(), { shadow: true });
    part(pl, rcyl(0.855, 0.08, 0.094, 0.005, 0.005, 28), creamSeam(), {});
    part(pl, rcyl(0.76, 0.19, 0.215, 0.01, 0, 24), mat(PALETTE.soil), {});
    v.planter = pl;
    // The tree: the park's own oak (same generator, wind and see-through-over-the-cursor as every other tree), larger.
    const tree = new pc.Entity('motherTree');
    tree.addComponent('render', { meshInstances: [new pc.MeshInstance(motherMesh(this.device()), foliageMaterial())], castShadows: true, receiveShadows: true });
    tree.setLocalPosition(0, 0.2, 0);
    tree.setLocalScale(MOTHER.scale, MOTHER.scale, MOTHER.scale);
    b.addChild(tree);
    v.tree = tree;
    // Charge orbs hang from the crown's edge, where they can be seen; they light up as the tree charges.
    const [cy, cr] = MOTHER.crown;
    const canopy = group(b, 'canopy', [0, cy, 0]);
    v.canopy = canopy;
    v.orbs = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const o = part(canopy, ball(5, 7), orbOff(), { pos: [Math.cos(a) * cr * (0.92 + (i % 2) * 0.08), -0.12 + (i % 3) * 0.08, Math.sin(a) * cr * (0.92 + (i % 2) * 0.08)], scale: 0.12 });
      v.orbs.push(o);
    }
    v.light = part(b, ball(5, 8), mat(PALETTE.coreGlow, { emissive: PALETTE.coreGlow, emissiveIntensity: 1.2 }), { pos: [0, 0.24, 0.72], scale: 0.07 });
  }

  /** Bloom Pulse: the tree and its ring of orbs swell, then settle. */
  pulseTree(id: string) {
    const v = this.views.get(id);
    if (!v?.canopy) return;
    const c = v.canopy;
    const tree = v.tree;
    const base = tree?.getLocalScale().clone();
    this.tweens.cancel(c);
    this.tweens.add(0.9, (k) => {
      const s = 1 + Math.sin(k * Math.PI) * 0.25 * (1 - k * 0.5);
      c.setLocalScale(s, s, s);
      if (tree && base) tree.setLocalScale(base.x * (1 + (s - 1) * 0.5), base.y * (1 + (s - 1) * 0.35), base.z * (1 + (s - 1) * 0.5));
    }, {
      owner: c,
      ease: ease.linear,
      done: () => {
        c.setLocalScale(1, 1, 1);
        if (tree && base) tree.setLocalScale(base.x, base.y, base.z);
      },
    });
  }

  private core(v: MachineView) {
    const b = v.body;
    // Look 3.12: a stone arch gazebo on a stepped round dais, a leaf emblem on a pedestal under the arch, vines and
    // flowers on the arch. Dormant: grey stone, dull emblem, dry sparse vines, no flowers; awake: cream stone, the
    // emblem glows, the vines green up and flower.
    // Meshy hook: assets/raw/core/core-gazebo.glb, loaded like the drone (DroneVisuals MODEL_URL + loadFromUrl).
    v.coreBase = uniqueMat(PALETTE.coreDormant, { gloss: 0.3 });
    v.coreMat = uniqueMat(PALETTE.coreCrystalDormant, { gloss: 0.8, emissive: PALETTE.emissiveOff, emissiveIntensity: 1 });
    const stone = v.coreBase;
    // stepped dais
    part(b, rcyl(0.96, 0, 0.1, 0.03, 0.01, 28), stone, { shadow: true });
    part(b, rcyl(0.8, 0.1, 0.2, 0.03, 0, 24), stone, { shadow: true });
    part(b, rcyl(0.64, 0.2, 0.28, 0.025, 0, 24), stone, { shadow: true });
    part(b, rcyl(0.645, 0.25, 0.258, 0.003, 0.003, 24), gold(), {});
    // the gazebo turns its arch to the viewer (camera looks from +x +z)
    const gz = group(b, 'gazebo');
    gz.setLocalEulerAngles(0, 45, 0);
    // front steps
    for (let i = 0; i < 2; i++) part(gz, rbox(0.42, 0.1, 0.12, 0.02), stone, { pos: [0, 0.05 + i * 0.1, 0.9 - i * 0.12], shadow: true });
    // four pillars with bases and capitals, two arches and a keystone beam
    for (const x of [-0.48, 0.48])
      for (const z of [-0.26, 0.26]) {
        part(gz, rbox(0.13, 0.84, 0.13, 0.03), stone, { pos: [x, 0.7, z], shadow: true });
        part(gz, rbox(0.19, 0.06, 0.19, 0.008), stone, { pos: [x, 0.31, z] });
        part(gz, rbox(0.19, 0.06, 0.19, 0.008), stone, { pos: [x, 1.12, z] });
      }
    const arch = tube('coreArch', arcPath(0.48, 1.15, 12), 0.07, { b: 0.075, rc: 0.025, up0: [1, 0, 0] });
    for (const z of [-0.26, 0.26]) part(gz, arch, stone, { pos: [0, 0, z], shadow: true });
    part(gz, rbox(0.14, 0.12, 0.66, 0.03), stone, { pos: [0, 1.63, 0], shadow: true });
    for (const s of [-1, 1]) part(gz, rbox(0.1, 0.08, 0.6, 0.025), stone, { pos: [s * 0.34, 1.49, 0], rot: [0, 0, s * 45] });
    // cracks (dormant stone)
    part(gz, rbox(0.012, 0.3, 0.012, 0.004), mat(PALETTE.crack), { pos: [0.48, 0.8, 0.327], rot: [0, 0, 12] });
    part(gz, rbox(0.012, 0.18, 0.012, 0.004), mat(PALETTE.crack), { pos: [-0.3, 1.5, 0.3], rot: [0, 0, -30] });
    // the emblem: a pedestal with a glow disc and a fan of five leaves
    part(gz, rcyl(0.2, 0.28, 0.36, 0.02, 0.005, 20), stone, { shadow: true });
    part(gz, rcyl(0.16, 0.36, 0.375, 0.006, 0, 20), v.coreMat, {});
    const crystal = group(gz, 'crystal', [0, 0.8, 0]);
    for (const [a, len] of [[-66, 0.27], [-33, 0.36], [0, 0.44], [33, 0.36], [66, 0.27]] as const) {
      const leaf = group(crystal, 'leaf', [0, -0.2, 0]);
      leaf.setLocalEulerAngles(0, 0, a);
      part(leaf, ball(5, 8), v.coreMat, { pos: [0, len * 0.55, 0], scale: [len * 0.42, len, 0.04], shadow: true });
    }
    part(crystal, rod(), v.coreMat, { pos: [0, -0.3, 0], scale: [0.035, 0.2, 0.035] });
    v.spin.push(crystal);
    v.rings = [];
    const glow = mat(PALETTE.coreGlow, { emissive: PALETTE.coreGlow, emissiveIntensity: 1.5 });
    const floor = part(gz, ring(28, 5, 0.12), glow, { pos: [0, 0.29, 0], scale: [1.18, 0.05, 1.18] });
    const halo = part(gz, ring(24, 4, 0.05), glow, { pos: [0, 0.8, 0], scale: [0.72, 0.08, 0.72], rot: [90, 0, 0] });
    for (const r of [floor, halo]) {
      r.enabled = false;
      v.rings.push(r);
    }
    // vines up the front pillars and over the arches; flowers only once awake
    v.vineMat = uniqueMat(PALETTE.vineDry[1], { gloss: 0.25 });
    const vines = group(gz, 'vines');
    const blooms = group(gz, 'blooms');
    let k = 0;
    for (const z of [-0.26, 0.26])
      for (let i = 0; i <= 12; i += 1.5) {
        const a = (i / 12) * Math.PI;
        const r = 0.55 + ((i * 7) % 3) * 0.015;
        const p: [number, number, number] = [Math.cos(a) * r, 1.15 + Math.sin(a) * r, z + (z > 0 ? 0.05 : -0.05)];
        const sz = 0.14 + ((k * 5) % 4) * 0.025;
        part(vines, ball(4, 6), v.vineMat, { pos: p, scale: [sz, sz * 0.7, sz], rot: [k * 37, k * 53, 0] });
        if (z > 0 && k % 2 === 0) part(blooms, ball(4, 6), mat(PALETTE.flower[(k >> 1) % 5]), { pos: [p[0], p[1] + 0.04, p[2] + 0.06], scale: [0.11, 0.07, 0.11] });
        k++;
      }
    for (const x of [-0.48, 0.48])
      for (let i = 0; i < 4; i++) {
        const p: [number, number, number] = [x + (i % 2 ? 0.07 : -0.05), 0.42 + i * 0.2, 0.34];
        part(vines, ball(4, 6), v.vineMat, { pos: p, scale: [0.11, 0.08, 0.06], rot: [0, 0, i * 40] });
        if (i % 2) part(blooms, ball(4, 6), mat(PALETTE.flower[(i + (x > 0 ? 1 : 3)) % 5]), { pos: [p[0], p[1] + 0.04, p[2] + 0.04], scale: [0.07, 0.05, 0.07] });
      }
    blooms.enabled = false;
    v.vines = vines;
    v.blooms = blooms;
  }

  /**
   * Look 3.19: swap the procedural body for the hand-built model. The procedural parts stay (disabled), so state
   * code that drives them keeps working; what shows the machine's state stays visible: upgrade extras, water, and
   * a Core's crystal, lifted to float above the model (it still glows when the area wakes).
   */
  private applyModel(v: MachineView) {
    if (!MODELS) return;
    if (v.m.type === 'motherTree') return this.motherCollar(v);
    const pick = v.m.type === 'core' ? LANDMARK_MODELS[this.landmarkKind(v.m)] : MACHINE_MODELS[v.m.type];
    if (!pick) return;
    const e = MODELS.instantiateMerged(oldCityModel(pick[0]) ?? pick[0]); // E21: a new model, or its stand-in
    if (!e) return;
    if (v.fountain) {
      // The park fountain: the hand-built model is its dry look; the flowing three-tier fountain replaces it on waking.
      // The withered sprout stays, on top of the model: it pulses gold when the fountain is ready.
      const sprout = v.spin[0];
      v.fountain.hidden = (v.body.children as pc.Entity[]).filter((c) => c !== v.extras && c !== sprout && c.enabled);
      for (const c of v.fountain.hidden) c.enabled = false;
      const p = sprout.getLocalPosition();
      sprout.setLocalPosition(p.x, this.modelTop(e) * pick[1] - 0.03, p.z);
      e.setLocalScale(pick[1], pick[1], pick[1]);
      v.body.addChild(e);
      v.model = e;
      return;
    }
    const keep = new Set<pc.Entity>([v.extras]);
    if (v.water) {
      keep.add(v.water);
      if (v.water.parent !== v.body) v.water.reparent(v.body);
    }
    const top = this.modelTop(e) * pick[1];
    if (v.m.type === 'core')
      for (const c of v.spin) {
        keep.add(c);
        if (c.parent !== v.body) c.reparent(v.body);
        c.setLocalPosition(0, top + 0.45, 0);
      }
    for (const c of [...v.body.children] as pc.Entity[]) if (!keep.has(c)) c.enabled = false;
    e.setLocalScale(pick[1], pick[1], pick[1]);
    v.body.addChild(e);
    v.model = e;
  }

  /**
   * Look 3.19: the Mother Tree's sandstone planter with its brass collar (the spec's "planter base and collar only";
   * the tree stays procedural). The planter is taller than the procedural ring, so the tree, its orbs and its
   * resonance canopy are raised to grow out of the collar, and the charge light moves to the planter's front.
   */
  private motherCollar(v: MachineView) {
    const e = v.planter && MODELS!.instantiateMerged('mother-tree-collar');
    if (!e || !v.planter) return;
    const S = MotherCollar.scale;
    v.planter.enabled = false;
    e.setLocalScale(S, S, S);
    v.body.addChild(e);
    v.model = e;
    const lift = MotherCollar.top * S - 0.2;
    v.treeLift = lift;
    for (const c of v.body.children as pc.Entity[]) {
      if (c === v.planter || c === e || c === v.extras || c === v.light) continue;
      const p = c.getLocalPosition();
      c.setLocalPosition(p.x, p.y + lift, p.z);
    }
    v.light?.setLocalPosition(0, 0.46 * S, 0.76 * S);
  }

  /** Height of a model entity's meshes (local space, unscaled). */
  private modelTop(e: pc.Entity): number {
    let top = 0;
    e.syncHierarchy();
    for (const r of e.findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) top = Math.max(top, mi.aabb.getMax().y - e.getPosition().y);
    return top;
  }

  private landmarkKind(m: MachineData): string {
    const id = this.sim.areas.areaOf({ roofId: m.roofId, x: m.x, z: m.z });
    return id ? this.sim.areas.info(id).landmarkKind : '';
  }

  /**
   * The park's fountain. Dry: grey cracked stone, a dusty empty basin, dead vines and a wilted sprout. Awake: cream
   * stone with gold rims, three tiers of glowing water spilling into each other, the leaf emblem glowing on top and
   * flower beds at the four corners of its footprint (steps face the paths between them).
   */
  private fountain(v: MachineView) {
    const b = v.body;
    const F = FOUNTAIN;
    const dev = this.device();
    v.coreBase = uniqueMat(PALETTE.fountainStone, { gloss: 0.25 });
    // the leaf sprout: withered until the fountain wakes (pulses gold when it is ready)
    v.coreMat = uniqueMat(PALETTE.plastic.agedVein, { gloss: 0.5, emissive: PALETTE.emissiveOff, emissiveIntensity: 1 });
    const trim = uniqueMat(PALETTE.stone.shadow, { gloss: 0.3 });
    const stone = v.coreBase;
    const rim = (ringRadius: number, tubeRadius: number) => fxMesh(dev, `ring:${ringRadius}:${tubeRadius}`, () => new pc.TorusGeometry({ ringRadius, tubeRadius, segments: 24, sides: 6 }));
    const flare = (baseRadius: number, peakRadius: number, height: number) => fxMesh(dev, `flare:${baseRadius}:${peakRadius}:${height}`, () => new pc.ConeGeometry({ baseRadius, peakRadius, height, heightSegments: 1, capSegments: 18 }));

    // Paved apron with a step towards each path, then the basin.
    shape(b, 'cylinder', stone, { pos: [0, 0.035, 0], scale: [2.08, 0.07, 2.08], shadow: true });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      shape(b, 'box', stone, { pos: [Math.cos(a) * 1.1, 0.02, Math.sin(a) * 1.1], scale: [0.24, 0.04, 0.62], rot: [0, (-a * 180) / Math.PI, 0] });
    }
    shape(b, 'cylinder', stone, { pos: [0, 0.1, 0], scale: [1.78, 0.06, 1.78], shadow: true });
    meshShape(b, flare(0.82, 0.9, 0.24), stone, { pos: [0, 0.24, 0], shadow: true });
    meshShape(b, rim(0.845, 0.05), trim, { pos: [0, 0.37, 0] });
    // Stem and two bowls, each with its rim.
    shape(b, 'cylinder', stone, { pos: [0, 0.42, 0], scale: [0.42, 0.12, 0.42] });
    shape(b, 'cylinder', stone, { pos: [0, 0.6, 0], scale: [0.24, 0.36, 0.24], shadow: true });
    meshShape(b, flare(0.13, 0.5, 0.15), stone, { pos: [0, 0.795, 0], shadow: true });
    meshShape(b, rim(0.48, 0.03), trim, { pos: [0, 0.87, 0] });
    shape(b, 'cylinder', stone, { pos: [0, 0.99, 0], scale: [0.16, 0.26, 0.16], shadow: true });
    meshShape(b, flare(0.09, 0.3, 0.11), stone, { pos: [0, 1.155, 0], shadow: true });
    meshShape(b, rim(0.285, 0.024), trim, { pos: [0, 1.21, 0] });
    shape(b, 'cylinder', stone, { pos: [0, 1.26, 0], scale: [0.1, 0.12, 0.1] });
    shape(b, 'sphere', trim, { pos: [0, 1.34, 0], scale: [0.17, 0.12, 0.17] });

    // The leaf sprout (the game's emblem): three leaves on the finial.
    const sprout = group(b, 'crystal', [0, F.sproutY, 0]);
    shape(sprout, 'sphere', v.coreMat, { pos: [0, 0.2, 0], scale: [0.17, 0.4, 0.06], shadow: true });
    for (const side of [-1, 1]) shape(sprout, 'sphere', v.coreMat, { pos: [side * 0.13, 0.1, 0], scale: [0.14, 0.3, 0.05], rot: [0, 0, side * -48], shadow: true });
    v.spin.push(sprout);
    v.rings = [];

    // Dry look: a dusty basin floor, cracks, rubble, dead leaves, vines hanging dead from the bowl, bare twigs.
    const dry = group(b, 'dry');
    const dust = mat(PALETTE.basinDark);
    const dead = mat(PALETTE.wood.dark);
    shape(dry, 'cylinder', dust, { pos: [0, 0.362, 0], scale: [F.waterR * 2, 0.006, F.waterR * 2] });
    shape(dry, 'box', mat(PALETTE.crack), { pos: [0.42, 0.367, 0.3], scale: [0.5, 0.004, 0.03], rot: [0, 35, 0] });
    shape(dry, 'box', mat(PALETTE.crack), { pos: [0.52, 0.367, 0.12], scale: [0.26, 0.004, 0.025], rot: [0, -40, 0] });
    shape(dry, 'box', mat(PALETTE.crack), { pos: [-0.35, 0.367, -0.45], scale: [0.4, 0.004, 0.03], rot: [0, 70, 0] });
    shape(dry, 'box', mat(PALETTE.crack), { pos: [0.6, 0.24, 0.63], scale: [0.03, 0.24, 0.03], rot: [0, 45, 14] });
    shape(dry, 'box', mat(PALETTE.crack), { pos: [-0.86, 0.22, 0.2], scale: [0.03, 0.2, 0.03], rot: [0, -13, -16] });
    shape(dry, 'box', mat(PALETTE.debris), { pos: [-0.45, 0.39, 0.38], scale: [0.14, 0.07, 0.11], rot: [0, 25, 8], shadow: true });
    shape(dry, 'box', mat(PALETTE.debris), { pos: [-0.3, 0.38, 0.5], scale: [0.08, 0.05, 0.07], rot: [10, 60, 0] });
    shape(dry, 'box', mat(PALETTE.debris), { pos: [0.95, 0.1, -0.3], scale: [0.12, 0.08, 0.1], rot: [0, 30, 12], shadow: true });
    for (const [x, z, s] of [[0.3, -0.5, 0.12], [-0.55, -0.1, 0.1], [0.1, 0.62, 0.11]]) shape(dry, 'sphere', dead, { pos: [x, 0.368, z], scale: [s, 0.012, s * 0.7], rot: [0, x * 200, 0] });
    for (const [a, len] of [[0.6, 0.3], [2.5, 0.22], [4.1, 0.34], [5.3, 0.18]]) shape(dry, 'cylinder', dead, { pos: [Math.cos(a) * 0.5, 0.86 - len / 2, Math.sin(a) * 0.5], scale: [0.022, len, 0.022], rot: [Math.sin(a) * 5, 0, -Math.cos(a) * 5] });

    // Flowing look: water in every tier, ribbons falling between them, ripples, foam, sparkles, a halo on the sprout.
    const wet = group(b, 'wet');
    const waterMat = mat(PALETTE.aqua.teal, { gloss: 0.9, emissive: PALETTE.aqua.deep, emissiveIntensity: 0.5, opacity: 0.92 });
    const fallMat = mat(PALETTE.aqua.foam, { emissive: PALETTE.glow.eyeSoft, emissiveIntensity: 0.9, opacity: 0.72, doubleSided: true });
    const foamMat = mat(PALETTE.glow.beam, { emissive: PALETTE.glow.cyanSoft, emissiveIntensity: 0.9 });
    v.water = shape(wet, 'cylinder', waterMat, { pos: [0, F.waterDry, 0], scale: [F.waterR * 2, 0.01, F.waterR * 2] });
    shape(wet, 'cylinder', waterMat, { pos: [0, 0.872, 0], scale: [0.92, 0.008, 0.92] });
    shape(wet, 'cylinder', waterMat, { pos: [0, 1.212, 0], scale: [0.54, 0.008, 0.54] });
    const fx: FountainFx = { k: 0, trim, dry, wet, lush: group(b, 'lush'), falls: [], ripples: [], sparks: [], drops: [], halo: wet };
    F.falls.forEach((f, i) => {
      const fall = meshShape(wet, fxMesh(dev, `falls:${i}`, () => fallsGeometry(f.n, f.r0, f.r1, f.y0 - f.y1)), fallMat, { pos: [0, f.y0, 0], receive: false });
      fx.falls.push(fall);
    });
    meshShape(wet, rim(F.falls[0].r1, 0.022), foamMat, { pos: [0, F.waterFull + 0.004, 0], scale: [1, 0.3, 1] });
    for (let i = 0; i < 3; i++) fx.ripples.push(meshShape(wet, rim(0.5, 0.008), foamMat, { scale: [1, 0.4, 1], receive: false }));
    for (let i = 0; i < 5; i++) fx.sparks.push(shape(wet, 'sphere', foamMat, { scale: 0.03, receive: false }));
    for (let i = 0; i < 4; i++) fx.drops.push(shape(wet, 'sphere', fallMat, { scale: [0.035, 0.06, 0.035], receive: false }));
    fx.halo = shape(wet, 'sphere', mat(PALETTE.glow.sun, { emissive: PALETTE.glow.lamp, emissiveIntensity: 0.5, opacity: 0.12 }), { pos: [0, F.sproutY + 0.2, 0], scale: 0.62, receive: false });
    wet.enabled = false;

    // Flower beds at the footprint's corners: soil and bare twigs while dry, shrubs and blooms once it flows.
    for (let c = 0; c < 4; c++) {
      const a = Math.PI / 4 + (c * Math.PI) / 2;
      const deg = (-a * 180) / Math.PI;
      const at: [number, number, number] = [Math.cos(a) * 1.1, 0.05, Math.sin(a) * 1.1];
      vshape(b, 'sphere', PALETTE.wood.post, { pos: at, scale: [0.32, 0.12, 0.66], rot: [0, deg, 0] });
      const twigs = group(dry, 'twigs', at);
      twigs.setLocalEulerAngles(0, deg, 0);
      for (const [z, h, lean] of [[-0.2, 0.22, 16], [0.05, 0.3, -10], [0.24, 0.18, 22]]) shape(twigs, 'cylinder', dead, { pos: [0, 0.05 + h / 2, z], scale: [0.02, h, 0.02], rot: [lean, 0, lean * 0.6] });
      const bed = group(fx.lush, 'bed', at);
      bed.setLocalEulerAngles(0, deg, 0);
      const plants = new pc.Entity('plants');
      plants.addComponent('render', { meshInstances: [new pc.MeshInstance(bedMesh(dev, c), foliageMaterial())], castShadows: true, receiveShadows: true });
      bed.addChild(plants);
    }
    fx.lush.setLocalScale(0.0001, 0.0001, 0.0001);
    fx.lush.enabled = false;
    v.fountain = fx;
    this.fountainWake(v, 0);
    this.fountainPose(fx, 0);
  }

  /** How far the fountain has woken (0 dry, 1 flowing): water level, the falls unrolling, beds growing, the sprout lifting. */
  private fountainWake(v: MachineView, k: number) {
    const f = v.fountain!;
    f.k = k;
    v.water!.setLocalPosition(0, FOUNTAIN.waterDry + (FOUNTAIN.waterFull - FOUNTAIN.waterDry) * k, 0);
    const g = Math.max(0.0001, k);
    f.lush.setLocalScale(g, g, g);
    f.falls.forEach((e) => e.setLocalScale(1, g, 1));
    f.halo.setLocalScale(0.62 * g, 0.62 * g, 0.62 * g);
    // wilted: small and hanging to one side
    const s = 0.7 + 0.3 * k;
    v.spin[0].setLocalScale(s, s, s);
    v.spin[0].setLocalEulerAngles(0, 30, 62 * (1 - k));
    v.spin[0].setLocalPosition(0.05 * (1 - k), FOUNTAIN.sproutY - 0.04 * (1 - k), 0);
  }

  /** The flowing fountain's moving parts at time `t` (also their resting pose, with reduced motion). */
  private fountainPose(f: FountainFx, t: number) {
    const F = FOUNTAIN;
    const g = Math.max(0.0001, f.k);
    f.falls.forEach((e, i) => {
      e.setLocalEulerAngles(0, Math.sin(t * 0.9 + i * 2) * 5, 0);
      e.setLocalScale(1, g * (1 + Math.sin(t * 5 + i * 2) * 0.03), 1);
    });
    // Ripples widen from the foot of the falls to the rim, rising out of the water and sinking back into it.
    f.ripples.forEach((e, i) => {
      const u = (t * 0.28 + i / f.ripples.length) % 1;
      const r = F.falls[0].r1 + 0.02 + (F.waterR - 0.03 - F.falls[0].r1) * u;
      e.setLocalScale(r / 0.5, 0.4, r / 0.5);
      e.setLocalPosition(0, F.waterFull + 0.004 + 0.008 * (Math.sin(u * Math.PI) - 1), 0);
    });
    f.sparks.forEach((e, i) => {
      const a = i * 2.4 + t * 0.25;
      const r = 0.45 + (i % 3) * 0.16;
      e.setLocalPosition(Math.cos(a) * r, 0.6 + ((i * 0.29) % 1) * 0.75 + Math.sin(t * 1.3 + i) * 0.05, Math.sin(a) * r);
      const s = 0.012 + 0.03 * Math.max(0, Math.sin(t * 3.1 + i * 1.9));
      e.setLocalScale(s, s, s);
    });
    // Drops run down the lower falls (same curve as the ribbons).
    const low = F.falls[0];
    f.drops.forEach((e, i) => {
      const u = (t * 0.8 + i * 0.37) % 1;
      const a = ((i * 3 + 0.5) / low.n) * Math.PI * 2;
      const r = low.r0 + (low.r1 - low.r0) * Math.sqrt(u) + 0.012;
      e.setLocalPosition(Math.cos(a) * r, low.y0 - (low.y0 - low.y1) * u * u, Math.sin(a) * r);
    });
    const h = 0.62 * g * (1 + Math.sin(t * 2.2) * 0.08);
    f.halo.setLocalScale(h, h, h);
  }

  /** The canal lock's basin (the plain fountain look: a cracked stone basin that fills when it wakes). */
  private basin(v: MachineView) {
    const b = v.body;
    v.coreBase = uniqueMat(PALETTE.fountainStone, { gloss: 0.25 });
    v.coreMat = uniqueMat(PALETTE.gaugeDormant, { gloss: 0.8, emissive: PALETTE.emissiveOff, emissiveIntensity: 1 });
    part(b, latheAuto('fountainBasin', [[0, 0.02], [0.86, 0.02], [0.9, 0.06], [0.9, 0.3], [0.88, 0.35], [0.84, 0.36], [0.8, 0.34], [0.79, 0.3], [0.79, 0.13], [0.79, 0.13], [0, 0.13]], 28), v.coreBase, { shadow: true });
    part(b, rcyl(0.905, 0.14, 0.155, 0.005, 0.005, 28), creamSeam(), {});
    part(b, rcyl(0.79, 0.13, 0.145, 0, 0, 24), mat(PALETTE.basinDark), {});
    const water = part(b, rcyl(0.79, -0.01, 0.01, 0, 0, 24), mat(PALETTE.water, { gloss: 0.9, opacity: 0.85 }), { pos: [0, 0.2, 0] });
    water.enabled = false;
    v.water = water;
    part(b, latheAuto('fountainColumn', [[0.16, 0.3], [0.12, 0.36], [0.1, 0.5], [0.1, 0.9], [0.13, 0.97], [0.13, 0.97], [0.35, 0.97], [0.35, 1.07], [0.35, 1.07], [0, 1.07]], 16), v.coreBase, { shadow: true });
    const crystal = group(b, 'crystal', [0, 1.22, 0]);
    part(crystal, ball(7, 10), v.coreMat, { scale: [0.22, 0.3, 0.22], shadow: true });
    v.spin.push(crystal);
    v.rings = [];
    for (let i = 0; i < 2; i++) {
      const r = part(b, ring(24, 5), mat(PALETTE.water, { emissive: PALETTE.water, emissiveIntensity: 1.2 }), { pos: [0, 1.1 + i * 0.3, 0], scale: [0.8 - i * 0.25, 0.06, 0.8 - i * 0.25] });
      r.enabled = false;
      v.rings.push(r);
    }
    shape(b, 'box', mat(PALETTE.crack), { pos: [0.55, 0.2, 0.6], scale: [0.03, 0.3, 0.03], rot: [0, 45, 14] });
  }

  /** The Reservoir's Old Cistern: a big round tank, dry and rusty until it wakes. */
  private cistern(v: MachineView) {
    const b = v.body;
    v.coreBase = uniqueMat(PALETTE.cisternStone, { gloss: 0.25 });
    v.coreMat = uniqueMat(PALETTE.gaugeDormant, { gloss: 0.8, emissive: PALETTE.emissiveOff, emissiveIntensity: 1 });
    part(b, latheAuto('cisternTank', [[0, 0], [0.82, 0], [0.85, 0.04], [0.85, 0.86], [0.87, 0.9], [0.85, 0.93], [0.78, 0.93], [0.76, 0.9], [0.76, 0.9], [0, 0.9]], 28), v.coreBase, { shadow: true });
    for (let i = 0; i < 3; i++) part(b, rcyl(0.865, 0.18 + i * 0.25, 0.22 + i * 0.25, 0.01, 0.01, 28), mat(PALETTE.cisternBand, { metal: 0.4, gloss: 0.4 }), {});
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      bolts(b, [[Math.cos(a) * 0.875, 0.45, Math.sin(a) * 0.875]], 0.035, mat(PALETTE.cisternBand, { metal: 0.4, gloss: 0.4 }));
    }
    part(b, rcyl(0.76, 0.875, 0.89, 0, 0, 24), mat(PALETTE.cisternDark), {});
    const water = part(b, rcyl(0.75, -0.01, 0.01, 0, 0, 24), mat(PALETTE.water, { gloss: 0.9, opacity: 0.85 }), { pos: [0, 0.3, 0] });
    water.enabled = false;
    v.water = water;
    // spout + pipe down to the roof
    part(b, tube('cisternPipe', bezier([0.8, 0.62, 0], [1.02, 0.62, 0], [1.02, 0.4, 0], 6).concat([[1.02, 0, 0]]), 0.055, { sides: 8 }), metal(), { shadow: true });
    part(b, ring(14, 4, 0.12), gold(), { pos: [1.09, 0.3, 0], scale: [0.16, 0.16, 0.16], rot: [0, 0, 90] });
    // gauge crystal: lights up when the cistern wakes
    const crystal = group(b, 'crystal', [0, 1.35, 0]);
    part(crystal, ball(7, 10), v.coreMat, { scale: [0.3, 0.42, 0.3], shadow: true });
    v.spin.push(crystal);
    v.rings = [];
    for (let i = 0; i < 2; i++) {
      const r = part(b, ring(24, 5), mat(PALETTE.water, { emissive: PALETTE.water, emissiveIntensity: 1.2 }), { pos: [0, 1.2 + i * 0.4, 0], scale: [1.0 - i * 0.3, 0.08, 1.0 - i * 0.3] });
      r.enabled = false;
      v.rings.push(r);
    }
    shape(b, 'box', mat(PALETTE.crack), { pos: [0.6, 0.5, 0.62], scale: [0.03, 0.5, 0.03], rot: [0, 45, 14] });
  }

  /** The Canopy's Elder Tree: bare and dormant, with a charge ring of seed-lights around its roots. */
  private elderTree(v: MachineView) {
    const b = v.body;
    v.coreBase = uniqueMat(PALETTE.elderBark, { gloss: 0.2 });
    v.coreMat = uniqueMat(PALETTE.elderCrystal, { gloss: 0.5, emissive: PALETTE.emissiveOff, emissiveIntensity: 1 });
    part(b, rcyl(0.5, -0.5, 0.5, 0.04, 0.02, 14), mat(PALETTE.elderGround), { pos: [0, 0.08, 0], scale: [1.85, 0.16, 1.85], shadow: true });
    for (let i = 0; i < 4; i++)
      part(b, rcyl(0.5, -0.5, 0.5, 0.04, 0.02, 14), v.coreBase, { pos: [Math.sin(i * 1.3) * 0.08, 0.45 + i * 0.5, Math.cos(i * 1.3) * 0.08], scale: [0.62 - i * 0.1, 0.56, 0.62 - i * 0.1], rot: [5 - i * 3, i * 25, 6 - i * 4], shadow: true });
    for (let r = 0; r < 5; r++) {
      const a = r * 1.25;
      part(b, ball(5, 8), v.coreBase, { pos: [Math.cos(a) * 0.5, 0.2, Math.sin(a) * 0.5], scale: [0.14, 0.5, 0.14], rot: [Math.sin(a) * 75, 0, Math.cos(a) * 75] });
    }
    const bare = group(b, 'bare', [0, 2.2, 0]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 360;
      const br = group(bare, 'branch');
      br.setLocalEulerAngles(0, a, 0);
      part(br, rod(), v.coreBase, { pos: [0.35, 0.25, 0], scale: [0.08, 0.8, 0.08], rot: [0, 0, -50], shadow: true });
      part(br, rod(), v.coreBase, { pos: [0.62, 0.62, 0], scale: [0.05, 0.4, 0.05], rot: [0, 0, -15] });
    }
    v.bare = bare;
    const canopy = group(b, 'canopy', [0, 2.45, 0]);
    const leaves: [number, number, number, number, string][] = [
      [0, 0.4, 0, 2.3, PALETTE.shrub[0]],
      [0.8, 0.0, 0.35, 1.5, PALETTE.shrub[1]],
      [-0.75, 0.1, -0.3, 1.6, PALETTE.shrub[2]],
      [0.2, 0.05, -0.85, 1.4, PALETTE.shrub[1]],
      [-0.35, 0.0, 0.8, 1.4, PALETTE.shrub[0]],
      [0, 1.1, 0, 1.3, PALETTE.canopyTop],
    ];
    for (const [x, y, z, sz, c] of leaves) part(canopy, ball(7, 10), mat(c), { pos: [x, y, z], scale: [sz, sz * 0.75, sz], shadow: true });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      part(canopy, ball(4, 6), mat(PALETTE.flower[i % 5]), { pos: [Math.cos(a) * 1.1, 0.2 + (i % 3) * 0.3, Math.sin(a) * 1.1], scale: 0.16 });
    }
    canopy.setLocalScale(0.0001, 0.0001, 0.0001);
    canopy.enabled = false;
    v.canopy = canopy;
    // Charge ring: one seed-light per point of charge, around the roots (readable from any zoom).
    v.orbs = [];
    const n = TUNING.neighbourhood.canopy.threshold;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      v.orbs.push(part(b, ball(5, 7), orbOff(), { pos: [Math.cos(a) * 0.86, 0.2, Math.sin(a) * 0.86], scale: 0.12 }));
    }
    v.rings = [];
    const crystal = group(b, 'crystal', [0, 1.4, 0]);
    part(crystal, ball(5, 8), v.coreMat, { pos: [0, 0, 0.3], scale: [0.16, 0.2, 0.1] });
    v.spin.push(crystal);
  }

  /** Reservoir Garden: a white basin with a lily pad garden; its water level shows the Overflow fill. */
  private reservoirGarden(v: MachineView) {
    const b = v.body;
    // a bevelled cream basin (an open lathe: outer wall, rounded lip, inner wall) with a seam and bolts
    part(b, latheAuto('gardenBasin', [[0, 0.02], [0.4, 0.02], [0.43, 0.05], [0.43, 0.25], [0.42, 0.29], [0.4, 0.3], [0.38, 0.29], [0.37, 0.26], [0.37, 0.04], [0, 0.04]], 24), cream(), { shadow: true });
    part(b, rcyl(0.435, 0.12, 0.134, 0.005, 0.005, 24), creamSeam(), {});
    v.water = part(b, rcyl(0.37, -0.01, 0.01, 0, 0, 20), mat(PALETTE.water, { gloss: 0.9, emissive: PALETTE.gardenWaterGlow, emissiveIntensity: 0.3 }), { pos: [0, 0.12, 0] });
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      v.bob.push(part(b, rcyl(0.09, 0, 0.015, 0.005, 0, 10), mat(PALETTE.lilyPad), { pos: [Math.cos(a) * 0.2, 0.26, Math.sin(a) * 0.2] }));
    }
    part(b, ball(4, 8), mat(PALETTE.bougainvillea[2]), { pos: [0.18, 0.3, 0.05], scale: [0.08, 0.05, 0.08] });
    // little fountain spout with a metal collar
    part(b, rcyl(0.04, 0.04, 0.53, 0.015, 0, 10), cream(), { shadow: true });
    part(b, rcyl(0.05, 0.4, 0.43, 0.008, 0.008, 10), metal(), {});
    v.light = part(b, ball(5, 8), mat(PALETTE.water, { emissive: PALETTE.water, emissiveIntensity: 1.4 }), { pos: [0, 0.56, 0], scale: 0.07 });
  }

  /** Bloom Relay: a slim white mast with a leafy dish and a glowing tip. */
  private relay(v: MachineView) {
    const b = v.body;
    part(b, rcyl(0.3, 0, 0.12, 0.035, 0.01, 18), cream(), { shadow: true });
    part(b, rcyl(0.305, 0.05, 0.062, 0.004, 0.004, 18), creamSeam(), {});
    bolts(b, [0, 1, 2, 3].map((i) => [Math.cos(i * 1.571 + 0.4) * 0.24, 0.12, Math.sin(i * 1.571 + 0.4) * 0.24] as [number, number, number]), 0.03, gold());
    part(b, latheAuto('relayMast', [[0.07, 0.1], [0.07, 0.16], [0.05, 0.22], [0.042, 1.08], [0.042, 1.08], [0, 1.08]], 10), cream(), { shadow: true });
    for (const y of [0.4, 0.7]) part(b, rcyl(0.055, y, y + 0.03, 0.01, 0.01, 10), metal(), {});
    part(b, ring(20, 6), mat(PALETTE.lilyPad), { pos: [0, 0.95, 0], scale: [0.42, 0.08, 0.42] });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      part(b, ball(3, 6), leafMat(i), { pos: [Math.cos(a) * 0.2, 0.96, Math.sin(a) * 0.2], scale: [0.12, 0.03, 0.06], rot: [0, (-a * 180) / Math.PI, 15] });
    }
    // the dish: a shallow cream bowl with a metal rim
    part(b, latheAuto('relayDish', [[0, 1.02], [0.06, 1.04], [0.14, 1.12], [0.16, 1.17], [0.16, 1.17], [0.13, 1.15], [0.05, 1.1], [0, 1.09]], 14), cream(), { shadow: true });
    part(b, ring(18, 4, 0.12), metal(), { pos: [0, 1.17, 0], scale: [0.33, 0.06, 0.33] });
    v.light = part(b, ball(5, 8), mat(PALETTE.relayGlow, { emissive: PALETTE.relayGlow, emissiveIntensity: 1.6 }), { pos: [0, 1.28, 0], scale: 0.1 });
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      v.bob.push(part(b, ball(4, 6), mat(PALETTE.flower[i % PALETTE.flower.length]), { pos: [Math.cos(a) * 0.22, 0.16, Math.sin(a) * 0.22], scale: [0.08, 0.05, 0.08] }));
    }
  }

  /**
   * E23.4.2.1 Reservoir: a round cream tank on a stone footing filling its 2×2 plot, with a gold rim and a dark
   * inner wall. Its water (a gently turning glowing disc) sits as high as its level; a glass gauge up its side fills
   * blue to match, and a ladder climbs to the rim. Empty, it shows its dry floor.
   */
  private waterTank(v: MachineView) {
    const b = v.body;
    part(b, rcyl(0.92, 0, 0.1, 0.03, 0.01, 28), creamSeam(), { shadow: true });
    // an open cup: up the outside, over the lip, down the inside to the floor (so the water inside shows)
    const cup: [number, number][] = [[0.84, 0.1], [0.84, TANK.top], [0.81, TANK.top + 0.045], [0.78, TANK.top], [0.78, TANK.floor], [0, TANK.floor]];
    part(b, latheAuto('waterTankCup', cup, 28), cream(), { shadow: true });
    part(b, rcyl(0.77, TANK.floor, TANK.floor + 0.004, 0, 0, 28), darkMetal(), {}); // the damp floor, seen when it runs dry
    // (ring() lies flat with an outer diameter of 1: scale is the diameter)
    part(b, ring(28, 6, 0.025), gold(), { pos: [0, TANK.top + 0.04, 0], scale: 1.7 });
    for (const y of [0.32, 0.56]) part(b, ring(28, 4, 0.012), creamSeam(), { pos: [0, y, 0], scale: [1.71, 1.2, 1.71] });
    v.water = part(b, rcyl(0.76, -0.015, 0.015, 0.005, 0.005, 28), waterGlow(), { pos: [0, TANK.floor, 0] });
    // the gauge: a glass tube with a blue column, on the side facing the camera (+x +z)
    const gauge = group(b, 'gauge');
    gauge.setLocalEulerAngles(0, 45, 0);
    const side = group(gauge, 'side', [0, 0, 0.86]);
    part(side, rbox(0.08, TANK.gauge1 - TANK.gauge0 + 0.06, 0.05, 0.02), cream(), { pos: [0, (TANK.gauge0 + TANK.gauge1) / 2, -0.02] });
    v.rings = [part(side, rbox(0.04, TANK.gauge1 - TANK.gauge0, 0.03, 0.01), waterGlow(), { pos: [0, TANK.gauge0, 0.02] })];
    part(side, rbox(0.06, TANK.gauge1 - TANK.gauge0 + 0.02, 0.035, 0.015), glassMat(), { pos: [0, (TANK.gauge0 + TANK.gauge1) / 2, 0.02] });
    // a ladder up the back
    const ladder = group(b, 'ladder');
    ladder.setLocalEulerAngles(0, -135, 0);
    for (const x of [-0.08, 0.08]) part(ladder, rbox(0.02, TANK.top + 0.1, 0.02, 0.005), metal(), { pos: [x, (TANK.top + 0.1) / 2, 0.86] });
    for (let i = 1; i <= 4; i++) part(ladder, rbox(0.16, 0.015, 0.015, 0.004), metal(), { pos: [0, (i * TANK.top) / 4.5, 0.86] });
    bolts(b, [0, 1, 2, 3, 4, 5].map((i) => [Math.cos(i * 1.047) * 0.88, 0.1, Math.sin(i * 1.047) * 0.88] as [number, number, number]), 0.028, gold());
  }

  /**
   * E23.4.2.2 Pump: a cream pump house on a stone plinth with a gold-hubbed flywheel on its side that turns while it
   * pushes water, a pipe stub down into the water beside it, an outlet collar for the pipes, and a small lamp: aqua
   * while running, dark when idle or without power.
   */
  private pump(v: MachineView) {
    const b = v.body;
    part(b, rbox(0.8, 0.1, 0.8, 0.03), creamSeam(), { pos: [0, 0.05, 0], shadow: true });
    part(b, rbox(0.46, 0.44, 0.5, 0.08), cream(), { pos: [0, 0.32, 0], shadow: true });
    part(b, rbox(0.48, 0.03, 0.52, 0.012), gold(), { pos: [0, 0.55, 0] });
    part(b, dome(0.2, 0.12, 0, 10), cream(), { pos: [0, 0.56, 0], shadow: true });
    // the flywheel (turns), facing +x +z
    const side = group(b, 'side');
    side.setLocalEulerAngles(0, 45, 0);
    const wheel = group(side, 'wheel', [0, 0.34, 0.3]);
    part(wheel, ring(18, 6, 0.08), darkMetal(), { rot: [90, 0, 0], scale: 0.4 }); // stood up to face out
    for (let i = 0; i < 4; i++) part(wheel, rbox(0.03, 0.36, 0.02, 0.008), metal(), { rot: [0, 0, i * 45] });
    part(wheel, ball(6, 8), gold(), { scale: [0.06, 0.06, 0.05] });
    v.spin.push(wheel);
    v.turn = 0;
    // a pipe stub dropping into the water, and the outlet collar on top
    part(b, rcyl(0.06, 0.05, 0.42, 0.01, 0.01, 10), mat(PALETTE.aqua.pipe, { gloss: 0.6, metal: 0.2 }), { pos: [-0.3, 0, -0.3] });
    part(b, rcyl(0.075, 0.4, 0.46, 0.01, 0.01, 10), cream(), { pos: [-0.3, 0, -0.3] });
    part(b, rcyl(0.09, 0.66, 0.72, 0.01, 0.01, 10), gold(), {});
    v.light = part(b, ball(5, 8), pumpOff(), { pos: [0.2, 0.5, 0.2], scale: 0.05 });
    bolts(b, [[-0.33, 0.1, 0.33], [0.33, 0.1, 0.33], [-0.33, 0.1, -0.33], [0.33, 0.1, -0.33]], 0.025, gold());
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
    // Superstructures carry their own model: no tier-1 extras (a placed Core keeps its machines' upgrade levels, and
    // a Megaflower has no base panel list, so refreshing one used to crash here).
    if (v.super) return;
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
      // Extra panels per Solar Array level: small framed panels on their own posts, fanning out either side of the
      // main panel and stepping back in rows (a wider array).
      const lvl = L('solarArray');
      const A: [number, number] = [0.707, -0.707]; // along the main panel's long edge
      const K: [number, number] = [-0.707, -0.707]; // away from the viewer
      for (let i = 0; i < lvl; i++) {
        const side = i % 2 ? -1 : 1;
        const row = Math.floor(i / 2);
        const along = side * (0.4 + row * 0.05), back = 0.12 + row * 0.17;
        const x = A[0] * along + K[0] * back, z = A[1] * along + K[1] * back;
        const y = 0.34 - row * 0.03;
        part(ex, rod(), metal(), { pos: [x, (y + 0.08) / 2, z], scale: [0.025, y - 0.08, 0.025] });
        const w = group(ex, 'wing', [x, y, z]);
        w.setLocalEulerAngles(28, 45, side * 8);
        v.panel!.push(solarPanel(w, 0.34, 0.42, 2, 3, false));
      }
      if (lvl >= 4) part(ex, rcyl(0.3, 0.08, 0.1, 0.008, 0, 24), gold(), {});
    } else if (v.m.type === 'droneHub') {
      const dash = L('droneSpeed');
      for (let i = 0; i < dash; i++) {
        part(ex, rod(), metal(), { pos: [-0.6 + 0.12 * (i + 1), 0.95 + i * 0.1, -0.6], scale: [0.02, 0.5 + i * 0.15, 0.02] });
        part(ex, ball(3, 6), mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 1 }), { pos: [-0.6 + 0.12 * (i + 1), 1.2 + i * 0.175, -0.6], scale: 0.035 });
        part(ex, ball(4, 8), mat(PALETTE.leafFin), { pos: [-0.6, 0.8, -0.6 + 0.2 * (i + 1)], scale: [0.25, 0.06, 0.12], rot: [0, 30 * i, 20] });
      }
      // Drone Squad: a glowing landing pad per extra drone.
      // Phase 5 E12 raised Drone Squad to 4 levels (5 drones): a pad for each (the third level used to crash here).
      const pads: [number, number][] = [[0.62, 0.62], [0.62, -0.25], [-0.25, 0.62], [0.05, 0.05]];
      for (let i = 0; i < Math.min(pads.length, L('secondDrone')); i++) {
        const [x, z] = pads[i];
        part(ex, rcyl(0.21, 0.18, 0.25, 0.02, 0.005, 14), cream(), { pos: [x, 0, z], shadow: true });
        part(ex, rcyl(0.14, 0.25, 0.26, 0, 0, 12), vent(), { pos: [x, 0, z] });
        part(ex, ring(16, 4), mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1 }), { pos: [x, 0.26, z], scale: [0.36, 0.08, 0.36] });
      }
      // Drone Sweep: little sweeper arms with leafy brushes either side of the tower.
      for (let i = 0; i < L('droneSweep'); i++) {
        const arm = group(ex, 'sweep', [-0.6, 0.35 + i * 0.12, -0.6]);
        arm.setLocalEulerAngles(0, 45 + i * 90, 0);
        part(arm, rbox(0.5, 0.04, 0.05, 0.015), cream(), { pos: [0.32, 0, 0] });
        part(arm, rcyl(0.03, -0.03, 0.03, 0.01, 0.01, 8), metal(), { pos: [0.08, 0, 0] });
        part(arm, ball(4, 8), mat(PALETTE.shrub[1]), { pos: [0.6, -0.04, 0], scale: [0.16, 0.1, 0.16] });
      }
      // Work Radius: a taller mast and a dish.
      const rad = L('droneRadius');
      if (rad > 0) {
        part(ex, rod(), metal(), { pos: [-0.6, 1.2 + rad * 0.12, -0.6], scale: [0.025, 0.3 + rad * 0.25, 0.025] });
        const dish = group(ex, 'dish', [-0.6, 1.3 + rad * 0.25, -0.6]);
        dish.setLocalEulerAngles(-35, 45, 0);
        const r = 0.2 + rad * 0.06;
        part(dish, latheAuto('hubDish', [[0, -0.02], [0.2, 0.0], [0.42, 0.06], [0.5, 0.1], [0.5, 0.1], [0.44, 0.09], [0.2, 0.03], [0, 0.01]], 14), mat(PALETTE.white, { gloss: 0.7 }), { scale: [r, r, r] });
      }
    } else if (v.m.type === 'pollinator') {
      const lvl = L('pollinatorReach');
      for (let i = 0; i < lvl * 4; i++) {
        const a = (i / (lvl * 4)) * Math.PI * 2;
        part(ex, ball(4, 8), mat(PALETTE.flower[i % 5]), { pos: [Math.cos(a) * 0.46, 0.3, Math.sin(a) * 0.46], scale: [0.11, 0.07, 0.11] });
      }
      // Rich Soil: the bed spills over with taller blooms.
      for (let i = 0; i < Math.min(6, L('richSoil')); i++) {
        const a = i * 1.05 + 0.4;
        const h = 0.34 + (i % 3) * 0.06;
        part(ex, rod(), mat(PALETTE.stem), { pos: [Math.cos(a) * 0.3, 0.27 + h / 2, Math.sin(a) * 0.3], scale: [0.02, h, 0.02] });
        part(ex, ball(4, 8), mat(i % 2 ? PALETTE.bloomPale : PALETTE.flower[(i + 2) % 5]), { pos: [Math.cos(a) * 0.3, 0.27 + h, Math.sin(a) * 0.3], scale: [0.13, 0.08, 0.13] });
      }
    } else if (v.m.type === 'condenser') {
      // Water Bloom: an extra little tank per level around the plinth and a ring of mist beads.
      const lvl = L('waterBloom');
      const at = [0, Math.PI / 2, (3 * Math.PI) / 2, Math.PI, Math.PI * 1.15, Math.PI * 1.85];
      for (let i = 0; i < lvl; i++) {
        const a = at[i % at.length];
        const g = group(ex, 'tank', [Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42]);
        part(g, rcyl(0.075, 0.02, 0.24, 0.025, 0.01, 12), cream(), { shadow: true });
        part(g, rcyl(0.078, 0.12, 0.13, 0.004, 0.004, 12), creamSeam(), {});
        part(g, dome(0.065, 0.07, 0.24, 12), waterGlow(), {});
        part(g, ring(12, 4), metal(), { pos: [0, 0.245, 0], scale: [0.15, 0.04, 0.15] });
      }
      if (lvl > 0)
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          part(ex, ball(4, 6), mat(PALETTE.mist, { opacity: 0.7 }), { pos: [Math.cos(a) * 0.42, 1.06, Math.sin(a) * 0.42], scale: 0.05 });
        }
    } else if (v.m.type === 'motherTree') {
      // Resonance: the tree spreads wider and glowing gold lanterns hang under its crown (counts capped: each level still adds).
      const lvl = L('treeResonance');
      const wide = 1 + Math.min(lvl, 5) * MOTHER.resonance;
      if (v.tree && !this.tweens.has(v.canopy!)) v.tree.setLocalScale(MOTHER.scale * wide, MOTHER.scale * (1 + (wide - 1) * 0.5), MOTHER.scale * wide);
      if (lvl > 0 && v.canopy) {
        const [cy, cr] = MOTHER.crown;
        const c = group(ex, 'canopyPlus', [0, cy + (v.treeLift ?? 0), 0]);
        const lanterns = Math.min(3 * lvl, 2 + 2 * lvl);
        for (let i = 0; i < lanterns; i++) {
          const a = (i / lanterns) * Math.PI * 2 + 0.5;
          part(c, ball(4, 6), mat(PALETTE.lanternGlow, { emissive: PALETTE.gemSolar, emissiveIntensity: 1.2 }), { pos: [Math.cos(a) * cr * wide * 0.85, -0.3, Math.sin(a) * cr * wide * 0.85], scale: 0.09 });
        }
      }
    } else if (v.m.type === 'relay') {
      const lvl = L('relayLens');
      for (let i = 0; i < lvl; i++) part(ex, ring(24, 5), mat(PALETTE.relayGlow, { emissive: PALETTE.relayGlow, emissiveIntensity: 0.8, opacity: 0.8 }), { pos: [0, 1.02 + i * 0.12, 0], scale: [0.5 + i * 0.1, 0.05, 0.5 + i * 0.1] });
    }
  }

  refreshUpgrades() {
    for (const v of this.views.values()) this.applyUpgrades(v);
  }

  /** Core look: dormant / ready (pulsing gold) / awakened. */
  /**
   * E21.6: the Old City fountain's five looks, one per tier: dry (0), a trickle (1), flowing (2), lit (3, 4: the
   * sprout and rims glow), in bloom (5: the beds overflow). Each later look eases in from the one before.
   */
  setFountainLook(machineId: string, look: 'dry' | 'trickle' | 'flowing' | 'lit' | 'bloom', instant = false) {
    const v = this.views.get(machineId);
    if (!v?.fountain || look === 'dry') return;
    const cap = look === 'trickle' ? FOUNTAIN_LOOK.trickle : 1;
    v.fountainCap = cap;
    if (!v.root.tags.has('awake')) {
      this.applyCoreState(v, 'awake', instant);
    } else {
      const f = v.fountain;
      const k0 = f.k;
      this.tweens.add(instant ? 0.01 : 1.6, (k) => this.fountainWake(v, k0 + (cap - k0) * k));
    }
    const lit = look === 'lit' || look === 'bloom';
    const halo = look === 'bloom' ? FOUNTAIN_LOOK.bloomHalo : lit ? FOUNTAIN_LOOK.litHalo : 1;
    const lush = look === 'bloom' ? FOUNTAIN_LOOK.bloomBeds : 1;
    this.tweens.add(instant ? 0.01 : 1.8, (k) => {
      const f = v.fountain!;
      const h = 0.62 * Math.max(0.0001, f.k) * (1 + (halo - 1) * k);
      f.halo.setLocalScale(h, h, h);
      const b = Math.max(0.0001, f.k) * (1 + (lush - 1) * k);
      f.lush.setLocalScale(b, b, b);
      if (lit && v.coreMat) {
        v.coreMat.emissiveIntensity = 0.85 + (FOUNTAIN_LOOK.litGlow - 0.85) * k;
        v.coreMat.update();
        f.trim.emissive = new pc.Color().lerp(new pc.Color(0, 0, 0), color(PALETTE.gold), FOUNTAIN_LOOK.trimGlow * k);
        f.trim.update();
      }
    });
    if (v.batched) this.batch(v);
  }

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
    this.coreLook(v, state, instant);
    if (v.batched) this.batch(v); // parts the new state switched on join the region's batch
  }

  private coreLook(v: MachineView, state: 'dormant' | 'ready' | 'awake', instant: boolean) {
    if (!v.coreMat || !v.coreBase) return;
    if (v.root.tags.has('awake') && state !== 'awake') return;
    v.root.tags.remove('ready', 'awake', 'dormant');
    v.root.tags.add(state);
    if (state === 'awake' && v.fountain) {
      // Stone washes clean to cream, the rims turn gold, water rises and spills, the sprout lifts and glows, beds bloom.
      const f = v.fountain;
      const k0 = f.k;
      const stone = v.coreBase.diffuse.clone();
      const trim = f.trim.diffuse.clone();
      const leaf = v.coreMat.diffuse.clone();
      const lit = v.coreMat.emissive.clone();
      if (v.model?.enabled) {
        v.model.enabled = false;
        for (const c of f.hidden ?? []) c.enabled = true;
        f.dry.enabled = false;
      }
      f.wet.enabled = true;
      f.lush.enabled = true;
      this.tweens.add(instant ? 0.01 : 1.8, (k) => {
        v.coreBase!.diffuse = new pc.Color().lerp(stone, color(PALETTE.whiteWarm), k);
        v.coreBase!.update();
        f.trim.diffuse = new pc.Color().lerp(trim, color(PALETTE.gold), k);
        f.trim.metalness = 0.6 * k;
        f.trim.gloss = 0.3 + 0.45 * k;
        f.trim.update();
        v.coreMat!.diffuse = new pc.Color().lerp(leaf, color(PALETTE.leafFin), k);
        v.coreMat!.emissive = new pc.Color().lerp(lit, color(PALETTE.leafFin), k);
        v.coreMat!.emissiveIntensity = 0.85;
        v.coreMat!.update();
        this.fountainWake(v, (k0 + (1 - k0) * k) * (v.fountainCap ?? 1));
      }, { done: () => (f.dry.enabled = false) });
      return;
    }
    if (state === 'awake' && (v.coreKind === 'cistern' || v.coreKind === 'fountain')) {
      const from = v.coreBase.diffuse.clone();
      this.tweens.add(instant ? 0.01 : 1.4, (k) => {
        v.coreBase!.diffuse = new pc.Color().lerp(from, color(PALETTE.surfaces.shell.hex), k);
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
      const to = color(PALETTE.surfaces.shell.hex);
      this.tweens.add(instant ? 0.01 : 1.2, (k) => {
        v.coreBase!.diffuse = new pc.Color().lerp(from, to, k);
        v.coreBase!.update();
        v.coreMat!.diffuse = new pc.Color().lerp(color(PALETTE.coreCrystalDormant), color(PALETTE.coreGlow), k);
        v.coreMat!.emissive = new pc.Color().lerp(new pc.Color(0, 0, 0), color(PALETTE.coreGlow), k);
        v.coreMat!.emissiveIntensity = glow(1.2); // Look 1.9: the awake core blooms
        v.coreMat!.update();
        if (v.vineMat) {
          v.vineMat.diffuse = new pc.Color().lerp(color(PALETTE.vineDry[1]), color(PALETTE.vine[1]), k);
          v.vineMat.update();
        }
      });
      v.rings!.forEach((r) => (r.enabled = true));
      const bl = v.blooms;
      if (bl && !bl.enabled) {
        bl.enabled = true;
        if (instant || this.reducedMotion) bl.setLocalScale(1, 1, 1);
        else {
          bl.setLocalScale(0.001, 0.001, 0.001);
          this.tweens.add(0.9, (k) => bl.setLocalScale(Math.max(0.001, k), Math.max(0.001, k), Math.max(0.001, k)), { delay: 0.6, ease: ease.outBack });
        }
      }
    }
  }

  private coreView(roofId: string) {
    return [...this.views.values()].find((x) => x.m.type === 'core' && x.m.roofId === roofId);
  }

  /** World point above a Core (by roof, or a specific landmark machine id). */
  coreWorld(roofId = GROUND, machineId?: string): [number, number, number] | undefined {
    const v = machineId ? this.views.get(machineId) : this.coreView(roofId);
    if (!v) {
      // no model here right now (streamed out): the same point, from the machine itself
      const m = machineId ? this.sim.machine(machineId) : this.sim.state.machines.find((x) => x.type === 'core' && x.roofId === roofId);
      if (!m) return undefined;
      const w = this.worldOf(m);
      return [w[0], w[1] + 1.8, w[2]];
    }
    const p = v.root.getPosition();
    return [p.x, p.y + 1.8, p.z];
  }

  /**
   * Animates the machines. With `view` (the visible ground rectangle), ground machines outside it are skipped:
   * a big city has thousands of machines and only a few hundred are ever on screen.
   */
  update(dt: number, view?: { x0: number; x1: number; z0: number; z1: number }) {
    this.time += dt;
    if (this.streaming && view) this.stream(view);
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
          if (sv.head && v.m.type === 'solar') sv.head.setLocalEulerAngles(35 + Math.sin(t * 0.25 + v.m.x) * 6, 45 + Math.sin(t * 0.18 + v.m.z) * 18, 0);
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
        v.crown.setLocalPosition(0, 1.15 + (v.m.size - 1) * 0.3 + Math.sin(t * 1.6 + v.m.x) * 0.06, 0);
      }
      switch (v.m.type) {
        case 'solar': {
          const boosted = v.m.boostUntil > now || this.sim.production.surgeActive();
          const m = boosted ? panelBoost() : panelMat();
          for (const p of v.panel!) if (p.render && p.render.material !== m) p.render.material = m;
          if (!rm && v.spin[0]) v.spin[0].setLocalEulerAngles(28 + Math.sin(t * 0.25 + v.m.x) * 5, 45 + Math.sin(t * 0.18 + v.m.z) * 14, 0);
          const s = (v.running ? 0.05 : 0.04) + (boosted ? 0.025 * (1 + Math.sin(t * 10)) : v.running ? 0.01 * Math.sin(t * 2) : 0);
          v.light!.setLocalScale(s, s, s);
          break;
        }
        case 'condenser': {
          // Water level shows the watering charge; while it runs, the swirl turns and bubbles rise (not with reduced motion).
          const f = 0.35 + 0.65 * Math.min(1, (v.m.charge ?? 0) / TUNING.condenser.threshold);
          const top = 0.47 + 0.36 * f;
          v.water?.setLocalScale(1, f, 1);
          const [swirl, ...bubbles] = v.bob;
          const moving = !rm && v.running;
          const ph = v.m.x * 0.7 + v.m.z * 0.3;
          if (swirl) {
            swirl.setLocalPosition(0, Math.min(top - 0.04, 0.5 + 0.12 * f + (moving ? Math.sin(t * 1.3 + ph) * 0.03 : 0)), 0);
            if (moving) swirl.setLocalEulerAngles(8 * Math.sin(t * 0.9 + ph), t * 70, 8 * Math.cos(t * 0.9 + ph));
          }
          bubbles.forEach((e, i) => {
            const k = moving ? (t * 0.45 + i / bubbles.length + ph) % 1 : 0.3 + i * 0.25;
            const a = i * 2.1 + (moving ? t * 0.8 : 0);
            e.setLocalPosition(Math.cos(a) * 0.1, 0.49 + (top - 0.53) * k, Math.sin(a) * 0.1);
          });
          break;
        }
        case 'motherTree': {
          const lit = Math.round(((v.m.charge ?? 0) / TUNING.motherTree.threshold) * v.orbs!.length);
          v.orbs!.forEach((o, i) => {
            const on = i < lit;
            const want = on ? orbOn() : orbOff();
            if (matOf(o) !== want) setMat(o, want);
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
        case 'reservoir': {
          // E23.4.2.1: the water inside rises and falls with the level; the side gauge shows it too
          const lv = this.sim.water.levelOf(tankId(v.m));
          v.water!.enabled = lv > 0.01;
          v.water!.setLocalPosition(0, TANK.floor + (TANK.top - TANK.floor) * lv, 0);
          const g = v.rings![0];
          g.enabled = lv > 0.01;
          g.setLocalScale(1, Math.max(0.001, lv), 1);
          g.setLocalPosition(0, TANK.gauge0 + (TANK.gauge1 - TANK.gauge0) * lv * 0.5, 0);
          if (!rm && lv > 0.01) v.water!.setLocalEulerAngles(0, t * 4, 0);
          break;
        }
        case 'pump': {
          // E23.4.2.2: the wheel turns while it pushes water (powered, on a bank with water, on a line)
          const on = this.sim.water.pipes.pumping.has(v.m.id) && this.sim.water.pipes.powered(v.m);
          if (on && !rm) {
            v.turn = ((v.turn ?? 0) + dt * 220) % 360;
            v.spin[0]?.setLocalEulerAngles(0, 0, v.turn);
          }
          const want = on ? pumpOn() : pumpOff();
          if (matOf(v.light!) !== want) setMat(v.light!, want);
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
          // the leaf emblem sways and floats once it stirs (it faces the viewer, so it never spins round)
          if (!rm) v.spin[0].setLocalEulerAngles(0, awake ? Math.sin(t * 0.7) * 22 : ready ? Math.sin(t * 1.5) * 6 : 0, 0);
          v.spin[0].setLocalPosition(0, 0.8 + (!rm && (awake || ready) ? Math.sin(t * 2) * 0.05 : 0), 0);
          if (ready && !awake) {
            v.coreMat!.emissive = color(PALETTE.gold);
            v.coreMat!.emissiveIntensity = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(t * 4));
            v.coreMat!.update();
          }
          if (awake && !rm) {
            const [floor, halo] = v.rings!;
            floor?.setLocalEulerAngles(0, t * 20, 0);
            const h = 1 + Math.sin(t * 2.2) * 0.05;
            halo?.setLocalScale(0.72 * h, 0.08, 0.72 * h);
            halo?.setLocalPosition(0, 0.8 + Math.sin(t * 2) * 0.05, 0);
          }
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
        if (matOf(o) !== want) setMat(o, want);
        const sc = on ? 0.13 + (rm ? 0 : Math.sin(t * 4 + i) * 0.02) : 0.1;
        o.setLocalScale(sc, sc, sc);
      });
      if (!rm && v.canopy?.enabled && !this.tweens.has(v.canopy)) v.canopy.setLocalEulerAngles(Math.sin(t * 0.6) * 1.2, 0, Math.cos(t * 0.5) * 1.2);
    } else if (v.fountain) {
      // The flowing fountain moves (once it has finished waking); dry, it is still.
      if (awake && !rm && v.fountain.k >= 1) {
        this.fountainPose(v.fountain, t);
        v.spin[0].setLocalEulerAngles(0, 30 + Math.sin(t * 0.7) * 22, Math.sin(t * 1.1) * 3);
        v.spin[0].setLocalPosition(0, FOUNTAIN.sproutY + Math.sin(t * 2) * 0.025, 0);
      }
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
