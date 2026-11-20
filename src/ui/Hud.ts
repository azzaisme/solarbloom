import type { AreaMode } from '../core/types';
import type { BuildableType, MachineData } from '../core/types';
import { MACHINES } from '../data/machines';
import type { Sim } from '../gameplay/Sim';
import { ICONS, hasEmoji, iconize, installIconDefs, plain } from './Icons';
import { Prompt } from './Prompt';
import { plainWords } from './words';
import { ObjectiveCard } from './ObjectiveCard';
import { BuildBar, Hotbar } from './Hotbar';
import { Toasts } from './Toasts';
import { Panels } from './Panels';
import { Backpack } from './Backpack';
import { CraftTable } from './CraftTable';
import { ChargeMeter } from './ChargeMeter';
import { CratePanel } from './CratePanel';
import { LoadWheel } from './LoadWheel';
import { Dock, type DockAction } from './Dock';
import type { SetProp } from './HudPart';
import type { GlyphSetting, GlyphStyle } from './Glyphs';

/** E19.2: `decor:<id>` holds a decoration to place; `remove` aims at decorations to remove or pick up. */
export type DecorTool = `decor:${string}`;
export type Tool = 'inspect' | 'pulse' | BuildableType | DecorTool | 'remove' | 'pipe';
/** E19.2: the decoration a tool holds, if it holds one. */
export const decorType = (t: Tool) => (t.startsWith('decor:') ? t.slice(6) : undefined);
/** A machine build tool (a machine type), not pulse, inspect, a core, a decoration or remove. */
export const machineTool = (t: Tool): t is BuildableType => t in MACHINES;


export interface HudCallbacks {
  selectTool(t: Tool): void;
  /** E18: `hubId|role|slot` (slot 2 on a Fleet Hub), or `hubId|role|drone|index` for a Megahub drone. */
  chooseRole(key: string): void;
  /** E20.2 (#285): the key or pad button bound to an action, as the player last used them (for hint text). */
  keyFor(a: Action): string;
  /** E23.11: a shortcut dock button was clicked: open the backpack, the map or the pause menu (as its button does). */
  dock(a: DockAction): void;
  /** E23.11: a build dock or build menu button was clicked: the action its button stands for (a slot, a view, Remove,
   *  the build menu, Back). */
  buildAct(a: Action): void;
  /** E23.11 (#344): the build menu pinned something: what hotbar slots 1–9 hold now (saved with the settings). */
  setHotbar(slots: string[]): void;
  skipCinematic(): void;
  closeInspect(): void;
  /** Wake a city landmark (by machine id). */
  wake(machineId: string): void;
  /** Open an area's panel (from its label in the overview). */
  openArea(areaId: string): void;
  /** An area's automation switch (from the area panel). */
  setAreaMode(areaId: string, mode: AreaMode | undefined): void;
  /** Fly the camera to a ground tile and point at it (the objective's suggestion). */
  focusTile(x: number, z: number): void;
  /** E18.5: open a machine's panel (the advisor's role hint). */
  inspectAt(machineId: string): void;
}

export interface Settings {
  sound: boolean;
  music: boolean;
  reducedMotion: boolean;
  hints: boolean;
  debug: boolean;
  /** Fewer particles and softer sparkles (Lucky Cat, chains), independent of motion. */
  lowVfx: boolean;
  /** One fog layer instead of two (less overdraw on phones). */
  lowFog?: boolean;
  /** The camera glides along with big chains. */
  followChains?: boolean;
  /** Phase 4 E03.4 / E11.5: volumes 0..100 (sound and music still have their on/off switches). */
  sfxVolume?: number;
  musicVolume?: number;
  /** Phase 4 E11.5: stronger outlines and text contrast. */
  highContrast?: boolean;
  /** Look 1.11: graphics quality (Auto picks a tier from the device and steps down if frames stay slow). */
  gfx?: 'auto' | 'deck' | 'low' | 'medium' | 'high';
  /** Steam Deck (#243): HUD size in percent (100, 125 or 150). */
  uiScale?: number;
  /** Phase 5 E16: fireflies over lush tiles (ambience only). */
  fireflies?: boolean;
  /**
   * E19.4.2 / E20.7 (#261, #290): "Show numbers": rates, net income, time-to-afford and other secondary numbers.
   * Off (or never chosen) is the calm HUD, the default.
   */
  showNumbers?: boolean;
  /** E19.4.3 (#262): the potter-about pace: no objective nudges or advisor tips, softer chains. Presentation only. */
  potter?: boolean;
  /** E23.7.1.2: "follow my clock" for the game in play (kept in its save; the menu shows it here) */
  realClock?: boolean;
  /** E21.22: the camera: how fast it turns (percent), inverted axes, no drift back behind bloombot, no vistas */
  camSensitivity?: number;
  invertX?: boolean;
  invertY?: boolean;
  noRecentre?: boolean;
  noVistas?: boolean;
  /** Third person: a click on the world captures the mouse to look around (on unless switched off) */
  mouseLook?: boolean;
  /** Bloombot (G.16): rebound keys and gamepad buttons (only what differs from the default map). */
  keys?: SavedBindings['keys'];
  pad?: SavedBindings['pad'];
  /** E22.1: the bindings' version (older saved bindings are reset once) */
  bindingsV?: number;
  /** E22.1: what hotbar slots 1–9 hold (tool ids; '' is empty) */
  hotbar?: string[];
  /** E22.2: holds (salvage, pry) need Interact held; false turns them into a single press. Default on. */
  holdToAct?: boolean;
  /** E22.11: pause when the window loses focus or the page is hidden. Default on. */
  pauseOnBlur?: boolean;
  /** E22.3: which button pictures to show (auto follows the device in use) */
  glyphs?: GlyphSetting;
  /** E22.11: the developer's game speed (shown with the debug overlay; never saved) */
  speed?: number;
}

