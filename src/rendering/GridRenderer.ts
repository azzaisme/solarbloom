import * as pc from 'playcanvas';
import type { LayerData, TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { PALETTE } from './Materials';
import { assignBatch, group, setVColor, vshape as shape } from './Shapes';
import { SLAB_TOP } from './SceneBuilder';
import { ease, type Tweens } from './Tween';

class VRng {
  constructor(private s: number) {}
  next() {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  pick<T>(a: readonly T[]) {
    return a[Math.floor(this.next() * a.length)];
  }
}

function paintSlab(e: pc.Entity, hex: string) {
  setVColor(e, 'box', hex);
}

/** Per-rooftop look of unrestored ground: grey concrete, sun-baked clay, withered leaf litter. */
const DEAD_LOOK: Record<string, { base: readonly string[]; dark: string; crack: string; debris: string }> = {
  seed: { base: PALETTE.concrete, dark: PALETTE.concreteDark, crack: PALETTE.crack, debris: PALETTE.debris },
  reservoir: { base: ['#bda78a', '#b29c7f', '#c6b195', '#a99377'], dark: '#97806a', crack: '#6e5a48', debris: '#8a7560' },
  canopy: { base: ['#867c6a', '#7c7261', '#908571', '#776d5d'], dark: '#655c4e', crack: '#4e463b', debris: '#6b5a45' },
};

interface TileView {
  tile: TileData;
  root: pc.Entity;
  slab: pc.Entity;
  deco: pc.Entity;
  key: string;
  sway: pc.Entity[];
  swayPhase: number;
  /** Look 6.12: the slab colour drawn now (transitions blend from it) */
  slabHex?: string;
}

/** Look 6.12: mixes two sRGB hex colours (roof slabs blend in steps; one cached mesh per step). */
function mixHex(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * k);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}

/** Renders tiles from TileData. Listens to state; never decides rules. */
export class GridRenderer {
  private views = new Map<string, TileView>();
  private time = 0;
  reducedMotion = false;

  /** Tiles are batched in small regions (4×2 tiles), so a change only rebuilds its own region. */
  private regionGroups = new Map<string, number>();

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private tweens: Tweens,
    private batcher?: pc.BatchManager,
  ) {}

  private regionGroup(t: TileData): number {
    if (!this.batcher) return -1;
    const key = `${t.roofId}:${Math.floor(t.x / 4)}:${Math.floor(t.z / 2)}`;
    let id = this.regionGroups.get(key);
    if (id === undefined) {
      id = this.batcher.addGroup(`tiles-${key}`, true, 20).id;
      this.regionGroups.set(key, id);
    }
    return id;
  }

  build() {
    for (const roof of this.sim.grid.rooftops) this.addRoof(roof);
    for (const roof of this.sim.grid.clusterRoofs) this.addRoof(roof);
  }

  /** Tile views for one raised layer (a campaign rooftop, or a city rooftop cluster as it's revealed). */
  addRoof(roof: LayerData) {
    if (this.parent.findByName(`tiles-${roof.id}`)) return;
    const g = group(this.parent, `tiles-${roof.id}`);
    if (roof.cluster) this.clusterBuilding(roof);
    for (const t of this.sim.grid.tilesOf(roof.id)) {
      if (t.blocked) continue;
      const [x, y, z] = this.sim.grid.tileWorld(t);
      const root = group(g, t.id, [x, y, z]);
      const slab = shape(root, 'box', PALETTE.concrete[0], { scale: [0.96, 0.16, 0.96] });
      const deco = group(root, 'deco', [0, SLAB_TOP, 0]);
      const v: TileView = { tile: t, root, slab, deco, key: '', sway: [], swayPhase: (t.variant % 100) / 16 };
      this.views.set(t.id, v);
      this.refresh(t, false);
    }
  }

  /**
   * City 12.1: the old building holding a rooftop cluster up: walls with window bands under the roof, a parapet
   * and a stair hut. Grey and shuttered while out of reach, white once a relay reaches it.
   */
  clusterBuilding(roof: LayerData) {
    this.parent.findByName(`building-${roof.id}`)?.destroy();
    const alive = roof.unlocked && !roof.preview;
    const b = group(this.parent, `building-${roof.id}`, [roof.origin[0] + roof.width / 2, 0, roof.origin[2] + roof.depth / 2]);
    const H = roof.height - 0.02;
    const wall = alive ? '#f1ede3' : '#9d978c';
    shape(b, 'box', wall, { pos: [0, H / 2, 0], scale: [roof.width + 0.3, H, roof.depth + 0.3], shadow: true });
    const glass = alive ? '#9fd6e8' : '#4b4f54';
    for (let i = 0; i < 3; i++) {
      const y = H * (0.25 + i * 0.27);
      shape(b, 'box', glass, { pos: [0, y, roof.depth / 2 + 0.16], scale: [roof.width * 0.84, H * 0.11, 0.02] });
      shape(b, 'box', glass, { pos: [roof.width / 2 + 0.16, y, 0], scale: [0.02, H * 0.11, roof.depth * 0.84] });
    }
    // Parapet around the roof edge.
    const top = roof.height + 0.12;
    const pc = alive ? '#e2ddd0' : '#7f7b72';
    shape(b, 'box', pc, { pos: [0, top, -roof.depth / 2 - 0.1], scale: [roof.width + 0.3, 0.24, 0.1] });
    shape(b, 'box', pc, { pos: [0, top, roof.depth / 2 + 0.1], scale: [roof.width + 0.3, 0.24, 0.1] });
    shape(b, 'box', pc, { pos: [-roof.width / 2 - 0.1, top, 0], scale: [0.1, 0.24, roof.depth + 0.3] });
    shape(b, 'box', pc, { pos: [roof.width / 2 + 0.1, top, 0], scale: [0.1, 0.24, roof.depth + 0.3] });
    if (alive) for (let i = 0; i < 2; i++) shape(b, 'box', '#4f9a4a', { pos: [-roof.width / 2 + 0.6 + i * (roof.width - 1.2), H * 0.5, roof.depth / 2 + 0.17], scale: [0.14, H * 0.9, 0.03] });
  }

  view(id: string) {
    return this.views.get(id);
  }

  /** Per-rooftop transformation stage (0–4). From 25% on, leftover dead ground looks cleaner and weedier. */
  readonly stages: Record<string, number> = {};
  private stageOf(t: TileData) {
    return this.stages[t.roofId] ?? 0;
  }

  /** Changes one roof's stage and refreshes only its tiles. */
  setStage(roofId: string, stage: number) {
    if (this.stages[roofId] === stage) return;
    this.stages[roofId] = stage;
    for (const v of this.views.values()) if (v.tile.roofId === roofId) this.refresh(v.tile, false);
  }

  private keyOf(t: TileData) {
    const occ = t.occupantId ? 'o' : '';
    const band = t.ground === 'polluted' ? (t.pollution > 80 ? 2 : t.pollution > 40 ? 1 : 0) : 0;
    const st = this.stageOf(t);
    const clean = t.ground === 'polluted' ? Math.min(2, Math.floor(st / 2) + (st >= 1 ? 1 : 0)) : 0;
    return `${t.ground}|${t.bloom}|${occ}|${band}|${clean}`;
  }

  /** Slab footprint: lawns join up seamlessly; concrete and soil keep visible paver gaps. */
  private slabSize(t: TileData) {
    return t.ground === 'restored' ? 1.0 : 0.96;
  }

  /** Rebuilds a tile's look if its visual state changed. */
  refresh(t: TileData, animate: boolean) {
    const v = this.views.get(t.id);
    if (!v) return;
    const key = this.keyOf(t);
    if (key === v.key) return;
    const prevGround = v.key.split('|')[0];
    const prevBloom = Number(v.key.split('|')[1] ?? 0);
    v.key = key;
    // Retire old decoration
    const old = v.deco;
    const keepOld = animate && t.ground === 'restored' && prevGround === 'restored' && !t.occupantId;
    if (animate && !keepOld && old.children.length) {
      old.name = 'retiring';
      // Look 6.12: old props shrink away over the first part of the transition (not in a blink).
      const out = Math.max(0.3, (t.tr ? Math.max(0, t.tr.t0 + t.tr.d - this.sim.time) : 0.5) * 0.35);
      this.tweens.add(out, (k) => old.setLocalScale(1 - k, 1 - k, 1 - k), { done: () => old.destroy() });
    } else if (!keepOld) old.destroy();
    let deco: pc.Entity;
    if (keepOld) deco = old;
    else {
      deco = group(v.root, 'deco', [0, SLAB_TOP, 0]);
      v.sway = [];
    }
    v.deco = deco;
    const r = new VRng(t.variant * 7919 + 13);
    // Look 6.12: the slab colour is recorded, then blended in steps over the tile's transition (never swapped).
    const prevHex = v.slabHex;
    let slabHex = prevHex ?? PALETTE.concrete[0];
    const setVColor = (_e: pc.Entity, _p: 'box', hex: string) => {
      slabHex = hex;
    };
    const born: pc.Entity[] = [];
    const add = (e: pc.Entity) => {
      born.push(e);
      return e;
    };

    switch (t.ground) {
      case 'polluted': {
        const look = DEAD_LOOK[this.sim.grid.layer(t.roofId)?.template ?? t.roofId] ?? DEAD_LOOK.seed;
        const shade = t.pollution > 80 ? look.dark : look.base[t.variant % look.base.length];
        setVColor(v.slab, 'box', shade);
        const cracks = 1 + (t.variant % 3 === 0 ? 1 : 0) + (t.pollution > 80 ? 1 : 0);
        for (let i = 0; i < cracks; i++)
          add(shape(deco, 'box', look.crack, { pos: [r.range(-0.2, 0.2), 0.004, r.range(-0.2, 0.2)], scale: [r.range(0.35, 0.7), 0.01, 0.035], rot: [0, r.range(0, 180), 0] }));
        const st = this.stageOf(t);
        const clean = st >= 1;
        if (!clean && r.next() < 0.55)
          for (let i = 0; i < 1 + (t.variant % 2); i++) {
            const s = r.range(0.06, 0.12);
            add(shape(deco, 'box', look.debris, { pos: [r.range(-0.35, 0.35), s / 2, r.range(-0.35, 0.35)], scale: s, rot: [r.range(0, 40), r.range(0, 90), r.range(0, 40)], shadow: true }));
          }
        if (r.next() < 0.3) add(shape(deco, 'cone', PALETTE.weed, { pos: [r.range(-0.3, 0.3), 0.05, r.range(-0.3, 0.3)], scale: [0.06, 0.1, 0.06] }));
        if (clean) {
          // Life finds the cracks: weeds and the odd tiny flower.
          const n = st >= 2 ? 3 : 2;
          for (let i = 0; i < n; i++) add(shape(deco, 'cone', '#79a957', { pos: [r.range(-0.35, 0.35), 0.05, r.range(-0.35, 0.35)], scale: [0.05, 0.1, 0.05] }));
          if (st >= 2 && t.variant % 2) add(shape(deco, 'sphere', r.pick(PALETTE.flower), { pos: [r.range(-0.3, 0.3), 0.08, r.range(-0.3, 0.3)], scale: 0.06 }));
        }
        break;
      }
      case 'prepared': {
        setVColor(v.slab, 'box', PALETTE.soil);
        if (!t.occupantId) {
          const n = 3 + (t.variant % 3);
          for (let i = 0; i < n; i++) {
            const s = r.range(0.14, 0.26);
            add(shape(deco, 'sphere', PALETTE.moss, { pos: [r.range(-0.3, 0.3), 0.005, r.range(-0.3, 0.3)], scale: [s, 0.05, s * r.range(0.7, 1)] }));
          }
          add(shape(deco, 'sphere', PALETTE.soilDark, { pos: [r.range(-0.3, 0.3), 0.01, r.range(-0.3, 0.3)], scale: [0.07, 0.05, 0.06] }));
        }
        break;
      }
      case 'growing': {
        setVColor(v.slab, 'box', PALETTE.soil);
        for (let i = 0; i < 5; i++) {
          const sp = add(group(deco, 'sprout', [r.range(-0.3, 0.3), 0, r.range(-0.3, 0.3)]));
          shape(sp, 'cone', PALETTE.grassTuft[i % 3], { pos: [0, 0.06, 0], scale: [0.05, 0.12, 0.05] });
          shape(sp, 'sphere', PALETTE.grassTuft[2], { pos: [0.03, 0.11, 0], scale: [0.06, 0.02, 0.04] });
        }
        break;
      }
      case 'restored': {
        setVColor(v.slab, 'box', PALETTE.grass[t.variant % PALETTE.grass.length]);
        if (t.occupantId) break;
        if (!keepOld) {
          const tufts = 8 + (t.variant % 3);
          for (let i = 0; i < tufts; i++) {
            const h = r.range(0.09, 0.2);
            add(shape(deco, 'cone', PALETTE.grassTuft[i % 3], { pos: [r.range(-0.44, 0.44), h / 2, r.range(-0.44, 0.44)], scale: [0.055, h, 0.055], rot: [r.range(-12, 12), 0, r.range(-12, 12)] }));
          }
          if (t.variant % 4 === 0) add(shape(deco, 'sphere', '#9be07a', { pos: [r.range(-0.3, 0.3), 0.02, r.range(-0.3, 0.3)], scale: [0.2, 0.05, 0.2] }));
        }
        const fr = new VRng(t.variant * 31 + 5);
        if (t.bloom >= 2 && (!keepOld || prevBloom < 2)) {
          const n = 3 + (t.variant % 3);
          for (let i = 0; i < n; i++) {
            const h = fr.range(0.14, 0.28);
            const f = add(group(deco, 'flower', [fr.range(-0.36, 0.36), 0, fr.range(-0.36, 0.36)]));
            shape(f, 'cylinder', PALETTE.stem, { pos: [0, h / 2, 0], scale: [0.02, h, 0.02] });
            switch ((t.variant + i) % 4) {
              case 0: // cosmos
                shape(f, 'sphere', fr.pick(PALETTE.flower), { pos: [0, h, 0], scale: [0.11, 0.07, 0.11] });
                shape(f, 'sphere', PALETTE.flowerCore, { pos: [0, h + 0.03, 0], scale: 0.04 });
                break;
              case 1: // daisy
                shape(f, 'sphere', '#ffffff', { pos: [0, h, 0], scale: [0.13, 0.025, 0.13] });
                shape(f, 'sphere', '#ffc93c', { pos: [0, h + 0.015, 0], scale: [0.05, 0.03, 0.05] });
                break;
              case 2: // lavender spike
                for (let k = 0; k < 4; k++) shape(f, 'sphere', k % 2 ? '#9a7be0' : '#b48cff', { pos: [0, h + k * 0.045, 0], scale: 0.055 - k * 0.008 });
                break;
              default: // tulip
                shape(f, 'sphere', fr.pick(['#ff6b6b', '#ff9a5a', '#ff7eb6']), { pos: [0, h + 0.02, 0], scale: [0.07, 0.1, 0.07] });
                shape(f, 'sphere', '#5fb24a', { pos: [0.03, h * 0.45, 0], scale: [0.06, 0.02, 0.03], rot: [0, 0, 40] });
            }
            v.sway.push(f);
          }
        }
        if (t.bloom >= 3 && (!keepOld || prevBloom < 3)) {
          const kind = t.variant % 5;
          const p: [number, number, number] = [fr.range(-0.15, 0.15), 0, fr.range(-0.15, 0.15)];
          const g = add(group(deco, 'big', p));
          if (kind === 1) {
            shape(g, 'cylinder', PALETTE.trunk, { pos: [0, 0.22, 0], scale: [0.07, 0.44, 0.07], shadow: true });
            shape(g, 'sphere', PALETTE.shrub[0], { pos: [0, 0.55, 0], scale: [0.48, 0.42, 0.48], shadow: true });
            shape(g, 'sphere', PALETTE.shrub[1], { pos: [0.12, 0.72, 0.05], scale: [0.3, 0.26, 0.3], shadow: true });
            if (t.variant % 2) shape(g, 'sphere', '#ff9fb8', { pos: [-0.16, 0.62, 0.12], scale: 0.08 });
          } else if (kind === 3) {
            // sunflowers
            for (let i = 0; i < 3; i++) {
              const h = 0.42 + i * 0.08;
              const sx = (i - 1) * 0.14;
              shape(g, 'cylinder', '#4f9a3c', { pos: [sx, h / 2, (i % 2) * 0.08], scale: [0.03, h, 0.03], shadow: true });
              shape(g, 'sphere', '#5fb24a', { pos: [sx + 0.05, h * 0.5, (i % 2) * 0.08], scale: [0.11, 0.025, 0.06], rot: [0, 0, 30] });
              const head = group(g, 'head', [sx, h, (i % 2) * 0.08]);
              head.setLocalEulerAngles(-35, 45, 0); // faces the camera
              shape(head, 'cylinder', '#ffc93c', { scale: [0.19, 0.02, 0.19], shadow: true });
              shape(head, 'cylinder', '#6b4423', { pos: [0, 0.012, 0], scale: [0.09, 0.02, 0.09] });
            }
          } else if (kind === 4) {
            // lavender bed
            for (let i = 0; i < 7; i++) {
              const sp = group(g, 'spike', [fr.range(-0.3, 0.3), 0, fr.range(-0.3, 0.3)]);
              const h = fr.range(0.2, 0.32);
              shape(sp, 'cylinder', '#6c9a5a', { pos: [0, h / 2, 0], scale: [0.02, h, 0.02] });
              for (let k = 0; k < 4; k++) shape(sp, 'sphere', k % 2 ? '#8f6fd6' : '#b48cff', { pos: [0, h + k * 0.05, 0], scale: 0.065 - k * 0.01 });
            }
          } else {
            for (let i = 0; i < 3; i++) {
              const s = fr.range(0.24, 0.34);
              shape(g, 'sphere', PALETTE.shrub[i], { pos: [fr.range(-0.12, 0.12), s / 2.2, fr.range(-0.12, 0.12)], scale: [s, s * 0.85, s], shadow: true });
            }
            if (kind === 2) for (let i = 0; i < 4; i++) shape(g, 'sphere', fr.pick(PALETTE.flower), { pos: [fr.range(-0.15, 0.15), 0.26 + fr.range(0, 0.06), fr.range(-0.15, 0.15)], scale: 0.07 });
          }
          v.sway.push(g);
        }
        if (t.bloom >= 4 && (!keepOld || prevBloom < 4)) {
          // Phase 4 E05: Radiant: luminous golden flowers and a soft glow disk.
          const g = add(group(deco, 'radiant', [0, 0, 0]));
          shape(g, 'cylinder', '#fff1b8', { pos: [0, 0.005, 0], scale: [0.86, 0.01, 0.86] });
          for (let i = 0; i < 4; i++) {
            const h = fr.range(0.3, 0.46);
            const f = group(g, 'gold', [fr.range(-0.34, 0.34), 0, fr.range(-0.34, 0.34)]);
            shape(f, 'cylinder', PALETTE.stem, { pos: [0, h / 2, 0], scale: [0.02, h, 0.02] });
            shape(f, 'sphere', i % 2 ? '#ffe066' : '#fff6c2', { pos: [0, h, 0], scale: [0.13, 0.1, 0.13] });
            v.sway.push(f);
          }
        }
        break;
      }
    }

    // Look 6.12: how long this change plays (the tile's transition, from the sim), and its prop windows.
    const tr = t.tr;
    const left = tr ? Math.max(0, tr.t0 + tr.d - this.sim.time) : 0;
    const dur = animate ? Math.max(0.45, left || 0.45) : 0;
    const inStart = tr?.k === 'restore' ? 0.7 : tr?.k === 'moss' ? 0.3 : 0;
    const slabFrom = animate && prevHex && prevHex !== slabHex ? prevHex : undefined;
    v.slabHex = slabHex;
    paintSlab(v.slab, slabFrom ?? slabHex);
    if (slabFrom) {
      const target = slabHex;
      let step = 0;
      this.tweens.add(dur * (tr?.k === 'restore' ? 0.9 : 0.8), (k) => {
        const st = Math.min(6, Math.floor(k * 6.999));
        if (st === step) return;
        step = st;
        paintSlab(v.slab, mixHex(slabFrom, target, st / 6));
        const g = this.regionGroup(t);
        if (g >= 0) {
          assignBatch(v.root, g);
          this.batcher!.markGroupDirty(g);
        }
      }, { ease: ease.linear, done: () => paintSlab(v.slab, target) });
    }
    const gid = this.regionGroup(t);
    if (gid >= 0) {
      assignBatch(v.root, gid); // slab material may have changed too
      this.batcher!.markGroupDirty(gid);
    }
    const size = this.slabSize(t);
    if (!animate) v.slab.setLocalScale(size, 0.16, size);
    if (animate) {
      // Slab squash-and-stretch
      this.tweens.cancel(v.slab);
      this.tweens.add(0.45, (k) => {
        const s = 1 + Math.sin(k * Math.PI) * 0.35 * (1 - k);
        v.slab.setLocalScale(size * (2 - s), 0.16 * s, size * (2 - s));
      }, { owner: v.slab, ease: ease.linear, done: () => v.slab.setLocalScale(size, 0.16, size) });
      // Look 6.12: new props grow in inside the transition's window, staggered across the tile.
      const growDur = Math.max(0.3, dur * (1 - inStart) * 0.7);
      const stagger = born.length > 1 ? (dur * (1 - inStart) * 0.3) / (born.length - 1) : 0;
      born.forEach((e, i) => {
        const base = e.getLocalScale().clone();
        e.setLocalScale(0, 0, 0);
        this.tweens.add(growDur, (k) => e.setLocalScale(base.x * k, base.y * k, base.z * k), {
          delay: dur * inStart + i * stagger,
          ease: this.reducedMotion ? ease.outCubic : t.ground === 'growing' ? ease.outCubic : ease.outBack,
        });
      });
    }
  }

  /** Gentle "no" wiggle when an action can't happen on this tile. */
  shake(t: TileData) {
    const v = this.views.get(t.id);
    if (!v) return;
    const [x, y, z] = this.sim.grid.tileWorld(t);
    this.tweens.cancel(v.root);
    this.tweens.add(0.35, (k) => {
      const a = this.reducedMotion ? 0 : Math.sin(k * Math.PI * 6) * 0.06 * (1 - k);
      v.root.setPosition(x + a, y, z - a);
    }, { owner: v.root, ease: ease.linear, done: () => v.root.setPosition(x, y, z) });
  }

  refreshAll() {
    for (const v of this.views.values()) this.refresh(v.tile, false);
  }

  update(dt: number) {
    this.time += dt;
    if (this.reducedMotion) return;
    const tm = this.time;
    for (const v of this.views.values()) {
      if (!v.sway.length) continue;
      const a = Math.sin(tm * 1.6 + v.swayPhase) * 4;
      const b = Math.cos(tm * 1.3 + v.swayPhase * 1.7) * 3;
      for (const e of v.sway) e.setLocalEulerAngles(a, 0, b);
    }
  }
}
