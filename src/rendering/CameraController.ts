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
 * default zoom (1) is a close three-quarter view with a wide lens, low enough that the city rises behind
 * the area; zooming in further lowers it until the sky shows above the horizon.
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
  /** #photo-2: photo mode's lens and lean (undefined and 0 in play) */
  fovOverride: number | undefined;
  roll: number;
}

/**
 * E21.22 (§14), rebuilt as a third-person camera: the exploration camera is a chase camera on a boom behind
 * bloombot. The mouse (pointer lock) or the right stick swings it freely round bloombot and tilts it from a little
 * below the shoulder (looking up at the sky) to high above; bloombot sits in the lower middle of the frame,
 * and the middle of the screen looks at the ground a few tiles past it. Building, it lifts to look down on the
 * ground instead (`BUILD_VIEW`), so the pointer can pick a square.
 *
 * The zoom steps are boom lengths: `zoomSteps` keep the old zoom numbers (bigger is closer; 3.2 × 3.2 / distance)
 * so the rest of the game reads zoom as before, and `boom` turns a step's distance into world units.
 */
export const EXPLORE = {
  /** degrees: below zero the camera is under bloombot's shoulder looking up; 70 is nearly overhead */
  pitchMin: -15,
  pitchMax: 70,
  pitch: 16,
  distances: [2.4, 3.2, 5.0],
  zoomSteps: [(3.2 * 3.2) / 2.4, 3.2, (3.2 * 3.2) / 5.0],
  /** world units of boom per step distance (the normal step is a boom of about 4.2 tiles) */
  boom: 1.3,
  /** the point the camera orbits and looks at: this high above bloombot's feet (world units) */
  pivot: 1.05,
  /** vertical field of view (degrees) */
  fov: 62,
  smoothing: 0.15,
  /** look-ahead (tiles) toward where bloombot walks: a little, so it stays near the middle */
  lead: 0.35,
  /** seconds without camera input before the view starts swinging in behind a running bloombot */
  recentreAfter: 0.8,
  /** seconds of running before it does (a tap on a key doesn't swing it) */
  recentreWalk: 0.4,
  /** degrees a second the view swings back behind bloombot, at most */
  recentreSpeed: 90,
  /** the camera stays at least this far above the ground under it */
  clearance: 0.35,
  /** Giant trees: the camera stays this far outside a trunk, and this far under a canopy's lowest leaves */
  trunkGap: 0.45,
  canopyGap: 0.7,
  /** the boom never pulls in shorter than this share of itself for a trunk (it would sit in bloombot's back) */
  minBoom: 0.28,
  /** seconds the boom takes to swing back out once a trunk is no longer in the way (it pulls in at once) */
  boomOut: 0.45,
};

/**
 * Build mode is a top-down builder: with something in hand to build, the camera lifts off the boom to look down on
 * the ground round bloombot, so a whole run of path or pipe is in view and the pointer (or the pad's cursor) picks
 * squares on it. Leaving build mode eases back to the chase view the player had.
 */
export const BUILD_VIEW = {
  /** degrees down: steep enough to read as a plan, with the fronts of machines and decorations still showing */
  pitch: 70,
  /** the camera's distance from bloombot for each zoom step (close, normal, far), world units */
  dists: [11, 16, 23],
  /** vertical field of view (degrees): a narrower lens, so squares keep their shape to the edge of the screen */
  fov: 40,
  /** seconds to ease up into the view (and back down) */
  ease: 0.32,
};

/**
 * #782: the view inside the house: steeper than outdoors (it looks down into the room over the low front wall, so
 * no sky and nothing of the world below shows) and closer (the room fills the screen, walls round it).
 */
const INDOOR = {
  /** degrees down: the tilt range, and where it starts */
  pitch: [42, 72] as [number, number],
  startPitch: 56,
  /** the zoom range (bigger is closer) and where it starts */
  zoom: [1.15, 2.4] as [number, number],
  startZoom: 1.45,
};

