import * as pc from 'playcanvas';
import type { PlotSpot } from '../core/Plots';
import { color, PALETTE } from './Materials';
import { MODELS } from './Models';
import { drawDecor } from './DecorArt';
import { drawPlot } from './PlotArt';
import { group } from './Shapes';
import type { TreeGeo } from './TreeGen';

/**
 * E19 × bloombot: the build hologram. What you're about to build (a machine, a superstructure, a plot option) is
 * shown as a glowing see-through copy of itself, projected from bloombot's visor: a faint beam fans from its eyes
 * to the hologram, and a bright scan band sweeps up through it. Cyan where it can go, red where it can't.
 *
 * Presentation only. One entity tree, rebuilt only when the thing shown changes; the beam is four triangles
 * updated each frame. Reduced motion keeps the hologram and beam but stops the flicker and the scan.
 */
export type HoloTone = 'ok' | 'bad';

/** What the hologram shows: a model (by library name and scale), a plot option, or a plain footprint block. */
export type HoloShape =
  | { kind: 'model'; name: string; scale: number }
  | { kind: 'plot'; plot: PlotSpot; option: string }
  /** E19.2: a decoration (its models and primitives, turned `rot` quarter turns) */
  | { kind: 'decor'; decor: string; rot: number }
  | { kind: 'block'; height: number };

/** Lays geometry out as the chunk's MeshBuilder does: what PlotArt needs to draw into a standalone mesh. */
export interface HoloMeshSink {
  add(type: 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'plane' | 'torus' | 'sphereHi', hex: string, p: [number, number, number], s: [number, number, number] | number, glow?: number): void;
  addGeo(g: TreeGeo, x: number, y: number, z: number, rotY: number, scale: number): void;
  build(device: pc.GraphicsDevice): pc.Mesh | undefined;
}

const BEAM_NORMALS = new Float32Array(12 * 3).map((_, i) => (i % 3 === 1 ? 1 : 0));

const TONES: Record<HoloTone, string> = { ok: PALETTE.signal.holo, bad: PALETTE.signal.bad };

/** The hologram look (unlit, see-through, no depth write): the build preview's, and the Power view's machines. */
export function holoMaterial(hex: string, opacity: number, emissive: number, additive = true): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  const c = color(hex);
  m.diffuse.set(0, 0, 0);
  m.emissive.copy(c);
  m.emissiveIntensity = emissive;
  m.useLighting = false;
  m.blendType = additive ? pc.BLEND_ADDITIVEALPHA : pc.BLEND_NORMAL;
  m.opacity = opacity;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

export class Hologram {
  private root: pc.Entity;
  private body: pc.Entity;
  private content?: pc.Entity;
  private contentKey = '';
  private scan: pc.Entity;
  private beam: pc.Entity;
  private beamMesh: pc.Mesh;
  private beamPos = new Float32Array(12 * 3);
  /** the beam's four bright edges, eye to corner */
  private edges: pc.Entity[] = [];
  private mats: Record<HoloTone, { body: pc.StandardMaterial; scan: pc.StandardMaterial; beam: pc.StandardMaterial; edge: pc.StandardMaterial }>;
  private tone: HoloTone = 'ok';
  private time = 0;
  /** footprint centre (world) and size, and the hologram's height */
  private at = new pc.Vec3();
  private size = 1;
  private height = 0.6;
  reducedMotion = false;
  /** Where the beam starts: bloombot's eyes (undefined: no beam, e.g. cursor play). */
  eye?: (out: pc.Vec3) => pc.Vec3 | undefined;
  /** A fresh mesh builder for plot holograms (the chunk renderer's). */
  sink?: () => HoloMeshSink;

