import * as pc from 'playcanvas';
import { color, PALETTE } from './Materials';
import { BOT_CLIPS, seatLift } from '../data/rest';
import { foldLegs, hipsAbove, SEAT_HIPS, type SeatKind } from './SeatPose';

/**
 * Bloombot (#234, G.10 + G.1): the player character, and the game's first skinned model. The GLB comes from
 * Meshy (generated, rigged, animated) and a Blender pass (assets/raw/bloombot/blender-pass.py); it holds one
 * skinned model in rigid robot pieces, a 24-bone rig and nine clips: idle, walk, hover, sit, meditate (loops), pulse,
 * assemble, interact, cheer (one-shots). Front is +Z, pivot at the feet, about 0.9 m tall.
 *
 * Until the model loads (or if it fails) a small stand-in capsule is drawn, so walking works from frame one.
 * Presentation only: nothing here touches the simulation.
 */
const MODEL_URL = new URL('../../assets/raw/bloombot/bloombot.glb', import.meta.url).href;
/** Visor faces (assets/tools/bloombot_faces.py): one row of frames, in FACES order. */
const FACES_URL = new URL('../../assets/raw/bloombot/bloombot-faces.png', import.meta.url).href;
export const FACES = ['happy', 'surprised', 'wink', 'blink'] as const;
export type BotFace = (typeof FACES)[number];
/** Model metres -> world units (1 tile = 1 m). A touch under a tile tall, like the mock beside a bench. */
const SCALE = 0.95;
/**
 * Walk clip speed at which the feet match the ground: world units per second at anim speed 1. The toddler
 * waddle from the Blender pass (0.479 m/s, which it prints, times SCALE). Hover has no feet on the ground, so it
 * always plays at speed 1.
 */
const WALK_STRIDE = 0.455;
const BLEND = 0.18;
/** The visor's middle, from the feet (front is +z), in world units. */
const EYE = new pc.Vec3(0, 0.66, 0.2);
/** Where the echo palms are while pulsing (model space, before SCALE): chest height, pushed forward. */
const PALM = new pc.Vec3(0.06, 0.46, 0.34);

export type BotLoop = 'idle' | 'walk' | 'hover' | 'sit' | 'meditate';
export type BotAction = 'pulse' | 'assemble' | 'interact' | 'cheer';
const LOOPS: readonly string[] = ['idle', 'walk', 'hover', 'sit', 'meditate', 'doze'];

export class BloombotVisuals {
  /** placed at bloombot's feet, turned to its facing */
  readonly root = new pc.Entity('bloombot');
  private model?: pc.Entity;
  private standIn?: pc.Entity;
  private asset?: pc.Asset;
  private clips = new Map<string, number>();
  private loop: BotLoop = 'idle';
  private action?: { name: BotAction; until: number };
  private clock = 0;
  private destroyed = false;
  private faceMat?: pc.StandardMaterial;
  private face: BotFace = 'happy';
  private faceUntil = 0;
  private blinkAt = 3;
  reducedMotion = false;
  /** true once the real model is drawn */
  loaded = false;
  /** the model's holder (the seated poses move it) */
  private holder?: pc.Entity;
  /**
   * E23.2.3: a seated pose, played as its looping clip (assets/raw/bloombot/add-rest-clips.py): 'sit' on a bench
   * seat, thighs forward and shins down; 'meditate' cross-legged on the ground, hands by the knees, eyes closed.
   * The stand-in (before the model loads) just sits lower.
   */
  private pose?: 'sit' | 'meditate';
  /** E23.2.1: out of charge: bloombot droops a little and its walk slows (the low-power walk) */
  private tired = false;

  constructor(
    private app: pc.AppBase,
    parent: pc.Entity,
  ) {
    parent.addChild(this.root);
    this.buildStandIn();
    app.assets.loadFromUrl(MODEL_URL, 'container', (err, asset) => {
      if (this.destroyed) {
        asset?.unload();
        return;
      }
      if (err || !asset) {
        console.warn('Bloombot model failed to load; keeping the stand-in.', err);
        return;
      }
      this.asset = asset;
      this.attach(asset.resource as pc.ContainerResource);
    });
  }

  private buildStandIn() {
    const e = new pc.Entity('bloombot-standin');
    const m = new pc.StandardMaterial();
    m.diffuse = color(PALETTE.plastic.shell);
    m.update();
    e.addComponent('render', { type: 'capsule', material: m, castShadows: true });
    e.setLocalScale(0.45, 0.8, 0.45);
    e.setLocalPosition(0, 0.4, 0);
    this.root.addChild(e);
    this.standIn = e;
  }

