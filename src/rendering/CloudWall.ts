import * as pc from 'playcanvas';
import { GROUND } from '../core/GameState';
import { levelAt, levelY } from '../core/Height';
import { CHUNK } from '../core/Hash';
import { LOOK } from '../data/look';
import type { Sim } from '../gameplay/Sim';
import { wallCloudParts } from './Clouds';
import { hash01 } from './FaunaPlan';
import { SLAB_TOP } from './SceneBuilder';

interface Wall {
  root: pc.Entity;
  /** where each of its clouds stands (x, y, z, size): the wisps rise from these */
  anchors: [number, number, number, number][];
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
/** P7-E27: a puff lifting off the wall: where it started, how big, how old and how long it lives. */
interface Wisp {
  e: pc.Entity;
  from: [number, number, number, number];
  age: number;
  life: number;
  drift: [number, number];
}

export class CloudWall {
  private walls = new Map<string, Wall>();
  private wisps: Wisp[] = [];
  private wispGroup = -1;
  private seed = 0x9e3779b9;
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
    if (batcher) {
      this.group = batcher.addGroup('cloudWall', false, 10000).id;
      // the wisps move every frame: a dynamic batch keeps them to one draw call
      this.wispGroup = batcher.addGroup('cloudWisps', true, 100).id;
    }
  }

  /** Rebuilds every sealed area's wall (call after reveals and unlocks; cheap: a few areas at a time). */
  sync() {
    const s = this.sim;
    const sealed = new Set(s.areas.sealedAreas());
    // P7-E27 prototype (LOOK.cloudRing): the same wall along every edge where revealed ground meets the hidden city,
    // so the open island reads as ringed by cloud rather than fading into a grey haze
    if (LOOK.cloudRing.on) for (const id of this.hiddenNeighbours()) sealed.add(id);
    for (const [id, w] of this.walls) if (!sealed.has(id) && w.leaving === undefined) this.leave(w);
    for (const id of sealed) {
      const old = this.walls.get(id);
      if (old && old.leaving === undefined) old.root.destroy(); // rebuilt: a neighbour may have opened since
      const anchors: Wall['anchors'] = [];
      this.walls.set(id, { root: this.build(id, anchors), anchors });
    }
    if (this.batcher && this.group >= 0) this.batcher.markGroupDirty(this.group);
  }

