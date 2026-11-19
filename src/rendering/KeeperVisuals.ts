import * as pc from 'playcanvas';
import { foldLegs, hipsAbove, SEAT_HIPS } from './SeatPose';
import { GROUND } from '../core/GameState';
import { canStep } from '../core/Height';
import { inRect } from '../core/OldCityLayout';
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
  /** the Keeper's prop (set down while it sits beside bloombot) */
  prop?: pc.Entity;
  /** where it stands now (cells), and where it walks to when settled */
  x: number;
  z: number;
  to?: { x: number; z: number };
  wait: number;
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
    const v: KeeperView = { def, root, body, standIn: true, x: def.x + 0.5, z: def.z + 0.5, wait: 2, facing: Math.PI, waveUntil: 0 };
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

  /** A settled Keeper's next step on restored ground of its own region (a slow random walk, never off a cliff). */
  private nextStep(v: KeeperView): { x: number; z: number } | undefined {
    const g = this.sim.grid;
    const cx = Math.floor(v.x);
    const cz = Math.floor(v.z);
    const region = this.sim.keepers.region(v.def.id);
    const opts: { x: number; z: number }[] = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cx + dx;
      const z = cz + dz;
      const t = g.peek(GROUND, x, z);
      if (!t || t.blocked || t.occupantId || t.ground !== 'restored' || t.feature === 'water') continue;
      if (Math.abs(x - v.def.x) + Math.abs(z - v.def.z) > 8) continue;
      if (!inRect({ x: region.chunks.x0 * 16, z: region.chunks.z0 * 16, w: (region.chunks.x1 - region.chunks.x0 + 1) * 16, d: (region.chunks.z1 - region.chunks.z0 + 1) * 16 }, x, z)) continue;
      if (!canStep(cx, cz, x, z)) continue;
      opts.push({ x: x + 0.5, z: z + 0.5 });
    }
    if (!opts.length) return undefined;
    return opts[Math.floor((Math.sin(this.clock * 12.9898 + v.def.x * 78.233) * 0.5 + 0.5) * opts.length) % opts.length];
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
      if (step === 'asleep') {
        // the real model dozes on its seat; the stand-in slumps forward, visor dark
        if (v.standIn) v.body.setLocalEulerAngles(28, 0, 8);
        else v.body.setLocalPosition(0, SEAT.height, 0);
        this.play(v, 'sleep');
      } else {
        v.body.setLocalEulerAngles(0, 0, 0);
        v.body.setLocalPosition(0, dozing && !v.standIn ? SEAT.height : 0, 0);
        const waving = this.clock < v.waveUntil && !this.reducedMotion;
        if (step === 'settled' && !waving) {
          if (night) this.play(v, 'sleep');
          else {
            // wander
            if (!v.to) {
              v.wait -= dt;
              if (v.wait <= 0) {
                v.to = this.nextStep(v);
                v.wait = 1.5 + (Math.sin(this.clock + def.z) * 0.5 + 0.5) * 3;
              }
              this.play(v, 'idle');
            } else {
              const dx = v.to.x - v.x;
              const dz = v.to.z - v.z;
              const d = Math.hypot(dx, dz);
              const sp = 0.7 * dt;
              if (d <= sp) {
                v.x = v.to.x;
                v.z = v.to.z;
                v.to = undefined;
              } else {
                v.x += (dx / d) * sp;
                v.z += (dz / d) * sp;
                v.facing = Math.atan2(dx, dz);
              }
              this.play(v, 'walk');
            }
          }
        } else this.play(v, waving ? 'wave' : 'idle', waving ? 'interact' : 'idle');
      }
      const b = this.beside?.id === def.id ? this.beside : undefined;
      if (b) {
        // sitting beside bloombot: down on the bench seat (the sit-down clip the Keepers doze with, which is seat
        // height), then back to where it was afterwards. The stand-in has no sitting clip: it just stands there.
        this.play(v, 'idle');
        v.root.setPosition(b.x, b.y, b.z);
        v.root.setEulerAngles(0, (b.facing * 180) / Math.PI, 0);
        v.body.setLocalEulerAngles(0, 0, 0);
        // the legs bent by hand (SeatPose: the Keepers share bloombot's rig, and have no sitting clip), the hips
        // down on the seat; its prop set down while it sits
        if (v.rig && foldLegs(v.rig, v.root, 'sit')) v.body.setLocalPosition(0, v.body.getLocalPosition().y + b.seat + SEAT_HIPS.sit - hipsAbove(v.rig, v.root), -0.08);
        if (v.prop) v.prop.enabled = false;
        continue;
      }
      if (v.prop) v.prop.enabled = true;
      v.root.setPosition(v.x, this.y(v.x, v.z), v.z);
      v.root.setEulerAngles(0, (v.facing * 180) / Math.PI, 0);
    }
  }
}

/** Every Keeper's model name (for the model list). */
export const KEEPER_MODELS = KEEPERS.map((k) => `keeper-${k.id}`).filter((n) => !!MODEL_NAMES[n]);