import { toHud, ui } from './UiScale';
import type { Action, Bindings, SavedBindings } from '../app/Bindings';

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

/** E19.1.2: what the plot picker shows. */
export interface PlotPickerModel {
  title: string;
  sub: string;
  current?: string;
  choices: { id: string; name: string; icon: string; blurb: string; solid: boolean; unlocked: boolean; fresh: boolean; hint?: string }[];
}
export interface PlotPickerHandlers {
  onPreview(id: string | undefined): void;
  onChoose(id: string | undefined): void;
  onClose(): void;
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/**
 * DOM HUD. Reads sim state each frame (cheaply, with change detection); never mutates the sim directly.
 *
 * E22.5 (#342) / E23.11: the shell over the HUD's parts, laid out as the Sunlit Glass walking board
 * (docs/art/ui-sunlit-glass/Walk.dc.html, styled by hud.css): the objective card top left (ObjectiveCard), bloombot's
 * charge top right (ChargeMeter: the only meter, E23.1.4), the painted minimap bottom left, the prompt at the bottom
 * centre with the build hotbar above it while build mode is open (Prompt, Hotbar), toasts bottom right (Toasts) over
 * the shortcut dock (Dock), and the panels it opens (Panels). Its public methods are the game's single way in, and pass on to the parts.
 */
export class Hud {
  /** Look 1.11: the graphics tier in effect (shown next to Auto in Settings). */
  gfxTier?: 'low' | 'medium' | 'high';
  /** the Steam Deck preset is in effect (it sits on the Medium tier) */
  gfxDeck?: boolean;
  readonly root: HTMLElement;
  /** the last value written per key (`set` skips unchanged writes) */
  readonly last = new Map<string, string>();
  settings: Settings;
  /** E22.2: the one prompt at the bottom centre */
  readonly prompt: Prompt;
  readonly objective: ObjectiveCard;
  readonly hotbar: Hotbar;
  /** E22.5: the build hotbar (slots 1–9), above the prompt while build mode is open */
  readonly buildBar: BuildBar;
  readonly toasts: Toasts;
  readonly panels: Panels;
  /** E22.6: the backpack screen (and the storage panel) */
  readonly backpack: Backpack;
  /** E23.6.1: the crafting table */
  readonly craft: CraftTable;
  /** E23.2.1: bloombot's charge, the only meter */
  readonly charge: ChargeMeter;
  /** E23.6.4: a supply crate's panel */
  readonly crate: CratePanel;
  /** E23.2.2: the pulse load wheel */
  readonly loadWheel: LoadWheel;
  /** E23.11: the shortcut dock (Backpack, Map, Menu), bottom right */
  readonly dock: Dock;
  /** E23.11: the button pictures in use and the bindings they name (set by setKeyMap; the charge's Eat hint and the dock read them) */
  glyphStyle: GlyphStyle = 'keys';
  bindings?: Bindings;

