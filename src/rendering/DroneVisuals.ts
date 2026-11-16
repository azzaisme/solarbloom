import * as pc from 'playcanvas';
import type { DroneData } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from '../gameplay/Sim';
import { color, glow as glowGain, mat, PALETTE } from './Materials';
import { group, shape } from './Shapes';
import { ease, type Tweens } from './Tween';

/**
 * The redesigned drone (docs/art/SOLARBLOOM_DRONE_REDESIGN.md), built in Blender by
 * assets/tools/drone_build.py. Blender space is face +X, up +Z; glTF keeps +X forward with +Y up
 * (so model Z is the drone's right). Every object's origin is its animation pivot: drone_body,
 * visor_eyes, antenna, leaf_L, leaf_R, thruster_C, thruster_L, thruster_R.
 *
 * Expressions (D03) and personality animation (D04) are presentation only: nothing here changes
 * gameplay state, targets or timing.
 */
const MODEL_URL = new URL('../../assets/raw/drone/drone-base.glb', import.meta.url).href;
/** Model units -> world units. The body is about 0.39 wide, a touch bigger than the classic drone. */
const MODEL_SCALE = 0.58;
/** The model's origin sits 0.05 model units above the body's centre; lift it back so the body is centred. */
const MODEL_LIFT = 0.05 * MODEL_SCALE;
/** Eye sprite sheet (assets/tools/drone_eye_sheet.py): 8 frames in a row; the screen's UVs show frame 0. */
const SHEET_FRAMES = 8;
export const FACE = { idle: 0, focused: 1, excited: 2, workingA: 3, workingB: 4, restoring: 5, sleeping: 6, blink: 7 } as const;
export type FaceName = keyof typeof FACE;
/** Screen glow levels: dim (old drones, sleeping), normal, bright (restoring). */
const GLOW = [0.55, 1.3, 2.1] as const;

const BODY_D = 0.39; // body diameter, world units
const BOB = { amp: 0.045 * BODY_D, period: 2.0 }; // spec D04: 0.03–0.06 body diameters over 1.5–2.5 s
const CELEBRATE_S = 1.6;
/** D05: the restoration beam leaves from the front underside of the body (root space, world units). */
const EMITTER = new pc.Vec3(0, -0.13, 0.12);
const BEAM_RADIUS = 0.26; // at the ground
const MOTE_EVERY = 0.07; // seconds between travelling motes
const SPARKLE_EVERY = 0.22; // seconds between ground sparkles
const UP = new pc.Vec3(0, 1, 0);
const BOUNCE_S = 0.42;
const WIGGLE_S = 0.7;

/** `?drone=classic` shows the original primitive drone, for comparison while the redesign is reviewed. */
const useModel = () => typeof location === 'undefined' || new URLSearchParams(location.search).get('drone') !== 'classic';

/** A damped spring for the leaf ears and antenna. */
interface Spring {
  a: number;
  v: number;
}
function spring(s: Spring, target: number, dt: number, k = 60, damp = 7) {
  s.v += (k * (target - s.a) - damp * s.v) * dt;
  s.a += s.v * dt;
}

interface ModelParts {
  leafL: pc.Entity;
  leafR: pc.Entity;
  antenna?: pc.Entity;
  thrusters: pc.Entity[];
  face?: { mi: pc.MeshInstance; frame: number; glow: number; old: boolean };
}

interface DroneView {
  root: pc.Entity;
  body: pc.Entity;
  /** D05: the restoration beam, a soft outer cone and a bright inner stream (world space, apex at the emitter). */
  beam: pc.Entity;
  beamCore: pc.Entity;
  moteT: number;
  sparkT: number;
  /** Classic drone only. */
  classic?: { finL: pc.Entity; finR: pc.Entity; eyes: pc.Entity[] };
  /** Model drone only. */
  model?: ModelParts;
  yaw: number;
  x: number;
  z: number;
  y: number;
  phase: number;
  blink: number;
  // personality state (presentation only)
  vel: number;
  tilt: number;
  celebrate: number;
  bounce: number;
  wiggle: number;
  lastMode: DroneData['mode'];
  twitch: number;
  twitchSide: number;
  leafL: Spring;
  leafR: Spring;
  leafFlick: Spring;
  antenna: Spring;
}

