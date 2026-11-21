import * as pc from 'playcanvas';
import { levelY } from '../core/Height';
import type { Sim } from '../gameplay/Sim';
import { WAYMARK } from '../data/waymark';
import type { GoalSpot } from '../ui/GoalSpot';
import { mat, PALETTE } from './Materials';
import { SLAB_TOP } from './SceneBuilder';
import { group, shape } from './Shapes';
import { glowMaterial } from './TileFx';

/** A vertex for the glow meshes: rgb is brightness, alpha is opacity (glowMaterial reads both). */
type V = [x: number, y: number, z: number, alpha: number, bright: number];

function glowMesh(device: pc.GraphicsDevice, verts: V[], idx: number[]): pc.Mesh {
  const mesh = new pc.Mesh(device);
  mesh.setPositions(verts.flatMap((v) => [v[0], v[1], v[2]]));
  mesh.setNormals(verts.flatMap(() => [0, 1, 0]));
  mesh.setColors32(verts.flatMap((v) => [Math.round(v[4] * 255), Math.round(v[4] * 255), Math.round(v[4] * 255), Math.round(v[3] * 255)]));
  mesh.setIndices(idx);
  mesh.update();
  return mesh;
}

/**
 * The shaft: a soft upright sheet that always turns to face the camera, brightest down its middle and at its foot,
 * fading out sideways and towards the top, so it reads as a beam of light standing on the spot (like sun breaking
 * through cloud) rather than as a solid thing.
 */
function beamMesh(device: pc.GraphicsDevice): pc.Mesh {
  const B = WAYMARK.beam;
  const cols: [number, number][] = [
    [-1, 0],
    [-0.45, 0.5],
    [0, 1],
    [0.45, 0.5],
    [1, 0],
  ];
  const rows: [number, number][] = [
    [0, 0.6],
    [0.05, 1],
    [0.3, 0.8],
    [0.65, 0.35],
    [1, 0],
  ];
  const verts: V[] = [];
  for (const [v, va] of rows) {
    const half = B.footWidth + (B.topWidth - B.footWidth) * v;
    for (const [u, ua] of cols) verts.push([u * half, v * B.height, 0, va * ua, 0.75 + 0.25 * ua]);
  }
  const idx: number[] = [];
  const n = cols.length;
  for (let r = 0; r < rows.length - 1; r++)
    for (let c = 0; c < n - 1; c++) {
      const a = r * n + c;
      idx.push(a, a + 1, a + n + 1, a, a + n + 1, a + n);
    }
  return glowMesh(device, verts, idx);
}

/** The ring on the ground: a faint fill and a bright soft edge, flat at y = 0. */
function ringMesh(device: pc.GraphicsDevice): pc.Mesh {
  const R = WAYMARK.beam.ring;
  const bands: [number, number][] = [
    [0, 0.22],
    [0.62, 0.1],
    [0.84, 0.75],
    [0.92, 0.95],
    [1, 0],
  ];
  const SEG = 28;
  const verts: V[] = [];
  for (const [r, a] of bands)
    for (let k = 0; k < SEG; k++) {
      const t = (k / SEG) * Math.PI * 2;
      verts.push([Math.cos(t) * r * R, 0, Math.sin(t) * r * R, a, 1]);
    }
  const idx: number[] = [];
  for (let b = 0; b < bands.length - 1; b++)
    for (let k = 0; k < SEG; k++) {
      const a = b * SEG + k;
      const c = b * SEG + ((k + 1) % SEG);
      idx.push(a, c, c + SEG, a, c + SEG, a + SEG);
    }
  return glowMesh(device, verts, idx);
}

/**
 * E24 (#609): the waymark. A soft shaft of warm sunlight stands on the current goal (the place the minimap's pin
 * marks), with a glowing ring on the ground and a few motes drifting up through it. It breathes slowly, glows a
 * little brighter at night, fades as bloombot arrives and fades across when the goal moves on. No arrows, nothing
 * bobbing: it belongs to the world's light. Reduced motion keeps it still.
 */
export class Waymark {
  private root: pc.Entity;
  private beam: pc.Entity;
  private ring: pc.Entity;
  private motes: pc.Entity[] = [];
  private beamMat: pc.StandardMaterial;
  private ringMat: pc.StandardMaterial;
  private time = 0;
  /** 0 … 1: how far it has faded in */
  private shown = 0;
  /** where it stands now (the goal it fades towards may be elsewhere) */
  private at?: { roofId: string; x: number; z: number };
  reducedMotion = false;
  /** its colours by day and by night (a pale gold vanishes against a bright sky, so by day it goes amber) */
  private beamDay = new pc.Color().fromString(PALETTE.signal.waymarkDay);
  private beamNight = new pc.Color().fromString(PALETTE.signal.waymark);
  private ringDay = new pc.Color().fromString(PALETTE.signal.waymarkRingDay);
  private ringNight = new pc.Color().fromString(PALETTE.signal.waymarkRing);

