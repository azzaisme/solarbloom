import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { color, PALETTE, uniqueMat } from './Materials';
import { shape } from './Shapes';

interface Particle {
  x: number;
  y: number;
  z: number;
  rot: number;
  color: [number, number, number];
  /** The particle's own confetti colour; a coloured burst or mote overrides `color` for one use. */
  base: [number, number, number];
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  spin: number;
  gravity: number;
  active: boolean;
  /** Look 3.14: how much the particle glows (0..1): sparkles and motes glow, leaf confetti barely. */
  glow: number;
  /** Look 3.14: drifts down slowly with a sway (petals). */
  float: boolean;
  /** Look 3.14: flickers in size (sparkles). */
  twinkle: boolean;
}

/** Bloombot's travelling palm ring (palmWave). */
interface PalmRing {
  e: pc.Entity;
  m: pc.StandardMaterial;
  from: pc.Vec3;
  to: pc.Vec3;
  life: number;
  max: number;
  delay: number;
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
/** Confetti's own glow, as before Look 3.14 (an emissive of about 0.15). */
const BASE_GLOW = 0.15;

/** Look 3.14: the neon green of restore targets, pulse previews and restore shockwaves (Look 2's signal green). */
export const NEON = PALETTE.signal.ok;

/** Sparkle and petal colours of a restore. */
const SPARKLE = [PALETTE.pure.white, PALETTE.flowerCore, NEON, PALETTE.glow.mintPale];
const PETALS = [PALETTE.pink, PALETTE.flower[0], PALETTE.flower[3], PALETTE.flower[1], PALETTE.flower[2]];

/**
 * Pooled effects: expanding rings, restore shockwaves, leaf/confetti/sparkle/petal particles (one draw call for
 * all of them), chain arcs.
 */
export class Vfx {
  private particles: Particle[] = [];
  private pMesh: pc.Mesh;
  private pPos: Float32Array;
  private pNrm: Float32Array;
  private pCol: Uint8Array;
  private anyActive = false;
  private rings: Ring[] = [];
  private waves: Ring[] = [];
  /** Bloombot's pulse: upright rings that travel from its palm to the tile (like the reference's echo pulse). */
  private palms: PalmRing[] = [];
  private arcs: Arc[] = [];
  private root: pc.Entity;
  private rgbCache = new Map<string, [number, number, number]>();
  density = 1;
  /** Look 3.14: restore effects drop the travelling shockwave and the floating petals. */
  reducedMotion = false;

