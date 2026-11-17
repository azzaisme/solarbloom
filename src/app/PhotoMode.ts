import type { CameraSnapshot } from '../rendering/CameraController';
import type { Action, Bindings } from './Bindings';

/**
 * E19.4.1 (#260): photo mode. The HUD steps aside, the camera is loosened within the city's bounds (free zoom,
 * its own pitch, and it can leave bloombot: the play camera's fixed distance from #280 doesn't apply here),
 * depth of field comes back, the game can be frozen while framing, and the canvas is saved as a PNG.
 *
 * Bloombot stays in the picture by default and strikes a pose on the way in; "Hide bloombot" takes it out.
 * Leaving restores the camera (position, turn, zoom, zoom limits, pitch) and the HUD exactly as they were.
 *
 * Controls reuse the rebindable map (src/app/Bindings.ts), so a rebound key works here too:
 * move pans, sprint pans faster, zoom keys / wheel / right stick zoom, the right stick or a right-button drag
 * turns, previous / next tool tilt, recentre turns back, pulse saves the picture, interact hides bloombot, the
 * build tray key freezes the game, Frenzy toggles depth of field, the backpack key hides the controls bar, and
 * cancel, pause or the photo key leave.
 *
 * This file only steers the view and the presentation; it never touches the simulation (freezing simply skips
 * the sim step, as pausing does).
 */
export const PHOTO = {
  /** closest zoom (the play camera stops at 4.2) */
  maxZoom: 5.5,
  /** pan speed, in screen pixels a second at full stick (sprint doubles it) */
  panSpeed: 520,
  /** degrees per tilt press, and the range of photo mode's own pitch on top of the zoom's */
  tiltStep: 4,
  tiltMin: -16,
  tiltMax: 44,
  /** zoom factor per key press */
  zoomStep: 1.12,
};

export interface PhotoCamera {
  snapshot(): CameraSnapshot;
  restore(s: CameraSnapshot): void;
  pitchOffset: number;
  maxZoom: number;
  held: boolean;
  zoomBy(factor: number): void;
  pan(dxPx: number, dyPx: number): void;
  orbit(degrees: number): void;
  recentre(): void;
}

export interface PhotoBot {
  following: boolean;
  setVisible(visible: boolean): void;
  /** a short pose (a cheer) as photo mode opens */
  pose(): void;
}

export interface PhotoState {
  freeze: boolean;
  hideBot: boolean;
  dof: boolean;
  /** the controls bar is hidden too (nothing but the picture on screen) */
  clean: boolean;
}

export interface PhotoHost {
  camera: PhotoCamera;
  bot?: PhotoBot;
  setHudHidden(hidden: boolean): void;
  setDof(on: boolean): void;
  /** save the canvas as a picture */
  capture(): void;
  /** draw the controls bar (undefined hides it) */
  render(state: PhotoState | undefined): void;
  /** the left stick, if a pad is connected (x right, y up, −1…1) */
  stick?(): { x: number; y: number } | undefined;
}

const MOVES: readonly [Action, number, number][] = [
  ['up', 0, 1],
  ['down', 0, -1],
  ['left', -1, 0],
  ['right', 1, 0],
];

export class PhotoMode {
  active = false;
  /** options, kept for the session */
  freeze = false;
  hideBot = false;
  dof = true;
  clean = false;
  private saved?: { camera: CameraSnapshot; following?: boolean };
  /** keys held (movement and sprint), fed by `key` */
  private held = new Set<string>();

  constructor(
    private host: PhotoHost,
    private bindings: Bindings,
  ) {}

  /** The game is frozen for framing (the sim, drones and tillers skip their step). */
  get frozen(): boolean {
    return this.active && this.freeze;
  }

  get state(): PhotoState {
    return { freeze: this.freeze, hideBot: this.hideBot, dof: this.dof, clean: this.clean };
  }

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  enter() {
    if (this.active) return;
    const { camera, bot } = this.host;
    this.saved = { camera: camera.snapshot(), following: bot?.following };
    this.active = true;
    this.held.clear();
    camera.held = true;
    camera.maxZoom = Math.max(camera.maxZoom, PHOTO.maxZoom);
    if (bot) {
      bot.following = false;
      bot.setVisible(!this.hideBot);
      if (!this.hideBot) bot.pose();
    }
    this.host.setHudHidden(true);
    this.host.setDof(this.dof);
    this.render();
  }

