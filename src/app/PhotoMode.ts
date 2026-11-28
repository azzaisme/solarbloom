import type { CameraSnapshot } from '../rendering/CameraController';
import { DAY } from '../data/time';
import type { WeatherKind } from '../data/weather';
import type { Action, Bindings } from './Bindings';
import { GOLDEN_HOUR, PHOTO_FILTERS, PHOTO_WEATHERS, type PhotoFilter, type PhotoWeather } from '../data/photo';
const FILTER_ORDER = Object.keys(PHOTO_FILTERS) as PhotoFilter[];

/**
 * E19.4.1 (#260): photo mode. The HUD steps aside, the camera is loosened within the city's bounds (free zoom,
 * its own pitch, and it can leave bloombot: the play camera's fixed distance from #280 doesn't apply here),
 * depth of field comes back, the game can be frozen while framing, and the canvas is saved as a PNG.
 *
 * Bloombot stays in the picture by default and strikes a pose on the way in; "Hide bloombot" takes it out.
 * Leaving restores the camera (position, turn, zoom, zoom limits, pitch) and the HUD exactly as they were.
 *
 * Controls reuse the rebindable map (src/app/Bindings.ts), so a rebound key works here too:
 * move pans, sprint pans faster, the wheel / right stick / zoom button zoom, the right stick or a right-button
 * drag turns, the turn-piece inputs (R, LB / RB) tilt, recentre turns back, pulse saves the picture, interact
 * hides bloombot, the build menu key freezes the game, Harvest (F, for focus) toggles depth of field, the
 * backpack key hides the controls bar, and back, the menu or the photo key leave (E22.1 names).
 *
 * E23.7.3 (#397): it can set the scene. Pin next (G, d-pad right) steps the time of day an hour at a time (the bar
 * has a slider too), the map key (M, View) picks the weather (sun, golden hour, cloud, rain, wind, storm, fog) and
 * remove (X, RT) a filter. These change only what's drawn: the game keeps its own clock and weather, and leaving
 * puts the real time and weather back.
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
  tutorial?: boolean;
  freeze: boolean;
  hideBot: boolean;
  dof: boolean;
  /** the controls bar is hidden too (nothing but the picture on screen) */
  clean: boolean;
  /** E23.7.3: photo mode's own time of day, in clock hours (undefined: the real time) */
  hour?: number;
  /** E23.7.3: photo mode's own weather */
  weather: PhotoWeather;
  filter: PhotoFilter;
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
  /** E23.7.3: the game's real clock hour (the time slider starts there) */
  clockHour?(): number;
  /** E23.7.3: a CSS filter over the view ('' for none) */
  setFilter?(css: string): void;
}

const MOVES: readonly [Action, number, number][] = [
  ['up', 0, 1],
  ['down', 0, -1],
  ['left', -1, 0],
  ['right', 1, 0],
];