  private attach(res: pc.ContainerResource) {
    // The glTF root is the rig's Armature node, which carries its own 0.01 (centimetre) scale: keep it and
    // scale a holder around it instead.
    const holder = new pc.Entity('bloombot-model');
    holder.setLocalScale(SCALE, SCALE, SCALE);
    this.holder = holder;
    const e = res.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
    holder.addChild(e);
    this.root.addChild(holder);
    this.addFace(holder, e);
    e.addComponent('anim', { activate: true });
    const anim = e.anim!;
    for (const a of res.animations) {
      const track = a.resource as pc.AnimTrack;
      const looped = LOOPS.includes(track.name);
      anim.assignAnimation(track.name, track, undefined, 1, looped);
      this.clips.set(track.name, track.duration);
    }
    this.model = e;
    this.standIn?.destroy();
    this.standIn = undefined;
    this.loaded = true;
    anim.baseLayer?.transition('idle', 0);
  }

  /**
   * The visor face: the Blender pass cuts the visor out as its own part (material `bloombot_visor`, skinned to
   * the head) with flat front-on UVs, so the face sheet's frames lie on the real curved visor.
   */
  private addFace(_holder: pc.Entity, rig: pc.Entity) {
    const mi = rig.findComponents('render').flatMap((r) => (r as pc.RenderComponent).meshInstances).find((m) => m.material?.name === 'bloombot_visor');
    if (!mi) return;
    const m = new pc.StandardMaterial();
    m.name = 'bloombot_visor_face';
    m.diffuse.set(0, 0, 0);
    m.emissive.set(1, 1, 1);
    m.emissiveIntensity = 1.6;
    m.gloss = 0.85;
    m.emissiveMapTiling.set(1 / FACES.length, 1);
    m.update();
    mi.material = m;
    this.faceMat = m;
    this.app.assets.loadFromUrl(FACES_URL, 'texture', (err, asset) => {
      if (err || !asset || this.destroyed) return;
      const t = asset.resource as pc.Texture;
      t.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
      t.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
      m.emissiveMap = t;
      this.setFace(this.face);
    });
  }

  /** Shows a visor face, for `seconds` (then back to happy), or until changed. */
  setFace(face: BotFace, seconds = 0) {
    this.face = face;
    this.faceUntil = seconds ? this.clock + seconds : 0;
    const m = this.faceMat;
    if (!m) return;
    m.emissiveMapOffset.set(FACES.indexOf(face) / FACES.length, 0);
    m.update();
  }

  /** E19: where bloombot's eyes are (world): the build hologram is projected from here. */
  eyeWorld(out: pc.Vec3): pc.Vec3 {
    return this.root.getWorldTransform().transformPoint(EYE, out);
  }

  /** Where bloombot's palms are mid-pulse (world): the pulse rings leave from here. */
  palmWorld(out: pc.Vec3): pc.Vec3 {
    return this.root.getWorldTransform().transformPoint(PALM, out);
  }

  /** Places bloombot (feet) and turns it to face `facing` (radians, 0 = +z). */
  place(x: number, y: number, z: number, facing: number) {
    this.root.setPosition(x, y, z);
    this.root.setEulerAngles(0, (facing * 180) / Math.PI, 0);
  }

  /** the bench seat's height while sitting on one (world units) */
  private seat = 0;

  /**
   * E23.2.3: sit on a bench (`seat`: its height), meditate at a charger, or stand (undefined). Plays the clip into
   * the pose (sit down, stand up) where the model has it.
   */
  setPose(pose: 'sit' | 'meditate' | undefined, seat = 0) {
    const was = this.pose;
    this.pose = pose;
    this.seat = seat;
    if (pose === 'meditate') this.setFace('blink', 1e9);
    else if (this.face === 'blink') this.setFace('happy');
    if (pose === 'sit' && this.clips.has(BOT_CLIPS.sitDown)) this.oneShot(BOT_CLIPS.sitDown);
    if (!pose && was === 'sit' && this.clips.has(BOT_CLIPS.standUp)) this.oneShot(BOT_CLIPS.standUp);
    if (!pose) {
      this.holder?.setLocalPosition(0, 0, 0);
      this.holder?.setLocalEulerAngles(this.tired ? 9 : 0, 0, 0);
      this.standIn?.setLocalPosition(0, 0.4, 0);
    }
  }

  /** A one-shot clip by name (the sitting transitions), back to the loop afterwards. */
  private oneShot(name: string) {
    const anim = this.model?.anim;
    const len = this.clips.get(name);
    if (!anim || !len) return;
    anim.speed = 1;
    anim.baseLayer?.transition(name, 0.12);
    this.action = { name: name as BotAction, until: this.clock + len * 0.95 };
  }