  constructor(
    readonly sim: Sim,
    readonly cb: HudCallbacks,
    settings: Settings,
  ) {
    this.settings = settings;
    this.root = document.getElementById('hud')!;
    installIconDefs();
    this.objective = new ObjectiveCard(this);
    this.hotbar = new Hotbar(this);
    this.buildBar = new BuildBar(this);
    this.toasts = new Toasts(this);
    this.panels = new Panels(this);
    this.charge = new ChargeMeter(this);
    this.loadWheel = new LoadWheel(this);
    this.dock = new Dock(this);
    this.root.innerHTML = iconize(this.template());
    // Third person: the build crosshair in the middle of the screen (shown while aiming a build: `.aiming`)
    const xh = document.createElement('div');
    xh.className = 'crosshair';
    xh.setAttribute('aria-hidden', 'true');
    this.root.appendChild(xh);
    this.hotbar.wire();
    this.panels.wire();
    this.charge.wire();
    this.loadWheel.wire();
    this.dock.wire();
    this.wire();
    this.prompt = new Prompt(this.root);
    this.backpack = new Backpack(this.root, { sim: this.sim });
    this.craft = new CraftTable(this.root, { sim: this.sim });
    this.crate = new CratePanel(this.root, { sim: this.sim });
  }

  private template() {
    return `
      <div id="res" role="group" aria-label="Charge"></div>
      ${ObjectiveCard.template()}
      ${BuildBar.template()}
      <div id="toasts" role="status" aria-live="polite"></div>
      <div id="saveLeaf" role="img" aria-label="Saved">${ICONS.biomass}</div>
      <div id="catPanel" class="panel" hidden><button aria-label="Dismiss">×</button><div id="catPanelBody"></div></div>
      <div id="tip" class="panel"></div>
      <div id="fail"></div>
      <div id="plotPicker" class="drawer panel" aria-label="Plot picker"><h2><span id="ppTitle">Plot</span> <button aria-label="Close plot picker">×</button></h2><p id="ppSub" class="pp-sub"></p><div id="ppList"></div></div>
      <div id="inspect" class="panel"></div>
      <div id="cine"><div class="bar t"></div><div class="bar b"></div><div class="title" id="cineTitle"></div><button id="skipBtn">Skip ⏭</button></div>
      <div id="wlabels"></div>
      <div id="fps"></div>
    `;
  }

