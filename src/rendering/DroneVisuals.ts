import * as pc from 'playcanvas';
import type { DroneData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { mat, PALETTE } from './Materials';
import { group, shape } from './Shapes';
import { ease, type Tweens } from './Tween';

interface DroneView {
  root: pc.Entity;
  body: pc.Entity;
  finL: pc.Entity;
  finR: pc.Entity;
  beam: pc.Entity;
  eyes: pc.Entity[];
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

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private tweens: Tweens,
  ) {}

  private world(d: DroneData): [number, number] {
    const hub = this.sim.machine(d.hubId)!;
    const r = this.sim.grid.roof(hub.roofId)!;
    return [r.origin[0] + d.px, r.origin[2] + d.pz];
  }

  add(d: DroneData, animate: boolean) {
    const [x, z] = this.world(d);
    const party = d.expiresAt !== undefined;
    const root = group(this.parent, `drone-${d.id}`, [x, 0.9, z]);
    const body = group(root, 'body');
    shape(body, 'sphere', mat(PALETTE.white, { gloss: 0.7 }), { scale: [0.36, 0.3, 0.36], shadow: true });
    shape(body, 'cylinder', mat(PALETTE.shell), { pos: [0, -0.1, 0], scale: [0.26, 0.06, 0.26] });
    const face = shape(body, 'box', mat(PALETTE.darkFace, { gloss: 0.8 }), { pos: [0, 0.02, 0.15], scale: [0.22, 0.14, 0.06] });
    void face;
    const eyes = [-0.05, 0.05].map((ex) =>
      shape(body, 'sphere', mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 2 }), { pos: [ex, 0.03, 0.185], scale: [0.04, 0.05, 0.02] }),
    );
    const finCol = party ? PALETTE.pink : PALETTE.leafFin;
    const finL = group(body, 'finL', [-0.17, 0.04, -0.02]);
    shape(finL, 'sphere', mat(finCol), { pos: [-0.1, 0, 0], scale: [0.22, 0.03, 0.12] });
    const finR = group(body, 'finR', [0.17, 0.04, -0.02]);
    shape(finR, 'sphere', mat(finCol), { pos: [0.1, 0, 0], scale: [0.22, 0.03, 0.12] });
    shape(body, 'sphere', mat(PALETTE.eyeCyan, { emissive: PALETTE.eyeCyan, emissiveIntensity: 1.5 }), { pos: [0, -0.15, 0], scale: 0.06 });
    shape(body, 'cylinder', mat(PALETTE.white), { pos: [0, 0.18, -0.04], scale: [0.015, 0.1, 0.015] });
    shape(body, 'sphere', mat(PALETTE.leafFin), { pos: [0, 0.24, -0.04], scale: [0.08, 0.03, 0.05] });
    const beam = shape(root, 'cylinder', mat(PALETTE.eyeCyan, { opacity: 0.35, emissive: PALETTE.eyeCyan, emissiveIntensity: 1 }), { pos: [0, -0.4, 0], scale: [0.25, 0.7, 0.25] });
    beam.enabled = false;
    const v: DroneView = { root, body, finL, finR, beam, eyes, yaw: 0, x, z, y: 0.9, phase: Math.random() * 6, blink: 2 };
    this.views.set(d.id, v);
    if (animate) {
      root.setLocalScale(0.01, 0.01, 0.01);
      this.tweens.add(0.6, (k) => root.setLocalScale(k, k, k), { ease: ease.outBack, delay: 0.3 });
    }
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
      const r = this.sim.grid.roof(hub.roofId)!;
      let [tx, tz] = this.world(d);
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
      const baseY = r.origin[1] + r.height + (d.mode === 'working' ? 0.55 : idle ? 1.05 : 0.9);
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
      v.finL.setLocalEulerAngles(0, 0, flap);
      v.finR.setLocalEulerAngles(0, 0, -flap);
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
      for (const e of v.eyes) e.setLocalScale(0.04, closed ? 0.008 : d.mode === 'idle' && this.sim.drones.statusOf(d) === 'napping' ? 0.02 : 0.05, 0.02);
    }
  }
}
