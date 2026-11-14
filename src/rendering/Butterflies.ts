import * as pc from 'playcanvas';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { PALETTE } from './Materials';
import { assignBatch, group, vshape } from './Shapes';
import { SLAB_TOP } from './SceneBuilder';

interface Fly {
  root: pc.Entity;
  wings: pc.Entity[];
  pos: pc.Vec3;
  target: pc.Vec3;
  rest: number;
  phase: number;
  speed: number;
}

const COLORS = [PALETTE.pink, PALETTE.flower[1], PALETTE.flower[2], '#ffffff', PALETTE.flower[4], '#8fd3ff'];

/** Butterflies drift between restored tiles. More garden, more butterflies (up to 10). */
export class Butterflies {
  private flies: Fly[] = [];
  private time = 0;
  private recount = 0;
  reducedMotion = false;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private batchId = -1,
  ) {}

  private gardenTiles(): TileData[] {
    return this.sim.grid.rooftops.filter((r) => r.unlocked && !r.preview).flatMap((r) => this.sim.grid.tilesOf(r.id).filter((t) => t.ground === 'restored' && !t.occupantId));
  }

  private pickTarget(f: Fly, tiles: TileData[]) {
    const t = tiles[Math.floor(Math.random() * tiles.length)];
    if (!t) return;
    const [x, y, z] = this.sim.grid.tileWorld(t);
    // Land a bit higher on lush tiles (flowers / shrubs).
    f.target.set(x + (Math.random() - 0.5) * 0.5, y + SLAB_TOP + 0.12 + t.bloom * 0.1, z + (Math.random() - 0.5) * 0.5);
  }

  private spawn(tiles: TileData[]) {
    const root = group(this.parent, 'butterfly');
    const col = COLORS[this.flies.length % COLORS.length];
    const wings: pc.Entity[] = [];
    for (const s of [-1, 1]) {
      const w = group(root, 'wing');
      vshape(w, 'box', col, { pos: [s * 0.045, 0, 0], scale: [0.08, 0.004, 0.065] });
      vshape(w, 'box', col, { pos: [s * 0.035, 0, -0.045], scale: [0.05, 0.004, 0.04] });
      wings.push(w);
    }
    vshape(root, 'capsule', '#3b3b45', { scale: [0.014, 0.05, 0.014], rot: [90, 0, 0] });
    const f: Fly = { root, wings, pos: new pc.Vec3(), target: new pc.Vec3(), rest: 0, phase: Math.random() * 10, speed: 0.6 + Math.random() * 0.4 };
    this.pickTarget(f, tiles);
    f.pos.copy(f.target).add(new pc.Vec3((Math.random() - 0.5) * 3, 1.5, (Math.random() - 0.5) * 3));
    root.setLocalScale(0, 0, 0);
    if (this.batchId >= 0) assignBatch(root, this.batchId); // moving every frame: dynamic batch
    this.flies.push(f);
  }

  update(dt: number) {
    this.time += dt;
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 1;
      const tiles = this.gardenTiles();
      const want = Math.min(10, Math.floor(tiles.length / 5));
      while (this.flies.length < want) this.spawn(tiles);
      for (const f of this.flies) if (!tiles.length) f.rest = 99;
    }
    const tiles = this.flies.length ? this.gardenTiles() : [];
    for (const f of this.flies) {
      const s = Math.min(1, f.root.getLocalScale().x + dt * 2);
      f.root.setLocalScale(s, s, s);
      const d = f.target.clone().sub(f.pos);
      const dist = d.length();
      let flap = 0;
      if (f.rest > 0) {
        f.rest -= dt;
        flap = Math.sin(this.time * 3 + f.phase) * 25 + 30; // slow, open wings while resting
        if (f.rest <= 0) this.pickTarget(f, tiles);
      } else if (dist < 0.05) {
        f.rest = 1.5 + Math.random() * 3;
      } else {
        const step = Math.min(dist, f.speed * dt);
        d.normalize();
        f.pos.add(d.mulScalar(step));
        const bob = this.reducedMotion ? 0 : Math.sin(this.time * 7 + f.phase) * 0.004;
        f.pos.y += bob + (dist > 0.6 ? Math.min(0.01, (f.target.y + 0.4 - f.pos.y) * dt) : 0);
        flap = this.reducedMotion ? 30 : Math.sin(this.time * 26 + f.phase) * 60;
        f.root.setEulerAngles(0, (Math.atan2(f.target.x - f.pos.x, f.target.z - f.pos.z) * 180) / Math.PI, 0);
      }
      f.root.setPosition(f.pos);
      f.wings[0].setLocalEulerAngles(0, 0, flap);
      f.wings[1].setLocalEulerAngles(0, 0, -flap);
    }
  }
}