  private wire() {
    const r = this.root;
    $(r, '#skipBtn').addEventListener('click', () => this.cb.skipCinematic());
    // World labels can carry actions (wake a landmark, open an area).
    $(r, '#wlabels').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const wake = t.closest<HTMLButtonElement>('[data-wake]');
      if (wake && !wake.disabled) this.cb.wake(wake.dataset.wake!);
      const area = t.closest<HTMLElement>('[data-area]') ?? t.closest<HTMLElement>('.wlabel')?.querySelector<HTMLElement>('[data-area]');
      if (area && !wake) this.cb.openArea(area.dataset.area!);
    });
  }

  // ───────── the parts' doors (the game calls these) ─────────
  showTip(x: number, y: number, html: string) {
    this.panels.showTip(x, y, html);
  }
  hideTip() {
    this.panels.hideTip();
  }
  showFail(msg: string, x?: number, y?: number) {
    this.panels.showFail(msg, x, y);
  }
  toast(html: string, kind: '' | 'gold' | 'cat' = '', secs = 3.2) {
    this.toasts.toast(html, kind, secs);
  }
  /** E22.5: a material picked up ("+3 Copper"; repeats merge). */
  pickup(name: string, n: number) {
    this.toasts.pickup(name, n);
  }
  catReward(title: string, detail: string) {
    this.panels.catReward(title, detail);
  }
  nudge(sel: string, secs = 4) {
    this.objective.nudge(sel, secs);
  }
  setTool(t: Tool) {
    this.hotbar.setTool(t);
  }
  get currentTool(): Tool {
    return this.hotbar.currentTool;
  }
  toggleTray(open?: boolean) {
    this.hotbar.toggleTray(open);
  }
  get trayOpen() {
    return this.hotbar.trayOpen;
  }
  /** E23.11 (#344): the build menu sheet (its tabs, Pin to a slot, Back). */
  get buildMenu() {
    return this.hotbar.menu;
  }
  setKeyMap(style: GlyphStyle | undefined, b?: Bindings) {
    this.hotbar.setKeyMap(style, b);
    this.buildBar.setKeys(style, b);
    // E23.11: the charge's Eat hint and the dock draw their pictures from these (they redraw when either changes)
    this.glyphStyle = style ?? 'keys';
    if (b) this.bindings = b;
    this.keyMapVersion++;
  }
  /** bumped by every setKeyMap (a rebind keeps the same Bindings object, so parts compare this) */
  keyMapVersion = 0;
  /** E22.6: the backpack screen (Tab / I, d-pad up). */
  toggleBackpack(open = !this.backpack.isOpen) {
    if (open) this.backpack.open();
    else this.backpack.close();
  }
  get backpackOpen() {
    return this.backpack.isOpen;
  }
  openPlotPicker(m: PlotPickerModel, h: PlotPickerHandlers) {
    this.panels.openPlotPicker(m, h);
  }
  closePlotPicker() {
    this.panels.closePlotPicker();
  }
  get plotPickerOpen() {
    return this.panels.plotPickerOpen;
  }
  statsHtml(): string {
    return this.panels.statsHtml();
  }
  renderInspect(html: string | null) {
    this.panels.renderInspect(html);
  }
  machineHtml(m: MachineData, extra: string): string {
    return this.panels.machineHtml(m, extra);
  }

  update(dt: number) {
    this.charge.update(dt);
    this.loadWheel.update(dt);
    this.hotbar.update();
    this.panels.update(dt);
    this.objective.update();
    this.dock.update(dt);
  }

  /** Writes a value to the DOM only when it changed since the last write under that key. */
  set(key: string, el: HTMLElement, prop: SetProp, value: string, cls?: string) {
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    // Look 5.2: emoji in game strings are drawn as icons; titles (tooltips) keep plain text.
    if (prop === 'text') {
      if (hasEmoji(value)) el.innerHTML = iconize(esc(value));
      else el.textContent = value;
    } else if (prop === 'title') el.title = plain(value);
    else if (prop === 'html') el.innerHTML = iconize(value);
    else if (prop === 'width') el.style.width = value;
    else if (prop === 'cls' && cls) el.classList.toggle(cls, value === '1');
    else if (prop === 'style' && cls) el.style.setProperty(cls, value);
  }

  /** Steam Deck (#243): HUD size, 100 / 125 / 150%. Zooms the whole HUD; see UiScale. */
  setUiScale(percent: number) {
    const pct = percent === 125 || percent === 150 ? percent : 100;
    ui.scale = pct / 100;
    this.root.style.zoom = pct === 100 ? '' : String(ui.scale);
    // viewport units inside a zoomed HUD are zoomed too: panels divide by this to stay on screen
    this.root.style.setProperty('--ui-zoom', String(ui.scale));
    this.buildBar?.place(); // #565: at once, not on its next check (up to 0.4 s with the dock off screen)
  }

  /** E22.11: the menu or Settings is open (the game sets how it knows). */
  modalCheck: () => boolean = () => false;
  get modalOpen() {
    return this.modalCheck();
  }

  /** E22.10: game text in plain words, no rates. */
  words(text: string): string {
    return plainWords(text);
  }

  cinematic(on: boolean, title = '') {
    const c = $(this.root, '#cine');
    if (on) {
      $(this.root, '#cineTitle').textContent = title;
      c.classList.add('on');
      requestAnimationFrame(() => c.classList.add('in'));
      setTimeout(() => c.classList.add('title-on'), 1800);
    } else {
      c.classList.remove('in', 'title-on');
      setTimeout(() => c.classList.remove('on'), 600);
    }
  }

  /** A label pinned to a world point. Created on demand; `action` labels take clicks. */
  worldLabel(id: string, html: string | null, x = 0, y = 0, action = false, scale = 1) {
    let el = this.root.querySelector<HTMLElement>(`#${id}`);
    if (!el) {
      if (!html) return;
      el = document.createElement('div');
      el.id = id;
      el.className = 'wlabel panel';
      $(this.root, '#wlabels').appendChild(el);
    }
    el.classList.toggle('act', action);
    if (!html) {
      el.style.display = 'none';
      return;
    }
    this.set(`wl-${id}`, el, 'html', html);
    el.style.display = 'block';
    el.style.left = `${toHud(x)}px`;
    el.style.top = `${toHud(y)}px`;
    // Look 4.6: nearer labels a little larger, far ones smaller (the CSS scale property composes with its transform).
    el.style.scale = scale === 1 ? '' : scale.toFixed(2);
    el.style.transformOrigin = '50% 100%';
  }

  /** Rectangles the Lucky Cat must never hide under. */
  blockedRects(): DOMRect[] {
    return ['#res', '#obj', '#buildbar:not([hidden])', '#prompt', '#dock', '#minimap:not([hidden])']
      .map((s) => this.root.querySelector<HTMLElement>(s))
      .filter((e): e is HTMLElement => !!e)
      .map((e) => e.getBoundingClientRect());
  }

  setDebug(text: string | null) {
    const el = $(this.root, '#fps');
    el.classList.toggle('on', text !== null);
    if (text !== null) el.textContent = text;
  }

}

/** "12 s", "3 min", "2 h": time-to-afford at the current net income (Phase 5 E12). */
export function etaText(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  if (sec < 60) return `${Math.max(1, Math.ceil(sec))} s`;
  if (sec < 3600) return `${Math.ceil(sec / 60)} min`;
  return `${Math.round(sec / 360) / 10} h`;
}