  constructor(
    private sim: Sim,
    parent: pc.Entity,
  ) {
    const device = pc.AppBase.getApplication()!.graphicsDevice;
    this.root = group(parent, 'waymark');
    this.beamMat = glowMaterial(PALETTE.signal.waymark, WAYMARK.beam.glow);
    this.ringMat = glowMaterial(PALETTE.signal.waymarkRing, WAYMARK.beam.glow);
    this.beam = group(this.root, 'beam');
    this.beam.addComponent('render', { meshInstances: [new pc.MeshInstance(beamMesh(device), this.beamMat)], castShadows: false, receiveShadows: false });
    this.ring = group(this.root, 'ring');
    this.ring.setLocalPosition(0, 0.03, 0);
    this.ring.addComponent('render', { meshInstances: [new pc.MeshInstance(ringMesh(device), this.ringMat)], castShadows: false, receiveShadows: false });
    const moteMat = mat(PALETTE.signal.waymarkMote, { unlit: true, opacity: 0.85 });
    for (let i = 0; i < WAYMARK.beam.motes; i++) this.motes.push(shape(this.root, 'sphere', moteMat, { scale: [0.07, 0.07, 0.07], receive: false }));
    this.root.enabled = false;
  }

  /** Gone at once (photo mode: nothing of the game's pointers in the picture). */
  hide() {
    this.shown = 0;
    this.root.enabled = false;
  }

  /** Where it is standing, while it shows (tests and screenshots read it). */
  get place(): { roofId: string; x: number; z: number } | undefined {
    return this.root.enabled ? this.at : undefined;
  }

  /**
   * Each frame. `goal`: the current goal, or undefined to fade out. `show`: false while something else owns the
   * screen (building, photo mode, a cutscene). `bot`: bloombot's cell position (it fades as bloombot arrives).
   * `camera`: the camera's world position (the shaft turns to face it). `night`: 0 by day … 1 at night.
   */
  update(dt: number, goal: GoalSpot | undefined, show: boolean, bot: { roofId: string; x: number; z: number } | undefined, camera: pc.Vec3, night: number) {
    this.time += dt;
    const B = WAYMARK.beam;
    const arrived = !!goal && !!bot && bot.roofId === goal.roofId && Math.hypot(bot.x - goal.x, bot.z - goal.z) <= WAYMARK.near;
    const moved = !!goal && !!this.at && (this.at.roofId !== goal.roofId || Math.hypot(this.at.x - goal.x, this.at.z - goal.z) > 0.25);
    const want = show && !!goal && !arrived && !moved ? 1 : 0;
    const step = dt / B.fade;
    this.shown = want > this.shown ? Math.min(want, this.shown + step) : Math.max(want, this.shown - step);
    // faded right out: move to the new goal (it fades in there)
    if (this.shown === 0 && goal && (!this.at || moved)) this.at = { roofId: goal.roofId, x: goal.x, z: goal.z };
    const on = this.shown > 0.001 && !!this.at;
    if (this.root.enabled !== on) this.root.enabled = on;
    if (!on) return;
    const at = this.at!;
    const layer = this.sim.grid.layer(at.roofId);
    if (!layer) return;
    const lv = this.sim.grid.peek(at.roofId, Math.floor(at.x), Math.floor(at.z))?.level;
    const wx = layer.origin[0] + at.x;
    const wz = layer.origin[2] + at.z;
    const wy = layer.origin[1] + layer.height + SLAB_TOP + (lv !== undefined ? levelY(lv) : 0);
    this.root.setPosition(wx, wy, wz);
    // the shaft turns to face the camera (about its upright axis only)
    this.beam.setLocalEulerAngles(0, (Math.atan2(camera.x - wx, camera.z - wz) * 180) / Math.PI, 0);
    const breath = this.reducedMotion ? 1 : 1 - B.breathDepth * (0.5 + 0.5 * Math.sin((this.time * Math.PI * 2) / B.breath));
    const glow = B.glow + (B.nightGlow - B.glow) * Math.max(0, Math.min(1, night));
    const ease = this.shown * this.shown * (3 - 2 * this.shown);
    const dark = Math.max(0, Math.min(1, night));
    this.beamMat.opacity = ease * breath;
    this.beamMat.emissive.lerp(this.beamDay, this.beamNight, dark);
    this.beamMat.emissiveIntensity = glow;
    this.beamMat.update();
    this.ringMat.opacity = ease * (0.75 + 0.25 * breath);
    this.ringMat.emissive.lerp(this.ringDay, this.ringNight, dark);
    this.ringMat.emissiveIntensity = glow;
    this.ringMat.update();
    // motes rise slowly through the shaft on little spirals, shrinking away near the top
    const n = this.motes.length;
    for (let i = 0; i < n; i++) {
      const phase = this.reducedMotion ? (i + 0.5) / n : (this.time / B.moteRise + i / n) % 1;
      const a = i * 2.39996 + (this.reducedMotion ? 0 : this.time * 0.6);
      const r = B.footWidth * (0.25 + 0.45 * ((i * 0.618) % 1));
      const s = 0.07 * ease * Math.sin(Math.PI * phase);
      const m = this.motes[i];
      m.setLocalPosition(Math.cos(a) * r, 0.15 + phase * B.height * 0.6, Math.sin(a) * r);
      m.setLocalScale(s, s, s);
    }
  }
}
