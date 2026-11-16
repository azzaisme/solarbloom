import * as pc from 'playcanvas';
import type { DroneData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { color, mat, PALETTE } from './Materials';
import { group, shape } from './Shapes';
import { ease, type Tweens } from './Tween';

/**
 * The redesigned drone (docs/art/SOLARBLOOM_DRONE_REDESIGN.md, D01/D02), built in Blender by
 * assets/tools/drone_build.py. Blender space is face +X, up +Z; glTF keeps +X forward with +Y up.
 * Every object's origin is its animation pivot: drone_body, visor_eyes, antenna, leaf_L, leaf_R,
 * thruster_C, thruster_L, thruster_R.
 */
const MODEL_URL = new URL('../../assets/raw/drone/drone-base.glb', import.meta.url).href;
/** Model units -> world units. The body is about 0.39 wide, a touch bigger than the classic drone. */
const MODEL_SCALE = 0.58;
/** The model's origin sits 0.05 model units above the body's centre; lift it back so the body is centred. */
const MODEL_LIFT = 0.05 * MODEL_SCALE;
/** Eye sprite sheet frames (the screen's UVs cover frame 0; a frame is a quarter of the sheet). */
const FACE = { happy: 0, open: 1, blink: 2, sleepy: 3 } as const;

/** `?drone=classic` shows the original primitive drone, for comparison while the redesign is reviewed. */
const useModel = () => typeof location === 'undefined' || new URLSearchParams(location.search).get('drone') !== 'classic';

interface DroneView {
  root: pc.Entity;
  body: pc.Entity;
  finL: pc.Entity;
  finR: pc.Entity;
  beam: pc.Entity;
  /** Classic drone: the two eye spheres (blinks by squashing them). */
  eyes: pc.Entity[];
  /** Model drone: the screen, which blinks by switching eye-sheet frames. */
  face?: { mi: pc.MeshInstance; frame: number; dim: boolean };
  yaw: number;
  x: number;
  z: number;
  y: number;
  phase: number;
  blink: number;
}

/** Cute hovering drones. Interpolates the sim's grid position and adds bobbing — presentation only. */
export class DroneVisuals {
  private views = new Map<string, DroneView>();
  private time = 0;
  reducedMotion = false;
  onTrail?: (p: pc.Vec3) => void;
  private trailT = 0;
  private model?: pc.ContainerResource;
  private faceBase?: pc.StandardMaterial;
  private faceMats = new Map<string, pc.StandardMaterial>();

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
  }

  private world(d: DroneData): [number, number] {
    const w = this.sim.drones.worldOf(d);
    return [w[0], w[2]];
  }

  add(d: DroneData, animate: boolean) {
    const [x, z] = this.world(d);
    const root = group(this.parent, `drone-${d.id}`, [x, 0.9, z]);
    const body = group(root, 'body');
    const parts = this.model ? this.buildModel(d, body) : this.buildClassic(d, body);
    const beam = shape(root, 'cylinder', mat(PALETTE.eyeCyan, { opacity: 0.35, emissive: PALETTE.eyeCyan, emissiveIntensity: 1 }), { pos: [0, -0.4, 0], scale: [0.25, 0.7, 0.25] });
    beam.enabled = false;
    if (d.old) body.setLocalScale(0.8, 0.8, 0.8);
    const v: DroneView = { root, body, beam, ...parts, yaw: 0, x, z, y: 0.9, phase: Math.random() * 6, blink: 2 };
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
  private buildModel(d: DroneData, body: pc.Entity): Pick<DroneView, 'finL' | 'finR' | 'eyes' | 'face'> {
    const old = !!d.old;
    const party = d.expiresAt !== undefined;
    const dash = this.dash(d);
    const wrap = group(body, 'model', [0, MODEL_LIFT, 0]);
    wrap.setLocalEulerAngles(0, -90, 0); // model faces +X; drones face +Z
    wrap.setLocalScale(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
    const model = this.model!.instantiateRenderEntity();
    wrap.addChild(model);
    let face: DroneView['face'];
    const eyeDim = old;
    const walk = (e: pc.Entity) => {
      if (e.render) {
        e.render.castShadows = e.name === 'drone_body';
        e.render.receiveShadows = true;
        for (const mi of e.render.meshInstances) {
          const name = mi.material?.name ?? '';
          if (name === 'visor_eyes') {
            this.faceBase ??= mi.material as pc.StandardMaterial;
            mi.material = this.faceMat(FACE.happy, eyeDim);
            face = { mi, frame: FACE.happy, dim: eyeDim };
          } else {
            const m = this.palMat(name, old, party);
            if (m) mi.material = m;
          }
        }
      }
      for (const c of e.children) walk(c as pc.Entity);
    };
    walk(model);
    const finL = (model.findByName('leaf_L') as pc.Entity | null) ?? group(wrap, 'finL');
    const finR = (model.findByName('leaf_R') as pc.Entity | null) ?? group(wrap, 'finR');
    if (old) {
      // Phase 4 E09: the old drone looks its age (worn shell, a rust patch, dim eyes, a bent antenna).
      shape(body, 'sphere', mat(PALETTE.rust), { pos: [0.13, 0.07, 0.08], scale: [0.1, 0.07, 0.06] });
      (model.findByName('antenna') as pc.Entity | null)?.setLocalEulerAngles(28, 0, 0);
    }
    if (!old && dash >= 2) {
      // Drone Dash: a glowing ring along the belt, cyan at level 2, gold at level 3.
      shape(body, 'cylinder', mat(dash >= 3 ? '#ffe27a' : '#a8ecff', { emissive: dash >= 3 ? '#ffd34d' : '#6fd3ff', emissiveIntensity: 0.6 }), {
        pos: [0, -0.024, 0],
        scale: [0.41, 0.014, 0.41],
      });
    }
    return { finL, finR, eyes: [], face };
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

  /** The screen material showing one eye-sheet frame. Shared by every drone showing that frame. */
  private faceMat(frame: number, dim: boolean): pc.StandardMaterial {
    const key = `${frame}:${dim}`;
    let m = this.faceMats.get(key);
    if (m) return m;
    m = this.faceBase!.clone() as pc.StandardMaterial;
    m.diffuse = color(PALETTE.darkFace);
    m.useMetalness = true;
    m.metalness = 0;
    m.gloss = 0.85;
    m.emissive = new pc.Color(1, 1, 1);
    m.emissiveIntensity = dim ? 0.6 : 1.3;
    m.emissiveMapTiling = new pc.Vec2(1, 1);
    m.emissiveMapOffset = new pc.Vec2(frame * 0.25, 0);
    m.update();
    this.faceMats.set(key, m);
    return m;
  }

  /** The original primitive drone (fallback while the model loads, and `?drone=classic`). */
  private buildClassic(d: DroneData, body: pc.Entity): Pick<DroneView, 'finL' | 'finR' | 'eyes'> {
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
      this.views.delete(id);
    }
    for (const d of this.sim.state.drones) this.add(d, false);
  }

  remove(id: string) {
    const v = this.views.get(id);
    if (!v) return;
    this.views.delete(id);
    this.tweens.add(0.3, (k) => v.root.setLocalScale(1 - k, 1 - k, 1 - k), { done: () => v.root.destroy() });
  }

  worldPos(id: string): pc.Vec3 | undefined {
    return this.views.get(id)?.root.getPosition();
  }

  sync() {
    for (const d of this.sim.state.drones) if (!this.views.has(d.id)) this.add(d, false);
  }

  update(dt: number) {
    this.time += dt;
    const t = this.time;
    this.trailT -= dt;
    const emitTrail = this.trailT <= 0 && !this.reducedMotion;
    if (emitTrail) this.trailT = 0.07;
    for (const d of this.sim.state.drones) {
      const v = this.views.get(d.id);
      if (!v) continue;
      const hub = this.sim.machine(d.hubId);
      if (!hub) continue;
      const w = this.sim.drones.worldOf(d);
      let [tx, tz] = [w[0], w[2]];
      const idle = d.mode === 'idle' || d.mode === 'returning';
      if (idle && !this.reducedMotion) {
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
      const bob = this.reducedMotion ? 0 : Math.sin(t * 3 + v.phase) * 0.05;
      v.root.setPosition(v.x, v.y + bob, v.z);
      const speed = Math.hypot(dx, dz);
      if (speed > 0.01) {
        const target = (Math.atan2(dx, dz) * 180) / Math.PI;
        let diff = target - v.yaw;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;
        v.yaw += diff * Math.min(1, dt * 6);
      } else if (idle && !this.reducedMotion) v.yaw += Math.sin(t * 0.5 + v.phase) * dt * 20;
      const tilt = Math.min(20, speed * 60);
      v.body.setLocalEulerAngles(tilt, 0, 0);
      v.root.setEulerAngles(0, v.yaw, 0);
      const flap = this.reducedMotion ? 0 : Math.sin(t * (d.mode === 'flying' ? 30 : 10) + v.phase) * 18;
      if (v.face) {
        // Model leaves hinge on their sockets round the drone's forward axis (model X); a gentler flap.
        v.finL.setLocalEulerAngles(flap * 0.6, 0, 0);
        v.finR.setLocalEulerAngles(-flap * 0.6, 0, 0);
      } else {
        v.finL.setLocalEulerAngles(0, 0, flap);
        v.finR.setLocalEulerAngles(0, 0, -flap);
      }
      if (emitTrail && d.mode === 'flying' && speed > 0.01) this.onTrail?.(new pc.Vec3(v.x, v.y + bob - 0.12, v.z));
      v.beam.enabled = d.mode === 'working';
      if (v.beam.enabled) {
        const p = 0.22 + Math.sin(t * 20) * 0.04;
        v.beam.setLocalScale(p, 0.55, p);
        v.beam.setLocalPosition(0, -0.32, 0);
      }
      v.blink -= dt;
      const closed = v.blink < 0.12;
      if (v.blink < 0) v.blink = 2 + Math.random() * 3;
      const napping = d.mode === 'idle' && this.sim.drones.statusOf(d) === 'napping';
      if (v.face) {
        const frame = closed ? FACE.blink : napping ? FACE.sleepy : FACE.happy;
        if (frame !== v.face.frame) {
          v.face.frame = frame;
          v.face.mi.material = this.faceMat(frame, v.face.dim);
        }
      } else for (const e of v.eyes) e.setLocalScale(0.04, closed ? 0.008 : napping ? 0.02 : 0.05, 0.02);
    }
  }
}
