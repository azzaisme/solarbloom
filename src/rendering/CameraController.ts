import * as pc from 'playcanvas';
import { color, PALETTE } from './Materials';
import { ease, type Tweens } from './Tween';

/**
 * Isometric camera with bounded pan and smooth zoom. Phase 5: the view depends on the zoom. Zoomed out it is a
 * high, narrow-angle perspective that reads almost like the old orthographic grid (planning, city overview);
 * zoomed in it drops lower with a wider lens, so trees and machines feel close and the city rises behind them.
 *
 * Framing is unchanged: `viewHeight` is the world height visible at the target (what `orthoHeight` used to be),
 * and the camera distance is chosen so a perspective lens shows exactly that, so zoom levels, pan speed and
 * hit radii mean what they did.
 */
export interface ViewProfile {
  /** zoom at/below which the view is fully "far" */
  farZoom: number;
  /** zoom at/above which the view is fully "near" */
  nearZoom: number;
  farPitch: number;
  nearPitch: number;
  /** vertical field of view, degrees */
  farFov: number;
  nearFov: number;
}

export const VIEW: ViewProfile = { farZoom: 0.5, nearZoom: 1.7, farPitch: 40, nearPitch: 25, farFov: 12, nearFov: 36 };

const smooth = (t: number) => t * t * (3 - 2 * t);

export class CameraController {
  readonly entity: pc.Entity;
  readonly target = new pc.Vec3(4, 0, 4);
  private goal = new pc.Vec3(4, 0, 4);
  yaw = 45;
  /** current pitch (degrees); follows the zoom */
  pitch = 35;
  /** current vertical field of view (degrees); follows the zoom */
  fov = 20;
  /** distance from the camera to the target */
  dist = 40;
  /** world height visible at the target */
  viewHeight = 6;
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
      projection: pc.PROJECTION_PERSPECTIVE,
      fov: 20,
      nearClip: 0.5,
      farClip: 140,
      clearColor: color(PALETTE.pure.clear),
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
   * PlayCanvas computes fog depth as gl_FragCoord.z / gl_FragCoord.w. For a perspective camera that is
   * far × (depth − near) / (far − near): linear in view depth but not equal to it, so convert distances.
   */
  fogDepth(distance: number): number {
    const c = this.cam;
    return (c.farClip * (distance - c.nearClip)) / (c.farClip - c.nearClip);
  }

  /** How far past the target (along the view) the haze starts and is complete. */
  hazeStart = 6;
  hazeEnd = 44;

  /** Shadow reach from the camera: the whole view around the target, not the far city. */
  shadowDistance(): number {
    return this.dist + Math.max(5, this.viewHeight * 0.9);
  }

  /** World units per CSS pixel at the target. */
  worldPerPixel(): number {
    const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    return (2 * this.viewHeight) / Math.max(1, c.clientHeight);
  }

  /** 0 = fully far view … 1 = fully near view, for a zoom. */
  nearness(zoom = this.zoom): number {
    return smooth(pc.math.clamp((zoom - VIEW.farZoom) / (VIEW.nearZoom - VIEW.farZoom), 0, 1));
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
    const n = this.nearness();
    this.pitch = VIEW.farPitch + (VIEW.nearPitch - VIEW.farPitch) * n;
    this.fov = VIEW.farFov + (VIEW.nearFov - VIEW.farFov) * n;
    this.viewHeight = this.fitHeight() / this.zoom;
    this.dist = this.viewHeight / Math.tan((this.fov * Math.PI) / 360);
    const c = this.cam;
    c.fov = this.fov;
    // Clip planes hug the view: near just in front of the closest ground on screen (and anything tall on it),
    // far past the haze, so depth precision stays good from close-up to the city overview.
    c.nearClip = Math.max(0.3, this.dist - this.viewHeight * 2.2 - 12);
    c.farClip = this.dist + this.hazeEnd + 60;
    const yr = (this.yaw * Math.PI) / 180;
    const pr = (this.pitch * Math.PI) / 180;
    const t = this.target;
    this.entity.setPosition(
      t.x + this.dist * Math.cos(pr) * Math.sin(yr),
      t.y + this.dist * Math.sin(pr),
      t.z + this.dist * Math.cos(pr) * Math.cos(yr),
    );
    this.entity.lookAt(t);
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
