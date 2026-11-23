import * as pc from 'playcanvas';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { assignBatch, group, vshape } from './Shapes';
import { SLAB_TOP } from './SceneBuilder';
import { hash01, tilesIn, type Rect } from './FaunaPlan';
import { treeSpot, treeStage, treeWorldOf, type TreeSpot } from './TreePlacement';
import { PALETTE } from './Materials';
import { PLANT_LOAD, PULSE_LOAD } from '../data/pulse';

/**
 * Look 3.16 (#143): small ambient life — bees and hoverflies working the flower drifts on Thriving / Radiant
 * tiles, leaves drifting across paving, and petals and leaves falling from the trees (Look 3.7): each grown tree
 * near the camera is an emitter, cherries shedding blossom and broadleaf trees the odd leaf (pines keep theirs).
 * They fall from inside the crown, swing or flutter down, settle flat on the ground and fade.
 *
 * Purely decorative (never tapped, never grants anything), pooled (made once, parked at scale 0), seeded
 * (no Math.random), capped per quality tier, and gathered once a second rather than every frame. Reduced motion
 * and still screenshot runs (`?still`) switch it off.
 */
type Kind = 'bee' | 'hoverfly' | 'moth' | 'leaf' | 'petal' | 'treeLeaf';
interface Crown {
  t: TileData;
  spot: TreeSpot;
  stage: number;
}
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
  /** falling petals and leaves: the ground they settle on, and when they landed */
  ground: number;
  landed: number;
}

const CAPS = {
  high: { bee: 12, hoverfly: 6, moth: 4, leaf: 8, petal: 16, treeLeaf: 12 },
  medium: { bee: 8, hoverfly: 4, moth: 3, leaf: 5, petal: 10, treeLeaf: 7 },
  low: { bee: 4, hoverfly: 2, moth: 1, leaf: 3, petal: 5, treeLeaf: 3 },
};

