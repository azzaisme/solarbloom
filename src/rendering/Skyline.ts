import * as pc from 'playcanvas';
import { SKY } from '../data/sky';
import { skyColour, skyMaterial } from './Sky';

type Key = 'stone' | 'green' | 'glass' | 'water' | 'glowWarm';
const KEYS: Key[] = ['stone', 'green', 'glass', 'water', 'glowWarm'];

/** Accumulates flat-shaded primitives with a material key, a light factor and a haze factor per vertex. */
class Kit {
  pos: number[] = [];
  idx: number[] = [];
  key: number[] = [];
  shade: number[] = [];
  haze: number[] = [];
  /** extra haze for this layer (distance) */
  base = 0;
  /** where ground haze lies (bases fade into the mist) */
  floor = -12;
  constructor(private light: pc.Vec3) {}

  private vert(x: number, y: number, z: number, k: Key, s: number) {
    this.pos.push(x, y, z);
    this.key.push(KEYS.indexOf(k));
    this.shade.push(s);
    const ground = 1 - Math.min(1, Math.max(0, (y - this.floor) / 26));
    this.haze.push(Math.min(0.92, this.base + ground * ground * 0.45));
  }

  private face(p: number[][], n: [number, number, number], k: Key) {
    const l = this.light;
    const s = 0.62 + 0.38 * Math.max(0, n[0] * l.x + n[1] * l.y + n[2] * l.z) + (n[1] > 0.5 ? 0.06 : 0);
    const b = this.pos.length / 3;
    for (const v of p) this.vert(v[0], v[1], v[2], k, s);
    for (let i = 1; i < p.length - 1; i++) this.idx.push(b, b + i, b + i + 1);
  }

  /** Box centred at (x, y, z) with size (sx, sy, sz), turned `yaw` radians about Y. Bottom face skipped. */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, k: Key) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const P = (dx: number, dy: number, dz: number) => [x + dx * c + dz * s, y + dy, z - dx * s + dz * c];
    const N = (nx: number, nz: number): [number, number, number] => [nx * c + nz * s, 0, -nx * s + nz * c];
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    this.face([P(-hx, hy, -hz), P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz)], [0, 1, 0], k);
    this.face([P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)], N(0, 1), k);
    this.face([P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz)], N(0, -1), k);
    this.face([P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz)], N(1, 0), k);
    this.face([P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz)], N(-1, 0), k);
  }

  /** Upright cylinder (no bottom). */
  cyl(x: number, y: number, z: number, r: number, h: number, segs: number, k: Key, top = true) {
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      this.face(
        [
          [x + Math.sin(a0) * r, y, z + Math.cos(a0) * r],
          [x + Math.sin(a1) * r, y, z + Math.cos(a1) * r],
          [x + Math.sin(a1) * r, y + h, z + Math.cos(a1) * r],
          [x + Math.sin(a0) * r, y + h, z + Math.cos(a0) * r],
        ],
        [Math.sin(am), 0, Math.cos(am)],
        k,
      );
    }
    if (top) {
      const ring: number[][] = [];
      for (let i = segs - 1; i >= 0; i--) {
        const a = (i / segs) * Math.PI * 2;
        ring.push([x + Math.sin(a) * r, y + h, z + Math.cos(a) * r]);
      }
      this.face(ring.reverse(), [0, 1, 0], k);
    }
  }

  /** A low dome (glass) with a few ribs. */
  dome(x: number, y: number, z: number, r: number, k: Key) {
    const segs = 10;
    const rings = 4;
    for (let j = 0; j < rings; j++) {
      const e0 = (j / rings) * (Math.PI / 2);
      const e1 = ((j + 1) / rings) * (Math.PI / 2);
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const p = (e: number, a: number) => [x + Math.cos(e) * Math.sin(a) * r, y + Math.sin(e) * r * 0.8, z + Math.cos(e) * Math.cos(a) * r];
        const em = (e0 + e1) / 2;
        const am = (a0 + a1) / 2;
        this.face([p(e0, a0), p(e0, a1), p(e1, a1), p(e1, a0)], [Math.cos(em) * Math.sin(am), Math.sin(em), Math.cos(em) * Math.cos(am)], k);
      }
    }
  }

  /** A clump of greenery: a squat octahedron. */
  blob(x: number, y: number, z: number, r: number, k: Key = 'green') {
    const t: [number, number, number] = [x, y + r * 0.8, z];
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + x;
      pts.push([x + Math.sin(a) * r, y + r * 0.15, z + Math.cos(a) * r]);
    }
    for (let i = 0; i < 5; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 5];
      const am = ((i + 0.5) / 5) * Math.PI * 2 + x;
      this.face([a, b, t], [Math.sin(am) * 0.7, 0.7, Math.cos(am) * 0.7], k);
    }
  }
}

