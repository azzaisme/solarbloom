import * as pc from 'playcanvas';
import { CAT_SIGHT, countIds, screenBox, toScreenPixels, type ScreenBox } from '../core/CatSight';

/** The Picker's buffer and id table (private in its typings; read as PlayCanvas's own getSelection does). */
interface PickerInternals {
  renderTarget?: pc.RenderTarget;
  mapping: Map<number, pc.MeshInstance>;
}

/** Entities that are never in the way: the build and hover overlays, the build hologram. */
const SEE_THROUGH = ['overlays', 'hologram'];

/**
 * E23.12.3 (#530): how much of something the player can really see, measured on the frame. A pick pass draws every
 * mesh in the world layers with its own id (depth-tested, so whatever is in front wins: buildings, towers, trees,
 * walls, props, machines, landmarks) and the pixels that are the thing's own meshes are counted. Veils the eye sees
 * through (blended, no depth: the fog's haze, glows) are left out. Runs only when asked
 * (the pointer near a hiding cat before the first find), at half resolution.
 */
export class SightPicker {
  private picker?: pc.Picker;
  private seeThrough?: pc.Entity[];

  constructor(
    private app: pc.AppBase,
    private camera: () => pc.CameraComponent,
  ) {}

  /** The screen box (CSS pixels) around an entity's meshes, clipped to the screen. */
  box(root: pc.Entity): ScreenBox | undefined {
    const cam = this.camera();
    const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const pts: { x: number; y: number }[] = [];
    const out = new pc.Vec3();
    for (const mi of this.meshes(root)) {
      const b = mi.aabb;
      const c = b.center;
      const h = b.halfExtents;
      const eye = cam.entity.getPosition();
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1]) {
            const p = new pc.Vec3(c.x + sx * h.x, c.y + sy * h.y, c.z + sz * h.z);
            // a corner behind the camera has no place on screen
            if (p.clone().sub(eye).dot(cam.entity.forward) < cam.nearClip) return undefined;
            cam.worldToScreen(p, out);
            pts.push({ x: out.x, y: out.y });
          }
    }
    return screenBox(pts, canvas.clientWidth, canvas.clientHeight);
  }

  /** How many screen pixels (CSS, full resolution) of `root`'s meshes are drawn in front of everything else. */
  visiblePixels(root: pc.Entity): number {
    const box = this.box(root);
    if (!box) return 0;
    const own = new Set(this.meshes(root));
    if (!own.size) return 0;
    const pick = this.render();
    if (!pick) return 0;
    const s = CAT_SIGHT.scale;
    const x = Math.floor(box.x * s);
    const y = Math.floor(box.y * s);
    const w = Math.max(1, Math.min(pick.picker.width - x, Math.ceil(box.w * s)));
    const h = Math.max(1, Math.min(pick.picker.height - y, Math.ceil(box.h * s)));
    const ids = new Set<number>();
    for (const [id, mi] of pick.internals.mapping) if (own.has(mi)) ids.add(id);
    // as PlayCanvas's own Picker.getSelection reads its buffer (WebGL)
    const device = this.app.graphicsDevice as pc.GraphicsDevice & { readPixels(x: number, y: number, w: number, h: number, out: Uint8Array): void; updateBegin(): void; updateEnd(): void };
    const rt = pick.internals.renderTarget!;
    const pixels = new Uint8Array(4 * w * h);
    device.setRenderTarget(rt);
    device.updateBegin();
    device.readPixels(x, rt.height - (y + h), w, h, pixels); // the buffer's rows run bottom-up
    device.updateEnd();
    return toScreenPixels(countIds(pixels, ids), s);
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

  private meshes(root: pc.Entity): pc.MeshInstance[] {
    const out: pc.MeshInstance[] = [];
    for (const r of root.findComponents('render') as pc.RenderComponent[]) if (r.enabled && r.entity.enabled) out.push(...r.meshInstances);
    return out;
  }

  private render(): { picker: pc.Picker; internals: PickerInternals } | undefined {
    if (this.app.graphicsDevice.isWebGPU) return undefined;
    const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const w = Math.max(1, Math.floor(canvas.clientWidth * CAT_SIGHT.scale));
    const h = Math.max(1, Math.floor(canvas.clientHeight * CAT_SIGHT.scale));
    this.picker ??= new pc.Picker(this.app, w, h);
    if (this.picker.width !== w || this.picker.height !== h) this.picker.resize(w, h);
    this.prepare(this.picker);
    const internals = this.picker as unknown as PickerInternals;
    return internals.renderTarget ? { picker: this.picker, internals } : undefined;
  }

  /** Draws the pick pass from the game camera: the world layers (no sky), see-through helpers switched off. */
  private prepare(picker: pc.Picker) {
    const cam = this.camera();
    const comp = this.app.scene.layers;
    const layers = cam.layers.map((id) => comp.getLayerById(id)).filter((l): l is pc.Layer => !!l && !/^(Sky|SkyDepthClear|UI|Immediate)$/.test(l.name));
    this.seeThrough ??= SEE_THROUGH.flatMap((name) => this.app.root.find((n) => n.name === name) as pc.Entity[]);
    const off = this.seeThrough.filter((e) => e.enabled);
    // Blended without writing depth (the fog's haze, glows, light pools): on the frame these never hide what is
    // behind them, so they don't in the pick pass either.
    const veils: pc.MeshInstance[] = [];
    for (const l of layers)
      for (const mi of l.meshInstances) {
        const m = mi.material;
        if (mi.visible && m && m.blendType !== pc.BLEND_NONE && !m.depthWrite) {
          mi.visible = false;
          veils.push(mi);
        }
      }
    for (const e of off) e.enabled = false;
    try {
      picker.prepare(cam, this.app.scene, layers);
    } finally {
      for (const e of off) e.enabled = true;
      for (const mi of veils) mi.visible = true;
    }
  }
}