export class Pollinators {
  private motes: Mote[] = [];
  private time = 0;
  private recount = 0;
  private flowers: TileData[] = [];
  /** E23.2.2.2: extra pollinators drawn by what loaded pulses grew in view; rare plants (hawk-moths come to them) */
  private pull = 0;
  private rare: TileData[] = [];
  private paving: TileData[] = [];
  private cherries: Crown[] = [];
  private broadleaves: Crown[] = [];
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
    if (kind === 'moth') {
      // E23.2.2.2: a hummingbird hawk-moth: a stout rusty body and broad wings, hovering at the rare flowers
      vshape(root, 'sphere', PALETTE.mothBody, { scale: [0.03, 0.026, 0.05] });
      vshape(root, 'sphere', PALETTE.insectDark, { pos: [0, 0.002, 0.026], scale: 0.016 });
      wings = [];
      for (const s of [-1, 1]) {
        const w = group(root, 'wing', [s * 0.012, 0.012, 0]);
        vshape(w, 'box', PALETTE.mothWing, { pos: [s * 0.024, 0, 0], scale: [0.05, 0.003, 0.03] });
        wings.push(w);
      }
    } else if (kind === 'bee' || kind === 'hoverfly') {
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
      vshape(root, 'sphere', PALETTE.leafDrift[i % PALETTE.leafDrift.length], { scale: [0.05, 0.006, 0.03] });
    } else if (kind === 'treeLeaf') {
      // one of each species' colours by slot; placeFall picks a slot whose tree matches
      const all = Object.values(PALETTE.treeLeafFall).flat();
      vshape(root, 'sphere', all[i % all.length], { scale: [0.042, 0.006, 0.026] });
    } else {
      // a soft rounded petal, no corners
      vshape(root, 'sphere', PALETTE.petalFall[i % PALETTE.petalFall.length], { scale: [0.03, 0.005, 0.022] });
    }
    root.setLocalScale(0, 0, 0);
    if (this.batchId >= 0) assignBatch(root, this.batchId);
    return { kind, root, wings, pos: new pc.Vec3(), home: new pc.Vec3(), t: 0, life: 0, i, used: false, ground: 0, landed: 0 };
  }

  private place(m: Mote) {
    if (m.kind === 'petal' || m.kind === 'treeLeaf') return this.placeFall(m);
    const pool = m.kind === 'leaf' ? this.paving : m.kind === 'moth' ? this.rare : this.flowers;
    if (!pool.length) return false;
    m.life++;
    const t = pool[Math.floor(hash01(this.sim.state.seed, m.i + (m.kind === 'hoverfly' ? 500 : m.kind === 'leaf' ? 900 : 0), m.life, 3) * pool.length)];
    const [x, y, z] = this.sim.grid.tileWorld(t);
    const jx = hash01(m.i, m.life, 7, 1) - 0.5, jz = hash01(m.i, m.life, 7, 2) - 0.5;
    const top = y + SLAB_TOP;
    if (m.kind === 'leaf') m.home.set(x + jx * 0.6, top + 0.06, z + jz * 0.6);
    else m.home.set(x + jx * 0.5, top + 0.16 + hash01(m.i, m.life, 7, 4) * 0.1, z + jz * 0.5);
    m.pos.copy(m.home);
    m.t = 0;
    return true;
  }

  /** Starts a petal or leaf falling from inside a nearby crown (a leaf from a tree of the species its colour suits). */
  private placeFall(m: Mote) {
    let pool = m.kind === 'petal' ? this.cherries : this.broadleaves;
    if (m.kind === 'treeLeaf') {
      const sp = this.leafSpecies(m.i);
      const mine = pool.filter((c) => c.spot.species === sp);
      if (mine.length) pool = mine;
    }
    if (!pool.length) return false;
    m.life++;
    const c = pool[Math.floor(hash01(this.sim.state.seed, m.i + (m.kind === 'petal' ? 1300 : 1700), m.life, 3) * pool.length)];
    const [x, y, z] = this.sim.grid.tileWorld(c.t);
    const S = c.spot.scale * (c.stage === 2 ? 0.62 : c.stage === 4 ? 1.08 : 1) * 1.12;
    const base = y + SLAB_TOP + (c.spot.planter ? 0.16 : 0);
    // the lower part of the crown, out toward its rim, where a falling leaf clears the canopy
    const a = hash01(m.i, m.life, 7, 1) * Math.PI * 2;
    const r = (0.28 + hash01(m.i, m.life, 7, 2) * 0.18) * S;
    const h = (c.spot.species === 'birch' ? 0.85 : 0.6) * S + hash01(m.i, m.life, 7, 3) * 0.2 * S;
    m.home.set(x + Math.cos(a) * r, base + h, z + Math.sin(a) * r);
    m.ground = base + 0.012;
    m.pos.copy(m.home);
    m.t = 0;
    m.landed = 0;
    return true;
  }

  /** Which species a tree-leaf slot's colour belongs to (slots run through PALETTE.treeLeafFall in order). */
  private leafSpecies(i: number) {
    const entries = Object.entries(PALETTE.treeLeafFall).flatMap(([sp, cols]) => cols.map(() => sp));
    return entries[i % entries.length];
  }

  update(dt: number, rect?: Rect) {
    this.time += dt;
    this.recount -= dt;
    if (this.recount <= 0) {
      this.recount = 1;
      const on = this.enabled && !!rect;
      this.flowers = on ? tilesIn(this.sim, rect!, (t) => t.ground === 'restored' && (this.sim.water.bloomShown(t) >= 3 || !!t.plant) && !t.occupantId && t.feature !== 'water' && t.feature !== 'paving', 80) : [];
      this.pull = this.flowers.reduce((a, t) => a + (t.plant ? PULSE_LOAD[PLANT_LOAD[t.plant]].pollinators : 0), 0);
      this.rare = this.flowers.filter((t) => t.plant === 'rare');
      this.paving = on ? tilesIn(this.sim, rect!, (t) => t.ground === 'restored' && t.feature === 'paving' && !t.blocked, 60) : [];
      const type = (t: TileData) => this.sim.areas.info(this.sim.areas.areaOf(t) ?? 'park').type;
      // grown trees (saplings drop nothing): cherries shed petals, other broadleaves the odd leaf, pines nothing
      const crowns: Crown[] = [];
      if (on)
        for (const t of tilesIn(this.sim, rect!, (t) => (treeStage(t, this.sim.water.bloomShown(t)) ?? 0) >= 2, 120)) {
          const spot = treeSpot(t, type(t), treeWorldOf(this.sim));
          if (spot && spot.species !== 'pine') crowns.push({ t, spot, stage: treeStage(t, this.sim.water.bloomShown(t))! }); // E23.4.4: faded by low water
        }
      this.cherries = crowns.filter((c) => c.spot.species === 'cherry').slice(0, 24);
      this.broadleaves = crowns.filter((c) => c.spot.species !== 'cherry').slice(0, 24);
      const cap = CAPS[this.quality];
      const want: Record<Kind, number> = {
        bee: Math.min(cap.bee, Math.floor((this.flowers.length + this.pull) / 4)),
        hoverfly: Math.min(cap.hoverfly, Math.floor((this.flowers.length + this.pull) / 8)),
        moth: Math.min(cap.moth, Math.ceil(this.rare.length / 3)),
        leaf: Math.min(cap.leaf, Math.floor(this.paving.length / 6)),
        petal: Math.min(cap.petal, this.cherries.length * 3),
        treeLeaf: Math.min(cap.treeLeaf, this.broadleaves.length),
      };
      for (const kind of ['bee', 'hoverfly', 'moth', 'leaf', 'petal', 'treeLeaf'] as Kind[]) {
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
        case 'moth':
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
        case 'petal':
        case 'treeLeaf': {
          // petals flutter and spiral; leaves swing side to side like a falling leaf, slower. Both settle flat on
          // the ground, rest a moment and fade, then fall again from another crown.
          const leafy = m.kind === 'treeLeaf';
          const y = m.home.y - m.t * (leafy ? 0.16 : 0.2);
          if (y > m.ground) {
            if (leafy) {
              const sw = Math.sin(m.t * 2.4 + ph);
              m.pos.set(m.home.x + sw * 0.1 + m.t * 0.04, y + Math.abs(Math.cos(m.t * 2.4 + ph)) * 0.025, m.home.z + sw * 0.05);
              m.root.setEulerAngles(sw * 35, ph * 60 + m.t * 20, Math.cos(m.t * 2.4 + ph) * 25);
            } else {
              m.pos.set(m.home.x + Math.sin(m.t * 1.7 + ph) * 0.1 + m.t * 0.05, y, m.home.z + Math.cos(m.t * 1.3 + ph) * 0.08);
              m.root.setEulerAngles(Math.sin(m.t * 4 + ph) * 60, m.t * 90, Math.cos(m.t * 3.1) * 50);
            }
            m.landed = m.t;
          } else {
            m.pos.y = m.ground;
            m.root.setEulerAngles(0, ph * 60 + m.landed * 20, 0);
            const rest = m.t - m.landed;
            s = Math.min(s, Math.max(0, 1 - Math.max(0, rest - 1.2)));
            if (rest > 2.2) this.place(m);
          }
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