  /** Hidden (never revealed, not sealed) areas that share a chunk edge with revealed ground. */
  private hiddenNeighbours(): Set<string> {
    const s = this.sim;
    const map = s.areas.map;
    const out = new Set<string>();
    for (const id of s.areas.revealed())
      for (const [cx, cz] of s.areas.info(id).chunks)
        for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const a = map.areaOfChunk(cx + dx, cz + dz);
          if (a !== id && s.areas.fog(a) === 'hidden') out.add(a);
        }
    return out;
  }

  /** Clouds along each chunk edge this sealed area shares with open ground. */
  private build(id: string, anchors: Wall['anchors']): pc.Entity {
    const s = this.sim;
    const map = s.areas.map;
    const root = new pc.Entity(`cloudWall:${id}`);
    const ring = !s.areas.sealed(id);
    const R = LOOK.cloudRing;
    const rows = ring ? R.rows : 2;
    const grow = ring ? R.size : 1;
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
        for (let row = 0; row < rows; row++) {
          // each row further in, sparser, larger and higher (rows 0 and 1 are the gate walls' own two rows)
          const step = 2.4 + row;
          for (let u = 0.6 + row; u < CHUNK; u += step) {
            const a = start + u;
            const h = hash01(Math.floor(a * 10), edge, row, along === 'z' ? 1 : 2);
            // tiered: the two rows at the edge keep the gate walls' size; only the rows behind them grow, so the big
            // banks stand back from the playable ground and never loom right in front of a near camera
            const g = row >= 2 ? grow : 1;
            const depth = 0.7 + 1.4 * row * (row >= 2 ? grow : 1) + h * 0.5;
            const x = along === 'z' ? edge + inward * depth : a + (h - 0.5) * 0.6;
            const z = along === 'z' ? a + (h - 0.5) * 0.6 : edge + inward * depth;
            const size = (1.0 + 0.35 * row + h * 0.45) * g;
            // E21.24: on the Old City's terraces the wall stands on the higher of the two grounds it divides
            const lift = s.grid.terraced(GROUND) ? Math.max(levelY(levelAt(Math.floor(x), Math.floor(z))), levelY(levelAt(Math.floor(x - (along === 'z' ? inward * 2 : 0)), Math.floor(z - (along === 'x' ? inward * 2 : 0))))) : 0;
            const cy = y - 0.15 + 0.5 * row * g + lift;
            this.cloud(root, x, cy, z, size, h * 360);
            anchors.push([x, cy, z, size]);
          }
        }
      }
    }
    return root;
  }

  private cloud(parent: pc.Entity, x: number, y: number, z: number, size: number, rot: number, parts = this.parts.meshes, group = this.group) {
    const c = new pc.Entity('wallCloud');
    c.setLocalPosition(x, y, z);
    c.setLocalEulerAngles(0, rot, 0);
    c.setLocalScale(size, size * 0.95, size);
    parent.addChild(c);
    for (const p of parts) {
      const e = new pc.Entity();
      e.setLocalPosition(p.pos[0], p.pos[1], p.pos[2]);
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(p.mesh, this.parts.material)], castShadows: false, receiveShadows: false, batchGroupId: group >= 0 ? group : undefined });
      c.addChild(e);
    }
    return c;
  }

  private rnd() {
    // mulberry32: the wisps' picks are seeded, so a run looks the same every time
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A standing cloud within reach of the camera's focus to lift a wisp from (undefined if none is near). */
  private pickAnchor(focus: pc.Vec3, reach: number): Wisp['from'] | undefined {
    const standing = [...this.walls.values()].filter((w) => w.leaving === undefined && w.anchors.length);
    if (!standing.length) return undefined;
    for (let i = 0; i < 24; i++) {
      const w = standing[Math.floor(this.rnd() * standing.length)];
      const a = w.anchors[Math.floor(this.rnd() * w.anchors.length)];
      if (Math.hypot(a[0] - focus.x, a[2] - focus.z) < reach) return a;
    }
    return undefined;
  }

  /**
   * P7-E27 (owner, 23 Nov 2026): the walls breathe. A few small puffs lift off the clouds near the camera, rise and
   * melt away (shrinking to nothing, as a wall does when its area opens), then start again elsewhere on the wall.
   */
  private updateWisps(dt: number, focus: pc.Vec3) {
    const W = LOOK.cloudRing.wisps;
    const want = this.reducedMotion ? 0 : W.count;
    while (this.wisps.length < want) {
      const e = this.cloud(this.root, 0, -1000, 0, 0.001, this.rnd() * 360, this.parts.meshes.slice(0, W.parts), this.wispGroup);
      // spread the first ones through their lives so they don't all rise together
      this.wisps.push({ e, from: [0, -1000, 0, 0], age: -this.rnd() * W.life[1], life: 1, drift: [0, 0] });
    }
    while (this.wisps.length > want) this.wisps.pop()!.e.destroy();
    for (const w of this.wisps) {
      w.age += dt;
      if (w.age < 0) continue; // still waiting for its first turn
      if (w.age >= w.life) {
        // start again from another cloud near the camera (or wait off-stage if none is near)
        const a = this.pickAnchor(focus, W.reach);
        w.age = 0;
        w.life = W.life[0] + this.rnd() * (W.life[1] - W.life[0]);
        w.from = a ?? [0, -1000, 0, 0];
        const ang = this.rnd() * Math.PI * 2;
        w.drift = [Math.cos(ang) * W.drift, Math.sin(ang) * W.drift];
      }
      const t = Math.max(0, w.age) / w.life;
      const [x, y, z, size] = w.from;
      // swell a little as it lifts off, then shrink away to nothing near the top of its rise
      const k = t < 0.2 ? 0.55 + 0.45 * (t / 0.2) : Math.pow(1 - (t - 0.2) / 0.8, 1.4);
      const sc = Math.max(0.001, size * W.size * k);
      const ease = 1 - (1 - t) * (1 - t);
      w.e.setLocalPosition(x + w.drift[0] * t, y + 0.3 * size + W.rise * ease, z + w.drift[1] * t);
      w.e.setLocalScale(sc, sc * 0.9, sc);
    }
  }

  /** Takes a wall out of the static batch (so it can move) and starts it dissolving. */
  private leave(w: Wall) {
    w.leaving = 0;
    w.sizes = w.root.children.map((c) => (c as pc.Entity).getLocalScale().x);
    for (const c of w.root.children) for (const p of c.children) if ((p as pc.Entity).render) (p as pc.Entity).render!.batchGroupId = -1;
  }

  /** Dissolving walls rise and shrink away, then go; standing walls breathe out wisps near `focus`. */
  update(dt: number, focus?: pc.Vec3) {
    if (focus) this.updateWisps(dt, focus);
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
