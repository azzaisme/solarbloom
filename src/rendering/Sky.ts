import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { CLOUDS, DAY_LIGHT, NIGHT_SKY, NIGHT_SKY_LIGHTS, SKY, SKY_BANDS, SKY_BANDS_NIGHT, SUN_MOON, TWILIGHT } from '../data/sky';
import { type CloudFrame, setCloudFrame, skyCloudMaterial } from './PaintedClouds';

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

/**
 * #twilight: a colour as it should look on screen, made ready for the sky's materials. Their vertex colours are
 * encoded to sRGB once more on output (see SKY), which pales and greys them, so a colour meant to land as written is
 * decoded first.
 */
function seen(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex);
  return [r ** 2.2, g ** 2.2, b ** 2.2];
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

/** #sunsets: a blended sky material whose colours are lit past 1 (the sun's and moon's discs), so the bloom catches them. */
function discMaterial(bright: number): pc.StandardMaterial {
  const m = skyMaterial(true);
  m.emissiveIntensity = bright;
  m.update();
  return m;
}

/** Elevation rings (degrees) of the dome; dense near the horizon where the colour changes fastest. */
const RINGS = [-40, -6, 0, 1.5, 3, 5, 8, 12, 16, 22, 32, 45, 60, 75, 90];
const SEGS = 36;

