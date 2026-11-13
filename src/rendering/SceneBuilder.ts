import * as pc from 'playcanvas';
import type { RooftopData } from '../core/types';
import { LINKS, type RoofLinkDef } from '../data/rooftops';
import { color, mat, PALETTE, uniqueMat } from './Materials';
import { assignBatch, group, shape, vshape } from './Shapes';
import { Scenery } from './Scenery';
import { ease, type Tweens } from './Tween';

/** Rooftop surface sits slightly below the slabs so the gaps read as a soft grid. */
export const SLAB_TOP = 0.08;
/** Depth of the service ledge behind the main garden. */
export const LEDGE = 1.8;

class R {
  constructor(private s: number) {}
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
}

/** A bridge + its two relay pylons. `ends` are world points at the pylon lamps. */
export interface BridgeView {
  link: RoofLinkDef;
  root: pc.Entity;
  scaffold: pc.Entity;
  lamps: pc.StandardMaterial[];
  pylons: pc.Entity[];
  ends: [pc.Vec3, pc.Vec3];
  /** points along the deck (for pulses travelling across) */
  path: pc.Vec3[];
  built: boolean;
}

/** Outward direction of the roof edge a tile sits on. */
function edgeDir(roof: RooftopData, x: number, z: number): [number, number] {
  if (x === roof.width - 1) return [1, 0];
  if (x === 0) return [-1, 0];
  if (z === roof.depth - 1) return [0, 1];
  return [0, -1];
}

interface Restorable {
  facadeMat: pc.StandardMaterial;
  windowMat: pc.StandardMaterial;
  parapetMat: pc.StandardMaterial;
  vines: pc.Entity[];
  planters: pc.Entity[];
  banners: pc.Entity[];
  rubble: pc.Entity[];
  boards: pc.Entity[];
}

/**
 * Static world: lights, building, parapets, skyline, the next rooftop and the bridge.
 * Owns the building-scale restoration sequence.
 */
export class SceneBuilder {
  readonly world: pc.Entity;
  sun!: pc.Entity;
  private turbines: pc.Entity[] = [];
  private r1!: Restorable;
  /** Bridges by link id. */
  readonly bridges = new Map<string, BridgeView>();
  get restorable() {
    return this.r1;
  }
  /** Each rooftop's dressing that changes when its Core wakes (Reservoir basin water, Canopy flower bridge…). */
  private roofWake = new Map<string, pc.Entity[]>();

  constructor(
    private app: pc.AppBase,
    private tweens: Tweens,
  ) {
    this.world = new pc.Entity('world');
    app.root.addChild(this.world);
  }

  scenery!: Scenery;
  private stage = -1;

  build(roofs: RooftopData[]) {
    this.lights();
    const r1 = roofs.find((r) => r.id === 'r1')!;
    this.r1 = this.building(r1, true);
    const others = roofs.filter((r) => r.id !== 'r1');
    for (const r of others) {
      this.others.set(r.id, this.building(r, false));
      if (r.id === 'r2') this.dressReservoir(r);
      if (r.id === 'r3') this.dressCanopy(r);
    }
    for (const l of LINKS) {
      const a = roofs.find((r) => r.id === l.from);
      const b = roofs.find((r) => r.id === l.to);
      if (a && b) this.buildBridge(l, a, b);
    }
    this.scenery = new Scenery(this.world, this.tweens);
    this.scenery.build(r1, others);
    // Static batching for everything that never moves; animated restoration props stay separate.
    const staticGroup = this.app.batcher!.addGroup('static-world', false, 40);
    const cityGroup = this.app.batcher!.addGroup('static-city', false, 400);
    const stageGroup = this.app.batcher!.addGroup('stage-props', true, 400);
    assignBatch(this.scenery.staticRoot, cityGroup.id);
    assignBatch(this.scenery.stageRoot, stageGroup.id);
    this.scenery.forEachStageItem((e) => assignBatch(e, stageGroup.id));
    const animated = new Set<pc.Entity>([
      ...this.r1.vines,
      ...this.r1.planters,
      ...this.r1.banners,
      ...this.r1.boards,
      ...this.r1.rubble,
      ...[...this.bridges.values()].map((b) => b.root),
      ...[...this.roofWake.values()].flat(),
      ...this.turbines.map((t) => t.parent as pc.Entity),
    ]);
    const walk = (e: pc.Entity) => {
      if (animated.has(e) || e === this.scenery.staticRoot || e === this.scenery.stageRoot) return;
      if (e.render) e.render.batchGroupId = staticGroup.id;
      for (const c of e.children) walk(c as pc.Entity);
    };
    walk(this.world);
    // Restoration props animate (scale), so they use a dynamic batch with the shared vertex-colour material.
    const propGroup = this.app.batcher!.addGroup('restore-props', true, 400);
    for (const e of [...this.r1.vines, ...this.r1.planters, ...this.r1.banners]) assignBatch(e, propGroup.id);
    for (const e of [...this.r1.vines, ...this.r1.planters, ...this.r1.banners]) e.enabled = false;
    void assignBatch;
  }

