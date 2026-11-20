import * as pc from 'playcanvas';
import { CAT_SIGHT, countIds, screenBox, toScreenPixels, type ScreenBox } from '../core/CatSight';
import { canReadPixels, pickBuffer, readRect } from './PickerInternals';

/** Entities that are never in the way: the build and hover overlays, the build hologram. */
const SEE_THROUGH = ['overlays', 'hologram'];

/**
 * E23.12.3 (#530): how much of something the player can really see, measured on the frame. A pick pass draws every
 * mesh in the world layers with its own id (depth-tested, so whatever is in front wins: buildings, landmarks, trees,
 * ruins, walls, props, machines, bloombot) and the pixels that are the thing's own meshes are counted.
 *
 * When it runs: never on its own. Game asks after a frame is drawn (`frameend`), before the first cat is found,
 * when the game isn't paused, and only for a cat the pointer is near or bloombot could greet whose last result is
 * out of date (the camera, the cat or bloombot moved). All the cats asked about share one pick render and one read.
 *
 * What it leaves out: veils the eye sees through (blended without depth: the fog's haze, glows) and the overlay and
 * hologram helpers. They're kept out by their mesh instances' `pick` flag (the pass draws only `pick` meshes), set
 * once and refreshed only when the world layers' meshes change (a chunk rebuilt, a model added), so nothing is
 * toggled per pick. Half resolution. WebGL only: where the device can't read a buffer back at once (WebGPU),
 * `available` is false and Game uses the CPU ray march (core/CatSight) instead.
 */
export class SightPicker {
  private picker?: pc.Picker;
  /** the world layers' mesh lists as last masked: each layer's length and newest mesh id */
  private maskSig = '';
  /** meshes this picker took out of the pick pass (so a refresh can put back any that stopped being veils) */
  private masked = new Set<pc.MeshInstance>();
  private helperRoots?: pc.Entity[];
  /** how many times the mask was rebuilt (for tests and the perf note) */
  maskBuilds = 0;
  /** how many pick renders ran (for tests and the perf note) */
  renders = 0;

  constructor(
    private app: pc.AppBase,
    private camera: () => pc.CameraComponent,
  ) {}

  /** Can the GPU pick run here? (WebGL, and PlayCanvas keeps its Picker internals where PickerInternals expects.) */
  get available(): boolean {
    return canReadPixels(this.app.graphicsDevice);
  }

