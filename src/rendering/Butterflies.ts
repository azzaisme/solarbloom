import * as pc from 'playcanvas';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { PALETTE } from './Materials';
import { assignBatch, group, vshape } from './Shapes';
import { SLAB_TOP } from './SceneBuilder';
import { hash01, tilesIn, type Rect } from './FaunaPlan';
import { playClip, type Critter, type CritterModels } from './CritterModels';

interface Fly {
  root: pc.Entity;
  wings: pc.Entity[];
  pos: pc.Vec3;
  target: pc.Vec3;
  rest: number;
  phase: number;
  speed: number;
  /** route leg (seeded stops) */
  leg: number;
  used: boolean;
  /** its Tripo model once loaded (a butterfly, every third a swallowtail); the placeholder is hidden then */
  model?: Critter;
}

const COLORS = [PALETTE.pink, PALETTE.flower[1], PALETTE.flower[2], PALETTE.pure.white, PALETTE.flower[4], PALETTE.fauna.butterflyBlue];

/**
 * Butterflies drift between blooming tiles near the view. Phase 5 E16: they arrive with the ecosystem's
 * butterfly unlock (TUNING.ecosystem.fauna), routes are seeded (no Math.random), the count follows the bloom
 * in view up to the quality tier's cap, and the tiles are gathered once a second instead of every frame.
 * Pooled: flies are made once and parked at scale 0 when not needed. Each loads the butterfly's or the swallowtail's
 * model (CritterModels) and flaps with its clips: fast beats in flight, slow open and close at rest.
 */
export class Butterflies {
  private flies: Fly[] = [];
  private time = 0;
  private recount = 0;
  private tiles: TileData[] = [];
  reducedMotion = false;
  /** Phase 5 E16: most flies at once (quality tier) and whether they have arrived yet. */
  cap = 10;
  enabled = true;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private batchId = -1,
    private models?: CritterModels,
  ) {}

  /** Blooming (stage 2+) tiles in view on the ground, plus any unlocked rooftops. */
  private gardenTiles(rect: Rect | undefined): TileData[] {
    const ok = (t: TileData) => t.ground === 'restored' && this.sim.water.bloomShown(t) >= 2 && // E23.4.4: not to faded banks
      !t.occupantId && t.feature !== 'water';
    const out = rect ? tilesIn(this.sim, rect, ok, 120) : [];
    for (const r of this.sim.grid.rooftops) if (r.unlocked && !r.preview && out.length < 160) for (const t of this.sim.grid.tilesOf(r.id)) if (ok(t)) out.push(t);
    return out;
  }

  private pickTarget(f: Fly, i: number) {
    const tiles = this.tiles;
    if (!tiles.length) return;
    f.leg++;
    const t = tiles[Math.floor(hash01(this.sim.state.seed, i, f.leg, 1) * tiles.length)];
    const [x, y, z] = this.sim.grid.tileWorld(t);
    // Land a bit higher on lush tiles (flowers / shrubs).
    f.target.set(x + (hash01(this.sim.state.seed, i, f.leg, 2) - 0.5) * 0.5, y + SLAB_TOP + 0.12 + this.sim.water.bloomShown(t) * 0.1, z + (hash01(this.sim.state.seed, i, f.leg, 3) - 0.5) * 0.5);
  }

  private spawn() {
    const i = this.flies.length;
    const root = group(this.parent, 'butterfly');
    // Look 3.16: a little smaller, to sit right beside the new small flowers
    const body = group(root, 'body');
    body.setLocalScale(0.72, 0.72, 0.72);
    const col = COLORS[i % COLORS.length];
    const wings: pc.Entity[] = [];
    for (const s of [-1, 1]) {
      const w = group(body, 'wing');
      vshape(w, 'box', col, { pos: [s * 0.045, 0, 0], scale: [0.08, 0.004, 0.065] });
      vshape(w, 'box', col, { pos: [s * 0.035, 0, -0.045], scale: [0.05, 0.004, 0.04] });
      wings.push(w);
    }
    vshape(body, 'capsule', PALETTE.fauna.body, { scale: [0.014, 0.05, 0.014], rot: [90, 0, 0] });
    root.setLocalScale(0, 0, 0);
    if (this.batchId >= 0) assignBatch(root, this.batchId); // moving every frame: dynamic batch
    const fly: Fly = { root, wings, pos: new pc.Vec3(), target: new pc.Vec3(), rest: 0, phase: i * 1.7, speed: 0.6 + hash01(i, 7, 7) * 0.4, leg: i * 100, used: false };
    this.flies.push(fly);
    void this.models?.make(i % 3 === 2 ? 'swallowtail' : 'butterfly', { start: 'move', shadows: false }).then((m) => {
      if (!m || !root.parent) return;
      body.enabled = false;
      root.addChild(m.holder);
      m.holder.enabled = fly.used;
      fly.model = m;
    });
  }

  /** Active flies (perf readout). */
  get count() {
    return this.flies.filter((f) => f.used).length;
  }

  update(dt: number, rect?: Rect) {
    this.time += dt;
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 1;
      this.tiles = this.enabled ? this.gardenTiles(rect) : [];
      const want = Math.min(this.cap, Math.floor(this.tiles.length / 5));
      while (this.flies.length < want) this.spawn();
      this.flies.forEach((f, i) => {
        const use = i < want;
        if (use && !f.used) {
          // fly in from above the garden
          this.pickTarget(f, i);
          f.pos.copy(f.target).add(new pc.Vec3((hash01(i, f.leg, 5) - 0.5) * 3, 1.5, (hash01(i, f.leg, 6) - 0.5) * 3));
          f.root.setLocalScale(0.01, 0.01, 0.01);
          f.rest = 0;
        }
        if (!use && f.used) f.root.setLocalScale(0, 0, 0);
        f.used = use;
        if (f.model) f.model.holder.enabled = use; // (its clips stop while it's parked)
      });
    }
    this.flies.forEach((f, i) => {
      if (!f.used) return;
      const s = Math.min(1, f.root.getLocalScale().x + dt * 2);
      f.root.setLocalScale(s, s, s);
      const dx = f.target.x - f.pos.x;
      const dy = f.target.y - f.pos.y;
      const dz = f.target.z - f.pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let flap = 0;
      if (f.rest > 0) {
        f.rest -= dt;
        flap = Math.sin(this.time * 3 + f.phase) * 25 + 30; // slow, open wings while resting
        if (f.rest <= 0) this.pickTarget(f, i);
      } else if (dist < 0.05) {
        f.rest = 1.5 + hash01(i, f.leg, 4) * 3;
      } else {
        const step = Math.min(dist, f.speed * dt) / dist;
        f.pos.x += dx * step;
        f.pos.y += dy * step;
        f.pos.z += dz * step;
        const bob = this.reducedMotion ? 0 : Math.sin(this.time * 7 + f.phase) * 0.004;
        f.pos.y += bob + (dist > 0.6 ? Math.min(0.01, (f.target.y + 0.4 - f.pos.y) * dt) : 0);
        flap = this.reducedMotion ? 30 : Math.sin(this.time * 26 + f.phase) * 60;
        f.root.setEulerAngles(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0);
      }
      f.root.setPosition(f.pos);
      if (f.model) {
        playClip(f.model, f.rest > 0 ? 'sit' : 'move'); // wings slowly opening and closing at rest
        if (f.model.entity.anim) f.model.entity.anim.speed = this.reducedMotion ? 0.3 : 1;
        return;
      }
      f.wings[0].setLocalEulerAngles(0, 0, flap);
      f.wings[1].setLocalEulerAngles(0, 0, -flap);
    });
  }
}