  private lights() {
    const scene = this.app.scene;
    scene.ambientLight = color('#8a90a3');
    // Aerial perspective: the distant city fades into warm haze; the roof (≈40 units away) stays crisp.
    scene.fog.type = pc.FOG_LINEAR;
    scene.fog.color = color('#bcd9e6');
    // Distances (from the camera) are converted to ortho depth by Game once the camera exists.
    scene.fog.start = 46;
    scene.fog.end = 84;
    const sun = new pc.Entity('sun');
    sun.addComponent('light', {
      type: 'directional',
      color: color('#ffe6bd'),
      intensity: 2.15,
      castShadows: true,
      shadowResolution: 2048,
      shadowDistance: 45,
      shadowBias: 0.25,
      normalOffsetBias: 0.04,
      numCascades: 1,
      shadowType: pc.SHADOW_PCF3_32F,
    });
    sun.setEulerAngles(48, 62, 0);
    this.app.root.addChild(sun);
    this.sun = sun;
    const fill = new pc.Entity('fill');
    fill.addComponent('light', { type: 'directional', color: color('#b9d7ff'), intensity: 0.35, castShadows: false });
    fill.setEulerAngles(40, 220, 0);
    this.app.root.addChild(fill);
  }

  private building(roof: RooftopData, main: boolean): Restorable {
    const [ox, oy, oz] = roof.origin;
    const top = oy + roof.height;
    const w = roof.width;
    const d = roof.depth;
    const cx = ox + w / 2;
    const cz = oz + d / 2;
    const g = group(this.world, `building-${roof.id}`);
    // Every building gets its own materials so each can turn white on its own schedule.
    const facadeMat = uniqueMat(PALETTE.facadeGrey, { gloss: 0.2 });
    const windowMat = uniqueMat(PALETTE.window, { gloss: 0.6 });
    const parapetMat = uniqueMat(PALETTE.parapet);
    const rng = new R(main ? 11 : 23);

    // Deck & body. The main roof has an L-shaped service ledge behind the garden (back and left).
    const L = main ? LEDGE : 0;
    const bx = cx - L / 2;
    const bz = cz - L / 2;
    shape(g, 'box', mat('#565a5f'), { pos: [cx, top - 0.06, cz], scale: [w + 0.3, 0.12, d + 0.3] });
    if (main) shape(g, 'box', mat('#8e8b84'), { pos: [bx, top - 0.07, bz], scale: [w + L + 0.3, 0.12, d + L + 0.3] });
    const bodyH = 16;
    shape(g, 'box', facadeMat, { pos: [bx, top - 0.12 - bodyH / 2, bz], scale: [w + L + 0.5, bodyH, d + L + 0.5], shadow: true });
    shape(g, 'box', parapetMat, { pos: [bx, top - 0.35, bz], scale: [w + L + 0.8, 0.22, d + L + 0.8] });
    if (main) {
      // low outer wall around the ledge
      shape(g, 'box', parapetMat, { pos: [bx, top + 0.1, oz - L - 0.07], scale: [w + L + 0.3, 0.26, 0.14], shadow: true });
      shape(g, 'box', parapetMat, { pos: [ox - L - 0.07, top + 0.1, bz], scale: [0.14, 0.26, d + L + 0.3], shadow: true });
    }

    // Parapets: solid wall at the back, low rail at the front so tiles stay visible.
    const ph = 0.32;
    const t = 0.14;
    shape(g, 'box', parapetMat, { pos: [cx, top + ph / 2 - 0.04, oz - t / 2], scale: [w + 0.28, ph, t], shadow: true });
    shape(g, 'box', parapetMat, { pos: [ox - t / 2, top + ph / 2 - 0.04, cz], scale: [t, ph, d + 0.28], shadow: true });
    const railMat = parapetMat;
    for (let i = 0; i <= w; i += 1) shape(g, 'box', railMat, { pos: [ox + i, top + 0.1, oz + d + t / 2], scale: [0.08, 0.28, 0.08] });
    for (let i = 0; i <= d; i += 1) shape(g, 'box', railMat, { pos: [ox + w + t / 2, top + 0.1, oz + i], scale: [0.08, 0.28, 0.08] });
    shape(g, 'box', railMat, { pos: [cx, top + 0.25, oz + d + t / 2], scale: [w + 0.14, 0.05, 0.08] });
    shape(g, 'box', railMat, { pos: [ox + w + t / 2, top + 0.25, cz], scale: [0.08, 0.05, d + 0.14] });

    // Windows on the two camera-facing facades
    const vines: pc.Entity[] = [];
    const planters: pc.Entity[] = [];
    const banners: pc.Entity[] = [];
    const rubble: pc.Entity[] = [];
    const boards: pc.Entity[] = [];
    const faces: { along: 'x' | 'z'; fixed: number; len: number; start: number }[] = [
      { along: 'x', fixed: oz + d + 0.26, len: w + (main ? LEDGE : 0), start: ox - (main ? LEDGE : 0) },
      { along: 'z', fixed: ox + w + 0.26, len: d + (main ? LEDGE : 0), start: oz - (main ? LEDGE : 0) },
    ];
    for (const f of faces) {
      for (let row = 0; row < 6; row++) {
        const y = top - 1.3 - row * 1.55;
        for (let i = 0; i < f.len / 1.6; i++) {
          const a = f.start + 0.8 + i * 1.6;
          const pos: [number, number, number] = f.along === 'x' ? [a, y, f.fixed] : [f.fixed, y, a];
          const scl: [number, number, number] = f.along === 'x' ? [0.95, 1.0, 0.06] : [0.06, 1.0, 0.95];
          shape(g, 'box', windowMat, { pos, scale: scl });
          if (main && rng.next() < 0.3) {
            const bp: [number, number, number] = f.along === 'x' ? [a, y, f.fixed + 0.03] : [f.fixed + 0.03, y, a];
            const board = shape(g, 'box', mat('#7a6553'), { pos: bp, scale: f.along === 'x' ? [1.05, 0.14, 0.04] : [0.04, 0.14, 1.05], rot: f.along === 'x' ? [0, 0, rng.range(-25, 25)] : [rng.range(-25, 25), 0, 0] });
            boards.push(board);
          }
          if (main && row < 3) {
            const pp: [number, number, number] = f.along === 'x' ? [a, y - 0.62, f.fixed + 0.12] : [f.fixed + 0.12, y - 0.62, a];
            const planter = group(g, 'planter', pp);
            vshape(planter, 'box', PALETTE.white, { scale: f.along === 'x' ? [1.0, 0.16, 0.24] : [0.24, 0.16, 1.0] });
            for (let k = 0; k < 4; k++) {
              const off = -0.36 + k * 0.24;
              const fp: [number, number, number] = f.along === 'x' ? [off, 0.14, 0] : [0, 0.14, off];
              vshape(planter, 'sphere', PALETTE.flower[(k + row + i) % PALETTE.flower.length], { pos: fp, scale: 0.13 });
              vshape(planter, 'sphere', PALETTE.shrub[k % 3], { pos: [fp[0] * 0.9, 0.07, fp[2] * 0.9], scale: [0.18, 0.12, 0.18] });
            }
            planter.setLocalScale(0, 0, 0);
            planters.push(planter);
          }
        }
      }
      if (main) {
        // Vines drape from the parapet. Anchored at the top so they can grow downward.
        for (let i = 0; i < 7; i++) {
          const a = f.start + 0.35 + i * (f.len / 7) + rng.range(-0.2, 0.2);
          const anchor: [number, number, number] = f.along === 'x' ? [a, top - 0.3, f.fixed + 0.05] : [f.fixed + 0.05, top - 0.3, a];
          const vine = group(g, 'vine', anchor);
          const len = rng.range(2.5, 6.5);
          vshape(vine, 'box', PALETTE.shrub[i % 3], { pos: [0, -len / 2, 0], scale: f.along === 'x' ? [0.12, len, 0.05] : [0.05, len, 0.12] });
          for (let k = 0; k < len / 0.6; k++) {
            const lp: [number, number, number] = f.along === 'x' ? [rng.range(-0.12, 0.12), -k * 0.6 - 0.3, 0.04] : [0.04, -k * 0.6 - 0.3, rng.range(-0.12, 0.12)];
            vshape(vine, 'sphere', k % 4 === 3 ? PALETTE.pink : PALETTE.grassTuft[k % 3], { pos: lp, scale: [0.2, 0.16, 0.2] });
          }
          vine.setLocalScale(1, 0, 1);
          vines.push(vine);
        }
        for (let i = 0; i < 2; i++) {
          const a = f.start + f.len * (0.3 + i * 0.4);
          const anchor: [number, number, number] = f.along === 'x' ? [a, top - 0.5, f.fixed + 0.1] : [f.fixed + 0.1, top - 0.5, a];
          const banner = group(g, 'banner', anchor);
          const col = i === 0 ? '#ffd23f' : '#6cc24a';
          vshape(banner, 'box', col, { pos: [0, -1.1, 0], scale: f.along === 'x' ? [0.7, 2.2, 0.03] : [0.03, 2.2, 0.7] });
          vshape(banner, 'sphere', PALETTE.white, { pos: [0, -1.0, f.along === 'x' ? 0.03 : 0], scale: [0.35, 0.35, 0.05] });
          banner.setLocalScale(1, 0, 1);
          banners.push(banner);
        }
      }
    }

    if (main) {
      // Rusty vents on blocked tiles
      for (const tile of roof.tiles.filter((t) => t.blocked)) {
        const vx = ox + tile.x + 0.5;
        const vz = oz + tile.z + 0.5;
        const v = group(g, 'vent', [vx, top, vz]);
        shape(v, 'box', mat(PALETTE.vent), { pos: [0, 0.2, 0], scale: [0.62, 0.4, 0.62], shadow: true });
        shape(v, 'cylinder', mat(PALETTE.rust), { pos: [0, 0.5, 0], scale: [0.36, 0.25, 0.36], shadow: true });
        shape(v, 'cylinder', mat('#4d4540'), { pos: [0, 0.63, 0], scale: [0.42, 0.04, 0.42] });
      }
      // Rain barrel on the service ledge
      const rb = group(g, 'rainBarrel', [ox + 3.1, top, oz - 0.85]);
      shape(rb, 'cylinder', mat('#6d8fa3'), { pos: [0, 0.28, 0], scale: [0.36, 0.5, 0.36], shadow: true });
      shape(rb, 'cylinder', mat(PALETTE.water, { gloss: 0.8 }), { pos: [0, 0.54, 0], scale: [0.3, 0.02, 0.3] });
      // Rubble chunks at the foot of the parapet
      for (let i = 0; i < 6; i++) {
        const along = rng.next() < 0.5;
        const p: [number, number, number] = along ? [ox + rng.range(0.5, w - 0.5), top - 0.3, oz + d + 0.45] : [ox + w + 0.45, top - 0.3, oz + rng.range(0.5, d - 0.5)];
        rubble.push(shape(g, 'box', mat(PALETTE.debris), { pos: p, scale: rng.range(0.12, 0.25), rot: [rng.range(0, 90), rng.range(0, 90), 0] }));
      }
    }
    return { facadeMat, windowMat, parapetMat, vines, planters, banners, rubble, boards };
  }