/** Cute hovering drones. Interpolates the sim's grid position and adds bobbing — presentation only. */
export class DroneVisuals {
  private views = new Map<string, DroneView>();
  private time = 0;
  reducedMotion = false;
  onTrail?: (p: pc.Vec3) => void;
  /** D05 effect hooks (wired to Vfx by the game): a mote travelling down a beam, a sparkle where it lands. */
  onBeamMote?: (from: pc.Vec3, to: pc.Vec3, hex: string) => void;
  onBeamSparkle?: (at: pc.Vec3, hex: string) => void;
  /** Dev preview (D03): show this expression on every drone, e.g. `solarbloom.drones.previewFace = 'excited'`. */
  previewFace?: FaceName;
  private trailT = 0;
  private model?: pc.ContainerResource;
  private faceBase?: pc.StandardMaterial;
  private faceMats = new Map<string, pc.StandardMaterial>();
  private frenzy = false;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private tweens: Tweens,
    app?: pc.AppBase,
  ) {
    // The classic drone shows until the model has loaded (and stays if it fails to load).
    if (app && useModel()) {
      app.assets.loadFromUrl(MODEL_URL, 'container', (err, asset) => {
        if (err || !asset) {
          console.warn('Drone model failed to load; keeping the classic drone.', err);
          return;
        }
        this.model = asset.resource as pc.ContainerResource;
        this.restyle();
      });
    }
    // Celebrations, driven by game events (D03/D04). Priority is resolved per frame; a drone's own success
    // hop comes from its job finishing (working -> cooldown), in update().
    const bus = sim.bus;
    const milestones = new Set<number>(TUNING.chain.milestones.map((m) => m.effects).filter((n) => n >= 10));
    bus.on('chain.event', (e) => {
      if (milestones.has(e.combo)) this.cheerAll();
    });
    bus.on('milestone.reached', () => this.cheerAll());
    bus.on('frenzy.started', () => {
      this.frenzy = true;
      this.cheerAll();
    });
    bus.on('frenzy.ended', () => (this.frenzy = false));
    bus.on('cat.found', () => this.cheerAll(true));
  }

  /** Every drone shows excited eyes for a moment (and wiggles, for a Lucky Cat). */
  private cheerAll(wiggle = false) {
    for (const v of this.views.values()) {
      v.celebrate = CELEBRATE_S;
      if (wiggle) v.wiggle = WIGGLE_S;
    }
  }

  private world(d: DroneData): [number, number] {
    const w = this.sim.drones.worldOf(d);
    return [w[0], w[2]];
  }

  add(d: DroneData, animate: boolean) {
    const [x, z] = this.world(d);
    const root = group(this.parent, `drone-${d.id}`, [x, 0.9, z]);
    const body = group(root, 'body');
    // A tapered beam: a translucent cone with a brighter, thinner stream inside. It lives in world space so it
    // can stay anchored to both the emitter and the tile while the drone bobs and leans.
    const beam = group(this.parent, `beam-${d.id}`);
    shape(beam, 'cone', mat(PALETTE.eyeCyan, { opacity: 0.2, emissive: PALETTE.eyeCyan, emissiveIntensity: 1.1, doubleSided: true }), { pos: [0, 0, 0] });
    const beamCore = shape(beam, 'cone', mat('#d8fdff', { opacity: 0.32, emissive: PALETTE.eyeCyan, emissiveIntensity: 2.2, doubleSided: true }), { scale: [0.38, 1, 0.38] });
    beam.enabled = false;
    const v: DroneView = {
      root,
      body,
      beam,
      beamCore,
      moteT: 0,
      sparkT: 0,
      yaw: 0,
      x,
      z,
      y: 0.9,
      phase: Math.random() * 6,
      blink: 1 + Math.random() * 3,
      vel: 0,
      tilt: 0,
      celebrate: 0,
      bounce: 0,
      wiggle: 0,
      lastMode: d.mode,
      twitch: 2 + Math.random() * 5,
      twitchSide: 1,
      leafL: { a: 0, v: 0 },
      leafR: { a: 0, v: 0 },
      leafFlick: { a: 0, v: 0 },
      antenna: { a: 0, v: 0 },
    };
    if (this.model) v.model = this.buildModel(d, body);
    else v.classic = this.buildClassic(d, body);
    if (d.old) body.setLocalScale(0.8, 0.8, 0.8);
    this.views.set(d.id, v);
    if (animate) {
      root.setLocalScale(0.01, 0.01, 0.01);
      this.tweens.add(0.6, (k) => root.setLocalScale(k, k, k), { ease: ease.outBack, delay: 0.3 });
    }
  }

  /** Drone Dash trim level of this drone's hub (Phase 5 E12: per hub). */
  private dash(d: DroneData) {
    return this.sim.upgrades.levelOf(this.sim.machine(d.hubId), 'droneSpeed');
  }

  /** The redesigned drone: the Blender model with the shared palette materials swapped in. */
  private buildModel(d: DroneData, body: pc.Entity): ModelParts {
    const old = !!d.old;
    const party = d.expiresAt !== undefined;
    const dash = this.dash(d);
    const wrap = group(body, 'model', [0, MODEL_LIFT, 0]);
    wrap.setLocalEulerAngles(0, -90, 0); // model faces +X; drones face +Z
    wrap.setLocalScale(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
    const model = this.model!.instantiateRenderEntity();
    wrap.addChild(model);
    let face: ModelParts['face'];
    const walk = (e: pc.Entity) => {
      if (e.render) {
        e.render.castShadows = e.name === 'drone_body';
        e.render.receiveShadows = true;
        for (const mi of e.render.meshInstances) {
          const name = mi.material?.name ?? '';
          if (name === 'visor_eyes') {
            this.faceBase ??= mi.material as pc.StandardMaterial;
            const glow = old ? 0 : 1;
            mi.material = this.faceMat(FACE.idle, glow);
            face = { mi, frame: FACE.idle, glow, old };
          } else {
            const m = this.palMat(name, old, party);
            if (m) mi.material = m;
          }
        }
      }
      for (const c of e.children) walk(c as pc.Entity);
    };
    walk(model);
    const find = (n: string) => (model.findByName(n) as pc.Entity | null) ?? undefined;
    const leafL = find('leaf_L') ?? group(wrap, 'leaf_L');
    const leafR = find('leaf_R') ?? group(wrap, 'leaf_R');
    const antenna = find('antenna');
    const thrusters = ['thruster_C', 'thruster_L', 'thruster_R'].map(find).filter((e): e is pc.Entity => !!e);
    if (old) {
      // Phase 4 E09: the old drone looks its age (worn shell, a rust patch, dim eyes, a bent antenna).
      shape(body, 'sphere', mat(PALETTE.rust), { pos: [0.13, 0.07, 0.08], scale: [0.1, 0.07, 0.06] });
    }
    if (!old && dash >= 2) {
      // Drone Dash: a glowing ring along the belt, cyan at level 2, gold at level 3.
      shape(body, 'cylinder', mat(dash >= 3 ? '#ffe27a' : '#a8ecff', { emissive: dash >= 3 ? '#ffd34d' : '#6fd3ff', emissiveIntensity: 0.6 }), {
        pos: [0, -0.024, 0],
        scale: [0.41, 0.014, 0.41],
      });
    }
    return { leafL, leafR, antenna, thrusters, face };
  }

  /** Shared palette material for a model material slot (pal_<key>); undefined keeps the model's own. */
  private palMat(name: string, old: boolean, party: boolean): pc.Material | undefined {
    switch (name) {
      case 'pal_shell':
        return mat(old ? '#d9cbb0' : PALETTE.shell, { gloss: old ? 0.3 : 0.7 });
      case 'pal_shellLow':
        return mat(old ? '#9a8a70' : PALETTE.shellLow, { gloss: 0.65, metal: 0.15 });
      case 'pal_gold':
        return mat(old ? '#a88f5a' : PALETTE.gold, { gloss: old ? 0.45 : 0.72, metal: 0.55 });
      case 'pal_darkFace':
        return mat(PALETTE.darkFace, { gloss: 0.82 });
      case 'pal_leafFin':
        return mat(party ? PALETTE.pink : old ? '#b5a27e' : PALETTE.leafFin, { gloss: 0.5 });
      case 'pal_leafVein':
        return mat(old ? '#7d6e50' : PALETTE.leafVein, { gloss: 0.45 });
      case 'pal_eyeCyan':
        return mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: old ? 0.8 : 1.6, gloss: 0.75 });
    }
    return undefined;
  }

  /** The screen material showing one eye-sheet frame at one glow level. Shared by every drone showing it. */
  private faceMat(frame: number, glow: number): pc.StandardMaterial {
    const key = `${frame}:${glow}`;
    let m = this.faceMats.get(key);
    if (m) return m;
    m = this.faceBase!.clone() as pc.StandardMaterial;
    m.diffuse = color(PALETTE.darkFace);
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = 0.85;
    m.emissive = new pc.Color(1, 1, 1);
    m.emissiveIntensity = glowGain(GLOW[glow]); // Look 1.9: the same bloom gain as mat() glows (dim stays below 1)
    m.emissiveMapTiling = new pc.Vec2(1, 1);
    m.emissiveMapOffset = new pc.Vec2(frame / SHEET_FRAMES, 0);
    m.update();
    this.faceMats.set(key, m);
    return m;
  }

  /** The original primitive drone (fallback while the model loads, and `?drone=classic`). */
  private buildClassic(d: DroneData, body: pc.Entity): NonNullable<DroneView['classic']> {
    const party = d.expiresAt !== undefined;
    // Phase 4 E09: the old drone looks its age (worn cream shell, a rust patch, amber eyes, a bent antenna);
    // hub drones' trim shows Drone Dash: cyan at level 2, gold at level 3.
    const old = !!d.old;
    const dash = this.dash(d);
    const eyeCol = old ? '#ffb347' : PALETTE.eyeCyan;
    shape(body, 'sphere', mat(old ? '#d9cbb0' : PALETTE.white, { gloss: old ? 0.2 : 0.7 }), { scale: [0.36, 0.3, 0.36], shadow: true });
    shape(body, 'cylinder', mat(old ? '#9a8a70' : dash >= 3 ? '#ffd34d' : dash >= 2 ? '#6fd3ff' : PALETTE.shell), { pos: [0, -0.1, 0], scale: [0.26, 0.06, 0.26] });
    if (old) {
      shape(body, 'sphere', mat(PALETTE.rust), { pos: [0.12, 0.06, 0.1], scale: [0.1, 0.07, 0.06] });
      shape(body, 'box', mat('#8a7a60'), { pos: [-0.1, 0.12, 0.06], scale: [0.08, 0.02, 0.06], rot: [0, 20, 0] });
    }
    if (!old && dash >= 2) shape(body, 'cylinder', mat(dash >= 3 ? '#ffe27a' : '#a8ecff', { emissive: dash >= 3 ? '#ffd34d' : '#6fd3ff', emissiveIntensity: 0.6 }), { pos: [0, 0.02, 0], scale: [0.37, 0.025, 0.37] });
    shape(body, 'box', mat(PALETTE.darkFace, { gloss: 0.8 }), { pos: [0, 0.02, 0.15], scale: [0.22, 0.14, 0.06] });
    const eyes = [-0.05, 0.05].map((ex) =>
      shape(body, 'sphere', mat(eyeCol, { emissive: eyeCol, emissiveIntensity: 2 }), { pos: [ex, 0.03, 0.185], scale: [0.04, 0.05, 0.02] }),
    );
    const finCol = party ? PALETTE.pink : old ? '#b5a27e' : PALETTE.leafFin;
    const finL = group(body, 'finL', [-0.17, 0.04, -0.02]);
    shape(finL, 'sphere', mat(finCol), { pos: [-0.1, 0, 0], scale: [0.22, 0.03, 0.12] });
    const finR = group(body, 'finR', [0.17, 0.04, -0.02]);
    shape(finR, 'sphere', mat(finCol), { pos: [0.1, 0, 0], scale: [0.22, 0.03, 0.12] });
    shape(body, 'sphere', mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.5 }), { pos: [0, -0.15, 0], scale: 0.06 });
    shape(body, 'cylinder', mat(PALETTE.white), { pos: [0, 0.18, -0.04], scale: [0.015, 0.1, 0.015], rot: old ? [0, 0, 28] : [0, 0, 0] });
    shape(body, 'sphere', mat(PALETTE.leafFin), { pos: [0, 0.24, -0.04], scale: [0.08, 0.03, 0.05] });
    return { finL, finR, eyes };
  }

  /** Rebuilds every drone's look (after Drone Dash changes their trim, or when the model arrives). */
  restyle() {
    for (const [id, v] of [...this.views]) {
      v.root.destroy();
      v.beam.destroy();
      this.views.delete(id);
    }
    for (const d of this.sim.state.drones) this.add(d, false);
  }

  remove(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    v.beam.destroy(); // a cancelled job's beam goes at once
    this.tweens.add(0.3, (k) => v.root.setLocalScale(1 - k, 1 - k, 1 - k), { done: () => v.root.destroy() });
  }

  worldPos(id: string): pc.Vec3 | undefined {
    return this.views.get(id)?.root.getPosition();
  }

  sync() {
    for (const d of this.sim.state.drones) if (!this.views.has(d.id)) this.add(d, false);
  }

  /**
   * Which face a drone shows (D03). Priority: celebration > restoring > working > travelling > idle/sleeping,
   * with short blinks over the open faces. Celebrations time out, so the face always returns to its state.
   */
  private expression(d: DroneData, v: DroneView, napping: boolean, blinking: boolean): { frame: number; glow: number } {
    const old = !!v.model?.face?.old;
    const normal = old ? 0 : 1;
    if (this.previewFace) return { frame: FACE[this.previewFace], glow: this.previewFace === 'restoring' ? 2 : normal };
    let name: FaceName;
    if (v.celebrate > 0) name = 'excited';
    else if (d.mode === 'working') name = 'restoring';
    else if (d.mode === 'cooldown') name = Math.floor(this.time * 4 + v.phase) % 2 ? 'workingA' : 'workingB';
    else if (d.mode === 'flying') name = 'focused';
    else if (napping) name = 'sleeping';
    else name = 'idle';
    if (blinking && name !== 'sleeping' && name !== 'excited') name = 'blink';
    const glow = name === 'restoring' && !old ? 2 : name === 'sleeping' ? 0 : normal;
    return { frame: FACE[name], glow };
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    this.trailT -= dt;
    const emitTrail = this.trailT <= 0 && !this.reducedMotion;
    if (emitTrail) this.trailT = 0.07;
    const motion = this.reducedMotion ? 0 : 1;
    for (const d of this.sim.state.drones) {
      const v = this.views.get(d.id);
      if (!v) continue;
      const hub = this.sim.machine(d.hubId);
      if (!hub) continue;
      const w = this.sim.drones.worldOf(d);
      let [tx, tz] = [w[0], w[2]];
      if (v.lastMode === 'working' && d.mode === 'cooldown') v.bounce = BOUNCE_S; // a job done: a joyful hop
      v.lastMode = d.mode;
      const idle = d.mode === 'idle' || d.mode === 'returning';
      const napping = d.mode === 'idle' && this.sim.drones.statusOf(d) === 'napping';
      if (idle && motion) {
        // Lazy figure-eight while napping
        tx += Math.sin(t * 0.6 + v.phase) * 0.35;
        tz += Math.sin(t * 1.2 + v.phase) * 0.18;
      }
      const k = 1 - Math.exp(-dt * 10);
      const dx = tx - v.x;
      const dz = tz - v.z;
      v.x += dx * k;
      v.z += dz * k;
      const baseY = w[1] + (d.mode === 'working' ? 0.55 : idle ? 1.05 : 0.9);
      v.y += (baseY - v.y) * (1 - Math.exp(-dt * 5));
      // Hover bob: softer and slower asleep, livelier in a Frenzy; a short hop on a finished restore.
      const bobAmp = BOB.amp * (napping ? 0.45 : 1) * motion;
      const bobRate = ((2 * Math.PI) / BOB.period) * (napping ? 0.7 : this.frenzy ? 1.4 : 1);
      const hop = v.bounce > 0 ? Math.sin(Math.PI * (1 - v.bounce / BOUNCE_S)) * 0.09 * motion : 0;
      const bob = Math.sin(t * bobRate + v.phase) * bobAmp + hop;
      v.root.setPosition(v.x, v.y + bob, v.z);
      const moved = Math.hypot(dx * k, dz * k);
      const vel = dt > 0 ? moved / dt : 0;
      const accel = dt > 0 ? (vel - v.vel) / dt : 0;
      v.vel = vel;
      if (Math.hypot(dx, dz) > 0.01) {
        const target = (Math.atan2(dx, dz) * 180) / Math.PI;
        let diff = target - v.yaw;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        v.yaw += diff * Math.min(1, dt * 6);
      } else if (idle && motion) v.yaw += Math.sin(t * 0.5 + v.phase) * dt * 20;
      // Lean into travel (8–15° by speed), a small lean over a job, and a quick wiggle for a Lucky Cat.
      const tiltGoal = (d.mode === 'working' ? 6 : Math.min(13, vel * 7)) * motion;
      v.tilt += (tiltGoal - v.tilt) * (1 - Math.exp(-dt * 6));
      const wig = v.wiggle > 0 ? Math.sin(t * 34) * 12 * (v.wiggle / WIGGLE_S) * motion : 0;
      v.body.setLocalEulerAngles(v.tilt, wig, 0);
      v.root.setEulerAngles(0, v.yaw, 0);
      // Squash and stretch on the hop.
      const sq = hop > 0 ? Math.sin(Math.PI * (1 - v.bounce / BOUNCE_S)) * 0.1 : 0;
      const base = d.old ? 0.8 : 1;
      v.body.setLocalScale(base * (1 - sq * 0.5), base * (1 + sq), base * (1 - sq * 0.5));
      v.celebrate = Math.max(0, v.celebrate - dt);
      v.bounce = Math.max(0, v.bounce - dt);
      v.wiggle = Math.max(0, v.wiggle - dt);
      v.blink -= dt;
      const blinking = v.blink < 0.12;
      if (v.blink < 0) v.blink = 2.5 + Math.random() * 3.5; // occasional, never rapid

      if (v.model) this.animateModel(d, v, v.model, dt, t, vel, accel, napping, blinking, motion);
      else if (v.classic) {
        const flap = motion * Math.sin(t * (d.mode === 'flying' ? 30 : 10) + v.phase) * 18;
        v.classic.finL.setLocalEulerAngles(0, 0, flap);
        v.classic.finR.setLocalEulerAngles(0, 0, -flap);
        for (const e of v.classic.eyes) e.setLocalScale(0.04, blinking ? 0.008 : napping ? 0.02 : 0.05, 0.02);
      }
      if (emitTrail && d.mode === 'flying' && vel > 0.3) this.onTrail?.(new pc.Vec3(v.x, v.y + bob - 0.12, v.z));
      this.updateBeam(d, v, w, dt, t);
    }
  }

  /**
   * D05: the restoration beam. A short tapered cyan cone from the emitter to the tile, anchored to both,
   * with motes streaming down it and soft sparkles where it lands; gold in a Frenzy or a celebration.
   * Visual only: the job, its timing and its reward are the sim's.
   */
  private updateBeam(d: DroneData, v: DroneView, w: number[], dt: number, t: number) {
    const on = d.mode === 'working';
    v.beam.enabled = on;
    if (!on) {
      v.moteT = v.sparkT = 0;
      return;
    }
    const from = new pc.Vec3();
    v.root.getWorldTransform().transformPoint(EMITTER, from);
    const to = new pc.Vec3(w[0], w[1] + 0.04, w[2]);
    const dir = new pc.Vec3().sub2(from, to);
    const len = dir.length();
    if (len < 0.05) return;
    dir.mulScalar(1 / len);
    // Cone primitive: height 1 along +Y, apex at the top; point the apex at the emitter.
    const q = new pc.Quat();
    const axis = new pc.Vec3().cross(UP, dir);
    const ang = Math.acos(Math.max(-1, Math.min(1, UP.dot(dir))));
    if (axis.length() > 1e-6) q.setFromAxisAngle(axis.normalize(), (ang * 180) / Math.PI);
    const shimmer = this.reducedMotion ? 1 : 1 + Math.sin(t * 18 + v.phase) * 0.06;
    v.beam.setPosition((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    v.beam.setRotation(q);
    v.beam.setLocalScale(BEAM_RADIUS * 2 * shimmer, len, BEAM_RADIUS * 2 * shimmer);
    v.beamCore.setLocalEulerAngles(0, (t * 120) % 360, 0);
    const hex = this.frenzy || v.celebrate > 0 ? PALETTE.gold : PALETTE.eyeCyan;
    v.moteT -= dt;
    if (v.moteT <= 0) {
      v.moteT = MOTE_EVERY;
      this.onBeamMote?.(from, to, hex);
    }
    v.sparkT -= dt;
    if (v.sparkT <= 0) {
      v.sparkT = SPARKLE_EVERY * (this.frenzy ? 0.6 : 1);
      this.onBeamSparkle?.(to, hex);
    }
  }

  /** Face, leaf ears, antenna and thrusters of the model drone (D03/D04). */
  private animateModel(d: DroneData, v: DroneView, m: ModelParts, dt: number, t: number, vel: number, accel: number, napping: boolean, blinking: boolean, motion: number) {
    // Face
    if (m.face) {
      const { frame, glow } = this.expression(d, v, napping, blinking);
      if (frame !== m.face.frame || glow !== m.face.glow) {
        m.face.frame = frame;
        m.face.glow = glow;
        m.face.mi.material = this.faceMat(frame, glow);
      }
    }
    // Leaf ears: swept back by speed (they trail behind on springs), an occasional twitch, a flutter in a
    // Frenzy, and a perk-up when celebrating. Angles are degrees round the model's Z (back) and X (flick).
    v.twitch -= dt;
    if (v.twitch < 0) {
      v.twitch = 2.5 + Math.random() * 5;
      v.twitchSide = Math.random() < 0.5 ? -1 : 1;
      v.leafFlick.v += 260 * v.twitchSide * motion;
    }
    const sweep = Math.min(35, vel * 16) * motion;
    const perk = (v.celebrate > 0 ? -14 : 0) * motion;
    const flutter = (this.frenzy || v.celebrate > 0 ? Math.sin(t * 16 + v.phase) * 7 : 0) * motion;
    const droop = napping ? 10 : 0;
    spring(v.leafL, sweep + perk + flutter, dt);
    spring(v.leafR, sweep + perk - flutter, dt);
    spring(v.leafFlick, 0, dt, 90, 9);
    m.leafL.setLocalEulerAngles(-droop + v.leafFlick.a * (v.twitchSide > 0 ? 1 : 0.3), 0, v.leafL.a);
    m.leafR.setLocalEulerAngles(droop + v.leafFlick.a * (v.twitchSide < 0 ? 1 : 0.3), 0, v.leafR.a);
    // Antenna: wobbles back when the drone speeds up, forward when it brakes, springs on a hop.
    spring(v.antenna, Math.max(-25, Math.min(25, -accel * 3)) * motion + (v.bounce > 0 ? 10 : 0) * motion, dt, 80, 6);
    if (m.antenna) m.antenna.setLocalEulerAngles(d.old ? 28 : 0, 0, v.antenna.a);
    // Thrusters: pulse while working, rest calmly otherwise, low asleep.
    const pulse = d.mode === 'working' ? 1.12 + Math.sin(t * 14 + v.phase) * 0.12 * motion : napping ? 0.85 : 1;
    for (const th of m.thrusters) th.setLocalScale(pulse, pulse, pulse);
  }
}
