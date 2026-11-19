import * as pc from 'playcanvas';
import { group, shape } from './Shapes';
import { color, mat, PALETTE } from './Materials';

interface Face {
  root: pc.Entity;
  eyes: pc.Entity[];
  sparkles: pc.Entity[];
  /** 0 = asleep (eyes are little lines) … 1 = wide awake */
  open: number;
  /** grows in when the sky wakes up (songbirds have arrived) */
  shown: number;
  awake: boolean;
  timer: number;
}

interface Rain {
  drops: pc.Entity[];
  phase: number[];
  /** 0…1, ramps in and out */
  amount: number;
  raining: boolean;
  timer: number;
}

interface Cloud {
  root: pc.Entity;
  shadow: pc.Entity;
  face?: Face;
  rain?: Rain;
  /** home in the layer, in units of the layer's half-size (−1…1 across, −1…1 in depth) */
  u: number;
  w: number;
  /** height offset (layer units) and size (fraction of the view height) */
  y: number;
  size: number;
  bob: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = pc.math.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrap = (v: number) => ((((v + 1) % 2) + 2) % 2) - 1;

interface Puff {
  pos: [number, number, number];
  /** radii (an ellipsoid) */
  r: [number, number, number];
}

/**
 * One cloud: a wide soft base with round puffs bunched around and on top of it, front to back, so it is a real
 * 3D blob. Local frame: +z faces the camera (horizontally), +y up.
 */
const PUFFS: Puff[] = [
  { pos: [0, 0.05, 0], r: [1.3, 0.48, 0.9] }, // base
  { pos: [0, 0.52, 0.22], r: [0.66, 0.66, 0.66] }, // the big front puff (the face)
  { pos: [0.18, 0.8, -0.32], r: [0.6, 0.6, 0.6] }, // crown, behind
  { pos: [-0.62, 0.62, -0.18], r: [0.42, 0.42, 0.42] },
  { pos: [-0.8, 0.32, 0.18], r: [0.5, 0.5, 0.5] },
  { pos: [0.84, 0.36, 0.12], r: [0.53, 0.53, 0.53] },
  { pos: [0.62, 0.66, -0.12], r: [0.36, 0.36, 0.36] },
  { pos: [-0.5, 0.4, -0.55], r: [0.45, 0.45, 0.45] },
  { pos: [0.7, 0.3, -0.58], r: [0.42, 0.42, 0.42] },
  { pos: [-1.32, 0.12, -0.02], r: [0.32, 0.32, 0.32] },
  { pos: [1.38, 0.16, -0.08], r: [0.3, 0.3, 0.3] },
  { pos: [0.35, 0.22, 0.6], r: [0.38, 0.38, 0.38] },
  { pos: [-0.38, 0.2, 0.58], r: [0.34, 0.34, 0.34] },
];

const hexLin = (hex: string) => {
  const c = new pc.Color();
  c.fromString(hex);
  return [c.r, c.g, c.b];
};
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * A smooth puff whose soft "animated film" shading is baked into its vertex colours: a wrapped sun term (warm
 * cream where the sun hits, lavender-blue in the shade, never black), cooler toward the cloud's belly, and a bright
 * silver rim where the surface turns away from the camera. The camera's yaw never changes and its pitch only
 * moves 25–40°, so view-dependent terms bake fine.
 */
function puffMesh(device: pc.GraphicsDevice, p: Puff, sunWorld: pc.Vec3, bands: [number, number] = [18, 26]): pc.Mesh {
  const m = pc.Mesh.fromGeometry(device, puffGeometry(p, sunWorld, bands));
  m.incRefCount();
  return m;
}

/**
 * E23.8.3.3 (#453): a whole cloud's puffs as one mesh, each puff at its place: one draw call a cloud, not one a
 * puff (the shading is baked per vertex, so nothing is lost).
 */
function cloudMesh(device: pc.GraphicsDevice, sunWorld: pc.Vec3): pc.Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const p of PUFFS) {
    const g = puffGeometry(p, sunWorld);
    const base = positions.length / 3;
    const pos = g.positions!;
    for (let i = 0; i < pos.length; i += 3) positions.push(pos[i] + p.pos[0], pos[i + 1] + p.pos[1], pos[i + 2] + p.pos[2]);
    normals.push(...g.normals!);
    colors.push(...g.colors!);
    uvs.push(...(g.uvs ?? new Array((pos.length / 3) * 2).fill(0)));
    for (const k of g.indices!) indices.push(base + k);
  }
  const m = new pc.Mesh(device);
  m.setPositions(positions);
  m.setNormals(normals);
  m.setColors32(colors);
  m.setUvs(0, uvs);
  m.setIndices(indices);
  m.update();
  m.incRefCount();
  return m;
}

