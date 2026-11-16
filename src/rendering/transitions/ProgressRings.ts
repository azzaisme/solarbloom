import * as pc from 'playcanvas';
import type { TileData } from '../../core/types';
import { TUNING } from '../../data/tuning';
import type { Sim } from '../../gameplay/Sim';
import { mat } from '../Materials';
import { group, shape } from '../Shapes';

const SEGMENTS = 12;
const MAX = 12;
const COL = { soften: '#e8d9a8', grow: '#8fe36a', dim: '#3b3f3a' } as const;

interface Ring {
  root: pc.Entity;
  segs: pc.Entity[];
  icon: pc.Entity;
  lit: number;
  phase: string;
}

/**
 * Look 6.10 (#179): a subtle progress ring on tiles mid-process (the Cultivator's tiles and tiles still growing in
 * the sim), near zoom only. A pooled handful of rings (12 segments each, lit by progress); the centre pip is the
 * stage icon: sand while the slab softens, green while it grows. Hidden at mid and far zoom and with nothing to show.
 */
export class ProgressRings {
  private pool: Ring[] = [];
  /** camera zoom from which rings show */
  minZoom = 1.35;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
  ) {}

  private ring(i: number): Ring {
    let r = this.pool[i];
    if (r) return r;
    const root = group(this.parent, `progress-ring-${i}`);
    const segs: pc.Entity[] = [];
    for (let k = 0; k < SEGMENTS; k++) {
      const a = (k / SEGMENTS) * Math.PI * 2;
      const s = shape(root, 'box', mat(COL.dim, { unlit: true }), { pos: [Math.sin(a) * 0.36, 0, Math.cos(a) * 0.36], scale: [0.12, 0.012, 0.05], rot: [0, (a * 180) / Math.PI, 0] });
      segs.push(s);
    }
    const icon = shape(root, 'cylinder', mat(COL.soften, { unlit: true }), { scale: [0.09, 0.015, 0.09] });
    r = { root, segs, icon, lit: -1, phase: '' };
    this.pool[i] = r;
    return r;
  }

  /** Progress (0..1) and phase of a tile's gameplay process, or undefined when it has none. */
  private state(t: TileData): { p: number; phase: 'soften' | 'grow' } | undefined {
    const s = this.sim;
    if (t.ground === 'growing') {
      const on = s.cultivators.unitOn(t.id);
      const total = on ? TUNING.cultivator.growSeconds / s.cultivators.speed(on.m) : TUNING.pulse.growSeconds;
      return { p: 1 - Math.max(0, t.growthRemainingSec) / Math.max(0.01, total), phase: 'grow' };
    }
    if (t.ground === 'polluted' && t.tr?.g && t.tr.k === 'soften') {
      const from = t.tr.from ?? 100;
      return { p: 1 - t.pollution / Math.max(1, from), phase: 'soften' };
    }
    return undefined;
  }

  update(zoom: number, focus: { x: number; z: number }) {
    const show: { t: TileData; p: number; phase: 'soften' | 'grow' }[] = [];
    if (zoom >= this.minZoom) {
      const cands = [...this.sim.cultivators.working(), ...this.sim.restoration.growingTiles()];
      const seen = new Set<string>();
      for (const t of cands) {
        if (seen.has(t.id) || t.roofId !== 'g') continue;
        seen.add(t.id);
        if (Math.abs(t.x - focus.x) > 14 || Math.abs(t.z - focus.z) > 10) continue;
        const st = this.state(t);
        if (st) show.push({ t, ...st });
      }
      show.sort((a, b) => Math.hypot(a.t.x - focus.x, a.t.z - focus.z) - Math.hypot(b.t.x - focus.x, b.t.z - focus.z));
    }
    const h = this.sim.grid.layer('g')?.height ?? 0;
    for (let i = 0; i < Math.max(this.pool.length, Math.min(MAX, show.length)); i++) {
      const it = show[i];
      if (!it || i >= MAX) {
        if (this.pool[i]) this.pool[i].root.enabled = false;
        continue;
      }
      const r = this.ring(i);
      r.root.enabled = true;
      r.root.setLocalPosition(it.t.x + 0.5, h + 0.13, it.t.z + 0.5);
      const lit = Math.round(Math.max(0, Math.min(1, it.p)) * SEGMENTS);
      if (lit !== r.lit || it.phase !== r.phase) {
        const on = mat(it.phase === 'soften' ? COL.soften : COL.grow, { unlit: true });
        const off = mat(COL.dim, { unlit: true });
        r.segs.forEach((s, k) => (s.render!.meshInstances[0].material = k < lit ? on : off));
        r.icon.render!.meshInstances[0].material = on;
        r.lit = lit;
        r.phase = it.phase;
      }
    }
  }

  /** Rings showing now (hud-overlap and tests). */
  get visible(): number {
    return this.pool.filter((r) => r.root.enabled).length;
  }
}