  /** Reservoir: dry terraced planters, an old pipe run and a dry basin channel that fill with water when it wakes. */
  private dressReservoir(roof: RooftopData) {
    const [ox, oy, oz] = roof.origin;
    const top = oy + roof.height;
    const g = group(this.world, 'reservoir-dressing');
    // Stepped dry terraces down the back wall (outside the grid).
    for (let i = 0; i < 4; i++) {
      const tx = ox + 1 + i * 2;
      shape(g, 'box', mat('#d8d2c6'), { pos: [tx, top + 0.16, oz - 0.42], scale: [1.6, 0.32, 0.5], shadow: true });
      shape(g, 'box', mat('#a8946f'), { pos: [tx, top + 0.33, oz - 0.42], scale: [1.45, 0.03, 0.38] });
      for (let k = 0; k < 3; k++) shape(g, 'cone', mat('#8d7f62'), { pos: [tx - 0.5 + k * 0.5, top + 0.42, oz - 0.42], scale: [0.06, 0.16, 0.06] });
    }
    // Old pipe run along the left edge.
    shape(g, 'cylinder', mat('#9a6a4a'), { pos: [ox - 0.32, top + 0.14, oz + roof.depth / 2], scale: [0.14, roof.depth, 0.14], rot: [90, 0, 0] });
    // Dry channels on the back terrace that run with water once the Cistern wakes.
    const wake: pc.Entity[] = [];
    for (let i = 0; i < 3; i++) {
      const w = group(g, 'cascade', [ox + 1.2 + i * 2.8, top + 0.2, oz - 0.5]);
      shape(w, 'box', mat(PALETTE.water, { gloss: 0.9, emissive: '#1a6f8a', emissiveIntensity: 0.3 }), { pos: [0, 0.32, -0.3], scale: [0.5, 0.06, 1.2], rot: [-30, 0, 0] });
      for (let k = 0; k < 3; k++) shape(w, 'sphere', mat(PALETTE.flower[(i + k) % 5]), { pos: [-0.35 + k * 0.35, 0.5 + (k % 2) * 0.1, -0.1], scale: 0.12 });
      shape(w, 'sphere', mat(PALETTE.shrub[i % 3]), { pos: [0.45, 0.45, -0.2], scale: [0.4, 0.3, 0.4] });
      w.setLocalScale(1, 0.0001, 1);
      w.enabled = false;
      wake.push(w);
    }
    // A waterfall spilling off the front of the building.
    const fall = group(g, 'waterfall', [ox + roof.width + 0.28, top - 0.2, oz + 2.5]);
    shape(fall, 'box', mat('#a8ecff', { opacity: 0.85, emissive: '#3aa6c8', emissiveIntensity: 0.25 }), { pos: [0, -2.5, 0], scale: [0.06, 5, 0.9] });
    fall.setLocalScale(1, 0.0001, 1);
    fall.enabled = false;
    wake.push(fall);
    this.roofWake.set(roof.id, wake);
  }

