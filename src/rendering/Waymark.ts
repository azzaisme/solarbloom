import * as pc from 'playcanvas';
import { levelY } from '../core/Height';
import type { GoalKind } from '../gameplay/Advisor';
import type { Sim } from '../gameplay/Sim';
import { WAYMARK } from '../data/waymark';
import type { GoalSpot } from '../ui/GoalSpot';
import { doneHere, emblemBacking, emblemFrame, emblemSymbol, HEART, type Flat, type Spot } from './Emblem';
import { setBloomWave } from './Foliage';
import { PALETTE } from './Materials';
import { SLAB_TOP } from './SceneBuilder';
import { group } from './Shapes';

/** sRGB hex to linear 0 … 255 (vertex colours feed the emissive in linear space). */
function lin(hex: string): [number, number, number] {
  const c = new pc.Color().fromString(hex);
  return [c.r, c.g, c.b].map((v) => Math.round(Math.pow(v, 2.2) * 255)) as [number, number, number];
}

/** A vertex for the light meshes: position, linear colour (0 … 255) and opacity (0 … 1). */
type V = [x: number, y: number, z: number, rgb: [number, number, number], alpha: number];

function lightMesh(device: pc.GraphicsDevice, verts: V[], idx: number[]): pc.Mesh {
  const mesh = new pc.Mesh(device);
  mesh.setPositions(verts.flatMap((v) => [v[0], v[1], v[2]]));
  mesh.setNormals(verts.flatMap(() => [0, 0, 1]));
  mesh.setColors32(verts.flatMap((v) => [...v[3], Math.round(Math.max(0, Math.min(1, v[4])) * 255)]));
  mesh.setIndices(idx);
  mesh.update();
  return mesh;
}

/** An emblem shape (Emblem.ts, sRGB per vertex) as an upright light mesh in x/y. */
function flatMesh(device: pc.GraphicsDevice, f: Flat): pc.Mesh {
  const verts: V[] = [];
  for (let i = 0; i < f.pos.length / 2; i++) {
    const [r, g, b, a] = f.col.slice(i * 4, i * 4 + 4);
    verts.push([f.pos[i * 2], f.pos[i * 2 + 1], 0, [r, g, b].map((v) => Math.round(Math.pow(v, 2.2) * 255)) as [number, number, number], a]);
  }
  return lightMesh(device, verts, f.idx);
}

/**
 * Light, not paint: emissive from the vertex colours, see-through by the vertex alpha, and added on top of what is
 * behind it (so it only ever brightens the world, and never muddies to brown over sand or haze).
 */
function lightMaterial(intensity: number, paint = false): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.useLighting = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(1, 1, 1);
  m.emissiveIntensity = intensity;
  m.emissiveVertexColor = true;
  m.emissiveVertexColorChannel = 'rgb';
  m.opacityVertexColor = true;
  m.opacityVertexColorChannel = 'a';
  // paint (the emblem's dark backing) covers what is behind it, so the light on top of it reads by day
  m.blendType = paint ? pc.BLEND_NORMAL : pc.BLEND_ADDITIVEALPHA;
  m.depthWrite = false;
  m.useFog = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

/**
 * The shaft: two upright sheets that turn to face the camera, a wide soft mint glow and a narrow white core inside it,
 * brightest at the foot and fading out sideways and towards the top, high into the sky.
 */
function beamMesh(device: pc.GraphicsDevice): pc.Mesh {
  const B = WAYMARK.beam;
  const verts: V[] = [];
  const idx: number[] = [];
  const sheet = (foot: number, top: number, hex: string, edge: string, rows: [number, number][], cols: [number, number][]) => {
    const base = verts.length;
    const [c, e] = [lin(hex), lin(edge)];
    for (const [v, va] of rows) {
      const half = foot + (top - foot) * v;
      for (const [u, ua] of cols) verts.push([u * half, v * B.height, 0, Math.abs(u) > 0.7 ? e : c, va * ua]);
    }
    const n = cols.length;
    for (let r = 0; r < rows.length - 1; r++)
      for (let k = 0; k < n - 1; k++) {
        const a = base + r * n + k;
        idx.push(a, a + 1, a + n + 1, a, a + n + 1, a + n);
      }
  };
  const cols: [number, number][] = [
    [-1, 0],
    [-0.5, 0.45],
    [0, 1],
    [0.5, 0.45],
    [1, 0],
  ];
  sheet(B.footWidth, B.topWidth, PALETTE.signal.waymarkGlow, PALETTE.signal.waymarkGlow, [[0, 0.5], [0.02, 0.62], [0.15, 0.5], [0.45, 0.32], [0.75, 0.14], [1, 0]], cols);
  sheet(B.coreFoot, B.coreTop, PALETTE.signal.waymarkCore, PALETTE.signal.waymarkGlow, [[0, 0.7], [0.02, 1], [0.2, 0.9], [0.5, 0.6], [0.8, 0.25], [1, 0]], cols);
  return lightMesh(device, verts, idx);
}