  constructor(parent: pc.Entity, device: pc.GraphicsDevice) {
    this.root = new pc.Entity('vfx');
    parent.addChild(this.root);
    const colors = [...PALETTE.grassTuft, ...PALETTE.flower, PALETTE.gold].map((h) => {
      const c = new pc.Color();
      c.fromString(h);
      return [c.r, c.g, c.b].map((v) => Math.round(Math.pow(v, 2.2) * 255)) as [number, number, number];
    });
    for (let i = 0; i < MAX_PARTICLES; i++)
      this.particles.push({
        x: 0, y: 0, z: 0, rot: 0, color: colors[i % colors.length], base: colors[i % colors.length], vx: 0, vy: 0, vz: 0,
        life: 0, max: 1, size: 0.05, spin: 0, gravity: 4, active: false, glow: BASE_GLOW, float: false, twinkle: false,
      });
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
    // Look 1.9: sparkles (bursts, frenzy, mega-bloom, drone trails, Look 3.14 motes) glow in their own colour and bloom.
    pm.emissive = new pc.Color(1, 1, 1);
    pm.emissiveVertexColor = true;
    pm.emissiveIntensity = LOOK.emissive.particles;
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
    // A bolder ring for bloombot's pulse: it reads as a glowing band, like the reference's echo waves.
    const palmMesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({ tubeRadius: 0.04, ringRadius: 1, segments: 48, sides: 8 }));
    palmMesh.incRefCount();
    for (let i = 0; i < 15; i++) {
      const m = uniqueMat(PALETTE.eyeCyan, { opacity: 0.9, emissive: PALETTE.eyeCyan, emissiveIntensity: 2.6 });
      const e = new pc.Entity('palmRing');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(palmMesh, m)], castShadows: false });
      this.root.addChild(e);
      e.enabled = false;
      this.palms.push({ e, m, from: new pc.Vec3(), to: new pc.Vec3(), life: 0, max: 1, delay: 0, active: false });
    }
    // Look 3.14: restore shockwaves, a flat soft-edged annulus (vertex alpha) sweeping out across the tiles.
    const waveMesh = this.annulus(device);
    for (let i = 0; i < 12; i++) {
      const m = new pc.StandardMaterial();
      m.useLighting = false;
      m.diffuse = new pc.Color(0, 0, 0);
      m.emissive = color(NEON);
      m.emissiveIntensity = 1.4;
      m.opacityVertexColor = true;
      m.opacityVertexColorChannel = 'a';
      m.blendType = pc.BLEND_NORMAL;
      m.depthWrite = false;
      m.useFog = false;
      m.cull = pc.CULLFACE_NONE;
      m.update();
      const e = new pc.Entity('wave');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(waveMesh, m)], castShadows: false, receiveShadows: false });
      this.root.addChild(e);
      e.enabled = false;
      this.waves.push({ e, m, life: 0, max: 1, r0: 0, r1: 1, active: false });
    }
    for (let i = 0; i < 24; i++) {
      const m = uniqueMat(PALETTE.flowerCore, { opacity: 0.9, emissive: PALETTE.flowerCore, emissiveIntensity: 2 });
      const e = shape(this.root, 'box', m, { scale: 0.05 });
      e.enabled = false;
      this.arcs.push({ e, m, life: 0, max: 1, active: false });
    }
  }

  /** A flat ring of radius 1 at y=0: clear inside, a bright band at the rim, fading out just past it. */
  private annulus(device: pc.GraphicsDevice): pc.Mesh {
    const SEG = 40;
    const radii: [number, number][] = [[0.5, 0], [0.84, 0.55], [0.93, 1], [1.05, 0]];
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      for (const [r, al] of radii) {
        pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
        nrm.push(0, 1, 0);
        col.push(255, 255, 255, Math.round(al * 255));
      }
    }
    const R = radii.length;
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      for (let k = 0; k < R - 1; k++) {
        const a = i * R + k;
        const b = j * R + k;
        idx.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
    const mesh = new pc.Mesh(device);
    mesh.setPositions(pos);
    mesh.setNormals(nrm);
    mesh.setColors32(col);
    mesh.setIndices(idx);
    mesh.update();
    mesh.incRefCount();
    return mesh;
  }

  /** A palette colour as the particle mesh's vertex colour (linear 0-255). */
  private rgb(hex: string): [number, number, number] {
    let c = this.rgbCache.get(hex);
    if (!c) {
      const col = new pc.Color();
      col.fromString(hex);
      c = [col.r, col.g, col.b].map((v) => Math.round(Math.pow(v, 2.2) * 255)) as [number, number, number];
      this.rgbCache.set(hex, c);
    }
    return c;
  }

  private setMatColor(m: pc.StandardMaterial, hex: string) {
    const c = new pc.Color();
    c.fromString(hex);
    m.diffuse = c;
    m.emissive = c;
  }

  /**
   * Bloombot's pulse: four cyan rings leave the palm (`from`) one after another, growing as they travel to the
   * target tile (`to`), with sparkles along the way, then a cyan ring on the ground where they land. Reduced
   * motion: one ring that fades in place at the tile.
   */
  palmWave(from: pc.Vec3, to: pc.Vec3, hex: string = PALETTE.eyeCyan) {
    if (this.reducedMotion) return this.ring(to, hex, 0.7, 0.4);
    const n = this.density < 0.6 ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const r = this.palms.find((x) => !x.active) ?? this.palms[0];
      r.active = true;
      r.life = 0;
      r.max = 1.1;
      r.delay = i * 0.16;
      r.from.copy(from);
      r.to.copy(to);
      this.setMatColor(r.m, hex);
      r.e.enabled = false; // shown once its delay has passed
    }
    for (let i = 0; i < Math.round(6 * this.density); i++) {
      const k = (i + 1) / 7;
      const a = new pc.Vec3().lerp(from, to, k * 0.6);
      this.mote(a, new pc.Vec3().lerp(from, to, Math.min(1, k + 0.35)).add(new pc.Vec3((Math.random() - 0.5) * 0.3, 0.12 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3)), i % 2 ? PALETTE.pure.white : hex, 1.1, 0.03);
    }
    const land = new pc.Vec3(to.x, to.y - 0.25, to.z);
    setTimeout(() => this.ring(land, hex, 0.95, 0.6), 1000);
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

  /**
   * Look 3.14: a restore's feedback: a sparkle burst, a neon shockwave sweeping over the neighbouring tiles and a
   * few petals drifting down. `strength` scales it (player restores 1, automation less). All pooled; the vfx
   * density (Fewer particles, reduced motion) thins it, and reduced motion keeps only a calm sparkle.
   */
  restoreBloom(pos: pc.Vec3, strength = 1) {
    const rm = this.reducedMotion;
    this.sparkles(pos, Math.round(9 * strength), rm);
    if (rm) return;
    const w = this.waves.find((x) => !x.active) ?? this.waves[0];
    w.active = true;
    w.life = 0;
    w.max = 0.6;
    w.r0 = 0.3;
    w.r1 = 0.9 + 0.4 * strength;
    w.e.setPosition(pos.x, pos.y + 0.035, pos.z);
    w.e.setLocalScale(w.r0, 1, w.r0);
    w.m.opacity = 0;
    w.m.update();
    w.e.enabled = true;
    const n = Math.round(4 * strength * this.density);
    for (let i = 0; i < n; i++) {
      const p = this.free();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const sp = 0.35 + Math.random() * 0.45;
      this.spawn(p, pos.x + Math.cos(a) * 0.2, pos.y + 0.25 + Math.random() * 0.2, pos.z + Math.sin(a) * 0.2);
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = 1.4 + Math.random() * 0.6;
      p.max = 1.5 + Math.random() * 0.6;
      p.size = 0.08 + Math.random() * 0.03;
      p.spin = (Math.random() - 0.5) * 260;
      p.gravity = 2.2;
      p.float = true;
      p.glow = 0.3;
      p.color = this.rgb(PETALS[Math.floor(Math.random() * PETALS.length)]);
    }
  }

  /** Glowing, twinkling sparkles rising from a tile at `pos` (pooled; thinned by density). */
  sparkles(pos: pc.Vec3, count: number, calm = false) {
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const p = this.free();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.42;
      this.spawn(p, pos.x + Math.cos(a) * r, pos.y + 0.05, pos.z + Math.sin(a) * r);
      const sp = calm ? 0.1 : 0.3 + Math.random() * 0.5;
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = calm ? 0.5 : 1.2 + Math.random() * 1.4;
      p.max = 0.55 + Math.random() * 0.4;
      p.size = 0.04 + Math.random() * 0.03;
      p.spin = 360;
      p.gravity = calm ? 0 : 1.6;
      p.glow = 1;
      p.twinkle = !calm;
      p.color = this.rgb(SPARKLE[i % SPARKLE.length]);
    }
  }

  private free(): Particle | undefined {
    return this.particles.find((x) => !x.active);
  }

  /** Activates a pooled particle at a position with the confetti defaults. */
  private spawn(p: Particle, x: number, y: number, z: number) {
    p.active = true;
    p.life = 0;
    p.x = x;
    p.y = y;
    p.z = z;
    p.rot = Math.random() * 6.28;
    p.glow = BASE_GLOW;
    p.float = false;
    p.twinkle = false;
  }

  burst(pos: pc.Vec3, count: number, opts: { speed?: number; up?: number; size?: number; life?: number; gravity?: number; hex?: string; glow?: number } = {}) {
    const n = Math.max(1, Math.round(count * this.density));
    for (let i = 0; i < n; i++) {
      const p = this.free();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const sp = (opts.speed ?? 1.2) * (0.4 + Math.random() * 0.8);
      this.spawn(p, pos.x + (Math.random() - 0.5) * 0.3, pos.y + 0.1, pos.z + (Math.random() - 0.5) * 0.3);
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = (opts.up ?? 2.4) * (0.6 + Math.random() * 0.6);
      p.max = (opts.life ?? 0.9) * (0.7 + Math.random() * 0.5);
      p.size = (opts.size ?? 0.06) * (0.6 + Math.random() * 0.8);
      p.spin = (Math.random() - 0.5) * 720;
      p.gravity = opts.gravity ?? 5;
      p.color = opts.hex ? this.rgb(opts.hex) : p.base;
      // A coloured burst is a sparkle (beam sparkles, drone puffs): it glows. Confetti keeps its soft look.
      p.glow = opts.glow ?? (opts.hex ? 0.8 : BASE_GLOW);
    }
  }

  /**
   * Drone redesign D05: one glowing mote travelling from `a` to `b` in `life` seconds (restoration beam streams).
   * Uses the shared particle pool, so it costs nothing extra to draw.
   */
  mote(a: pc.Vec3, b: pc.Vec3, hex: string, life = 0.45, size = 0.035) {
    if (Math.random() > this.density) return;
    const p = this.free();
    if (!p) return;
    const j = 0.04;
    this.spawn(p, a.x + (Math.random() - 0.5) * j, a.y, a.z + (Math.random() - 0.5) * j);
    p.max = life;
    p.size = size * (0.7 + Math.random() * 0.6);
    p.spin = 240;
    p.gravity = 0;
    p.vx = (b.x + (Math.random() - 0.5) * 0.35 - p.x) / life;
    p.vy = (b.y - p.y) / life;
    p.vz = (b.z + (Math.random() - 0.5) * 0.35 - p.z) / life;
    p.color = this.rgb(hex);
    p.glow = 1;
  }

  /** One small, slow, fading particle (drone flight trails). */
  trail(pos: pc.Vec3) {
    const p = this.free();
    if (!p) return;
    this.spawn(p, pos.x, pos.y, pos.z);
    p.vx = (Math.random() - 0.5) * 0.2;
    p.vz = (Math.random() - 0.5) * 0.2;
    p.vy = -0.15;
    p.max = 0.5;
    p.size = 0.05;
    p.spin = 90;
    p.gravity = 0;
    p.color = p.base;
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
          if (p.float) {
            // Petals: air drag, a slow terminal fall and a gentle sway.
            const drag = Math.exp(-dt * 2.2);
            p.vx *= drag;
            p.vz *= drag;
            if (p.vy < -0.3) p.vy = -0.3;
            const sway = Math.sin(p.life * 5 + i) * 0.35 * dt;
            p.x += sway;
            p.z += sway * 0.6;
          }
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          p.rot += (p.spin * Math.PI * dt) / 180;
          const k = 1 - p.life / p.max;
          s = p.size * Math.min(1, k * 3) * 0.6;
          if (p.twinkle) s *= 0.65 + 0.35 * Math.sin(p.life * 38 + i);
        }
      }
      const c = Math.cos(p.rot);
      const sn = Math.sin(p.rot);
      const ga = Math.round(p.glow * 255);
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
        C[q + 3] = ga;
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
    for (const r of this.palms) {
      if (!r.active) continue;
      if (r.delay > 0) {
        r.delay -= dt;
        continue;
      }
      r.life += dt;
      const k = r.life / r.max;
      if (k >= 1) {
        r.active = false;
        r.e.enabled = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 2);
      r.e.enabled = true;
      r.e.setPosition(r.from.x + (r.to.x - r.from.x) * e, r.from.y + (r.to.y - r.from.y) * e, r.from.z + (r.to.z - r.from.z) * e);
      r.e.lookAt(r.e.getPosition().clone().add(new pc.Vec3().sub2(r.to, r.from)));
      r.e.rotateLocal(90, 0, 0); // the torus's axis (local +y) along the direction of travel
      const s = 0.12 + 0.46 * e;
      r.e.setLocalScale(s, 1, s);
      r.m.opacity = 0.95 * (1 - k * k);
      r.m.update();
    }
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
    for (const w of this.waves) {
      if (!w.active) continue;
      w.life += dt;
      const k = w.life / w.max;
      if (k >= 1) {
        w.active = false;
        w.e.enabled = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, 2.5);
      const rad = w.r0 + (w.r1 - w.r0) * e;
      w.e.setLocalScale(rad, 1, rad);
      w.m.opacity = 0.9 * Math.min(1, k * 8) * (1 - k);
      w.m.update();
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