  private posed() {
    const h = this.holder;
    const clip = (n: string) => this.clips.has(n);
    if (this.pose === 'sit') {
      // with the sit clip the hips come down to the seat's height; without it (the model has no sitting clips yet,
      // #482) the legs are bent by hand: thighs along the seat, shins hanging, the hips resting on the seat
      if (clip(BOT_CLIPS.sit)) h?.setLocalPosition(0, seatLift(this.seat, SCALE), -0.12);
      else h?.setLocalPosition(0, this.fold('sit') + this.seat, -0.12);
      h?.setLocalEulerAngles(0, 0, 0);
      this.standIn?.setLocalPosition(0, 0.4 + this.seat, -0.1);
    } else if (this.pose === 'meditate') {
      // the clip sits cross-legged on the ground; without it the legs are crossed by hand, settled low, breathing
      const breathe = this.reducedMotion ? 0 : Math.sin(this.clock * 1.6) * 0.012;
      h?.setLocalPosition(0, clip(BOT_CLIPS.meditate) ? 0 : this.fold('meditate') + breathe, 0);
      h?.setLocalEulerAngles(0, 0, 0);
      this.standIn?.setLocalPosition(0, 0.26, 0);
    }
    const anim = this.model?.anim;
    if (anim && !this.action) anim.speed = this.pose === 'meditate' ? 0.6 : 0.8; // slow, calm breathing
  }

  /**
   * E23.2.3: the seated poses without their clips: bends the legs of the idle pose by hand (SeatPose), every frame
   * after the animation has run. Returns how far to move the model so the hips rest on the seat (or the ground).
   */
  private fold(kind: SeatKind): number {
    const rig = this.model;
    const holder = this.holder;
    if (!rig || !holder || !foldLegs(rig, this.root, kind)) return kind === 'sit' ? 0 : -0.14;
    return SEAT_HIPS[kind] - hipsAbove(rig, holder);
  }

  /** E23.2.1: out of charge (or not): a tired droop, head and shoulders forward. */
  setTired(on: boolean) {
    if (on === this.tired) return;
    this.tired = on;
    this.holder?.setLocalEulerAngles(on ? 9 : 0, 0, 0);
    this.standIn?.setLocalEulerAngles(on ? 9 : 0, 0, 0);
  }

  /** The looping clip, from how fast bloombot moves (world units per second) and whether it hovers (sprint). */
  setMotion(speed: number, hovering: boolean) {
    const want: BotLoop = this.pose && this.clips.has(this.pose) ? this.pose : speed < 0.05 ? 'idle' : hovering ? 'hover' : 'walk';
    const anim = this.model?.anim;
    if (!anim) return;
    if (!this.action) {
      if (want !== this.loop) anim.baseLayer?.transition(want, BLEND);
      anim.speed = want === 'walk' ? pc.math.clamp(speed / WALK_STRIDE, 0.5, 1.8) : 1;
    }
    this.loop = want;
  }

  /** Plays a one-shot clip, then blends back to the current loop. Returns its length in seconds (0 if none). */
  play(name: BotAction): number {
    const anim = this.model?.anim;
    const len = this.clips.get(name);
    if (!anim || !len) return 0;
    if (this.reducedMotion && name === 'cheer') return 0;
    if (this.pose) return 0; // sitting or meditating: no standing gestures (a cheer would pop it up off the seat)
    anim.speed = name === 'pulse' ? 1.6 : name === 'assemble' ? 1.2 : 1;
    anim.baseLayer?.transition(name, 0.1);
    const dur = len / anim.speed;
    if (name === 'cheer') this.setFace('wink', dur);
    else if (name === 'interact') this.setFace('surprised', Math.min(dur, 0.9));
    this.action = { name, until: this.clock + dur * 0.92 };
    return dur;
  }

  get busy(): BotAction | undefined {
    return this.action?.name;
  }

  update(dt: number) {
    this.clock += dt;
    if (this.pose) this.posed();
    // Faces: an expression times out back to happy; now and then a blink.
    if (this.faceUntil && this.clock >= this.faceUntil) this.setFace('happy');
    if (this.clock >= this.blinkAt) {
      if (this.face === 'happy' && !this.reducedMotion) this.setFace('blink', 0.13);
      this.blinkAt = this.clock + 2.5 + ((this.clock * 7.31) % 3);
    }
    if (this.action && this.clock >= this.action.until) {
      this.action = undefined;
      const anim = this.model?.anim;
      if (anim) {
        anim.speed = 1;
        anim.baseLayer?.transition(this.loop, BLEND);
      }
    }
  }

  destroy() {
    this.destroyed = true;
    this.root.destroy();
    this.asset?.unload();
    if (this.asset) this.app.assets.remove(this.asset);
  }
}