/** The ring on the ground: a faint fill and a bright soft edge, flat at y = 0. Radius 1 (scaled). */
function ringMesh(device: pc.GraphicsDevice, hex: string, bands: [number, number][]): pc.Mesh {
  const SEG = 40;
  const c = lin(hex);
  const verts: V[] = [];
  for (const [r, a] of bands)
    for (let k = 0; k < SEG; k++) {
      const t = (k / SEG) * Math.PI * 2;
      verts.push([Math.cos(t) * r, 0, Math.sin(t) * r, c, a]);
    }
  const idx: number[] = [];
  for (let b = 0; b < bands.length - 1; b++)
    for (let k = 0; k < SEG; k++) {
      const a = b * SEG + k;
      const d = b * SEG + ((k + 1) % SEG);
      idx.push(a, d, d + SEG, a, d + SEG, a + SEG);
    }
  return lightMesh(device, verts, idx);
}

/** The gold ribbon: a strip winding up round the shaft from the emblem's middle, faint at both ends. */
function ribbonMesh(device: pc.GraphicsDevice): pc.Mesh {
  const B = WAYMARK.beam;
  // it starts from the lotus's heart, where it stands at the beam's foot
  const y0 = WAYMARK.emblem.lift + HEART.y * WAYMARK.emblem.size;
  const N = 120;
  const c = lin(PALETTE.signal.waymarkRibbon);
  const verts: V[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = t * B.ribbonTurns * Math.PI * 2;
    const r = 0.06 + 0.46 * Math.min(1, t * 5);
    const y = y0 + t * (B.ribbonTop - y0);
    const alpha = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.6) * (t < 0.04 ? t / 0.04 : 1);
    const w = (B.ribbonWidth / 2) * (1 - 0.5 * t);
    verts.push([Math.cos(a) * r, y - w, Math.sin(a) * r, c, alpha]);
    verts.push([Math.cos(a) * r, y + w, Math.sin(a) * r, c, alpha]);
    if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
  }
  return lightMesh(device, verts, idx);
}

/** A glowing leaf drifting up the shaft: pointed at both ends, a little curl along its middle. */
function leafMesh(device: pc.GraphicsDevice, hex: string): pc.Mesh {
  const c = lin(hex);
  const verts: V[] = [
    [0, 0, 0, c, 0.9],
    [0, -0.1, 0, c, 0.5],
    [0.045, 0, 0.012, c, 0.7],
    [0, 0.1, 0, c, 0.5],
    [-0.045, 0, 0.012, c, 0.7],
  ];
  return lightMesh(device, verts, [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]);
}

/** Shared meshes (built once per device): every view of the waymark and every glow it leaves draws from these. */
interface Meshes {
  beam: pc.Mesh;
  ring: pc.Mesh;
  wave: pc.Mesh;
  ribbon: pc.Mesh;
  leaves: pc.Mesh[];
  frame: pc.Mesh;
  backing: pc.Mesh;
  /** each kind's symbol: painted (with the body) and glowing (with the light) */
  symbols: Map<GoalKind, { paint: pc.Mesh; light: pc.Mesh }>;
}

/** Sorts a mesh as a little further from (`by` > 0) or nearer to (`by` < 0) the camera than it is. */
function sortNudge(mi: pc.MeshInstance, by: number) {
  mi.calculateSortDistance = (m: pc.MeshInstance, pos: pc.Vec3, fwd: pc.Vec3) => {
    const c = m.aabb.center;
    return (c.x - pos.x) * fwd.x + (c.y - pos.y) * fwd.y + (c.z - pos.z) * fwd.z + by;
  };
}