function puffGeometry(p: Puff, sunWorld: pc.Vec3, bands: [number, number] = [18, 26]): pc.Geometry {
  const g = new pc.SphereGeometry({ radius: 1, latitudeBands: bands[0], longitudeBands: bands[1] });
  const pos = g.positions!;
  const n = pos.length / 3;
  // Into the cloud's frame (rotated by the camera yaw, 45°): to-sun and to-camera directions.
  const yr = (45 * Math.PI) / 180;
  const sx = sunWorld.x * Math.cos(yr) - sunWorld.z * Math.sin(yr);
  const sz = sunWorld.x * Math.sin(yr) + sunWorld.z * Math.cos(yr);
  const sun = new pc.Vec3(sx, Math.max(0.35, sunWorld.y), sz).normalize();
  const view = new pc.Vec3(0, Math.sin((36 * Math.PI) / 180), Math.cos((36 * Math.PI) / 180));
  const cSun = hexLin(PALETTE.sky.cloudSun);
  const cLit = hexLin(PALETTE.sky.cloud);
  const cShade = hexLin(PALETTE.sky.cloudShade);
  const cBelly = hexLin(PALETTE.sky.cloudBelly);
  const cRim = hexLin(PALETTE.sky.cloudRim);
  const colors: number[] = new Array(n * 4);
  const nrm = new pc.Vec3();
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    pos[i * 3] = x * p.r[0];
    pos[i * 3 + 1] = y * p.r[1];
    pos[i * 3 + 2] = z * p.r[2];
    nrm.set(x / p.r[0], y / p.r[1], z / p.r[2]).normalize();
    const d = nrm.dot(sun);
    const lit = smooth(-0.55, 0.85, d);
    // Height in the cloud: bellies are cool, crowns bright.
    const h = pc.math.clamp((p.pos[1] + y * p.r[1] + 0.25) / 1.6, 0, 1);
    let c = mix(cShade, cLit, pc.math.clamp(lit * 0.8 + h * 0.35, 0, 1));
    c = mix(c, cSun, smooth(0.45, 1, d) * 0.55);
    c = mix(c, cBelly, smooth(-0.2, -0.85, nrm.y) * 0.6);
    const rim = Math.pow(1 - Math.max(0, nrm.dot(view)), 3);
    c = mix(c, cRim, rim * 0.55);
    // sRGB → linear bytes, as vcMesh does for every vertex-coloured mesh.
    for (let k = 0; k < 3; k++) colors[i * 4 + k] = Math.round(Math.pow(pc.math.clamp(c[k], 0, 1), 2.2) * 255);
    colors[i * 4 + 3] = 255;
  }
  g.positions = pos;
  g.colors = colors;
  return g;
}

/**
 * Region unlocks' cloud wall: the same soft puffs at a lower resolution (the wall has many clouds), the first
 * `count` of them (base, face puff, crown and the biggest sides), with the shared unlit material.
 */
export function wallCloudParts(device: pc.GraphicsDevice, sunWorld: pc.Vec3, count = 8): { meshes: { mesh: pc.Mesh; pos: [number, number, number] }[]; material: pc.Material } {
  return { meshes: PUFFS.slice(0, count).map((p) => ({ mesh: puffMesh(device, p, sunWorld, [9, 14]), pos: p.pos })), material: softMaterial() };
}

/** Unlit: the shading is all in the vertex colours, so the clouds stay soft and bright whatever the scene light. */
let softMat: pc.StandardMaterial | undefined;
function softMaterial(): pc.StandardMaterial {
  if (softMat) return softMat;
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(1, 1, 1);
  m.emissiveVertexColor = true;
  m.update();
  softMat = m;
  return m;
}

/**
 * E23.7.1: tints every soft cloud (the sky's clouds and the cloud walls) by the time of day: warm at dusk, a dim
 * blue at night. The clouds are unlit, so the light alone can't do it. Cheap: one shared material.
 */
