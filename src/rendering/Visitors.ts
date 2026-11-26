import * as pc from 'playcanvas';
import { REST } from '../data/rest';
import { VISIT, VISITOR_LOOK, VISITORS, type Perch } from '../data/wildlife';
import type { Visit } from '../gameplay/Wildlife';
import { PALETTE } from './Materials';
import { group, vshape } from './Shapes';
import { clipsFor, loops, visitorPhase, type VisitorPhase } from './VisitorClips';
import { anyInside, type Footprint, restOn, Surface, surfacePoints, surfaceTriangles } from './SkinSurface';

/**
 * E23.10 batch B4: each visitor's own model, by id (assets/raw/models/visitors/<id>.glb). Only the visitors' own
 * main models are named here (the folder also holds the batch's koi, which is for the ponds, and each animal's LOD
 * and texture files), so nothing else goes in the build. The list must match VISITORS less PLACEHOLDER_ONLY
 * (tests/visitor-models.test.ts holds them to it); a glob can't be built from data, so it is written out.
 */
const MODEL_URLS = import.meta.glob('../../assets/raw/models/visitors/{badger,bumblebee,butterfly,fawn,fox,frog,hedgehog,heron,kingfisher,magpie,otter,owl,songbird,squirrel,swallowtail}.glb', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
export const visitorModelUrl = (kind: string) => MODEL_URLS[`../../assets/raw/models/visitors/${kind}.glb`];

/**
 * E23.2.4.2 (#415): the animals that come over while bloombot sits. Each flies or walks in from a few tiles away,
 * settles where its visit says (on bloombot's head, shoulders, lap or arm, beside it, sniffing in front, perched
 * nearby, or just passing), breathes or flutters there, and leaves when bloombot stands.
 *
 * Each kind loads its own model (E23.10 batch B4), sized from VISITOR_LOOK and playing its clips where it has them
 * (a flight or walk clip on the way, an idle once settled); without clips the whole model bobs, flutters or
 * breathes. A primitive placeholder in the style of the other fauna (Fauna.ts) stands in until the model has
 * loaded, and for good if a kind has none or it fails to load: its `parts` animate (wings, or the head). Pooled
 * per kind (made the first time one comes, parked when gone); nothing here writes the sim.
 */
interface Actor {
  kind: string;
  root: pc.Entity;
  /** the primitive placeholder (hidden once the model is in) */
  body: pc.Entity;
  /** wings (fliers) or a head (walkers), animated while settled */
  parts: pc.Entity[];
  flies: boolean;
  used: boolean;
  /** the loaded model, its holder (moved for the procedural motion), and its clips */
  model?: {
    holder: pc.Entity;
    entity: pc.Entity;
    /** its clip for each phase (VisitorClips), and how long its climb onto a perch lasts (seconds; 0 for none) */
    clips: Record<VisitorPhase, string | undefined>;
    climbFor: number;
    /** how long its sit clip lasts (seconds; 0 for none): its shape is taken across it (sittingShape) */
    sitFor: number;
    lift: number;
    clip?: string;
  };
  /**
   * its footprint in its own frame (facing +z) and height, world units, from what is drawn (the placeholder, then the
   * model), and `r` its reach from the root across the ground
   */
  foot: Footprint & { r: number };
  /** how far its sitting shape reaches under its root (sittingShape): sitting beside bloombot, it is lifted by this */
  below?: number;
  /** some of its own vertices, in its own frame (facing +z, feet at 0), to check it rests on bloombot, not in it */
  shape?: number[];
  /** its own faces, in the same frame, so nothing of bloombot pokes into it either (an antenna, the leaf on its head) */
  faces?: Surface;
}

/** A place an animal found to rest: moved from the anchor, turned, and what it cost. */
interface Found {
  dx: number;
  dz: number;
  feet: number;
  turn: number;
  cost: number;
}

/** Where one animal on bloombot comes to rest: moved from its perch's anchor by this, worked out now and then. */
interface Rest {
  d: pc.Vec3;
  /** the tick (SETTLE.fitEvery) it was last fitted on, and whether its place has been found (looked for all round) */
  tick: number;
  found: boolean;
  /** the look all round, while it is still going (a little each frame) */
  job?: Generator<void, Found>;
  /** turned this far from the way it would face (a long one along an arm rather than across it) */
  turn: number;
  /**
   * the bone nearest where it rests, and where it rests in that bone's frame: between fits it rides that bone (a
   * bee on a swinging leg goes with the leg, not with the forearm its perch hangs from)
   */
  bone?: pc.GraphNode;
  local: pc.Vec3;
}


/** What the renderer needs to know about bloombot right now. */
export interface VisitHost {
  /** world position of a perch (BloombotVisuals.visitPoint) */
  point(p: Perch, out: pc.Vec3): pc.Vec3;
  /** bloombot's facing (radians, the walker's convention) */
  facing: number;
  /** ground height under a world position */
  groundY(x: number, z: number): number;
  /** bloombot's surface as drawn (BloombotVisuals.surface), for the animals on it to rest on rather than float */
  surface?(): readonly number[];
  /** its vertices as drawn (BloombotVisuals.corners), each once: checked to be out of the animals on it */
  corners?(): readonly number[];
  /** the bones its skin hangs from (BloombotVisuals.skinBones) */
  bones?(): readonly pc.GraphNode[];
  /** a raised surface round bloombot (the charger's pad while it meditates): animals on the ground keep off it */
  raised?: { x0: number; x1: number; z0: number; z1: number };
  /** the solid things round it (the bench's seat, backrest and ends; the charger's pad), world boxes: kept out of */
  solids?: readonly { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[];
  /** sitting on a bench with room beside it: the free end of the seat, where an animal beside bloombot settles */
  benchSpot?: { x: number; y: number; z: number };
  /**
   * #576: bloombot is still getting into its pose (the sit-down clip, 4.7 s): its arms and knees are on their way, so
   * where an animal rests on it is looked for only once it is there (else a bee could settle where an arm was going
   * past, and stay)
   */
  posing?: boolean;
  reducedMotion: boolean;
}

const ON_BOT: readonly Perch[] = ['landOn', 'head', 'shoulderL', 'shoulderR', 'lap', 'nest'];
const ON_GROUND: readonly Perch[] = ['beside', 'sniff', 'perchNear'];
/**
 * Settling an animal on bloombot onto its real shape (`points` of its vertices): its place looked for all round when
 * it comes (then finer round the best, `fine`; `budgetMs` of it a frame), and fitted up (`lift` at a time, at most `steps`) or down where
 * it is every `fitEvery` seconds as bloombot breathes and sways; down until it touches, then `above` up again (a hair
 * over). Bloombot's corners within `near` of the perch, and down to `below` under the animal, are checked against it.
 * A place costs its distance from the anchor, `behindCost` more for each unit behind bloombot (hidden from the
 * front), `gapCost` for each unit its underside is off bloombot, and `turnCost` to sit turned. Its shape is its sit
 * clip looked at `poses` times across the loop, the same corner in each merged within 1/`poseGrid` (sittingShape).
 */
const SETTLE = { step: 0.004, steps: 15, points: 240, fitEvery: 0.5, lift: 0.01, above: 0.005, gapCost: 20, behindCost: 6, turnCost: 0.1, near: 0.45, below: 0.35, budgetMs: 1.5, poses: 4, poseGrid: 250, fine: [0, 0.0125, -0.0125, 0.025, -0.025] };
/**
 * How far an animal on bloombot may move from its perch's anchor to find a place to rest (world units), and how far
 * down: near first, then further, then turned a quarter either way (a tall bird has no room on the shoulder
 * under bloombot's big round head, so it steps out onto the top of the arm, and a long one sits along it).
 */
const NUDGE = [
  { d: [0, 0.03, -0.03, 0.06, -0.06, 0.1, -0.1], down: 0.15, turns: [0] },
  { d: [0, 0.07, -0.07, 0.14, -0.14, 0.2, -0.2], down: 0.3, turns: [0] },
  { d: [0, 0.07, -0.07, 0.14, -0.14, 0.2, -0.2], down: 0.3, turns: [Math.PI / 2, -Math.PI / 2] },
];

/** Birds fold their wings to this share of their span once they land (insects keep theirs open, flat). */
const FOLDS = ['songbird', 'magpie', 'kingfisher', 'owl'];
const WING_FOLD = 0.35;

const NO_FACES = new Surface([]);

const F = () => PALETTE.fauna;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export class Visitors {
  readonly root = new pc.Entity('visitors');
  private pool: Actor[] = [];
  private byVisit = new Map<Visit, Actor>();
  private rests = new Map<Visit, Rest>();
  private clock = 0;
  private tmp = new pc.Vec3();
  private tmp2 = new pc.Vec3();
  private inv = new pc.Mat4();
  private bot?: Surface;
  private botAt = -1;
  private botTris?: readonly number[];
  private from = new pc.Vec3();

  constructor(
    parent: pc.Entity,
    private app?: pc.AppBase,
  ) {
    parent.addChild(this.root);
  }

  /** Whether a kind is drawn with its own model (loaded), for tests and the review shots. */
  modelled(kind: string): boolean {
    return this.pool.some((a) => a.kind === kind && !!a.model);
  }

  /** Loads a kind's own model into an actor; the placeholder is hidden once it is in. */
  private load(a: Actor) {
    const url = visitorModelUrl(a.kind);
    if (!url || !this.app) return;
    this.app.assets.loadFromUrl(url, 'container', (err, asset) => {
      if (err || !asset || !a.root.parent) return; // (the visitors were torn down meanwhile)
      const res = asset.resource as pc.ContainerResource;
      const look = VISITOR_LOOK[a.kind] ?? { length: 0.2 };
      const holder = new pc.Entity('model-holder');
      const fit = new pc.Entity('model-fit');
      const e = res.instantiateRenderEntity({
        castShadows: true,
        receiveShadows: true,
      });
      fit.addChild(e);
      holder.addChild(fit);
      // measure it unscaled at the origin: scale its longest side to `length`, centre it over its feet
      const box = bounds(e, fit);
      if (!box) return void e.destroy();
      const size = box.halfExtents;
      const longest = 2 * Math.max(size.x, size.y, size.z) || 1;
      const s = look.length / longest;
      fit.setLocalScale(s, s, s);
      fit.setLocalPosition(-box.center.x * s, -(box.center.y - size.y) * s, -box.center.z * s);
      if (look.turn) holder.setLocalEulerAngles(0, look.turn, 0);
      // its clips (B4: idle, follow, sit, climb), each to its phase (VisitorClips); only the climb plays once
      const tracks = (res.animations ?? []).map((an) => an.resource as pc.AnimTrack);
      const clips = clipsFor(tracks.map((t) => t.name));
      if (tracks.length) {
        e.addComponent('anim', { activate: true });
        for (const t of tracks) e.anim!.assignAnimation(t.name, t, undefined, 1, loops(t.name, clips));
      }
      const climb = clips.climb !== clips.move ? tracks.find((t) => t.name === clips.climb) : undefined;
      const sit = tracks.find((t) => t.name === clips.sit);
      a.root.addChild(holder);
      a.body.enabled = false;
      a.model = { holder, entity: e, clips, climbFor: climb ? Math.min(climb.duration, VISIT.climbMax) : 0, sitFor: sit?.duration ?? 0, lift: look.lift ?? 0 };
      // centred over its feet; turned a quarter (look.turn), its sides swap
      const [hx, hz] = Math.abs(Math.sin(((look.turn ?? 0) * Math.PI) / 180)) > 0.7 ? [size.z * s, size.x * s] : [size.x * s, size.z * s];
      a.shape = undefined;
      a.faces = undefined;
      a.foot = {
        x0: -hx,
        x1: hx,
        z0: -hz,
        z1: hz,
        h: size.y * 2 * s,
        r: Math.max(hx, hz),
      };
      for (const [v, x] of this.byVisit) if (x === a) this.rests.delete(v); // rest it again with its new size
    });
  }

  /** Per frame: place every visit's animal. `now` is sim time (visits are timed in it). */
  update(dt: number, now: number, visits: readonly Visit[], host: VisitHost) {
    this.clock += dt;
    // let go of animals whose visit is over
    for (const [v, a] of this.byVisit) {
      if (!visits.includes(v)) {
        a.used = false;
        a.root.enabled = false;
        this.byVisit.delete(v);
        this.rests.delete(v);
      }
    }
    for (const v of visits) {
      let a = this.byVisit.get(v);
      const goneAt = v.leave !== undefined ? v.leave + VISIT.leave : Infinity;
      if (now < v.start || now >= goneAt || (v.leave !== undefined && v.leave <= v.start)) {
        if (a) a.root.enabled = false;
        continue;
      }
      if (!a) this.byVisit.set(v, (a = this.take(v.id)));
      a.root.enabled = true;
      this.place(a, v, now, host);
    }
  }

  private place(a: Actor, v: Visit, now: number, h: VisitHost) {
    // its real shape and footprint, from its own vertices (once it is drawn; again once its model is in)
    if (!a.shape) {
      // at rest: wings level, head ahead (it may be mid-beat on its way in)
      for (const part of a.parts) part.setLocalEulerAngles(0, 0, 0);
      if (a.flies && FOLDS.includes(a.kind)) for (const w of a.parts.slice(0, 2)) w.setLocalScale(WING_FOLD, 1, 1); // landed, wings folded
      const { pts: all, tris } = sittingShape(a);
      if (all.length) a.foot = footOf(all); // every vertex, so a tail tip or an ear counts
      a.below = belowFeet(all);
      a.shape = thin(all, SETTLE.points);
      a.faces = new Surface(toOwnFrame(tris, a.root));
    }
    // a long one (an otter, a fawn) does not fit on the seat facing out: on the ground beside the bench instead
    const onSeat = !!h.benchSpot && a.foot.z1 - a.foot.z0 <= REST.seat.depth;
    const target = this.target(v, h, this.tmp, onSeat);
    if (ON_BOT.includes(v.perch)) target.add(this.restFor(a, v, target, h));
    else if (v.perch === 'beside' && onSeat) {
      // on the seat: forward enough that its back end (it faces out) stays off the backrest
      const push = Math.max(0, -a.foot.z0 + 0.01 - REST.seat.visitorOut - REST.seat.backFace);
      target.x += Math.sin(h.facing) * push;
      target.z += Math.cos(h.facing) * push;
    } else if (ON_GROUND.includes(v.perch) && !(v.perch === 'beside' && onSeat)) keepOff(target, a.foot.r, h.raised); // (its reach: however it turns)
    // #576: sitting beside bloombot (its sit clip; the others there stand in their idle) on the ground or the seat,
    // not into it: an otter's sit pose tucks its legs under its root
    if (v.perch === 'beside') target.y += a.below ?? 0;
    // where it comes from (and goes back to): VISIT.from away, in the visit's own direction
    const fx = target.x + Math.cos(v.from) * VISIT.from;
    const fz = target.z + Math.sin(v.from) * VISIT.from;
    this.from.set(fx, h.groundY(fx, fz) + (a.flies ? 1.4 : 0), fz);
    let p: pc.Vec3;
    let k = 1; // 0 far, 1 at the perch
    let moving = false;
    let heading = h.facing;
    if (v.perch === 'passBy') {
      // passes through the perch and on to the far side, never settling
      const t = clamp01((now - v.start) / (v.arrive - v.start + VISIT.passSeconds));
      const ox = target.x * 2 - this.from.x;
      const oz = target.z * 2 - this.from.z;
      const s = t * 2;
      p = s <= 1 ? new pc.Vec3().lerp(this.from, target, smooth(s)) : new pc.Vec3().lerp(target, new pc.Vec3(ox, this.from.y, oz), smooth(s - 1));
      p.y += Math.sin(t * Math.PI * 6) * 0.06;
      heading = Math.atan2(ox - this.from.x, oz - this.from.z);
      moving = true;
    } else {
      if (now < v.arrive) k = smooth(clamp01((now - v.start) / (v.arrive - v.start)));
      if (v.leave !== undefined && now >= v.leave) k = 1 - smooth(clamp01((now - v.leave) / VISIT.leave));
      moving = k < 1;
      p = new pc.Vec3().lerp(this.from, target, k);
      if (moving) {
        // fliers swoop in on an arc, walkers hop along the ground
        if (a.flies) p.y += Math.sin(k * Math.PI) * 0.5;
        else p.y = Math.max(p.y, h.groundY(p.x, p.z)) + Math.abs(Math.sin(this.clock * 9)) * 0.04;
        const out = v.leave !== undefined && now >= v.leave;
        heading = out ? Math.atan2(this.from.x - target.x, this.from.z - target.z) : Math.atan2(target.x - this.from.x, target.z - this.from.z);
      } else
        // on the seat it sits facing out, like bloombot; on bloombot, turned as it found room
        heading = v.perch === 'beside' && onSeat ? h.facing : this.settledFacing(v.perch, h.facing) + (ON_BOT.includes(v.perch) ? (this.rests.get(v)?.turn ?? 0) : 0);
    }
    a.root.setPosition(p);
    a.root.setEulerAngles(0, (heading * 180) / Math.PI, 0);
    const leaving = v.leave !== undefined && now >= v.leave;
    const phase = visitorPhase({ moving, leaving, perch: v.perch, toGo: v.arrive - now, climbFor: a.model?.climbFor ?? 0 });
    this.animate(a, moving, h.reducedMotion, !moving && ON_BOT.includes(v.perch), phase);
  }

  /** Where a visit settles: its perch, spread out a little when several share one. */
  private target(v: Visit, h: VisitHost, out: pc.Vec3, onSeat: boolean): pc.Vec3 {
    h.point(v.perch, out);
    if (v.slot) {
      const side = (v.slot % 2 ? 1 : -1) * Math.ceil(v.slot / 2) * VISIT.spacing;
      out.x += Math.cos(h.facing) * side;
      out.z -= Math.sin(h.facing) * side;
    }
    if (v.perch === 'beside' && onSeat && h.benchSpot)
      out.set(h.benchSpot.x, h.benchSpot.y, h.benchSpot.z); // up on the seat beside bloombot
    else if (ON_GROUND.includes(v.perch)) out.y = h.groundY(out.x, out.z);
    return out;
  }

  /**
   * Where an animal on bloombot rests: on its real surface (SkinSurface.restOn) at the perch's anchor, or a little
   * to one side if the anchor has no room (an antenna, an arm in the way). Worked out when it first comes and again
   * every second (bloombot breathes and swings its legs); kept as an offset so it still rides the bone between.
   */
  /** Bloombot's surface sorted into cells, once a frame (shared by every animal on it); undefined before its model loads. */
  private botSurface(h: VisitHost): Surface | undefined {
    const all = h.surface?.() ?? [];
    if (!all.length) return undefined;
    if (this.botAt !== this.clock || this.botTris !== all) {
      this.botAt = this.clock;
      this.botTris = all;
      this.bot = new Surface(all);
    }
    return this.bot;
  }

  /**
   * The tests for one animal at one perch: whether it is blocked at a place (any of it in bloombot, any of bloombot
   * in it, any of it in the bench or the pad), how far it can come down from there, and where it rests near a spot.
   */
  private fitter(a: Actor, v: Visit, anchor: pc.Vec3, h: VisitHost, bot: Surface) {
    const facing = this.settledFacing(v.perch, h.facing);
    const shape = a.shape ?? [];
    const faces = a.faces ?? NO_FACES;
    const solids = h.solids ?? [];
    // bloombot's corners round the perch, to check none of them is in the animal
    const near = cornersNear(h.corners?.() ?? bot.tris, anchor, SETTLE.near, []);
    const ys: number[] = [];
    const ups: number[] = [];
    const posed: number[] = [];
    const mine: number[] = [];
    const blocked = (x: number, y: number, z: number, hd: number) => {
      const me = placeShape(shape, x, y, z, hd, posed);
      return anyInside(bot, me) || anyInside(faces, intoOwnFrame(near, x, y, z, hd, a.foot, 0, mine)) || inBoxes(me, solids);
    };
    // how far it can come down from there before it touches anything (bloombot, the bench, the pad), and how far
    // before its underside does (its feet, its belly): straight down from each of its points to whatever is under
    // it, and from each of bloombot's corners under it up to its own underside
    const drop = (x: number, y: number, z: number, hd: number) => {
      const me = placeShape(shape, x, y, z, hd, posed);
      let any = Infinity;
      let under = Infinity;
      for (let i = 0; i < me.length; i += 3) {
        const px = me[i];
        const py = me[i + 1];
        const pz = me[i + 2];
        let d = Infinity;
        bot.flat(px, pz, ys, ups);
        for (const y of ys) if (y <= py) d = Math.min(d, py - y);
        if (d < under && shape[i + 1] <= a.foot.h * 0.2) under = d;
        for (const b of solids) if (px > b.x0 && px < b.x1 && pz > b.z0 && pz < b.z1 && py >= b.y1) d = Math.min(d, py - b.y1);
        any = Math.min(any, d);
      }
      const local = intoOwnFrame(near, x, y, z, hd, a.foot, SETTLE.below, mine);
      for (let i = 0; i < local.length; i += 3) {
        faces.flat(local[i], local[i + 2], ys, ups);
        for (const y of ys) if (y >= local[i + 1]) any = Math.min(any, y - local[i + 1]);
      }
      return { any, under };
    };
    // one place: how high it rests there, and how far its underside still is from bloombot (0: it sits on it)
    const restAt = (dx: number, dz: number, down: number, turn: number) => {
      const hd = facing + turn;
      const x = anchor.x + dx;
      const z = anchor.z + dz;
      // its bounds first (quick), then its real shape: nothing of it in anything, then down until it touches (its
      // bounds rest on the highest point under them; a round body sits down into the hollow between head and shoulder)
      let feet = restOn(bot, x, z, hd, a.foot, anchor.y - down, anchor.y + 0.2);
      if (feet === undefined || blocked(x, feet, z, hd)) return undefined;
      const { any, under } = drop(x, feet, z, hd);
      if (Number.isFinite(any)) feet -= Math.max(0, any - SETTLE.above);
      // better where it sits on its underside than leans on a wing tip or an ear; and seen: behind bloombot (its
      // back, behind its head) it is hidden from the front
      const gap = Number.isFinite(under) ? Math.max(0, under - any) : 1;
      const behind = Math.max(0, -(dx * Math.sin(h.facing) + dz * Math.cos(h.facing)));
      const cost = Math.hypot(dx, dz) * 2 + behind * SETTLE.behindCost + Math.abs(feet - anchor.y) + gap * SETTLE.gapCost + (turn ? SETTLE.turnCost : 0);
      return { dx, dz, feet: feet - anchor.y, turn, cost };
    };
    return { facing, blocked, drop, restAt };
  }

  /**
   * Looks all round the perch for where an animal rests (near first, then further, then turned; then finer round
   * the best), a place at a time: it is run a little each frame (SETTLE.budgetMs) while the animal comes in.
   */
  private *look(a: Actor, v: Visit, anchor: pc.Vec3, h: VisitHost, bot: Surface): Generator<void, Found> {
    const { facing, blocked, drop, restAt } = this.fitter(a, v, anchor, h, bot);
    let best: Found | undefined;
    for (const pass of NUDGE) {
      if (best) break;
      for (const turn of pass.turns)
        for (const dx of pass.d)
          for (const dz of pass.d) {
            const r1 = restAt(dx, dz, pass.down, turn);
            if (r1 && (!best || r1.cost < best.cost)) best = r1;
            yield;
          }
    }
    // then finer round the best of those (a rounded arm or shoulder holds it on its belly only near its top)
    if (best) {
      const { dx: bx, dz: bz, turn } = best;
      for (const ox of SETTLE.fine)
        for (const oz of SETTLE.fine) {
          if (!ox && !oz) continue;
          const r1 = restAt(bx + ox, bz + oz, NUDGE[NUDGE.length - 1].down, turn);
          if (r1 && r1.cost < best.cost) best = r1;
          yield;
        }
    }
    // nowhere near the anchor: up on whatever is highest under it (nothing above, so nothing through it)
    if (!best) {
      let feet = restOn(bot, anchor.x, anchor.z, facing, a.foot, anchor.y - 0.15, anchor.y + 1.5) ?? anchor.y;
      for (let k = 0; k < 100 && blocked(anchor.x, feet, anchor.z, facing); k++) feet += 0.01;
      const { any } = drop(anchor.x, feet, anchor.z, facing); // and down till it touches
      if (Number.isFinite(any)) feet -= Math.max(0, any - SETTLE.above);
      best = { dx: 0, dz: 0, feet: feet - anchor.y, turn: 0, cost: 0 };
    }
    return best;
  }

  private restFor(a: Actor, v: Visit, anchor: pc.Vec3, h: VisitHost): pc.Vec3 {
    let r = this.rests.get(v);
    if (!r) this.rests.set(v, (r = { d: new pc.Vec3(), tick: -1, found: false, turn: 0, local: new pc.Vec3() }));
    const tick = Math.floor(this.clock / SETTLE.fitEvery);
    // between fits: riding the bone it rests on
    if (r.found && r.tick === tick) return this.ride(r, anchor);
    if (!r.found) {
      // still looking: a little more of the look this frame (not before bloombot is in its pose)
      if (!r.job && h.posing) return r.d;
      if (!r.job) {
        const bot = this.botSurface(h);
        if (!bot) return r.d;
        r.job = this.look(a, v, anchor.clone(), h, bot);
      }
      const until = performance.now() + SETTLE.budgetMs;
      let step = r.job.next();
      while (!step.done && performance.now() < until) step = r.job.next();
      if (!step.done) return r.d;
      r.job = undefined;
      r.found = true;
      r.turn = step.value.turn;
      r.d.set(step.value.dx, step.value.feet, step.value.dz);
      r.tick = tick;
      return this.hold(r, anchor, h);
    }
    // fitted twice a second, every animal on the same frame (so bloombot's surface is worked out once for them all)
    r.tick = tick;
    const bot = this.botSurface(h);
    if (!bot) return this.ride(r, anchor);
    r.d.copy(this.ride(r, anchor)); // from where it has ridden to
    // bloombot breathes and sways under it: up until nothing of it is in anything, then down till it touches
    const { facing, blocked, drop } = this.fitter(a, v, anchor, h, bot);
    const hd = facing + r.turn;
    const x = anchor.x + r.d.x;
    const z = anchor.z + r.d.z;
    let feet = anchor.y + r.d.y;
    let k = 0;
    for (; k < SETTLE.steps && blocked(x, feet, z, hd); k++) feet += SETTLE.lift;
    if (k === SETTLE.steps) {
      r.found = false; // swayed right into it: look all round again
      return r.d;
    }
    const { any } = drop(x, feet, z, hd);
    if (Number.isFinite(any)) feet -= Math.max(0, any - SETTLE.above);
    r.d.set(r.d.x, feet - anchor.y, r.d.z);
    return this.hold(r, anchor, h);
  }

  /** Takes hold of the bone nearest where it rests (anchor + r.d), keeping where it is in that bone's frame. */
  private hold(r: Rest, anchor: pc.Vec3, h: VisitHost): pc.Vec3 {
    const at = this.tmp2.copy(anchor).add(r.d);
    let best: pc.GraphNode | undefined;
    let dist = Infinity;
    for (const b of h.bones?.() ?? []) {
      const d = b.getPosition().distance(at);
      if (d < dist) {
        dist = d;
        best = b;
      }
    }
    r.bone = best;
    if (best) this.inv.copy(best.getWorldTransform()).invert().transformPoint(at, r.local);
    return r.d;
  }

  /** Where it is now, riding its bone (as an offset from the anchor); where it was put, if it holds no bone. */
  private ride(r: Rest, anchor: pc.Vec3): pc.Vec3 {
    if (!r.bone) return r.d;
    r.bone.getWorldTransform().transformPoint(r.local, this.tmp2);
    return r.d.copy(this.tmp2).sub(anchor);
  }




  /** Settled visitors face the way bloombot does, or turn to it (sniffing, perched nearby). */
  private settledFacing(p: Perch, facing: number): number {
    if (p === 'sniff') return facing + Math.PI; // nose to bloombot
    if (p === 'perchNear') return facing + Math.PI * 0.75;
    if (p === 'beside') return facing + Math.PI / 2; // curled up along the seat
    return facing;
  }

  private animate(a: Actor, moving: boolean, still: boolean, snug = false, phase: VisitorPhase = moving ? 'move' : 'idle') {
    const t = this.clock;
    const m = a.model;
    if (m) {
      // its own clips where it has them; else the whole model bobs in flight, flutters or breathes once settled
      const want = m.clips[phase];
      const anim = m.entity.anim;
      if (anim && want && m.clip !== want) {
        anim.baseLayer?.transition(want, phase === 'climb' ? 0.1 : 0.2);
        m.clip = want;
      }
      if (anim) anim.speed = still ? 0 : 1;
      const clipped = !!(anim && want);
      let y = m.lift;
      let pitch = 0;
      let breathe = 1;
      if (!still && !clipped) {
        if (a.flies && moving) y += Math.sin(t * 22) * 0.012;
        else if (a.flies)
          pitch = Math.max(0, Math.sin(t * 2.3)) ** 8 * -8; // a little flick now and then
        else if (moving) y += Math.abs(Math.sin(t * 9)) * 0.015;
        else breathe = 1 + Math.sin(t * 2.2) * 0.025;
      }
      m.holder.setLocalPosition(0, y, 0);
      const turn = VISITOR_LOOK[a.kind]?.turn ?? 0;
      m.holder.setLocalEulerAngles(pitch, turn, 0);
      m.holder.setLocalScale(1, breathe, 1);
      return;
    }
    if (a.flies) {
      // wings beat in flight, and flick up now and then once settled (folded still on bloombot: its head is right
      // over a bird on its shoulder) (up: never down into what it sits on; the left
      // wing, at -x, turned about +z by a positive angle goes down)
      const beat = still || snug ? 0 : moving ? Math.sin(t * 28) * 55 : -(Math.max(0, Math.sin(t * 2.3)) ** 8) * 35;
      a.parts[0]?.setLocalEulerAngles(0, 0, beat);
      a.parts[1]?.setLocalEulerAngles(0, 0, -beat);
      // a bird folds its wings to its sides once it has landed (an insect keeps its open)
      const fold = !moving && FOLDS.includes(a.kind) ? WING_FOLD : 1;
      for (const w of a.parts.slice(0, 2)) w.setLocalScale(fold, 1, 1);
    } else {
      // walkers look about while settled (a slow breath for the curled-up ones)
      const look = still || moving ? 0 : Math.sin(t * 0.9) * 18;
      a.parts[0]?.setLocalEulerAngles(0, look, 0);
    }
  }

  private take(kind: string): Actor {
    let a = this.pool.find((x) => !x.used && x.kind === kind);
    if (!a) {
      a = make(this.root, kind);
      this.pool.push(a);
      this.load(a);
    }
    a.used = true;
    return a;
  }

  destroy() {
    this.root.destroy();
  }
}

/** Builds one visitor's placeholder body. The root sits at the feet (or under the belly), facing +z. */
function make(parent: pc.Entity, kind: string): Actor {
  const def = VISITORS.find((v) => v.id === kind)!;
  const root = group(parent, `visitor-${kind}`);
  const body = group(root, 'body');
  const f = F();
  const eyes = (p: pc.Entity, x: number, y: number, z: number, s = 0.007) => {
    for (const side of [-1, 1]) vshape(p, 'sphere', f.eye, { pos: [side * x, y, z], scale: s });
  };
  const wings = (p: pc.Entity, col: string, span: number, y: number, chord = span * 0.7, round = false) =>
    [-1, 1].map((side) => {
      const w = group(p, side < 0 ? 'wingR' : 'wingL', [side * 0.01, y, 0]);
      vshape(w, round ? 'sphere' : 'box', col, {
        pos: [side * span * 0.5, 0, 0],
        scale: [span, 0.006, chord],
      });
      return w;
    });
  const bird = (col: string, breast: string, s: number, beak: string, tail = 0.05) => {
    body.setLocalScale(s, s, s);
    vshape(body, 'sphere', col, {
      pos: [0, 0.05, 0],
      scale: [0.06, 0.055, 0.085],
    });
    vshape(body, 'sphere', breast, {
      pos: [0, 0.042, 0.018],
      scale: [0.045, 0.04, 0.05],
    });
    const head = group(body, 'head', [0, 0.088, 0.035]);
    vshape(head, 'sphere', col, { scale: 0.045 });
    vshape(head, 'cone', beak, {
      pos: [0, 0, 0.03],
      scale: [0.012, 0.028, 0.012],
      rot: [90, 0, 0],
    });
    eyes(head, 0.016, 0.008, 0.016, 0.006);
    vshape(body, 'box', col, {
      pos: [0, 0.06, -0.065],
      scale: [0.03, 0.008, tail],
      rot: [-18, 0, 0],
    });
    return wings(body, col, 0.07, 0.065, 0.06);
  };
  let parts: pc.Entity[] = [];
  switch (kind) {
    case 'butterfly':
    case 'swallowtail': {
      const [a, b] = kind === 'butterfly' ? [f.butterflyBlue, f.breast] : [f.swallowtail[0], f.swallowtail[2]];
      body.setLocalScale(1.4, 1.4, 1.4);
      vshape(body, 'capsule', f.swallowtail[1], {
        pos: [0, 0.02, 0],
        scale: [0.008, 0.035, 0.008],
        rot: [90, 0, 0],
      });
      parts = wings(body, a, 0.045, 0.022, 0.04, true);
      for (const w of parts)
        vshape(w, 'sphere', b, {
          pos: [w.name === 'wingL' ? 0.03 : -0.03, 0.001, -0.012],
          scale: [0.018, 0.006, 0.016],
        });
      break;
    }
    case 'bumblebee': {
      const [y, d, w] = f.bumble;
      body.setLocalScale(1.4, 1.4, 1.4);
      vshape(body, 'sphere', y, {
        pos: [0, 0.02, 0],
        scale: [0.022, 0.02, 0.03],
      });
      vshape(body, 'sphere', d, {
        pos: [0, 0.02, -0.012],
        scale: [0.02, 0.018, 0.012],
      });
      vshape(body, 'sphere', d, { pos: [0, 0.022, 0.02], scale: 0.013 });
      parts = wings(body, w, 0.025, 0.035, 0.016, true);
      break;
    }
    case 'songbird':
      parts = bird(f.birds[1], f.breast, 1.5, f.beak);
      break;
    case 'magpie':
      parts = bird(f.magpie[0], f.magpie[1], 1.7, f.magpie[0], 0.11);
      for (const w of parts)
        vshape(w, 'box', f.magpie[2], {
          pos: [w.name === 'wingL' ? 0.03 : -0.03, 0.004, 0],
          scale: [0.03, 0.004, 0.03],
        });
      break;
    case 'kingfisher':
      parts = bird(f.kingfisher[0], f.kingfisher[1], 1.4, f.eye, 0.03);
      break;
    case 'owl': {
      const [coat, face, eye] = f.owl;
      body.setLocalScale(1.6, 1.6, 1.6);
      vshape(body, 'sphere', coat, {
        pos: [0, 0.07, 0],
        scale: [0.07, 0.085, 0.065],
      });
      vshape(body, 'sphere', face, {
        pos: [0, 0.075, 0.035],
        scale: [0.05, 0.06, 0.03],
      });
      const head = group(body, 'head', [0, 0.13, 0.005]);
      vshape(head, 'sphere', coat, { scale: [0.06, 0.05, 0.055] });
      vshape(head, 'sphere', face, {
        pos: [0, 0, 0.03],
        scale: [0.045, 0.035, 0.02],
      });
      for (const s of [-1, 1])
        vshape(head, 'sphere', eye, {
          pos: [s * 0.016, 0.004, 0.045],
          scale: 0.012,
        });
      eyes(head, 0.016, 0.004, 0.052, 0.006);
      for (const s of [-1, 1])
        vshape(head, 'cone', coat, {
          pos: [s * 0.03, 0.035, 0],
          scale: [0.012, 0.025, 0.012],
        });
      parts = wings(body, coat, 0.06, 0.08, 0.07);
      break;
    }
    case 'hedgehog': {
      const [spines, face, nose] = f.hedgehog;
      body.setLocalScale(1.4, 1.4, 1.4);
      vshape(body, 'sphere', spines, {
        pos: [0, 0.045, -0.005],
        scale: [0.065, 0.05, 0.075],
      });
      for (let i = 0; i < 6; i++)
        vshape(body, 'cone', spines, {
          pos: [Math.sin(i) * 0.03, 0.07 + (i % 2) * 0.01, -0.03 + i * 0.012],
          scale: [0.012, 0.03, 0.012],
          rot: [-30 + i * 4, 0, Math.sin(i) * 25],
        });
      const head = group(body, 'head', [0, 0.035, 0.06]);
      vshape(head, 'sphere', face, { scale: [0.035, 0.03, 0.04] });
      vshape(head, 'sphere', nose, { pos: [0, -0.002, 0.04], scale: 0.009 });
      eyes(head, 0.016, 0.012, 0.022, 0.006);
      parts = [head];
      break;
    }
    case 'squirrel': {
      const [fur, belly] = f.squirrel;
      body.setLocalScale(1.5, 1.5, 1.5);
      vshape(body, 'sphere', fur, {
        pos: [0, 0.045, 0],
        scale: [0.045, 0.05, 0.07],
      });
      vshape(body, 'sphere', belly, {
        pos: [0, 0.04, 0.02],
        scale: [0.03, 0.035, 0.04],
      });
      const head = group(body, 'head', [0, 0.085, 0.045]);
      vshape(head, 'sphere', fur, { scale: 0.035 });
      for (const s of [-1, 1])
        vshape(head, 'cone', fur, {
          pos: [s * 0.015, 0.03, -0.005],
          scale: [0.01, 0.018, 0.01],
        });
      eyes(head, 0.015, 0.008, 0.022, 0.006);
      vshape(body, 'capsule', fur, {
        pos: [0, 0.1, -0.07],
        scale: [0.03, 0.09, 0.03],
        rot: [-25, 0, 0],
      });
      parts = [head];
      break;
    }
    case 'fox': {
      const [coat, light, dark] = f.fox;
      body.setLocalScale(1.6, 1.6, 1.6);
      // curled up, low and round, its brush wrapped round
      vshape(body, 'sphere', coat, {
        pos: [0, 0.045, 0],
        scale: [0.09, 0.055, 0.12],
      });
      vshape(body, 'sphere', light, {
        pos: [0, 0.035, 0.03],
        scale: [0.06, 0.035, 0.07],
      });
      const head = group(body, 'head', [0, 0.09, 0.09]);
      vshape(head, 'sphere', coat, { scale: [0.045, 0.045, 0.05] });
      vshape(head, 'cone', coat, {
        pos: [0, -0.008, 0.05],
        scale: [0.025, 0.05, 0.022],
        rot: [90, 0, 0],
      });
      vshape(head, 'sphere', dark, { pos: [0, -0.008, 0.075], scale: 0.009 });
      for (const sd of [-1, 1])
        vshape(head, 'cone', coat, {
          pos: [sd * 0.025, 0.045, -0.01],
          scale: [0.016, 0.035, 0.012],
          rot: [0, 0, sd * 12],
        });
      eyes(head, 0.018, 0.012, 0.035, 0.007);
      vshape(body, 'capsule', coat, {
        pos: [0.06, 0.04, -0.09],
        scale: [0.04, 0.12, 0.04],
        rot: [80, 0, 60],
      });
      vshape(body, 'sphere', light, { pos: [0.11, 0.04, -0.03], scale: 0.025 });
      parts = [head];
      break;
    }
    case 'fawn': {
      const [coat, light, dark] = f.fawn;
      body.setLocalScale(1.5, 1.5, 1.5);
      // lying down with its legs tucked under, its back dappled
      vshape(body, 'sphere', coat, {
        pos: [0, 0.045, 0],
        scale: [0.09, 0.055, 0.12],
      });
      vshape(body, 'sphere', light, {
        pos: [0, 0.035, 0.03],
        scale: [0.06, 0.035, 0.07],
      });
      const head = group(body, 'head', [0, 0.09, 0.09]);
      vshape(head, 'sphere', coat, { scale: [0.045, 0.045, 0.05] });
      vshape(head, 'cone', coat, {
        pos: [0, -0.008, 0.05],
        scale: [0.025, 0.05, 0.022],
        rot: [90, 0, 0],
      });
      vshape(head, 'sphere', dark, { pos: [0, -0.008, 0.075], scale: 0.009 });
      for (const sd of [-1, 1])
        vshape(head, 'capsule', light, {
          pos: [sd * 0.025, 0.045, -0.01],
          scale: [0.012, 0.04, 0.008],
          rot: [0, 0, sd * 50],
        });
      eyes(head, 0.018, 0.012, 0.035, 0.007);
      for (let i = 0; i < 5; i++)
        vshape(body, 'sphere', light, {
          pos: [Math.sin(i * 2.4) * 0.05, 0.075, -0.05 + i * 0.025],
          scale: 0.01,
        });
      parts = [head];
      break;
    }
    case 'badger': {
      const [coat, stripe, dark] = f.badger;
      body.setLocalScale(1.5, 1.5, 1.5);
      // low and broad, a white-striped face
      vshape(body, 'sphere', coat, {
        pos: [0, 0.045, 0],
        scale: [0.1, 0.06, 0.15],
      });
      for (const sd of [-1, 1])
        vshape(body, 'capsule', dark, {
          pos: [sd * 0.035, 0.015, 0.03],
          scale: [0.02, 0.03, 0.02],
        });
      const head = group(body, 'head', [0, 0.055, 0.085]);
      vshape(head, 'cone', stripe, {
        scale: [0.05, 0.08, 0.045],
        rot: [90, 0, 0],
      });
      for (const sd of [-1, 1])
        vshape(head, 'box', dark, {
          pos: [sd * 0.012, 0.012, 0.005],
          scale: [0.01, 0.012, 0.06],
          rot: [0, sd * 8, 0],
        });
      vshape(head, 'sphere', dark, { pos: [0, 0, 0.04], scale: 0.01 });
      parts = [head];
      break;
    }
    case 'heron': {
      const [coat, light, beak] = f.heron;
      body.setLocalScale(1.5, 1.5, 1.5);
      // tall and still on its long legs, the neck tucked in an S
      for (const sd of [-1, 1])
        vshape(body, 'capsule', beak, {
          pos: [sd * 0.012, 0.06, 0],
          scale: [0.008, 0.12, 0.008],
        });
      vshape(body, 'sphere', coat, {
        pos: [0, 0.15, -0.01],
        scale: [0.06, 0.065, 0.11],
      });
      vshape(body, 'capsule', light, {
        pos: [0, 0.2, 0.04],
        scale: [0.025, 0.07, 0.025],
        rot: [20, 0, 0],
      });
      const head = group(body, 'head', [0, 0.24, 0.055]);
      vshape(head, 'sphere', light, { scale: [0.03, 0.028, 0.035] });
      vshape(head, 'cone', beak, {
        pos: [0, -0.002, 0.04],
        scale: [0.01, 0.05, 0.01],
        rot: [90, 0, 0],
      });
      vshape(head, 'box', f.magpie[0], {
        pos: [0, 0.008, -0.02],
        scale: [0.005, 0.005, 0.04],
      }); // the crest
      eyes(head, 0.013, 0.006, 0.012, 0.005);
      parts = [head];
      break;
    }
    case 'frog': {
      const [skin, belly] = f.frog;
      body.setLocalScale(1.3, 1.3, 1.3);
      vshape(body, 'sphere', skin, {
        pos: [0, 0.025, 0],
        scale: [0.05, 0.03, 0.055],
      });
      vshape(body, 'sphere', belly, {
        pos: [0, 0.018, 0.012],
        scale: [0.04, 0.02, 0.04],
      });
      for (const s of [-1, 1])
        vshape(body, 'sphere', skin, {
          pos: [s * 0.02, 0.05, 0.025],
          scale: 0.015,
        });
      eyes(body, 0.02, 0.058, 0.032, 0.007);
      for (const s of [-1, 1])
        vshape(body, 'sphere', skin, {
          pos: [s * 0.045, 0.012, -0.02],
          scale: [0.02, 0.012, 0.035],
        });
      parts = [body];
      break;
    }
    case 'otter': {
      const [coat, light, dark] = f.otter;
      body.setLocalScale(1.5, 1.5, 1.5);
      vshape(body, 'capsule', coat, {
        pos: [0, 0.045, 0],
        scale: [0.06, 0.16, 0.06],
        rot: [90, 0, 0],
      });
      vshape(body, 'sphere', light, {
        pos: [0, 0.04, 0.05],
        scale: [0.045, 0.03, 0.05],
      });
      const head = group(body, 'head', [0, 0.07, 0.1]);
      vshape(head, 'sphere', coat, { scale: [0.04, 0.035, 0.042] });
      vshape(head, 'sphere', light, {
        pos: [0, -0.01, 0.03],
        scale: [0.025, 0.018, 0.02],
      });
      vshape(head, 'sphere', dark, { pos: [0, -0.002, 0.045], scale: 0.008 });
      eyes(head, 0.017, 0.01, 0.03, 0.006);
      vshape(body, 'cone', coat, {
        pos: [0, 0.03, -0.13],
        scale: [0.03, 0.08, 0.02],
        rot: [-90, 0, 0],
      });
      parts = [head];
      break;
    }
  }
  // stood on its feet: its lowest point at the root (the shapes above are built round their middles)
  const box = bounds(body, root);
  if (box) {
    const lp = body.getLocalPosition();
    body.setLocalPosition(lp.x, lp.y - (box.center.y - box.halfExtents.y), lp.z);
  }
  // its reach from the root (the shapes need not be centred on it, a long tail or snout one way)
  const foot = box
    ? {
        x0: box.center.x - box.halfExtents.x,
        x1: box.center.x + box.halfExtents.x,
        z0: box.center.z - box.halfExtents.z,
        z1: box.center.z + box.halfExtents.z,
        h: box.halfExtents.y * 2,
        r: Math.max(Math.abs(box.center.x) + box.halfExtents.x, Math.abs(box.center.z) + box.halfExtents.z),
      }
    : {
        x0: -def.size,
        x1: def.size,
        z0: -def.size,
        z1: def.size,
        h: def.size,
        r: def.size,
      };
  root.enabled = false;
  return { kind, root, body, parts, flies: !!def.flies, used: false, foot };
}

/** Moves a point on the ground out from under a raised rectangle (the charger's pad), with room for `r` round it. */
function keepOff(p: pc.Vec3, r: number, b?: { x0: number; x1: number; z0: number; z1: number }) {
  if (!b) return;
  const x0 = b.x0 - r;
  const x1 = b.x1 + r;
  const z0 = b.z0 - r;
  const z1 = b.z1 + r;
  if (p.x <= x0 || p.x >= x1 || p.z <= z0 || p.z >= z1) return;
  // out by the nearest side
  const out = [p.x - x0, x1 - p.x, p.z - z0, z1 - p.z];
  const k = out.indexOf(Math.min(...out));
  if (k === 0) p.x = x0 - 0.01;
  else if (k === 1) p.x = x1 + 0.01;
  else if (k === 2) p.z = z0 - 0.01;
  else p.z = z1 + 0.01;
}

/** The bounds of every mesh under `e`, in `space`'s frame (`space` and `e` freshly built, not yet in the scene). */
function bounds(e: pc.Entity, space: pc.Entity): pc.BoundingBox | undefined {
  space.syncHierarchy();
  let box: pc.BoundingBox | undefined;
  for (const r of e.findComponents('render') as pc.RenderComponent[])
    for (const mi of r.meshInstances) {
      const b = mi.aabb;
      if (!box) box = new pc.BoundingBox(b.center.clone(), b.halfExtents.clone());
      else box.add(b);
    }
  return box;
}

/** An actor's own vertices (each corner once), in its own frame (facing +z, its root at the origin), as x, y, z triples. */
function ownShape(root: pc.Entity, out: number[] = [], seen = new Set<string>(), grid = 500): number[] {
  const world = surfacePoints(root);
  const inv = new pc.Mat4().copy(root.getWorldTransform()).invert();
  const v = new pc.Vec3();
  for (let i = 0; i < world.length; i += 3) {
    inv.transformPoint(v.set(world[i], world[i + 1], world[i + 2]), v);
    const key = `${Math.round(v.x * grid)},${Math.round(v.y * grid)},${Math.round(v.z * grid)}`; // the same corner, shared by faces
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v.x, v.y, v.z);
  }
  return out;
}

/**
 * #576: an animal's shape (its vertices, and its faces) as it rests on bloombot: posed in its sit clip, looked at
 * across the whole loop (SETTLE.poses times) and put together, so wherever its breath or a tail flick takes it,
 * nothing of it dips into bloombot. (Taken from whatever it was drawn in when it was first placed, a bird's shape
 * was its flight: legs tucked up, so sitting, its feet and belly sank in.) Back to its phase's clip after
 * (animate() picks it again). A placeholder, or a model without a sit clip, as it is drawn now.
 */
export function sittingShape(a: Pick<Actor, 'root' | 'model'>): { pts: number[]; tris: number[] } {
  const pts: number[] = [];
  const tris: number[] = [];
  const m = a.model;
  const anim = m?.entity.anim;
  const layer = anim?.baseLayer;
  if (!m || !anim || !layer || !m.clips.sit || !m.sitFor) {
    ownShape(a.root, pts);
    surfaceTriangles(a.root, tris);
    return { pts, tris };
  }
  const seen = new Set<string>();
  for (let i = 0; i < SETTLE.poses; i++) {
    layer.transition(m.clips.sit, 0);
    layer.activeStateCurrentTime = (m.sitFor * i) / SETTLE.poses;
    anim.update(0);
    // the same corner in each pose, once (within a few millimetres: the breath barely moves most of it)
    ownShape(a.root, pts, seen, SETTLE.poseGrid);
    surfaceTriangles(a.root, tris);
  }
  m.clip = undefined;
  return { pts, tris };
}

/** How far below its root (y 0) the lowest of the points (x, y, z triples) is; 0 if none is. */
export function belowFeet(pts: readonly number[]): number {
  let low = 0;
  for (let i = 1; i < pts.length; i += 3) low = Math.min(low, pts[i]);
  return low < 0 ? -low : 0;
}

/** The shape stood at (x, y, z) turned to `heading` (the walker's convention), into `out`. */
function placeShape(shape: readonly number[], x: number, y: number, z: number, heading: number, out: number[]): number[] {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  out.length = shape.length;
  for (let i = 0; i < shape.length; i += 3) {
    const u = shape[i];
    const w = shape[i + 2];
    out[i] = x + u * c + w * s;
    out[i + 1] = y + shape[i + 1];
    out[i + 2] = z - u * s + w * c;
  }
  return out;
}

/** Its footprint and height from its own shape (its own frame), and its reach from the root across the ground. */
function footOf(shape: readonly number[]): Footprint & { r: number } {
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity,
    y1 = 0,
    r = 0;
  for (let i = 0; i < shape.length; i += 3) {
    x0 = Math.min(x0, shape[i]);
    x1 = Math.max(x1, shape[i]);
    y1 = Math.max(y1, shape[i + 1]);
    z0 = Math.min(z0, shape[i + 2]);
    z1 = Math.max(z1, shape[i + 2]);
    r = Math.max(r, Math.hypot(shape[i], shape[i + 2]));
  }
  return { x0, x1, z0, z1, h: y1, r };
}

/** At most `n` of the points (x, y, z triples), spread through them. */
function thin(pts: readonly number[], n: number): number[] {
  const k = pts.length / 3;
  const every = Math.max(1, Math.ceil(k / n));
  const out: number[] = [];
  for (let i = 0; i < k; i += every) out.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  return out;
}

/** Triangles (9 numbers each) in the world, into `root`'s own frame. */
function toOwnFrame(tris: readonly number[], root: pc.Entity): number[] {
  const inv = new pc.Mat4().copy(root.getWorldTransform()).invert();
  const v = new pc.Vec3();
  const out: number[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    inv.transformPoint(v.set(tris[i], tris[i + 1], tris[i + 2]), v);
    out.push(v.x, v.y, v.z);
  }
  return out;
}

/** The points (x, y, z triples) within `r` of `p` across and up, into `out`. */
function cornersNear(tris: readonly number[], p: pc.Vec3, r: number, out: number[]): number[] {
  out.length = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i];
    const y = tris[i + 1];
    const z = tris[i + 2];
    if (x - p.x > r || p.x - x > r || z - p.z > r || p.z - z > r || y - p.y > r || p.y - y > r) continue;
    out.push(x, y, z);
  }
  return out;
}

/**
 * World points into the frame of an animal stood at (x, y, z) turned to `heading` (placeShape the other way), only
 * those within its footprint and height (or `below` it: the ones it could come down onto).
 */
function intoOwnFrame(pts: readonly number[], x: number, y: number, z: number, heading: number, foot: Footprint, below: number, out: number[]): number[] {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  out.length = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const dx = pts[i] - x;
    const dz = pts[i + 2] - z;
    const u = dx * c - dz * s;
    const v = pts[i + 1] - y;
    const w = dx * s + dz * c;
    if (u < foot.x0 || u > foot.x1 || w < foot.z0 || w > foot.z1 || v < -below || v > foot.h) continue;
    out.push(u, v, w);
  }
  return out;
}

/** Whether any of the points (x, y, z triples) is inside any of the boxes. */
function inBoxes(pts: readonly number[], boxes: readonly { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[]): boolean {
  for (const b of boxes)
    for (let i = 0; i < pts.length; i += 3)
      if (pts[i] > b.x0 && pts[i] < b.x1 && pts[i + 1] > b.y0 && pts[i + 1] < b.y1 && pts[i + 2] > b.z0 && pts[i + 2] < b.z1) return true;
  return false;
}