/**
 * The lotus in the world, standing upright and turned to the camera, drawn in outline: its painted gold line (solid
 * by day) with the light along it on top, and the goal's symbol, painted and glowing the same way, in its centre petal.
 */
class EmblemView {
  root: pc.Entity;
  body: pc.Entity;
  frame: pc.Entity;
  symbol: pc.Entity;
  backing: pc.Entity;
  mat: pc.StandardMaterial;
  backMat: pc.StandardMaterial;
  kind?: GoalKind;

  constructor(
    parent: pc.Entity,
    private meshes: Meshes,
  ) {
    this.root = group(parent, 'emblem');
    this.body = group(this.root, 'lotus');
    this.mat = lightMaterial(WAYMARK.beam.glow);
    this.backMat = lightMaterial(1, true);
    // the body writes depth, so the distance haze (read from depth) sees the lotus where it stands, not the sky behind it
    this.backMat.depthWrite = true;
    this.backMat.update();
    this.backing = group(this.body, 'backing');
    this.backing.setLocalPosition(0, 0, -0.005);
    const back = new pc.MeshInstance(meshes.backing, this.backMat);
    // the painted line is drawn first, the light over it
    sortNudge(back, 0.5);
    this.backing.addComponent('render', { meshInstances: [back], castShadows: false, receiveShadows: false });
    this.frame = group(this.body, 'frame');
    this.frame.addComponent('render', { meshInstances: [new pc.MeshInstance(meshes.frame, this.mat)], castShadows: false, receiveShadows: false });
    this.symbol = group(this.body, 'symbol');
    this.symbol.setLocalPosition(HEART.x, HEART.y, 0.01);
    this.symbol.setLocalScale(HEART.scale, HEART.scale, 1);
    this.symbol.addComponent('render', { meshInstances: this.mark('spot'), castShadows: false, receiveShadows: false });
  }

  /** The symbol: painted with the body (drawn first, under the light), then glowing with the light. */
  private mark(kind: GoalKind): pc.MeshInstance[] {
    const m = this.meshes.symbols.get(kind) ?? this.meshes.symbols.get('spot')!;
    const paint = new pc.MeshInstance(m.paint, this.backMat);
    sortNudge(paint, 0.5);
    return [paint, new pc.MeshInstance(m.light, this.mat)];
  }

  setKind(kind: GoalKind) {
    if (this.kind === kind) return;
    this.kind = kind;
    this.symbol.render!.meshInstances = this.mark(kind);
  }

  /**
   * `settle` 0: raised at the beam's foot … 1: sitting on the spot, a little bigger. `open`: how far the petals are
   * open (1 open, less as a bud, more for the pulse's pop). `yaw`: towards the camera (degrees). `sink`: 0 … 1 as a
   * glow sinks away into the ground.
   */
  pose(settle: number, open: number, yaw: number, sink = 0) {
    const E = WAYMARK.emblem;
    const s = E.size + (E.sealSize - E.size) * settle;
    this.root.setLocalEulerAngles(0, yaw, 0);
    this.body.setLocalPosition(0, E.lift + (E.sealLift - E.lift) * settle - sink * s * 0.5, 0);
    this.body.setLocalScale(s, s, s);
    // a bud is narrow and a little short; open, it fans wide
    this.frame.setLocalScale(open, 0.8 + 0.2 * Math.min(open, 1.2), 1);
  }

  /** `backing`: how solid the painted body under the light is (1 by day, less at night). */
  light(opacity: number, intensity: number, backing = 1) {
    this.mat.opacity = opacity;
    this.mat.emissiveIntensity = intensity;
    this.mat.update();
    this.backMat.opacity = opacity * backing;
    this.backMat.update();
  }

  destroy() {
    this.root.destroy();
    this.mat.destroy();
    this.backMat.destroy();
  }
}

/** A goal done: its emblem's Bloom Pulse, then the soft glow it leaves on the spot until it sinks away. */
interface Glow {
  root: pc.Entity;
  emblem: EmblemView;
  wave: pc.Entity;
  waveMat: pc.StandardMaterial;
  age: number;
  released: boolean;
  /** world position of the spot */
  at: pc.Vec3;
  kind: GoalKind;
}