/** Seeded random numbers (the skyline looks the same every load). */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Layer: radius past the camera distance, tower count, haze, height scale, pan parallax. */
const LAYERS = [
  { r: 62, n: 22, haze: 0.12, h: 1, par: 0.12 },
  { r: 104, n: 28, haze: 0.3, h: 1.25, par: 0.07 },
  { r: 150, n: 34, haze: 0.48, h: 1.5, par: 0.04 },
];

interface Built {
  e: pc.Entity;
  mesh: pc.Mesh;
  kit: Kit;
  par: number;
  r: number;
}

/**
 * Look 4.8: the distant solarpunk skyline. Three rings of procedural terraced towers around the view (hanging
 * gardens, planters, glass bands, arched bridges between neighbours, a glass dome, waterfalls with mist),
 * each ring one merged, unlit, vertex-coloured mesh with its haze baked in (further rings and lower storeys
 * fade more), so it sits in the sky's colours whatever the scene fog does. Waterfalls scroll a streak texture.
 *
 * It follows the camera target, so it reads as far away; each ring turns a little as you pan sideways (nearer
 * rings more), which gives parallax without ever running out. It rises into view as you zoom in and is hidden
 * in the overview. Grey and dim while the city is fogged; greener and glowing as areas wake (`clarity`).
 * Draw calls: three rings, one waterfall mesh, one mist mesh.
 */
export class Skyline {
  readonly root: pc.Entity;
  private layers: Built[] = [];
  private falls!: pc.Entity;
  private fallsMat!: pc.StandardMaterial;
  private fallsMesh!: pc.Mesh;
  private fallsHaze: number[] = [];
  private mist!: pc.Entity;
  private mistMesh!: pc.Mesh;
  private mistA: number[] = [];
  private mistHaze: number[] = [];
  private builtClarity = -1;
  private time = 0;
  clarity = 0.4;
  reducedMotion = false;

