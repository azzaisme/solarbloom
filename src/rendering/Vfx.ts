import * as pc from 'playcanvas';
import { PALETTE, uniqueMat } from './Materials';
import { shape } from './Shapes';

interface Particle {
  x: number;
  y: number;
  z: number;
  rot: number;
  color: [number, number, number];
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  spin: number;
  gravity: number;
  active: boolean;
}

interface Ring {
  e: pc.Entity;
  m: pc.StandardMaterial;
  life: number;
  max: number;
  r0: number;
  r1: number;
  active: boolean;
}

interface Arc {
  e: pc.Entity;
  m: pc.StandardMaterial;
  life: number;
  max: number;
  active: boolean;
}

// Octahedron: 6 vertices, 8 faces. Every particle is one of these inside a single shared mesh.
const OCT = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const OCT_IDX = [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5];
const MAX_PARTICLES = 240;

/** Pooled effects: expanding rings, leaf/confetti bursts (one draw call for all of them), chain arcs. */
export class Vfx {
  private particles: Particle[] = [];
  private pMesh: pc.Mesh;
  private pPos: Float32Array;
  private pNrm: Float32Array;
  private pCol: Uint8Array;
  private anyActive = false;
  private rings: Ring[] = [];
  private arcs: Arc[] = [];
  private root: pc.Entity;
  density = 1;