const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/**
 * E24 (#609), reworked: the waymark. The beam says where to go; the emblem says what for.
 *
 * From afar, a tall shaft of mint light stands on the current goal (the place the minimap's pin marks), a white core
 * in a soft glow, with a gold ribbon winding up it and glowing leaves drifting through it. At its foot the emblem
 * stands upright, turned to the camera: a ring of petals round a symbol for the goal's kind (Emblem.ts). As bloombot
 * walks in, the shaft fades away and the emblem settles onto the spot as a glowing seal. When the goal is done the
 * seal lets go one Bloom Pulse (a gold-green flash, a ring of light racing over the ground that the grass and flowers
 * lean from, sparks and leaves, a chime) and keeps a soft glow there for a while; the next goal's beam rises after it.
 * Reduced motion keeps everything still: no ribbon turning, no drifting leaves, no ring or sparks in the pulse.
 */
export class Waymark {
  private root: pc.Entity;
  private beam: pc.Entity;
  private ring: pc.Entity;
  private ribbon: pc.Entity;
  private leaves: pc.Entity[] = [];
  private emblem: EmblemView;
  private beamMat: pc.StandardMaterial;
  private ringMat: pc.StandardMaterial;
  private ribbonMat: pc.StandardMaterial;
  private meshes: Meshes;
  private glows: Glow[] = [];
  private worldParent: pc.Entity;
  private time = 0;
  /** 0 … 1: how far it has faded in */
  private shown = 0;
  /** where it stands now (the goal it fades towards may be elsewhere) */
  private at?: Spot;
  /** it has shown fully at `at` (only a goal the player could see blooms when done) */
  private seen = false;
  /** after a pulse, the next beam waits this long (s) */
  private wait = 0;
  reducedMotion = false;
  /** true while a vista or cutscene has the camera: a Bloom Pulse waits for it */
  held = false;
  /** how solid the lotus's painted body is now (by day … at night) */
  private backing = 1;
  /** how brightly the lotus itself glows now (less by day, so its gold shows; full at night) */
  private lotusLight = 1;
  /** the moment a pulse lets go: where, and for what (the game adds sparks and the chime) */
  onPulse?: (at: pc.Vec3, kind: GoalKind) => void;