  /** The screen box (CSS pixels) around an entity's meshes, clipped to the screen; undefined if any of it is behind the camera. */
  box(root: pc.Entity): ScreenBox | undefined {
    const cam = this.camera();
    const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const pts: { x: number; y: number }[] = [];
    const out = new pc.Vec3();
    const eye = cam.entity.getPosition();
    const fwd = cam.entity.forward;
    const p = new pc.Vec3();
    for (const mi of meshesOf(root)) {
      const c = mi.aabb.center;
      const h = mi.aabb.halfExtents;
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1]) {
            p.set(c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z);
            // a corner behind the camera has no place on screen
            if ((p.x - eye.x) * fwd.x + (p.y - eye.y) * fwd.y + (p.z - eye.z) * fwd.z < cam.nearClip) return undefined;
            cam.worldToScreen(p, out);
            pts.push({ x: out.x, y: out.y });
          }
    }
    return screenBox(pts, canvas.clientWidth, canvas.clientHeight);
  }

  /**
   * How many screen pixels (CSS, full resolution) of each root's meshes are drawn in front of everything else, from
   * ONE pick render and one read of the screen area they share. Undefined where the GPU pick isn't available.
   */
  measure(roots: ReadonlyMap<string, pc.Entity>): Map<string, number> | undefined {
    if (!this.available) return undefined;
    const out = new Map<string, number>();
    const items: { id: string; box: ScreenBox; own: Set<pc.MeshInstance> }[] = [];
    for (const [id, root] of roots) {
      const box = this.box(root);
      const own = new Set(meshesOf(root));
      out.set(id, 0);
      if (box && own.size) items.push({ id, box, own });
    }
    if (!items.length) return out;
    const picker = this.render();
    const buf = picker && pickBuffer(picker);
    if (!picker || !buf) return undefined;
    const s = CAT_SIGHT.scale;
    // one read: the pick-buffer rectangle around every box
    const x0 = Math.max(0, Math.floor(Math.min(...items.map((i) => i.box.x)) * s));
    const y0 = Math.max(0, Math.floor(Math.min(...items.map((i) => i.box.y)) * s));
    const x1 = Math.min(picker.width, Math.ceil(Math.max(...items.map((i) => i.box.x + i.box.w)) * s));
    const y1 = Math.min(picker.height, Math.ceil(Math.max(...items.map((i) => i.box.y + i.box.h)) * s));
    if (x1 <= x0 || y1 <= y0) return out;
    const pixels = readRect(this.app.graphicsDevice, buf, x0, y0, x1 - x0, y1 - y0);
    for (const it of items) {
      const ids = new Set<number>();
      for (const [n, mi] of buf.mapping) if (it.own.has(mi)) ids.add(n);
      // each cat counts only its own ids, so a shared rectangle can't mix two cats up
      out.set(it.id, toScreenPixels(countIds(pixels, ids), s));
    }
    return out;
  }

  /** One root's drawn pixels (the e2e and the debug readout); 0 where the GPU pick isn't available. */
  visiblePixels(root: pc.Entity): number {
    return this.measure(new Map([['one', root]]))?.get('one') ?? 0;
  }

  /**
   * What is drawn frontmost at a screen point (for tests and the debug readout): the names from that mesh's node up
   * to the scene root, and the world point there (from a depth pick).
   */
  async at(x: number, y: number): Promise<{ path: string[]; point?: { x: number; y: number; z: number } }> {
    const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const picker = new pc.Picker(this.app, canvas.clientWidth, canvas.clientHeight, true);
    try {
      this.prepare(picker);
      const [mi] = picker.getSelection(Math.floor(x), Math.floor(y), 1, 1) as pc.MeshInstance[];
      const path: string[] = [];
      for (let n: pc.GraphNode | null = mi?.node ?? null; n; n = n.parent) path.push(n.name);
      const p = await picker.getWorldPointAsync(Math.floor(x), Math.floor(y));
      return { path, point: p ? { x: p.x, y: p.y, z: p.z } : undefined };
    } finally {
      picker.destroy();
    }
  }

  private render(): pc.Picker | undefined {
    const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const w = Math.max(1, Math.floor(canvas.clientWidth * CAT_SIGHT.scale));
    const h = Math.max(1, Math.floor(canvas.clientHeight * CAT_SIGHT.scale));
    this.picker ??= new pc.Picker(this.app, w, h);
    if (this.picker.width !== w || this.picker.height !== h) this.picker.resize(w, h);
    this.prepare(this.picker);
    this.renders++;
    return this.picker;
  }

  /** The world layers the camera draws (no sky, no UI). */
  private layers(): pc.Layer[] {
    const comp = this.app.scene.layers;
    return this.camera()
      .layers.map((id) => comp.getLayerById(id))
      .filter((l): l is pc.Layer => !!l && !/^(Sky|SkyDepthClear|UI|Immediate)$/.test(l.name));
  }

  /** Draws the pick pass from the game camera, with the see-through mask up to date. */
  private prepare(picker: pc.Picker) {
    const layers = this.layers();
    this.refreshMask(layers);
    picker.prepare(this.camera(), this.app.scene, layers);
  }

  /**
   * Keeps see-through meshes out of the pick pass by their `pick` flag. Rebuilt only when a world layer's meshes
   * changed since the last build (its count, or its newest mesh): a chunk rebuilt, a model loaded, an overlay drawn.
   */
  private refreshMask(layers: pc.Layer[]) {
    const sig = layers.map((l) => `${l.id}:${l.meshInstances.length}:${l.meshInstances[l.meshInstances.length - 1]?.id ?? 0}`).join('|');
    if (sig === this.maskSig) return;
    this.maskSig = sig;
    this.maskBuilds++;
    const helpers = new Set<pc.MeshInstance>();
    // the helpers' group entities are found once (they live as long as the game); their meshes are read each rebuild
    this.helperRoots ??= SEE_THROUGH.flatMap((name) => this.app.root.find((n) => n.name === name) as pc.Entity[]);
    for (const e of this.helperRoots) for (const mi of meshesOf(e, true)) helpers.add(mi);
    const now = new Set<pc.MeshInstance>();
    for (const l of layers)
      for (const mi of l.meshInstances) {
        const m = mi.material;
        // Blended without writing depth (the fog's haze, glows, light pools): on the frame these never hide what is
        // behind them, so they don't in the pick pass either.
        const veil = !!m && m.blendType !== pc.BLEND_NONE && !m.depthWrite;
        if (veil || helpers.has(mi)) now.add(mi);
      }
    for (const mi of this.masked) if (!now.has(mi)) mi.pick = true; // no longer see-through
    for (const mi of now) mi.pick = false;
    this.masked = now;
  }
}

/** An entity's drawn meshes (enabled ones only, unless `all`). */
function meshesOf(root: pc.Entity, all = false): pc.MeshInstance[] {
  const out: pc.MeshInstance[] = [];
  for (const r of root.findComponents('render') as pc.RenderComponent[]) if (all || (r.enabled && r.entity.enabled)) out.push(...r.meshInstances);
  return out;
}
