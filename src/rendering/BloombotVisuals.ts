import * as pc from 'playcanvas';
import { color, PALETTE } from './Materials';
import { BOT_CLIPS, REST, seatLift } from '../data/rest';
import { VISIT_POINTS, type Perch } from '../data/wildlife';
import { foldLegs, hipsAbove, SEAT_HIPS, swingShins, type SeatKind } from './SeatPose';
import { surfaceTriangles, skinnedVertices, vertexOnBones } from './SkinSurface';
import { inBox, type SeatBox } from './SeatBox';

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
/** the bones its shins and feet hang from (not its thighs, the UpLeg bones) */
const HANGING = /^(Left|Right)(Leg|Foot|ToeBase|Toe_End)/;
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
/** the one-shot clips into and out of sitting (oneShot) */
type SeatClip = typeof BOT_CLIPS.sitDown | typeof BOT_CLIPS.standUp;
const LOOPS: readonly string[] = ['idle', 'walk', 'hover', 'sit', 'meditate', 'doze'];

export class BloombotVisuals {
  /** placed at bloombot's feet, turned to its facing */
  readonly root = new pc.Entity('bloombot');
  private model?: pc.Entity;
  private standIn?: pc.Entity;
  private asset?: pc.Asset;
  private clips = new Map<string, number>();
  private loop: BotLoop = 'idle';
  private action?: { name: BotAction | SeatClip; until: number };
  private clock = 0;
  private destroyed = false;
  private faceMat?: pc.StandardMaterial;
  private face: BotFace = 'happy';
  private faceUntil = 0;
  private blinkAt = 3;
  reducedMotion = false;
  /** something is sitting in its lap: it keeps its legs still (they settle over a second or so) */
  lapFull = false;
  /**
   * While it sits: what it sits on (the bench's seat, the charger's pad) and what its back keeps out of (the
   * backrest), as boxes in their own frame (SeatBox: about `cx, cz`, turned by `facing` as the bench is). Bloombot settles onto the one and out of the other from its real skinned surface (settle()).
   */
  restingOn?: SeatBox;
  keepOutOf?: SeatBox;
  private settleUp = 0;
  private settleOut = 0;
  private wantUp = 0;
  private wantOut = 0;
  /**
   * How far along settling it is: a first quick look as it sits ('look'), easing there ('ease'), then watching a whole
   * breathing and leg-swing cycle holding still ('watch'), then still ('held').
   */
  private settling: 'look' | 'ease' | 'watch' | 'held' = 'look';
  private settleNext = 0;
  private settleUntil = 0;
  private settlePasses = 0;
  private needUp = -Infinity;
  private needOut = 0;
  private settledAt = 0;
  private posedAt = 0;
  private hanging?: Uint8Array;
  private measured: number[] = [];
  private legs = 1;
  private legsAt = 0;
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
    if (pose !== was) {
      // where it has always settled to on a bench with its sit clip (REST.settle.bench); the looks fine-tune it
      const from = pose === 'sit' && this.clips.has(BOT_CLIPS.sit) ? REST.settle.bench : undefined;
      this.settleUp = this.wantUp = from?.up ?? 0;
      this.settleOut = this.wantOut = from?.out ?? 0;
      this.settling = 'look';
      this.settlePasses = 0;
      this.posedAt = this.clock;
    }
    if (pose === 'meditate') this.setFace('blink', 1e9);
    else if (this.face === 'blink') this.setFace('happy');
    // #576: sitting again before it has finished standing up: straight into the new pose, not the rest of the
    // stand-up (6 s of it, played under the meditating pose, and holding off its settle)
    if (pose && this.action?.name === BOT_CLIPS.standUp) {
      this.action = undefined;
      if (this.clips.has(pose)) {
        this.model?.anim?.baseLayer?.transition(pose, BLEND);
        this.loop = pose;
      }
    }
    if (pose === 'sit' && this.clips.has(BOT_CLIPS.sitDown)) this.oneShot(BOT_CLIPS.sitDown);
    if (!pose && was === 'sit' && this.clips.has(BOT_CLIPS.standUp)) this.oneShot(BOT_CLIPS.standUp);
    if (!pose) {
      this.holder?.setLocalPosition(0, 0, 0);
      this.holder?.setLocalEulerAngles(this.tired ? 9 : 0, 0, 0);
      this.standIn?.setLocalPosition(0, 0.4, 0);
    }
  }

  private bones = new Map<string, pc.GraphNode | null>();
  private pointTmp = new pc.Vec3();

  /**
   * E23.2.4.2: where a visitor settles on or beside bloombot, in world space. Perches on bloombot ride its rig
   * (the head, the shoulders, the hips for the lap, a forearm), so they follow the sitting and meditating poses;
   * the stand-in uses fixed offsets from bloombot's feet. Offsets turn with bloombot's facing.
   */
  visitPoint(p: Perch, out: pc.Vec3): pc.Vec3 {
    const vp = VISIT_POINTS[p];
    let bone: pc.GraphNode | null = null;
    if (vp.bone && this.model) {
      if (!this.bones.has(vp.bone)) this.bones.set(vp.bone, this.model.findByName(vp.bone));
      bone = this.bones.get(vp.bone) ?? null;
    }
    const o = bone ? vp.offset : vp.fallback;
    this.root.getRotation().transformVector(this.pointTmp.set(o[0], o[1], o[2]), this.pointTmp);
    return out.copy(bone ? bone.getPosition() : this.root.getPosition()).add(this.pointTmp);
  }

  private surfaceAt = -1;
  private surfacePts: number[] = [];
  private cornerPts: number[] = [];

  /**
   * E23.2.4: bloombot's surface as drawn right now (SkinSurface: its triangles, skinned on the CPU, 9 numbers each in
   * world space), for visitors to rest on. Read at most once a frame; empty until the model has loaded.
   */
  surface(): readonly number[] {
    if (!this.model) return [];
    if (this.surfaceAt !== this.clock) {
      this.surfaceAt = this.clock;
      this.surfacePts.length = 0;
      this.cornerPts.length = 0;
      surfaceTriangles(this.model, this.surfacePts, this.cornerPts);
    }
    return this.surfacePts;
  }
  /** Its vertices as drawn right now (each once, x, y, z triples), from the same skinning as surface(). */
  corners(): readonly number[] {
    this.surface();
    return this.cornerPts;
  }

  private rig?: readonly pc.GraphNode[];
  /** The bones its skin hangs from (an animal resting on it rides the one nearest where it touches). */
  skinBones(): readonly pc.GraphNode[] {
    if (!this.model) return [];
    if (!this.rig) {
      const all = new Set<pc.GraphNode>();
      for (const r of this.model.findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) for (const b of mi.skinInstance?.bones ?? []) all.add(b);
      this.rig = [...all];
    }
    return this.rig;
  }


  /** A one-shot clip by name (the sitting transitions), back to the loop afterwards. */
  private oneShot(name: SeatClip) {
    const anim = this.model?.anim;
    const len = this.clips.get(name);
    if (!anim || !len) return;
    anim.speed = 1;
    anim.baseLayer?.transition(name, 0.12);
    this.action = { name, until: this.clock + len * 0.95 };
  }

  private posed() {
    const h = this.holder;
    const clip = (n: string) => this.clips.has(n);
    if (this.pose === 'sit') {
      // with the sit clip the hips come down to the seat's height; without it (the model has no sitting clips yet,
      // #482) the legs are bent by hand: thighs along the seat, shins hanging, the hips resting on the seat
      // bend and swing the legs first: it settles onto the seat as drawn (the clip alone has it standing)
      const y = clip(BOT_CLIPS.sit) ? seatLift(this.seat, SCALE) : this.fold('sit') + this.seat;
      this.swingLegs();
      this.settle();
      h?.setLocalPosition(0, y + this.settleUp, -0.12 + this.settleOut);
      h?.setLocalEulerAngles(0, 0, 0);
      this.standIn?.setLocalPosition(0, 0.4 + this.seat, -0.1);
    } else if (this.pose === 'meditate') {
      // the clip sits cross-legged on the ground; without it the legs are crossed by hand, settled low, breathing
      const breathe = this.reducedMotion ? 0 : Math.sin(this.clock * 1.6) * 0.012;
      const y = clip(BOT_CLIPS.meditate) ? 0 : this.fold('meditate') + breathe;
      this.settle();
      h?.setLocalPosition(0, y + this.settleUp, 0);
      h?.setLocalEulerAngles(0, 0, 0);
      this.standIn?.setLocalPosition(0, 0.26, 0);
    }
    const anim = this.model?.anim;
    if (anim && !this.action) anim.speed = this.pose === 'meditate' ? 0.6 : 0.8; // slow, calm breathing
  }

  /**
   * Sitting: settles onto what it sits on from its real skinned surface as drawn (after the legs are bent and swung;
   * REST.settle). A first look as soon as it has bent into the pose brings it roughly there. Then, holding still, it
   * watches a whole breathing and leg-swing cycle and takes the most it needs to come up (and forward) across it,
   * so its underside never dips into the seat or pad between looks and the breathing stays smooth; once that needs
   * no more than a hair, it holds. Not while a clip into the pose plays.
   */
  private settle() {
    const k = REST.settle;
    if (!this.model || !this.restingOn) {
      this.settleUp = this.wantUp = 0;
      this.settleOut = this.wantOut = 0;
      return;
    }
    const dt = Math.min(0.1, Math.max(0, this.clock - this.settledAt));
    this.settledAt = this.clock;
    const ease = Math.min(1, dt * k.ease);
    this.settleUp += (this.wantUp - this.settleUp) * ease;
    this.settleOut += (this.wantOut - this.settleOut) * ease;
    // not while it is still getting into the pose (its legs straight down under it as it bends)
    if (this.action || this.clock - this.posedAt < k.after) return;
    if (this.settling === 'look') {
      const m = this.measure();
      this.aim(m.up, m.out);
    } else if (this.settling === 'ease' && this.clock >= this.settleUntil) {
      // there: hold still while it watches a cycle
      this.settleUp = this.wantUp;
      this.settleOut = this.wantOut;
      this.settling = 'watch';
      this.settleNext = this.clock;
      this.settleUntil = this.clock + k.cycle;
      this.needUp = -Infinity;
      this.needOut = 0;
    } else if (this.settling === 'watch' && this.clock >= this.settleNext) {
      const m = this.measure();
      this.needUp = Math.max(this.needUp, m.up);
      this.needOut = Math.max(this.needOut, m.out);
      this.settleNext = this.clock + k.watchEvery;
      if (this.clock >= this.settleUntil) {
        this.settlePasses++;
        const up = Number.isFinite(this.needUp) ? this.needUp : 0;
        const done = (Math.abs(up) <= k.hair && this.needOut <= k.hair) || this.settlePasses >= k.passes;
        this.aim(up, this.needOut);
        if (done) this.settling = 'held';
      }
    }
  }

  /** Eases toward `up` and `out` more than it is now (within REST.settle.most), and looks again once there. */
  private aim(up: number, out: number) {
    const k = REST.settle;
    const clamp = (v: number) => Math.max(-k.most, Math.min(k.most, v));
    this.wantUp = clamp(this.settleUp + up);
    this.wantOut = clamp(this.settleOut + out);
    this.settling = 'ease';
    this.settleUntil = this.clock + k.easeFor;
  }

  /**
   * One look at itself as drawn now: how far it must come up for its lowest point over the seat (or pad) to rest on
   * the top (down if negative; its shins and feet don't count on a bench, they hang over the front edge), and how far
   * forward for nothing of its back to be in the backrest and no shin in the seat's slab.
   */
  private measure(): { up: number; out: number } {
    const k = REST.settle;
    const pts = this.measured;
    pts.length = 0;
    skinnedVertices(this.model!, pts);
    const hang = this.pose === 'sit' ? (this.hanging ??= vertexOnBones(this.model!, (n) => HANGING.test(n), k.hangShare)) : undefined;
    const s = this.restingOn!;
    const b = this.keepOutOf;
    let low = Infinity;
    let out = 0;
    for (let v = 0, i = 0; i < pts.length; v++, i += 3) {
      const y = pts[i + 1];
      const w = inBox(s, pts[i], pts[i + 2]);
      if (w !== undefined && !hang?.[v]) low = Math.min(low, y);
      else if (w !== undefined && y > s.y[0] && y < s.y[1] - k.gap) out = Math.max(out, s.z[1] - w + k.gap); // a shin in the seat's slab (under it is open)
      if (b && y > b.y[0] && y < b.y[1]) {
        const bw = inBox(b, pts[i], pts[i + 2]);
        if (bw !== undefined) out = Math.max(out, b.z[1] - bw + k.gap);
      }
    }
    return { up: Number.isFinite(low) ? s.y[1] + k.gap - low : 0, out };
  }

  /**
   * On a bench: its little legs swing, one forward as the other goes back, now livelier, now nearly still; and still
   * while something sits in its lap (a frog on its knees).
   */
  private swingLegs() {
    if (!this.model || this.reducedMotion) return;
    const s = REST.legSwing;
    const dt = Math.min(0.1, Math.max(0, this.clock - this.legsAt));
    this.legsAt = this.clock;
    this.legs += ((this.lapFull ? 0 : 1) - this.legs) * Math.min(1, dt * s.settle);
    const drift = 0.5 - 0.5 * Math.cos((this.clock * Math.PI * 2) / s.driftSeconds);
    const deg = this.legs * s.degrees * (s.calmest + (1 - s.calmest) * drift) * Math.sin(this.clock * Math.PI * 2 * s.perSecond);
    swingShins(this.model, this.root, deg, -deg);
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

  /** Sitting or meditating, and settled onto what it sits on (REST.settle: its looks are done; tests). */
  get settled(): boolean {
    return !!this.pose && this.settling === 'held';
  }

  get busy(): BotAction | SeatClip | undefined {
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
