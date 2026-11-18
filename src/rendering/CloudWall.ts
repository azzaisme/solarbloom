import * as pc from 'playcanvas';
import { GROUND } from '../core/GameState';
import { levelAt, levelY } from '../core/Height';
import { CHUNK } from '../core/Hash';
import type { Sim } from '../gameplay/Sim';
import { wallCloudParts } from './Clouds';
import { hash01 } from './FaunaPlan';
import { SLAB_TOP } from './SceneBuilder';

interface Wall {
  root: pc.Entity;
  /** dissolving after an unlock: seconds since it started (undefined while standing) */
  leaving?: number;
  /** each cloud's size when it started leaving */
  sizes?: number[];
}

/**
 * Region unlocks (owner, 18 Nov 2026): a wall of soft clouds along every edge where a sealed area meets open
 * ground, so a sealed region reads as "behind the clouds" rather than just grey fog. Two staggered rows of puffy
 * clouds per edge, seeded by cell (the same wall every time), batched into one static draw call per area. When
 * the area is bought, its wall rises and melts away over a couple of seconds. Purely visual: nothing here reads
 * or writes the simulation beyond area states.
 */
export class CloudWall {
  private walls = new Map<string, Wall>();
  private parts: ReturnType<typeof wallCloudParts>;
  private root: pc.Entity;
  private group = -1;
  reducedMotion = false;

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    device: pc.GraphicsDevice,
    sunUp: pc.Vec3,
    private batcher?: pc.BatchManager,
  ) {
    this.root = new pc.Entity('cloudWall');
    parent.addChild(this.root);
    this.parts = wallCloudParts(device, sunUp);
    if (batcher) this.group = batcher.addGroup('cloudWall', false, 10000).id;
  }

  /** Rebuilds every sealed area's wall (call after reveals and unlocks; cheap: a few areas at a time). */
  sync() {
    const s = this.sim;
    const sealed = new Set(s.areas.sealedAreas());
    for (const [id, w] of this.walls) if (!sealed.has(id) && w.leaving === undefined) this.leave(w);
    for (const id of sealed) {
      const old = this.walls.get(id);
      if (old && old.leaving === undefined) old.root.destroy(); // rebuilt: a neighbour may have opened since
      this.walls.set(id, { root: this.build(id) });
    }
    if (this.batcher && this.group >= 0) this.batcher.markGroupDirty(this.group);
  }

  /** Clouds along each chunk edge this sealed area shares with open ground. */
  private build(id: string): pc.Entity {
    const s = this.sim;
    const map = s.areas.map;
    const root = new pc.Entity(`cloudWall:${id}`);
    this.root.addChild(root);
    const y = (s.grid.layer(GROUND)?.height ?? 0) + SLAB_TOP;
    const open = (cx: number, cz: number) => {
      const a = map.areaOfChunk(cx, cz);
      return a !== id && s.areas.fog(a) !== 'hidden';
    };
    for (const [cx, cz] of s.areas.info(id).chunks) {
      // [neighbour chunk, along-axis, inward normal]: west, east, north, south edges
      const sides: [number, number, 'x' | 'z', number, number][] = [
        [cx - 1, cz, 'z', cx * CHUNK, 1],
        [cx + 1, cz, 'z', (cx + 1) * CHUNK, -1],
        [cx, cz - 1, 'x', cz * CHUNK, 1],
        [cx, cz + 1, 'x', (cz + 1) * CHUNK, -1],
      ];
      for (const [nx, nz, along, edge, inward] of sides) {
        if (!open(nx, nz)) continue;
        const start = along === 'z' ? cz * CHUNK : cx * CHUNK;
        for (let row = 0; row < 2; row++) {
          const step = row ? 3.4 : 2.4;
          for (let u = (row ? 1.6 : 0.6); u < CHUNK; u += step) {
            const a = start + u;
            const h = hash01(Math.floor(a * 10), edge, row, along === 'z' ? 1 : 2);
            const depth = (row ? 2.1 : 0.7) + h * 0.5;
            const x = along === 'z' ? edge + inward * depth : a + (h - 0.5) * 0.6;
            const z = along === 'z' ? a + (h - 0.5) * 0.6 : edge + inward * depth;
            const size = (row ? 1.35 : 1.0) + h * 0.45;
            // E21.24: on the Old City's terraces the wall stands on the higher of the two grounds it divides
            const lift = s.grid.terraced(GROUND) ? Math.max(levelY(levelAt(Math.floor(x), Math.floor(z))), levelY(levelAt(Math.floor(x - (along === 'z' ? inward * 2 : 0)), Math.floor(z - (along === 'x' ? inward * 2 : 0))))) : 0;
            this.cloud(root, x, y - 0.15 + (row ? 0.5 : 0) + lift, z, size, h * 360);
          }
        }
      }
    }
    return root;
  }

  private cloud(parent: pc.Entity, x: number, y: number, z: number, size: number, rot: number) {
    const c = new pc.Entity('wallCloud');
    c.setLocalPosition(x, y, z);
    c.setLocalEulerAngles(0, rot, 0);
    c.setLocalScale(size, size * 0.95, size);
    parent.addChild(c);
    for (const p of this.parts.meshes) {
      const e = new pc.Entity();
      e.setLocalPosition(p.pos[0], p.pos[1], p.pos[2]);
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(p.mesh, this.parts.material)], castShadows: false, receiveShadows: false, batchGroupId: this.group >= 0 ? this.group : undefined });
      c.addChild(e);
    }
  }

  /** Takes a wall out of the static batch (so it can move) and starts it dissolving. */
  private leave(w: Wall) {
    w.leaving = 0;
    w.sizes = w.root.children.map((c) => (c as pc.Entity).getLocalScale().x);
    for (const c of w.root.children) for (const p of c.children) if ((p as pc.Entity).render) (p as pc.Entity).render!.batchGroupId = -1;
  }

  /** Dissolving walls rise and shrink away, then go. */
  update(dt: number) {
    for (const [id, w] of this.walls) {
      if (w.leaving === undefined) continue;
      w.leaving += dt;
      const k = this.reducedMotion ? 1 : Math.min(1, w.leaving / 2.4);
      w.root.setLocalPosition(0, k * k * 3, 0);
      w.root.children.forEach((c, i) => {
        const s = (w.sizes?.[i] ?? 1) * (1 - 0.9 * k);
        (c as pc.Entity).setLocalScale(s, s * 0.95, s);
      });
      if (k >= 1) {
        w.root.destroy();
        this.walls.delete(id);
        if (this.batcher && this.group >= 0) this.batcher.markGroupDirty(this.group);
      }
    }
  }
}
