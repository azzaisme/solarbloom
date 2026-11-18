import * as pc from 'playcanvas';
import type { Sim } from '../gameplay/Sim';
import type { Host } from '../gameplay/Overgrowth';
import { OVERGROWTH_BY_ID, OVERGROWTH_TUNING, type OvergrowthDef } from '../data/overgrowth';
import { buildVine, buildFlowers, buildTurf } from './Flora';
import { foliageMaterial, FoliageBuilder } from './Foliage';
import { SLAB_TOP } from './SceneBuilder';
import type { TreeGeo } from './TreeGen';

/** Growth stages drawn (a sprout … full): the mesh is rebuilt only when a placement crosses into the next one. */
const STAGES = 4;

/**
 * E23.6.6 (#470): how overgrowth looks. Nothing is modelled per object: sprigs are generated along each host's shape
 * and stamped into one merged foliage mesh (one draw call for the whole island, swaying in the wind like every other
 * plant): vines hang in a sagging run between two poles, wrap a pipe run, and climb a machine's or a ruin's sides at
 * its corners and edge middles; moss lies on top; a hanging basket hangs under a line or from a machine's edge.
 * A placement grows from a sprout to full over a game day; the mesh is rebuilt when one moves up a stage.
 *
 * Budget (Deck preset): at most OVERGROWTH_TUNING.maxSprigs sprigs per host, and far LOD sprigs (lod 0).
 */
export class OvergrowthVisuals {
  private entity?: pc.Entity;
  private key = '';
  private check = 0;
  tris = 0;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private device: () => pc.GraphicsDevice,
  ) {
    sim.bus.on('overgrowth.changed', () => (this.key = ''));
  }

  /** Ground height at a layer cell (world y of the slab top there). */
  private groundY(roofId: string, x: number, z: number): number {
    const r = this.sim.grid.roof(roofId);
    return (r ? r.origin[1] + r.height : 0) + SLAB_TOP + this.sim.grid.groundOffset(roofId, Math.floor(x), Math.floor(z));
  }

  private origin(roofId: string): [number, number] {
    const r = this.sim.grid.roof(roofId);
    return r ? [r.origin[0], r.origin[2]] : [0, 0];
  }

  /** What has to be drawn now, as a string (a rebuild happens only when it changes). */
  private signature(): string {
    const og = this.sim.overgrowth;
    return Object.entries(og.all())
      .map(([k, g]) => `${k}:${g.kind}:${Math.ceil(og.growth(g) * STAGES)}`)
      .join(';');
  }

  update(dt: number) {
    this.check -= dt;
    if (this.check > 0 && this.key) return;
    this.check = 1;
    const sig = this.signature();
    if (sig === this.key) return;
    this.key = sig;
    this.rebuild();
  }

  private rebuild() {
    this.entity?.destroy();
    this.entity = undefined;
    const og = this.sim.overgrowth;
    const fb = new FoliageBuilder();
    for (const [key, g] of Object.entries(og.all())) {
      const host = og.host(key);
      const def = OVERGROWTH_BY_ID[g.kind];
      if (!host || !def) continue;
      const stage = Math.max(1, Math.ceil(og.growth(g) * STAGES));
      this.drawHost(fb, host, def, stage, hashKey(key));
    }
    this.tris = fb.tris;
    const mesh = fb.build(this.device());
    if (!mesh) return;
    const e = new pc.Entity('overgrowth');
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, foliageMaterial())], castShadows: true, receiveShadows: true });
    this.parent.addChild(e);
    this.entity = e;
  }

  private cache = new Map<string, TreeGeo>();
  /** One sprig of a kind at a stage, from a small cache of templates (four variants each). */
  private sprig(def: OvergrowthDef, stage: number, hang: number, variant: number): TreeGeo {
    const v = variant % 4;
    const h = Math.round(hang * 10) / 10;
    const k = `${def.id}:${stage}:${h}:${v}`;
    let g = this.cache.get(k);
    if (!g) {
      if (def.habit === 'mat') g = buildTurf(Math.min(4, stage + 1), v, 0);
      else if (def.habit === 'basket') g = buildFlowers('wild', v, stage >= 3, v, 0); // a clump of mixed wildflowers in the basket
      else g = buildVine(Math.min(4, stage), h, v, 0);
      this.cache.set(k, g);
    }
    return g;
  }

  private drawHost(fb: FoliageBuilder, h: Host, def: OvergrowthDef, stage: number, seed: number) {
    const T = OVERGROWTH_TUNING;
    const [ox, oz] = this.origin(h.roofId);
    const grow = stage / STAGES;
    let n = 0;
    const put = (g: TreeGeo, x: number, y: number, z: number, rot: number, scale: number) => {
      if (n++ >= T.maxSprigs || fb.tris + g.tris > T.maxTris) return;
      fb.add(g, ox + x, y, oz + z, rot, scale);
    };
    if (h.kind === 'line' && h.to) {
      // a sagging run between two pole tops: sprigs hang from it, more as it grows
      const ax = h.x + h.size / 2, az = h.z + h.size / 2, bx = h.to.x + h.to.size / 2, bz = h.to.z + h.to.size / 2;
      const ya = this.groundY(h.roofId, ax, az) + T.poleTop, yb = this.groundY(h.roofId, bx, bz) + T.poleTop;
      const len = Math.hypot(bx - ax, bz - az);
      const count = Math.max(2, Math.round(len * T.sprigsPerTile * grow));
      const rot = Math.atan2(bz - az, bx - ax);
      for (let i = 0; i < count; i++) {
        const k = (i + 0.5) / count;
        const sag = Math.sin(k * Math.PI) * T.lineSag;
        put(this.sprig(def, stage, 0.35 + 0.25 * grow, seed + i), ax + (bx - ax) * k, ya + (yb - ya) * k - sag, az + (bz - az) * k, -rot, 0.6);
      }
      return;
    }
    if (h.kind === 'pipe') {
      const y = this.groundY(h.roofId, h.x, h.z) + T.pipeTop;
      const count = Math.max(1, Math.round(T.sprigsPerTile * grow));
      for (let i = 0; i < count; i++) put(this.sprig(def, stage, 0.12, seed + i), h.x + (i + 0.5) / count, y, h.z + 0.5, (seed + i) % 4 * (Math.PI / 2), 0.55);
      return;
    }
    // machines, decorations and ruins: climb the sides at the corners and edge middles, moss and baskets on top
    const top = (h.kind === 'decor' ? T.decorHeight : T.machineHeight) * Math.min(2, h.size);
    const y0 = this.groundY(h.roofId, h.x, h.z);
    const s = h.size;
    const snaps: [number, number, number][] = [
      [h.x, h.z + s, 0], // south face, facing +z
      [h.x + s, h.z, Math.PI], // north face
      [h.x + s, h.z + s, -Math.PI / 2], // east face
      [h.x, h.z, Math.PI / 2], // west face
    ];
    const faces = Math.max(1, Math.round(snaps.length * grow));
    for (let f = 0; f < faces; f++) {
      const [x, z, rot] = snaps[(f + seed) % snaps.length];
      const g = def.habit === 'mat' ? this.sprig(def, stage, 0, seed + f) : this.sprig(def, stage, top * (0.5 + 0.5 * grow), seed + f);
      if (def.habit === 'mat') put(g, h.x + s / 2, y0 + top, h.z + s / 2, rot, 0.5 * s);
      else put(g, x, y0 + top, z, rot, s);
    }
  }
}

/** A small stable number from a host key (variants and which faces first). */
function hashKey(k: string): number {
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
  return (h >>> 0) % 997;
}
