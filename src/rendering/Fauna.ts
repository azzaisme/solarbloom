import * as pc from 'playcanvas';
import { GROUND } from '../core/GameState';
import type { TileData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from '../gameplay/Sim';
import { WATER } from './Water';
import { catSpots, fountainPond, hash01, idHash, supersIn, tilesIn, wanderStop, type Rect } from './FaunaPlan';
import { mat, PALETTE } from './Materials';
import { assignBatch, group, shape, vshape } from './Shapes';
import { SLAB_TOP } from './SceneBuilder';

/**
 * Phase 5 E16: cosmetic fauna (koi, garden robots, songbirds on the lawns, sleeping cats, fireflies).
 *
 * - **Pooled:** every actor is made once (lazily, up to the high-tier cap) and parked at scale 0 when unused;
 *   nothing is created or destroyed while playing. Each kind is one dynamic batch (a draw call or two).
 * - **Seeded:** where they go comes from FaunaPlan (hashes of seed, actor and route leg; no Math.random).
 * - **Capped:** at most TUNING.ecosystem.caps[quality] of each kind, nearest the view first.
 * - **Inert:** no colliders, no picking (picking is plane maths), no events, no access to the economy. Nothing
 *   here writes the simulation. With reduced motion they rest in place (fireflies go away).
 *
 * Meshy hook: each kind's `make*` builds its placeholder from primitives. When the reviewed Meshy models land
 * (docs/art/meshy-assets.md; the Lucky Cat entry covers the cat body), replace the body of the matching
 * `make*` with the loaded model and keep the returned parts (root, plus the named moving pieces).
 */

type Kind = 'koi' | 'robots' | 'groundBirds' | 'cats' | 'fireflies';

interface Actor {
  root: pc.Entity;
  /** moving parts (fins, wheels, wings, tail…) */
  parts: pc.Entity[];
  used: boolean;
  /** route state */
  home: { x: number; z: number };
  from: pc.Vec3;
  to: pc.Vec3;
  leg: number;
  t: number;
  dur: number;
  rest: number;
  key: string;
  phase: number;
  y: number;
}

export interface FaunaOptions {
  quality: 'low' | 'medium' | 'high';
  reducedMotion: boolean;
  /** Settings → Fireflies (ambience only). */
  fireflies: boolean;
}

/** Placeholder scales: songbirds read at gameplay zoom; a sleeping cat stays well under a Lucky Cat's height. */
const BIRD_S = 1.7;
const ROBOT_S = 1.4;
const CAT_S = 1.4;

const COATS = [
  PALETTE.fauna.catTabby, // grey tabby
  PALETTE.fauna.catGinger, // ginger
  PALETTE.fauna.catTuxedo, // black and white
];

export class Fauna {
  private root: pc.Entity;
  private pools: Record<Kind, Actor[]> = { koi: [], robots: [], groundBirds: [], cats: [], fireflies: [] };
  private batch: Record<Kind, number> = { koi: -1, robots: -1, groundBirds: -1, cats: -1, fireflies: -1 };
  private time = 0;
  private replanIn = 0;
  private seed: number;
  /** actors in use, per kind (perf readout) */
  readonly active: Record<Kind, number> = { koi: 0, robots: 0, groundBirds: 0, cats: 0, fireflies: 0 };

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    private batcher?: pc.BatchManager,
  ) {
    this.root = group(parent, 'fauna');
    this.seed = sim.state.seed | 0;
  }

  private groundY(): number {
    return this.sim.grid.layer(GROUND)!.height + SLAB_TOP;
  }

  private batchFor(kind: Kind): number {
    if (!this.batcher) return -1;
    if (this.batch[kind] < 0) this.batch[kind] = this.batcher.addGroup(`fauna:${kind}`, true, 200).id;
    return this.batch[kind];
  }

  // ─────────────── placeholder models (primitives; Meshy hook above) ───────────────

  private makeKoi(i: number): Actor {
    const root = group(this.root, 'koi');
    const body = group(root, 'body');
    const main = i % 3 === 2 ? PALETTE.pure.white : PALETTE.fauna.koi;
    vshape(body, 'sphere', main, { scale: [0.07, 0.04, 0.17] });
    vshape(body, 'sphere', i % 2 ? PALETTE.pure.white : PALETTE.fauna.koiPatch, { pos: [0, 0.012, 0.02], scale: [0.05, 0.03, 0.07] }); // a patch
    const tail = group(body, 'tail', [0, 0, -0.085]);
    vshape(tail, 'box', main, { pos: [0, 0, -0.035], scale: [0.07, 0.008, 0.06], rot: [0, 45, 0] });
    return this.actor(root, [tail], 'koi');
  }

  private makeRobot(i: number): Actor {
    const root = group(this.root, 'robot');
    const body = group(root, 'body');
    body.setLocalScale(ROBOT_S, ROBOT_S, ROBOT_S);
    vshape(body, 'capsule', PALETTE.plastic.cream, { pos: [0, 0.11, 0], scale: [0.13, 0.15, 0.11] });
    vshape(body, 'box', PALETTE.trim.brass, { pos: [0, 0.1, 0], scale: [0.135, 0.02, 0.115] }); // brass belt
    const head = group(body, 'head', [0, 0.215, 0]);
    vshape(head, 'sphere', PALETTE.plastic.warm, { scale: [0.11, 0.08, 0.1] });
    vshape(head, 'box', PALETTE.plastic.visor, { pos: [0, 0.005, 0.045], scale: [0.07, 0.03, 0.02] }); // visor
    vshape(head, 'sphere', PALETTE.glow.eyeSoft, { pos: [-0.015, 0.006, 0.056], scale: 0.014 });
    vshape(head, 'sphere', PALETTE.glow.eyeSoft, { pos: [0.015, 0.006, 0.056], scale: 0.014 });
    vshape(head, 'cylinder', PALETTE.trim.brass, { pos: [0, 0.06, 0], scale: [0.006, 0.05, 0.006] });
    vshape(head, 'sphere', i % 2 ? PALETTE.leaf.lime : PALETTE.pink, { pos: [0, 0.09, 0], scale: 0.022 }); // a leaf bud or a flower
    // a little watering can in one hand
    const arm = group(body, 'arm', [0.075, 0.12, 0]);
    vshape(arm, 'cylinder', PALETTE.fauna.helperArm, { pos: [0.02, -0.04, 0.02], scale: [0.04, 0.045, 0.04] });
    vshape(arm, 'cylinder', PALETTE.fauna.helperArm, { pos: [0.02, -0.03, 0.06], scale: [0.008, 0.05, 0.008], rot: [60, 0, 0] });
    const wheels = [-1, 1].map((s) => {
      const w = group(body, 'wheel', [s * 0.06, 0.03, 0]);
      vshape(w, 'cylinder', PALETTE.fauna.wheel, { scale: [0.05, 0.02, 0.05], rot: [0, 0, 90] });
      return w;
    });
    return this.actor(root, [head, arm, ...wheels], 'robots');
  }

  private makeBird(i: number): Actor {
    const root = group(this.root, 'songbird');
    const body = group(root, 'body');
    body.setLocalScale(BIRD_S, BIRD_S, BIRD_S);
    const col = PALETTE.fauna.birds[i % 4];
    vshape(body, 'sphere', col, { pos: [0, 0.05, 0], scale: [0.06, 0.055, 0.085] });
    vshape(body, 'sphere', PALETTE.fauna.gull, { pos: [0, 0.04, 0.015], scale: [0.045, 0.04, 0.05] }); // pale breast
    const head = group(body, 'head', [0, 0.085, 0.035]);
    vshape(head, 'sphere', col, { scale: 0.045 });
    vshape(head, 'cone', PALETTE.fauna.beak, { pos: [0, 0, 0.03], scale: [0.012, 0.025, 0.012], rot: [90, 0, 0] });
    vshape(body, 'box', col, { pos: [0, 0.06, -0.06], scale: [0.03, 0.01, 0.05], rot: [-20, 0, 0] }); // tail
    return this.actor(root, [head], 'groundBirds');
  }

  /** A sleeping cat: curled flat on its side, about half a Lucky Cat's height, no collar, coin or raised paw. */
  private makeCat(i: number): Actor {
    const root = group(this.root, 'sleepingCat');
    const body = group(root, 'body');
    body.setLocalScale(CAT_S, CAT_S, CAT_S);
    const [coat, mark] = COATS[i % COATS.length];
    vshape(body, 'sphere', coat, { pos: [0, 0.035, 0], scale: [0.15, 0.065, 0.1] }); // curled loaf
    vshape(body, 'sphere', mark, { pos: [0.01, 0.055, 0], scale: [0.08, 0.02, 0.06] }); // back patch / stripe
    const head = group(body, 'head', [0.06, 0.04, 0.035]);
    vshape(head, 'sphere', coat, { scale: [0.065, 0.05, 0.06] });
    for (const s of [-1, 1]) vshape(head, 'cone', coat, { pos: [0.005, 0.03, s * 0.018], scale: [0.018, 0.022, 0.016], rot: [s * 25, 0, -30] }); // ears folded back
    vshape(head, 'box', PALETTE.fauna.eye, { pos: [0.03, 0.006, 0.012], scale: [0.012, 0.003, 0.008] }); // closed eyes
    vshape(head, 'box', PALETTE.fauna.eye, { pos: [0.03, 0.006, -0.012], scale: [0.012, 0.003, 0.008] });
    const tail = group(body, 'tail', [-0.06, 0.02, 0]);
    vshape(tail, 'capsule', coat, { pos: [0.03, 0, 0.05], scale: [0.022, 0.07, 0.022], rot: [90, 30, 0] }); // wrapped round the front
    return this.actor(root, [body, tail], 'cats');
  }

  /**
   * The koi pond: once koi arrive, lily pads float on the flowing park fountain's basin (POND_Y sits just above the
   * fountain's water surface). One entity, made once.
   */
  static readonly POND_Y = 0.41;
  private pond?: pc.Entity;
  private showPond(at: { x: number; z: number } | undefined, y: number) {
    if (!at) {
      if (this.pond) this.pond.enabled = false;
      return;
    }
    if (!this.pond) {
      this.pond = group(this.root, 'koiPond');
      // The fountain shows its own water (MachineVisuals: surface at 0.4, radius 0.79, falls landing at 0.6): the pads
      // float in the open ring between the falls and the rim.
      for (const [px, pz, s] of [[0.62, 0.3, 0.17], [-0.38, 0.58, 0.15], [-0.5, -0.47, 0.16]]) {
        shape(this.pond, 'cylinder', mat(PALETTE.leaf.mid), { pos: [px, 0.008, pz], scale: [s, 0.006, s] });
        shape(this.pond, 'sphere', mat(PALETTE.flowers.blush), { pos: [px + 0.03, 0.03, pz], scale: 0.05 });
      }
    }
    this.pond.enabled = true;
    this.pond.setPosition(at.x, y + Fauna.POND_Y, at.z);
  }

  private fireflyMat?: pc.StandardMaterial;
  private makeFirefly(): Actor {
    this.fireflyMat ??= mat(PALETTE.glow.firefly, { emissive: PALETTE.glow.fireflyCore, emissiveIntensity: 2.2 });
    const root = group(this.root, 'firefly');
    shape(root, 'sphere', this.fireflyMat, { scale: 0.035 });
    return this.actor(root, [], 'fireflies');
  }

  private actor(root: pc.Entity, parts: pc.Entity[], kind: Kind): Actor {
    root.setLocalScale(0, 0, 0);
    const id = this.batchFor(kind);
    if (id >= 0) assignBatch(root, id);
    return { root, parts, used: false, home: { x: 0, z: 0 }, from: new pc.Vec3(), to: new pc.Vec3(), leg: 0, t: 1, dur: 1, rest: 0, key: '', phase: 0, y: 0 };
  }

  private pool(kind: Kind, n: number): Actor[] {
    const p = this.pools[kind];
    while (p.length < n) {
      const i = p.length;
      const a = kind === 'koi' ? this.makeKoi(i) : kind === 'robots' ? this.makeRobot(i) : kind === 'groundBirds' ? this.makeBird(i) : kind === 'cats' ? this.makeCat(i) : this.makeFirefly();
      a.phase = i * 1.37;
      p.push(a);
    }
    return p;
  }

  // ─────────────── planning (once a second) ───────────────

  private assign(kind: Kind, slots: { key: string; home: { x: number; z: number }; y: number; rot?: number }[], opts: FaunaOptions) {
    const cap = TUNING.ecosystem.caps[opts.quality][kind];
    const want = slots.slice(0, cap);
    const pool = want.length ? this.pool(kind, want.length) : this.pools[kind];
    // Keep actors on the slot they already have (no popping between replans).
    const byKey = new Map(pool.filter((a) => a.used).map((a) => [a.key, a]));
    const keep = new Set<Actor>();
    const fresh: typeof want = [];
    for (const s of want) {
      const a = byKey.get(s.key);
      if (a) keep.add(a);
      else fresh.push(s);
    }
    for (const a of pool) if (!keep.has(a)) this.park(a);
    for (const s of fresh) {
      const a = pool.find((x) => !x.used && !keep.has(x));
      if (!a) break;
      keep.add(a);
      a.used = true;
      a.key = s.key;
      a.home = s.home;
      a.y = s.y;
      a.leg = idHash(s.key) % 1000;
      a.from.set(s.home.x, s.y, s.home.z);
      a.to.copy(a.from);
      a.t = 1;
      a.dur = 1;
      a.rest = 0.3 + hash01(this.seed, a.leg, 3) * 2;
      a.root.setPosition(a.from);
      a.root.setEulerAngles(0, s.rot ?? hash01(this.seed, a.leg, 4) * 360, 0);
      a.root.setLocalScale(1, 1, 1);
    }
    this.active[kind] = keep.size;
  }

  private park(a: Actor) {
    if (!a.used) return;
    a.used = false;
    a.key = '';
    a.root.setLocalScale(0, 0, 0);
  }

  private replan(rect: Rect, opts: FaunaOptions) {
    const s = this.sim;
    const eco = s.ecosystem;
    const y = this.groundY();
    const cx = (rect.x0 + rect.x1) / 2;
    const cz = (rect.z0 + rect.z1) / 2;
    const near = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz);

    // Koi: a few circle the flowing fountain; the rest swim the restored water tiles in view.
    const koi: { key: string; home: { x: number; z: number }; y: number }[] = [];
    const pond = eco.has('koi') ? fountainPond(s) : undefined;
    this.showPond(pond, y);
    if (eco.has('koi')) {
      if (pond && pond.x > rect.x0 - 2 && pond.x < rect.x1 + 2 && pond.z > rect.z0 - 2 && pond.z < rect.z1 + 2)
        for (let i = 0; i < 4; i++) koi.push({ key: `pond:${i}`, home: pond, y: y + Fauna.POND_Y + 0.012 });
      const water = tilesIn(s, rect, (t) => t.ground === 'restored' && t.feature === 'water', 200).sort(near);
      for (let i = 0; i < water.length; i += 3) koi.push({ key: `w:${water[i].x}:${water[i].z}`, home: { x: water[i].x + 0.5, z: water[i].z + 0.5 }, y: y - WATER.drop + 0.012 });
    }
    this.assign('koi', koi, opts);

    // Robots: two around each finished superstructure in view.
    const robots: { key: string; home: { x: number; z: number }; y: number }[] = [];
    if (eco.has('robots'))
      for (const m of supersIn(s, rect).sort((a, b) => near({ x: a.x, z: a.z }, { x: b.x, z: b.z })))
        for (let i = 0; i < 2; i++) robots.push({ key: `r:${m.id}:${i}`, home: { x: m.x + m.size / 2, z: m.z + m.size / 2 }, y });
    this.assign('robots', robots, opts);

    // Songbirds: hopping on blooming lawns near the middle of the view.
    const birds: { key: string; home: { x: number; z: number }; y: number }[] = [];
    if (eco.has('birds')) {
      const lawn = tilesIn(s, rect, (t) => t.ground === 'restored' && t.bloom >= 2 && !t.occupantId && !t.blocked && (t.feature ?? 'lawn') === 'lawn', 120).sort(near);
      for (let i = 0; i < lawn.length; i += 5) birds.push({ key: `b:${lawn[i].x}:${lawn[i].z}`, home: { x: lawn[i].x + 0.5, z: lawn[i].z + 0.5 }, y });
    }
    this.assign('groundBirds', birds, opts);

    // Sleeping cats: curled up inside some machines' footprints (never where a Lucky Cat could be).
    const cap = TUNING.ecosystem.caps[opts.quality].cats;
    this.assign(
      'cats',
      catSpots(s, rect, cap).map((c) => ({ key: `c:${c.machineId}`, home: { x: c.x, z: c.z }, y, rot: c.rot })),
      opts,
    );
    // The coat follows the slot, not the pool index: re-tint by rebuilding is costly, so cats keep their pooled coat.

    // Fireflies (an option; not with reduced motion or high contrast): over Thriving and Radiant tiles. Emissive, so
    // the lighting epic's bloom picks them up; scene light and grading are left to that epic.
    const flies: { key: string; home: { x: number; z: number }; y: number }[] = [];
    if (opts.fireflies && !opts.reducedMotion) {
      const lush = tilesIn(s, rect, (t) => t.ground === 'restored' && t.bloom >= 3 && t.feature !== 'water', 160).sort(near);
      for (let i = 0; i < lush.length; i += 4) flies.push({ key: `f:${lush[i].x}:${lush[i].z}`, home: { x: lush[i].x + 0.5, z: lush[i].z + 0.5 }, y: y + 0.35 });
    }
    this.assign('fireflies', flies, opts);
  }

  // ─────────────── per frame ───────────────

  update(dt: number, rect: Rect | undefined, opts: FaunaOptions) {
    this.time += dt;
    if (!rect) return;
    this.replanIn -= dt;
    if (this.replanIn <= 0) {
      this.replanIn = 1;
      this.replan(rect, opts);
    }
    const rm = opts.reducedMotion;
    const t = this.time;
    const okWater = (x: number, z: number) => this.tile(x, z)?.ground === 'restored' && this.tile(x, z)?.feature === 'water';
    const okWalk = (x: number, z: number) => {
      const tl = this.tile(x, z);
      return !!tl && tl.ground === 'restored' && !tl.blocked && !tl.occupantId && tl.feature !== 'water';
    };
    for (const a of this.pools.koi) {
      if (!a.used) continue;
      if (a.key.startsWith('pond:')) {
        // circle the fountain basin at different radii and speeds
        const i = Number(a.key.slice(5));
        const r = 0.64 + 0.03 * i; // the open water between the falls (0.6) and the basin rim (0.79)
        const ang = rm ? i * 1.6 : t * (0.35 + 0.08 * i) * (i % 2 ? -1 : 1) + i * 1.6;
        a.root.setPosition(a.home.x + Math.cos(ang) * r, a.y, a.home.z + Math.sin(ang) * r);
        a.root.setEulerAngles(0, (-ang * 180) / Math.PI + (i % 2 ? 180 : 0), 0);
      } else if (!rm) this.walk(a, dt, 0.35, 2, okWater, 0.6);
      if (!rm) a.parts[0].setLocalEulerAngles(0, Math.sin(t * 7 + a.phase) * 25, 0);
    }
    for (const a of this.pools.robots) {
      if (!a.used || rm) continue;
      const moving = this.walk(a, dt, 0.45, 3, okWalk, 2.5);
      const [head, arm, ...wheels] = a.parts;
      for (const w of wheels) w.setLocalEulerAngles(moving ? t * 360 : 0, 0, 0);
      head.setLocalEulerAngles(0, moving ? 0 : Math.sin(t * 1.3 + a.phase) * 35, 0);
      arm.setLocalEulerAngles(moving ? 0 : 20 + Math.sin(t * 3 + a.phase) * 15, 0, 0); // waters the flowers while it rests
    }
    for (const a of this.pools.groundBirds) {
      if (!a.used || rm) continue;
      const moving = this.walk(a, dt, 0.9, 2, okWalk, 1.6);
      // hops: short parabolas while moving; pecks while resting
      const hop = moving ? Math.abs(Math.sin(a.t * Math.PI * 4)) * 0.05 : 0;
      const p = a.root.getPosition();
      a.root.setPosition(p.x, a.y + hop, p.z);
      a.parts[0].setLocalEulerAngles(moving ? 0 : Math.max(0, Math.sin(t * 5 + a.phase)) * 45, 0, 0);
    }
    for (const a of this.pools.cats) {
      if (!a.used || rm) continue;
      const b = 1 + Math.sin(t * 1.6 + a.phase) * 0.04; // slow breathing
      a.parts[0].setLocalScale(CAT_S, CAT_S * b, CAT_S);
      a.parts[1].setLocalEulerAngles(0, Math.sin(t * 0.7 + a.phase) * 6, 0);
    }
    for (const a of this.pools.fireflies) {
      if (!a.used) continue;
      const k = a.leg;
      const x = a.home.x + Math.sin(t * 0.5 + k) * 0.4 + Math.sin(t * 1.3 + k * 2) * 0.12;
      const z = a.home.z + Math.cos(t * 0.4 + k * 3) * 0.4;
      const yy = a.y + Math.sin(t * 0.9 + k) * 0.15;
      a.root.setPosition(x, yy, z);
      const glow = 0.6 + 0.4 * Math.max(0, Math.sin(t * 2.2 + k * 1.7));
      a.root.setLocalScale(glow, glow, glow);
    }
  }

  private tile(x: number, z: number): TileData | undefined {
    return this.sim.grid.peek(GROUND, x, z);
  }

  /**
   * Seeded wander: rest, then move to the route's next stop (FaunaPlan.wanderStop), and so on. True while
   * moving. `speed` tiles/s, `radius` tiles around home, `restMax` seconds.
   */
  private walk(a: Actor, dt: number, speed: number, radius: number, ok: (x: number, z: number) => boolean, restMax: number): boolean {
    if (a.rest > 0) {
      a.rest -= dt;
      if (a.rest > 0) return false;
      a.leg++;
      const stop = wanderStop(this.seed, idHash(a.key), a.leg, a.home, radius, ok);
      a.from.copy(a.root.getPosition());
      a.from.y = a.y;
      a.to.set(stop.x, a.y, stop.z);
      const d = a.from.distance(a.to);
      a.dur = Math.max(0.2, d / speed);
      a.t = 0;
      if (d > 0.01) a.root.setEulerAngles(0, (Math.atan2(a.to.x - a.from.x, a.to.z - a.from.z) * 180) / Math.PI, 0);
    }
    a.t = Math.min(1, a.t + dt / a.dur);
    const k = a.t * a.t * (3 - 2 * a.t);
    a.root.setPosition(a.from.x + (a.to.x - a.from.x) * k, a.y, a.from.z + (a.to.z - a.from.z) * k);
    if (a.t >= 1) {
      a.rest = 0.5 + hash01(this.seed, idHash(a.key), a.leg, 9) * restMax;
      return false;
    }
    return true;
  }
}