  /** Canopy: dead vines on the walls and a dormant trellis; a flower arch and hanging gardens appear when it wakes. */
  private dressCanopy(roof: RooftopData) {
    const [ox, oy, oz] = roof.origin;
    const top = oy + roof.height;
    const g = group(this.world, 'canopy-dressing');
    const rng = new R(31);
    for (let i = 0; i < 8; i++) {
      const a = ox + 0.6 + i * (roof.width / 8);
      shape(g, 'box', mat('#7a6a55'), { pos: [a, top - 0.9, oz + roof.depth + 0.3], scale: [0.08, rng.range(1, 2.2), 0.05], rot: [0, 0, rng.range(-12, 12)] });
    }
    // Trellis along the back wall
    for (let i = 0; i <= 5; i++) shape(g, 'box', mat('#9b8c78'), { pos: [ox + 0.5 + i * ((roof.width - 1) / 5), top + 0.7, oz - 0.2], scale: [0.07, 1.4, 0.07] });
    shape(g, 'box', mat('#9b8c78'), { pos: [ox + roof.width / 2, top + 1.4, oz - 0.2], scale: [roof.width - 0.9, 0.07, 0.07] });
    const wake: pc.Entity[] = [];
    // Hanging gardens down the front face
    for (let i = 0; i < 9; i++) {
      const a = ox + 0.5 + i * ((roof.width - 1) / 8);
      const len = rng.range(1.5, 4);
      const vine = group(g, 'hang', [a, top - 0.2, oz + roof.depth + 0.33]);
      shape(vine, 'box', mat(PALETTE.shrub[i % 3]), { pos: [0, -len / 2, 0], scale: [0.3, len, 0.06] });
      shape(vine, 'sphere', mat(PALETTE.flower[i % 5]), { pos: [0, -len * 0.7, 0.05], scale: 0.14 });
      vine.setLocalScale(1, 0.0001, 1);
      vine.enabled = false;
      wake.push(vine);
    }
    // Leafy trellis
    const leafy = group(g, 'trellisLeaves', [ox + roof.width / 2, top + 1.0, oz - 0.2]);
    for (let i = 0; i < 12; i++) shape(leafy, 'sphere', mat(i % 4 === 0 ? PALETTE.pink : PALETTE.shrub[i % 3]), { pos: [-roof.width / 2 + 0.6 + i * ((roof.width - 1.2) / 11), rng.range(-0.3, 0.45), 0], scale: [0.5, 0.42, 0.25] });
    leafy.setLocalScale(0.0001, 0.0001, 0.0001);
    leafy.enabled = false;
    wake.push(leafy);
    this.roofWake.set(roof.id, wake);
  }

