import * as pc from 'playcanvas';
import { color } from './Materials';
import { ease, type Tweens } from './Tween';

/** Fixed-angle orthographic isometric camera with bounded pan and smooth zoom. */
export class CameraController {
  readonly entity: pc.Entity;
  readonly target = new pc.Vec3(4, 0, 4);
  private goal = new pc.Vec3(4, 0, 4);
  yaw = 45;
  pitch = 35;
  private dist = 40;
  zoom = 1;
  private zoomGoal = 1;
  minZoom = 0.42;
  maxZoom = 1.9;
  bounds = { minX: -3, maxX: 18, minZ: -6, maxZ: 12 };
  private shakeT = 0;
  private shakeAmp = 0;
  reducedMotion = false;
  private cinematic = false;

  constructor(
    private app: pc.AppBase,
    private tweens: Tweens,
  ) {
    const e = new pc.Entity('camera');
    e.addComponent('camera', {
      projection: pc.PROJECTION_ORTHOGRAPHIC,
      orthoHeight: 6,
      nearClip: 0.5,
      farClip: 140,
      clearColor: color('#00000000'),
    });
    app.root.addChild(e);
    this.entity = e;
    this.apply();
  }

  get cam(): pc.CameraComponent {
    return this.entity.camera!;
  }

  /** Base ortho height that keeps an 8×8 roof comfortably framed at any aspect ratio. */
  private fitHeight(): number {
    const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const aspect = Math.max(0.3, c.clientWidth / Math.max(1, c.clientHeight));
    const small = c.clientWidth < 700;
    // Portrait phones: let the roof's side corners run close to the screen edge so tiles stay tappable.
    return aspect < 1 ? Math.max(7, 6.3 / aspect) : Math.max(small ? 7 : 6.5, 8.4 / aspect);
  }

  /**
   * PlayCanvas computes fog depth as gl_FragCoord.z / gl_FragCoord.w. With an orthographic camera that
   * is the 0–1 depth-buffer value (linear between near and far), so fog distances must be converted.
   */
  fogDepth(distance: number): number {
    const c = this.cam;
    return (distance - c.nearClip) / (c.farClip - c.nearClip);
  }

  worldPerPixel(): number {
    const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    return (2 * this.cam.orthoHeight) / Math.max(1, c.clientHeight);
  }

  /** How fast the view follows its goal; a glide (roof focus) is gentler than direct input. */
  private follow = 12;

  /** Pan bounds that cover every rooftop footprint (plus a margin). */
  setBoundsFor(roofs: { origin: [number, number, number]; width: number; depth: number }[]) {
    const m = 2;
    this.bounds = {
      minX: Math.min(...roofs.map((r) => r.origin[0])) - m,
      maxX: Math.max(...roofs.map((r) => r.origin[0] + r.width)) + m,
      minZ: Math.min(...roofs.map((r) => r.origin[2])) - m,
      maxZ: Math.max(...roofs.map((r) => r.origin[2] + r.depth)) + m,
    };
  }

  /** Smoothly pans/zooms toward a point; any player pan or zoom takes over immediately. */
  glide(x: number, y: number, z: number, zoom?: number) {
    if (this.cinematic) return;
    this.goal.set(x, y, z);
    this.clamp();
    if (zoom !== undefined) this.zoomGoal = pc.math.clamp(zoom, this.minZoom, this.maxZoom);
    this.follow = this.reducedMotion ? 30 : 3.2;
  }

  get goalPoint() {
    return this.goal;
  }

  pan(dxPx: number, dyPx: number) {
    if (this.cinematic) return;
    this.follow = 12;
    const wpp = this.worldPerPixel();
    const yr = (this.yaw * Math.PI) / 180;
    const right = new pc.Vec3(Math.cos(yr), 0, -Math.sin(yr));
    const fwd = new pc.Vec3(-Math.sin(yr), 0, -Math.cos(yr));
    const pr = (this.pitch * Math.PI) / 180;
    this.goal.x += -right.x * dxPx * wpp + (fwd.x * dyPx * wpp) / Math.sin(pr);
    this.goal.z += -right.z * dxPx * wpp + (fwd.z * dyPx * wpp) / Math.sin(pr);
    this.clamp();
    this.target.copy(this.goal);
  }

