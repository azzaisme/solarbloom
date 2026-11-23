import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { NIGHT_SKY, NIGHT_SKY_LIGHTS, SKY, SKY_BANDS, SKY_BANDS_NIGHT } from '../data/sky';

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

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** An unlit, vertex-coloured material that ignores the scene fog (the sky is the fog's backdrop). */
export function skyMaterial(blend: boolean): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.useFog = false;
  m.useSkybox = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(1, 1, 1);
  m.emissiveVertexColor = true;
  m.depthWrite = false;
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
const RINGS = [-40, -6, 0, 1.5, 3, 5, 8, 12, 16, 22, 32, 45, 60, 75, 90];
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
  /** E23.7.1: how far into night the sky is (0 day … 1 deep night), set by DayNight */
  night = 0;
  /** E23.7.1: dawn and dusk warmth near the horizon (0 … 1) */
  dusk = 0;
  /** E23.7.2: overcast (0 clear … 1 heavy cloud), greys the sky and hides the sun */
  overcast = 0;
  /** E23.7.2: wind, 0 … 1 (the clouds drift faster) */
  wind = 0;
  private drift = 0;
  private builtNight = -1;
  private builtDusk = -1;
  private builtOvercast = -1;
  reducedMotion = false;
  readonly layer: pc.Layer;

  constructor(
    app: pc.AppBase,
    private sun: pc.Entity,
  ) {
    this.root = new pc.Entity('sky');
    app.root.addChild(this.root);
    // Its own layer, drawn before the world: nothing in it writes depth, so the world paints over it, and the
    // soft clouds never sort in front of the (depth-less) fog sheets.
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
    // E23.7.5: the stars, under the clouds; hidden (no draw call) until night
    this.starMesh = new pc.Mesh(device);
    this.buildStars();
    this.stars = new pc.Entity('sky-stars');
    this.stars.addComponent('render', { meshInstances: [new pc.MeshInstance(this.starMesh, skyMaterial(true))], castShadows: false, receiveShadows: false, layers: [this.layer.id] });
    this.stars.render!.meshInstances[0].cull = false;
    this.stars.enabled = false;
    this.root.addChild(this.stars);
    this.clouds = new pc.Entity('sky-clouds');
    this.root.addChild(this.clouds);
    this.clouds.addComponent('render', { meshInstances: [new pc.MeshInstance(this.cloudMesh, skyMaterial(true))], castShadows: false, receiveShadows: false, layers: [this.layer.id] });
    for (const mi of [...this.dome.render!.meshInstances, ...this.soft.render!.meshInstances, ...this.clouds.render!.meshInstances]) mi.cull = false; // the dome surrounds the camera
  }

  private stars: pc.Entity;
  private starMesh: pc.Mesh;
  private starCols: { c: [number, number, number]; a: number }[] = [];
  private clouds: pc.Entity;
  private cloudMesh: pc.Mesh;
  private cloudCols: { lit: boolean; a: number }[] = [];

  /** Direction toward the sun: opposite the key light's travel (a directional light shines down its −Y). */
  private readSun() {
    this.sunDir.copy(this.sun.up).normalize();
  }

  /** A soft disc (fan) facing the centre at direction `d`, angular radius `r` (radians), stretched by `sx`. */
  private fan(pos: number[], idx: number[], d: pc.Vec3, r: number, sx: number, sy: number, seg: number, onCentre: () => void, onRim: () => void, floor = Infinity) {
    const up = Math.abs(d.y) > 0.98 ? new pc.Vec3(1, 0, 0) : new pc.Vec3(0, 1, 0);
    const right = new pc.Vec3().cross(up, d).normalize();
    const u = new pc.Vec3().cross(d, right).normalize();
    const base = pos.length / 3;
    pos.push(d.x, d.y, d.z);
    onCentre();
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * r * sx;
      const y = Math.max(-floor, Math.sin(a) * r * sy); // P7-E32.6: `floor` cuts a fan off flat below its centre
      const p = new pc.Vec3(d.x + right.x * x + u.x * y, d.y + right.y * x + u.y * y, d.z + right.z * x + u.z * y).normalize();
      pos.push(p.x, p.y, p.z);
      onRim();
    }
    for (let i = 0; i < seg; i++) idx.push(base, base + 1 + i, base + 1 + ((i + 1) % seg));
  }

  /**
   * Clouds: clusters of soft puffs low over the horizon all around (seeded, so every load looks the same).
   * P7-E32.6 (#760): each cluster is a cumulus bank, not a row of balls: a long shaded base cut off flat underneath,
   * lobes along it that are biggest in the middle (a domed profile) and all sit on that same flat floor, each with a
   * shaded lower half and a lit crown.
   */
  private buildClouds() {
    const pos: number[] = [];
    const idx: number[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const N = 11;
    for (let c = 0; c < N; c++) {
      const az = (c / N) * Math.PI * 2 + rnd() * 0.35;
      const el = (3 + rnd() * 11) * (Math.PI / 180);
      const lobes = 5 + Math.floor(rnd() * 4);
      const w = 0.045 + rnd() * 0.035;
      const half = ((lobes - 1) / 2) * w * 0.85;
      const at = (da: number, de: number) => new pc.Vec3(Math.cos(el + de) * Math.sin(az + da), Math.sin(el + de), Math.cos(el + de) * Math.cos(az + da));
      // the base: one long, low, shaded strip with a flat underside
      this.fan(pos, idx, at(0, w * 0.15), half + w, 1, 0.22, 16, () => this.cloudCols.push({ lit: false, a: 0.8 }), () => this.cloudCols.push({ lit: false, a: 0 }), w * 0.12);
      for (let p = 0; p < lobes; p++) {
        const x = (p - (lobes - 1) / 2) / Math.max(1, (lobes - 1) / 2); // −1 … 1 along the bank
        const r = w * (0.55 + 0.6 * (1 - x * x) + rnd() * 0.25);
        const da = x * half + (rnd() - 0.5) * w * 0.3;
        const lift = r * 0.5; // the lobe's centre sits this far above the bank's floor
        this.fan(pos, idx, at(da, lift), r, 1.15, 0.75, 14, () => this.cloudCols.push({ lit: false, a: 0.85 }), () => this.cloudCols.push({ lit: false, a: 0 }), lift);
        this.fan(pos, idx, at(da, lift + r * 0.28), r * 0.78, 1.1, 0.7, 14, () => this.cloudCols.push({ lit: true, a: 0.95 }), () => this.cloudCols.push({ lit: true, a: 0 }), lift);
      }
    }
    this.cloudMesh.setPositions(pos);
    this.cloudMesh.setColors32(new Array((pos.length / 3) * 4).fill(255));
    this.cloudMesh.setIndices(idx);
    this.cloudMesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  /** E23.7.5: the stars: soft dots over the upper sky (seeded, so every night is the same sky). */
  private buildStars() {
    const S = NIGHT_SKY_LIGHTS.stars;
    const pos: number[] = [];
    const idx: number[] = [];
    let seed = S.seed;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const lo = Math.sin((S.above * Math.PI) / 180);
    for (let i = 0; i < S.count; i++) {
      const y = lo + (1 - lo) * rnd(); // even over the cap of the sphere above `above`
      const az = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      const d = new pc.Vec3(r * Math.sin(az), y, r * Math.cos(az));
      const big = rnd() ** 3; // mostly small, a few bright ones
      const c = rgb(S.colours[Math.floor(rnd() * S.colours.length)]);
      const a = 0.45 + 0.55 * big;
      this.fan(pos, idx, d, S.size[0] + (S.size[1] - S.size[0]) * big, 1, 1, 4, () => this.starCols.push({ c, a }), () => this.starCols.push({ c, a: 0 }));
    }
    this.starMesh.setPositions(pos);
    this.starMesh.setColors32(new Array((pos.length / 3) * 4).fill(255));
    this.starMesh.setIndices(idx);
    this.starMesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  /** How much the stars show: out as the daylight goes, hidden behind heavy cloud. */
  private starShow(): number {
    const from = NIGHT_SKY_LIGHTS.stars.from;
    return smooth((this.night - from) / (1 - from)) * (1 - this.overcast);
  }

  /** How much of the moon's disc shows: deep night only (by then the key light is on the moon's side). */
  private moonShow(): number {
    const from = NIGHT_SKY_LIGHTS.moonFrom;
    return smooth((this.night - from) / (1 - from)) * (1 - this.overcast * 0.9);
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

  /** How much of the sun's disc and glow shows: none at night or under heavy cloud. */
  private sunShow(): number {
    return (1 - this.night) * (1 - this.overcast * 0.9);
  }

  /** The haze colour now (scene fog and the horizon), as linear-ish 0–1 sRGB components. */
  hazeColour(): [number, number, number] {
    return this.timeOfDay(skyColour(SKY.haze, this.clarity), 'haze');
  }

  /**
   * E27.1 (#679): the sky's colour right at the horizon, as it must be given to land where the fogged distance does.
   * The dome's colours go to the screen as given while the fog colour is decoded first (see fogMatchingSky), so by
   * day the dome's horizon takes the haze decoded (a touch deeper, as the fogged ground shows it) and by night the
   * fog takes the sky's: either way the far sea and the sky meet in one colour, at any hour.
   */
  horizonSeen(haze = this.hazeColour()): [number, number, number] {
    const d = Math.min(1, Math.max(0, this.night));
    return [0, 1, 2].map((i) => {
      const x = Math.min(1, Math.max(0, haze[i]));
      return Math.pow(x, 2.2) + (x - Math.pow(x, 2.2)) * d;
    }) as [number, number, number];
  }

  /** The High-tier water reflection: the sky low over the horizon and higher up, for the time of day (0–1 sRGB). */
  reflectColours(): { low: [number, number, number]; high: [number, number, number] } {
    const k = this.clarity;
    const glow = this.timeOfDay(skyColour(SKY.glow, k), 'glow');
    const upper = this.timeOfDay(skyColour(SKY.upper, k), 'upper');
    const zen = this.timeOfDay(skyColour(SKY.zenith, k), 'zenith');
    return { low: mix(glow, upper, 0.35), high: mix(upper, zen, 0.6) };
  }

  /** E23.7.1 / E23.7.2: a day colour shifted for dusk, night and overcast. */
  private timeOfDay(c: [number, number, number], band: 'haze' | 'glow' | 'upper' | 'zenith' | 'sun' | 'cloud'): [number, number, number] {
    let out = c;
    if (this.overcast > 0) {
      const grey = band === 'cloud' ? 0.82 : band === 'zenith' ? 0.62 : 0.74;
      const l = out[0] * 0.3 + out[1] * 0.55 + out[2] * 0.15;
      out = mix(out, [l * 0.6 + grey * 0.4, l * 0.6 + grey * 0.4 + 0.01, l * 0.6 + grey * 0.4 + 0.03], this.overcast * 0.85);
    }
    if (this.dusk > 0 && band !== 'zenith') out = mix(out, rgb(NIGHT_SKY.dusk[band]), this.dusk * (band === 'upper' ? 0.35 : 0.7));
    if (this.night > 0) out = mix(out, rgb(NIGHT_SKY.night[band]), this.night);
    return out;
  }

  /** Sky colour in a direction (unit vector), for the dome's vertices. */
  private colourAt(d: [number, number, number], k: number): [number, number, number] {
    const el = Math.asin(Math.max(-1, Math.min(1, d[1]))) * (180 / Math.PI);
    const haze = this.timeOfDay(skyColour(SKY.haze, k), 'haze');
    const seen = this.horizonSeen(haze);
    if (el <= 0) return seen;
    const glow = this.timeOfDay(skyColour(SKY.glow, k), 'glow');
    const upper = this.timeOfDay(skyColour(SKY.upper, k), 'upper');
    const zen = this.timeOfDay(skyColour(SKY.zenith, k), 'zenith');
    let c: [number, number, number];
    const n = Math.min(1, Math.max(0, this.night));
    const B = { glow: lerp(SKY_BANDS.glow, SKY_BANDS_NIGHT.glow, n), upper: lerp(SKY_BANDS.upper, SKY_BANDS_NIGHT.upper, n), zenith: lerp(SKY_BANDS.zenith, SKY_BANDS_NIGHT.zenith, n) };
    if (el < B.glow) c = mix(haze, glow, smooth(el / B.glow));
    else if (el < B.upper) c = mix(glow, upper, smooth((el - B.glow) / (B.upper - B.glow)));
    else c = mix(upper, zen, smooth((el - B.upper) / (B.zenith - B.upper)));
    // Warmer toward the sun, mostly low in the sky.
    const s = this.sunDir;
    const cos = d[0] * s.x + d[1] * s.y + d[2] * s.z;
    const w = Math.pow(Math.max(0, cos), 6) * 0.55 + Math.pow(Math.max(0, cos), 2) * 0.15 * (1 - smooth(el / 40));
    c = mix(c, this.timeOfDay(skyColour(SKY.sunGlow, k), 'sun'), Math.min(0.8, w) * this.sunShow());
    // E27.1: the lowest few degrees ease into the colour the fogged distance lands on, so the far sea meets the sky softly
    const band = LOOK.horizon.skyBand;
    return el < band ? mix(seen, c, smooth(el / band)) : c;
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
    // by deep night the disc is the moon: a pale core in a soft blue glow
    const moon = this.moonShow();
    const sun = mix(this.timeOfDay(skyColour(SKY.sunCore, k), 'sun'), rgb(NIGHT_SKY_LIGHTS.moon), moon);
    const glow = this.timeOfDay(skyColour(SKY.sunGlow, k), 'sun');
    const sc: number[] = [];
    // The sun fades behind the fog: weaker while the city is grey (and gone under cloud).
    const sunA = (0.45 + 0.55 * k) * Math.max(this.sunShow(), moon);
    const starA = this.starShow();
    this.stars.enabled = starA > 0.01;
    if (this.stars.enabled) {
      const st: number[] = [];
      for (const v of this.starCols) st.push(b(v.c[0]), b(v.c[1]), b(v.c[2]), b(v.a * starA));
      this.starMesh.setColors32(st);
      this.starMesh.update(pc.PRIMITIVE_TRIANGLES);
    }
    for (const v of this.softBase) {
      const c = v.col === 'sun' ? sun : glow;
      sc.push(b(c[0]), b(c[1]), b(c[2]), b(v.a * sunA));
    }
    this.softMesh.setColors32(sc);
    this.softMesh.update(pc.PRIMITIVE_TRIANGLES);
    const lit = this.timeOfDay(skyColour(SKY.cloudLit, k), 'cloud');
    const shade = this.timeOfDay(skyColour(SKY.cloudShade, k), 'cloud');
    const cc: number[] = [];
    for (const v of this.cloudCols) {
      const c = v.lit ? lit : shade;
      cc.push(b(c[0]), b(c[1]), b(c[2]), b(Math.min(1, v.a * (0.85 + 0.15 * (1 - k)) * (1 + this.overcast * 0.6))));
    }
    this.cloudMesh.setColors32(cc);
    this.cloudMesh.update(pc.PRIMITIVE_TRIANGLES);
    this.builtClarity = k;
    this.builtNight = this.night;
    this.builtDusk = this.dusk;
    this.builtOvercast = this.overcast;
  }

  /** P7-E27.7: rebuilds the dome's colours on the next update (live tuning of SKY via look.apply()). */
  refresh() {
    this.builtClarity = -1;
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
    if (Math.abs(this.builtClarity - this.clarity) > 0.004 || Math.abs(this.builtNight - this.night) > 0.004 || Math.abs(this.builtDusk - this.dusk) > 0.004 || Math.abs(this.builtOvercast - this.overcast) > 0.004) this.recolour();
    const R = farClip * 0.97;
    this.root.setPosition(cam.x, cam.y, cam.z);
    this.root.setLocalScale(R, R, R);
    // Clouds drift slowly around the horizon (a full turn takes about 40 minutes).
    // E23.7.2: wind hurries them along
    this.drift += dt * 0.15 * (1 + this.wind * 5);
    if (!this.reducedMotion) this.clouds.setLocalEulerAngles(0, this.drift % 360, 0);
  }
}
