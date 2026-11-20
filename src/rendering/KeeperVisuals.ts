import * as pc from 'playcanvas';
import { benchClip, benchMode, benchOffset, SEAT_CLIPS } from './KeeperSeat';
import { foldLegs, hipsAbove, SEAT_HIPS } from './SeatPose';
import { GROUND } from '../core/GameState';
import { KEEPER_HELP } from '../data/keepers';
import { KEEPERS, MODEL_NAMES, type KeeperDef } from '../data/oldcity';
import type { Sim } from '../gameplay/Sim';
import { MODELS, oldCityModel } from './Models';
import { SLAB_TOP } from './SceneBuilder';
import { color } from './Materials';

/** The Keepers' own rigged models (assets/raw/models/final/keeper-<id>.glb: clips idle, wave, sleep, and B5's
 * sit-down, sit and stand-up). Fetched here only, when a Keeper is first shown (ModelLibrary leaves them out). */
const KEEPER_URLS = import.meta.glob('../../assets/raw/models/final/keeper-*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
/** STAND-IN until a Keeper's model lands: bloombot's rig, tinted, with the Keeper's prop. Not the finished art. */
const STAND_IN_URL = new URL('../../assets/raw/bloombot/bloombot.glb', import.meta.url).href;
const STAND_IN_SCALE = 0.95; // bloombot's own holder scale (its rig root carries a 0.01 centimetre scale)
/** The Keepers' own models share bloombot's rig layout (an Armature at 0.01) and stand 1.0 m (bloombot 0.85 m). */
const MODEL_SCALE = 0.95;
/** The sleep clip lowers into a seated doze with nothing underneath: a dozing Keeper sits on a stone block this high. */
const SEAT = { model: 'stone-block', scale: 0.42, height: 0.32 };

interface KeeperView {
  def: KeeperDef;
  root: pc.Entity;
  body: pc.Entity;
  rig?: pc.Entity;
  standIn: boolean;
  /** the Keeper's prop (set down while it sits beside bloombot) */
  prop?: pc.Entity;
  /** where it is drawn: the sim's pose (KeeperSystem.pose) */
  x: number;
  z: number;
  facing: number;
  waveUntil: number;
  clip?: string;
  /** its model's clips and their lengths (seconds) */
  lens: Map<string, number>;
  /** on a bench beside bloombot (E23.2.3): where, since when, and when it began to get up */
  bench?: { x: number; y: number; z: number; facing: number; seat: number; since: number; upAt?: number };
}

/**
 * E21.8: the Keepers on screen. Each loads its own rigged model by name (`keeper-<id>`, clips idle, wave and
 * sleep, played through PlayCanvas' anim component as bloombot's are, G.10) and, until that file lands, a clearly
 * marked stand-in: bloombot's rig tinted in the Keeper's colour, holding its prop. A sleeping Keeper is slumped
 * with its visor dark; an awake one idles and waves when it speaks; a settled one wanders its region's restored
 * ground and dozes at night. A Keeper is only drawn once its region is open (never in fog).
 */
export class KeeperVisuals {
  private views = new Map<string, KeeperView>();
  private root: pc.Entity;
  private clock = 0;
  reducedMotion = false;
  /** E23.2.3: a Keeper who is a friend sits beside bloombot on a bench (world position, facing) */
  beside?: { id: string; x: number; y: number; z: number; facing: number; seat: number };

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    private app: pc.AppBase,
  ) {
    this.root = new pc.Entity('keepers');
    parent.addChild(this.root);
    sim.bus.on('keeper.said', ({ keeperId }) => {
      const v = this.views.get(keeperId);
      if (v) v.waveUntil = this.clock + 2.2;
    });
  }

  /** World position of a Keeper's head (for its speech bubble). */
  headWorld(id: string): pc.Vec3 | undefined {
    const v = this.views.get(id);
    if (!v) return undefined;
    const p = v.root.getPosition();
    return new pc.Vec3(p.x, p.y + 1.15, p.z);
  }

  private y(x: number, z: number): number {
    const l = this.sim.grid.layer(GROUND)!;
    return l.origin[1] + l.height + SLAB_TOP + this.sim.grid.groundOffset(GROUND, Math.floor(x), Math.floor(z));
  }

  private make(def: KeeperDef): KeeperView {
    const root = new pc.Entity(`keeper-${def.id}`);
    const body = new pc.Entity('body');
    root.addChild(body);
    this.root.addChild(root);
    const v: KeeperView = { def, root, body, standIn: true, x: def.x + 0.5, z: def.z + 0.5, facing: Math.PI, waveUntil: 0, lens: new Map() };
    const own = KEEPER_URLS[`../../assets/raw/models/final/keeper-${def.id}.glb`];
    v.standIn = !own;
    // in the map before loading: a model already in the cache calls back at once, before make() returns
    this.views.set(def.id, v);
    this.app.assets.loadFromUrl(own ?? STAND_IN_URL, 'container', (err, asset) => {
      if (err || !asset || !this.views.has(def.id)) return;
      const res = asset.resource as pc.ContainerResource;
      const holder = new pc.Entity('rig-holder');
      const sc = own ? MODEL_SCALE : STAND_IN_SCALE;
      holder.setLocalScale(sc, sc, sc);
      const e = res.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
      holder.addChild(e);
      body.addChild(holder);
      if (!own) this.tint(e, def.tint);
      e.addComponent('anim', { activate: true });
      for (const a of res.animations) {
        const track = a.resource as pc.AnimTrack;
        const loop = track.name === 'idle' || track.name === 'sleep' || track.name === 'walk' || track.name === SEAT_CLIPS.sit;
        e.anim!.assignAnimation(track.name, track, undefined, 1, loop);
        v.lens.set(track.name, track.duration);
      }
      v.rig = e;
      v.clip = undefined;
    });
    // a stone block to doze on (the real sleep clip sits down; the stand-in only slumps)
    if (own) {
      const seat = MODELS?.instantiateMerged(SEAT.model);
      if (seat) {
        seat.name = 'seat';
        seat.setLocalScale(SEAT.scale, SEAT.scale, SEAT.scale);
        seat.setLocalPosition(0, 0, -0.12);
        seat.enabled = false;
        root.addChild(seat);
      }
    }
    // the Keeper's prop (its own model once it lands; stand-in models until then)
    const prop = oldCityModel(def.prop) ?? (MODELS?.has(def.prop) ? def.prop : undefined);
    const p = prop ? MODELS?.instantiateMerged(prop) : undefined;
    if (p) {
      p.setLocalScale(0.32, 0.32, 0.32);
      p.setLocalPosition(0.32, 0, 0.1);
      body.addChild(p);
      v.prop = p;
    }
    return v;
  }

  /** STAND-IN only: bloombot's materials tinted toward the Keeper's colour. */
  private tint(e: pc.Entity, hex: string) {
    const c = color(hex);
    for (const r of e.findComponents('render') as pc.RenderComponent[])
      for (const mi of r.meshInstances) {
        const m = mi.material;
        if (!(m instanceof pc.StandardMaterial) || m.name === 'bloombot_visor') continue;
        const t = m.clone();
        t.diffuse = new pc.Color(m.diffuse.r * 0.45 + c.r * 0.55, m.diffuse.g * 0.45 + c.g * 0.55, m.diffuse.b * 0.45 + c.b * 0.55);
        t.update();
        mi.material = t;
      }
  }

  private play(v: KeeperView, clip: string, fallback = 'idle') {
    const anim = v.rig?.anim;
    if (!anim) return;
    const want = anim.baseLayer?.states.includes(clip) ? clip : fallback;
    if (v.clip === want) return;
    v.clip = want;
    anim.baseLayer?.transition(want, 0.25);
  }

  /** Per frame. `night`: settled Keepers doze (E21.20's day and night tells the game when). */
  update(dt: number, night = false) {
    this.clock += dt;
    const k = this.sim.keepers;
    for (const def of KEEPERS) {
      const shown = k.visible(def.id);
      let v = this.views.get(def.id);
      if (!shown) {
        if (v) v.root.enabled = false;
        continue;
      }
      if (!v) v = this.make(def);
      v.root.enabled = true;
      const step = k.step(def.id);
      const seat = v.root.findByName('seat') as pc.Entity | null;
      const dozing = step === 'asleep' || (step === 'settled' && night);
      if (seat) seat.enabled = dozing && !v.standIn;
      // E23.2.3: on a bench beside bloombot (handled first, so its own clip choice below doesn't fight the sitting)
      const b = this.beside?.id === def.id ? this.beside : undefined;
      if (b) {
        // sat down (or sat again while still getting up): a new sitting begins; else it follows the bench spot
        if (!v.bench || v.bench.upAt !== undefined) v.bench = { ...b, since: this.clock };
        else Object.assign(v.bench, b);
      } else if (v.bench && v.bench.upAt === undefined) v.bench.upAt = this.clock;
      const bench = v.bench;
      if (bench && v.rig && !v.standIn && benchMode(def.id, v.lens.keys()) === 'clips') {
        // B5: its own sitting clips (bloombot's, retargeted onto its rig): sit-down once, sit while bloombot sits,
        // stand-up once when bloombot gets up, then back to where it was
        const sitting = bench.upAt === undefined;
        const { clip, phase } = benchClip(sitting, this.clock - (sitting ? bench.since : bench.upAt!), {
          down: v.lens.get(SEAT_CLIPS.down)!,
          up: v.lens.get(SEAT_CLIPS.up)!,
        });
        if (phase !== 'done') {
          this.play(v, clip);
          v.root.setPosition(bench.x, bench.y, bench.z);
          v.root.setEulerAngles(0, (bench.facing * 180) / Math.PI, 0);
          v.body.setLocalEulerAngles(0, 0, 0);
          const at = benchOffset(def.id, bench.seat, MODEL_SCALE, SEAT_HIPS.sit);
          v.body.setLocalPosition(0, at.y, at.z);
          if (v.prop) v.prop.enabled = false;
          continue;
        }
        v.bench = undefined;
      } else if (b) {
        // no sitting clips (the stand-in, or a model without them): the legs bent by hand (SeatPose: the Keepers
        // share bloombot's rig), the hips down on the seat; its prop set down while it sits
        this.play(v, 'idle');
        v.root.setPosition(b.x, b.y, b.z);
        v.root.setEulerAngles(0, (b.facing * 180) / Math.PI, 0);
        v.body.setLocalEulerAngles(0, 0, 0);
        v.body.setLocalPosition(0, 0, 0); // measured from standing height each frame (this runs before the reset below)
        if (v.rig && foldLegs(v.rig, v.root, 'sit')) v.body.setLocalPosition(0, b.seat + SEAT_HIPS.sit - hipsAbove(v.rig, v.root), -0.08);
        if (v.prop) v.prop.enabled = false;
        continue;
      } else v.bench = undefined;
      if (step === 'asleep') {
        // the real model dozes on its seat; the stand-in slumps forward, visor dark
        if (v.standIn) v.body.setLocalEulerAngles(28, 0, 8);
        else v.body.setLocalPosition(0, SEAT.height, 0);
        this.play(v, 'sleep');
      } else {
        v.body.setLocalEulerAngles(0, 0, 0);
        v.body.setLocalPosition(0, dozing && !v.standIn ? SEAT.height : 0, 0);
        const waving = this.clock < v.waveUntil && !this.reducedMotion;
        // E23.9.2: where it is and what it is doing come from the sim (KeeperSystem.pose: it wanders its region,
        // walks home when bloombot is near, walks to a tile and works it), so it is talked to where it is drawn
        const p = k.pose(def.id);
        v.x = p.x;
        v.z = p.z;
        v.facing = p.facing;
        if (!waving && !(step === 'settled' && night)) {
          if (p.doing === 'walk') this.play(v, 'walk');
          else if (p.doing === 'tend') {
            // tending: leaning over its tile, working the soil (a bob on top of whatever clip it has)
            this.play(v, 'interact', 'idle');
            if (!this.reducedMotion) v.body.setLocalEulerAngles(KEEPER_HELP.tendLean + Math.sin(this.clock * 6) * KEEPER_HELP.tendBob, 0, 0);
          } else this.play(v, 'idle');
        } else if (step === 'settled' && night && !waving) this.play(v, 'sleep');
        else this.play(v, waving ? 'wave' : 'idle', waving ? 'interact' : 'idle');
      }
      if (v.prop) v.prop.enabled = true;
      v.root.setPosition(v.x, this.y(v.x, v.z), v.z);
      v.root.setEulerAngles(0, (v.facing * 180) / Math.PI, 0);
    }
  }
}

/** Every Keeper's model name (for the model list). */
export const KEEPER_MODELS = KEEPERS.map((k) => `keeper-${k.id}`).filter((n) => !!MODEL_NAMES[n]);
