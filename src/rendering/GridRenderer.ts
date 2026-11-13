import * as pc from 'playcanvas';
import type { TileData } from '../core/types';
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

interface TileView {
  tile: TileData;
  root: pc.Entity;
  slab: pc.Entity;
  deco: pc.Entity;
  key: string;
  sway: pc.Entity[];
  swayPhase: number;
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
    for (const roof of this.sim.state.rooftops) {
      if (roof.preview) continue; // preview rooftops are drawn by SceneBuilder
      const g = group(this.parent, `tiles-${roof.id}`);
      for (const t of roof.tiles) {
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
  }

  view(id: string) {
    return this.views.get(id);
  }

  private keyOf(t: TileData) {
    const occ = t.occupantId ? 'o' : '';
    const band = t.ground === 'polluted' ? (t.pollution > 80 ? 2 : t.pollution > 40 ? 1 : 0) : 0;
    return `${t.ground}|${t.bloom}|${occ}|${band}`;
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
      this.tweens.add(0.18, (k) => old.setLocalScale(1 - k, 1 - k, 1 - k), { done: () => old.destroy() });
    } else if (!keepOld) old.destroy();
    let deco: pc.Entity;
    if (keepOld) deco = old;
    else {
      deco = group(v.root, 'deco', [0, SLAB_TOP, 0]);
      v.sway = [];
    }
    v.deco = deco;
    const r = new VRng(t.variant * 7919 + 13);
    const born: pc.Entity[] = [];
    const add = (e: pc.Entity) => {
      born.push(e);
      return e;
    };

    switch (t.ground) {
      case 'polluted': {
        const shade = t.pollution > 80 ? PALETTE.concreteDark : PALETTE.concrete[t.variant % PALETTE.concrete.length];
        setVColor(v.slab, 'box', shade);
        const cracks = 1 + (t.variant % 3 === 0 ? 1 : 0) + (t.pollution > 80 ? 1 : 0);
        for (let i = 0; i < cracks; i++)
          add(shape(deco, 'box', PALETTE.crack, { pos: [r.range(-0.2, 0.2), 0.004, r.range(-0.2, 0.2)], scale: [r.range(0.35, 0.7), 0.01, 0.035], rot: [0, r.range(0, 180), 0] }));
        if (r.next() < 0.55)
          for (let i = 0; i < 1 + (t.variant % 2); i++) {
            const s = r.range(0.06, 0.12);
            add(shape(deco, 'box', PALETTE.debris, { pos: [r.range(-0.35, 0.35), s / 2, r.range(-0.35, 0.35)], scale: s, rot: [r.range(0, 40), r.range(0, 90), r.range(0, 40)], shadow: true }));
          }
        if (r.next() < 0.3) add(shape(deco, 'cone', PALETTE.weed, { pos: [r.range(-0.3, 0.3), 0.05, r.range(-0.3, 0.3)], scale: [0.06, 0.1, 0.06] }));
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
          const tufts = 5 + (t.variant % 3);
          for (let i = 0; i < tufts; i++) {
            const h = r.range(0.1, 0.2);
            add(shape(deco, 'cone', PALETTE.grassTuft[i % 3], { pos: [r.range(-0.38, 0.38), h / 2, r.range(-0.38, 0.38)], scale: [0.07, h, 0.07], rot: [r.range(-10, 10), 0, r.range(-10, 10)] }));
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
            const c = fr.pick(PALETTE.flower);
            shape(f, 'sphere', c, { pos: [0, h, 0], scale: [0.11, 0.07, 0.11], shadow: false });
            shape(f, 'sphere', PALETTE.flowerCore, { pos: [0, h + 0.03, 0], scale: 0.04 });
            v.sway.push(f);
          }
        }
        if (t.bloom >= 3 && (!keepOld || prevBloom < 3)) {
          const kind = t.variant % 3;
          const p: [number, number, number] = [fr.range(-0.15, 0.15), 0, fr.range(-0.15, 0.15)];
          const g = add(group(deco, 'big', p));
          if (kind === 1) {
            shape(g, 'cylinder', PALETTE.trunk, { pos: [0, 0.22, 0], scale: [0.07, 0.44, 0.07], shadow: true });
            shape(g, 'sphere', PALETTE.shrub[0], { pos: [0, 0.55, 0], scale: [0.48, 0.42, 0.48], shadow: true });
            shape(g, 'sphere', PALETTE.shrub[1], { pos: [0.12, 0.72, 0.05], scale: [0.3, 0.26, 0.3], shadow: true });
            if (t.variant % 2) shape(g, 'sphere', '#ff9fb8', { pos: [-0.16, 0.62, 0.12], scale: 0.08 });
          } else {
            for (let i = 0; i < 3; i++) {
              const s = fr.range(0.24, 0.34);
              shape(g, 'sphere', PALETTE.shrub[i], { pos: [fr.range(-0.12, 0.12), s / 2.2, fr.range(-0.12, 0.12)], scale: [s, s * 0.85, s], shadow: true });
            }
            if (kind === 2) for (let i = 0; i < 4; i++) shape(g, 'sphere', fr.pick(PALETTE.flower), { pos: [fr.range(-0.15, 0.15), 0.26 + fr.range(0, 0.06), fr.range(-0.15, 0.15)], scale: 0.07 });
          }
          v.sway.push(g);
        }
        break;
      }
    }

    const gid = this.regionGroup(t);
    if (gid >= 0) {
      assignBatch(v.root, gid); // slab material may have changed too
      this.batcher!.markGroupDirty(gid);
    }
    if (animate) {
      // Slab squash-and-stretch
      this.tweens.cancel(v.slab);
      this.tweens.add(0.45, (k) => {
        const s = 1 + Math.sin(k * Math.PI) * 0.35 * (1 - k);
        v.slab.setLocalScale(0.96 * (2 - s), 0.16 * s, 0.96 * (2 - s));
      }, { owner: v.slab, ease: ease.linear, done: () => v.slab.setLocalScale(0.96, 0.16, 0.96) });
      const growDur = t.ground === 'growing' ? Math.max(0.3, t.growthRemainingSec) : 0.38;
      born.forEach((e, i) => {
        const base = e.getLocalScale().clone();
        e.setLocalScale(0, 0, 0);
        this.tweens.add(growDur, (k) => e.setLocalScale(base.x * k, base.y * k, base.z * k), {
          delay: this.reducedMotion ? 0 : i * 0.03,
          ease: t.ground === 'growing' ? ease.outCubic : ease.outBack,
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
