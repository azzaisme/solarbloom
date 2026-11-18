import * as pc from 'playcanvas';
import { GROUND } from '../core/GameState';
import { PATH_MATERIAL, PATHS } from '../data/paths';
import { pathCurve, type PathData } from '../gameplay/Paths';
import type { Sim } from '../gameplay/Sim';
import { SLAB_TOP } from './SceneBuilder';

/**
 * E23.6.7 (#472): how paths look. Each path is a ground decal: a strip following its smooth curve, as wide as the
 * path, sitting on the land (each vertex at the ground's own height there, so a path steps down a terrace with it).
 * Its edges blend into the grass: the outer quarter of the width fades from the path's colour to its edge colour.
 * Stepping stones and boardwalk planks are drawn as separate pieces along the curve. All paths share one mesh and
 * one material (vertex colours): one draw call however many there are. Rebuilt only when a path changes.
 */
export class PathVisuals {
  private entity?: pc.Entity;
  private dirty = true;
  /** the decal's triangles (for budgets) */
  tris = 0;
  private material?: pc.StandardMaterial;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private device: () => pc.GraphicsDevice,
  ) {
    sim.bus.on('paths.changed', () => (this.dirty = true));
  }

  /** A draft being drawn (the points placed so far and the spot under the cursor), shown until it is laid. */
  draft?: Omit<PathData, 'id'>;
  setDraft(d: Omit<PathData, 'id'> | undefined) {
    this.draft = d;
    this.dirty = true;
  }

  private mat(): pc.StandardMaterial {
    if (this.material) return this.material;
    const m = new pc.StandardMaterial();
    m.diffuse = new pc.Color(1, 1, 1);
    m.diffuseVertexColor = true;
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = 0.15;
    m.update();
    return (this.material = m);
  }

  private y(x: number, z: number): number {
    const r = this.sim.grid.roof(GROUND);
    return (r ? r.origin[1] + r.height : 0) + SLAB_TOP + this.sim.grid.groundOffset(GROUND, Math.floor(x), Math.floor(z)) + PATHS.lift;
  }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    this.entity?.destroy();
    this.entity = undefined;
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const paths: (Omit<PathData, 'id'> & { draft?: boolean })[] = [...this.sim.paths.all()];
    if (this.draft && this.draft.pts.length >= 2) paths.push({ ...this.draft, draft: true });
    const r = this.sim.grid.roof(GROUND);
    const ox = r ? r.origin[0] : 0;
    const oz = r ? r.origin[2] : 0;
    const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    for (const p of paths) {
      const def = PATH_MATERIAL[p.mat];
      if (!def) continue;
      const c = pathCurve(p.pts);
      const half = (PATHS.widths[p.w] ?? PATHS.widths[0]) / 2;
      const inner = half * (1 - PATHS.edgeBlend);
      const [cr, cg, cb] = rgb(def.colour);
      const [er, eg, eb] = rgb(def.edge);
      const alpha = p.draft ? 160 : 255;
      if (def.pieces) {
        // separate stones or planks along the curve
        let acc = 0;
        for (let i = 1; i < c.length; i++) {
          const dx = c[i][0] - c[i - 1][0], dz = c[i][1] - c[i - 1][1];
          acc += Math.hypot(dx, dz);
          const step = def.pieces === 'planks' ? 0.35 : 0.7;
          if (acc < step) continue;
          acc = 0;
          const l = Math.hypot(dx, dz) || 1;
          const tx = dx / l, tz = dz / l;
          const along = def.pieces === 'planks' ? 0.14 : 0.22;
          const across = def.pieces === 'planks' ? half : Math.min(half, 0.3);
          const [x, z] = c[i];
          const y = this.y(x, z) + 0.01;
          const base = pos.length / 3;
          for (const [a, b] of [[-along, -across], [along, -across], [along, across], [-along, across]]) {
            pos.push(ox + x + tx * a - tz * b, y, oz + z + tz * a + tx * b);
            nrm.push(0, 1, 0);
            col.push(cr, cg, cb, alpha);
          }
          idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
        continue;
      }
      // a strip: centre band in the path's colour, edges blending to the edge colour
      const offs: [number, number[]][] = [[-half, [er, eg, eb]], [-inner, [cr, cg, cb]], [inner, [cr, cg, cb]], [half, [er, eg, eb]]];
      const start = pos.length / 3;
      for (let i = 0; i < c.length; i++) {
        const a = c[Math.max(0, i - 1)];
        const b = c[Math.min(c.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1];
        const l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l, nz = dx / l;
        for (const [o, k] of offs) {
          const x = c[i][0] + nx * o, z = c[i][1] + nz * o;
          pos.push(ox + x, this.y(x, z), oz + z);
          nrm.push(0, 1, 0);
          col.push(k[0], k[1], k[2], alpha);
        }
      }
      for (let i = 0; i < c.length - 1; i++)
        for (let j = 0; j < 3; j++) {
          const a = start + i * 4 + j, b = a + 1, d = a + 4, e = a + 5;
          idx.push(a, d, b, b, d, e);
        }
    }
    this.tris = idx.length / 3;
    if (!idx.length) return;
    const m = new pc.Mesh(this.device());
    m.setPositions(pos);
    m.setNormals(nrm);
    m.setColors32(new Uint8Array(col));
    m.setIndices(idx);
    m.update(pc.PRIMITIVE_TRIANGLES);
    const e = new pc.Entity('paths');
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(m, this.mat())], castShadows: false, receiveShadows: true });
    this.parent.addChild(e);
    this.entity = e;
  }
}
