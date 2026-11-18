import * as pc from 'playcanvas';
import { GROUND } from '../core/GameState';
import { levelY } from '../core/Height';
import type { TileData } from '../core/types';
import { WATER_NET } from '../data/water';
import type { Sim } from '../gameplay/Sim';
import type { WaterBody } from '../gameplay/WaterSystem';
import { mat } from './Materials';
import { PALETTE } from './Palette';
import { WATER } from './Water';

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

interface View {
  step: number;
  entity?: pc.Entity;
  meshes: pc.Mesh[];
}

/**
 * E23.4.1 (#381): water levels shown on the water itself. As a body drains, its bed shows from the banks inward:
 * damp silt creeping over the water from every shore, with a darker wet line at the waterline. A full body draws
 * nothing; an empty one is all bed. The bed's area matches the share drained. Rebuilt only when a level crosses a
 * step.
 */
export class WaterLevels {
  private views = new Map<string, View>();
  private seen = -1;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private device: pc.GraphicsDevice,
  ) {}

  update() {
    const w = this.sim.water;
    if (w.version === this.seen && this.views.size) return;
    this.seen = w.version;
    const live = new Set<string>();
    for (const b of w.live()) {
      live.add(b.id);
      const step = Math.round((1 - w.levelOf(b.id)) * WATER_NET.lookSteps);
      const v = this.views.get(b.id) ?? { step: -1, meshes: [] };
      this.views.set(b.id, v);
      if (v.step === step) continue;
      v.step = step;
      this.drop(v);
      if (step > 0) this.build(v, b, step / WATER_NET.lookSteps);
    }
    for (const [id, v] of this.views) {
      if (live.has(id)) continue;
      this.drop(v);
      this.views.delete(id);
    }
  }

  private drop(v: View) {
    v.entity?.destroy();
    for (const m of v.meshes) m.destroy();
    v.entity = undefined;
    v.meshes = [];
  }

  /** How far each tile lies from the bank (1 = on it), by breadth-first walk inward. */
  private depths(b: WaterBody): { tiles: TileData[]; d: Map<string, number>; max: number } {
    const g = this.sim.grid;
    const tiles = [...b.tiles].map((id) => g.byTileId(id)).filter((t): t is TileData => !!t);
    const d = new Map<string, number>();
    const queue: TileData[] = [];
    for (const t of tiles)
      if (SIDES.some(([dx, dz]) => !b.tiles.has(g.peek(GROUND, t.x + dx, t.z + dz)?.id ?? ''))) {
        d.set(t.id, 1);
        queue.push(t);
      }
    let max = 1;
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i];
      const k = d.get(t.id)!;
      for (const [dx, dz] of SIDES) {
        const n = g.peek(GROUND, t.x + dx, t.z + dz);
        if (!n || !b.tiles.has(n.id) || d.has(n.id)) continue;
        d.set(n.id, k + 1);
        max = Math.max(max, k + 1);
        queue.push(n);
      }
    }
    return { tiles, d, max };
  }

  /**
   * How far in from the bank the bed shows (tiles), so the bed's area matches the share drained: each tile at
   * depth k shows `clamp(front − (k − 1), 0, 1)` of itself, and those add up to `empty` × the body's area.
   */
  static front(depths: number[], max: number, empty: number): number {
    const want = empty * depths.length;
    const count = new Array<number>(max + 2).fill(0);
    for (const k of depths) count[k]++;
    let done = 0;
    for (let k = 1; k <= max; k++) {
      if (done + count[k] >= want) return k - 1 + (count[k] ? (want - done) / count[k] : 0);
      done += count[k];
    }
    return max;
  }

  private build(v: View, b: WaterBody, empty: number) {
    const { tiles, d, max } = this.depths(b);
    const g = this.sim.grid;
    const base = g.layer(GROUND)!.height;
    const front = WaterLevels.front(tiles.map((t) => d.get(t.id)!), max, empty);
    const bed: number[] = [];
    const rim: number[] = [];
    const quad = (out: number[], x0: number, z0: number, x1: number, z1: number, y: number) => out.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
    const RIM = 0.1;
    for (const t of tiles) {
      const k = d.get(t.id)!;
      const e = Math.max(0, Math.min(1, front - (k - 1)));
      if (e <= 0) continue;
      const y = base + levelY(t.level ?? 1) + 0.09 - WATER.drop;
      if (e >= 1) {
        quad(bed, t.x, t.z, t.x + 1, t.z + 1, y);
        continue;
      }
      // a strip in from each side that faces the bank (or a tile nearer it), with a wet line at the water's edge
      // (clipped where a strip from the next side already covers the corner)
      const r = Math.min(RIM, e);
      const bank = SIDES.map(([dx, dz]) => {
        const n = g.peek(GROUND, t.x + dx, t.z + dz);
        return (n && b.tiles.has(n.id) ? d.get(n.id)! : 0) < k;
      });
      const [px, nx, pz, nz] = bank.map((on) => (on ? e : 0));
      if (bank[0]) {
        quad(bed, t.x + 1 - e, t.z, t.x + 1, t.z + 1, y);
        quad(rim, t.x + 1 - e, t.z + nz, t.x + 1 - e + r, t.z + 1 - pz, y + 0.003);
      }
      if (bank[1]) {
        quad(bed, t.x, t.z, t.x + e, t.z + 1, y);
        quad(rim, t.x + e - r, t.z + nz, t.x + e, t.z + 1 - pz, y + 0.003);
      }
      if (bank[2]) {
        quad(bed, t.x, t.z + 1 - e, t.x + 1, t.z + 1, y);
        quad(rim, t.x + nx, t.z + 1 - e, t.x + 1 - px, t.z + 1 - e + r, y + 0.003);
      }
      if (bank[3]) {
        quad(bed, t.x, t.z, t.x + 1, t.z + e, y);
        quad(rim, t.x + nx, t.z + e - r, t.x + 1 - px, t.z + e, y + 0.003);
      }
    }
    if (!bed.length) return;
    const e = new pc.Entity(`water-bed-${b.id}`);
    const parts: pc.MeshInstance[] = [];
    for (const [pos, colour] of [
      [bed, PALETTE.aqua.bed],
      [rim, PALETTE.aqua.bedWet],
    ] as const) {
      if (!pos.length) continue;
      const m = this.mesh(pos);
      v.meshes.push(m);
      parts.push(new pc.MeshInstance(m, mat(colour, { gloss: colour === PALETTE.aqua.bedWet ? 0.7 : 0.3 })));
    }
    e.addComponent('render', { meshInstances: parts, castShadows: false, receiveShadows: true });
    this.parent.addChild(e);
    v.entity = e;
  }

  /** Flat up-facing quads (4 corners each, in order) as one mesh. */
  private mesh(pos: number[]): pc.Mesh {
    const idx: number[] = [];
    const nrm: number[] = [];
    for (let i = 0; i < pos.length / 3; i += 4) idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
    for (let i = 0; i < pos.length; i += 3) nrm.push(0, 1, 0);
    const m = new pc.Mesh(this.device);
    m.setPositions(pos);
    m.setNormals(nrm);
    m.setIndices(idx);
    m.update(pc.PRIMITIVE_TRIANGLES);
    return m;
  }

  destroy() {
    for (const v of this.views.values()) this.drop(v);
    this.views.clear();
  }
}