export class PhotoMode {
  active = false;
  tutorial = false;
  private tutorialSettings?: { hideBot: boolean; clean: boolean; freeze: boolean };
  /** options, kept for the session */
  freeze = false;
  hideBot = false;
  dof = true;
  clean = false;
  /** E23.7.3: the scene: its own time (clock hours) and weather, and a filter. Reset on leaving. */
  hour?: number;
  weather: PhotoWeather = 'now';
  filter: PhotoFilter = 'none';
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
    return { tutorial: this.tutorial, freeze: this.freeze, hideBot: this.hideBot, dof: this.dof, clean: this.clean, hour: this.hour, weather: this.weather, filter: this.filter };
  }

  toggle() {
    if (this.active) this.exit();
    else this.enter();
  }

  enter(tutorial = false) {
    if (this.active) return;
    this.tutorial = tutorial;
    if (tutorial) {
      this.tutorialSettings = { hideBot: this.hideBot, clean: this.clean, freeze: this.freeze };
      this.hideBot = this.clean = false;
      this.freeze = true;
    }
    const { camera, bot } = this.host;
    this.saved = { camera: camera.snapshot(), following: bot?.following };
    this.active = true;
    // E23.7.3: every visit opens on the real sky, unfiltered
    this.hour = undefined;
    this.weather = 'now';
    this.filter = 'none';
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
    this.tutorial = false;
    if (this.tutorialSettings) {
      Object.assign(this, this.tutorialSettings);
      this.tutorialSettings = undefined;
    }
    this.held.clear();
    const s = this.saved!;
    this.saved = undefined;
    camera.restore(s.camera);
    if (bot) {
      bot.setVisible(true);
      if (s.following !== undefined) bot.following = s.following;
    }
    this.host.setDof(false);
    // E23.7.3: nothing set here outlives photo mode: the real time and weather come back, the filter goes
    this.hour = undefined;
    this.weather = 'now';
    this.filter = 'none';
    this.host.setFilter?.('');
    this.host.setHudHidden(false);
    this.host.render(undefined);
  }

  // ───────────── E23.7.3: time, weather and filters (presentation only) ─────────────

  /** The day fraction the sky and light should show, or undefined for the real light clock. */
  lightOverride(): number | undefined {
    if (!this.active || this.hour === undefined) return undefined;
    const f = (this.hour - DAY.dawnHour) / 24;
    return f - Math.floor(f);
  }

  /** The weather the screen should show, or undefined for the real weather. */
  weatherOverride(): WeatherKind | undefined {
    if (!this.active || this.weather === 'now') return undefined;
    return this.weather === 'golden' ? 'sunny' : this.weather;
  }

  /** Sets photo mode's own time (clock hours, wrapped to 0…24), or undefined for the real time. */
  setHour(h: number | undefined) {
    this.hour = h === undefined ? undefined : ((h % 24) + 24) % 24;
    if (this.weather === 'golden' && h !== GOLDEN_HOUR) this.weather = 'sunny'; // moved off golden hour
    this.render();
  }

  /** The next hour on the clock (from the real time first); after a full turn it goes back to the real time. */
  stepHour() {
    const base = this.hour ?? this.host.clockHour?.() ?? 12;
    const next = Math.floor(base) + 1;
    const real = Math.floor(this.host.clockHour?.() ?? 12);
    this.setHour(this.hour !== undefined && ((next % 24) + 24) % 24 === real ? undefined : next);
  }

  /** The next weather in the picker (golden hour sets the time to 21:00, the hour before dusk). */
  setWeather(w: PhotoWeather) {
    this.weather = w;
    if (w === 'golden') this.hour = GOLDEN_HOUR;
    this.render();
  }

  stepWeather() {
    this.setWeather(PHOTO_WEATHERS[(PHOTO_WEATHERS.indexOf(this.weather) + 1) % PHOTO_WEATHERS.length]);
  }

  setFilter(f: PhotoFilter) {
    this.filter = f;
    this.host.setFilter?.(PHOTO_FILTERS[f].css);
    this.render();
  }

  stepFilter() {
    this.setFilter(FILTER_ORDER[(FILTER_ORDER.indexOf(this.filter) + 1) % FILTER_ORDER.length]);
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
      case 'menu':
        this.exit();
        return true;
      case 'pulse':
        this.host.capture();
        return true;
      case 'interact':
        this.hideBot = !this.hideBot;
        this.host.bot?.setVisible(!this.hideBot);
        break;
      case 'buildMenu':
        this.freeze = !this.freeze;
        break;
      case 'eat': // F for focus
        this.dof = !this.dof;
        this.host.setDof(this.dof);
        break;
      case 'backpack':
        this.clean = !this.clean;
        break;
      case 'pinNext': // E23.7.3: G / d-pad right: the next hour
        this.stepHour();
        return true;
      case 'map': // M / View: the next weather
        this.stepWeather();
        return true;
      case 'removeMode': // X / RT: the next filter
        this.stepFilter();
        return true;
      case 'zoomCamera':
        c.zoomBy(PHOTO.zoomStep);
        return true;
      case 'rotate':
        this.tilt(PHOTO.tiltStep);
        return true;
      case 'rotateBack':
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