  constructor(parent: pc.Entity, device: pc.GraphicsDevice) {
    this.root = new pc.Entity('vfx');
    parent.addChild(this.root);
    const colors = [...PALETTE.grassTuft, ...PALETTE.flower, PALETTE.gold].map((h) => {
      const c = new pc.Color();
      c.fromString(h);
      return [c.r, c.g, c.b].map((v) => Math.round(Math.pow(v, 2.2) * 255)) as [number, number, number];
    });
    for (let i = 0; i < MAX_PARTICLES; i++)
      this.particles.push({ x: 0, y: 0, z: 0, rot: 0, color: colors[i % colors.length], vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.05, spin: 0, gravity: 4, active: false });
    const n = MAX_PARTICLES * 6;
    this.pPos = new Float32Array(n * 3);
    this.pNrm = new Float32Array(n * 3);
    this.pCol = new Uint8Array(n * 4);
    const idx: number[] = [];
    for (let i = 0; i < MAX_PARTICLES; i++) for (const k of OCT_IDX) idx.push(i * 6 + k);
    this.pMesh = new pc.Mesh(device);
    this.pMesh.setPositions(this.pPos);
    this.pMesh.setNormals(this.pNrm);
    this.pMesh.setColors32(this.pCol);
    this.pMesh.setIndices(idx);
    this.pMesh.update();
    this.pMesh.incRefCount();
    const pm = new pc.StandardMaterial();
    pm.diffuseVertexColor = true;
    pm.useMetalness = true;
    pm.metalness = 0;
    pm.gloss = 0.4;
    pm.emissive = new pc.Color(0.15, 0.15, 0.12);
    pm.update();
    const pe = new pc.Entity('particles');
    pe.addComponent('render', { meshInstances: [new pc.MeshInstance(this.pMesh, pm)], castShadows: false, receiveShadows: false });
    pe.render!.meshInstances[0].cull = false;
    this.root.addChild(pe);
    // Thin unit ring (radius 1) so scaling never thickens the tube.
    const ringMesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({ tubeRadius: 0.035, ringRadius: 1, segments: 40, sides: 6 }));
    ringMesh.incRefCount();
    for (let i = 0; i < 16; i++) {
      const m = uniqueMat(PALETTE.eyeCyan, { opacity: 0.8, emissive: PALETTE.eyeCyan, emissiveIntensity: 1.5 });
      const e = new pc.Entity('ring');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(ringMesh, m)], castShadows: false });
      this.root.addChild(e);
      e.enabled = false;
      this.rings.push({ e, m, life: 0, max: 1, r0: 0, r1: 1, active: false });
    }
    for (let i = 0; i < 24; i++) {
      const m = uniqueMat(PALETTE.flowerCore, { opacity: 0.9, emissive: PALETTE.flowerCore, emissiveIntensity: 2 });
      const e = shape(this.root, 'box', m, { scale: 0.05 });
      e.enabled = false;
      this.arcs.push({ e, m, life: 0, max: 1, active: false });
    }
  }

  private setMatColor(m: pc.StandardMaterial, hex: string) {
    const c = new pc.Color();
    c.fromString(hex);
    m.diffuse = c;
    m.emissive = c;
  }

  ring(pos: pc.Vec3, hex: string, r1 = 1.2, dur = 0.6) {
    const r = this.rings.find((x) => !x.active) ?? this.rings[0];
    r.active = true;
    r.life = 0;
    r.max = dur;
    r.r0 = 0.1;
    r.r1 = r1;
    this.setMatColor(r.m, hex);
    r.e.enabled = true;
    r.e.setPosition(pos.x, pos.y + 0.12, pos.z);
  }

  burst(pos: pc.Vec3, count: number, opts: { speed?: number; up?: number; size?: number; life?: number; gravity?: number } = {}) {
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const p = this.particles.find((x) => !x.active);
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 1.2) * (0.4 + Math.random() * 0.8);
      p.active = true;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = (opts.up ?? 2.4) * (0.6 + Math.random() * 0.6);
      p.life = 0;
      p.max = (opts.life ?? 0.9) * (0.7 + Math.random() * 0.5);
      p.size = (opts.size ?? 0.06) * (0.6 + Math.random() * 0.8);
      p.spin = (Math.random() - 0.5) * 720;
      p.gravity = opts.gravity ?? 5;
      p.x = pos.x + (Math.random() - 0.5) * 0.3;
      p.y = pos.y + 0.1;
      p.z = pos.z + (Math.random() - 0.5) * 0.3;
      p.rot = Math.random() * 6.28;
    }
  }

  /** One small, slow, fading particle (drone flight trails). */
  trail(pos: pc.Vec3) {
    const p = this.particles.find((x) => !x.active);
    if (!p) return;
    p.active = true;
    p.vx = (Math.random() - 0.5) * 0.2;
    p.vz = (Math.random() - 0.5) * 0.2;
    p.vy = -0.15;
    p.life = 0;
    p.max = 0.5;
    p.size = 0.05;
    p.spin = 90;
    p.gravity = 0;
    p.x = pos.x;
    p.y = pos.y;
    p.z = pos.z;
  }

  /** A short glowing streak between two tiles: explains a chain's cause → effect. */
  arc(a: pc.Vec3, b: pc.Vec3, hex: string = PALETTE.flowerCore, dur = 0.5) {
    const s = this.arcs.find((x) => !x.active) ?? this.arcs[0];
    s.active = true;
    s.life = 0;
    s.max = dur;
    this.setMatColor(s.m, hex);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    s.e.enabled = true;
    s.e.setPosition((a.x + b.x) / 2, Math.max(a.y, b.y) + 0.18, (a.z + b.z) / 2);
    s.e.setEulerAngles(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0);
    s.e.setLocalScale(0.07, 0.04, len);
  }

  /** Simulates all particles and rewrites the one shared mesh. */
  private updateParticles(dt: number) {
    let any = false;
    const P = this.pPos;
    const N = this.pNrm;
    const C = this.pCol;
    this.particles.forEach((p, i) => {
      const base = i * 6;
      let s = 0;
      if (p.active) {
        p.life += dt;
        if (p.life >= p.max) p.active = false;
        else {
          any = true;
          p.vy -= p.gravity * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.rot += (p.spin * Math.PI * dt) / 180;
          const k = 1 - p.life / p.max;
          s = p.size * Math.min(1, k * 3) * 0.6;
        }
      }
      const c = Math.cos(p.rot);
      const sn = Math.sin(p.rot);
      for (let v = 0; v < 6; v++) {
        const [ox, oy, oz] = OCT[v];
        // spin around Y, flatten a little so they read as leaves/petals
        const rx = ox * c - oz * sn;
        const rz = ox * sn + oz * c;
        const j = (base + v) * 3;
        P[j] = p.x + rx * s;
        P[j + 1] = p.y + oy * s * 0.5;
        P[j + 2] = p.z + rz * s;
        N[j] = rx;
        N[j + 1] = oy;
        N[j + 2] = rz;
        const q = (base + v) * 4;
        C[q] = p.color[0];
        C[q + 1] = p.color[1];
        C[q + 2] = p.color[2];
        C[q + 3] = 255;
      }
    });
    if (any || this.anyActive) {
      this.pMesh.setPositions(P);
      this.pMesh.setNormals(N);
      this.pMesh.setColors32(C);
      this.pMesh.update(pc.PRIMITIVE_TRIANGLES, false);
    }
    this.anyActive = any;
  }

  update(dt: number) {
    this.updateParticles(dt);
    for (const r of this.rings) {
      if (!r.active) continue;
      r.life += dt;
      const k = r.life / r.max;
      if (k >= 1) {
        r.active = false;
        r.e.enabled = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      const rad = r.r0 + (r.r1 - r.r0) * e;
      r.e.setLocalScale(rad, 1, rad);
      r.m.opacity = 0.85 * (1 - k);
      r.m.update();
    }
    for (const s of this.arcs) {
      if (!s.active) continue;
      s.life += dt;
      const k = s.life / s.max;
      if (k >= 1) {
        s.active = false;
        s.e.enabled = false;
        continue;
      }
      s.m.opacity = 0.9 * (1 - k);
      s.m.update();
    }
  }
}