/**
 * Look 4.7: the sky. A vertex-coloured dome (zenith blue down to a warm band and the haze colour at the
 * horizon), a soft sun disc and glow placed along the key light, and painted clouds drifting slowly (#painted-clouds).
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
  /** #sunsets: toward the sun's and the moon's discs (DayNight); until set, the sun's sits along the key light */
  sunAt?: pc.Vec3;
  moonAt?: pc.Vec3;
  /** #sunsets: the sun disc's elevation (degrees), how much of a sunset there is, and how much of the moon shows */
  sunEl = 50;
  sunset = 0;
  moonShow = 0;
  /** #twilight: how much afterglow there is (DayNight), 0 … 1 */
  twilight = 0;
  private builtTwilight = -1;
  private moonDir = new pc.Vec3(0, -1, 0);
  private builtMoon = new pc.Vec3();
  private builtSunset = -1;
  private builtMoonShow = -1;
  private sunMesh: pc.Mesh;
  private sunBase: { core: boolean; a: number }[] = [];
  private moonMesh: pc.Mesh;
  private moonBase: { col: 'face' | 'maria' | 'halo'; a: number }[] = [];
  private sunDisc: pc.Entity;
  private moonDisc: pc.Entity;
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
    this.sunMesh = new pc.Mesh(device);
    this.moonMesh = new pc.Mesh(device);
    this.cloudMesh = new pc.Mesh(device);
    this.device = device;
    this.readSun();
    this.builtSun.copy(this.sunDir);
    this.buildSoft();
    this.buildMoon();
    this.buildCloudDome();
    this.soft = new pc.Entity('sky-soft');
    this.soft.addComponent('render', { meshInstances: [new pc.MeshInstance(this.softMesh, skyMaterial(true))], castShadows: false, receiveShadows: false, layers: [this.layer.id] });
    this.root.addChild(this.soft);
    // #sunsets: the sun's disc over its glow, lit past 1 so it blooms
    this.sunDisc = new pc.Entity('sky-sun');
    this.sunDisc.addComponent('render', { meshInstances: [new pc.MeshInstance(this.sunMesh, discMaterial(SUN_MOON.sun.bright))], castShadows: false, receiveShadows: false, layers: [this.layer.id] });
    this.root.addChild(this.sunDisc);
    // E23.7.5: the stars, under the clouds; hidden (no draw call) until night
    this.starMesh = new pc.Mesh(device);
    this.buildStars();
    this.stars = new pc.Entity('sky-stars');
    this.stars.addComponent('render', { meshInstances: [new pc.MeshInstance(this.starMesh, skyMaterial(true))], castShadows: false, receiveShadows: false, layers: [this.layer.id] });
    this.stars.render!.meshInstances[0].cull = false;
    this.stars.enabled = false;
    this.root.addChild(this.stars);
    // #sunsets: the moon, over the stars and under the clouds; hidden until night
    this.moonDisc = new pc.Entity('sky-moon');
    this.moonDisc.addComponent('render', { meshInstances: [new pc.MeshInstance(this.moonMesh, discMaterial(SUN_MOON.moon.bright))], castShadows: false, receiveShadows: false, layers: [this.layer.id] });
    this.moonDisc.enabled = false;
    this.root.addChild(this.moonDisc);
    this.clouds = new pc.Entity('sky-clouds');
    this.root.addChild(this.clouds);
    this.clouds.addComponent('render', { meshInstances: [new pc.MeshInstance(this.cloudMesh, skyCloudMaterial(device))], castShadows: false, receiveShadows: false, layers: [this.layer.id] });
    for (const mi of [...this.dome.render!.meshInstances, ...this.soft.render!.meshInstances, ...this.sunDisc.render!.meshInstances, ...this.moonDisc.render!.meshInstances, ...this.clouds.render!.meshInstances]) mi.cull = false; // the dome surrounds the camera
    // #sunsets: everything blended here sits round the camera at the same distance, so the order is set by hand:
    // the sun's glow, its disc over that, the stars, the moon over them, the clouds in front of it all
    this.layer.transparentSortMode = pc.SORTMODE_MANUAL;
    [this.soft, this.sunDisc, this.stars, this.moonDisc, this.clouds].forEach((e, i) => {
      for (const mi of e.render!.meshInstances) mi.drawOrder = i + 1;
    });
  }

  private stars: pc.Entity;
  private starMesh: pc.Mesh;
  private starCols: { c: [number, number, number]; a: number }[] = [];
  private clouds: pc.Entity;
  private cloudMesh: pc.Mesh;
  private device: pc.GraphicsDevice;
  /** #painted-clouds: this frame's clouds (their colours are rebuilt with the sky's; the sun, eye and drift every frame) */
  private cloudFrame: CloudFrame = {
    lit: [1, 1, 1],
    shade: [0.7, 0.75, 0.85],
    glow: [1, 0.6, 0.3],
    glowFar: [0.9, 0.4, 0.5],
    top: [0.5, 0.45, 0.6],
    horizon: [0.8, 0.85, 0.9],
    sun: new pc.Vec3(0, 1, 0),
    under: 0,
    overcast: 0,
    drift: [0, 0],
    eye: new pc.Vec3(),
  };

  /** Direction toward the sun (DayNight's disc, else opposite the key light's travel: a directional light shines down its −Y). */
  private readSun() {
    this.sunDir.copy(this.sunAt ?? this.sun.up).normalize();
    if (this.moonAt) this.moonDir.copy(this.moonAt).normalize();
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
   * #painted-clouds: the dome the clouds are painted on (PaintedClouds): just the sky above the horizon, a little
   * inside the sky's own dome. The shader works out each pixel's direction from its position, so it can be coarse.
   */
  private buildCloudDome() {
    const pos: number[] = [];
    const idx: number[] = [];
    const rings = [-1, 1, 2.5, 4, 6, 9, 13, 18, 25, 35, 50, 70, 90];
    const segs = 32;
    for (const e of rings) {
      const el = (e * Math.PI) / 180;
      for (let s = 0; s <= segs; s++) {
        const az = (s / segs) * Math.PI * 2;
        pos.push(Math.cos(el) * Math.sin(az) * 0.99, Math.sin(el) * 0.99, Math.cos(el) * Math.cos(az) * 0.99);
      }
    }
    for (let r = 0; r < rings.length - 1; r++)
      for (let s = 0; s < segs; s++) {
        const i = r * (segs + 1) + s;
        idx.push(i, i + 1, i + segs + 1, i + 1, i + segs + 2, i + segs + 1);
      }
    this.cloudMesh.setPositions(pos);
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

  /** The sun's glow and its disc (rebuilt as the sun moves). The disc is cut flat by the horizon as it sets. */
  private buildSoft() {
    const pos: number[] = [];
    const idx: number[] = [];
    this.softBase = [];
    const d = this.sunDir;
    this.fan(pos, idx, d, 0.32, 1, 1, 24, () => this.softBase.push({ col: 'glow', a: 0.55 }), () => this.softBase.push({ col: 'glow', a: 0 }));
    this.fan(pos, idx, d, 0.09, 1, 1, 20, () => this.softBase.push({ col: 'glow', a: 0.85 }), () => this.softBase.push({ col: 'glow', a: 0 }));
    this.softMesh.setPositions(pos);
    this.softMesh.setColors32(new Array((pos.length / 3) * 4).fill(255));
    this.softMesh.setIndices(idx);
    this.softMesh.update(pc.PRIMITIVE_TRIANGLES);
    const sp: number[] = [];
    const si: number[] = [];
    this.sunBase = [];
    const R = SUN_MOON.sun.radius;
    this.fan(sp, si, d, R * 1.6, 1, 1, 28, () => this.sunBase.push({ core: false, a: 0.9 }), () => this.sunBase.push({ core: false, a: 0 }));
    this.fan(sp, si, d, R, 1, 1, 28, () => this.sunBase.push({ core: true, a: 1 }), () => this.sunBase.push({ core: true, a: 1 }));
    for (let i = 1; i < sp.length; i += 3) sp[i] = Math.max(0, sp[i]); // the horizon cuts it off flat as it sinks
    this.sunMesh.setPositions(sp);
    this.sunMesh.setColors32(new Array((sp.length / 3) * 4).fill(255));
    this.sunMesh.setIndices(si);
    this.sunMesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  /**
   * #sunsets: the moon: a soft halo, a pale face and a few darker seas on it (fixed, so it is always the same moon),
   * turned to face the centre at the moon's heading. Rebuilt as the moon moves.
   */
  private buildMoon() {
    const pos: number[] = [];
    const idx: number[] = [];
    this.moonBase = [];
    const d = this.moonDir;
    const R = SUN_MOON.moon.radius;
    this.fan(pos, idx, d, R * 3.2, 1, 1, 24, () => this.moonBase.push({ col: 'halo', a: 0.35 }), () => this.moonBase.push({ col: 'halo', a: 0 }));
    this.fan(pos, idx, d, R, 1, 1, 32, () => this.moonBase.push({ col: 'face', a: 1 }), () => this.moonBase.push({ col: 'face', a: 1 }));
    const up = Math.abs(d.y) > 0.98 ? new pc.Vec3(1, 0, 0) : new pc.Vec3(0, 1, 0);
    const right = new pc.Vec3().cross(up, d).normalize();
    const u = new pc.Vec3().cross(d, right).normalize();
    // the seas: [across, up, size] in moon radii, a soft-edged blotch each
    const seas: [number, number, number][] = [
      [-0.3, 0.32, 0.36],
      [0.12, 0.42, 0.26],
      [0.34, 0.08, 0.3],
      [-0.12, -0.06, 0.24],
      [0.05, -0.45, 0.2],
      [-0.42, -0.28, 0.16],
    ];
    for (const [x, y, r] of seas) {
      const c = new pc.Vec3(d.x + (right.x * x + u.x * y) * R, d.y + (right.y * x + u.y * y) * R, d.z + (right.z * x + u.z * y) * R).normalize();
      this.fan(pos, idx, c, r * R, 1, 1, 14, () => this.moonBase.push({ col: 'maria', a: 0.75 }), () => this.moonBase.push({ col: 'maria', a: 0.1 }));
    }
    this.moonMesh.setPositions(pos);
    this.moonMesh.setColors32(new Array((pos.length / 3) * 4).fill(255));
    this.moonMesh.setIndices(idx);
    this.moonMesh.update(pc.PRIMITIVE_TRIANGLES);
  }

  /** How much of the sun's glow warms the day sky: none at night or under heavy cloud. */
  private sunShow(): number {
    return (1 - this.night) * (1 - this.overcast * 0.9);
  }

  /** #sunsets: how much of the sun's disc shows: all of it until it has sunk below the horizon, none under heavy cloud. */
  private sunDiscShow(): number {
    const r = (SUN_MOON.sun.radius * 180) / Math.PI;
    return smooth((this.sunEl + r) / (2 * r)) * (1 - this.overcast * 0.9);
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
    let low = mix(glow, upper, 0.35);
    let high = mix(upper, zen, 0.6);
    // #sunsets: the sea mirrors the sunset's warm band (low) and a little of it higher up
    if (this.sunset > 0) {
      const S = SUN_MOON.sunset;
      low = mix(low, mix(rgb(S.orange), rgb(S.gold), 0.4), this.sunset * DAY_LIGHT.seaWarm);
      high = mix(high, rgb(S.rose), this.sunset * DAY_LIGHT.seaWarm * 0.4);
    }
    // #twilight: magenta low on the water, violet higher up
    if (this.twilight > 0) {
      low = mix(low, rgb(TWILIGHT.seaLow), this.twilight * 0.85);
      high = mix(high, rgb(TWILIGHT.seaHigh), this.twilight * 0.85);
    }
    return { low, high };
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
    // (decoded like the dome's colours: by night the fog is matched to the sky as it is seen, see horizonSeen)
    if (this.twilight > 0 && band === 'haze') out = mix(out, seen(TWILIGHT.haze), this.twilight);
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
    // #sunsets: with the sun low, a warm band along the horizon on its side: gold close by, orange along the
    // horizon, rose further round, fading up the sky. Laid over night's blue, so dusk keeps its deep sky overhead.
    if (this.sunset > 0.002) {
      const S = SUN_MOON.sunset;
      const hl = Math.hypot(d[0], d[2]) * Math.hypot(s.x, s.z);
      const flat = hl > 1e-6 ? (d[0] * s.x + d[2] * s.z) / hl : 0; // −1 opposite … 1 toward the sun, round the horizon
      const toward = smooth((flat + 0.35) / 1.35);
      const low = 1 - smooth(el / (S.height * (0.55 + 0.45 * toward)));
      const band = mix(rgb(S.rose), rgb(S.orange), smooth((flat - 0.1) / 0.8));
      const amt = this.sunset * S.strength * low * (0.25 + 0.75 * toward) * (0.55 + 0.45 * k);
      c = mix(c, band, amt);
      const near = Math.pow(Math.max(0, cos), 10);
      c = mix(c, rgb(S.gold), Math.min(0.8, near * this.sunset * 1.1));
    }
    // E27.1: the lowest few degrees ease into the colour the fogged distance lands on, so the far sea meets the sky softly
    const band = LOOK.horizon.skyBand;
    if (el < band) c = mix(seen, c, smooth(el / band));
    // #twilight: the afterglow over it all, down to the horizon itself: a bright line where the dark sea meets the sky
    if (this.twilight > 0.002) c = mix(c, this.afterglow(el, d), this.twilight * TWILIGHT.strength * (0.7 + 0.3 * k));
    return c;
  }

  /**
   * #twilight: the afterglow's colour in a direction at `el` degrees: orange on the horizon on the sun's side, hot
   * magenta above it, purple higher, deep violet overhead; the far side of the sky a darker blue-violet.
   */
  private afterglow(el: number, d: [number, number, number]): [number, number, number] {
    const T = TWILIGHT.sky;
    const s = this.sunDir;
    const hl = Math.hypot(d[0], d[2]) * Math.hypot(s.x, s.z);
    const flat = hl > 1e-6 ? (d[0] * s.x + d[2] * s.z) / hl : 0;
    const side = smooth((flat - (1 - 2 * T.spread)) / (2 * T.spread));
    const hz = mix(seen(T.horizonFar), seen(T.horizon), side * side);
    const bd = mix(seen(T.bandFar), seen(T.band), side);
    const md = mix(seen(T.midFar), seen(T.mid), side * 0.8);
    const top = seen(T.top);
    if (el < T.bandAt) {
      // the hot glow right where the sun went down
      const near = Math.pow(Math.max(0, flat), 24) * (1 - smooth(el / T.bandAt));
      return mix(mix(hz, bd, smooth(el / T.bandAt)), seen(T.glow), near);
    }
    if (el < T.midAt) return mix(bd, md, smooth((el - T.bandAt) / (T.midAt - T.bandAt)));
    return mix(md, top, smooth((el - T.midAt) / (T.topAt - T.midAt)));
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
    // #sunsets: the sun's glow and disc turn gold to deep orange as it nears the horizon
    const U = SUN_MOON.sun;
    const set = this.sunset;
    const lowness = 1 - smooth(this.sunEl / SUN_MOON.sunset.from);
    const glow = mix(this.timeOfDay(skyColour(SKY.sunGlow, k), 'sun'), rgb(U.lowGlow), set);
    const core = mix(rgb(U.core), rgb(U.low), lowness);
    const sc: number[] = [];
    // The sun fades behind the fog: weaker while the city is grey (and gone under cloud).
    const disc = this.sunDiscShow();
    const sunA = (0.45 + 0.55 * k) * Math.max(this.sunShow(), set) * smooth((this.sunEl + 6) / 6) * (1 - this.overcast * 0.9);
    const starA = this.starShow();
    this.stars.enabled = starA > 0.01;
    if (this.stars.enabled) {
      const st: number[] = [];
      for (const v of this.starCols) st.push(b(v.c[0]), b(v.c[1]), b(v.c[2]), b(v.a * starA));
      this.starMesh.setColors32(st);
      this.starMesh.update(pc.PRIMITIVE_TRIANGLES);
    }
    for (const v of this.softBase) sc.push(b(glow[0]), b(glow[1]), b(glow[2]), b(v.a * sunA));
    this.softMesh.setColors32(sc);
    this.softMesh.update(pc.PRIMITIVE_TRIANGLES);
    const discA = (0.6 + 0.4 * k) * disc;
    this.sunDisc.enabled = discA > 0.01;
    if (this.sunDisc.enabled) {
      const dc2: number[] = [];
      for (const v of this.sunBase) {
        const c = v.core ? core : glow;
        dc2.push(b(c[0]), b(c[1]), b(c[2]), b(v.a * discA));
      }
      this.sunMesh.setColors32(dc2);
      this.sunMesh.update(pc.PRIMITIVE_TRIANGLES);
    }
    const M = SUN_MOON.moon;
    const moonA = this.moonShow * smooth((this.moonDir.y + 0.02) / 0.06);
    this.moonDisc.enabled = moonA > 0.01;
    if (this.moonDisc.enabled) {
      const face = rgb(M.colour);
      const maria = rgb(M.maria);
      const halo = rgb(M.halo);
      const mc: number[] = [];
      for (const v of this.moonBase) {
        const c = v.col === 'face' ? face : v.col === 'maria' ? maria : halo;
        mc.push(b(c[0]), b(c[1]), b(c[2]), b(v.a * moonA));
      }
      this.moonMesh.setColors32(mc);
      this.moonMesh.update(pc.PRIMITIVE_TRIANGLES);
    }
    this.recolourClouds();
    this.builtClarity = k;
    this.builtNight = this.night;
    this.builtDusk = this.dusk;
    this.builtOvercast = this.overcast;
    this.builtSunset = this.sunset;
    this.builtMoonShow = this.moonShow;
    this.builtTwilight = this.twilight;
  }

  /**
   * #sky-clouds: how much the low sun lights the clouds from underneath (0 … 1): through sunset and on into the
   * afterglow, muted by heavy cloud as the sunset itself is.
   */
  private underGlow(): number {
    return Math.min(1, Math.max(this.sunset, this.twilight * (1 - this.overcast * 0.5)));
  }

  /**
   * The clouds' colours for the time of day (PaintedClouds shades with them): ivory where they face the sun and a
   * blue-grey body by day, greyer under heavy cloud, dim blue by night. With the sun low they are lit from below
   * (gold toward it, rose further round; magenta in the afterglow) with dusky tops on their thick cores.
   */
  private recolourClouds() {
    const k = this.clarity;
    const f = this.cloudFrame;
    f.lit = this.timeOfDay(skyColour(SKY.cloudLit, k), 'cloud');
    f.shade = this.timeOfDay(skyColour(SKY.cloudShade, k), 'cloud');
    const S = SUN_MOON.sunset;
    const T = TWILIGHT;
    // the afterglow's share of the light under the clouds (sunset's gold and rose, then the afterglow's magenta)
    const late = this.twilight / Math.max(1e-6, this.twilight + this.sunset);
    f.glow = mix(seen(S.cloudUnder), seen(T.cloudUnder), late);
    f.glowFar = mix(seen(S.cloudUnderFar), seen(T.cloudUnderFar), late);
    f.top = mix(seen(S.cloudTop), seen(T.cloudTop), late);
    f.under = this.underGlow();
    f.overcast = this.overcast;
    f.horizon = this.horizonSeen();
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
    if (this.builtMoon.distance(this.moonDir) > 1e-3) {
      this.builtMoon.copy(this.moonDir);
      this.buildMoon();
      this.builtClarity = -1;
    }
    if (Math.abs(this.builtClarity - this.clarity) > 0.004 || Math.abs(this.builtNight - this.night) > 0.004 || Math.abs(this.builtDusk - this.dusk) > 0.004 || Math.abs(this.builtOvercast - this.overcast) > 0.004 || Math.abs(this.builtSunset - this.sunset) > 0.004 || Math.abs(this.builtMoonShow - this.moonShow) > 0.004 || Math.abs(this.builtTwilight - this.twilight) > 0.004) this.recolour();
    const R = farClip * 0.97;
    this.root.setPosition(cam.x, cam.y, cam.z);
    this.root.setLocalScale(R, R, R);
    // #painted-clouds: the clouds drift very slowly across the sky; E23.7.2: wind hurries them along
    const f = this.cloudFrame;
    if (!this.reducedMotion) {
      const w = 1 + this.wind * CLOUDS.wind;
      f.drift[0] += dt * CLOUDS.drift[0] * w;
      f.drift[1] += dt * CLOUDS.drift[1] * w;
    }
    f.sun.copy(this.sunDir);
    f.eye.copy(cam);
    setCloudFrame(this.device, f);
  }
}
