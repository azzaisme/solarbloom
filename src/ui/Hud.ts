import type { AreaMode } from '../core/types';
import { big, fmt } from '../core/Big';
import type { BuildableType, MachineData, ResourceKind } from '../core/types';
import { MACHINES } from '../data/machines';
import type { Sim } from '../gameplay/Sim';
import { ICONS, LOGO_MARK, hasEmoji, iconize, installIconDefs, plain } from './Icons';
import { Prompt } from './Prompt';
import { plainWords } from './words';
import { ObjectiveCard } from './ObjectiveCard';
import { Bars } from './Bars';
import { BuildBar, Hotbar } from './Hotbar';
import { Toasts } from './Toasts';
import { Panels } from './Panels';
import { Backpack } from './Backpack';
import { CraftTable } from './CraftTable';
import { ChargeMeter } from './ChargeMeter';
import { LoadWheel } from './LoadWheel';
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
  harvest(): void;
  /** E18: `hubId|role|slot` (slot 2 on a Fleet Hub), or `hubId|role|drone|index` for a Megahub drone. */
  chooseRole(key: string): void;
  activateCore(): void;
  /** Phase 5 E15: the 🐾 chip: show where a hinted cat hides. */
  findCat(): void;
  /** E20.2 (#285): the key or pad button bound to an action, as the player last used them (for hint text). */
  keyFor(a: Action): string;
  /** Look 5.9: the house button: the park, or (when something is ready) the next area that needs attention. */
  goHome(attention: boolean): void;
  skipCinematic(): void;
  closeInspect(): void;
  /** City 10.7: set off (or replay) a district bloom. */
  districtBloom(id: string, replay: boolean): void;
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
 * E22.5 (#342): the shell over the HUD's parts, laid out as the epic's table: the objective card top left
 * (ObjectiveCard), energy and water top right (Bars), the minimap bottom left, the prompt at the bottom centre
 * with the build hotbar above it while build mode is open (Prompt, Hotbar), toasts bottom right (Toasts), and
 * the panels it opens (Panels). Its public methods are the game's single way in, and pass on to the parts.
 */
export class Hud {
  /** Look 1.11: the graphics tier in effect (shown next to Auto in Settings). */
  gfxTier?: 'low' | 'medium' | 'high';
  /** the Steam Deck preset is in effect (it sits on the Medium tier) */
  gfxDeck?: boolean;
  readonly root: HTMLElement;
  /** the last value written per key (`set` skips unchanged writes) */
  readonly last = new Map<string, string>();
  private comboTimer = 0;
  settings: Settings;
  /** E22.2: the one prompt at the bottom centre */
  readonly prompt: Prompt;
  /** E22.10: old-city rules: plain words, two gauges, one objective sentence (Game sets it from the rules) */
  oldCity = false;
  readonly bars: Bars;
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
  /** E23.2.2: the pulse load wheel */
  readonly loadWheel: LoadWheel;

  constructor(
    readonly sim: Sim,
    readonly cb: HudCallbacks,
    settings: Settings,
  ) {
    this.settings = settings;
    this.root = document.getElementById('hud')!;
    installIconDefs();
    this.bars = new Bars(this);
    this.objective = new ObjectiveCard(this);
    this.hotbar = new Hotbar(this);
    this.buildBar = new BuildBar(this);
    this.toasts = new Toasts(this);
    this.panels = new Panels(this);
    this.charge = new ChargeMeter(this);
    this.loadWheel = new LoadWheel(this);
    this.root.innerHTML = iconize(this.template());
    // Third person: the build crosshair in the middle of the screen (shown while aiming a build: `.aiming`)
    const xh = document.createElement('div');
    xh.className = 'crosshair';
    xh.setAttribute('aria-hidden', 'true');
    this.root.appendChild(xh);
    this.bars.wire();
    this.objective.wire();
    this.hotbar.wire();
    this.panels.wire();
    this.charge.wire();
    this.loadWheel.wire();
    this.wire();
    this.prompt = new Prompt(this.root);
    this.backpack = new Backpack(this.root, { sim: this.sim });
    this.craft = new CraftTable(this.root, { sim: this.sim });
  }

  private template() {
    return `
      <div id="logo" role="img" aria-label="Solarbloom">${LOGO_MARK}<span class="wm">Solarbloom</span></div>
      <div id="res" role="group" aria-label="Resources">${Bars.template()}</div>
      <div id="resInfo" class="panel" role="status" hidden></div>
      <div id="obj" class="panel" role="region" aria-label="Objective">
        <div class="ohead">
          <span class="oic" aria-hidden="true">${ICONS.biomass}</span>
          <div class="otx"><span class="olab">Objective</span><h3 id="objTitle">Wake the fountain</h3></div>
          <span class="ock" id="objCheck" role="img" aria-label="Not done yet"></span>
          <button class="otog" id="objToggle" aria-expanded="false" aria-controls="objMore" aria-label="Show objective details" title="Details"><i></i></button>
        </div>
        <div class="next" id="objNext"></div>
        <div id="objMore">
          <div class="pct" id="objPct">0% restored</div>
          <div class="pbar"><i id="objBar" style="width:0%"></i></div>
          <ul id="objList"></ul>
        </div>
        <div id="objAct"></div>
        <button id="coreBtn">✨ Awaken the Core</button>
      </div>
      <div id="quick" role="toolbar" aria-label="Quick actions">
        <button class="rbtn qbtn" id="homeBtn" aria-label="Home: fly to the park (Home)" title="Home (Home key)">${ICONS.home}<span class="qbadge" aria-hidden="true"></span></button>
        <button class="rbtn qbtn" id="catBtn" aria-label="Lucky Cat garden" title="Lucky Cat garden" hidden>${ICONS.garden}<span class="qn" id="catCount">0</span></button>
        <button class="rbtn qbtn" id="pawBtn" aria-label="Paw prints: which way a hiding cat went" title="Paw prints: a Lucky Cat is hiding. Which way do they lead?" hidden>${ICONS.paw}<span class="qn" id="pawCount">0</span></button>
      </div>
      <div id="combo"><div id="comboFx" aria-hidden="true"></div><div class="big" id="comboBig" role="status" aria-label="Bloom chain combo"><span class="cic">${ICONS.biomass}</span><span class="cl">Combo</span> <span class="cx">×0</span></div><div class="cbody panel"><ul id="comboParts"></ul><div class="total" id="comboTotal"></div><div id="chainAreas"></div></div><div id="feed"></div></div>
      <div id="hotbar" class="panel">${Hotbar.template(this.sim.oldCity)}</div>
      ${BuildBar.template()}
      <div id="hint" class="panel hide"><span id="hintText"></span><button aria-label="Dismiss hint">×</button></div>
      <div id="toasts" role="status" aria-live="polite"></div>
      <div id="saveLeaf" role="img" aria-label="Saved">${ICONS.biomass}</div>
      <div id="catPanel" class="panel" hidden><button aria-label="Dismiss">×</button><div id="catPanelBody"></div></div>
      <div id="intro" hidden><div class="panel card-intro">
        <h2>${LOGO_MARK}<span>Welcome to Solarbloom</span></h2>
        <p data-rules="classic">This old park is dead and grey, and the city around it is lost in a gloomy fog. Bring it back to life.</p>
        <p data-rules="oldcity">The fog came and the island city emptied. A small boat has brought you, bloombot, from the mainland to bring it back to life.</p>
        <ol data-rules="oldcity">
          <li><b>Salvage what lies around</b>: Scrap, Seeds and more, by hand. Tidied ground can be restored.</li>
          <li><b>Pulse dead ground back to life</b>, and bring the fountain what it asks for. Each delivery gives you a new way to move.</li>
          <li><b>Clear the way</b> into the city's regions and wake the robot who sleeps in each.</li>
        </ol>
        <ol data-rules="classic">
          <li><b>Walk up to a grey tile and pulse it</b> to restore it. Each pulse uses a little ⚡ energy and 💧 water, which refill on their own.</li>
          <li><b>Green tiles grow 🌿 biomass.</b> Spend it on machines. Pulse a green tile again to grow flowers.</li>
          <li><b>Goal:</b> wake the dry fountain. Then the fog starts to lift. The objective is in the top-left corner.</li>
        </ol>
        <button id="introGo">Start restoring ✨</button>
      </div></div>
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
  feed(text: string) {
    this.toasts.feed(text);
  }
  catReward(title: string, detail: string) {
    this.panels.catReward(title, detail);
  }
  showIntro() {
    this.panels.showIntro();
  }
  get introOpen() {
    return this.panels.introOpen;
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
  setKeyMap(style: GlyphStyle | undefined, b?: Bindings) {
    this.hotbar.setKeyMap(style, b);
    this.buildBar.setKeys(style, b);
  }
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
  resourceRect(kind: ResourceKind): DOMRect {
    return this.bars.resourceRect(kind);
  }
  flashResource(kind: ResourceKind, cls: 'flash' | 'short' | 'bump') {
    this.bars.flashResource(kind, cls);
  }

  update(dt: number) {
    this.bars.update();
    this.charge.update(dt);
    this.loadWheel.update(dt);
    this.hotbar.update();
    this.updateCatChip();
    this.panels.update(dt);
    this.objective.update();
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        $(this.root, '#comboBig').classList.remove('on');
        $(this.root, '#combo').classList.remove('on');
        this.comboTier = 0;
        this.set('comboParts', $(this.root, '#comboParts'), 'html', '');
        $(this.root, '#comboTotal').classList.remove('on');
      }
    }
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
  }

  /** E22.11: the menu or Settings is open (the game sets how it knows). */
  modalCheck: () => boolean = () => false;
  get modalOpen() {
    return this.modalCheck();
  }

  /** E22.10: game text in the words of the rules in play (old-city rules: plain words, no rates). */
  words(text: string): string {
    return this.oldCity ? plainWords(text) : text;
  }

  private comboTier = 0;
  combo(n: number, total?: string) {
    const el = $(this.root, '#comboBig');
    $(el, '.cx').textContent = `×${n}`;
    el.classList.add('on');
    $(this.root, '#combo').classList.add('on');
    // E19.4.3: the potter-about pace keeps chains gentle: one quiet tier, no sparkle burst or pop.
    const tier = this.settings.potter ? 1 : n >= 10 ? 3 : n >= 5 ? 2 : 1;
    el.classList.toggle('tier2', tier === 2);
    el.classList.toggle('tier3', tier === 3);
    // Look 5.5: sparkles burst around the panel when the chain reaches a new tier.
    if (tier > this.comboTier && tier > 1) this.sparkle(tier);
    this.comboTier = tier;
    el.classList.remove('pop');
    void el.offsetWidth;
    if (!this.settings.potter) el.classList.add('pop');
    const tot = $(this.root, '#comboTotal');
    tot.innerHTML = iconize(esc(total ?? ''));
    tot.classList.toggle('on', !!total);
    this.comboTimer = total ? 3.2 : 2.2;
  }

  /** Look 5.5: the combo panel's contribution lines, from the running chain (ChainSummary.breakdown). */
  chainBreakdown(b?: { restored: number; adjacent: number; synergy: number; relay: number }) {
    if (!b) return;
    const lines: [string, number][] = [
      ['Restored Tiles', b.restored],
      ['Adjacent Blooms', b.adjacent],
      ['Utility Synergy', b.synergy],
      ['Relay Links', b.relay],
    ];
    this.set('comboParts', $(this.root, '#comboParts'), 'html', lines.filter(([, v]) => v > 0).map(([k, v]) => `<li><span>+ ${k}</span><b>+${fmt(big(v))}</b></li>`).join(''));
  }

  private sparkle(tier: number) {
    if (document.body.classList.contains('reduced') || this.settings.lowVfx) return;
    const box = $(this.root, '#comboFx');
    const n = tier === 3 ? 12 : 7;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const d = 40 + Math.random() * 50;
      s.style.setProperty('--dx', `${Math.round(Math.cos(a) * d)}px`);
      s.style.setProperty('--dy', `${Math.round(Math.sin(a) * d * 0.6)}px`);
      s.style.animationDelay = `${Math.round(Math.random() * 120)}ms`;
      s.className = tier === 3 ? 'pink' : '';
      box.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  /** City 10.6: the running chain's per-area summary under the combo (empty hides it). */
  chainAreas(lines: string[]) {
    this.set('chainAreas', $(this.root, '#chainAreas'), 'html', lines.map((l) => `<div>${esc(l)}</div>`).join(''));
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
    const extra = [...this.root.querySelectorAll<HTMLElement>('#minimap:not([hidden])')].map((e) => e.getBoundingClientRect());
    return ['#logo', '#res', '#obj', '#hotbar', '#hint', '#combo', '#quick', '#prompt'].map((s) => $(this.root, s).getBoundingClientRect()).concat(extra);
  }

  setDebug(text: string | null) {
    const el = $(this.root, '#fps');
    el.classList.toggle('on', text !== null);
    if (text !== null) el.textContent = text;
  }

  /** Phase 5 E15: the paw chip once a cat has been hiding a while. */
  private updateCatChip() {
    const s = this.sim;
    const hinted = s.cat.spots().filter((c) => s.cat.hinted(c)).length;
    const paw = $(this.root, '#pawBtn');
    if (paw.hidden !== !hinted) paw.hidden = !hinted;
    this.set('pawN', $(this.root, '#pawCount'), 'text', String(hinted));
  }

}

/** "12 s", "3 min", "2 h": time-to-afford at the current net income (Phase 5 E12). */
export function etaText(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  if (sec < 60) return `${Math.max(1, Math.ceil(sec))} s`;
  if (sec < 3600) return `${Math.ceil(sec / 60)} min`;
  return `${Math.round(sec / 360) / 10} h`;
}

