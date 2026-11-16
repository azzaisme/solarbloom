import * as pc from 'playcanvas';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { assignBatch, group, vshape } from './Shapes';
import { SLAB_TOP } from './SceneBuilder';
import { hash01, tilesIn, type Rect } from './FaunaPlan';
import { treeSpot } from './TreePlacement';
import { PALETTE } from './Materials';

/**
 * Look 3.16 (#143): small ambient life — bees and hoverflies working the flower drifts on Thriving / Radiant
 * tiles, leaves drifting across paving, and blossom petals falling from cherry trees.
 *
 * Purely decorative (never tapped, never grants anything), pooled (made once, parked at scale 0), seeded
 * (no Math.random), capped per quality tier, and gathered once a second rather than every frame. Reduced motion
 * and still screenshot runs (`?still`) switch it off.
 */
type Kind = 'bee' | 'hoverfly' | 'leaf' | 'petal';
interface Mote {
  kind: Kind;
  root: pc.Entity;
  wings?: pc.Entity[];
  pos: pc.Vec3;
  home: pc.Vec3;
  t: number;
  life: number;
  i: number;
  used: boolean;
}

const CAPS = {
  high: { bee: 12, hoverfly: 6, leaf: 8, petal: 14 },
  medium: { bee: 8, hoverfly: 4, leaf: 5, petal: 9 },
  low: { bee: 4, hoverfly: 2, leaf: 3, petal: 5 },
};

