import { MagicCloud } from './MagicCloud';
import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { color, PALETTE, uniqueMat } from './Materials';
import { shape } from './Shapes';
import { worldLightLayers } from './WaterSurface';
import { WIND_X, WIND_Z } from './Wind';

/**
 * VFX 1: one flat ring of a pulse wave that follows the ground: the unit circle's vertices (`ux`, `uz`, base alpha
 * `a`), and the positions and colours written each frame (lifted onto the ground under each vertex, and clear where
 * the ground drops away or rises out from under it).
 */
interface GroundRing {
  mesh: pc.Mesh;
  ux: Float32Array;
  uz: Float32Array;
  a: Uint8Array;
  /** each vertex's angle round the ring, its radius, and how far up the curtain it is (0 on the ground, 1 at its top) */
  ang: Float32Array;
  rr: Float32Array;
  up: Float32Array;
  pos: Float32Array;
  col: Uint8Array;
}

/** VFX 1: one pulse shockwave: a wash + band, a hot rim and broken streaks, each its own additive mesh. */
interface Shock {
  e: pc.Entity;
  streaks: pc.Entity;
  /** the wash + band, the rim, the streaks, the curtain of fire off the rim and the swirl of fire, following the ground */
  rings: [GroundRing, GroundRing, GroundRing, GroundRing, GroundRing];
  /** the fire (curtain and swirl) is on this wave */
  fire: boolean;
  /** where it may be drawn (world x, z): the ground it heals; everywhere when unset */
  inside?: (x: number, z: number) => boolean;
  spiral: pc.StandardMaterial;
  /** the streaks' turn (degrees) and the ground height at the centre */
  turn: number;
  cy: number;
  /** the curtain of light rising off the rim: its material and tallest flame (world units; 0 none) */
  veil: pc.StandardMaterial;
  veilH: number;
  /** how much the rim and curtain flicker, and this wave's own phase for it */
  flicker: number;
  seed: number;
  /** sparks rising off the ground along the rim as it passes (a second, at full strength) */
  sparks: number;
  feed: number;
  wash: pc.StandardMaterial;
  rim: pc.StandardMaterial;
  streak: pc.StandardMaterial;
  life: number;
  max: number;
  delay: number;
  r0: number;
  r1: number;
  spin: number;
  strength: number;
  active: boolean;
}

/**
 * VFX 1: a ribbon of light with a trailing tail. Its head follows `path` (k 0..1 over `max` seconds); where it has
 * been (sampled every TRAIL_DT seconds of effect time, so a slow frame rate keeps the same tail) is drawn as a strip
 * turned to face the camera, tapering and fading to its tail, white-hot at its head.
 */
interface Ribbon {
  e: pc.Entity;
  mesh: pc.Mesh;
  pos: Float32Array;
  col: Uint8Array;
  trail: Float32Array;
  count: number;
  since: number;
  life: number;
  max: number;
  width: number;
  head: pc.Color;
  tail: pc.Color;
  shed: number;
  feed: number;
  path: (k: number, out: pc.Vec3) => void;
  active: boolean;
}
const TRAIL_N = 26;
const TRAIL_DT = 1 / 50;