  private others = new Map<string, Restorable>();

  /** Neighbourhood Bloom: the other buildings' facades turn clean white and their windows light up. */
  bloomFacades(instant: boolean, delay = 0) {
    for (const r of this.others.values()) {
      const f0 = r.facadeMat.diffuse.clone();
      const w0 = r.windowMat.diffuse.clone();
      const p0 = r.parapetMat.diffuse.clone();
      this.tweens.add(instant ? 0.001 : 1.8, (k) => {
        r.facadeMat.diffuse = new pc.Color().lerp(f0, color(PALETTE.whiteWarm), k);
        r.facadeMat.update();
        r.parapetMat.diffuse = new pc.Color().lerp(p0, color(PALETTE.parapetClean), k);
        r.parapetMat.update();
        r.windowMat.diffuse = new pc.Color().lerp(w0, color(PALETTE.windowLit), k);
        r.windowMat.emissive = new pc.Color().lerp(new pc.Color(0, 0, 0), color('#ffcf73'), k);
        r.windowMat.emissiveIntensity = 0.8;
        r.windowMat.update();
      }, { delay: instant ? 0 : delay, ease: ease.inOutCubic });
    }
  }

  /** A rooftop's own Core woke up: its dressing comes alive. */
  wakeRoof(roofId: string, instant: boolean) {
    const list = this.roofWake.get(roofId) ?? [];
    list.forEach((e, i) => {
      if (e.enabled && !instant) return;
      e.enabled = true;
      const all = e.name === 'trellisLeaves';
      this.tweens.add(instant ? 0.001 : 1.2, (k) => e.setLocalScale(all ? Math.max(0.0001, k) : 1, Math.max(0.0001, k), all ? Math.max(0.0001, k) : 1), {
        delay: instant ? 0 : 0.3 + i * 0.12,
        ease: ease.outCubic,
      });
    });
  }

