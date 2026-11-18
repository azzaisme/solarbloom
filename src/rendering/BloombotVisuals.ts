import * as pc from 'playcanvas';
import { color, PALETTE } from './Materials';

/**
 * Bloombot (#234, G.10 + G.1): the player character, and the game's first skinned model. The GLB comes from
 * Meshy (generated, rigged, animated) and a Blender pass (assets/raw/bloombot/blender-pass.py); it holds one
 * skinned model in rigid robot pieces, a 24-bone rig and seven clips: idle, walk, hover (loops), pulse,
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

export type BotLoop = 'idle' | 'walk' | 'hover';
export type BotAction = 'pulse' | 'assemble' | 'interact' | 'cheer';
const LOOPS: readonly string[] = ['idle', 'walk', 'hover'];

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
   * E23.2.3: a seated pose. 'sit': up on a bench seat, leaning back a little; 'meditate': settled low on the
   * ground, eyes closed, breathing slowly. Procedural until the cross-legged clip lands (an art pass).
   */
  private pose?: 'sit' | 'meditate';

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

  /** E23.2.3: sit on a bench, meditate at a charger, or stand (undefined). */
  setPose(pose: 'sit' | 'meditate' | undefined) {
    this.pose = pose;
    if (pose === 'meditate') this.setFace('blink', 1e9);
    else if (this.face === 'blink') this.setFace('happy');
    if (!pose) {
      this.holder?.setLocalPosition(0, 0, 0);
      this.holder?.setLocalEulerAngles(0, 0, 0);
      this.standIn?.setLocalPosition(0, 0.4, 0);
    }
  }

  private posed() {
    const h = this.holder;
    const breathe = this.reducedMotion ? 0 : Math.sin(this.clock * 1.6);
    if (this.pose === 'sit') {
      h?.setLocalPosition(0, 0.2, -0.1);
      h?.setLocalEulerAngles(-8, 0, 0);
      this.standIn?.setLocalPosition(0, 0.6, -0.1);
    } else if (this.pose === 'meditate') {
      h?.setLocalPosition(0, -0.14 + breathe * 0.012, 0);
      h?.setLocalEulerAngles(4, 0, 0);
      this.standIn?.setLocalPosition(0, 0.26, 0);
    }
    const anim = this.model?.anim;
    if (anim && !this.action) anim.speed = this.pose === 'meditate' ? 0.35 : 0.6;
  }

  /** The looping clip, from how fast bloombot moves (world units per second) and whether it hovers (sprint). */
  setMotion(speed: number, hovering: boolean) {
    const want: BotLoop = speed < 0.05 ? 'idle' : hovering ? 'hover' : 'walk';
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