  constructor(
    private sim: Sim,
    parent: pc.Entity,
  ) {
    const device = pc.AppBase.getApplication()!.graphicsDevice;
    this.worldParent = parent;
    const symbols = new Map<GoalKind, { paint: pc.Mesh; light: pc.Mesh }>();
    for (const k of ['rest', 'pile', 'park', 'fountain', 'gate', 'keeper', 'landmark', 'machine', 'spot'] as GoalKind[])
      symbols.set(k, { paint: flatMesh(device, emblemSymbol(k, 'paint')), light: flatMesh(device, emblemSymbol(k, 'light')) });
    this.meshes = {
      beam: beamMesh(device),
      ring: ringMesh(device, PALETTE.signal.waymarkRing, [[0, 0.22], [0.62, 0.1], [0.84, 0.75], [0.92, 0.95], [1, 0]]),
      wave: ringMesh(device, PALETTE.signal.bloomPulse, [[0.55, 0], [0.82, 0.35], [0.94, 1], [1, 0]]),
      ribbon: ribbonMesh(device),
      leaves: [leafMesh(device, PALETTE.signal.waymarkLeaf), leafMesh(device, PALETTE.signal.waymarkLeafGold)],
      frame: flatMesh(device, emblemFrame()),
      backing: flatMesh(device, emblemBacking()),
      symbols,
    };
    for (const m of [...Object.values(this.meshes).flat(), ...[...symbols.values()].flatMap((x) => [x.paint, x.light])]) if (m instanceof pc.Mesh) m.incRefCount();
    this.root = group(parent, 'waymark');
    const B = WAYMARK.beam;
    this.beamMat = lightMaterial(B.glow);
    this.ringMat = lightMaterial(B.glow);
    this.ribbonMat = lightMaterial(B.glow);
    this.beam = group(this.root, 'beam');
    this.beam.addComponent('render', { meshInstances: [new pc.MeshInstance(this.meshes.beam, this.beamMat)], castShadows: false, receiveShadows: false });
    this.ring = group(this.root, 'ring');
    this.ring.setLocalPosition(0, 0.03, 0);
    this.ring.setLocalScale(B.ring, 1, B.ring);
    this.ring.addComponent('render', { meshInstances: [new pc.MeshInstance(this.meshes.ring, this.ringMat)], castShadows: false, receiveShadows: false });
    this.ribbon = group(this.root, 'ribbon');
    this.ribbon.addComponent('render', { meshInstances: [new pc.MeshInstance(this.meshes.ribbon, this.ribbonMat)], castShadows: false, receiveShadows: false });
    for (let i = 0; i < B.leaves; i++) {
      const e = group(this.root, `leaf-${i}`);
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(this.meshes.leaves[i % 2], this.ribbonMat)], castShadows: false, receiveShadows: false });
      this.leaves.push(e);
    }
    this.emblem = new EmblemView(this.root, this.meshes);
    this.root.enabled = false;
  }

  /** Gone at once (photo mode: nothing of the game's pointers in the picture), and any glow left behind with it. */
  hide() {
    this.shown = 0;
    this.root.enabled = false;
    for (const g of this.glows) this.dropGlow(g);
    this.glows = [];
    setBloomWave(0, 0, 0, 0);
  }

  /** Where it is standing, while it shows (tests and screenshots read it). */
  get place(): { roofId: string; x: number; z: number } | undefined {
    return this.root.enabled ? this.at : undefined;
  }

  /** What the review shots and tests read: the beam's share (1 far … 0 arrived), the emblem's kind, glows left. */
  get state() {
    return { shown: this.shown, beam: this.beamShare, kind: this.emblem.kind, glows: this.glows.length, pulsing: this.glows.some((g) => g.age < WAYMARK.pulse.waveTime + WAYMARK.pulse.gather) };
  }

  private beamShare = 1;
  private bot?: { roofId: string; x: number; z: number };
  private camera = new pc.Vec3();

  /**
   * The game did something that finishes goals of `kinds` (a gate opened, a pile dug, a landmark woken…), at `where`
   * when it knows. If that was the goal the waymark stands on, the seal lets go its Bloom Pulse and the next beam
   * waits for it. True if it bloomed.
   */
  done(kinds: readonly GoalKind[], where?: { roofId?: string; x: number; z: number }): boolean {
    if (!doneHere(this.at, kinds, where, this.bot, WAYMARK.pulse.reach, this.seen)) return false;
    this.bloom();
    this.at = undefined;
    this.seen = false;
    this.shown = 0;
    this.wait = WAYMARK.pulse.wait;
    return true;
  }

  /** The world position of a spot on its layer (the top of its tile). */
  private worldOf(s: { roofId: string; x: number; z: number }): pc.Vec3 | undefined {
    const layer = this.sim.grid.layer(s.roofId);
    if (!layer) return undefined;
    const lv = this.sim.grid.peek(s.roofId, Math.floor(s.x), Math.floor(s.z))?.level;
    return new pc.Vec3(layer.origin[0] + s.x, layer.origin[1] + layer.height + SLAB_TOP + (lv !== undefined ? levelY(lv) : 0), layer.origin[2] + s.z);
  }

  /**
   * Each frame. `goal`: the current goal, or undefined to fade out. `show`: false while something else owns the
   * screen (building, photo mode, a cutscene). `bot`: bloombot's cell position (the beam fades as bloombot arrives).
   * `camera`: the camera's world position (the shaft and the emblem turn to face it). `night`: 0 by day … 1 at night.
   */
  update(dt: number, goal: GoalSpot | undefined, show: boolean, bot: { roofId: string; x: number; z: number } | undefined, camera: pc.Vec3, night: number) {
    this.time += dt;
    const B = WAYMARK.beam;
    const dark = Math.max(0, Math.min(1, night));
    const glow = B.glow + (B.nightGlow - B.glow) * dark;
    const E = WAYMARK.emblem;
    this.backing = E.backing + (E.nightBacking - E.backing) * dark;
    this.lotusLight = E.dayLight + (1 - E.dayLight) * dark;
    // a pulse waits while a vista or cutscene has the camera, so it plays where the player can see it
    this.updateGlows(this.held ? 0 : dt, glow);
    const next: Spot | undefined = goal ? { roofId: goal.roofId, x: goal.x, z: goal.z, kind: goal.kind } : undefined;
    this.bot = bot;
    this.camera.copy(camera);
    // the next beam waits for the pulse, and so for a vista that holds it
    if (!this.held) this.wait = Math.max(0, this.wait - dt);
    const moved = !!next && !!this.at && (this.at.roofId !== next.roofId || Math.hypot(this.at.x - next.x, this.at.z - next.z) > 0.25);
    const want = show && !!next && !moved && this.wait === 0 ? 1 : 0;
    const step = dt / B.fade;
    this.shown = want > this.shown ? Math.min(want, this.shown + step) : Math.max(want, this.shown - step);
    // faded right out: move to the new goal (it fades in there)
    if (this.shown === 0 && next && (!this.at || moved)) {
      this.at = next;
      this.seen = false;
    }
    if (this.at && next && !moved) this.at.kind = next.kind;
    if (this.shown > 0.9) this.seen = true;
    const on = this.shown > 0.001 && !!this.at;
    if (this.root.enabled !== on) this.root.enabled = on;
    if (!on) return;
    const at = this.at!;
    const w = this.worldOf(at);
    if (!w) return;
    this.root.setPosition(w.x, w.y, w.z);
    const yaw = (Math.atan2(camera.x - w.x, camera.z - w.z) * 180) / Math.PI;
    // the shaft fades as bloombot walks in; the emblem settles onto the spot as it does
    const d = bot && bot.roofId === at.roofId ? Math.hypot(bot.x - at.x, bot.z - at.z) : Infinity;
    const share = smooth((d - B.close) / (B.far - B.close));
    this.beamShare += (share - this.beamShare) * Math.min(1, dt * 4);
    this.beam.setLocalEulerAngles(0, yaw, 0);
    const breath = this.reducedMotion ? 1 : 1 - B.breathDepth * (0.5 + 0.5 * Math.sin((this.time * Math.PI * 2) / B.breath));
    const ease = smooth(this.shown);
    const bs = this.beamShare;
    this.beam.enabled = bs > 0.01;
    this.ribbon.enabled = bs > 0.01;
    this.beamMat.opacity = ease * breath * bs;
    this.beamMat.emissiveIntensity = glow;
    this.beamMat.update();
    this.ringMat.opacity = ease * (0.75 + 0.25 * breath) * (0.45 + 0.55 * bs);
    this.ringMat.emissiveIntensity = glow;
    this.ringMat.update();
    this.ribbonMat.opacity = ease * bs;
    this.ribbonMat.emissiveIntensity = glow * 1.1;
    this.ribbonMat.update();
    this.ribbon.setLocalEulerAngles(0, this.reducedMotion ? 0 : (this.time * B.ribbonSpin) % 360, 0);
    // leaves rise slowly on wide spirals, tumbling as they go, shrinking away near the top
    const n = this.leaves.length;
    for (let i = 0; i < n; i++) {
      const phase = this.reducedMotion ? (i + 0.5) / n : (this.time / B.leafRise + i / n) % 1;
      const a = i * 2.39996 + (this.reducedMotion ? 0 : this.time * 0.5);
      const r = B.footWidth * (0.3 + 0.6 * ((i * 0.618) % 1));
      const s = 1.6 * ease * bs * Math.sin(Math.PI * phase);
      const e = this.leaves[i];
      e.enabled = s > 0.01;
      e.setLocalPosition(Math.cos(a) * r, 0.5 + phase * B.leafTop, Math.sin(a) * r);
      e.setLocalScale(s, s, s);
      if (!this.reducedMotion) e.setLocalEulerAngles(this.time * (40 + i * 7), this.time * (60 + i * 11), this.time * 30 + i * 40);
    }
    // the emblem: what the goal is for. Its petals open as it fades in; it breathes with the shaft
    this.emblem.setKind(at.kind);
    const open = E.closed + (1 - E.closed) * ease;
    this.emblem.pose(1 - bs, open, yaw);
    this.emblem.light(ease, glow * this.lotusLight * (0.9 + 0.2 * breath), this.backing);
  }

  /** The goal at `this.at` is done: its emblem lets go a Bloom Pulse where it lies, and its glow stays a while. */
  private bloom() {
    const at = this.at;
    const w = at && this.worldOf(at);
    if (!at || !w) return;
    // keep a few at most (an older glow goes at once)
    while (this.glows.length >= 3) this.dropGlow(this.glows.shift()!);
    const root = group(this.worldParent, 'waymark-glow');
    root.setPosition(w.x, w.y, w.z);
    const emblem = new EmblemView(root, this.meshes);
    emblem.setKind(at.kind);
    const waveMat = lightMaterial(WAYMARK.pulse.flash * 0.6);
    const wave = group(root, 'wave');
    wave.setLocalPosition(0, 0.04, 0);
    wave.addComponent('render', { meshInstances: [new pc.MeshInstance(this.meshes.wave, waveMat)], castShadows: false, receiveShadows: false });
    wave.enabled = false;
    this.glows.push({ root, emblem, wave, waveMat, age: 0, released: false, at: w, kind: at.kind });
    this.root.enabled = false;
  }

  private dropGlow(g: Glow) {
    g.emblem.destroy();
    g.waveMat.destroy();
    g.root.destroy();
  }

  /** The Bloom Pulses running and the soft glows they leave. */
  private updateGlows(dt: number, glow: number) {
    const P = WAYMARK.pulse;
    let wave: [number, number, number, number] = [0, 0, 0, 0];
    for (const g of this.glows) {
      g.age += dt;
      const t = g.age;
      const rm = this.reducedMotion;
      let scale = 1;
      let intensity = glow * P.soft;
      if (t < P.gather) {
        // it draws in, brightening
        const k = t / P.gather;
        scale = rm ? 1 : 1 - 0.15 * smooth(k);
        intensity = glow * (1 + (P.flash / 2 - 1) * k);
      } else {
        if (!g.released) {
          g.released = true;
          this.onPulse?.(g.at.clone(), g.kind);
        }
        const k = (t - P.gather) / P.settle;
        // the petals snap wide, then settle back as the flash fades to the soft glow
        scale = rm ? 1 : k < 0.15 ? 0.85 + (P.pop - 0.85) * smooth(k / 0.15) : P.pop + (1 - P.pop) * smooth((k - 0.15) / 0.85);
        const f = Math.max(0, 1 - (t - P.gather) / (P.settle * 1.6));
        const breath = rm ? 1 : 0.85 + 0.15 * Math.sin(g.age * 1.6);
        // the flash is full in any light; the soft glow after it, like the lotus, glows less by day over its gold body
        intensity = glow * (P.soft * breath * this.lotusLight + (P.flash - P.soft) * f * f);
        // the ring of light racing out over the ground (the grass and flowers lean as it passes)
        const wt = (t - P.gather) / P.waveTime;
        g.wave.enabled = !rm && wt < 1;
        if (g.wave.enabled) {
          const r = 0.3 + (P.wave - 0.3) * (1 - Math.pow(1 - wt, 2));
          g.wave.setLocalScale(r, 1, r);
          g.waveMat.opacity = Math.pow(1 - wt, 1.3);
          g.waveMat.update();
          wave = [g.at.x, g.at.z, r, P.sway * (1 - wt)];
        }
      }
      // then it lingers, softly breathing, and sinks away
      const end = P.linger;
      const fade = t > end ? Math.max(0, 1 - (t - end) / P.fadeOut) : 1;
      const yaw = (Math.atan2(this.camera.x - g.at.x, this.camera.z - g.at.z) * 180) / Math.PI;
      g.emblem.pose(1, scale, yaw, 1 - fade);
      g.emblem.light(fade, intensity, this.backing);
    }
    for (const g of this.glows.filter((x) => x.age > P.linger + P.fadeOut)) this.dropGlow(g);
    this.glows = this.glows.filter((x) => x.age <= P.linger + P.fadeOut);
    if (wave[3] > 0 || this.waveOn) setBloomWave(...wave);
    this.waveOn = wave[3] > 0;
  }

  private waveOn = false;
}
