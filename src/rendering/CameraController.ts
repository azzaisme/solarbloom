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
  /** Past the default (near) zoom, the camera keeps lowering toward this pitch and lens at `closeZoom`. */
  closeZoom: number;
  closePitch: number;
  closeFov: number;
}

/**
 * Look 4.10 (#154): zoomed out (≤ farZoom) a high, narrow lens that reads like the old isometric grid; the
 * default zoom (1) is a close three-quarter view with a wide lens, low enough that the skyline rises behind
 * the area; zooming in further lowers it until the sky shows above the skyline.
 */
export const VIEW: ViewProfile = { farZoom: 0.45, nearZoom: 1.0, farPitch: 42, nearPitch: 24, farFov: 12, nearFov: 52, closeZoom: 1.9, closePitch: 19, closeFov: 56 };

const smooth = (t: number) => t * t * (3 - 2 * t);

/** E19.4.1: everything photo mode may change about the view, so leaving it puts the view back exactly. */
export interface CameraSnapshot {
  target: [number, number, number];
  goal: [number, number, number];
  yaw: number;
  yawGoal: number;
  zoom: number;
  zoomGoal: number;
  minZoom: number;
  maxZoom: number;
  pitchOffset: number;
  follow: number;
  held: boolean;
}

export class CameraController {
  readonly entity: pc.Entity;
  readonly target = new pc.Vec3(4, 0, 4);
  private goal = new pc.Vec3(4, 0, 4);
  yaw = 45;
  /** Bloombot: where the view is turning to (degrees; may run past 360, the view eases along the short way) */
  private yawGoal = 45;
  static readonly HOME_YAW = 45;
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
  /**
   * E19.4.1 (#260): photo mode's own pitch, in degrees on top of the zoom's (positive looks down more). Zero in
   * play: the play camera's pitch always follows the zoom.
   */
  pitchOffset = 0;
  /** E19.4.1: photo mode holds the view: glides, follows and eased zooms from the game leave it alone. */
  held = false;

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
    if (this.cinematic || this.held) return;
    this.anchor = undefined;
    this.goal.set(x, y, z);
    this.clamp();
    if (zoom !== undefined) this.zoomGoal = pc.math.clamp(zoom, this.minZoom, this.maxZoom);
    this.follow = this.reducedMotion ? 30 : 3.2;
  }

  /**
   * Bloombot (G.3): follow a moving point each frame. Unlike `glide` it keeps any zoom in progress and follows
   * briskly, so the character stays near the middle of the view while it walks.
   */
  track(x: number, y: number, z: number) {
    if (this.cinematic || this.held) return;
    this.anchor = undefined;
    this.goal.set(x, y, z);
    this.clamp();
    this.follow = this.reducedMotion ? 30 : 7;
  }

  /** Bloombot: ease to a zoom without moving the view or changing how it follows. */
  zoomTo(zoom: number) {
    if (this.cinematic || this.held) return;
    this.anchor = undefined;
    this.zoomGoal = pc.math.clamp(zoom, this.minZoom, this.maxZoom);
  }

  get zoomTarget(): number {
    return this.zoomGoal;
  }

  /** Bloombot: turn the view around its target by some degrees (positive moves the camera to its right). */
  /** E21.24: where the view is turning to (degrees). */
  get heading(): number {
    return this.yawGoal;
  }

  /** E21.24: turns the view to a heading (degrees); `instant` jumps there (a still frame for reduced motion). */
  turnTo(degrees: number, instant = false) {
    this.yawGoal = degrees;
    if (instant) this.yaw = degrees;
  }

  /** E21.24: sets the zoom at once (reduced motion cuts instead of easing). */
  jumpZoom(zoom: number) {
    this.zoom = this.zoomGoal = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
  }

  orbit(degrees: number) {
    if (this.cinematic) return;
    this.anchor = undefined;
    this.yawGoal += degrees;
  }

  /** Bloombot: turn back to the default angle, the short way round. */
  recentre() {
    const turns = Math.round((this.yawGoal - CameraController.HOME_YAW) / 360);
    this.yawGoal = CameraController.HOME_YAW + turns * 360;
  }

  /** Is the view at (or heading back to) the default angle? */
  get centred(): boolean {
    return Math.abs((((this.yawGoal - CameraController.HOME_YAW) % 360) + 360) % 360) < 0.01;
  }

  get goalPoint() {
    return this.goal;
  }

  /**
   * Look 4.4: drag panning keeps the ground point under the pointer fixed. `x, y` is where the pointer is now
   * (it moved by `dx, dy` since the last call); the ground under the previous position moves to the new one.
   * Without a position (keys, tests), or when either point is near the horizon, it falls back to a flat pan at
   * the target's scale.
   */
  pan(dxPx: number, dyPx: number, x?: number, y?: number) {
    if (this.cinematic) return;
    this.follow = 12;
    this.anchor = undefined;
    this.target.copy(this.goal);
    this.apply();
    const from = { x: this.goal.x, z: this.goal.z };
    const a = x !== undefined && y !== undefined ? this.groundAt(x - dxPx, y - dyPx) : undefined;
    const b = a && this.groundAt(x!, y!);
    if (a && b) {
      this.goal.x += a.x - b.x;
      this.goal.z += a.z - b.z;
    } else {
      const wpp = this.worldPerPixel();
      const yr = (this.yaw * Math.PI) / 180;
      const right = new pc.Vec3(Math.cos(yr), 0, -Math.sin(yr));
      const fwd = new pc.Vec3(-Math.sin(yr), 0, -Math.cos(yr));
      const pr = (this.pitch * Math.PI) / 180;
      this.goal.x += -right.x * dxPx * wpp + (fwd.x * dyPx * wpp) / Math.sin(pr);
      this.goal.z += -right.z * dxPx * wpp + (fwd.z * dyPx * wpp) / Math.sin(pr);
    }
    this.clamp(from);
    this.target.copy(this.goal);
    this.apply();
  }

  /**
   * The ground point (y = target height) under a CSS-pixel screen point, or undefined when the ray runs at or
   * above the horizon or meets the ground too far away to be useful (pan and zoom anchors fall back then).
   */
  groundAt(x: number, y: number, maxDist = this.dist * 6 + 40): pc.Vec3 | undefined {
    const { o, d } = this.ray(x, y);
    if (d.y > -0.02) return undefined;
    const t = (this.target.y - o.y) / d.y;
    if (t < 0 || t > maxDist) return undefined;
    return new pc.Vec3(o.x + d.x * t, this.target.y, o.z + d.z * t);
  }

  /** A zoom toward a screen point: the ground there stays under it while the zoom eases in. */
  private anchor?: { sx: number; sy: number; w: pc.Vec3 };

  /** Immediate zoom (tests, resets). */
  setZoom(z: number) {
    this.zoom = this.zoomGoal = pc.math.clamp(z, this.minZoom, this.maxZoom);
    this.apply();
  }

  /** Zoom by a factor, toward a screen point (wheel cursor, pinch centre) when one is given. */
  zoomBy(factor: number, x?: number, y?: number) {
    if (this.cinematic) return;
    if (this.follow < 12) {
      this.goal.copy(this.target); // stop a glide where it is
      this.follow = 12;
    }
    this.zoomGoal = pc.math.clamp(this.zoomGoal * factor, this.minZoom, this.maxZoom);
    const w = x !== undefined && y !== undefined ? this.groundAt(x, y) : undefined;
    this.anchor = w ? { sx: x!, sy: y!, w } : undefined;
  }

  /** How far past the pan bounds the edge of the view may show (the fog and the far city are scenery). */
  edgeSlack = 6;

  /**
   * Look 4.4: keep the visible ground, not just the centre, inside the bounds. The ground footprint of the
   * screen's sides and bottom (the top runs to the horizon close up) is measured relative to the target; the
   * target's range shrinks so those edges stay within the bounds plus `edgeSlack`. Where the view is wider
   * than the bounds on an axis, it centres on them.
   */
  private clamp(from?: { x: number; z: number }) {
    const b = this.bounds;
    if (!from) {
      // A glide or focus may centre anywhere inside the bounds (an area at the edge gets framed too).
      this.goal.x = pc.math.clamp(this.goal.x, b.minX, b.maxX);
      this.goal.z = pc.math.clamp(this.goal.z, b.minZ, b.maxZ);
      return;
    }
    const f = this.footprint();
    const s = this.edgeSlack;
    // Player input: never move further past the edge than where the view already is (no snapping back).
    const axis = (v: number, prev: number, lo: number, hi: number, fLo: number, fHi: number) => {
      let a = Math.max(lo, lo - s - fLo);
      let z = Math.min(hi, hi + s - fHi);
      if (a > z) a = z = (lo + hi) / 2 - (fLo + fHi) / 2;
      a = Math.max(lo, Math.min(a, prev));
      z = Math.min(hi, Math.max(z, prev));
      return pc.math.clamp(v, a, z);
    };
    this.goal.x = axis(this.goal.x, from.x, b.minX, b.maxX, f.x0, f.x1);
    this.goal.z = axis(this.goal.z, from.z, b.minZ, b.maxZ, f.z0, f.z1);
  }

  /** Ground footprint of the screen edges (sides, bottom and, when it meets the ground, the top) around the target. */
  private footprint() {
    const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const f = { x0: 0, x1: 0, z0: 0, z1: 0 };
    if (!w || !h) return f;
    const reach = this.dist * 2.5;
    for (const [sx, sy] of [[0, h], [w, h], [0, h / 2], [w / 2, h], [w, h / 2], [0, 0], [w, 0], [w / 2, 0]]) {
      const p = this.groundAt(sx, sy, reach);
      if (!p) continue;
      f.x0 = Math.min(f.x0, p.x - this.target.x);
      f.x1 = Math.max(f.x1, p.x - this.target.x);
      f.z0 = Math.min(f.z0, p.z - this.target.z);
      f.z1 = Math.max(f.z1, p.z - this.target.z);
    }
    return f;
  }

  /** Smooth cinematic move (core reveal). */
  focus(x: number, y: number, z: number, zoom: number, dur: number) {
    const from = this.target.clone();
    const z0 = this.zoom;
    this.cinematic = true;
    this.anchor = undefined;
    this.tweens.add(dur, (k) => {
      this.target.set(from.x + (x - from.x) * k, from.y + (y - from.y) * k, from.z + (z - from.z) * k);
      this.goal.copy(this.target);
      this.zoom = this.zoomGoal = z0 + (zoom - z0) * k;
    }, { ease: ease.inOutCubic, done: () => (this.cinematic = false) });
  }

  /** E19.4.1: the view as it is now (photo mode keeps it to put back on the way out). */
  snapshot(): CameraSnapshot {
    const v = (p: pc.Vec3): [number, number, number] => [p.x, p.y, p.z];
    return { target: v(this.target), goal: v(this.goal), yaw: this.yaw, yawGoal: this.yawGoal, zoom: this.zoom, zoomGoal: this.zoomGoal, minZoom: this.minZoom, maxZoom: this.maxZoom, pitchOffset: this.pitchOffset, follow: this.follow, held: this.held };
  }

  /** E19.4.1: puts a snapshot back, at once (no glide). */
  restore(s: CameraSnapshot) {
    this.target.set(...s.target);
    this.goal.set(...s.goal);
    Object.assign(this, { yaw: s.yaw, yawGoal: s.yawGoal, zoom: s.zoom, zoomGoal: s.zoomGoal, minZoom: s.minZoom, maxZoom: s.maxZoom, pitchOffset: s.pitchOffset, follow: s.follow, held: s.held });
    this.anchor = undefined;
    this.apply();
  }

  reset() {
    this.follow = 12;
    this.anchor = undefined;
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
      // Turning eases briskly whatever the follow speed (a glide's slow follow would make it feel stuck).
      const turn = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 14);
      this.yaw += (this.yawGoal - this.yaw) * turn;
      if (Math.abs(this.yawGoal - this.yaw) < 0.01) this.yaw = this.yawGoal;
      this.target.lerp(this.target, this.goal, k);
      if (this.anchor) {
        // Zoom toward the cursor: move the view so the anchored ground point stays under it.
        this.apply();
        const p = this.groundAt(this.anchor.sx, this.anchor.sy);
        if (p) {
          const from = { x: this.goal.x, z: this.goal.z };
          this.goal.x += this.anchor.w.x - p.x;
          this.goal.z += this.anchor.w.z - p.z;
          this.clamp(from);
          this.target.copy(this.goal);
        }
        if (!p || Math.abs(this.zoomGoal - this.zoom) < 1e-4 * this.zoomGoal) this.anchor = undefined;
      }
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
    const k = smooth(pc.math.clamp((this.zoom - VIEW.nearZoom) / (VIEW.closeZoom - VIEW.nearZoom), 0, 1));
    this.pitch = VIEW.farPitch + (VIEW.nearPitch - VIEW.farPitch) * n + (VIEW.closePitch - VIEW.nearPitch) * k;
    if (this.pitchOffset) this.pitch = pc.math.clamp(this.pitch + this.pitchOffset, 6, 80);
    this.fov = VIEW.farFov + (VIEW.nearFov - VIEW.farFov) * n + (VIEW.closeFov - VIEW.nearFov) * k;
    this.viewHeight = this.fitHeight() / this.zoom;
    this.dist = this.viewHeight / Math.tan((this.fov * Math.PI) / 360);
    const c = this.cam;
    c.fov = this.fov;
    // Clip planes hug the view: near just in front of the closest ground on screen (and anything tall on it),
    // far past the haze, so depth precision stays good from close-up to the city overview.
    c.nearClip = Math.max(0.3, this.dist - this.viewHeight * 2.2 - 12);
    // Just past the haze, no further: everything beyond is the haze colour, and a deeper far plane would draw
    // the city behind it. The sky dome and the skyline are a backdrop that fits itself inside (Look 4.7, 4.8).
    c.farClip = this.dist + this.hazeEnd + 10;
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

  /**
   * Look 4.6: a world point as screen-space UI sees it. Undefined when it is behind (or nearly at) the camera,
   * past the haze, or further than `margin` CSS pixels off screen, so labels are never drawn mirrored from
   * behind the camera. `scale` shrinks far labels and grows near ones a little (1 at the target's distance).
   */
  onScreen(p: pc.Vec3, margin = 60): { x: number; y: number; depth: number; scale: number } | undefined {
    const e = this.entity.getPosition();
    const f = this.entity.forward;
    const depth = (p.x - e.x) * f.x + (p.y - e.y) * f.y + (p.z - e.z) * f.z;
    if (depth < this.cam.nearClip + 0.2 || depth > this.dist + this.hazeEnd) return undefined;
    const s = this.cam.worldToScreen(p);
    const c = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    if (s.x < -margin || s.y < -margin || s.x > c.clientWidth + margin || s.y > c.clientHeight + margin) return undefined;
    return { x: s.x, y: s.y, depth, scale: pc.math.clamp(this.dist / depth, 0.7, 1.25) };
  }
}