  constructor(app: pc.AppBase, layer: pc.Layer, sunDir: pc.Vec3) {
    this.root = new pc.Entity('skyline');
    app.root.addChild(this.root);
    const device = app.graphicsDevice;
    const fallsPos: number[] = [];
    const fallsUv: number[] = [];
    const fallsIdx: number[] = [];
    const mistPos: number[] = [];
    const mistIdx: number[] = [];
    const light = sunDir.clone().normalize();
    LAYERS.forEach((L, li) => {
      const kit = new Kit(light);
      kit.base = L.haze;
      const rnd = rng(97 + li * 131);
      const towers: { x: number; z: number; w: number; tiers: number[] }[] = [];
      for (let i = 0; i < L.n; i++) {
        const a = ((i + rnd() * 0.5) / L.n) * Math.PI * 2;
        const R = L.r + (rnd() - 0.5) * 14;
        const x = Math.sin(a) * R;
        const z = Math.cos(a) * R;
        const face = Math.atan2(-x, -z); // toward the centre (the viewer)
        const w = (7 + rnd() * 7) * (0.8 + li * 0.15);
        const tiers: number[] = [];
        let y = kit.floor;
        let tw = w;
        const nt = 3 + Math.floor(rnd() * 4);
        for (let t = 0; t < nt; t++) {
          const th = (6 + rnd() * 9) * L.h;
          const round = rnd() < 0.3;
          if (round) kit.cyl(x, y, z, tw / 2, th, 10, 'stone');
          else kit.box(x, y + th / 2, z, tw, th, tw * (0.75 + rnd() * 0.3), face, 'stone');
          // A glass band on each storey, a little proud of the facade.
          if (!round) kit.box(x + Math.sin(face) * 0.01, y + th * 0.5, z + Math.cos(face) * 0.01, tw * 1.01, th * 0.22, tw * 0.6, face, 'glass');
          y += th;
          tiers.push(y);
          // Terrace planter and hanging gardens down the front.
          kit.box(x, y + 0.5, z, tw * 1.08, 1, tw * 0.9, face, 'green');
          for (let g = 0; g < 3; g++) {
            const off = (g - 1) * tw * 0.32;
            const hx = x + Math.cos(face) * off + Math.sin(face) * tw * 0.42;
            const hz = z - Math.sin(face) * off + Math.cos(face) * tw * 0.42;
            const hang = th * (0.3 + rnd() * 0.45);
            kit.box(hx, y - hang / 2, hz, tw * 0.14, hang, 0.6, face, 'green');
          }
          for (let b = 0; b < 2; b++) kit.blob(x + (rnd() - 0.5) * tw * 0.6, y + 1, z + (rnd() - 0.5) * tw * 0.5, 1.4 + rnd() * 1.6);
          // Warm lamps along the terrace edge (they glow once the city wakes).
          if (rnd() < 0.5) kit.box(x + Math.sin(face) * tw * 0.46, y + 1.3, z + Math.cos(face) * tw * 0.46, tw * 0.5, 0.35, 0.3, face, 'glowWarm');
          tw *= 0.72 + rnd() * 0.12;
        }
        // A spire, a dome or a tree on top.
        const top = rnd();
        if (top < 0.18) kit.dome(x, y, z, tw * 0.55, 'glass');
        else if (top < 0.45) kit.cyl(x, y, z, tw * 0.08, 6 + rnd() * 8, 6, 'stone');
        else kit.blob(x, y + 1, z, tw * 0.45);
        towers.push({ x, z, w, tiers });
        // Waterfalls from a terrace on some towers, pouring toward the viewer, with mist at the foot.
        if (rnd() < 0.28 && tiers.length > 1) {
          const from = tiers[Math.min(tiers.length - 1, 1 + Math.floor(rnd() * (tiers.length - 1)))];
          const fw = w * (0.18 + rnd() * 0.14);
          const fx = x + Math.sin(face) * (w * 0.5 + 0.4);
          const fz = z + Math.cos(face) * (w * 0.5 + 0.4);
          const cx = Math.cos(face) * fw * 0.5;
          const cz = -Math.sin(face) * fw * 0.5;
          const b = fallsPos.length / 3;
          const h = from - kit.floor;
          fallsPos.push(fx - cx, kit.floor, fz - cz, fx + cx, kit.floor, fz + cz, fx + cx, from, fz + cz, fx - cx, from, fz - cz);
          const v = h / 12;
          fallsUv.push(0, v, 1, v, 1, 0, 0, 0);
          fallsIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
          for (let q = 0; q < 4; q++) this.fallsHaze.push(L.haze);
          // Mist: a few soft puffs at the foot.
          for (let m = 0; m < 3; m++) {
            const mb = mistPos.length / 3;
            const mx = fx + Math.sin(face) * 1.5 + (m - 1) * fw * 0.6;
            const mz = fz + Math.cos(face) * 1.5;
            const my = kit.floor + 2 + m * 0.6;
            const rad = fw * (0.8 + m * 0.2) + 2;
            mistPos.push(mx, my, mz);
            this.mistA.push(0.75);
            this.mistHaze.push(L.haze);
            for (let s = 0; s < 10; s++) {
              const aa = (s / 10) * Math.PI * 2;
              mistPos.push(mx + Math.cos(face) * Math.cos(aa) * rad, my + Math.sin(aa) * rad * 0.45, mz - Math.sin(face) * Math.cos(aa) * rad);
              this.mistA.push(0);
              this.mistHaze.push(L.haze);
            }
            for (let s = 0; s < 10; s++) mistIdx.push(mb, mb + 1 + s, mb + 1 + ((s + 1) % 10));
          }
        }
      }
      // Arched bridges between neighbours on the nearer rings.
      if (li < 2)
        for (let i = 0; i < towers.length; i++) {
          if (rnd() < 0.45) continue;
          const A = towers[i];
          const B = towers[(i + 1) % towers.length];
          const lvl = Math.min(A.tiers[0], B.tiers[0]);
          const dx = B.x - A.x;
          const dz = B.z - A.z;
          const len = Math.hypot(dx, dz);
          const yaw = Math.atan2(dx, dz) - Math.PI / 2;
          const mx = (A.x + B.x) / 2;
          const mz = (A.z + B.z) / 2;
          kit.box(mx, lvl - 0.4, mz, len, 0.8, 2.2, yaw, 'stone');
          kit.box(mx, lvl + 0.35, mz, len, 0.5, 0.25, yaw, 'green');
          // The arch underneath, in short segments.
          const span = len - (A.w + B.w) / 2;
          const rise = Math.min(7, span * 0.35);
          const segs = 7;
          for (let s = 0; s < segs; s++) {
            const t = (s + 0.5) / segs - 0.5;
            const ax = mx + (dx / len) * t * span;
            const az = mz + (dz / len) * t * span;
            const ay = lvl - 1 - rise * (1 - 4 * t * t);
            kit.box(ax, ay, az, span / segs + 0.3, 0.9, 1.8, yaw, 'stone');
          }
        }
      const mesh = new pc.Mesh(device);
      mesh.setPositions(kit.pos);
      mesh.setColors32(new Array((kit.pos.length / 3) * 4).fill(255));
      mesh.setIndices(kit.idx);
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      const e = new pc.Entity(`skyline-${li}`);
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, skyMaterial(false, true))], castShadows: false, receiveShadows: false, layers: [layer.id] });
      this.root.addChild(e);
      this.layers.push({ e, mesh, kit, par: L.par, r: L.r });
    });

    // Waterfalls: one mesh, a scrolling streak texture.
    this.fallsMesh = new pc.Mesh(device);
    this.fallsMesh.setPositions(fallsPos);
    this.fallsMesh.setUvs(0, fallsUv);
    this.fallsMesh.setColors32(new Array((fallsPos.length / 3) * 4).fill(255));
    this.fallsMesh.setIndices(fallsIdx);
    this.fallsMesh.update(pc.PRIMITIVE_TRIANGLES);
    this.fallsMat = skyMaterial(false, true);
    const tex = streakTexture(device);
    this.fallsMat.emissiveMap = tex;
    this.fallsMat.opacityMap = tex;
    this.fallsMat.opacityMapChannel = 'a';
    this.fallsMat.blendType = pc.BLEND_NORMAL;
    this.fallsMat.depthWrite = false;
    this.fallsMat.update();
    this.falls = new pc.Entity('skyline-falls');
    this.falls.addComponent('render', { meshInstances: [new pc.MeshInstance(this.fallsMesh, this.fallsMat)], castShadows: false, receiveShadows: false, layers: [layer.id] });
    this.root.addChild(this.falls);

    this.mistMesh = new pc.Mesh(device);
    this.mistMesh.setPositions(mistPos);
    this.mistMesh.setColors32(new Array((mistPos.length / 3) * 4).fill(255));
    this.mistMesh.setIndices(mistIdx);
    this.mistMesh.update(pc.PRIMITIVE_TRIANGLES);
    this.mist = new pc.Entity('skyline-mist');
    this.mist.addComponent('render', { meshInstances: [new pc.MeshInstance(this.mistMesh, skyMaterial(true))], castShadows: false, receiveShadows: false, layers: [layer.id] });
    this.root.addChild(this.mist);
  }

  get triangles(): number {
    return this.layers.reduce((n, l) => n + l.kit.idx.length / 3, 0);
  }

  private recolour() {
    const k = this.clarity;
    const haze = skyColour(SKY.haze, k);
    const cols = KEYS.map((key) => skyColour(SKY[key], k));
    const b = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255);
    for (const L of this.layers) {
      const kit = L.kit;
      const n = kit.key.length;
      const out = new Array(n * 4);
      for (let i = 0; i < n; i++) {
        const c = cols[kit.key[i]];
        const glow = kit.key[i] === 4 ? 0.35 + 0.65 * k : 0; // lamps light up as the city wakes
        const s = kit.shade[i] + glow * 0.4;
        const h = kit.haze[i] * (1 - glow * 0.5);
        out[i * 4] = b(c[0] * s + (haze[0] - c[0] * s) * h);
        out[i * 4 + 1] = b(c[1] * s + (haze[1] - c[1] * s) * h);
        out[i * 4 + 2] = b(c[2] * s + (haze[2] - c[2] * s) * h);
        out[i * 4 + 3] = 255;
      }
      L.mesh.setColors32(out);
      L.mesh.update(pc.PRIMITIVE_TRIANGLES);
    }
    const w = skyColour(SKY.water, k);
    const fc: number[] = [];
    for (const h of this.fallsHaze) fc.push(b(w[0] + (haze[0] - w[0]) * h), b(w[1] + (haze[1] - w[1]) * h), b(w[2] + (haze[2] - w[2]) * h), b(0.5 + 0.5 * k));
    this.fallsMesh.setColors32(fc);
    this.fallsMesh.update(pc.PRIMITIVE_TRIANGLES);
    const mc: number[] = [];
    this.mistA.forEach((a, i) => {
      const h = this.mistHaze[i] * 0.5;
      mc.push(b(1 + (haze[0] - 1) * h), b(1 + (haze[1] - 1) * h), b(1 + (haze[2] - 1) * h), b(a * (0.4 + 0.6 * k)));
    });
    this.mistMesh.setColors32(mc);
    this.mistMesh.update(pc.PRIMITIVE_TRIANGLES);
    this.builtClarity = k;
  }

  /**
   * Follow the view. `dist` is the camera distance (the rings stand past it), `nearness` 0 far … 1 near (the
   * skyline sinks out of view below ~0.3), `yaw` the camera yaw in degrees.
   */
  update(dt: number, target: pc.Vec3, dist: number, nearness: number, yaw: number) {
    this.time += dt;
    const t = Math.min(1, Math.max(0, (nearness - 0.3) / 0.4));
    const rise = t * t * (3 - 2 * t);
    this.root.enabled = rise > 0.001;
    if (!this.root.enabled) return;
    if (Math.abs(this.builtClarity - this.clarity) > 0.02) this.recolour();
    this.root.setPosition(target.x, -70 * (1 - rise), target.z);
    // Sideways pans turn each ring a little (nearer rings more): parallax that never runs out.
    const yr = (yaw * Math.PI) / 180;
    const lateral = target.x * Math.cos(yr) - target.z * Math.sin(yr);
    const s = 1 + dist / 60;
    for (const L of this.layers) {
      L.e.setLocalScale(s, 1, s);
      L.e.setLocalEulerAngles(0, ((lateral * L.par) / (L.r * s)) * (180 / Math.PI), 0);
    }
    this.falls.setLocalScale(s, 1, s);
    this.mist.setLocalScale(s, 1, s);
    this.falls.setLocalEulerAngles(0, this.layers[0].e.getLocalEulerAngles().y, 0);
    this.mist.setLocalEulerAngles(0, this.layers[0].e.getLocalEulerAngles().y, 0);
    if (!this.reducedMotion) {
      this.fallsMat.emissiveMapOffset = new pc.Vec2(0, -this.time * 0.6);
      this.fallsMat.opacityMapOffset = new pc.Vec2(0, -this.time * 0.6);
      this.fallsMat.update();
    }
  }
}

/** Vertical streaks of white water with soft alpha: the waterfall texture (scrolls down). */
function streakTexture(device: pc.GraphicsDevice): pc.Texture {
  const W = 32;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const r = rng(5);
  const cols = Array.from({ length: W }, () => 0.55 + r() * 0.45);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const edge = Math.min(1, Math.min(x, W - 1 - x) / 5);
      const streak = cols[x] * (0.75 + 0.25 * Math.sin((y / H) * Math.PI * 2 * 3 + x * 1.7));
      const v = Math.round(200 + 55 * streak);
      const i = (y * W + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * edge * (0.55 + 0.45 * streak));
    }
  g.putImageData(img, 0, 0);
  const tex = new pc.Texture(device, { width: W, height: H, format: pc.PIXELFORMAT_RGBA8, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_REPEAT, mipmaps: false });
  tex.setSource(c);
  return tex;
}