export function tintClouds(r: number, g: number, b: number) {
  const m = softMaterial();
  const e = m.emissive;
  if (Math.abs(e.r - r) + Math.abs(e.g - g) + Math.abs(e.b - b) < 0.004) return;
  m.emissive = new pc.Color(r, g, b);
  m.update();
}

/** A soft top-down footprint of the puffs (blurred), used as the cloud's shadow. */
function shadowTexture(device: pc.GraphicsDevice): pc.Texture {
  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  g.filter = 'blur(7px)';
  g.fillStyle = PALETTE.pure.white;
  // Footprint space: x and z in −2…2 across the canvas.
  const k = N / 4;
  for (const p of PUFFS) {
    g.beginPath();
    g.ellipse(N / 2 + p.pos[0] * k, N / 2 + p.pos[2] * k, p.r[0] * k * 0.92, p.r[2] * k * 0.92, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new pc.Texture(device, { width: N, height: N, format: pc.PIXELFORMAT_RGBA8, mipmaps: true, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
  t.setSource(cv);
  return t;
}

const SHADOW_Y = 0.35; // just over the ground slabs: flat ground and low props darken, buildings stand out of it
const RAIN_FALL = 2.8; // how far (cloud units) a drop falls before it is gone
const FACES = [0, 3];
const RAINY = [2, 4];

/**
 * A few puffy clouds that drift between the camera and the city when the view is zoomed out (gone close up).
 * They live in a layer a little in front of the target, sized from the view height so they read the same at any
 * zoom, anchored to the world (panning slides them with a touch of parallax) and wrapping around the view; each
 * one puffs up from nothing as you zoom out and shrinks away near the layer's edges, so nothing ever pops.
 *
 * - Shadows: the clouds float far above the city (near the camera), so a true sun shadow would land well off
 *   screen. Each cloud instead lays a soft shadow of its own footprint on the ground just below it on screen.
 * - Faces: two clouds have sleepy faces that only appear once songbirds have arrived (the sky wakes up with the
 *   park); now and then one opens its eyes, blinks, and dozes off again.
 * - Rain: two faceless clouds now and then sprinkle a short shower of little drops.
 *
 * Purely cosmetic: never picked, made once, no per-frame allocation; still (no drift, rain or blinking) with
 * reduced motion.
 */
export class Clouds {
  private root: pc.Entity;
  private clouds: Cloud[] = [];
  private wind = 0;
  /** E23.7.2: the weather's wind, 0 … 1 (the clouds drift faster) */
  gust = 0;
  private t = 0;
  private right = new pc.Vec3();
  private back = new pc.Vec3();
  private center = new pc.Vec3();
  private pos = new pc.Vec3();
  private ray = new pc.Vec3();
  reducedMotion = false;
  /** the sky has woken up (songbirds have arrived): sleepy faces appear on a couple of clouds */
  happy = false;
  /** zoom at/above which there are no clouds, and at/below which they are full size */
  showBelow = 0.62;
  fullBelow = 0.34;

  /** `sunUp`: the sun light's up vector (the direction toward the sun); the camera yaw is fixed, so it is baked. */
  constructor(parent: pc.Entity, device: pc.GraphicsDevice, sunUp: pc.Vec3) {
    this.root = group(parent, 'clouds');
    this.root.enabled = false;
    const face = mat(PALETTE.sky.cloudFace, { unlit: true });
    const blush = mat(PALETTE.sky.cloudBlush, { unlit: true });
    const sparkle = mat(PALETTE.sky.cloudSparkle, { unlit: true });
    const drop = mat(PALETTE.sky.cloudRain, { unlit: true });
    const soft = softMaterial();
    const shadowMat = new pc.StandardMaterial();
    shadowMat.useLighting = false;
    shadowMat.diffuse = new pc.Color(0, 0, 0);
    shadowMat.emissive = color(PALETTE.sky.cloudShadow);
    shadowMat.opacityMap = shadowTexture(device);
    shadowMat.opacityMapChannel = 'a';
    shadowMat.opacity = 0.42;
    shadowMat.blendType = pc.BLEND_NORMAL;
    shadowMat.depthWrite = false;
    shadowMat.update();
    // Each puff's shading is baked into the vertices; a cloud's puffs are one mesh (shared by every cloud).
    const whole = cloudMesh(device, sunUp);
    // Hand-placed so the view never has a clump or a hole.
    const homes: [number, number, number, number][] = [
      [-0.72, 0.38, 0.2, 0.3],
      [0.05, 0.62, -0.1, 0.24],
      [0.68, 0.18, 0.15, 0.34],
      [-0.25, -0.05, 0.0, 0.22],
      [0.4, -0.45, -0.2, 0.28],
      [-0.9, -0.55, 0.1, 0.25],
      [0.95, 0.85, 0.0, 0.2],
    ];
    homes.forEach(([u, w, y, size], i) => {
      const r = group(this.root, 'cloud');
      const body = group(r, 'body');
      const puffs = new pc.Entity('puffs');
      puffs.addComponent('render', { meshInstances: [new pc.MeshInstance(whole, soft)], castShadows: false, receiveShadows: false });
      body.addChild(puffs);
      const shadow = shape(this.root, 'plane', shadowMat, { name: 'cloudShadow', receive: false });
      const c: Cloud = { root: r, shadow, u, w, y, size, bob: i * 1.7 };
      if (FACES.includes(i)) {
        // A sleepy little face on the front of the big puff, tipped up toward the camera.
        const f = group(body, 'face', [0, 0.9, 0.74]);
        f.setLocalEulerAngles(-35, 0, 0);
        const eyes: pc.Entity[] = [];
        const sparkles: pc.Entity[] = [];
        for (const sd of [-1, 1]) {
          eyes.push(shape(f, 'sphere', face, { pos: [sd * 0.17, 0.02, 0], scale: [0.09, 0.014, 0.04] }));
          sparkles.push(shape(f, 'sphere', sparkle, { pos: [sd * 0.17 + 0.022, 0.045, 0.02], scale: 0.026 }));
          shape(f, 'sphere', blush, { pos: [sd * 0.32, -0.08, -0.02], scale: [0.13, 0.07, 0.04] });
        }
        shape(f, 'sphere', face, { pos: [0, -0.07, 0.005], scale: [0.06, 0.035, 0.03] });
        f.enabled = false;
        c.face = { root: f, eyes, sparkles, open: 0, shown: 0, awake: false, timer: 3 + i * 2.5 };
      }
      if (RAINY.includes(i)) {
        const drops: pc.Entity[] = [];
        const phase: number[] = [];
        for (let d = 0; d < 14; d++) {
          // A little teardrop: a round drop with a pointed top.
          const g = group(r, 'drop');
          shape(g, 'sphere', drop, { scale: [0.11, 0.13, 0.11] });
          shape(g, 'cone', drop, { pos: [0, 0.09, 0], scale: [0.095, 0.1, 0.095] });
          g.setLocalPosition(((d * 0.618) % 1) * 2.2 - 1.1, -0.3, ((d * 0.382) % 1) * 1.1 - 0.55);
          g.enabled = false;
          drops.push(g);
          phase.push(((d * 0.7548) % 1) * RAIN_FALL);
        }
        c.rain = { drops, phase, amount: 0, raining: false, timer: 4 + i * 3 };
      }
      this.clouds.push(c);
    });
  }

  /** Follows the camera: `zoom`, its position and forward, the distance to the target and the view height there. */
  update(dt: number, cam: { zoom: number; yaw: number; dist: number; viewHeight: number; aspect: number; position: pc.Vec3; forward: pc.Vec3 }) {
    const k = 1 - smooth(this.fullBelow, this.showBelow, cam.zoom);
    if (k <= 0.001) {
      this.root.enabled = false;
      return;
    }
    this.root.enabled = true;
    const still = this.reducedMotion;
    if (!still) {
      this.wind += dt * 0.012 * (1 + this.gust * 4);
      this.t += dt;
    }
    const vh = cam.viewHeight;
    // The layer: a little in front of the target (well past the near clip, which sits ~2.2 view heights closer).
    const depth = cam.dist - vh * 1.25;
    this.center.copy(cam.forward).mulScalar(depth).add(cam.position);
    const yr = (cam.yaw * Math.PI) / 180;
    this.right.set(Math.cos(yr), 0, -Math.sin(yr));
    this.back.set(Math.sin(yr), 0, Math.cos(yr));
    const wx = vh * Math.max(1, cam.aspect) * 1.35;
    const wz = vh * 1.05;
    const cu = this.center.dot(this.right) / wx;
    const cw = this.center.dot(this.back) / wz;
    const cp = cam.position;
    for (const c of this.clouds) {
      const u = wrap(c.u + this.wind - cu);
      const w = wrap(c.w + this.wind * 0.25 - cw);
      const edge = (1 - smooth(0.72, 1, Math.abs(u))) * (1 - smooth(0.66, 1, Math.abs(w)));
      const s = vh * c.size * 0.7 * k * edge;
      if (s < 1e-3) {
        c.root.enabled = false;
        c.shadow.enabled = false;
        continue;
      }
      c.root.enabled = true;
      const bob = Math.sin(this.t * 0.6 + c.bob) * 0.04;
      this.pos.set(
        this.center.x + this.right.x * u * wx + this.back.x * w * wz,
        this.center.y + (c.y + bob) * vh * 0.3,
        this.center.z + this.right.z * u * wx + this.back.z * w * wz,
      );
      c.root.setPosition(this.pos);
      c.root.setLocalEulerAngles(0, cam.yaw, 0);
      c.root.setLocalScale(s, s, s);

      // Shadow: where the cloud sits over the ground on screen, nudged toward the camera (down the screen) and a
      // little to the side, so it peeks out below the cloud like the shadow of something floating overhead.
      this.ray.copy(this.pos).sub(cp);
      const cloudDist = this.ray.length();
      const tHit = (SHADOW_Y - cp.y) / (this.ray.y / cloudDist);
      const sg = (s * tHit) / cloudDist; // the cloud's size, seen at the ground
      c.shadow.enabled = tHit > 0;
      c.shadow.setPosition(
        cp.x + (this.ray.x / cloudDist) * tHit + this.back.x * sg * 1.9 + this.right.x * sg * 0.45,
        SHADOW_Y,
        cp.z + (this.ray.z / cloudDist) * tHit + this.back.z * sg * 1.9 + this.right.z * sg * 0.45,
      );
      c.shadow.setLocalEulerAngles(0, cam.yaw, 0);
      c.shadow.setLocalScale(sg * 4, 1, sg * 4);

      if (c.face) this.updateFace(c.face, dt, still);
      if (c.rain) this.updateRain(c.rain, dt, still);
    }
  }

  private updateFace(f: Face, dt: number, still: boolean) {
    f.shown = pc.math.clamp(f.shown + (this.happy ? dt : -dt) * 1.5, 0, 1);
    f.root.enabled = f.shown > 0.01;
    if (!f.root.enabled) return;
    const pop = smooth(0, 1, f.shown);
    f.root.setLocalScale(pop, pop, pop);
    // Asleep most of the time; now and then a slow wake, a look around with a blink, and back to sleep.
    let target = 0;
    if (!still) {
      f.timer -= dt;
      if (f.timer <= 0) {
        f.awake = !f.awake;
        f.timer = f.awake ? 2.6 + Math.random() * 2 : 7 + Math.random() * 9;
      }
      target = f.awake ? (f.timer > 1.1 && f.timer < 1.28 ? 0 : 1) : 0; // the blink
    }
    const rate = target > f.open ? 5 : f.awake ? 14 : 1.6; // opens briskly, blinks fast, dozes off slowly
    f.open += (target - f.open) * Math.min(1, dt * rate);
    for (const e of f.eyes) e.setLocalScale(0.09 - 0.015 * f.open, 0.014 + 0.062 * f.open, 0.04);
    for (const sp of f.sparkles) sp.enabled = f.open > 0.65;
  }

  private updateRain(r: Rain, dt: number, still: boolean) {
    if (still) {
      r.amount = 0;
    } else {
      r.timer -= dt;
      if (r.timer <= 0) {
        r.raining = !r.raining;
        r.timer = r.raining ? 8 + Math.random() * 7 : 18 + Math.random() * 24;
      }
      r.amount = pc.math.clamp(r.amount + (r.raining ? dt : -dt) * 0.6, 0, 1);
    }
    const n = Math.round(r.drops.length * r.amount);
    for (let i = 0; i < r.drops.length; i++) {
      const d = r.drops[i];
      // A drop finishes its fall even as the shower thins out, so none vanish mid-air.
      const fall = (this.t * 2.4 + r.phase[i]) % RAIN_FALL;
      const active = i < n || (d.enabled && fall > 0.15);
      d.enabled = !still && active;
      if (!d.enabled) continue;
      const p = d.getLocalPosition();
      d.setLocalPosition(p.x, -0.3 - fall, p.z);
      const sc = (1 - smooth(RAIN_FALL * 0.7, RAIN_FALL, fall)) * smooth(0, 0.25, fall);
      d.setLocalScale(sc, sc, sc);
    }
  }
}