  exit() {
    if (!this.active) return;
    const { camera, bot } = this.host;
    this.active = false;
    this.held.clear();
    const s = this.saved!;
    this.saved = undefined;
    camera.restore(s.camera);
    if (bot) {
      bot.setVisible(true);
      if (s.following !== undefined) bot.following = s.following;
    }
    this.host.setDof(false);
    this.host.setHudHidden(false);
    this.host.render(undefined);
  }

  /** A key went down or up (movement and sprint are held; the game routes the rest through `action`). */
  key(code: string, down: boolean) {
    if (down) this.held.add(code);
    else this.held.delete(code);
  }

  clearKeys() {
    this.held.clear();
  }

  /** An action while photo mode is open. True when photo mode used it. */
  action(a: Action): boolean {
    if (!this.active) {
      if (a !== 'photo') return false;
      this.enter();
      return true;
    }
    const c = this.host.camera;
    switch (a) {
      case 'photo':
      case 'cancel':
      case 'pause':
        this.exit();
        return true;
      case 'pulse':
        this.host.capture();
        return true;
      case 'interact':
        this.hideBot = !this.hideBot;
        this.host.bot?.setVisible(!this.hideBot);
        break;
      case 'tray':
        this.freeze = !this.freeze;
        break;
      case 'frenzy':
        this.dof = !this.dof;
        this.host.setDof(this.dof);
        break;
      case 'backpack':
        this.clean = !this.clean;
        break;
      case 'zoomIn':
        c.zoomBy(PHOTO.zoomStep);
        return true;
      case 'zoomOut':
        c.zoomBy(1 / PHOTO.zoomStep);
        return true;
      case 'nextTool':
        this.tilt(PHOTO.tiltStep);
        return true;
      case 'prevTool':
        this.tilt(-PHOTO.tiltStep);
        return true;
      case 'recentre':
        c.recentre();
        c.pitchOffset = 0;
        return true;
      default:
        return true; // everything else (building, pulsing, travel) waits until photo mode closes
    }
    this.render();
    return true;
  }

  /** Photo mode's own pitch: positive looks further down. */
  tilt(degrees: number) {
    const c = this.host.camera;
    c.pitchOffset = Math.min(PHOTO.tiltMax, Math.max(PHOTO.tiltMin, c.pitchOffset + degrees));
  }

  /** A zoom from the wheel or the right stick (photo mode's zoom is free, within its own limits). */
  zoom(factor: number) {
    if (this.active) this.host.camera.zoomBy(factor);
  }

  /** Per frame: pan with the movement keys or the left stick, relative to where the camera looks. */
  update(dt: number) {
    if (!this.active) return;
    let ix = 0;
    let iy = 0;
    for (const [a, mx, my] of MOVES)
      if (this.bindings.isDown(a, this.held)) {
        ix += mx;
        iy += my;
      }
    const st = this.host.stick?.();
    if (st) {
      ix += st.x;
      iy += st.y;
    }
    const mag = Math.min(1, Math.hypot(ix, iy));
    if (mag < 0.01) return;
    const speed = PHOTO.panSpeed * (this.bindings.isDown('sprint', this.held) ? 2 : 1) * mag * dt;
    const l = Math.hypot(ix, iy);
    // CameraController.pan is a drag: dragging down moves the view forward, dragging left moves it right.
    this.host.camera.pan((-ix / l) * speed, (iy / l) * speed);
  }

  private render() {
    this.host.render(this.state);
  }
}

/** The first pad's left stick (x right, y up), with a dead zone; undefined without a pad. */
export function padStick(): { x: number; y: number } | undefined {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = [...pads].find((q) => q && q.connected);
  if (!gp) return undefined;
  const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
  return { x: dz(gp.axes[0] ?? 0), y: -dz(gp.axes[1] ?? 0) };
}