/** VFX 1: a short flash of real light (the pulse lights the ground it crosses). */
interface Flash {
  e: pc.Entity;
  life: number;
  max: number;
  peak: number;
  /** its full range, and the seconds it takes to reach it (0: at once) */
  range: number;
  grow: number;
  active: boolean;
}

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
  leaf: boolean;
  /** VFX 1: a wisp circling a centre (ox, oz) at radius `orad`, angle `ang`, turning `angV` a second, drifting out `radV` */
  swirl: boolean;
  ox: number;
  oz: number;
  orad: number;
  ang: number;
  angV: number;
  radV: number;
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
const MAX_PARTICLES = 480;
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
  private arcs: Arc[] = [];
  /** VFX 1: pulse shockwaves, light flashes, and the Mega Pulse's charge (rings spinning round Bloombot, its glow) */
  private shocks: Shock[] = [];
  private flashes: Flash[] = [];
  /**
   * VFX 1: the height of the ground's top at world (x, z), or undefined where there is none (the sea, off the edge).
   * Game wires it to the grid; without it the waves stay flat.
   */
  groundAt?: (x: number, z: number) => number | undefined;
  private ribbonFeed = 0;
  private orbFeed = 0;
  private chargeDir = 1;
  /** VFX 1: where the camera is (ribbons of light and clouds of magic turn to face it); Game wires it */
  eye?: () => pc.Vec3;
  private cloud: MagicCloud;
  private ribbons: Ribbon[] = [];
  private rA = new pc.Vec3();
  private rB = new pc.Vec3();
  private rC = new pc.Vec3();
  /** VFX 1: a pulse's release swells the bloom for a moment (Game wires this to PostFx.surgeBloom) */
  onSurge?: (amount: number, seconds: number) => void;
  private orbits: { e: pc.Entity; m: pc.StandardMaterial }[] = [];
  private chargeLight!: pc.Entity;
  /** the Mega Pulse's charge, 0 … 1, as last set by megaCharge(); -1 when not charging */
  private charge = -1;
  private chargeSeen = 0;
  private chargeAt = new pc.Vec3();
  private chargeSpin = 0;
  /** things the pulse does a moment later (in effect time, so a pause holds them) */
  private soon: { at: number; run: () => void }[] = [];
  private clock = 0;
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
        life: 0, max: 1, size: 0.05, spin: 0, gravity: 4, active: false, glow: BASE_GLOW, float: false, twinkle: false, leaf: false,
        swirl: false, ox: 0, oz: 0, orad: 0, ang: 0, angV: 0, radV: 0,
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
    // A bolder ring for the Mega Pulse's charge rings: it reads as a glowing band.
    const palmMesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({ tubeRadius: 0.04, ringRadius: 1, segments: 48, sides: 8 }));
    palmMesh.incRefCount();
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
      m.depthBias = -4; // drawn a touch towards the camera, so the ground's bumps can't poke through it
      m.slopeDepthBias = -4;
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
    // VFX 1: the pulse shockwave. Radius 1 profiles: a faint wash inside rising to a glowing band, a thin hot rim on
    // its outer edge, and streaks: short broken arcs riding just inside the rim (alpha varies round the circle).
    const G = LOOK.pulseFx.glow;
    const WASH: [number, number][] = [[0, 0.22], [0.45, 0.3], [0.7, 0.5], [0.86, 0.85], [0.95, 1], [1.03, 0.45], [1.12, 0]];
    const RIM: [number, number][] = [[0.9, 0], [0.96, 1], [1.0, 1], [1.035, 0]];
    const STREAK: [number, number][] = [[0.8, 0], [0.855, 1], [0.87, 1], [0.9, 0]];
    // a curtain of fire standing on the rim: white-hot at its foot, green and gone at its tips, leaning out a touch
    const FL = LOOK.pulseFx.flame;
    const VEIL: [number, number, number, string][] = [[0.985, 0.95, 0, FL.hot], [0.995, 0.6, 0.3, FL.mid], [1.01, 0.25, 0.65, FL.tip], [1.03, 0, 1, FL.tip]];
    // the swirl: a disc whose arms of fire are drawn each frame (hot in the middle, green out to the rim)
    const SPIRAL: [number, number, number, string][] = [0.04, 0.12, 0.22, 0.33, 0.45, 0.57, 0.69, 0.8, 0.9, 0.98].map((r) => [r, 1, 0, r < 0.3 ? FL.hot : r < 0.65 ? FL.mid : FL.tip]);
    // a handful of arcs of different lengths: bright in the middle of each, gone between them
    const arcs = (a: number) => Math.max(0, Math.min(1, (Math.sin(a * 7 + 0.7) * 0.55 + Math.sin(a * 17 + 2.1) * 0.45 - 0.2) * 2.6));
    for (let i = 0; i < 9; i++) {
      const C = LOOK.pulseFx.colours;
      // the wash tints the ground it crosses (normal blend keeps it a saturated lime even on sunlit sand); the rim and
      // streaks add light, so they burn white-hot and bloom
      const wash = this.glowMat(C.wash, G.wash);
      wash.blendType = pc.BLEND_NORMAL;
      wash.update();
      const rim = this.glowMat(C.rim, G.rim);
      const streak = this.glowMat(C.streak, G.streak);
      // the fire takes its colours from its vertices (hot at the foot, green at the tips)
      const veil = this.glowMat(PALETTE.pure.white, G.veil);
      const spiral = this.glowMat(PALETTE.pure.white, G.spiral);
      for (const m of [veil, spiral]) {
        m.emissiveVertexColor = true;
        m.emissiveVertexColorChannel = 'rgb';
        m.update();
      }
      spiral.depthBias = -4;
      spiral.slopeDepthBias = -4;
      spiral.update();
      // drawn a touch towards the camera, so a paver's lip or a bump in the ground can't poke up through the light
      for (const m of [wash, rim, streak]) {
        m.depthBias = -4;
        m.slopeDepthBias = -4;
        m.update();
      }
      const rings: [GroundRing, GroundRing, GroundRing, GroundRing, GroundRing] = [this.groundRing(device, WASH), this.groundRing(device, RIM), this.groundRing(device, STREAK, arcs), this.groundRing(device, VEIL), this.groundRing(device, SPIRAL)];
      const e = new pc.Entity('pulseWave');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(rings[0].mesh, wash), new pc.MeshInstance(rings[1].mesh, rim), new pc.MeshInstance(rings[3].mesh, veil), new pc.MeshInstance(rings[4].mesh, spiral)], castShadows: false, receiveShadows: false });
      const streaks = new pc.Entity('pulseStreaks');
      streaks.addComponent('render', { meshInstances: [new pc.MeshInstance(rings[2].mesh, streak)], castShadows: false, receiveShadows: false });
      e.addChild(streaks);
      this.root.addChild(e);
      e.enabled = false;
      for (const mi of [...e.render!.meshInstances, ...streaks.render!.meshInstances]) mi.cull = false; // its vertices move every frame
      this.shocks.push({ e, streaks, rings, fire: false, spiral, turn: 0, cy: 0, veil, veilH: 0, flicker: 0, seed: 0, sparks: 0, feed: 0, wash, rim, streak, life: 0, max: 1, delay: 0, r0: 0, r1: 1, spin: 0, strength: 1, active: false });
    }
    const light = () => {
      const e = new pc.Entity('pulseLight');
      e.addComponent('light', { type: 'omni', castShadows: false, falloffMode: pc.LIGHTFALLOFF_LINEAR, affectSpecularity: false, color: color(LOOK.pulseFx.colours.wash), intensity: 0, range: 4, layers: worldLightLayers() });
      this.root.addChild(e);
      e.enabled = false;
      return e;
    };
    for (let i = 0; i < 3; i++) this.flashes.push({ e: light(), life: 0, max: 1, peak: 1, range: 1, grow: 0, active: false });
    this.cloud = new MagicCloud(this.root, device);
    this.cloud.eye = () => this.eye?.() ?? new pc.Vec3(0, 50, 0);
    this.cloud.groundAt = (x, z) => this.groundAt?.(x, z);
    // the ribbons of light: strips of TRAIL_N pairs of vertices, rewritten each frame
    for (let i = 0; i < 40; i++) {
      const n = TRAIL_N * 2;
      const pos = new Float32Array(n * 3);
      const col = new Uint8Array(n * 4);
      const nrm: number[] = [];
      for (let v = 0; v < n; v++) nrm.push(0, 1, 0);
      const idx: number[] = [];
      for (let j = 0; j < TRAIL_N - 1; j++) idx.push(j * 2, j * 2 + 1, j * 2 + 3, j * 2, j * 2 + 3, j * 2 + 2);
      const mesh = new pc.Mesh(device);
      mesh.setPositions(pos);
      mesh.setNormals(nrm);
      mesh.setColors32(col);
      mesh.setIndices(idx);
      mesh.update();
      mesh.incRefCount();
      const m = this.glowMat(PALETTE.pure.white, G.ribbon);
      m.emissiveVertexColor = true;
      m.emissiveVertexColorChannel = 'rgb';
      m.update();
      const e = new pc.Entity('ribbon');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, m)], castShadows: false, receiveShadows: false });
      e.render!.meshInstances[0].cull = false;
      this.root.addChild(e);
      e.enabled = false;
      this.ribbons.push({ e, mesh, pos, col, trail: new Float32Array(TRAIL_N * 3), count: 0, since: 0, life: 0, max: 1, width: 0.05, head: new pc.Color(1, 1, 1), tail: new pc.Color(1, 1, 1), shed: 0, feed: 0, path: () => {}, active: false });
    }
    this.chargeLight = light();
    // the Mega Pulse's charge: two rings spinning round Bloombot, tightening as the power builds
    for (let i = 0; i < 2; i++) {
      const m = this.glowMat(i ? LOOK.pulseFx.colours.rim : LOOK.pulseFx.colours.wash, G.rim);
      m.opacityVertexColor = false;
      m.update();
      const e = new pc.Entity('megaOrbit');
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(palmMesh, m)], castShadows: false, receiveShadows: false });
      this.root.addChild(e);
      e.enabled = false;
      this.orbits.push({ e, m });
    }
  }

  /** An unlit, additive glow material (vertex alpha shapes it). */
  private glowMat(hex: string, intensity: number): pc.StandardMaterial {
    const m = new pc.StandardMaterial();
    m.useLighting = false;
    m.diffuse = new pc.Color(0, 0, 0);
    m.emissive = color(hex);
    m.emissiveIntensity = intensity;
    m.opacityVertexColor = true;
    m.opacityVertexColorChannel = 'a';
    m.blendType = pc.BLEND_ADDITIVEALPHA;
    m.depthWrite = false;
    m.useFog = false;
    m.useSkybox = false;
    m.cull = pc.CULLFACE_NONE;
    m.update();
    return m;
  }

  /** A ground-following ring (see GroundRing) from a radial alpha profile, x `round(angle)`. */
  private groundRing(device: pc.GraphicsDevice, profile: [number, number, number?, string?][], round?: (a: number) => number): GroundRing {
    const SEG = 96;
    const R = profile.length;
    const n = SEG * R;
    const ux = new Float32Array(n);
    const uz = new Float32Array(n);
    const a = new Uint8Array(n);
    const angs = new Float32Array(n);
    const rrs = new Float32Array(n);
    const ups = new Float32Array(n);
    const pos = new Float32Array(n * 3);
    const col = new Uint8Array(n * 4);
    const nrm: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < SEG; i++) {
      const ang = (i / SEG) * Math.PI * 2;
      const k = round ? round(ang) : 1;
      profile.forEach(([r, al, up, hex], j) => {
        const v = i * R + j;
        angs[v] = ang;
        rrs[v] = r;
        ups[v] = up ?? 0;
        const rgb = hex ? color(hex) : undefined;
        ux[v] = Math.cos(ang) * r;
        uz[v] = Math.sin(ang) * r;
        a[v] = Math.round(al * k * 255);
        pos[v * 3] = ux[v];
        pos[v * 3 + 2] = uz[v];
        col.set(rgb ? [Math.round(rgb.r * 255), Math.round(rgb.g * 255), Math.round(rgb.b * 255), a[v]] : [255, 255, 255, a[v]], v * 4);
        nrm.push(0, 1, 0);
      });
    }
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      for (let k = 0; k < R - 1; k++) idx.push(i * R + k, i * R + k + 1, j * R + k + 1, i * R + k, j * R + k + 1, j * R + k);
    }
    const mesh = new pc.Mesh(device);
    mesh.setPositions(pos);
    mesh.setNormals(nrm);
    mesh.setColors32(col);
    mesh.setIndices(idx);
    mesh.update();
    mesh.incRefCount();
    return { mesh, ux, uz, a, ang: angs, rr: rrs, up: ups, pos, col };
  }

  /**
   * Lays a wave's rings on the ground at radius `rad` round (cx, cy, cz): each vertex lifted to the ground under it
   * (the entity scales only x and z, so a local y is a world height), and clear where that ground is more than a step
   * above or below the centre's (a step down or up, a wall, the sea): it stays on the level Bloombot stands on.
   */
  private layOnGround(s: Shock, rad: number) {
    const at = this.groundAt;
    const p = s.e.getPosition();
    const cx = p.x;
    const cz = p.z;
    const LIFT = 0.035;
    // flames round the ring: a few sines of whole turns (so it closes up), drifting at their own speeds
    const T = s.life;
    const q = s.seed;
    const flame = (a: number, ph: number) =>
      0.5 + 0.28 * Math.sin(a * 6 + T * 7 + q + ph) + 0.14 * Math.sin(a * 13 - T * 11 + q * 2 + ph) + 0.08 * Math.sin(a * 29 + T * 19 + ph);
    const F = s.flicker;
    const arms = LOOK.pulseFx.extra.arms;
    const inside = s.inside;
    // the flames run round the ring as the fire swirls
    const run = T * 2.6;
    s.rings.forEach((g, ri) => {
      if (ri >= 3 && !s.fire) return;
      // the streaks turn (local y rotation by `turn` degrees): their world angle is turned the same way
      const t = ri === 2 ? (s.turn * Math.PI) / 180 : 0;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      const n = g.ux.length;
      for (let v = 0; v < n; v++) {
        const x = g.ux[v] * c + g.uz[v] * sn;
        const z = -g.ux[v] * sn + g.uz[v] * c;
        const wx = cx + x * rad;
        const wz = cz + z * rad;
        const h = at ? at(wx, wz) : s.cy;
        const dy = h === undefined ? 9 : h - s.cy;
        const off = Math.abs(dy);
        const keep = (off <= 0.09 ? 1 : off >= 0.2 ? 0 : 1 - (off - 0.09) / 0.11) * (!inside || inside(wx, wz) ? 1 : 0);
        // the rim flares and dims round the ring; the curtain's flames rise and fall (their own phase), running round
        const a = g.ang[v] - t;
        const f = flame(ri >= 3 ? a + run : a, ri === 3 ? 2.3 : 0);
        let lick = ri === 0 ? 1 - 0.2 * F * (1 - f) : ri === 3 ? 1 - F * (1 - f) * 0.75 : 1 - F * 0.7 * (1 - f * f);
        if (ri === 4) {
          // arms of fire curling out from the middle and turning: thin bright arms, gone at the very middle and the rim
          const r = g.rr[v];
          const sw = 0.5 + 0.5 * Math.sin(arms * (a + T * 3.2) - r * 7 + q);
          const env = Math.min(1, Math.max(0, (r - 0.06) / 0.22)) * (1 - Math.max(0, (r - 0.8) / 0.2));
          lick = sw * sw * sw * env * (0.55 + 0.45 * f);
        }
        const rise = ri === 3 ? g.up[v] * s.veilH * (1 - F + F * (0.1 + 1.5 * f * f * f)) : 0;
        g.pos[v * 3 + 1] = (keep > 0 ? dy + LIFT : LIFT) + rise;
        g.col[v * 4 + 3] = Math.min(255, Math.round(g.a[v] * keep * lick));
      }
      g.mesh.setPositions(g.pos);
      g.mesh.setColors32(g.col);
      g.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    });
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

  /** Runs `run` after `delay` seconds of effect time (a pause holds it). */
  private after(delay: number, run: () => void) {
    this.soon.push({ at: this.clock + delay, run });
  }

  /**
   * VFX 1: Bloombot's pulse, all the way round it: power gathers in (motes drawn to its palms from round its feet, a
   * ring closing in on it), then releases (see `release`). `feet` is where it stands, `palm` where the power gathers,
   * `radius` how far the pulse's own footprint reaches from `feet` (tiles; the wave goes a little further).
   * `strength` > 1 for an Overcharge. Reduced motion: no gathering, one calm wave.
   */
  pulse(feet: pc.Vec3, palm: pc.Vec3, centre: pc.Vec3, R: number, strength = 1, inside?: (x: number, z: number) => boolean) {
    const F = LOOK.pulseFx;
    if (this.reducedMotion) {
      this.shockwave(centre, R, { strength: 0.7, inside });
      this.flash(centre, F.light.intensity * 0.6, R * F.light.range + 0.6, F.light.seconds);
      return;
    }
    const n = Math.round(10 * this.density);
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.5;
      const from = new pc.Vec3(feet.x + Math.cos(a) * 1.3, feet.y + 0.15 + Math.random() * 0.7, feet.z + Math.sin(a) * 1.3);
      this.mote(from, palm, i % 3 ? PALETTE.botGlow : PALETTE.pure.white, F.gather + 0.03, 0.045);
    }
    this.ring(new pc.Vec3(feet.x, feet.y + 0.3, feet.z), PALETTE.botGlow, 0.2, F.gather, 1.2);
    // the power leaves the palm as bolts of light arcing down onto the ground, landing as the fire breaks out
    const B = F.ribbons;
    const land = new pc.Vec3(centre.x, centre.y + 0.06, centre.z);
    const travel = Math.max(0.12, F.gather - 0.06);
    for (let i = 0; i < B.bolts; i++) {
      const side = (i - (B.bolts - 1) / 2) * 0.55 + (Math.random() - 0.5) * 0.2;
      this.after(0.06 + i * 0.012, () => this.tendril(this.boltPath(palm, land, side, 0.35 + Math.random() * 0.3), travel - i * 0.012, { width: B.width * 1.1, tail: i % 2 ? LOOK.pulseFx.colours.gold : LOOK.pulseFx.colours.wash, shed: B.shed }));
    }
    this.after(F.gather, () => this.release(palm, centre, R, strength, inside));
  }

  /**
   * The release: power streams from Bloombot's palm to `centre`, and fire swirls out across the ground there to `R`
   * (only over the ground it heals, `inside`): one wave of fire with a smaller echo, a flash of real light spreading
   * with it, sparks off the palm and leaves carried out on the wave.
   */
  private release(palm: pc.Vec3, centre: pc.Vec3, R: number, strength: number, inside?: (x: number, z: number) => boolean) {
    const F = LOOK.pulseFx;
    const dur = F.seconds + F.perTile * R;
    const X = F.extra;
    const small = Math.min(1, 0.35 + R * 0.25); // one tile's fire is a smaller show than a big patch's
    this.shockwave(centre, R, { strength, dur, veil: X.veil, sparks: X.sparks * Math.max(1, R) * strength, inside });
    if (R > 1.2) this.shockwave(centre, R * 0.62, { strength: 0.55 * strength, delay: 0.09, dur: dur * 0.85, inside });
    // its light spreads with the rim, so what the wave reaches lights up as it does
    const lit = new pc.Vec3(centre.x, centre.y + 0.5, centre.z);
    this.flash(lit, F.light.intensity * strength, R * F.light.range + 0.6, Math.max(F.light.seconds, dur * 1.15), undefined, dur);
    this.swirl(centre, Math.max(0.8, R), X.swirl * strength * small, dur * 1.6);
    this.onSurge?.(X.surge * strength * small, X.surgeSeconds);
    this.burst(palm, 10 * strength, { up: 1.3, speed: 1.8, size: 0.05, life: 0.6, gravity: 2, hex: PALETTE.botPulse, glow: 1 });
    // the power leaving Bloombot's palm for the ground it heals
    const n = Math.round(8 * this.density);
    for (let i = 0; i < n; i++) {
      const to = new pc.Vec3(centre.x + (Math.random() - 0.5) * 0.4, centre.y + 0.08, centre.z + (Math.random() - 0.5) * 0.4);
      this.mote(palm, to, i % 3 ? PALETTE.botGlow : PALETTE.pure.white, 0.1 + i * 0.012, 0.05);
    }
    this.carry(centre, R, dur, Math.round(F.leaves * strength * small));
    // the magic in the air: a cloud of it billowing up over the healed ground, and tendrils of light curling up
    // through it in a rising vortex
    this.cloud.burst(centre, R, strength, inside);
    const B = F.ribbons;
    const count = Math.min(B.max, Math.round((B.tendrils + B.perTile * R) * Math.min(1.3, strength)));
    this.vortex(centre, R, count, B.rise + Math.min(1, R * 0.2), B.seconds, inside);
  }

  /**
   * VFX 1: `count` tendrils of light rising from the ground round `centre` (within `R`, and `inside` when given),
   * all turning the same way about it and closing in as they climb `rise` metres over about `seconds`.
   */
  vortex(centre: pc.Vec3, R: number, count: number, rise: number, seconds: number, inside?: (x: number, z: number) => boolean) {
    const B = LOOK.pulseFx.ribbons;
    const C = LOOK.pulseFx.colours;
    const tails = [C.wash, C.gold, C.streak, LOOK.pulseFx.flame.tip];
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < count; i++) {
      // a start on the ground it heals: spread round evenly, at a random distance out
      let a0 = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      let r0 = R * (0.25 + 0.6 * Math.random());
      for (let t = 0; t < 8 && inside && !inside(centre.x + Math.cos(a0) * r0, centre.z + Math.sin(a0) * r0); t++) {
        a0 = Math.random() * Math.PI * 2;
        r0 = R * Math.random() * 0.8;
      }
      const H = rise * (0.7 + 0.6 * Math.random());
      const turns = 0.7 + Math.random() * 0.6;
      const cx = centre.x;
      const cy = centre.y;
      const cz = centre.z;
      const path = (k: number, out: pc.Vec3) => {
        const e = 1 - (1 - k) * (1 - k);
        const a = a0 + dir * turns * Math.PI * 2 * k;
        const r = r0 * (1 - 0.55 * e) + 0.06;
        out.set(cx + Math.cos(a) * r, cy + 0.04 + H * e, cz + Math.sin(a) * r);
      };
      this.after(Math.random() * 0.12, () => this.tendril(path, seconds * (0.8 + Math.random() * 0.4), { width: B.width * (0.7 + Math.random() * 0.6), tail: tails[i % tails.length], shed: B.shed }));
    }
  }

  /** A bolt's path: from `a` to `b` in an arc lifted `lift` and bowed `side` sideways, quickening as it falls. */
  private boltPath(a: pc.Vec3, b: pc.Vec3, side: number, lift: number) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const sx = -dz / len;
    const sz = dx / len;
    const mx = (a.x + b.x) / 2 + sx * side;
    const my = Math.max(a.y, b.y) + lift;
    const mz = (a.z + b.z) / 2 + sz * side;
    const ph = Math.random() * 6;
    return (k: number, out: pc.Vec3) => {
      const e = Math.pow(k, 1.4);
      const u = 1 - e;
      const w = Math.sin(e * 16 + ph) * 0.05 * (1 - e); // a little wriggle, settling as it lands
      out.set(u * u * a.x + 2 * u * e * mx + e * e * b.x + sx * w, u * u * a.y + 2 * u * e * my + e * e * b.y, u * u * a.z + 2 * u * e * mz + e * e * b.z + sz * w);
    };
  }

  /**
   * VFX 1: a ribbon of light whose head follows `path` (k 0..1) over `dur` seconds, its tail trailing after it:
   * `width` at the head, white-hot there fading to `tail`, shedding `shed` sparkles a second. Pooled; none with
   * reduced motion.
   */
  tendril(path: (k: number, out: pc.Vec3) => void, dur: number, o: { width?: number; head?: string; tail?: string; shed?: number } = {}) {
    if (this.reducedMotion) return;
    const r = this.ribbons.find((x) => !x.active);
    if (!r) return;
    r.active = true;
    r.life = 0;
    r.max = Math.max(0.05, dur);
    r.path = path;
    r.width = o.width ?? LOOK.pulseFx.ribbons.width;
    r.head = color(o.head ?? PALETTE.pure.white);
    r.tail = color(o.tail ?? LOOK.pulseFx.colours.wash);
    r.shed = (o.shed ?? 0) * this.density;
    r.feed = 0;
    r.count = 0;
    r.since = 0;
    r.col.fill(0);
    r.e.enabled = true;
  }

  private updateRibbons(dt: number) {
    const eye = this.eye?.();
    const head = this.rA;
    const tan = this.rB;
    const side = this.rC;
    const fadeT = TRAIL_N * TRAIL_DT;
    for (const r of this.ribbons) {
      if (!r.active) continue;
      r.life += dt;
      if (r.life >= r.max + fadeT) {
        r.active = false;
        r.e.enabled = false;
        continue;
      }
      r.path(Math.min(1, r.life / r.max), head);
      // a new point on the tail every TRAIL_DT; the newest is always the live head
      r.since += dt;
      if (r.count === 0 || r.since >= TRAIL_DT) {
        r.trail.copyWithin(3, 0, (TRAIL_N - 1) * 3);
        r.count = Math.min(TRAIL_N, r.count + 1);
        r.since = 0;
      }
      r.trail[0] = head.x;
      r.trail[1] = head.y;
      r.trail[2] = head.z;
      // sparkle dust off the head while it flies
      if (r.shed > 0 && r.life < r.max) {
        r.feed += dt * r.shed;
        for (; r.feed >= 1; r.feed--) {
          const p = this.free();
          if (!p) break;
          this.spawn(p, head.x, head.y, head.z);
          p.vx = (Math.random() - 0.5) * 0.3;
          p.vz = (Math.random() - 0.5) * 0.3;
          p.vy = (Math.random() - 0.3) * 0.3;
          p.gravity = -0.15;
          p.max = 0.5 + Math.random() * 0.6;
          p.size = 0.022 + Math.random() * 0.022;
          p.spin = 200;
          p.glow = 1;
          p.twinkle = true;
          p.color = Math.random() < 0.5 ? this.rgb(PALETTE.pure.white) : [r.tail.r, r.tail.g, r.tail.b];
        }
      }
      // after the head stops the tail draws in to it and fades
      const fade = r.life > r.max ? Math.max(0, 1 - (r.life - r.max) / fadeT) : Math.min(1, r.life / 0.05);
      const T = r.trail;
      const n = r.count;
      for (let i = 0; i < TRAIL_N; i++) {
        const j = Math.min(i, n - 1);
        const a = Math.max(0, j - 1);
        const b = Math.min(n - 1, j + 1);
        tan.set(T[a * 3] - T[b * 3], T[a * 3 + 1] - T[b * 3 + 1], T[a * 3 + 2] - T[b * 3 + 2]);
        if (tan.lengthSq() < 1e-10) tan.set(0, 1, 0);
        const px = T[j * 3];
        const py = T[j * 3 + 1];
        const pz = T[j * 3 + 2];
        if (eye) side.set(eye.x - px, eye.y - py, eye.z - pz);
        else side.set(0, 1, 0);
        side.cross(tan, side);
        if (side.lengthSq() < 1e-10) side.set(1, 0, 0);
        side.normalize();
        const u = i / (TRAIL_N - 1);
        const w = r.width * Math.pow(1 - u, 0.8) * (0.55 + 0.45 * Math.min(1, i / 2));
        const o = i * 6;
        r.pos[o] = px + side.x * w;
        r.pos[o + 1] = py + side.y * w;
        r.pos[o + 2] = pz + side.z * w;
        r.pos[o + 3] = px - side.x * w;
        r.pos[o + 4] = py - side.y * w;
        r.pos[o + 5] = pz - side.z * w;
        const c = Math.min(1, u * 4);
        const R8 = Math.round((r.head.r + (r.tail.r - r.head.r) * c) * 255);
        const G8 = Math.round((r.head.g + (r.tail.g - r.head.g) * c) * 255);
        const B8 = Math.round((r.head.b + (r.tail.b - r.head.b) * c) * 255);
        const A8 = i < n ? Math.round(255 * Math.pow(1 - u, 1.3) * fade) : 0;
        r.col.set([R8, G8, B8, A8], i * 8);
        r.col.set([R8, G8, B8, A8], i * 8 + 4);
      }
      r.mesh.setPositions(r.pos);
      r.mesh.setColors32(r.col);
      r.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    }
  }

  /** Leaves and petals thrown out on a wave from `feet` to `R` over `dur` seconds, lagging just behind its rim. */
  private carry(feet: pc.Vec3, R: number, dur: number, count: number) {
    const n = Math.round(count * this.density);
    for (let i = 0; i < n; i++) {
      const p = this.free();
      if (!p) return;
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.4;
      this.spawn(p, feet.x + Math.cos(a) * r, feet.y + 0.1 + Math.random() * 0.2, feet.z + Math.sin(a) * r);
      // petals drag (float), so they start a little faster than the wave and fall behind its rim
      const sp = ((R * 1.7) / dur) * (0.6 + Math.random() * 0.4);
      p.vx = Math.cos(a) * sp;
      p.vz = Math.sin(a) * sp;
      p.vy = 0.7 + Math.random() * 0.9;
      p.max = dur * 1.3 + Math.random() * 0.6;
      p.size = 0.07 + Math.random() * 0.04;
      p.spin = (Math.random() - 0.5) * 300;
      p.gravity = 1.4;
      p.float = true;
      p.glow = 0.35;
      p.color = this.rgb(i % 3 ? (i % 2 ? PALETTE.leafFin : PALETTE.botGlow) : PETALS[i % PETALS.length]);
    }
  }

  /** A pulse shockwave across the ground from `pos` out to `r1` (tiles). `rim` recolours its hot edge. */
  shockwave(pos: pc.Vec3, r1: number, o: { strength?: number; delay?: number; dur?: number; rim?: string; wash?: string; veil?: number; sparks?: number; inside?: (x: number, z: number) => boolean } = {}) {
    const F = LOOK.pulseFx;
    const s = this.shocks.find((x) => !x.active) ?? this.shocks[0];
    s.active = true;
    s.life = 0;
    s.delay = o.delay ?? 0;
    s.max = o.dur ?? F.seconds + F.perTile * r1;
    s.r0 = F.front.r0;
    s.r1 = r1;
    s.strength = o.strength ?? 1;
    s.spin = this.reducedMotion ? 0 : (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 50);
    // the fire (a smaller wave burns lower)
    s.veilH = this.reducedMotion ? 0 : (o.veil ?? 0) * Math.min(1.3, s.strength) * Math.min(1, 0.4 + r1 * 0.25);
    s.fire = s.veilH > 0;
    s.inside = o.inside;
    s.flicker = this.reducedMotion ? 0 : F.extra.flicker;
    s.seed = Math.random() * 100;
    s.sparks = this.reducedMotion ? 0 : o.sparks ?? 0;
    s.feed = 0;
    s.e.render!.meshInstances[2].visible = s.fire;
    s.e.render!.meshInstances[3].visible = s.fire;
    const C = F.colours;
    this.glowColour(s.rim, o.rim ?? C.rim);
    this.glowColour(s.streak, o.rim ?? C.streak);
    this.glowColour(s.wash, o.wash ?? C.wash);
    s.e.setPosition(pos.x, pos.y + 0.02, pos.z);
    s.e.setEulerAngles(0, 0, 0);
    s.e.setLocalScale(s.r0, 1, s.r0);
    s.cy = this.groundAt?.(pos.x, pos.z) ?? pos.y;
    s.e.setPosition(pos.x, s.cy, pos.z);
    s.turn = Math.random() * 360;
    s.streaks.setLocalEulerAngles(0, s.turn, 0);
    this.layOnGround(s, s.r0);
    for (const m of [s.wash, s.rim, s.streak, s.veil, s.spiral]) {
      m.opacity = 0;
      m.update();
    }
    s.e.enabled = s.delay <= 0;
  }

  private glowColour(m: pc.StandardMaterial, hex: string) {
    m.emissive = color(hex);
  }

  /** A flash of real light at `pos`: `peak` intensity, `range` tiles, fading over `dur` seconds. */
  flash(pos: pc.Vec3, peak: number, range: number, dur: number, hex: string = LOOK.pulseFx.colours.wash, grow = 0) {
    const f = this.flashes.find((x) => !x.active) ?? this.flashes[0];
    f.active = true;
    f.life = 0;
    f.max = dur;
    f.peak = peak;
    f.range = range;
    f.grow = grow;
    const l = f.e.light!;
    l.range = range;
    l.intensity = 0;
    l.color = color(hex);
    f.e.setPosition(pos.x, pos.y, pos.z);
    f.e.enabled = true;
  }

  /**
   * VFX 1: the magic in it: `count` wisps of light (and a few petals) spiralling round `centre` inside a pulse of
   * radius `R`, rising as they circle and their circles opening out, for about `dur` seconds.
   */
  swirl(centre: pc.Vec3, R: number, count: number, dur: number) {
    if (this.reducedMotion) return;
    const C = LOOK.pulseFx.colours;
    const n = Math.round(count * this.density);
    const turn = Math.random() < 0.5 ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const p = this.free();
      if (!p) return;
      const petal = i % 5 === 4;
      const r0 = 0.3 + Math.random() * 0.5;
      this.spawn(p, centre.x, centre.y, centre.z);
      p.swirl = true;
      p.ox = centre.x;
      p.oz = centre.z;
      p.orad = r0;
      p.ang = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.4;
      p.angV = turn * (3.2 + Math.random() * 2.6) * (petal ? 0.7 : 1);
      p.max = dur * (0.6 + Math.random() * 0.6);
      p.radV = ((R * (0.35 + Math.random() * 0.55)) - r0) / p.max;
      p.y = centre.y + 0.05 + Math.random() * 0.4;
      p.vy = 0.35 + Math.random() * 0.9;
      p.gravity = 0;
      p.size = petal ? 0.08 + Math.random() * 0.03 : 0.04 + Math.random() * 0.04;
      p.spin = petal ? 200 : 420;
      p.glow = petal ? 0.4 : 1;
      p.twinkle = !petal;
      p.color = this.rgb(petal ? PETALS[i % PETALS.length] : [C.rim, C.streak, PALETTE.pure.white, PALETTE.flowerCore][i % 4]);
    }
  }

  private megaFeed = 0;

  /**
   * VFX 1: a Mega Pulse building while it is held (call every frame; it stops when the calls stop): rings spin round
   * Bloombot's middle (`core`), tightening and speeding up, motes stream in to it from all round the circle it will
   * heal (`radius` from `feet`), and it glows brighter. `k` 0 … 1 is how far the hold has got.
   */
  megaCharge(feet: pc.Vec3, core: pc.Vec3, radius: number, k: number, dt: number) {
    if (this.charge < 0) this.chargeDir = Math.random() < 0.5 ? -1 : 1;
    this.charge = k;
    this.chargeSeen = this.clock;
    this.chargeAt.copy(core);
    if (this.reducedMotion) return;
    this.megaFeed += dt * (10 + 50 * k) * this.density;
    for (; this.megaFeed >= 1; this.megaFeed--) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.max(1.2, radius * (0.45 + 0.55 * Math.random()));
      const from = new pc.Vec3(feet.x + Math.cos(a) * r, feet.y + 0.12 + Math.random() * 0.3, feet.z + Math.sin(a) * r);
      const hex = Math.random() < 0.3 ? PALETTE.pure.white : Math.random() < 0.5 ? PALETTE.botPulse : PALETTE.botGlow;
      this.mote(from, core, hex, 0.3 + 0.35 * (1 - k) + Math.random() * 0.15, 0.05);
    }
    if (Math.random() < dt * (2 + 10 * k)) this.sparkles(new pc.Vec3(feet.x, feet.y, feet.z), 1);
    // ribbons of light spiralling in from the edge of the circle, ever more of them, and an orb of magic churning round
    // Bloombot, growing as the power builds
    const B = LOOK.pulseFx.ribbons;
    this.ribbonFeed += dt * (B.chargeRate + B.chargeRamp * k) * this.density;
    for (; this.ribbonFeed >= 1; this.ribbonFeed--) {
      const a0 = Math.random() * Math.PI * 2;
      const r0 = Math.max(1.2, radius * (0.6 + 0.4 * Math.random()));
      const dir = this.chargeDir;
      const gy = feet.y + 0.05;
      const cx = core.x;
      const cy = core.y;
      const cz = core.z;
      this.tendril((t, out) => {
        const e = t * t * (3 - 2 * t);
        const a = a0 + dir * 0.6 * Math.PI * 2 * e;
        const r = r0 * (1 - e);
        out.set(cx + Math.cos(a) * r, gy + (cy - gy) * Math.pow(e, 1.6), cz + Math.sin(a) * r);
      }, 0.45 + 0.25 * (1 - k) + Math.random() * 0.15, { width: B.width * 0.85, tail: Math.random() < 0.5 ? LOOK.pulseFx.colours.wash : LOOK.pulseFx.colours.gold, shed: B.shed * 0.5 });
    }
    this.orbFeed += dt * 4;
    for (; this.orbFeed >= 1; this.orbFeed--) this.cloud.orb(core, B.orb + B.orbGrow * k, 0.7, 0.5 + 0.9 * k);
    // and wisps circling Bloombot ever faster, closing in
    if (Math.random() < dt * (4 + 18 * k)) {
      const p = this.free();
      if (p) {
        this.spawn(p, feet.x, feet.y, feet.z);
        p.swirl = true;
        p.ox = feet.x;
        p.oz = feet.z;
        p.orad = 1.4 + Math.random() * 0.6;
        p.ang = Math.random() * Math.PI * 2;
        p.angV = 4 + 8 * k;
        p.max = 0.9;
        p.radV = -(p.orad - 0.25) / p.max;
        p.y = feet.y + 0.1 + Math.random() * 0.3;
        p.vy = (core.y - p.y) / p.max;
        p.gravity = 0;
        p.size = 0.05;
        p.spin = 400;
        p.glow = 1;
        p.color = this.rgb(Math.random() < 0.5 ? LOOK.pulseFx.colours.rim : LOOK.pulseFx.colours.streak);
      }
    }
  }

  /**
   * VFX 1: the Mega Pulse bursts from Bloombot's middle (`core`, up in the air): a sphere of sparks, its charge rings
   * blown outward, a big flash, bolts of light flung down onto the ground, then from `centre` (the middle of the ground
   * it heals) out to `R`, over that ground alone (`inside`): a cloud of magic, tendrils curling up through it and
   * `M.waves` waves of fire, the first taking `seconds` (the ground turns green as its rim passes), with leaves carried
   * out on it.
   */
  megaBurst(core: pc.Vec3, centre: pc.Vec3, R: number, seconds: number, inside?: (x: number, z: number) => boolean) {
    const feet = centre;
    const M = LOOK.pulseFx.mega;
    this.charge = -1;
    this.chargeSeen = -1;
    this.flash(core, M.light.intensity, Math.max(6, R * M.light.range), M.light.seconds);
    this.ring(core, PALETTE.botPulse, 2.6, 0.45, 0.6);
    this.ring(core, PALETTE.gold, 2, 0.5, 0.5);
    const rm = this.reducedMotion;
    const n = Math.round((rm ? 12 : M.sparks) * this.density);
    const tones = [PALETTE.botPulse, PALETTE.pure.white, PALETTE.gold, PALETTE.botGlow];
    for (let i = 0; i < n; i++) {
      const p = this.free();
      if (!p) break;
      // even directions over a sphere, a little flattened, so most fly outward rather than straight up or down
      const y = 1 - (2 * (i + 0.5)) / n;
      const ring = Math.sqrt(1 - y * y);
      const a = i * 2.399963;
      const sp = rm ? 0.8 : 2.6 + Math.random() * 2.2;
      this.spawn(p, core.x, core.y, core.z);
      p.vx = Math.cos(a) * ring * sp;
      p.vz = Math.sin(a) * ring * sp;
      p.vy = y * sp * 0.7 + 0.6;
      p.max = 0.8 + Math.random() * 0.6;
      p.size = 0.07 + Math.random() * 0.05;
      p.spin = 360;
      p.gravity = 1.6;
      p.glow = 1;
      p.twinkle = !rm;
      p.color = this.rgb(tones[i % tones.length]);
    }
    const X = LOOK.pulseFx.extra;
    this.onSurge?.(M.surge, M.surgeSeconds);
    this.swirl(feet, R, M.swirl, seconds * 1.4);
    this.shockwave(feet, R, { dur: seconds, strength: 1.3, veil: M.veil, sparks: X.sparks * R * 1.6, inside });
    if (rm) return;
    if (M.waves > 1) this.shockwave(feet, R * 0.8, { delay: 0.12, dur: seconds * 0.9, strength: 0.9, rim: LOOK.pulseFx.colours.gold, inside });
    if (M.waves > 2) this.shockwave(feet, R * 0.55, { delay: 0.3, dur: seconds * 0.8, strength: 0.7, inside });
    this.carry(feet, R, seconds, M.leaves);
    this.cloud.burst(feet, R, 1.3, inside);
    const B = LOOK.pulseFx.ribbons;
    this.vortex(feet, R, Math.round(B.megaTendrils * Math.max(0.5, this.density)), B.megaRise, seconds * 0.9, inside);
    // bolts flung out of Bloombot down onto the ground all round
    const nb = Math.round(B.megaBolts * Math.max(0.5, this.density));
    const a0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < nb; i++) {
      let a = a0 + (i / nb) * Math.PI * 2;
      let r = R * (0.45 + 0.4 * Math.random());
      for (let t = 0; t < 8 && inside && !inside(centre.x + Math.cos(a) * r, centre.z + Math.sin(a) * r); t++) {
        a = Math.random() * Math.PI * 2;
        r = R * (0.2 + 0.6 * Math.random());
      }
      const land = new pc.Vec3(centre.x + Math.cos(a) * r, (this.groundAt?.(centre.x + Math.cos(a) * r, centre.z + Math.sin(a) * r) ?? centre.y) + 0.06, centre.z + Math.sin(a) * r);
      this.after(i * 0.015, () => this.tendril(this.boltPath(core, land, (Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 0.6), 0.28 + Math.random() * 0.1, { width: B.width * 1.3, tail: i % 2 ? LOOK.pulseFx.colours.gold : LOOK.pulseFx.colours.wash, shed: B.shed }));
    }
  }

  /** The Mega Pulse's charge rings and glow, while megaCharge() is being called. */
  private updateCharge(dt: number) {
    const on = this.charge >= 0 && this.clock - this.chargeSeen < 0.12;
    if (!on) {
      if (this.charge >= 0) this.charge = -1;
      for (const o of this.orbits) o.e.enabled = false;
      this.chargeLight.enabled = false;
      this.megaFeed = 0;
      return;
    }
    const k = this.charge;
    const at = this.chargeAt;
    const l = this.chargeLight;
    l.enabled = true;
    l.setPosition(at.x, at.y, at.z);
    // it flickers a little as the power nears full
    l.light!.intensity = LOOK.pulseFx.mega.chargeLight * Math.pow(k, 1.4) * (1 + (k > 0.7 ? 0.15 * Math.sin(this.clock * 40) : 0));
    l.light!.range = 2 + 3.5 * k;
    if (this.reducedMotion) return;
    this.chargeSpin += dt * (90 + 600 * k * k);
    this.orbits.forEach((o, i) => {
      o.e.enabled = true;
      o.e.setPosition(at.x, at.y, at.z);
      o.e.setEulerAngles(0, i ? this.chargeSpin : -this.chargeSpin * 1.3, 0);
      o.e.rotateLocal(i ? 62 : -55, 0, 0);
      const s = 0.6 - 0.22 * k;
      o.e.setLocalScale(s, 1, s);
      o.m.opacity = Math.min(1, 0.15 + k);
      o.m.update();
    });
  }

  ring(pos: pc.Vec3, hex: string, r1 = 1.2, dur = 0.6, r0 = 0.1) {
    const r = this.rings.find((x) => !x.active) ?? this.rings[0];
    r.active = true;
    r.life = 0;
    r.max = dur;
    r.r0 = r0;
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
  restoreBloom(pos: pc.Vec3, strength = 1, wave = true) {
    const rm = this.reducedMotion;
    this.sparkles(pos, Math.round(9 * strength), rm);
    if (rm) return;
    if (wave) this.restoreWave(pos, strength);
    this.petals(pos, strength);
  }

  /** Look 3.14: a restore's neon shockwave sweeping over the neighbouring tiles. */
  private restoreWave(pos: pc.Vec3, strength: number) {
    const w = this.waves.find((x) => !x.active) ?? this.waves[0];
    w.active = true;
    w.life = 0;
    w.max = 0.6;
    w.r0 = 0.3;
    w.r1 = 0.9 + 0.4 * strength;
    // above the raised paving round the tile (up to ~6 cm over the slab), so the wave doesn't run under the pavers
    w.e.setPosition(pos.x, pos.y + 0.075, pos.z);
    w.e.setLocalScale(w.r0, 1, w.r0);
    w.m.opacity = 0;
    w.m.update();
    w.e.enabled = true;
  }

  /** Look 3.14: a few petals drifting down after a restore. */
  private petals(pos: pc.Vec3, strength: number) {
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

  /**
   * #784: Bloombot charging: glowing gold and mint motes drifting up off it (bigger and slower than ground sparkles,
   * so it reads from the play camera), plus a twinkle. Calm, no fall, with reduced motion.
   */
  chargeSparkle(pos: pc.Vec3, count: number) {
    const rm = this.reducedMotion;
    for (let i = 0; i < count; i++) {
      const hex = i % 2 ? PALETTE.signal.chargeSparkMint : PALETTE.signal.chargeSpark;
      this.burst(pos, 1, { up: rm ? 0.5 : 0.9, speed: rm ? 0.08 : 0.35, size: 0.09, life: rm ? 1 : 1.3, gravity: -0.3, hex, glow: 1 });
    }
    this.sparkles(pos, 1, rm);
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
    p.leaf = false;
    p.swirl = false;
  }

  /** A real canopy leaf, reusing the pooled particle mesh. */
  fallingLeaf(x: number, y: number, z: number, ground: number, rgb: [number, number, number]) {
    if (this.reducedMotion) return;
    const p = this.free();
    if (!p) return;
    this.spawn(p, x, y, z);
    p.leaf = p.float = true;
    p.vx = 0;
    p.vy = -0.18;
    p.vz = 0;
    p.gravity = 0.2;
    p.max = Math.min(2.4 + Math.random() * 1.3, (y - ground) / 0.30);
    p.size = 0.065 + Math.random() * 0.035;
    p.spin = (Math.random() < 0.5 ? -1 : 1) * (65 + Math.random() * 85);
    p.color = rgb;
    p.glow = 0;
  }

  /**
   * `push` adds a velocity to every bit; `fan` throws each one out along that axis, either way at random up to its
   * length (#628: dust thrown out to Bloombot's sides, where the follow camera sees it).
   */
  burst(pos: pc.Vec3, count: number, opts: { speed?: number; up?: number; size?: number; life?: number; gravity?: number; hex?: string; glow?: number; push?: pc.Vec3; fan?: pc.Vec3 } = {}) {
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
      if (opts.push) {
        p.vx += opts.push.x;
        p.vy += opts.push.y;
        p.vz += opts.push.z;
      }
      if (opts.fan) {
        const f = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
        p.vx += opts.fan.x * f;
        p.vy += opts.fan.y * f;
        p.vz += opts.fan.z * f;
      }
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
  private updateParticles(dt: number, wind: number) {
    let any = false;
    const P = this.pPos;
    const N = this.pNrm;
    const C = this.pCol;
    this.particles.forEach((p, i) => {
      const base = i * 6;
      let s = 0;
      if (p.active) {
        p.life += dt;
        if (p.life >= p.max || (p.leaf && this.reducedMotion)) p.active = false;
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
          if (p.swirl) {
            // a wisp: round and round its centre, rising, its circle opening out
            p.ang += p.angV * dt;
            p.orad = Math.max(0.05, p.orad + p.radV * dt);
            p.x = p.ox + Math.cos(p.ang) * p.orad;
            p.z = p.oz + Math.sin(p.ang) * p.orad;
            p.y += p.vy * dt;
          } else {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
          }
          if (p.leaf) {
            const glide = (0.16 + wind * 0.50) * (0.85 + 0.15 * Math.sin(p.life * 3 + i)) * dt;
            p.x += WIND_X * glide;
            p.z += WIND_Z * glide;
          }
          p.rot += (p.spin * Math.PI * dt) / 180;
          const k = 1 - p.life / p.max;
          s = p.size * Math.min(1, k * 3) * 0.6;
          if (p.twinkle) s *= 0.65 + 0.35 * Math.sin(p.life * 38 + i);
        }
      }
      const c = Math.cos(p.rot);
      const sn = Math.sin(p.rot);
      const ga = Math.round(p.glow * 255);
      const tilt = p.leaf ? p.life * 3.5 + i : 0;
      const tiltCos = p.leaf ? Math.cos(tilt) : 1, tiltSin = p.leaf ? Math.sin(tilt) : 0;
      for (let v = 0; v < 6; v++) {
        const [ox, oy, oz] = OCT[v];
        // spin around Y, flatten a little so they read as leaves/petals
        const x = p.leaf ? ox * 1.45 : ox;
        const y = oy * (p.leaf ? 0.14 : 0.5);
        const z = p.leaf ? oz * 0.63 : oz;
        const rolled = z * tiltCos + y * tiltSin;
        const rx = x * c - rolled * sn;
        const rz = x * sn + rolled * c;
        const j = (base + v) * 3;
        P[j] = p.x + rx * s;
        P[j + 1] = p.y + (y * tiltCos - z * tiltSin) * s;
        P[j + 2] = p.z + rz * s;
        const normalZ = oz * tiltCos + oy * tiltSin;
        N[j] = ox * c - normalZ * sn;
        N[j + 1] = oy * tiltCos - oz * tiltSin;
        N[j + 2] = ox * sn + normalZ * c;
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

  update(dt: number, wind = 0) {
    this.updateParticles(dt, wind);
    this.updateRibbons(dt);
    this.cloud.update(dt);
    this.clock += dt;
    for (let i = this.soon.length - 1; i >= 0; i--) {
      const s = this.soon[i];
      if (s.at > this.clock) continue;
      this.soon.splice(i, 1);
      s.run();
    }
    for (const s of this.shocks) {
      if (!s.active) continue;
      if (s.delay > 0) {
        s.delay -= dt;
        if (s.delay > 0) continue;
        s.e.enabled = true;
      }
      s.life += dt;
      const k = s.life / s.max;
      if (k >= 1) {
        s.active = false;
        s.e.enabled = false;
        continue;
      }
      const e = 1 - Math.pow(1 - k, LOOK.pulseFx.front.ease);
      const rad = s.r0 + (s.r1 - s.r0) * e;
      s.e.setLocalScale(rad, 1, rad);
      const fade = Math.min(1, k * 14) * Math.pow(1 - k, 0.75) * s.strength;
      s.wash.opacity = Math.min(0.85, 0.75 * fade * (1 - 0.5 * k));
      s.rim.opacity = Math.min(1, fade);
      s.streak.opacity = Math.min(1, fade * (0.5 + 0.5 * (1 - k)));
      // the curtain stands tall as the wave breaks and sinks as it spreads
      s.veil.opacity = Math.min(1, fade * (1 - 0.55 * k));
      s.spiral.opacity = Math.min(1, fade * (1 - 0.3 * k));
      s.wash.update();
      s.rim.update();
      s.streak.update();
      s.veil.update();
      s.spiral.update();
      if (s.spin) {
        s.turn += s.spin * dt;
        s.streaks.setLocalEulerAngles(0, s.turn, 0);
      }
      this.layOnGround(s, rad);
      if (s.sparks > 0) {
        s.feed += dt * s.sparks * this.density * (1 - k) * Math.min(1, s.strength);
        const at = s.e.getPosition();
        const C = LOOK.pulseFx.colours;
        for (; s.feed >= 1; s.feed--) {
          const p = this.free();
          if (!p) break;
          const a = Math.random() * Math.PI * 2;
          const r = rad * (0.82 + Math.random() * 0.16);
          const gx = at.x + Math.cos(a) * r;
          const gz = at.z + Math.sin(a) * r;
          const gy = this.groundAt ? this.groundAt(gx, gz) : at.y;
          if (gy === undefined || Math.abs(gy - s.cy) > 0.1 || (s.inside && !s.inside(gx, gz))) continue;
          this.spawn(p, gx, gy + 0.04, gz);
          p.vx = Math.cos(a) * 0.15;
          p.vz = Math.sin(a) * 0.15;
          p.vy = 0.5 + Math.random() * 1.1;
          p.gravity = -0.3;
          p.max = 0.7 + Math.random() * 0.7;
          p.size = 0.045 + Math.random() * 0.04;
          p.spin = 300;
          p.glow = 1;
          p.twinkle = true;
          const roll = Math.random();
          p.color = this.rgb(roll < 0.35 ? C.rim : roll < 0.7 ? C.streak : roll < 0.85 ? PALETTE.pure.white : PALETTE.flowerCore);
        }
      }
    }
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.life += dt;
      const k = f.life / f.max;
      if (k >= 1) {
        f.active = false;
        f.e.enabled = false;
        continue;
      }
      // a quick rise, then a long fall
      const env = k < 0.08 ? k / 0.08 : Math.pow(1 - (k - 0.08) / 0.92, 2);
      f.e.light!.intensity = f.peak * env;
      // a light spreading with a wave reaches out as its rim does (the same curve), and holds while it fades
      if (f.grow > 0) f.e.light!.range = Math.max(0.6, f.range * (1 - Math.pow(1 - Math.min(1, f.life / f.grow), LOOK.pulseFx.front.ease)));
    }
    this.updateCharge(dt);
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