/**
 * Giant trees (GiantTrees.ts): what the follow camera keeps clear of. A trunk is a vertical post the boom pulls in
 * short of; a canopy is a ceiling the camera stays under (a smooth height field: the leaves' underside over the
 * canopy, rising beyond its reach), so the camera passes under the leaves and they never hide bloombot.
 */
export interface CameraBlockers {
  /** trunks (centre and radius) within `r` of (x, z) */
  trunks(x: number, z: number, r: number): readonly { x: number; z: number; trunkR: number }[];
  /** the lowest the leaves come over (x, z), world y (Infinity: open sky) */
  ceiling(x: number, z: number): number;
}

/**
 * How much of the boom from `p` (the pivot) to `c` (the camera) is clear of the trunks: 1 when nothing is in the
 * way, else the share up to just before the first trunk it meets (looking along the ground, as the trunks stand).
 */
export function boomClear(p: { x: number; z: number }, c: { x: number; z: number }, trunks: readonly { x: number; z: number; trunkR: number }[], gap = EXPLORE.trunkGap): number {
  const dx = c.x - p.x, dz = c.z - p.z;
  const L = Math.hypot(dx, dz);
  if (L < 1e-6) return 1;
  let best = 1;
  for (const t of trunks) {
    const r = t.trunkR + gap;
    // the ray p + s·d (s in world units) meets the circle where |p + s·d − t| = r
    const ux = dx / L, uz = dz / L;
    const ox = p.x - t.x, oz = p.z - t.z;
    const b = ox * ux + oz * uz;
    const cc = ox * ox + oz * oz - r * r;
    if (cc <= 0) continue; // the pivot is inside the gap already (bloombot pressed to the bark): nothing to cut
    const disc = b * b - cc;
    if (disc < 0) continue;
    const s = -b - Math.sqrt(disc);
    if (s < 0 || s > L) continue;
    best = Math.min(best, s / L);
  }
  return best;
}

/**
 * The highest the camera may be (world y) so the line from the pivot `p` to it stays `gap` under every canopy it
 * passes beneath: the line is checked along its length, so leaves never come between bloombot and the camera.
 */
