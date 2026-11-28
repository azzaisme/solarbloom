import type { CameraSnapshot } from '../rendering/CameraController';
import { DAY } from '../data/time';
import type { WeatherKind } from '../data/weather';
import type { Action, Bindings } from './Bindings';
import {
  focalLength, focusFromSlider, focusToSlider, GOLDEN_HOUR, PHOTO_FACES, PHOTO_FILTERS, PHOTO_FRAMES, PHOTO_GRIDS, PHOTO_LENS, PHOTO_POSES, PHOTO_SIZES,
  PHOTO_WEATHER_NAMES, PHOTO_WEATHERS, type PhotoFace, type PhotoFilter, type PhotoFrame, type PhotoGrid, type PhotoPose, type PhotoSize, type PhotoWeather,
} from '../data/photo';
const FILTER_ORDER = Object.keys(PHOTO_FILTERS) as PhotoFilter[];
const FRAME_ORDER = Object.keys(PHOTO_FRAMES) as PhotoFrame[];
const GRID_ORDER = Object.keys(PHOTO_GRIDS) as PhotoGrid[];
const SIZE_ORDER = Object.keys(PHOTO_SIZES) as PhotoSize[];
const POSE_ORDER = Object.keys(PHOTO_POSES) as PhotoPose[];
const FACE_ORDER = Object.keys(PHOTO_FACES) as PhotoFace[];

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
 * Photo mode 2 (#photo-2): it is a camera now, not only a view. A panel of five tabs holds every setting as a row:
 * View (the lens from wide to long, a leaning horizon, the tilt), Focus (where the picture is sharp and how strongly
 * the rest blurs, in front as well as behind), Light (the time, weather and filter above, plus brightness and a
 * vignette), Bloombot (hidden or not, a pose, a face, turned to the camera, the garden frozen) and Frame (the
 * picture's shape, guide lines, a double-size picture, the panel hidden). The arrow keys or the d-pad walk the
 * panel: up and down choose a row, left and right change it (on the tabs: change tab); the mouse drags and clicks.
 * The shortcuts above still work from any tab. The lens, focus, brightness, vignette, pose and face are for one
 * visit; the frame, guides, picture size, blur strength and the open tab are kept for the session.
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

export type PhotoTab = 'view' | 'focus' | 'light' | 'bot' | 'frame';
export const PHOTO_TABS: readonly { id: PhotoTab; name: string }[] = [
  { id: 'view', name: 'View' },
  { id: 'focus', name: 'Focus' },
  { id: 'light', name: 'Light' },
  { id: 'bot', name: 'Bloombot' },
  { id: 'frame', name: 'Frame' },
];
export type PhotoRowId =
  | 'lens' | 'roll' | 'tilt' | 'resetView'
  | 'dof' | 'focus' | 'pick' | 'blur'
  | 'hour' | 'weather' | 'filter' | 'ev' | 'vignette'
  | 'hideBot' | 'pose' | 'face' | 'faceCamera' | 'freeze'
  | 'frame' | 'grid' | 'size' | 'clean';
const TAB_ROWS: Record<PhotoTab, readonly PhotoRowId[]> = {
  view: ['lens', 'roll', 'tilt', 'resetView'],
  focus: ['dof', 'focus', 'pick', 'blur'],
  light: ['hour', 'weather', 'filter', 'ev', 'vignette'],
  bot: ['hideBot', 'pose', 'face', 'faceCamera', 'freeze'],
  frame: ['frame', 'grid', 'size', 'clean'],
};
export type PhotoDir = 'up' | 'down' | 'left' | 'right';

/** One setting as the panel draws it. */
export interface PhotoRow {
  id: PhotoRowId;
  label: string;
  kind: 'slider' | 'choice' | 'toggle' | 'button';
  /** what it is set to, in words */
  text: string;
  /** a slider's place and range */
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  /** a toggle's state */
  on?: boolean;
  /** the key or button that does the same from any tab */
  action?: Action;
  /** why it can't be used right now (the row is drawn dim, and nothing changes it) */
  off?: string;
}

/** What the picture's look needs from the post-processing stack and the light. */
export interface PhotoLook {
  dof: boolean;
  /** the sharp plane's distance from the camera (undefined: on what the camera looks at) */
  focus?: number;
  /** 0 (soft) … 1 (strong) */
  blur: number;
  /** brightness in stops (0: as it is) */
  ev: number;
  /** 0 … 1 */
  vignette: number;
}

export interface PhotoCamera {
  /** #photo-2: the lens (vertical field of view in degrees; undefined: the view's own) and the horizon's lean */
  fovOverride?: number;
  roll?: number;
  /** the field of view in use */
  readonly fov?: number;
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
  /** #photo-2: plays one of its clips on the spot (`stand`: nothing) */
  play?(pose: PhotoPose): void;
  /** #photo-2: holds a visor face (`auto`: its own again) */
  setFace?(face: PhotoFace): void;
  /** #photo-2: turns it to the camera (off: back the way it faced) */
  faceCamera?(on: boolean): void;
  /** #photo-2: sitting or busy: no poses now */
  readonly seated?: boolean;
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
  /** #photo-2: the panel: the open tab, its rows, and the row in hand (−1: the tabs) */
  tab: PhotoTab;
  row: number;
  rows: PhotoRow[];
  frame: PhotoFrame;
  grid: PhotoGrid;
  /** the next press on the picture sets the focus there (instead of saving it) */
  picking: boolean;
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
  /** #photo-2: focus, blur, brightness and vignette (undefined on leaving: the game's own look) */
  setLook?(look: PhotoLook | undefined): void;
  /** #photo-2: how far from the camera the world under the pointer is, for "Pick a spot" */
  focusAt?(): number | undefined;
  /** #photo-2: the graphics tier draws blur and vignette (Low has no post-processing) */
  hasPost?(): boolean;
  /** #photo-2: a mouse is in hand (false on a pad: "Pick a spot" needs a pointer) */
  hasPointer?(): boolean;
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
  // ───── #photo-2 ─────
  /** the lens for this visit (undefined: the view's own), the horizon's lean, and the sharp plane (undefined: auto) */
  fov?: number;
  roll = 0;
  focus?: number;
  ev = 0;
  vignette = 0;
  pose: PhotoPose = 'stand';
  face: PhotoFace = 'auto';
  faceCamera = false;
  picking = false;
  /** kept for the session */
  blur = 0.3;
  frame: PhotoFrame = 'screen';
  grid: PhotoGrid = 'none';
  size: PhotoSize = 'screen';
  tab: PhotoTab = 'view';
  /** the row in hand in the open tab (−1: the tabs themselves) */
  row = -1;
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
    return {
      tutorial: this.tutorial, freeze: this.freeze, hideBot: this.hideBot, dof: this.dof, clean: this.clean, hour: this.hour, weather: this.weather, filter: this.filter,
      tab: this.tab, row: this.row, rows: this.rows(), frame: this.frame, grid: this.grid, picking: this.picking,
    };
  }

  /** What the look needs now. */
  get look(): PhotoLook {
    return { dof: this.dof, focus: this.focus, blur: this.blur, ev: this.ev, vignette: this.vignette };
  }

  /** The size the saved picture is drawn at, as a multiple of the screen's. */
  get pictureScale(): number {
    return PHOTO_SIZES[this.size].scale;
  }

  /** Everything set for one visit goes back to plain (entering and leaving). */
  private resetVisit() {
    this.hour = undefined;
    this.weather = 'now';
    this.filter = 'none';
    this.fov = undefined;
    this.roll = 0;
    this.focus = undefined;
    this.ev = 0;
    this.vignette = 0;
    this.pose = 'stand';
    this.face = 'auto';
    this.faceCamera = false;
    this.picking = false;
  }

  private applyLens() {
    const c = this.host.camera;
    c.fovOverride = this.fov;
    c.roll = this.roll;
  }

  private applyLook() {
    this.host.setDof(this.dof);
    this.host.setLook?.(this.look);
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
    // E23.7.3: every visit opens on the real sky, unfiltered (#photo-2: and on the view's own lens, level and in focus)
    this.resetVisit();
    this.row = -1;
    this.held.clear();
    camera.held = true;
    camera.maxZoom = Math.max(camera.maxZoom, PHOTO.maxZoom);
    if (bot) {
      bot.following = false;
      bot.setVisible(!this.hideBot);
      if (!this.hideBot) bot.pose();
    }
    this.host.setHudHidden(true);
    this.applyLook();
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
    const posed = this.faceCamera;
    const faced = this.face !== 'auto';
    this.resetVisit();
    this.applyLens();
    camera.restore(s.camera);
    if (bot) {
      if (posed) bot.faceCamera?.(false);
      if (faced) bot.setFace?.('auto');
      bot.setVisible(true);
      if (s.following !== undefined) bot.following = s.following;
    }
    this.host.setDof(false);
    // E23.7.3: nothing set here outlives photo mode: the real time and weather come back, the filter goes
    // (#photo-2: and the game's own look and lens)
    this.host.setLook?.(undefined);
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
        if (this.picking) this.focusHere();
        else this.host.capture();
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
        this.applyLook();
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
        this.render();
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
    this.render();
  }

  // ───────────── #photo-2: the panel (tabs of rows) ─────────────

  private get post(): boolean {
    return this.host.hasPost?.() ?? true;
  }

  /** The open tab's rows, as the panel draws them. */
  rows(tab: PhotoTab = this.tab): PhotoRow[] {
    return TAB_ROWS[tab].map((id) => this.rowOf(id));
  }

  private rowOf(id: PhotoRowId): PhotoRow {
    const L = PHOTO_LENS;
    const c = this.host.camera;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const noPost = this.post ? undefined : 'Needs Medium graphics or better';
    const noBlur = noPost ?? (this.dof ? undefined : 'Turn the blur on first');
    const bot = this.host.bot;
    const noBot = !bot ? 'Bloombot is not here' : this.hideBot ? 'Bloombot is hidden' : undefined;
    switch (id) {
      case 'lens': {
        const fov = this.fov ?? c.fov ?? 50;
        // the slider runs wide (left) to long (right): its value mirrors the field of view
        return { id, label: 'Lens', kind: 'slider', text: `${focalLength(fov)} mm`, value: L.fovMin + L.fovMax - fov, min: L.fovMin, max: L.fovMax, step: 1 };
      }
      case 'roll':
        return { id, label: 'Lean', kind: 'slider', text: this.roll ? `${this.roll > 0 ? '+' : ''}${Math.round(this.roll)}°` : 'Level', value: this.roll, min: -L.rollMax, max: L.rollMax, step: 1 };
      case 'tilt':
        return { id, label: 'Tilt', kind: 'slider', text: `${Math.round(c.pitchOffset)}°`, value: c.pitchOffset, min: PHOTO.tiltMin, max: PHOTO.tiltMax, step: 1, action: 'rotate' };
      case 'resetView':
        return { id, label: 'Reset', kind: 'button', text: 'Back to the start', action: 'recentre' };
      case 'dof':
        return { id, label: 'Blur', kind: 'toggle', text: this.dof ? 'On' : 'Off', on: this.dof, action: 'eat', off: noPost };
      case 'focus':
        return { id, label: 'Sharp at', kind: 'slider', text: this.focus === undefined ? 'The middle' : `${this.focus.toFixed(1)} tiles`, value: this.focus === undefined ? 0.5 : focusToSlider(this.focus), min: 0, max: 1, step: 0.01, off: noBlur };
      case 'pick':
        return { id, label: 'Focus', kind: 'button', text: this.picking ? 'Now press on the picture' : this.focus === undefined ? 'Pick a spot' : 'Back to the middle', on: this.picking, off: noBlur ?? (this.host.hasPointer?.() === false ? 'This needs a mouse: use the slider above' : undefined) };
      case 'blur':
        return { id, label: 'Strength', kind: 'slider', text: pct(this.blur), value: this.blur, min: 0, max: 1, step: 0.05, off: noBlur };
      case 'hour': {
        const h = this.hour ?? this.host.clockHour?.() ?? 12;
        const hh = Math.floor(h);
        const clock = `${String(hh).padStart(2, '0')}:${String(Math.floor((h - hh) * 60)).padStart(2, '0')}`;
        return { id, label: 'Time', kind: 'slider', text: `${clock}${this.hour === undefined ? ' (now)' : ''}`, value: h, min: 0, max: 23.75, step: 0.25, action: 'pinNext' };
      }
      case 'weather':
        return { id, label: 'Weather', kind: 'choice', text: PHOTO_WEATHER_NAMES[this.weather], action: 'map' };
      case 'filter':
        return { id, label: 'Filter', kind: 'choice', text: PHOTO_FILTERS[this.filter].name, action: 'removeMode' };
      case 'ev':
        return { id, label: 'Brightness', kind: 'slider', text: Math.abs(this.ev) < 0.01 ? 'As it is' : `${this.ev > 0 ? '+' : '−'}${Math.abs(this.ev).toFixed(1)}`, value: this.ev, min: -L.evMax, max: L.evMax, step: 0.1 };
      case 'vignette':
        return { id, label: 'Dark corners', kind: 'slider', text: this.vignette ? pct(this.vignette) : 'None', value: this.vignette, min: 0, max: 1, step: 0.05, off: noPost };
      case 'hideBot':
        return { id, label: 'Bloombot', kind: 'toggle', text: this.hideBot ? 'Hidden' : 'In the picture', on: !this.hideBot, action: 'interact', off: bot ? undefined : 'Bloombot is not here' };
      case 'pose':
        return { id, label: 'Pose', kind: 'choice', text: PHOTO_POSES[this.pose], off: noBot ?? (bot?.seated ? 'Bloombot is sitting' : undefined) };
      case 'face':
        return { id, label: 'Face', kind: 'choice', text: PHOTO_FACES[this.face], off: noBot };
      case 'faceCamera':
        return { id, label: 'Looks at you', kind: 'toggle', text: this.faceCamera ? 'On' : 'Off', on: this.faceCamera, off: noBot ?? (bot?.seated ? 'Bloombot is sitting' : undefined) };
      case 'freeze':
        return { id, label: 'Garden', kind: 'toggle', text: this.freeze ? 'Frozen' : 'Moving', on: this.freeze, action: 'buildMenu' };
      case 'frame':
        return { id, label: 'Shape', kind: 'choice', text: PHOTO_FRAMES[this.frame].name };
      case 'grid':
        return { id, label: 'Guides', kind: 'choice', text: PHOTO_GRIDS[this.grid] };
      case 'size':
        return { id, label: 'Picture', kind: 'choice', text: PHOTO_SIZES[this.size].name };
      case 'clean':
        return { id, label: 'This panel', kind: 'button', text: 'Hide it', action: 'backpack' };
    }
  }

  setTab(tab: PhotoTab) {
    if (!this.active || this.tutorial) return;
    this.tab = tab;
    this.row = Math.min(this.row, TAB_ROWS[tab].length - 1);
    this.render();
  }

  /** The pad's bumpers: the tab to the left or right (round the ends), as in the backpack. False in Tide's lesson. */
  stepTab(dir: -1 | 1): boolean {
    if (!this.active || this.tutorial) return false;
    this.clean = false; // any press brings the panel back
    const i = PHOTO_TABS.findIndex((t) => t.id === this.tab);
    this.setTab(PHOTO_TABS[(i + dir + PHOTO_TABS.length) % PHOTO_TABS.length].id);
    return true;
  }

  /** The arrow keys or the d-pad: up and down choose a row (above the first: the tabs), left and right change it. */
  nav(dir: PhotoDir) {
    if (!this.active || this.tutorial) return;
    if (this.clean) {
      this.clean = false; // any press brings the panel back
      return this.render();
    }
    const ids = TAB_ROWS[this.tab];
    if (dir === 'up' || dir === 'down') {
      this.row = Math.min(ids.length - 1, Math.max(-1, this.row + (dir === 'down' ? 1 : -1)));
      return this.render();
    }
    const d = dir === 'right' ? 1 : -1;
    if (this.row < 0) {
      const i = PHOTO_TABS.findIndex((t) => t.id === this.tab);
      this.tab = PHOTO_TABS[(i + d + PHOTO_TABS.length) % PHOTO_TABS.length].id;
      return this.render();
    }
    this.adjust(ids[this.row], d);
  }

  /**
   * The pad's A (or Enter) on the row in hand: a toggle goes over, a button is pressed, a choice steps on. False
   * when no row is in hand (on the tabs, in Tide's lesson, the panel hidden) or it is a slider: the press keeps
   * its usual meaning then.
   */
  pressRow(): boolean {
    if (!this.active || this.tutorial || this.clean || this.row < 0) return false;
    const r = this.rows()[this.row];
    if (!r || r.kind === 'slider') return false;
    this.adjust(r.id, 1);
    return true;
  }

  /** One step of a row: a slider a notch along, a choice to the next (or the one before), a toggle over, a button pressed. */
  adjust(id: PhotoRowId, dir = 1) {
    if (!this.active) return;
    const r = this.rowOf(id);
    if (r.off) return;
    const cycle = <T>(order: readonly T[], now: T): T => order[(order.indexOf(now) + dir + order.length) % order.length];
    const notch: Partial<Record<PhotoRowId, number>> = { lens: 4, roll: 5, tilt: PHOTO.tiltStep, focus: 0.04, blur: 0.1, hour: 1, ev: 0.3, vignette: 0.1 };
    switch (id) {
      case 'hour': {
        // whole hours, round the clock
        const h = this.hour ?? this.host.clockHour?.() ?? 12;
        return this.setHour(dir > 0 ? Math.floor(h) + 1 : Math.ceil(h) - 1);
      }
      case 'weather':
        return this.setWeather(cycle(PHOTO_WEATHERS, this.weather));
      case 'filter':
        return this.setFilter(cycle(FILTER_ORDER, this.filter));
      case 'resetView':
        return this.resetView();
      case 'dof':
        this.action('eat');
        return;
      case 'hideBot':
        this.action('interact');
        return;
      case 'freeze':
        this.action('buildMenu');
        return;
      case 'clean':
        this.action('backpack');
        return;
      case 'pick':
        if (this.picking) this.picking = false;
        else if (this.focus !== undefined) this.focus = undefined;
        else this.picking = true;
        this.applyLook();
        break;
      case 'pose':
        this.pose = cycle(POSE_ORDER, this.pose);
        this.host.bot?.play?.(this.pose);
        if (this.face !== 'auto') this.host.bot?.setFace?.(this.face); // a clip brings its own face: the chosen one stays
        break;
      case 'face':
        this.face = cycle(FACE_ORDER, this.face);
        this.host.bot?.setFace?.(this.face);
        break;
      case 'faceCamera':
        this.faceCamera = !this.faceCamera;
        this.host.bot?.faceCamera?.(this.faceCamera);
        break;
      case 'frame':
        this.frame = cycle(FRAME_ORDER, this.frame);
        break;
      case 'grid':
        this.grid = cycle(GRID_ORDER, this.grid);
        break;
      case 'size':
        this.size = cycle(SIZE_ORDER, this.size);
        break;
      default:
        if (r.kind === 'slider') return this.setValue(id, (r.value ?? 0) + dir * (notch[id] ?? r.step ?? 1));
    }
    this.render();
  }

  /** A slider dragged to a value (in the row's own units, held within its range). */
  setValue(id: PhotoRowId, v: number) {
    if (!this.active || !Number.isFinite(v)) return;
    const r = this.rowOf(id);
    if (r.kind !== 'slider' || r.off) return;
    const x = Math.min(r.max!, Math.max(r.min!, v));
    const L = PHOTO_LENS;
    switch (id) {
      case 'lens':
        this.fov = L.fovMin + L.fovMax - x;
        this.applyLens();
        break;
      case 'roll':
        this.roll = Math.abs(x) < 0.5 ? 0 : x;
        this.applyLens();
        break;
      case 'tilt':
        this.host.camera.pitchOffset = x;
        break;
      case 'focus':
        this.focus = focusFromSlider(x);
        this.picking = false;
        this.applyLook();
        break;
      case 'blur':
        this.blur = x;
        this.applyLook();
        break;
      case 'hour':
        return this.setHour(x);
      case 'ev':
        this.ev = Math.abs(x) < 0.05 ? 0 : x;
        this.applyLook();
        break;
      case 'vignette':
        this.vignette = x;
        this.applyLook();
        break;
    }
    this.render();
  }

  /** The view as photo mode opened it: turned back, level, untilted, on its own lens. */
  resetView() {
    const c = this.host.camera;
    c.recentre();
    c.pitchOffset = 0;
    this.fov = undefined;
    this.roll = 0;
    this.applyLens();
    this.render();
  }

  /** "Pick a spot": the sharp plane goes to the world under the pointer. */
  private focusHere() {
    this.picking = false;
    const d = this.host.focusAt?.();
    if (d !== undefined && Number.isFinite(d)) this.focus = Math.min(PHOTO_LENS.focusMax, Math.max(PHOTO_LENS.focusMin, d));
    this.applyLook();
    this.render();
  }

  /** A zoom from the wheel or the right stick (photo mode's zoom is free, within its own limits). */
  zoom(factor: number) {
    if (!this.active) return;
    this.host.camera.zoomBy(factor);
    this.render(); // the lens row names the view's own lens, which follows the zoom
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
