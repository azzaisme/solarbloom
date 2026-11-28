import * as pc from 'playcanvas';
import { LOOK } from '../data/look';

/**
 * VFX 1: clouds of magic: puffs of glowing smoke billowing up where a pulse heals the ground. Each puff is a quad
 * turned to face the camera, drawn by a noise shader: domain-warped fractal noise for a turbulent, ragged cloud, a
 * bright core shot through with thin crackling veins, deep green smoke at its edges (it darkens what's behind it as
 * well as glowing), and a hole opening in the middle as it spreads. It churns as it lives (the noise scrolls and
 * the puff turns), swells, rises and fades. Pooled (Vfx plays none with reduced motion).
 */

const VS = /* glsl */ `
attribute vec3 aPosition;
attribute vec2 aUv0;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec2 vUv;
void main(void) {
	vUv = aUv0;
	gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0);
}
`;

const FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uSeed;
uniform float uAlpha;
uniform float uHot;
uniform float uSpin;
uniform float uOpen;
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uSmoke;
float mcHash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float mcNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mcHash(i), mcHash(i + vec2(1.0, 0.0)), f.x), mix(mcHash(i + vec2(0.0, 1.0)), mcHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float mcFbm(vec2 p) {
	float s = 0.0;
	float a = 0.5;
	for (int i = 0; i < 5; i++) {
		s += a * mcNoise(p);
		p = p * 2.03 + vec2(1.7, 9.2);
		a *= 0.5;
	}
	return s;
}
void main(void) {
	vec2 p = vUv * 2.0 - 1.0;
	float c = cos(uSpin);
	float s = sin(uSpin);
	p = mat2(c, -s, s, c) * p;
	float r = length(p);
	vec2 q = p * 1.7 + uSeed;
	// the cloud: fractal noise warped by more of itself, churning as it scrolls
	vec2 w = vec2(mcFbm(q + vec2(0.0, uTime * 0.35)), mcFbm(q + vec2(5.2, 1.3) - uTime * 0.3));
	float d = mcFbm(q * 1.2 + 2.2 * w + vec2(uTime * 0.12));
	// a ragged edge, and a hole opening in its middle as it spreads
	float edge = smoothstep(1.0, 0.35, r + (d - 0.5) * 0.75);
	float hole = mix(1.0, smoothstep(0.0, 0.3 + 0.25 * d, r), uOpen);
	float dens = edge * hole * smoothstep(0.12, 0.55, d + 0.4 * (1.0 - r));
	// crackling veins: thin bright filaments through the cloud
	float v1 = 1.0 - abs(mcNoise(q * 3.5 + 3.0 * w + uTime * 0.7) * 2.0 - 1.0);
	float v2 = 1.0 - abs(mcNoise(q * 7.0 - 2.0 * w - uTime * 0.9) * 2.0 - 1.0);
	float veins = pow(v1, 10.0) * 0.9 + pow(v2, 14.0) * 0.6;
	// bright and hot in its heart, deep smoke at its edges
	float core = smoothstep(0.25, 0.95, d * (1.25 - r));
	vec3 col = mix(uSmoke, uMid, smoothstep(0.12, 0.55, core));
	col = mix(col, uCore, smoothstep(0.5, 1.0, core));
	col *= 0.8 + 2.6 * core * uHot;
	col += uCore * veins * edge * hole * 2.2 * uHot;
	// thinning out at the foot of the quad, so it never shows a line where it meets the ground
	float foot = smoothstep(0.0, 0.3, vUv.y);
	float a = clamp(dens * uAlpha * foot, 0.0, 1.0);
	gl_FragColor = vec4(col * a, a * 0.85);
}
`;

interface Puff {
  e: pc.Entity;
  m: pc.ShaderMaterial;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  s0: number;
  s1: number;
  life: number;
  max: number;
  delay: number;
  spin: number;
  turn: number;
  hot: number;
  open: number;
  active: boolean;
}

/** sRGB hex to linear (the shader writes straight into the HDR frame) */
function linear(hex: string): number[] {
  const c = new pc.Color().fromString(hex);
  return [c.r, c.g, c.b].map((v) => Math.pow(v, 2.2));
}

export class MagicCloud {
  private puffs: Puff[] = [];
  /** where the camera is (the puffs turn to face it) */
  eye?: () => pc.Vec3;
  /** the height of the ground's top at world (x, z) (see Vfx.groundAt) */
  groundAt?: (x: number, z: number) => number | undefined;

  constructor(parent: pc.Entity, device: pc.GraphicsDevice) {
    const mesh = new pc.Mesh(device);
    mesh.setPositions([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
    mesh.setUvs(0, [0, 0, 1, 0, 1, 1, 0, 1]);
    mesh.setIndices([0, 1, 2, 0, 2, 3]);
    mesh.update();
    mesh.incRefCount();
    const C = LOOK.pulseFx.cloud.colours;
    for (let i = 0; i < 36; i++) {
      const m = new pc.ShaderMaterial({ uniqueName: 'vfx1-magic-cloud', vertexGLSL: VS, fragmentGLSL: FS, attributes: { aPosition: pc.SEMANTIC_POSITION, aUv0: pc.SEMANTIC_TEXCOORD0 } });
      m.blendType = pc.BLEND_PREMULTIPLIED;
      m.depthWrite = false;
      m.cull = pc.CULLFACE_NONE;
      m.setParameter('uCore', linear(C.core));
      m.setParameter('uMid', linear(C.mid));
      m.setParameter('uSmoke', linear(C.smoke));
      m.update();
      const e = new pc.Entity('magicCloud');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, m)], castShadows: false, receiveShadows: false });
      e.render!.meshInstances[0].cull = false;
      parent.addChild(e);
      e.enabled = false;
      this.puffs.push({ e, m, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, life: 0, max: 1, delay: 0, spin: 0, turn: 0, hot: 1, open: 0, active: false });
    }
  }

  /**
   * A cloud billowing up over the ground round `centre` (out to `R`; over `inside` when given): a bright burst in its
   * middle opening out, and puffs churning up all over it. `strength` scales its size and brightness.
   */
  burst(centre: pc.Vec3, R: number, strength = 1, inside?: (x: number, z: number) => boolean, delay = 0) {
    const K = LOOK.pulseFx.cloud;
    // a big patch is more puffs, not bigger ones (a giant puff would swallow the view)
    const S = Math.min(K.maxSize, K.size + K.perTile * R) * Math.min(1.3, strength);
    // the heart of it: one big bright puff that opens out
    this.puff(centre.x, centre.y, centre.z, S * 0.5, S * 1.3, K.seconds * 0.85, delay, 1.3 * strength, 1, 0, 0.25);
    const n = Math.min(K.max, Math.round(K.puffs + K.puffsPerTile * R));
    for (let i = 0; i < n; i++) {
      let a = (i / n) * Math.PI * 2 + Math.random() * 0.8;
      let r = R * (0.2 + 0.6 * Math.random());
      for (let t = 0; t < 8 && inside && !inside(centre.x + Math.cos(a) * r, centre.z + Math.sin(a) * r); t++) {
        a = Math.random() * Math.PI * 2;
        r = R * Math.random() * 0.7;
      }
      const x = centre.x + Math.cos(a) * r;
      const z = centre.z + Math.sin(a) * r;
      const y = this.groundAt?.(x, z) ?? centre.y;
      // drifting out over a big patch; a small one's cloud stays over it
      const out = (0.05 + Math.random() * 0.15) * Math.min(1, R / 2.5);
      const s = S * (0.55 + Math.random() * 0.45);
      this.puff(x, y, z, s * 0.3, s, K.seconds * (0.75 + Math.random() * 0.5), delay + 0.04 + Math.random() * 0.2, (0.5 + Math.random() * 0.5) * strength, 0.25, Math.cos(a) * out, Math.sin(a) * out);
    }
  }

  /** A puff of magic churning round `pos` (its middle there), `size` across, for `dur` seconds. */
  orb(pos: pc.Vec3, size: number, dur: number, hot: number) {
    const p = this.puff(pos.x, pos.y - size * 0.42, pos.z, size * 0.6, size, dur, 0, hot, 0);
    if (p) p.vy = 0; // it stays round `pos`
  }

  private puff(x: number, y: number, z: number, s0: number, s1: number, dur: number, delay: number, hot: number, open: number, vx = 0, vz = 0): Puff | undefined {
    const p = this.puffs.find((q) => !q.active);
    if (!p) return undefined;
    Object.assign(p, { x, y, z, vx, vz, vy: LOOK.pulseFx.cloud.rise / dur, s0, s1, life: 0, max: dur, delay, hot, open, active: true });
    p.spin = (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.6);
    p.turn = Math.random() * Math.PI * 2;
    p.m.setParameter('uSeed', Math.random() * 50);
    p.m.setParameter('uAlpha', 0);
    p.e.enabled = false;
    return p;
  }

  update(dt: number) {
    const eye = this.eye?.();
    for (const p of this.puffs) {
      if (!p.active) continue;
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay > 0) continue;
      }
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) {
        p.active = false;
        p.e.enabled = false;
        continue;
      }
      p.e.enabled = true;
      // swells fast then slow, drifts up and out, turns
      const grow = 1 - Math.pow(1 - k, 3);
      const size = p.s0 + (p.s1 - p.s0) * grow;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.y += p.vy * dt * (1 - k);
      p.turn += p.spin * dt;
      // its middle stands a little over half its size up, so the foot (faded in the shader) sits on the ground
      p.e.setPosition(p.x, p.y + size * 0.42, p.z);
      if (eye) p.e.lookAt(eye);
      p.e.setLocalScale(size, size, 1);
      const env = Math.min(1, k / 0.1) * Math.pow(1 - k, 1.4);
      p.m.setParameter('uTime', p.life * 1.6 + p.turn);
      p.m.setParameter('uSpin', p.turn);
      p.m.setParameter('uAlpha', env * LOOK.pulseFx.cloud.alpha);
      p.m.setParameter('uHot', p.hot * (1 - 0.6 * k));
      p.m.setParameter('uOpen', p.open * grow);
    }
  }
}