  constructor(
    private device: pc.GraphicsDevice,
    parent: pc.Entity,
  ) {
    this.root = group(parent, 'hologram');
    this.body = group(this.root, 'holo-body');
    this.mats = {
      ok: { body: holoMaterial(TONES.ok, 0.55, 1.4, false), scan: holoMaterial(TONES.ok, 0.3, 0.9), beam: holoMaterial(TONES.ok, 0.06, 1), edge: holoMaterial(TONES.ok, 0.45, 1) },
      bad: { body: holoMaterial(TONES.bad, 0.55, 1.4, false), scan: holoMaterial(TONES.bad, 0.3, 0.9), beam: holoMaterial(TONES.bad, 0.06, 1), edge: holoMaterial(TONES.bad, 0.45, 1) },
    };
    this.scan = new pc.Entity('holo-scan');
    this.scan.addComponent('render', { type: 'box', material: this.mats.ok.scan, castShadows: false, receiveShadows: false });
    this.root.addChild(this.scan);
    // The beam: a pyramid from the eye to the footprint's corners (four open triangles), rewritten each frame.
    this.beamMesh = new pc.Mesh(device);
    this.beamMesh.setPositions(this.beamPos);
    this.beamMesh.setNormals(BEAM_NORMALS); // the shader wants normals
    this.beamMesh.setIndices([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    this.beamMesh.update(pc.PRIMITIVE_TRIANGLES, false);
    this.beam = new pc.Entity('holo-beam');
    this.beam.addComponent('render', { meshInstances: [new pc.MeshInstance(this.beamMesh, this.mats.ok.beam)], castShadows: false, receiveShadows: false });
    this.beam.render!.meshInstances[0].cull = false; // its bounds move every frame
    this.root.addChild(this.beam);
    for (let i = 0; i < 4; i++) {
      const e = new pc.Entity('holo-edge');
      e.addComponent('render', { type: 'box', material: this.mats.ok.edge, castShadows: false, receiveShadows: false });
      this.beam.addChild(e);
      this.edges.push(e);
    }
    this.root.enabled = false;
  }

  get visible(): boolean {
    return this.root.enabled;
  }

  /**
   * Shows `shape` on a footprint: `x`, `y`, `z` the footprint's centre on the ground (world), `size` its width in
   * tiles. Cheap to call every frame with the same arguments.
   */
  show(shape: HoloShape, x: number, y: number, z: number, size: number, tone: HoloTone) {
    const key =
      shape.kind === 'model' ? `m|${shape.name}|${shape.scale}|${!!MODELS?.has(shape.name)}`
      : shape.kind === 'plot' ? `p|${shape.plot.id}|${shape.option}`
      : shape.kind === 'decor' ? `d|${shape.decor}|${shape.rot}|${!!MODELS}`
      : `b|${size}|${shape.height}`;
    this.at.set(x, y, z);
    if (key !== this.contentKey) {
      this.content?.destroy();
      this.content = this.build(shape, size);
      this.contentKey = key;
      if (this.content) this.body.addChild(this.content);
      this.retone(this.tone, true);
    }
    if (tone !== this.tone) this.retone(tone);
    this.at.set(x, y, z);
    this.size = size;
    // plots are drawn in world coordinates (their art is laid out on the plot's own cells)
    if (shape.kind === 'plot') this.body.setPosition(0, 0, 0);
    else this.body.setPosition(x, y, z);
    this.height = shape.kind === 'block' ? shape.height : shape.kind === 'plot' ? 1.1 : shape.kind === 'decor' ? 0.8 : 0.4 + size * 0.45;
    this.root.enabled = true;
  }

  hide() {
    this.root.enabled = false;
  }

  /** Drops what's shown, so the next `show` rebuilds it (e.g. models finished loading). */
  reset() {
    this.content?.destroy();
    this.content = undefined;
    this.contentKey = '';
  }

  private build(shape: HoloShape, size: number): pc.Entity | undefined {
    if (shape.kind === 'model' && MODELS?.has(shape.name)) {
      const e = MODELS.instantiate(shape.name, false, false);
      if (e) {
        e.setLocalScale(shape.scale, shape.scale, shape.scale);
        return e;
      }
    }
    if (shape.kind === 'plot' && this.sink) {
      const b = this.sink();
      const host = {
        add: b.add.bind(b),
        foliage: (g: TreeGeo, x: number, y: number, z: number, rot: number, sc: number) => b.addGeo(g, x, y, z, rot, sc),
        model: () => false, // primitives only: the hologram needs its own mesh
        lod: 1 as const,
      };
      drawPlot(host, shape.plot, shape.option, this.at.y, false);
      const mesh = b.build(this.device);
      if (mesh) {
        const e = new pc.Entity('holo-plot');
        e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, this.mats[this.tone].body)], castShadows: false, receiveShadows: false });
        return e;
      }
    }
    if (shape.kind === 'decor' && this.sink) {
      // Its primitives into one mesh, its models as their own copies: laid out about the tile centre (the body's origin).
      const root = new pc.Entity('holo-decor');
      const b = this.sink();
      const host = {
        add: b.add.bind(b),
        foliage: (g: TreeGeo, x: number, y: number, z: number, rot: number, sc: number) => b.addGeo(g, x, y, z, rot, sc),
        model: (name: string, x: number, y: number, z: number, rot: number, sc: number) => {
          const e = MODELS?.has(name) ? MODELS.instantiate(name, false, false) : undefined;
          if (!e) return false;
          e.setLocalPosition(x, y, z);
          e.setLocalEulerAngles(0, (rot * 180) / Math.PI, 0);
          e.setLocalScale(sc, sc, sc);
          root.addChild(e);
          return true;
        },
        lod: 1 as const,
      };
      drawDecor(host, shape.decor, 0, 0, 0, shape.rot, false);
      const mesh = b.build(this.device);
      if (mesh) root.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, this.mats[this.tone].body)], castShadows: false, receiveShadows: false });
      return root;
    }
    // A footprint block: what a machine without a model (or a plot without art) looks like as a hologram.
    const h = shape.kind === 'block' ? shape.height : 0.5;
    const e = new pc.Entity('holo-block');
    e.addComponent('render', { type: 'box', castShadows: false, receiveShadows: false });
    e.setLocalScale(size * 0.86, h, size * 0.86);
    e.setLocalPosition(0, h / 2, 0);
    return e;
  }

  private retone(tone: HoloTone, force = false) {
    if (!force && tone === this.tone) return;
    this.tone = tone;
    const m = this.mats[tone];
    if (this.content) for (const r of this.content.findComponents('render') as pc.RenderComponent[]) for (const mi of r.meshInstances) mi.material = m.body;
    this.scan.render!.meshInstances[0].material = m.scan;
    this.beam.render!.meshInstances[0].material = m.beam;
    for (const e of this.edges) e.render!.meshInstances[0].material = m.edge;
  }

  private eyeAt = new pc.Vec3();

  update(dt: number) {
    if (!this.root.enabled) return;
    this.time += dt;
    const m = this.mats[this.tone];
    // A hologram flickers a little and the scan band climbs through it (both off with reduced motion).
    const still = this.reducedMotion;
    m.body.opacity = still ? 0.55 : 0.5 + 0.07 * Math.sin(this.time * 9) + (Math.sin(this.time * 31) > 0.97 ? -0.15 : 0);
    m.body.update();
    this.scan.enabled = !still;
    if (!still) {
      const k = (this.time * 0.7) % 1;
      this.scan.setPosition(this.at.x, this.at.y + k * this.height, this.at.z);
      this.scan.setLocalScale(this.size * 0.98, 0.02, this.size * 0.98);
      m.scan.opacity = 0.25 * Math.sin(k * Math.PI);
      m.scan.update();
    }
    // The beam fans down from the eye to the footprint's corners, like a projector onto the ground.
    const eye = this.eye?.(this.eyeAt);
    this.beam.enabled = !!eye;
    if (!eye) return;
    const h = this.size / 2;
    const top = this.at.y + 0.04;
    const cs: [number, number][] = [[-h, -h], [h, -h], [h, h], [-h, h]];
    const P = this.beamPos;
    for (let i = 0; i < 4; i++) {
      const a = cs[i];
      const b = cs[(i + 1) % 4];
      const o = i * 9;
      P[o] = eye.x; P[o + 1] = eye.y; P[o + 2] = eye.z;
      P[o + 3] = this.at.x + a[0]; P[o + 4] = top; P[o + 5] = this.at.z + a[1];
      P[o + 6] = this.at.x + b[0]; P[o + 7] = top; P[o + 8] = this.at.z + b[1];
    }
    for (let i = 0; i < 4; i++) {
      const o = i * 9;
      const e = this.edges[i];
      const cx = P[o + 3], cy = P[o + 4], cz = P[o + 5];
      const len = Math.hypot(cx - eye.x, cy - eye.y, cz - eye.z);
      e.setPosition((cx + eye.x) / 2, (cy + eye.y) / 2, (cz + eye.z) / 2);
      e.lookAt(cx, cy, cz);
      e.setLocalScale(0.012, 0.012, len);
    }
    this.beamMesh.setPositions(P);
    this.beamMesh.setNormals(BEAM_NORMALS);
    this.beamMesh.update(pc.PRIMITIVE_TRIANGLES, false);
    m.beam.opacity = still ? 0.06 : 0.05 + 0.025 * Math.sin(this.time * 5);
    m.beam.update();
  }
}