export function ceilingFor(p: { x: number; y: number; z: number }, c: { x: number; z: number }, ceiling: (x: number, z: number) => number, gap = EXPLORE.canopyGap, steps = 12): number {
  let top = Infinity;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const lim = ceiling(p.x + (c.x - p.x) * f, p.z + (c.z - p.z) * f) - gap;
    if (lim === Infinity) continue;
    // y(f) = p.y + f (camY − p.y) ≤ lim  ⇒  camY ≤ p.y + (lim − p.y) / f
    top = Math.min(top, p.y + Math.max(0, lim - p.y) / f);
  }
  return top;
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
  /**
   * #photo-2: photo mode's lens: a vertical field of view in degrees in place of the view's own (the camera stays
   * where it is, so a long lens crops in and flattens the picture and a wide one opens it up). Undefined in play.
   */
  fovOverride?: number;
  /** #photo-2: photo mode leans the horizon: degrees about the line of sight (positive: clockwise). Zero in play. */
  roll = 0;
  /** E21.22: the exploration camera is on (bloombot play): pitch is the player's, not the zoom's */
  explore = false;
  /** E21.22: the pitch the view eases to (degrees, EXPLORE.pitchMin–pitchMax) */
  pitchGoal = EXPLORE.pitch;
  private explorePitch = EXPLORE.pitch;
  /** E21.22: the look-ahead (world units), eased */
  private lead = new pc.Vec3();
  private leadGoal = new pc.Vec3();
  /** Third person: how far right of bloombot the camera looks over its shoulder (world units; build aiming) */
  shoulderGoal = 0;
  private shoulder = 0;
  /** Build mode: 1 while the top-down build view is wanted (the game sets it), 0 for the chase view */
  buildGoal = 0;
  /** how much of the build view is showing now (eased) */
  private buildK = 0;
  /** the build view's distance (the game picks it from BUILD_VIEW.dists by the zoom step) */
  buildDist = BUILD_VIEW.dists[1];
  private buildDistNow = BUILD_VIEW.dists[1];
  /** Is the top-down build view up (or on its way)? */
  get building(): boolean {
    return this.buildGoal > 0;
  }
  /** E21.22: the ground's height under a point (world y), so the camera never ends below it */
  ground?: (x: number, z: number) => number;
  /** Giant trees: trunks the boom pulls in short of, canopies it stays under */
  blockers?: CameraBlockers;
  /** the share of the boom shown (eases back out after a trunk; pulls in at once) */
  private boomShown = 1;
  /** the share of the boom clear of trunks in the last placement */
  private boomFree = 1;

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
    this.follow = this.reducedMotion ? 30 : this.explore ? 1 / EXPLORE.smoothing : 7; // E21.22: 0.15 s smoothing
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
  /** E21.22: tilts the view (degrees; positive looks down more), within 20°–60°. */
  pitchBy(degrees: number) {
    if (this.buildGoal > 0) return; // the build view's tilt is fixed; the player's own waits for the chase view
    const [lo, hi] = this.indoor ? INDOOR.pitch : [EXPLORE.pitchMin, EXPLORE.pitchMax];
    this.pitchGoal = pc.math.clamp(this.pitchGoal + degrees, lo, hi);
  }

  /** #782: inside the house: a close view looking down into the room over its low front wall. */
  private indoor = false;
  private outdoor?: { pitch: number; minZoom: number; maxZoom: number };

  get isIndoors(): boolean {
    return this.indoor;
  }

  /**
   * #782: in (or out of) the house. Inside, the view tilts down over the room and stays close enough that the walls
   * frame it (the zoom keeps to INDOOR's range); outside again, the pitch and zoom range the player had come back.
   */
  indoors(on: boolean) {
    if (on === this.indoor) return;
    this.indoor = on;
    if (on) {
      this.outdoor = { pitch: this.pitchGoal, minZoom: this.minZoom, maxZoom: this.maxZoom };
      [this.minZoom, this.maxZoom] = INDOOR.zoom;
      this.zoomGoal = pc.math.clamp(INDOOR.startZoom, this.minZoom, this.maxZoom);
      this.pitchGoal = this.explorePitch = INDOOR.startPitch;
      return;
    }
    const o = this.outdoor;
    this.outdoor = undefined;
    if (!o) return;
    this.minZoom = o.minZoom;
    this.maxZoom = o.maxZoom;
    this.zoomGoal = pc.math.clamp(this.zoomGoal, this.minZoom, this.maxZoom);
    this.pitchGoal = this.explorePitch = o.pitch;
  }

  /** Third person: the mouse turns and tilts the view at once (degrees; positive pitch looks down more). */
  look(yawDeg: number, pitchDeg: number) {
    if (this.cinematic) return;
    this.anchor = undefined;
    this.yawGoal += yawDeg;
    this.yaw = this.yawGoal;
    this.pitchBy(pitchDeg);
    this.explorePitch = this.pitchGoal;
  }

  /** E21.22: the look-ahead: where bloombot is walking (world units from it). */
  setLead(x: number, z: number) {
    this.leadGoal.set(x, 0, z);
  }

  /** E21.22: the pitch the view has now (exploration camera). */
  get explorePitchNow(): number {
    return this.explorePitch;
  }

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
    return { target: v(this.target), goal: v(this.goal), yaw: this.yaw, yawGoal: this.yawGoal, zoom: this.zoom, zoomGoal: this.zoomGoal, minZoom: this.minZoom, maxZoom: this.maxZoom, pitchOffset: this.pitchOffset, follow: this.follow, held: this.held, fovOverride: this.fovOverride, roll: this.roll };
  }

  /** E19.4.1: puts a snapshot back, at once (no glide). */
  restore(s: CameraSnapshot) {
    this.target.set(...s.target);
    this.goal.set(...s.goal);
    Object.assign(this, { yaw: s.yaw, yawGoal: s.yawGoal, zoom: s.zoom, zoomGoal: s.zoomGoal, minZoom: s.minZoom, maxZoom: s.maxZoom, pitchOffset: s.pitchOffset, follow: s.follow, held: s.held, fovOverride: s.fovOverride, roll: s.roll });
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
    if (this.explore) {
      const e = this.reducedMotion ? 1 : 1 - Math.exp(-dt / EXPLORE.smoothing);
      this.explorePitch += (this.pitchGoal - this.explorePitch) * e;
      this.lead.lerp(this.lead, this.leadGoal, e);
      this.shoulder += (this.shoulderGoal - this.shoulder) * (this.reducedMotion ? 1 : 1 - Math.exp(-dt / 0.25));
      const be = this.reducedMotion ? 1 : 1 - Math.exp(-dt / (BUILD_VIEW.ease / 3));
      this.buildK += (this.buildGoal - this.buildK) * be;
      if (Math.abs(this.buildGoal - this.buildK) < 1e-3) this.buildK = this.buildGoal;
      this.buildDistNow += (this.buildDist - this.buildDistNow) * be;
      // past a trunk, the boom swings back out smoothly (it pulled in at once, in `apply`)
      this.boomShown = this.boomFree <= this.boomShown || this.reducedMotion ? this.boomFree : this.boomShown + (this.boomFree - this.boomShown) * (1 - Math.exp(-dt / EXPLORE.boomOut));
    }
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

  /**
   * 0 at the city overview (min zoom) … 1 from the far third-person step in: how much of the chase camera the
   * view is. The map (M) glides out to the overview through it, so the swing up from behind bloombot is smooth.
   */
  private chase(): number {
    if (!this.explore) return 0;
    const far = EXPLORE.zoomSteps[2];
    return smooth(pc.math.clamp((this.zoom - this.minZoom) / Math.max(1e-3, far * 0.98 - this.minZoom), 0, 1));
  }

  private apply() {
    const n = this.nearness();
    const k = smooth(pc.math.clamp((this.zoom - VIEW.nearZoom) / (VIEW.closeZoom - VIEW.nearZoom), 0, 1));
    this.pitch = VIEW.farPitch + (VIEW.nearPitch - VIEW.farPitch) * n + (VIEW.closePitch - VIEW.nearPitch) * k;
    this.fov = VIEW.farFov + (VIEW.nearFov - VIEW.farFov) * n + (VIEW.closeFov - VIEW.nearFov) * k;
    this.viewHeight = this.fitHeight() / this.zoom;
    this.dist = this.viewHeight / Math.tan((this.fov * Math.PI) / 360);
    // Third person (bloombot): a boom behind bloombot at the player's pitch, blended out toward the overview.
    const ch = this.chase();
    let pivot = 0;
    if (ch > 0) {
      const boom = ((3.2 * 3.2) / this.zoom) * EXPLORE.boom;
      this.pitch += (this.explorePitch - this.pitch) * ch;
      this.fov += (EXPLORE.fov - this.fov) * ch;
      this.dist += (boom - this.dist) * ch;
      this.viewHeight = this.dist * Math.tan((this.fov * Math.PI) / 360);
      pivot = EXPLORE.pivot * ch;
    }
    // Build mode: up off the boom to look down on the ground round bloombot (inside the house the room's own view
    // already looks down into it: it only tilts to its steepest).
    const bk = smooth(pc.math.clamp(this.buildK, 0, 1)) * ch;
    if (bk > 0) {
      const steep = this.indoor ? INDOOR.pitch[1] : BUILD_VIEW.pitch;
      this.pitch += (steep - this.pitch) * bk;
      if (!this.indoor) {
        this.fov += (BUILD_VIEW.fov - this.fov) * bk;
        this.dist += (this.buildDistNow - this.dist) * bk;
        this.viewHeight = this.dist * Math.tan((this.fov * Math.PI) / 360);
        pivot *= 1 - bk; // it looks at the ground bloombot stands on, so the squares round it are centred
      }
    }
    if (this.pitchOffset) this.pitch = pc.math.clamp(this.pitch + this.pitchOffset, -20, 80);
    if (this.fovOverride) {
      // #photo-2: the lens changes, the camera stays put: the height in view follows the lens
      this.fov = pc.math.clamp(this.fovOverride, 5, 120);
      this.viewHeight = this.dist * Math.tan((this.fov * Math.PI) / 360);
    }
    const c = this.cam;
    c.fov = this.fov;
    // Clip planes hug the view: near just in front of the closest ground on screen (and anything tall on it),
    // far past the haze, so depth precision stays good from close-up to the city overview.
    c.nearClip = ch > 0.5 ? 0.12 : Math.max(0.3, this.dist - this.viewHeight * 2.2 - 12);
    // Just past the haze, no further: everything beyond is the haze colour, and a deeper far plane would draw
    // the city behind it. The sky dome is a backdrop that fits itself inside (Look 4.7).
    c.farClip = this.dist + this.hazeEnd + 10;
    const yr = (this.yaw * Math.PI) / 180;
    // Over the shoulder: the pivot slides along the camera's right, so bloombot stands left of the middle (not in the build view).
    const sh = this.shoulder * ch * (1 - bk);
    const ld = ch * (1 - bk); // no look-ahead from above: the ground stays still under the pointer
    const t = this.explore ? new pc.Vec3(this.target.x + this.lead.x * ld + Math.cos(yr) * sh, this.target.y + pivot, this.target.z + this.lead.z * ld - Math.sin(yr) * sh) : this.target;
    const pr = (this.pitch * Math.PI) / 180;
    let x = t.x + this.dist * Math.cos(pr) * Math.sin(yr);
    let z = t.z + this.dist * Math.cos(pr) * Math.cos(yr);
    let y = t.y + this.dist * Math.sin(pr);
    if (this.explore && this.ground) {
      // The camera never ends below the ground: looking up, or over a rise, the boom shortens toward the pivot
      // until it clears it (the way a chase camera slides along the ground), and never goes under it.
      for (let i = 0; i < 12 && y < this.ground(x, z) + EXPLORE.clearance; i++) {
        x = t.x + (x - t.x) * 0.8;
        z = t.z + (z - t.z) * 0.8;
        y = t.y + (y - t.y) * 0.8;
      }
      y = Math.max(y, this.ground(x, z) + EXPLORE.clearance);
    }
    if (this.explore && this.blockers && ch > 0.5 && bk < 0.5) {
      // Giant trees: the boom pulls in short of a trunk between bloombot and the camera (at once, so it never shows
      // the inside of the bark; it swings back out in `update`), and the camera keeps under the canopy
      const B = this.blockers;
      const reach = Math.hypot(x - t.x, z - t.z);
      this.boomFree = Math.max(EXPLORE.minBoom, boomClear(t, { x, z }, B.trunks(t.x, t.z, reach + 1)));
      const k = Math.min(this.boomShown, this.boomFree);
      if (k < 1) {
        x = t.x + (x - t.x) * k;
        z = t.z + (z - t.z) * k;
        y = t.y + (y - t.y) * k;
      }
      // lowered, not pulled in: the view keeps its distance and looks along under the leaves
      const top = ceilingFor(t, { x, z }, B.ceiling);
      if (y > top) y = Math.max(top, this.ground ? this.ground(x, z) + EXPLORE.clearance : top);
    } else this.boomFree = this.boomShown = 1;
    this.entity.setPosition(x, y, z);
    this.entity.lookAt(t);
    if (this.roll) this.entity.rotateLocal(0, 0, -this.roll);
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