export class Pollinators {
  private motes: Mote[] = [];
  private time = 0;
  private recount = 0;
  private flowers: TileData[] = [];
  private paving: TileData[] = [];
  private cherries: TileData[] = [];
  /** off for reduced motion and still screenshot runs */
  enabled = true;
  quality: keyof typeof CAPS = 'high';

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private batchId = -1,
  ) {}

  get count() {
    return this.motes.filter((m) => m.used).length;
  }

  private make(kind: Kind, i: number): Mote {
    const root = group(this.parent, kind);
    let wings: pc.Entity[] | undefined;
    if (kind === 'bee' || kind === 'hoverfly') {
      const body = kind === 'bee' ? PALETTE.bee : PALETTE.hoverfly;
      vshape(root, 'sphere', body, { scale: kind === 'bee' ? [0.026, 0.022, 0.04] : [0.018, 0.014, 0.036] });
      vshape(root, 'box', PALETTE.insectDark, { pos: [0, 0, -0.004], scale: kind === 'bee' ? [0.027, 0.023, 0.008] : [0.019, 0.015, 0.006] });
      vshape(root, 'sphere', PALETTE.insectDark, { pos: [0, 0.002, 0.02], scale: 0.014 });
      wings = [];
      for (const s of [-1, 1]) {
        const w = group(root, 'wing', [s * 0.01, 0.012, 0]);
        vshape(w, 'box', PALETTE.insectWing, { pos: [s * 0.016, 0, 0], scale: [0.03, 0.002, 0.016] });
        wings.push(w);
      }
    } else if (kind === 'leaf') {
      vshape(root, 'box', PALETTE.leafDrift[i % PALETTE.leafDrift.length], { scale: [0.05, 0.004, 0.03] });
    } else {
      vshape(root, 'box', PALETTE.petalFall[i % PALETTE.petalFall.length], { scale: [0.028, 0.003, 0.022] });
    }
    root.setLocalScale(0, 0, 0);
    if (this.batchId >= 0) assignBatch(root, this.batchId);
    return { kind, root, wings, pos: new pc.Vec3(), home: new pc.Vec3(), t: 0, life: 0, i, used: false };
  }

  private place(m: Mote) {
    const pool = m.kind === 'leaf' ? this.paving : m.kind === 'petal' ? this.cherries : this.flowers;
    if (!pool.length) return false;
    m.life++;
    const t = pool[Math.floor(hash01(this.sim.state.seed, m.i + (m.kind === 'hoverfly' ? 500 : m.kind === 'leaf' ? 900 : m.kind === 'petal' ? 1300 : 0), m.life, 3) * pool.length)];
    const [x, y, z] = this.sim.grid.tileWorld(t);
    const jx = hash01(m.i, m.life, 7, 1) - 0.5, jz = hash01(m.i, m.life, 7, 2) - 0.5;
    const top = y + SLAB_TOP;
    if (m.kind === 'petal') m.home.set(x + jx * 0.6, top + 0.8 + hash01(m.i, m.life, 7, 3) * 0.4, z + jz * 0.6);
    else if (m.kind === 'leaf') m.home.set(x + jx * 0.6, top + 0.06, z + jz * 0.6);
    else m.home.set(x + jx * 0.5, top + 0.16 + hash01(m.i, m.life, 7, 4) * 0.1, z + jz * 0.5);
    m.pos.copy(m.home);
    m.t = 0;
    return true;
  }

  update(dt: number, rect?: Rect) {
    this.time += dt;
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 1;
      const on = this.enabled && !!rect;
      this.flowers = on ? tilesIn(this.sim, rect!, (t) => t.ground === 'restored' && t.bloom >= 3 && !t.occupantId && t.feature !== 'water' && t.feature !== 'paving', 80) : [];
      this.paving = on ? tilesIn(this.sim, rect!, (t) => t.ground === 'restored' && t.feature === 'paving' && !t.blocked, 60) : [];
      const type = (t: TileData) => this.sim.areas.info(this.sim.areas.areaOf(t) ?? 'park').type;
      this.cherries = on ? tilesIn(this.sim, rect!, (t) => t.ground === 'restored' && t.bloom >= 2 && treeSpot(t, type(t))?.species === 'cherry', 20) : [];
      const cap = CAPS[this.quality];
      const want: Record<Kind, number> = {
        bee: Math.min(cap.bee, Math.floor(this.flowers.length / 4)),
        hoverfly: Math.min(cap.hoverfly, Math.floor(this.flowers.length / 8)),
        leaf: Math.min(cap.leaf, Math.floor(this.paving.length / 6)),
        petal: Math.min(cap.petal, this.cherries.length * 3),
      };
      for (const kind of ['bee', 'hoverfly', 'leaf', 'petal'] as Kind[]) {
        const mine = this.motes.filter((m) => m.kind === kind);
        while (mine.length < want[kind]) {
          const m = this.make(kind, mine.length);
          this.motes.push(m);
          mine.push(m);
        }
        mine.forEach((m, k) => {
          const use = k < want[kind];
          if (use && !m.used && !this.place(m)) return;
          if (!use && m.used) m.root.setLocalScale(0, 0, 0);
          m.used = use;
        });
      }
    }
    for (const m of this.motes) {
      if (!m.used) continue;
      m.t += dt;
      const ph = m.i * 1.37;
      let s = Math.min(1, m.t * 2);
      switch (m.kind) {
        case 'bee': {
          // a lazy figure-of-eight over its drift, a hop to another every so often
          const a = this.time * 1.6 + ph;
          m.pos.set(m.home.x + Math.sin(a) * 0.18, m.home.y + Math.sin(a * 2.3) * 0.03, m.home.z + Math.sin(a * 2) * 0.1);
          if (m.t > 6 + (m.i % 4)) this.place(m);
          m.root.setEulerAngles(0, (Math.cos(a) > 0 ? 90 : -90) + Math.sin(a * 2) * 30, 0);
          break;
        }
        case 'hoverfly': {
          // hover, then dart
          const leg = Math.floor(m.t / 1.4);
          const k = Math.min(1, (m.t % 1.4) / 0.25);
          const ox = (hash01(m.i, leg, 11) - 0.5) * 0.4, oz = (hash01(m.i, leg, 12) - 0.5) * 0.4;
          const px = (hash01(m.i, leg - 1, 11) - 0.5) * 0.4, pz = (hash01(m.i, leg - 1, 12) - 0.5) * 0.4;
          m.pos.set(m.home.x + px + (ox - px) * k, m.home.y + Math.sin(this.time * 9 + ph) * 0.008, m.home.z + pz + (oz - pz) * k);
          m.root.setEulerAngles(0, (Math.atan2(ox - px, oz - pz) * 180) / Math.PI, 0);
          if (m.t > 9) this.place(m);
          break;
        }
        case 'leaf': {
          // drifts downwind across the paving, tumbling, then fades and starts again elsewhere
          m.pos.set(m.home.x + m.t * 0.22, m.home.y + Math.abs(Math.sin(m.t * 2.2 + ph)) * 0.05, m.home.z - m.t * 0.16 + Math.sin(m.t * 1.3 + ph) * 0.06);
          m.root.setEulerAngles(Math.sin(m.t * 3 + ph) * 40, m.t * 70 + ph * 50, Math.cos(m.t * 2.4) * 30);
          s = Math.min(s, Math.max(0, (5 - m.t) * 1.5));
          if (m.t > 5) this.place(m);
          break;
        }
        case 'petal': {
          // flutters down from the canopy
          m.pos.set(m.home.x + Math.sin(m.t * 1.7 + ph) * 0.12 + m.t * 0.05, m.home.y - m.t * 0.22, m.home.z + Math.cos(m.t * 1.3 + ph) * 0.1);
          m.root.setEulerAngles(Math.sin(m.t * 4 + ph) * 60, m.t * 90, Math.cos(m.t * 3.1) * 50);
          if (m.pos.y < m.home.y - 0.85) s = Math.max(0, s - (m.home.y - 0.85 - m.pos.y) * 8);
          if (m.t > 4.4) this.place(m);
          break;
        }
      }
      m.root.setPosition(m.pos);
      m.root.setLocalScale(s, s, s);
      if (m.wings) {
        const flap = Math.sin(this.time * 70 + ph) * 50;
        m.wings[0].setLocalEulerAngles(0, 0, flap);
        m.wings[1].setLocalEulerAngles(0, 0, -flap);
      }
    }
  }

  /** Parks everything (reduced motion switched on mid-game). */
  hide() {
    for (const m of this.motes) {
      m.used = false;
      m.root.setLocalScale(0, 0, 0);
    }
  }
}
