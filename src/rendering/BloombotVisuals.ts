import * as pc from 'playcanvas';
import { color, PALETTE } from './Materials';

/**
 * Bloombot (#234, G.10 + G.1): the player character, and the game's first skinned model. The GLB comes from
 * Meshy (generated, rigged, animated) and a Blender pass (assets/raw/bloombot/blender-pass.py); it holds one
 * skinned mesh, a 24-bone rig and seven clips: idle, walk, run (loops), pulse, assemble, interact, cheer
 * (one-shots). Front is +Z, pivot at the feet, about 0.9 m tall.
 *
 * Until the model loads (or if it fails) a small stand-in capsule is drawn, so walking works from frame one.
 * Presentation only: nothing here touches the simulation.
 */
const MODEL_URL = new URL('../../assets/raw/bloombot/bloombot.glb', import.meta.url).href;
/** Model metres -> world units (1 tile = 1 m). A touch under a tile tall, like the mock beside a bench. */
const SCALE = 0.95;
/** Clip speeds at which the feet match the ground: world units per second at anim speed 1. */
const STRIDE = { walk: 1.15, run: 3.1 } as const;
const BLEND = 0.18;

export type BotLoop = 'idle' | 'walk' | 'run';
export type BotAction = 'pulse' | 'assemble' | 'interact' | 'cheer';
const LOOPS: readonly string[] = ['idle', 'walk', 'run'];

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
  reducedMotion = false;
  /** true once the real model is drawn */
  loaded = false;

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
    const e = res.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
    holder.addChild(e);
    e.addComponent('anim', { activate: true });
    const anim = e.anim!;
    for (const a of res.animations) {
      const track = a.resource as pc.AnimTrack;
      const looped = LOOPS.includes(track.name);
      anim.assignAnimation(track.name, track, undefined, 1, looped);
      this.clips.set(track.name, track.duration);
    }
    this.root.addChild(holder);
    this.model = e;
    this.standIn?.destroy();
    this.standIn = undefined;
    this.loaded = true;
    anim.baseLayer?.transition('idle', 0);
  }

  /** Places bloombot (feet) and turns it to face `facing` (radians, 0 = +z). */
  place(x: number, y: number, z: number, facing: number) {
    this.root.setPosition(x, y, z);
    this.root.setEulerAngles(0, (facing * 180) / Math.PI, 0);
  }

  /** The looping clip, from how fast bloombot moves (world units per second). */
  setMotion(speed: number, sprinting: boolean) {
    const want: BotLoop = speed < 0.05 ? 'idle' : sprinting ? 'run' : 'walk';
    const anim = this.model?.anim;
    if (!anim) return;
    if (!this.action) {
      if (want !== this.loop) anim.baseLayer?.transition(want, BLEND);
      anim.speed = want === 'idle' ? 1 : pc.math.clamp(speed / STRIDE[want], 0.5, 1.8);
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
    this.action = { name, until: this.clock + dur * 0.92 };
    return dur;
  }

  get busy(): BotAction | undefined {
    return this.action?.name;
  }

  update(dt: number) {
    this.clock += dt;
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
