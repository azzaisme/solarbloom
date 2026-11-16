import * as pc from 'playcanvas';
import { SKY } from '../data/sky';

/** sRGB hex → 0–1 components. */
function rgb(hex: string): [number, number, number] {
  const c = new pc.Color();
  c.fromString(hex);
  return [c.r, c.g, c.b];
}

/** Mix a [fogged, clear] pair (or a plain colour) at `k` (0 fogged … 1 clear). */
export function skyColour(pair: readonly [string, string] | string, k: number): [number, number, number] {
  if (typeof pair === 'string') return rgb(pair);
  const a = rgb(pair[0]);
  const b = rgb(pair[1]);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

const mix = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** An unlit, vertex-coloured material that ignores the scene fog (the sky is the fog's backdrop; the skyline bakes its own haze). */
export function skyMaterial(blend: boolean, depthWrite = false): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.useFog = false;
  m.useSkybox = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(1, 1, 1);
  m.emissiveVertexColor = true;
  m.depthWrite = depthWrite;
  m.cull = pc.CULLFACE_NONE;
  if (blend) {
    m.opacityVertexColor = true;
    m.opacityVertexColorChannel = 'a';
    m.blendType = pc.BLEND_NORMAL;
  }
  m.update();
  return m;
}

/** Elevation rings (degrees) of the dome; dense near the horizon where the colour changes fastest. */
const RINGS = [-40, -6, 0, 1.5, 3.5, 6, 10, 15, 22, 32, 45, 60, 75, 90];
const SEGS = 36;

/**
 * Look 4.7: the sky. A vertex-coloured dome (zenith blue down to a warm band and the haze colour at the
 * horizon), a soft sun disc and glow placed along the key light, and a ring of soft clouds drifting slowly.
 * It follows the camera position (never its rotation) and sits just inside the far clip plane. It doesn't
 * write depth, so everything in the world draws over it. One opaque and one blended draw call.
 *
 * `clarity` (0 … 1) greys it while the city is fogged and clears it as areas are woken; the matching haze
 * colour is read by Game for the scene fog, so the distance always fades into the sky.
 */
export class Sky {
  readonly root: pc.Entity;
  private dome: pc.Entity;
  private soft: pc.Entity;
  private domeMesh: pc.Mesh;
  private softMesh: pc.Mesh;
  private domeDirs: [number, number, number][] = [];
  private softBase: { col: 'sun' | 'glow' | 'lit' | 'shade'; a: number }[] = [];
  private builtClarity = -1;
  private builtSun = new pc.Vec3();
  private sunDir = new pc.Vec3(0, 1, 0);
  private time = 0;
  clarity = 0.4;
  reducedMotion = false;
  readonly layer: pc.Layer;

  constructor(
    app: pc.AppBase,
    private sun: pc.Entity,
  ) {
    this.root = new pc.Entity('sky');
    app.root.addChild(this.root);
    // Its own layer, drawn before the world: the world paints over it, and the soft clouds never sort in
    // front of the (depth-less) fog sheets.
    const comp = app.scene.layers;
    this.layer = comp.getLayerByName('Sky') ?? new pc.Layer({ name: 'Sky' });
    if (!comp.getLayerByName('Sky')) comp.insert(this.layer, 0);
    const device = app.graphicsDevice;

    // The dome: a unit sphere (rings × segments), coloured per vertex.
    const pos: number[] = [];
    const idx: number[] = [];
    for (const e of RINGS) {
      const el = (e * Math.PI) / 180;
      for (let s = 0; s <= SEGS; s++) {
        const az = (s / SEGS) * Math.PI * 2;
        const d: [number, number, number] = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
        this.domeDirs.push(d);
        pos.push(...d);
      }
    }
    for (let r = 0; r < RINGS.length - 1; r++)
      for (let s = 0; s < SEGS; s++) {
        const i = r * (SEGS + 1) + s;
        idx.push(i, i + 1, i + SEGS + 1, i + 1, i + SEGS + 2, i + SEGS + 1);
      }
    this.domeMesh = new pc.Mesh(device);
    this.domeMesh.setPositions(pos);
    this.domeMesh.setColors32(new Array((pos.length / 3) * 4).fill(255));
    this.domeMesh.setIndices(idx);
    this.domeMesh.update(pc.PRIMITIVE_TRIANGLES);
    this.dome = new pc.Entity('sky-dome');
    this.dome.addComponent('render', { meshInstances: [new pc.MeshInstance(this.domeMesh, skyMaterial(false))], castShadows: false, receiveShadows: false, layers: [this.layer.id] });
    this.root.addChild(this.dome);

    // The soft layer: sun glow + disc and clouds, as camera-facing fans on the unit sphere. Their geometry
    // (with vertex colours) must exist before the mesh instances, or the shader compiles without them.
    this.softMesh = new pc.Mesh(device);
    this.cloudMesh = new pc.Mesh(device);
    this.readSun();
    this.builtSun.copy(this.sunDir);
    this.buildSoft();
    this.buildClouds();
    this.soft = new pc.Entity('sky-soft');
    this.soft.addComponent('render', { meshInstances: [new pc.MeshInstance(this.softMesh, skyMaterial(true))], castShadows: false, receiveShadows: false, layers: [this.layer.id] });
    this.root.addChild(this.soft);
    this.clouds = new pc.Entity('sky-clouds');
    this.root.addChild(this.clouds);
    this.clouds.addComponent('render', { meshInstances: [new pc.MeshInstance(this.cloudMesh, skyMaterial(true))], castShadows: false, receiveShadows: false, layers: [this.layer.id] });
    for (const mi of [...this.dome.render!.meshInstances, ...this.soft.render!.meshInstances, ...this.clouds.render!.meshInstances]) mi.cull = false; // the dome surrounds the camera
  }

  private clouds: pc.Entity;
  private cloudMesh: pc.Mesh;
  private cloudCols: { lit: boolean; a: number }[] = [];

  /** Direction toward the sun: opposite the key light's travel (a directional light shines down its −Y). */
  private readSun() {
    this.sunDir.copy(this.sun.up).normalize();
  }

  /** A soft disc (fan) facing the centre at direction `d`, angular radius `r` (radians), stretched by `sx`. */
  private fan(pos: number[], idx: number[], d: pc.Vec3, r: number, sx: number, sy: number, seg: number, onCentre: () => void, onRim: () => void) {
    const up = Math.abs(d.y) > 0.98 ? new pc.Vec3(1, 0, 0) : new pc.Vec3(0, 1, 0);
    const right = new pc.Vec3().cross(up, d).normalize();
    const u = new pc.Vec3().cross(d, right).normalize();
    const base = pos.length / 3;
    pos.push(d.x, d.y, d.z);
    onCentre();
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * r * sx;
      const y = Math.sin(a) * r * sy;
      const p = new pc.Vec3(d.x + right.x * x + u.x * y, d.y + right.y * x + u.y * y, d.z + right.z * x + u.z * y).normalize();
      pos.push(p.x, p.y, p.z);
      onRim();
    }
    for (let i = 0; i < seg; i++) idx.push(base, base + 1 + i, base + 1 + ((i + 1) % seg));
  }

  /** Clouds: clusters of soft puffs low over the horizon all around (seeded, so every load looks the same). */
  private buildClouds() {
    const pos: number[] = [];
    const idx: number[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let c = 0; c < 14; c++) {
      const az = (c / 14) * Math.PI * 2 + rnd() * 0.3;
      const el = (4 + rnd() * 13) * (Math.PI / 180);
      const puffs = 3 + Math.floor(rnd() * 3);
      const w = 0.06 + rnd() * 0.06;
      for (let p = 0; p < puffs; p++) {
        const da = (p - (puffs - 1) / 2) * w * 0.9 + (rnd() - 0.5) * 0.02;
        const de = Math.abs(p - (puffs - 1) / 2) * -0.006 + rnd() * 0.012;
        const d = new pc.Vec3(Math.cos(el + de) * Math.sin(az + da), Math.sin(el + de), Math.cos(el + de) * Math.cos(az + da));
        const r = w * (0.75 + rnd() * 0.5);
        // A shaded base and a lit top, both soft at the rim.
        this.fan(pos, idx, d, r, 1.25, 0.55, 12, () => this.cloudCols.push({ lit: false, a: 0.75 }), () => this.cloudCols.push({ lit: false, a: 0 }));
        const top = new pc.Vec3(d.x, d.y + r * 0.22, d.z).normalize();
        this.fan(pos, idx, top, r * 0.8, 1.2, 0.6, 12, () => this.cloudCols.push({ lit: true, a: 0.95 }), () => this.cloudCols.push({ lit: true, a: 0 }));
      }
    }
    this.cloudMesh.setPositions(pos);
    this.cloudMesh.setColors32(new Array((pos.length / 3) * 4).fill(255));
    this.cloudMesh.setIndices(idx);
    this.cloudMesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  /** The sun's glow and disc (rebuilt when the key light turns). */
  private buildSoft() {
    const pos: number[] = [];
    const idx: number[] = [];
    this.softBase = [];
    const d = this.sunDir;
    this.fan(pos, idx, d, 0.32, 1, 1, 24, () => this.softBase.push({ col: 'glow', a: 0.55 }), () => this.softBase.push({ col: 'glow', a: 0 }));
    this.fan(pos, idx, d, 0.09, 1, 1, 20, () => this.softBase.push({ col: 'glow', a: 0.85 }), () => this.softBase.push({ col: 'glow', a: 0 }));
    this.fan(pos, idx, d, 0.028, 1, 1, 20, () => this.softBase.push({ col: 'sun', a: 1 }), () => this.softBase.push({ col: 'sun', a: 0.9 }));
    this.softMesh.setPositions(pos);
    this.softMesh.setColors32(new Array((pos.length / 3) * 4).fill(255));
    this.softMesh.setIndices(idx);
    this.softMesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  /** The haze colour now (scene fog and the horizon), as linear-ish 0–1 sRGB components. */
  hazeColour(): [number, number, number] {
    return skyColour(SKY.haze, this.clarity);
  }

  /** Sky colour in a direction (unit vector), for the dome's vertices. */
  private colourAt(d: [number, number, number], k: number): [number, number, number] {
    const el = Math.asin(Math.max(-1, Math.min(1, d[1]))) * (180 / Math.PI);
    const haze = skyColour(SKY.haze, k);
    if (el <= 0) return haze;
    const glow = skyColour(SKY.glow, k);
    const upper = skyColour(SKY.upper, k);
    const zen = skyColour(SKY.zenith, k);
    let c: [number, number, number];
    if (el < 4) c = mix(haze, glow, smooth(el / 4));
    else if (el < 25) c = mix(glow, upper, smooth((el - 4) / 21));
    else c = mix(upper, zen, smooth((el - 25) / 65));
    // Warmer toward the sun, mostly low in the sky.
    const s = this.sunDir;
    const cos = d[0] * s.x + d[1] * s.y + d[2] * s.z;
    const w = Math.pow(Math.max(0, cos), 6) * 0.55 + Math.pow(Math.max(0, cos), 2) * 0.15 * (1 - smooth(el / 40));
    return mix(c, skyColour(SKY.sunGlow, k), Math.min(0.8, w));
  }

  private recolour() {
    const k = this.clarity;
    const b = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255);
    const dc: number[] = [];
    for (const d of this.domeDirs) {
      const c = this.colourAt(d, k);
      dc.push(b(c[0]), b(c[1]), b(c[2]), 255);
    }
    this.domeMesh.setColors32(dc);
    this.domeMesh.update(pc.PRIMITIVE_TRIANGLES);
    const sun = skyColour(SKY.sunCore, k);
    const glow = skyColour(SKY.sunGlow, k);
    const sc: number[] = [];
    // The sun fades behind the fog: weaker while the city is grey.
    const sunA = 0.45 + 0.55 * k;
    for (const v of this.softBase) {
      const c = v.col === 'sun' ? sun : glow;
      sc.push(b(c[0]), b(c[1]), b(c[2]), b(v.a * sunA));
    }
    this.softMesh.setColors32(sc);
    this.softMesh.update(pc.PRIMITIVE_TRIANGLES);
    const lit = skyColour(SKY.cloudLit, k);
    const shade = skyColour(SKY.cloudShade, k);
    const cc: number[] = [];
    for (const v of this.cloudCols) {
      const c = v.lit ? lit : shade;
      cc.push(b(c[0]), b(c[1]), b(c[2]), b(v.a * (0.85 + 0.15 * (1 - k))));
    }
    this.cloudMesh.setColors32(cc);
    this.cloudMesh.update(pc.PRIMITIVE_TRIANGLES);
    this.builtClarity = k;
  }

  /** Follow the camera; recolour when the progress tint or the light moves. */
  update(dt: number, cam: pc.Vec3, farClip: number) {
    this.time += dt;
    this.readSun();
    if (this.builtSun.distance(this.sunDir) > 1e-3) {
      this.builtSun.copy(this.sunDir);
      this.buildSoft();
      this.builtClarity = -1;
    }
    if (Math.abs(this.builtClarity - this.clarity) > 0.004) this.recolour();
    const R = farClip * 0.97;
    this.root.setPosition(cam.x, cam.y, cam.z);
    this.root.setLocalScale(R, R, R);
    // Clouds drift slowly around the horizon (a full turn takes about 40 minutes).
    if (!this.reducedMotion) this.clouds.setLocalEulerAngles(0, (this.time * 0.15) % 360, 0);
  }
}
