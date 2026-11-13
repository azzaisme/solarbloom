import * as pc from 'playcanvas';
import type { RooftopData } from '../core/types';
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
  bridge!: pc.Entity;
  get restorable() {
    return this.r1;
  }
  roof2Group!: pc.Entity;

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
    const r2 = roofs.find((r) => r.id === 'r2');
    if (r2) this.buildRoof2(r2);
    this.buildBridge(r1, r2);
    this.scenery = new Scenery(this.world, this.tweens);
    this.scenery.build(r1);
    // Static batching for everything that never moves; animated restoration props stay separate.
    const staticGroup = this.app.batcher!.addGroup('static-world', false, 40);
    const cityGroup = this.app.batcher!.addGroup('static-city', false, 400);
    const stageGroup = this.app.batcher!.addGroup('stage-props', true, 400);
    assignBatch(this.scenery.staticRoot, cityGroup.id);
    assignBatch(this.scenery.stageRoot, stageGroup.id);
    this.scenery.forEachStageItem((e) => assignBatch(e, stageGroup.id));
    const animated = new Set<pc.Entity>([...this.r1.vines, ...this.r1.planters, ...this.r1.banners, ...this.r1.boards, ...this.r1.rubble, this.bridge, ...this.turbines.map((t) => t.parent as pc.Entity)]);
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
    const facadeMat = main ? uniqueMat(PALETTE.facadeGrey, { gloss: 0.2 }) : mat(PALETTE.facadeGrey, { gloss: 0.2 });
    const windowMat = main ? uniqueMat(PALETTE.window, { gloss: 0.6 }) : mat(PALETTE.window, { gloss: 0.6 });
    const parapetMat = main ? uniqueMat(PALETTE.parapet) : mat(PALETTE.parapet);
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

  private buildRoof2(roof: RooftopData) {
    const r = this.building(roof, false);
    void r;
    const [ox, oy, oz] = roof.origin;
    const top = oy + roof.height;
    const g = group(this.world, 'roof2-preview');
    this.roof2Group = g;
    for (const t of roof.tiles) {
      const c = PALETTE.concrete[t.variant % PALETTE.concrete.length];
      shape(g, 'box', mat(c), { pos: [ox + t.x + 0.5, top, oz + t.z + 0.5], scale: [0.96, 0.16, 0.96] });
    }
    // Greenhouse frame teaser
    const fx0 = ox + 1;
    const fx1 = ox + roof.width - 1;
    const fz0 = oz + 1;
    const fz1 = oz + roof.depth - 1;
    const fh = 1.7;
    const post = (x: number, z: number) => shape(g, 'box', mat(PALETTE.white), { pos: [x, top + fh / 2, z], scale: [0.09, fh, 0.09], shadow: true });
    for (const x of [fx0, (fx0 + fx1) / 2, fx1]) for (const z of [fz0, fz1]) post(x, z);
    for (const z of [fz0, fz1]) shape(g, 'box', mat(PALETTE.white), { pos: [(fx0 + fx1) / 2, top + fh, z], scale: [fx1 - fx0 + 0.09, 0.08, 0.08] });
    for (const x of [fx0, (fx0 + fx1) / 2, fx1]) {
      for (const s of [-1, 1]) {
        const rafter = group(g, 'rafter', [x, top + fh + 0.45, (fz0 + fz1) / 2 + s * (fz1 - fz0) / 4]);
        rafter.setLocalEulerAngles(s * 21, 0, 0);
        shape(rafter, 'box', mat(PALETTE.white), { scale: [0.08, 0.08, (fz1 - fz0) / 2 + 0.2] });
      }
    }
    shape(g, 'box', mat(PALETTE.white), { pos: [(fx0 + fx1) / 2, top + fh + 0.85, (fz0 + fz1) / 2], scale: [fx1 - fx0 + 0.1, 0.08, 0.08] });
    shape(g, 'box', mat(PALETTE.glass, { opacity: 0.25 }), { pos: [(fx0 + fx1) / 2, top + fh / 2, fz1], scale: [fx1 - fx0, fh, 0.02] });
  }

  private buildBridge(r1: RooftopData, r2?: RooftopData) {
    const g = group(this.world, 'bridge');
    this.bridge = g;
    if (!r2) return;
    const x0 = r1.origin[0] + r1.width + 0.2;
    const x1 = r2.origin[0] - 0.2;
    const y0 = r1.origin[1] + r1.height + 0.02;
    const y1 = r2.origin[1] + r2.height + 0.02;
    const z = r2.origin[2] + 5.4;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
    g.setPosition(x0, y0, z);
    const span = group(g, 'span');
    span.setLocalEulerAngles(0, 0, ang);
    shape(span, 'box', mat(PALETTE.bridge), { pos: [len / 2, 0, 0], scale: [len, 0.12, 1.1], shadow: true });
    shape(span, 'box', mat('#83c46a'), { pos: [len / 2, 0.07, 0], scale: [len, 0.03, 0.5] });
    for (const side of [-0.52, 0.52]) {
      shape(span, 'box', mat(PALETTE.white), { pos: [len / 2, 0.35, side], scale: [len, 0.05, 0.05] });
      for (let i = 0; i <= 4; i++) shape(span, 'box', mat(PALETTE.white), { pos: [(i / 4) * len, 0.18, side], scale: [0.06, 0.34, 0.06] });
    }
    for (let i = 0; i < 6; i++) shape(span, 'sphere', mat(PALETTE.flower[i % 5]), { pos: [0.3 + (i / 5) * (len - 0.6), 0.42, i % 2 ? 0.52 : -0.52], scale: 0.12 });
    g.setLocalScale(0.0001, 1, 1);
    g.enabled = false;
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
    this.bridge.enabled = true;
    tw.add(1.4 * D, (k) => this.bridge.setLocalScale(Math.max(0.0001, k), 1, 1), { delay: 4.4 * D, ease: ease.outCubic });
    if (onCamera) tw.add(0.01, () => {}, { delay: 4.0 * D, done: onCamera });
    return 7 * D;
  }
}