  /** World point just outside a roof edge tile (where the relay pylon stands). */
  private edgePoint(roof: RooftopData, tile: [number, number], out: number): pc.Vec3 {
    const [dx, dz] = edgeDir(roof, tile[0], tile[1]);
    return new pc.Vec3(roof.origin[0] + tile[0] + 0.5 + dx * (0.5 + out), roof.origin[1] + roof.height, roof.origin[2] + tile[1] + 0.5 + dz * (0.5 + out));
  }

  private buildBridge(link: RoofLinkDef, a: RooftopData, b: RooftopData) {
    const root = group(this.world, `bridge-${link.id}`);
    const p0 = this.edgePoint(a, link.fromTile, 0.12);
    const p1 = this.edgePoint(b, link.toTile, 0.12);
    const deckY = 0.26; // decks sit on the parapets, clear of ledge props
    const s0 = new pc.Vec3(p0.x, p0.y + deckY, p0.z);
    const s1 = new pc.Vec3(p1.x, p1.y + deckY, p1.z);
    const dx = s1.x - s0.x;
    const dy = s1.y - s0.y;
    const dz = s1.z - s0.z;
    const flat = Math.hypot(dx, dz);
    const len = Math.hypot(flat, dy);
    const yaw = (Math.atan2(dx, dz) * 180) / Math.PI - 90;
    const pitch = (Math.atan2(dy, flat) * 180) / Math.PI;
    const deck = group(root, 'deck', [s0.x, s0.y, s0.z]);
    deck.setLocalEulerAngles(0, yaw, pitch);
    const span = group(deck, 'span');
    shape(span, 'box', mat(PALETTE.bridge), { pos: [len / 2, 0, 0], scale: [len, 0.12, 1.1], shadow: true });
    shape(span, 'box', mat('#83c46a'), { pos: [len / 2, 0.07, 0], scale: [len, 0.03, 0.5] });
    for (const side of [-0.52, 0.52]) {
      shape(span, 'box', mat(PALETTE.white), { pos: [len / 2, 0.35, side], scale: [len, 0.05, 0.05] });
      for (let i = 0; i <= 4; i++) shape(span, 'box', mat(PALETTE.white), { pos: [(i / 4) * len, 0.18, side], scale: [0.06, 0.34, 0.06] });
    }
    for (let i = 0; i < 6; i++) shape(span, 'sphere', mat(PALETTE.flower[i % 5]), { pos: [0.3 + (i / 5) * (len - 0.6), 0.42, i % 2 ? 0.52 : -0.52], scale: 0.12 });
    span.setLocalScale(0.0001, 1, 1);
    span.enabled = false;
    // Scaffold: a dashed white outline of where the bridge will go (shown once it can be built).
    const scaffold = group(deck, 'scaffold');
    for (let i = 0; i < Math.floor(len / 0.5); i++) shape(scaffold, 'box', mat(PALETTE.white, { opacity: 0.55 }), { pos: [0.25 + i * 0.5, 0, 0], scale: [0.28, 0.05, 0.9] });
    scaffold.enabled = false;
    // Relay pylons at both ends.
    const lamps: pc.StandardMaterial[] = [];
    const pylons: pc.Entity[] = [];
    const ends: pc.Vec3[] = [];
    for (const p of [p0, p1]) {
      const py = group(root, 'pylon', [p.x, p.y + 0.12, p.z]);
      shape(py, 'cylinder', mat(PALETTE.shell), { pos: [0, 0.08, 0], scale: [0.36, 0.16, 0.36], shadow: true });
      shape(py, 'cylinder', mat(PALETTE.white), { pos: [0, 0.48, 0], scale: [0.12, 0.7, 0.12], shadow: true });
      shape(py, 'torus', mat(PALETTE.white), { pos: [0, 0.82, 0], scale: [0.34, 0.06, 0.34] });
      const lm = uniqueMat('#55605a', { gloss: 0.7, emissive: '#000000', emissiveIntensity: 1 });
      shape(py, 'sphere', lm, { pos: [0, 0.92, 0], scale: 0.2 });
      lamps.push(lm);
      pylons.push(py);
      ends.push(new pc.Vec3(p.x, p.y + 1.04, p.z));
    }
    const path: pc.Vec3[] = [];
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      path.push(new pc.Vec3(s0.x + dx * k, s0.y + dy * k + 0.45 + Math.sin(k * Math.PI) * 0.35, s0.z + dz * k));
    }
    this.bridges.set(link.id, { link, root, scaffold, lamps, pylons, ends: [ends[0], ends[1]], path, built: false });
    (root as pc.Entity & { span?: pc.Entity }).span = span;
  }

  private district?: pc.Entity;
  /** After the Neighbourhood Bloom: a new district silhouette appears on the horizon (the next goal). */
  showDistrict(instant: boolean) {
    if (!this.district) {
      const g = group(this.world, 'next-district');
      const rng = new R(808);
      // Far behind the Reservoir, toward the upper right of the screen.
      for (let i = 0; i < 7; i++) {
        const x = 30 + i * 2.4 + rng.range(-0.5, 0.5);
        const z = -26 + i * 1.1 + rng.range(-0.5, 0.5);
        const h = rng.range(5, 11);
        shape(g, 'box', mat('#d9efe0'), { pos: [x, h / 2 - 4, z], scale: [1.8, h, 1.8] });
        shape(g, 'sphere', mat('#8fd17a'), { pos: [x, h - 4 + 0.3, z], scale: [1.6, 0.8, 1.6] });
        if (i % 2) shape(g, 'cylinder', mat(PALETTE.white), { pos: [x, h - 4 + 1.5, z], scale: [0.12, 2.4, 0.12] });
      }
      // a soft green beacon: something is waiting there
      shape(g, 'cylinder', mat('#b6ffe0', { emissive: '#7cf7c8', emissiveIntensity: 1.2, opacity: 0.35 }), { pos: [37, 6, -22], scale: [0.6, 22, 0.6] });
      this.district = g;
    }
    const g = this.district;
    g.enabled = true;
    this.tweens.add(instant ? 0.001 : 2.5, (k) => g.setLocalPosition(0, -12 * (1 - k), 0), { ease: ease.outCubic });
  }

  /** The bridge can be built: show its dashed outline. */
  showScaffold(linkId: string, on: boolean) {
    const b = this.bridges.get(linkId);
    if (b && !b.built) b.scaffold.enabled = on;
  }

  /** Grows the bridge deck across (`instant` on load). Returns the animation length. */
  buildBridgeDeck(linkId: string, instant: boolean): number {
    const b = this.bridges.get(linkId);
    if (!b || b.built) return 0;
    b.built = true;
    b.scaffold.enabled = false;
    const span = (b.root as pc.Entity & { span?: pc.Entity }).span!;
    span.enabled = true;
    this.tweens.add(instant ? 0.001 : 1.4, (k) => span.setLocalScale(Math.max(0.0001, k), 1, 1), { ease: ease.outCubic });
    return instant ? 0 : 1.4;
  }

  /** Relay lamp: green when ready, dim while recharging, off until the bridge is built. */
  setRelayLamp(linkId: string, state: 'off' | 'ready' | 'cooldown' | 'firing') {
    const b = this.bridges.get(linkId);
    if (!b) return;
    const key = `lamp:${state}`;
    if ((b.root as pc.Entity & { lampState?: string }).lampState === key) return;
    (b.root as pc.Entity & { lampState?: string }).lampState = key;
    const hex = state === 'ready' ? '#7cf7c8' : state === 'firing' ? '#fff3a0' : state === 'cooldown' ? '#3f8f6a' : '#000000';
    for (const m of b.lamps) {
      m.diffuse = color(state === 'off' ? '#55605a' : '#d8fff0');
      m.emissive = color(hex);
      m.emissiveIntensity = state === 'firing' ? 2.2 : state === 'ready' ? 1.4 : 0.5;
      m.update();
    }
  }

  /**
   * Visual progress stages from restored coverage: 1 = 25%, 2 = 50%, 3 = 75% (4 = Core awake).
   * Stage 3 brightens the facade part-way and fills the first balconies and vines.
   */
  setStage(stage: number, instant: boolean): boolean {
    if (stage === this.stage) return false;
    const prev = this.stage;
    this.stage = stage;
    const grew = this.scenery.setStage(stage, instant);
    const r = this.r1;
    if (stage >= 3 && prev < 3 && stage < 4) {
      const from = r.facadeMat.diffuse.clone();
      const to = new pc.Color().lerp(color(PALETTE.facadeGrey), color(PALETTE.whiteWarm), 0.45);
      this.tweens.add(instant ? 0.001 : 2, (k) => {
        r.facadeMat.diffuse = new pc.Color().lerp(from, to, k);
        r.facadeMat.update();
      });
      const half = (arr: pc.Entity[]) => arr.filter((_, i) => i % 2 === 0);
      half(r.boards).forEach((b) => (b.enabled = false));
      half(r.vines).forEach((v, i) => {
        v.enabled = true;
        this.tweens.add(instant ? 0.001 : 1.2, (k) => v.setLocalScale(1, Math.max(0.0001, k * 0.6), 1), { delay: instant ? 0 : i * 0.1 });
      });
      half(r.planters).forEach((p, i) => {
        p.enabled = true;
        this.tweens.add(instant ? 0.001 : 0.4, (k) => p.setLocalScale(k, k, k), { delay: instant ? 0 : 0.5 + i * 0.04, ease: ease.outBack });
      });
    }
    return grew;
  }

  update(dt: number) {
    for (const t of this.turbines) t.rotateLocal(0, 0, dt * 40);
  }

  /** Building-scale transformation. `instant` applies the end state (used on load and on skip). */
  restoreBuilding(instant: boolean, onCamera?: () => void): number {
    const r = this.r1;
    const fromF = r.facadeMat.diffuse.clone(); // stage 3 may have brightened it already
    const toF = color(PALETTE.whiteWarm);
    const fromW = color(PALETTE.window);
    const toW = color(PALETTE.windowLit);
    const fromP = color(PALETTE.parapet);
    const toP = color(PALETTE.parapetClean);
    const lerpMat = (m: pc.StandardMaterial, a: pc.Color, b: pc.Color, k: number, glow = false) => {
      m.diffuse = new pc.Color().lerp(a, b, k);
      if (glow) {
        m.emissive = new pc.Color().lerp(new pc.Color(0, 0, 0), color('#ffcf73'), k);
        m.emissiveIntensity = 0.8;
      }
      m.update();
    };
    const tw = this.tweens;
    const D = instant ? 0 : 1;
    tw.add(1.6 * D, (k) => lerpMat(r.facadeMat, fromF, toF, k), { delay: 1.0 * D, ease: ease.inOutCubic });
    tw.add(1.2 * D, (k) => lerpMat(r.parapetMat, fromP, toP, k), { delay: 0.8 * D });
    tw.add(1.0 * D, (k) => lerpMat(r.windowMat, fromW, toW, k, true), { delay: 2.0 * D });
    r.boards.forEach((b, i) => tw.add(0.4 * D, (k) => b.setLocalScale(1 - k, 1 - k, 1 - k), { delay: (1.2 + i * 0.05) * D, done: () => (b.enabled = false) }));
    r.rubble.forEach((b) => tw.add(0.3 * D, (k) => b.setLocalScale(0.2 * (1 - k), 0.2 * (1 - k), 0.2 * (1 - k)), { delay: 1.2 * D, done: () => (b.enabled = false) }));
    for (const e of [...r.vines, ...r.planters, ...r.banners]) e.enabled = true;
    r.vines.forEach((v, i) => tw.add(1.4 * D, (k) => v.setLocalScale(1, Math.max(0.0001, k), 1), { delay: (2.2 + i * 0.12) * D, ease: ease.outCubic }));
    r.planters.forEach((p, i) => tw.add(0.45 * D, (k) => p.setLocalScale(k, k, k), { delay: (2.8 + i * 0.05) * D, ease: ease.outBack }));
    r.banners.forEach((b, i) => tw.add(0.9 * D, (k) => b.setLocalScale(1, Math.max(0.0001, k), 1), { delay: (3.6 + i * 0.2) * D, ease: ease.outElastic }));
    if (onCamera) tw.add(0.01, () => {}, { delay: 4.0 * D, done: onCamera });
    return 7 * D;
  }
}
