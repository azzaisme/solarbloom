import * as pc from 'playcanvas';
import { GROUND } from '../core/GameState';
import { canStep } from '../core/Height';
import { KEEPER_HELP } from '../data/keepers';
import { keeperCanStand, keeperPath } from '../gameplay/KeeperSystem';
import { KEEPERS, MODEL_NAMES, type KeeperDef } from '../data/oldcity';
import type { Sim } from '../gameplay/Sim';
import { MODELS, oldCityModel } from './Models';
import { SLAB_TOP } from './SceneBuilder';
import { color } from './Materials';

/** The Keepers' own rigged models (assets/raw/models/final/keeper-<id>.glb: clips idle, wave, sleep), when they land. */
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
  /** where it stands now (cells), and where it walks to when settled */
  x: number;
  z: number;
  to?: { x: number; z: number };
  wait: number;
  /** E23.9.2: the cells still to walk through (cell centres), after `to` */
  path: { x: number; z: number }[];
  facing: number;
  waveUntil: number;
  clip?: string;
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
    const v: KeeperView = { def, root, body, standIn: true, x: def.x + 0.5, z: def.z + 0.5, wait: 2, path: [], facing: Math.PI, waveUntil: 0 };
    const own = KEEPER_URLS[`../../assets/raw/models/final/keeper-${def.id}.glb`];
    v.standIn = !own;
    // registered before loading: a model the library already holds comes back synchronously, inside this call, and
    // a Keeper not yet in `views` would throw its rig away (Pylon, in Mast Row, never got its body)
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
        e.anim!.assignAnimation(track.name, track, undefined, 1, track.name === 'idle' || track.name === 'sleep' || track.name === 'walk');
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

  /** A woken Keeper's next wandering step: a cell it can stand on beside it (a slow random walk, never off a cliff). */
  private nextStep(v: KeeperView): { x: number; z: number } | undefined {
    const cx = Math.floor(v.x);
    const cz = Math.floor(v.z);
    const opts: { x: number; z: number }[] = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx;
      const z = cz + dz;
      if (!keeperCanStand(this.sim, v.def.id, x, z) || !canStep(cx, cz, x, z)) continue;
      opts.push({ x: x + 0.5, z: z + 0.5 });
    }
    if (!opts.length) return undefined;
    return opts[Math.floor((Math.sin(this.clock * 12.9898 + v.def.x * 78.233) * 0.5 + 0.5) * opts.length) % opts.length];
  }

  /** E23.9.2: sets a Keeper walking to a cell along ground it can stand on (straight there if there is no such way). */
  private route(v: KeeperView, to: { x: number; z: number }) {
    const from = { x: Math.floor(v.x), z: Math.floor(v.z) };
    const cells = keeperPath(this.sim, v.def.id, from, to) ?? [from, to];
    v.path = cells.slice(1).map((c) => ({ x: c.x + 0.5, z: c.z + 0.5 }));
    v.to = v.path.shift();
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
      if (!v) this.views.set(def.id, (v = this.make(def)));
      v.root.enabled = true;
      const step = k.step(def.id);
      const seat = v.root.findByName('seat') as pc.Entity | null;
      const dozing = step === 'asleep' || (step === 'settled' && night);
      if (seat) seat.enabled = dozing && !v.standIn;
      if (step === 'asleep') {
        // the real model dozes on its seat; the stand-in slumps forward, visor dark
        if (v.standIn) v.body.setLocalEulerAngles(28, 0, 8);
        else v.body.setLocalPosition(0, SEAT.height, 0);
        this.play(v, 'sleep');
      } else {
        v.body.setLocalEulerAngles(0, 0, 0);
        v.body.setLocalPosition(0, dozing && !v.standIn ? SEAT.height : 0, 0);
        const waving = this.clock < v.waveUntil && !this.reducedMotion;
        if (!waving && !(step === 'settled' && night)) {
          // E23.9.2: a woken Keeper hangs around its region by day. Off to tend a tile, it walks there and tends it
          // (the tile blooms when it is done, KeeperSystem); otherwise, with bloombot near, it walks home to be
          // talked to; otherwise it wanders.
          const bot = this.sim.bot;
          const near = !!bot && Math.hypot(bot.x - (def.x + 0.5), bot.z - (def.z + 0.5)) < KEEPER_HELP.comeHomeTiles;
          const cx = Math.floor(v.x);
          const cz = Math.floor(v.z);
          const tend = k.tendingAt(def.id);
          const goal = tend ?? (near ? { x: def.x, z: def.z } : undefined);
          if (!v.to && goal && (cx !== goal.x || cz !== goal.z)) this.route(v, goal);
          if (v.to) {
            const dx = v.to.x - v.x;
            const dz = v.to.z - v.z;
            const d = Math.hypot(dx, dz);
            const sp = KEEPER_HELP.walkSpeed * dt;
            if (d <= Math.max(sp, KEEPER_HELP.arriveTiles)) {
              v.x = v.to.x;
              v.z = v.to.z;
              v.to = v.path.shift();
            } else {
              v.x += (dx / d) * sp;
              v.z += (dz / d) * sp;
              v.facing = Math.atan2(dx, dz);
            }
            this.play(v, 'walk');
          } else if (tend) {
            // tending: leaning over its tile, working the soil (a bob on top of whatever clip it has)
            this.play(v, 'interact', 'idle');
            if (!this.reducedMotion) v.body.setLocalEulerAngles(KEEPER_HELP.tendLean + Math.sin(this.clock * 6) * KEEPER_HELP.tendBob, 0, 0);
          } else if (near) {
            v.facing = Math.atan2(bot!.x - v.x, bot!.z - v.z);
            this.play(v, 'idle');
          } else {
            v.wait -= dt;
            if (v.wait <= 0) {
              v.to = this.nextStep(v);
              v.path = [];
              v.wait = 1.5 + (Math.sin(this.clock + def.z) * 0.5 + 0.5) * 3;
            }
            this.play(v, 'idle');
          }
        } else if (step === 'settled' && night && !waving) this.play(v, 'sleep');
        else this.play(v, waving ? 'wave' : 'idle', waving ? 'interact' : 'idle');
      }
      v.root.setPosition(v.x, this.y(v.x, v.z), v.z);
      v.root.setEulerAngles(0, (v.facing * 180) / Math.PI, 0);
    }
  }
}

/** Every Keeper's model name (for the model list). */
export const KEEPER_MODELS = KEEPERS.map((k) => `keeper-${k.id}`).filter((n) => !!MODEL_NAMES[n]);
