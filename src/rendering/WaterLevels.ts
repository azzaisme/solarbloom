import * as pc from 'playcanvas';
import { GROUND } from '../core/GameState';
import { levelY } from '../core/Height';
import type { TileData } from '../core/types';
import { WATER_NET } from '../data/water';
import type { Sim } from '../gameplay/Sim';
import { WaterSystem, type WaterBody } from '../gameplay/WaterSystem';
import { GROUND_TEX_METRES, groundTexMaterial } from './GroundTex';
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
    /** a body's look stepped: its tiles' lily pads move to the water still there (the chunks redraw them) */
    private onStep?: (tiles: TileData[]) => void,
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
      const first = v.step < 0;
      v.step = step;
      this.drop(v);
      if (step > 0) this.build(v, b, step / WATER_NET.lookSteps);
      if (!first || step > 0) this.onStep?.([...b.tiles].map((id) => this.sim.grid.byTileId(id)).filter((t): t is TileData => !!t));
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

  private build(v: View, b: WaterBody, empty: number) {
    const { d, count, max } = this.sim.water.depths(b);
    const g = this.sim.grid;
    const tiles = [...b.tiles].map((id) => g.byTileId(id)).filter((t): t is TileData => !!t);
    const base = g.layer(GROUND)!.height;
    const front = WaterSystem.front(count, max, empty);
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
    // the bared bed wears the painted silt a dead pond has (GroundTex `silt-bed`), the wet line a glossy dark band
    if (bed.length) {
      const m = this.mesh(bed, true);
      v.meshes.push(m);
      parts.push(new pc.MeshInstance(m, groundTexMaterial(this.device, 'silt-bed')));
    }
    if (rim.length) {
      const m = this.mesh(rim);
      v.meshes.push(m);
      parts.push(new pc.MeshInstance(m, mat(PALETTE.aqua.bedWet, { gloss: 0.7 })));
    }
    e.addComponent('render', { meshInstances: parts, castShadows: false, receiveShadows: true });
    this.parent.addChild(e);
    v.entity = e;
  }

  /**
   * Flat up-facing quads (4 corners each, in order) as one mesh; `painted`: with the painted ground's world-space
   * texture coordinates and a white tint (GroundTex's material reads both).
   */
  private mesh(pos: number[], painted = false): pc.Mesh {
    const idx: number[] = [];
    const nrm: number[] = [];
    for (let i = 0; i < pos.length / 3; i += 4) idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
    for (let i = 0; i < pos.length; i += 3) nrm.push(0, 1, 0);
    const m = new pc.Mesh(this.device);
    m.setPositions(pos);
    m.setNormals(nrm);
    if (painted) {
      const uv: number[] = [];
      const col: number[] = [];
      for (let i = 0; i < pos.length; i += 3) {
        uv.push(pos[i] / GROUND_TEX_METRES['silt-bed'], pos[i + 2] / GROUND_TEX_METRES['silt-bed']);
        col.push(255, 255, 255, 255);
      }
      m.setUvs(0, uv);
      m.setColors32(col);
    }
    m.setIndices(idx);
    m.update(pc.PRIMITIVE_TRIANGLES);
    return m;
  }

  destroy() {
    for (const v of this.views.values()) this.drop(v);
    this.views.clear();
  }
}