  /** Immediate zoom (tests, resets). */
  setZoom(z: number) {
    this.zoom = this.zoomGoal = pc.math.clamp(z, this.minZoom, this.maxZoom);
    this.apply();
  }

  zoomBy(factor: number) {
    if (this.cinematic) return;
    if (this.follow < 12) {
      this.goal.copy(this.target); // stop a glide where it is
      this.follow = 12;
    }
    this.zoomGoal = pc.math.clamp(this.zoomGoal * factor, this.minZoom, this.maxZoom);
  }

  private clamp() {
    const b = this.bounds;
    this.goal.x = pc.math.clamp(this.goal.x, b.minX, b.maxX);
    this.goal.z = pc.math.clamp(this.goal.z, b.minZ, b.maxZ);
  }

  /** Smooth cinematic move (core reveal). */
  focus(x: number, y: number, z: number, zoom: number, dur: number) {
    const from = this.target.clone();
    const z0 = this.zoom;
    this.cinematic = true;
    this.tweens.add(dur, (k) => {
      this.target.set(from.x + (x - from.x) * k, from.y + (y - from.y) * k, from.z + (z - from.z) * k);
      this.goal.copy(this.target);
      this.zoom = this.zoomGoal = z0 + (zoom - z0) * k;
    }, { ease: ease.inOutCubic, done: () => (this.cinematic = false) });
  }

  reset() {
    this.follow = 12;
    this.goal.set(4, 0, 4);
    this.zoomGoal = 1;
  }

  shake(amount: number) {
    if (this.reducedMotion) return;
    this.shakeAmp = Math.max(this.shakeAmp, amount);
    this.shakeT = 0.4;
  }

  update(dt: number) {
    if (!this.cinematic) {
      const k = 1 - Math.exp(-dt * this.follow);
      this.zoom += (this.zoomGoal - this.zoom) * k;
      this.target.lerp(this.target, this.goal, k);
    }
    this.apply();
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeT / 0.4);
      const p = this.entity.getPosition();
      this.entity.setPosition(p.x + (Math.random() - 0.5) * a, p.y + (Math.random() - 0.5) * a, p.z + (Math.random() - 0.5) * a);
      this.markDirty();
    }
  }

  /**
   * PlayCanvas only refreshes a camera's view matrix once per rendered frame. Picking and labels run between
   * frames (and several camera moves can happen in one), so invalidate it whenever the camera moves.
   */
  private markDirty() {
    const c = (this.cam as unknown as { camera?: { _viewMatDirty: boolean; _viewProjMatDirty: boolean } }).camera;
    if (c) {
      c._viewMatDirty = true;
      c._viewProjMatDirty = true;
    }
  }

  private apply() {
    const yr = (this.yaw * Math.PI) / 180;
    const pr = (this.pitch * Math.PI) / 180;
    const t = this.target;
    this.entity.setPosition(
      t.x + this.dist * Math.cos(pr) * Math.sin(yr),
      t.y + this.dist * Math.sin(pr),
      t.z + this.dist * Math.cos(pr) * Math.cos(yr),
    );
    this.entity.lookAt(t);
    this.cam.orthoHeight = this.fitHeight() / this.zoom;
    this.markDirty();
  }

  /** Ray (origin, direction) for a CSS-pixel screen point. */
  ray(x: number, y: number): { o: pc.Vec3; d: pc.Vec3 } {
    const o = this.cam.screenToWorld(x, y, this.cam.nearClip);
    const e = this.cam.screenToWorld(x, y, this.cam.farClip);
    const d = e.sub(o).normalize();
    return { o, d };
  }

  toScreen(p: pc.Vec3): pc.Vec3 {
    return this.cam.worldToScreen(p);
  }
}
