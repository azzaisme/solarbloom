import type { AreaMode } from '../core/types';
import { HOME } from '../gameplay/ProgressionSystem';
import { PLOT_OPTION, PLOT_OPTIONS } from '../data/cozy';
import { Economy, formatCost, formatPriceHtml, KINDS } from '../core/Economy';
import { big, fmt, toNum, type Big } from '../core/Big';
import type { Cost } from '../core/types';
import type { BuildableType, MachineData, ResourceKind } from '../core/types';
import { BUILDABLE, MACHINES, TIER2, TIER3 } from '../data/machines';
import { AREA_TYPES } from '../data/city';
import { TUNING } from '../data/tuning';
import type { Sim } from '../gameplay/Sim';
import { SEED_CORE_MACHINES } from '../gameplay/ProgressionSystem';
import { ICONS, GROUP_ICONS, LOGO_MARK, MACHINE_ICONS, hasEmoji, iconize, installIconDefs, plain } from './Icons';
import { WORLD_EVENT_INFO } from '../gameplay/WorldEventSystem';
import { advisorStep, calmToast } from './Pace';

/** Phase 5 E14: `super:<type>` places a Superstructure Core of that family. */
export type SuperTool = `super:${'solar' | 'condenser' | 'pollinator' | 'droneHub'}`;
export type Tool = 'inspect' | 'pulse' | BuildableType | SuperTool;
export const SUPER_TOOLS: SuperTool[] = ['super:solar', 'super:condenser', 'super:pollinator', 'super:droneHub'];
export const superType = (t: Tool) => (t.startsWith('super:') ? (t.slice(6) as 'solar' | 'condenser' | 'pollinator' | 'droneHub') : undefined);

const RES_META: Record<ResourceKind, { icon: string; name: string; color: string }> = {
  energy: { icon: ICONS.energy, name: 'Energy', color: 'var(--energy-bar)' },
  water: { icon: ICONS.water, name: 'Water', color: 'var(--water-bar)' },
  biomass: { icon: ICONS.biomass, name: 'Biomass', color: 'var(--biomass-bar)' },
};
/** Resource emoji inside game strings (drawn as icons by `iconize`). */
const RES_EMOJI: Record<ResourceKind, string> = { energy: '⚡', water: '💧', biomass: '🌿' };

export interface HudCallbacks {
  selectTool(t: Tool): void;
  harvest(): void;
  buyUpgrade(id: string): void;
  /** E18: `hubId|role|slot` (slot 2 on a Fleet Hub), or `hubId|role|drone|index` for a Megahub drone. */
  chooseRole(key: string): void;
  activateCore(): void;
  /** Phase 4 E06: fire Bloom Frenzy. */
  activateFrenzy(): void;
  /** Phase 5 E15: the 🐾 chip: show where a hinted cat hides. */
  findCat(): void;
  /** E20.2 (#285): the key or pad button bound to an action, as the player last used them (for hint text). */
  keyFor(a: Action): string;
  /** Look 5.9: the house button: the park, or (when something is ready) the next area that needs attention. */
  goHome(attention: boolean): void;
  newGame(): void;
  /** E19.4.1 (#260): open photo mode (from Settings). */
  photoMode(): void;
  setSetting(key: keyof Settings, v: boolean | number): void;
  setVolume(key: 'sfxVolume' | 'musicVolume', v: number): void;
  /** Look 1.11: the Graphics setting. */
  setGraphics(v: 'auto' | 'deck' | 'low' | 'medium' | 'high'): void;
  skipCinematic(): void;
  closeInspect(): void;
  togglePause(): void;
  cycleSpeed(): number;
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
  /** Phase 5 E13: the inspect panel's merge buttons. */
  merge(action: 'start' | 'confirm' | 'cancel'): void;
  /** Phase 5 E13: the advisor's merge button (select the machine and open its merge preview). */
  mergeAt(machineId: string): void;
  /** E18.5: open a machine's panel (the advisor's role hint). */
  inspectAt(machineId: string): void;
  /** Phase 5 E14: superstructure panel buttons: pay the next stage, fire the ability, toggle automatic firing. */
  superAction(action: 'stage' | 'activate' | 'auto', machineId: string): void;
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
  /** Bloombot (G.16): rebound keys and gamepad buttons (only what differs from the default map). */
  keys?: SavedBindings['keys'];
  pad?: SavedBindings['pad'];
}

import { hudHeight, hudWidth, toHud, ui } from './UiScale';
import { ACTIONS, type Action, type Bindings, keyLabel, padLabel, type SavedBindings } from '../app/Bindings';

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

/** DOM HUD. Reads sim state each frame (cheaply, with change detection); never mutates the sim directly. */
export class Hud {
  /** Look 1.11: the graphics tier in effect (shown next to Auto in Settings). */
  gfxTier?: 'low' | 'medium' | 'high';
  /** the Steam Deck preset is in effect (it sits on the Medium tier) */
  gfxDeck?: boolean;
  readonly root: HTMLElement;
  private last = new Map<string, string>();
  private tool: Tool = 'pulse';
  private hintDismissedStep = -1;
  private comboTimer = 0;
  private upgradesOpen = false;
  settings: Settings;

  constructor(
    private sim: Sim,
    private cb: HudCallbacks,
    settings: Settings,
  ) {
    this.settings = settings;
    this.root = document.getElementById('hud')!;
    installIconDefs();
    this.root.innerHTML = iconize(this.template());
    this.wire();
    $(this.root, '#backpack h2 button').addEventListener('click', () => this.toggleBackpack(false));
    $(this.root, '#plotPicker h2 button').addEventListener('click', () => this.closePlotPicker());
  }

  private template() {
    const rows = KINDS.map(
      (k) => `<div class="res-row panel" data-res="${k}" title="${RES_META[k].name}">
        <span class="ic" aria-hidden="true">${ICONS[k]}</span>
        <span class="nm">${RES_META[k].name}</span>
        <span class="val"><span class="n">0</span> <small class="capw">/ <span class="c">0</span></small></span>
        <span class="rate">+0/s</span>
        <span class="bar"><i style="background:${RES_META[k].color}"></i></span>
      </div>`,
    ).join('');
    const slots = [
      `<button class="slot" data-tool="inspect" aria-label="Inspect tool (1)"><span class="key">1</span><span class="si">${ICONS.inspect}</span><span class="sl">Inspect</span><span class="sc">&nbsp;</span></button>`,
      `<button class="slot" data-tool="pulse" aria-label="Restoration Pulse (2)"><span class="key">2</span><span class="si">${ICONS.pulse}</span><span class="sl"><span class="long">Restoration </span>Pulse</span><span class="sc"></span></button>`,
      `<span class="sep"></span>`,
      `<button class="slot" id="buildToggle" aria-label="Build menu (B)" aria-expanded="false"><span class="key">B</span><span class="si">${ICONS.build}</span><span class="sl">Build</span><span class="sc"></span></button>`,
      `<div id="buildTray">`,
      ...BUILDABLE.map(
        (t) =>
          `<button class="slot" data-tool="${t}" aria-label="Build ${MACHINES[t].name} (${MACHINES[t].hotkey})"><span class="key">${MACHINES[t].hotkey}</span><span class="si">${ICONS[MACHINE_ICONS[t]]}</span><span class="sl">${MACHINES[t].name.replace('Water ', '').replace('Pollinator ', '')}</span><span class="sc"></span></button>`,
      ),
      ...SUPER_TOOLS.map((t) => {
        const d = TIER3[superType(t)!]!;
        return `<button class="slot super" data-tool="${t}" hidden aria-label="Place ${d.name} core"><span class="si">${d.icon}</span><span class="sl">${d.name.split(' ').pop()}</span><span class="sc"></span></button>`;
      }),
      `</div>`,
      `<span class="sep"></span>`,
      `<button class="slot" id="harvestBtn" aria-label="Harvest sunlight (H)"><span class="key">H</span><span class="si">${ICONS.harvest}</span><span class="sl">Harvest</span><span class="sc">+${TUNING.harvest.energy}⚡</span><span class="cd"></span></button>`,
      `<button class="slot" id="upgBtn" aria-label="Upgrades (U)"><span class="key">U</span><span class="si">${ICONS.upgrades}</span><span class="sl">Upgrades</span><span class="sc">&nbsp;</span><span class="badge" aria-label="Something useful to buy"></span></button>`,
    ].join('');
    return `
      <div id="logo" role="img" aria-label="Solarbloom">${LOGO_MARK}<span class="wm">Solarbloom</span></div>
      <div id="res" role="group" aria-label="Resources">${rows}</div>
      <div id="resInfo" class="panel" role="status" hidden></div>
      <div id="chips" role="toolbar" aria-label="Game controls">
        <button class="rbtn" id="pauseBtn" aria-label="Pause" title="Pause (P)">${ICONS.pause}</button>
        <button class="rbtn" id="speedBtn" aria-label="Game speed: 1×" title="Game speed: 1×">${ICONS.fastForward}<span class="mult">1×</span></button>
        <button class="rbtn" id="setBtn" aria-label="Settings" title="Settings">${ICONS.settings}</button>
      </div>
      <div id="obj" class="panel">
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
      <div id="eventBanner" role="status" aria-live="polite" hidden><span class="ei"></span><span class="et"></span><span class="ec"></span><i class="ebar"></i></div>
      <div id="combo"><div id="comboFx" aria-hidden="true"></div><div class="big" id="comboBig" role="status" aria-label="Bloom chain combo"><span class="cic">${ICONS.biomass}</span><span class="cl">Combo</span> <span class="cx">×0</span></div><div class="cbody panel"><ul id="comboParts"></ul><div class="total" id="comboTotal"></div><div id="chainAreas"></div></div><div id="feed"></div></div>
      <div id="hotbar" class="panel">${slots}</div>
      <button id="frenzyBtn" class="frenzy-btn" aria-label="Bloom Frenzy (Q)" hidden><span class="fill"></span><span class="fi">${ICONS.frenzy}</span><span class="ft">0%</span></button>
      <div id="hint" class="panel hide"><span id="hintText"></span><button aria-label="Dismiss hint">×</button></div>
      <div id="toasts"></div>
      <div id="catPanel" class="panel" hidden><button aria-label="Dismiss">×</button><div id="catPanelBody"></div></div>
      <div id="intro" hidden><div class="panel card-intro">
        <h2>${LOGO_MARK}<span>Welcome to Solarbloom</span></h2>
        <p>This old park is dead and grey, and the city around it is lost in a gloomy fog. Bring it back to life.</p>
        <ol>
          <li><b>Walk up to a grey tile and pulse it</b> to restore it. Each pulse uses a little ⚡ energy and 💧 water, which refill on their own.</li>
          <li><b>Green tiles grow 🌿 biomass.</b> Spend it on machines and upgrades. Pulse a green tile again to grow flowers.</li>
          <li><b>Goal:</b> wake the dry fountain. Then the fog starts to lift. The checklist is in the top-right corner.</li>
        </ol>
        <button id="introGo">Start restoring ✨</button>
      </div></div>
      <div id="tip" class="panel"></div>
      <div id="fail"></div>
      <div id="plotPicker" class="drawer panel" aria-label="Plot picker"><h2><span id="ppTitle">Plot</span> <button aria-label="Close plot picker">×</button></h2><p id="ppSub" class="pp-sub"></p><div id="ppList"></div></div>
      <div id="backpack" class="drawer panel" aria-label="Backpack"><h2>Backpack <button aria-label="Close backpack">×</button></h2><div id="bpList"></div></div>
      <div id="upgrades" class="drawer panel"><h2>Upgrades <button aria-label="Close upgrades">×</button></h2><p id="upgNext" class="upg-next"></p><div id="upgList"></div></div>
      <div id="inspect" class="panel"></div>
      <div id="modal"><div class="panel">
        <h2>Settings</h2>
        <label>Sound effects <input type="checkbox" data-set="sound"></label>
        <label>Sound volume <input type="range" min="0" max="100" step="5" data-vol="sfxVolume" aria-label="Sound volume"></label>
        <label>Music <input type="checkbox" data-set="music"></label>
        <label>Music volume <input type="range" min="0" max="100" step="5" data-vol="musicVolume" aria-label="Music volume"></label>
        <label>Graphics <select id="gfxSel" aria-label="Graphics quality"><option value="auto">Auto</option><option value="high">High</option><option value="deck">Steam Deck</option><option value="medium">Medium</option><option value="low">Low (phones)</option></select></label>
        <label>Interface size <select id="uiScaleSel" aria-label="Interface size"><option value="100">100%</option><option value="125">125%</option><option value="150">150%</option></select></label>
        <label>High contrast <input type="checkbox" data-set="highContrast"></label>
        <label>Reduced motion &amp; effects <input type="checkbox" data-set="reducedMotion"></label>
        <label>Fewer particles &amp; softer sparkles <input type="checkbox" data-set="lowVfx"></label>
        <label>Simple fog (faster on phones) <input type="checkbox" data-set="lowFog"></label>
        <label>Fireflies <input type="checkbox" data-set="fireflies"></label>
        <label>Camera follows big chains <input type="checkbox" data-set="followChains"></label>
        <label>Show numbers (rates, income, time to afford) <input type="checkbox" data-set="showNumbers"></label>
        <label>Potter about (no nudges or tips, gentler chains) <input type="checkbox" data-set="potter"></label>
        <label>Tutorial hints <input type="checkbox" data-set="hints"></label>
        <label>Debug / FPS (F3) <input type="checkbox" data-set="debug"></label>
        <div id="controlsBox" class="controls"></div>
        <div class="stats" id="statsBox"></div>
        <div id="disc"></div>
        <div class="row"><button id="closeModal">Back to the garden</button><button id="photoBtn">Photo mode</button><button class="danger" id="newGame">New game</button></div>
      </div></div>
      <div id="cine"><div class="bar t"></div><div class="bar b"></div><div class="title" id="cineTitle"></div><button id="skipBtn">Skip ⏭</button></div>
      <div id="wlabels"></div>
      <div id="fps"></div>
    `;
  }

  private wire() {
    const r = this.root;
    r.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.addEventListener('click', () => this.cb.selectTool(b.dataset.tool as Tool)));
    $(r, '#harvestBtn').addEventListener('click', () => this.cb.harvest());
    $(r, '#frenzyBtn').addEventListener('click', () => this.cb.activateFrenzy());
    $(r, '#upgBtn').addEventListener('click', () => this.toggleUpgrades());
    $(r, '#upgrades h2 button').addEventListener('click', () => this.toggleUpgrades(false));
    $(r, '#coreBtn').addEventListener('click', () => this.cb.activateCore());
    $(r, '#hint button').addEventListener('click', () => {
      this.hintDismissedStep = this.sim.state.progression.tutorialStep;
      $(r, '#hint').classList.add('hide');
    });
    $(r, '#setBtn').addEventListener('click', () => this.openSettings(true));
    $(r, '#speedBtn').addEventListener('click', () => {
      const sp = this.cb.cycleSpeed();
      const b = $(r, '#speedBtn');
      $(b, '.mult').textContent = `${sp}×`;
      b.classList.toggle('fast', sp !== 1);
      b.setAttribute('aria-label', `Game speed: ${sp}×`);
      b.title = `Game speed: ${sp}×`;
    });
    $(r, '#catBtn').addEventListener('click', () => this.openSettings(true, true));
    $(r, '#pawBtn').addEventListener('click', () => this.cb.findCat());
    $(r, '#homeBtn').addEventListener('click', () => this.cb.goHome($(r, '#homeBtn').classList.contains('ready')));
    $(r, '#buildToggle').addEventListener('click', () => this.toggleTray());
    $(r, '#pauseBtn').addEventListener('click', () => this.cb.togglePause());
    $(r, '#objToggle').addEventListener('click', () => {
      const open = $(r, '#obj').classList.toggle('expanded');
      const t = $(r, '#objToggle');
      t.setAttribute('aria-expanded', String(open));
      t.setAttribute('aria-label', open ? 'Hide objective details' : 'Show objective details');
    });
    $(r, '#closeModal').addEventListener('click', () => this.openSettings(false));
    $(r, '#photoBtn').addEventListener('click', () => {
      this.openSettings(false);
      this.cb.photoMode();
    });
    $(r, '#modal').addEventListener('click', (e) => {
      if (e.target === $(r, '#modal')) this.openSettings(false);
    });
    // In-page two-tap confirmation (native confirm() dialogs are blocked in some embeds).
    let armed = 0;
    const ng = $<HTMLButtonElement>(r, '#newGame');
    ng.addEventListener('click', () => {
      if (Date.now() - armed < 4000) return this.cb.newGame();
      armed = Date.now();
      ng.textContent = 'Press again to clear your garden';
      setTimeout(() => {
        if (Date.now() - armed >= 4000) ng.textContent = 'New game';
      }, 4100);
    });
    $(r, '#skipBtn').addEventListener('click', () => this.cb.skipCinematic());
    $(r, '#catPanel button').addEventListener('click', () => ($(r, '#catPanel').hidden = true));
    $(r, '#introGo').addEventListener('click', () => {
      $(r, '#intro').hidden = true;
      this.sim.state.progression.introSeen = true;
    });
    r.querySelectorAll<HTMLInputElement>('[data-vol]').forEach((inp) => {
      const key = inp.dataset.vol as 'sfxVolume' | 'musicVolume';
      inp.value = String(this.settings[key] ?? 100);
      inp.addEventListener('input', () => this.cb.setVolume(key, Number(inp.value)));
    });
    const gfx = $<HTMLSelectElement>(r, '#gfxSel');
    gfx.value = this.settings.gfx ?? 'auto';
    gfx.addEventListener('change', () => this.cb.setGraphics(gfx.value as 'auto' | 'deck' | 'low' | 'medium' | 'high'));
    const uis = $<HTMLSelectElement>(r, '#uiScaleSel');
    uis.value = String(this.settings.uiScale ?? 100);
    uis.addEventListener('change', () => this.cb.setSetting('uiScale', Number(uis.value)));
    r.querySelectorAll<HTMLInputElement>('[data-set]').forEach((inp) => {
      const key = inp.dataset.set as keyof Settings;
      inp.checked = !!this.settings[key];
      inp.addEventListener('change', () => this.cb.setSetting(key, inp.checked));
    });
    $(r, '#statsBox').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-timings]');
      if (!b) return;
      const text = this.sim.metrics.summary();
      const done = () => (b.textContent = '✓ Copied');
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => (b.textContent = 'Copy failed: select the text above'));
      else b.textContent = 'Select the text above to copy';
    });
    // Phase 5 E12: tap a resource for where its numbers come from (tap again, or elsewhere, to close).
    $(r, '#res').addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-res]');
      const k = row?.dataset.res as ResourceKind | undefined;
      this.resInfo = k && this.resInfo !== k ? k : undefined;
      const box = $(r, '#resInfo');
      box.hidden = !this.resInfo;
      if (this.resInfo) {
        this.last.delete('resInfo');
        const rect = row!.getBoundingClientRect();
        box.style.top = `${Math.round(toHud(rect.bottom) + 6)}px`;
        box.style.left = `${Math.round(Math.max(8, Math.min(hudWidth() - 248, toHud(rect.left))))}px`;
        box.innerHTML = this.resourceBreakdown(this.resInfo);
      }
    });
    // Any tap outside the resource strip closes it (it never sits over the game).
    document.addEventListener('pointerdown', (e) => {
      if (!this.resInfo || (e.target as HTMLElement).closest?.('#res')) return;
      this.resInfo = undefined;
      $(r, '#resInfo').hidden = true;
    });
    $(r, '#upgList').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-buy]');
      if (b && !b.disabled) this.cb.buyUpgrade(b.dataset.buy!);
    });
    // World labels can carry actions (wake a landmark, open an area).
    $(r, '#wlabels').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const wake = t.closest<HTMLButtonElement>('[data-wake]');
      if (wake && !wake.disabled) this.cb.wake(wake.dataset.wake!);
      const area = t.closest<HTMLElement>('[data-area]') ?? t.closest<HTMLElement>('.wlabel')?.querySelector<HTMLElement>('[data-area]');
      if (area && !wake) this.cb.openArea(area.dataset.area!);
    });
    $(r, '#obj').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const wk = t.closest<HTMLButtonElement>('[data-wake]');
      if (wk && !wk.disabled) this.cb.wake(wk.dataset.wake!);
      const fo = t.closest<HTMLButtonElement>('[data-focus]');
      if (fo) {
        const [x, z] = fo.dataset.focus!.split(',').map(Number);
        this.cb.focusTile(x, z);
        if (fo.dataset.tool) this.cb.selectTool(fo.dataset.tool as Tool);
      }
      if (t.closest('[data-upg]')) this.toggleUpgrades(true);
      if (t.closest('[data-harvest]')) this.cb.harvest();
      const mg = t.closest<HTMLButtonElement>('[data-merge-at]');
      if (mg) this.cb.mergeAt(mg.dataset.mergeAt!);
      const ia = t.closest<HTMLButtonElement>('[data-inspect-at]');
      if (ia) this.cb.inspectAt(ia.dataset.inspectAt!);
      const ct = t.closest<HTMLButtonElement>('[data-core-tool]');
      if (ct) this.cb.selectTool(ct.dataset.coreTool as Tool);
      const su = t.closest<HTMLButtonElement>('[data-super]');
      if (su) {
        const [action, id] = su.dataset.super!.split('|');
        this.cb.superAction(action as 'stage' | 'activate', id);
      }
      const db = t.closest<HTMLButtonElement>('[data-district]');
      if (db && !db.disabled) this.cb.districtBloom(db.dataset.district!, db.dataset.replay === '1');
      if (fo || wk || db || mg || ct || su || t.closest('[data-upg]') || t.closest('[data-harvest]')) this.suggestionAt = -1;
    });
    $(r, '#inspect').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) this.cb.closeInspect();
      const w = t.closest<HTMLButtonElement>('[data-wake]');
      if (w && !w.disabled) this.cb.wake(w.dataset.wake!);
      const db = t.closest<HTMLButtonElement>('[data-district]');
      if (db && !db.disabled) this.cb.districtBloom(db.dataset.district!, db.dataset.replay === '1');
      const b = t.closest<HTMLButtonElement>('[data-buy]');
      if (b && !b.disabled) this.cb.buyUpgrade(b.dataset.buy!);
      const rl = t.closest<HTMLButtonElement>('[data-role]');
      if (rl && !rl.disabled) this.cb.chooseRole(rl.dataset.role!);
      const sp = t.closest<HTMLButtonElement>('[data-super]');
      if (sp && !sp.disabled) {
        const [action, id] = sp.dataset.super!.split('|');
        this.cb.superAction(action as 'stage' | 'activate' | 'auto', id);
      }
      const mg = t.closest<HTMLButtonElement>('[data-merge]');
      if (mg && !mg.disabled) this.cb.merge(mg.dataset.merge as 'start' | 'confirm' | 'cancel');
      const am = t.closest<HTMLButtonElement>('[data-area-mode]');
      if (am) {
        const [id, mode] = am.dataset.areaMode!.split('|');
        this.cb.setAreaMode(id, (mode || undefined) as AreaMode | undefined);
      }
    });
  }

  /** Spending totals sampled about once a second of sim time (Phase 4 E01.2). */
  /** Phase 5 E12: the resource whose breakdown popover is open (tap a resource cell). */
  private resInfo?: ResourceKind;

  /** Where a resource's numbers come from right now (popover and tooltip). */
  private resourceBreakdown(k: ResourceKind, plain = false): string {
    const s = this.sim;
    const L = s.ledger;
    const pm = (x: Big) => `${fmt(x.mul(60), 1)}/min`;
    const c = s.econ.cap(k);
    const lines: [string, string][] = [
      ['Producing', pm(L.warm ? L.gross(k) : s.production.rates()[k])],
      ['Spending', pm(L.spent(k))],
    ];
    if (c) lines.push(['Lost to full storage', `${pm(L.wasted(k))}${L.wasted(k).gt(0) ? ' (charges Bloom Frenzy)' : ''}`]);
    const net = L.net(k);
    lines.push(['Net', `${net.lt(0) ? '−' : '+'}${pm(net.abs())}`]);
    lines.push(['Stored', c ? `${fmt(s.econ.get(k))} / ${fmt(c)}` : `${fmt(s.econ.get(k))} (no limit)`]);
    if (plain) return `${RES_META[k].name}: ${lines.map(([a, b]) => `${a} ${b}`).join(' · ')}`;
    return `<b>${RES_META[k].icon} ${RES_META[k].name}</b>${lines.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('')}`;
  }

  private set(key: string, el: HTMLElement, prop: 'text' | 'html' | 'width' | 'cls' | 'style' | 'title', value: string, cls?: string) {
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

  private catPanelTimer?: number;
  /** Lucky Cat reward summary: stays in the corner until dismissed (or fades after a while). */
  catReward(title: string, detail: string) {
    const p = $(this.root, '#catPanel');
    $(this.root, '#catPanelBody').innerHTML = `<b>${ICONS.cat} ${iconize(esc(title))}</b><span>${iconize(esc(detail))}</span>`;
    p.hidden = false;
    window.clearTimeout(this.catPanelTimer);
    this.catPanelTimer = window.setTimeout(() => (p.hidden = true), 16000);
  }

  showIntro() {
    $(this.root, '#intro').hidden = false;
  }

  get introOpen() {
    return !$(this.root, '#intro').hidden;
  }

  private nudgeUntil = 0;
  private nudgeSel = '';
  /** Briefly highlight a control (e.g. Harvest when energy runs out). */
  nudge(sel: string, secs = 4) {
    if (this.settings.potter) return; // E19.4.3: the potter-about pace never nudges
    this.nudgeSel = sel;
    this.nudgeUntil = performance.now() + secs * 1000;
  }

  /** "24/80🌿" for what's short, or the plain cost when affordable. */
  private costShort(cost: Cost): string {
    const s = this.sim;
    if (s.econ.canAfford(cost)) return formatCost(cost);
    return KINDS.filter((k) => Economy.part(cost, k).gt(s.econ.get(k)))
      .map((k) => `${fmt(s.econ.get(k))}/${fmt(Economy.part(cost, k).ceil())}${RES_EMOJI[k]}`)
      .join(' ');
  }


  /** The current tutorial hint, written from live numbers, plus the control it refers to. */
  private hintFor(step: number): { text: string; target?: string } {
    const s = this.sim;
    const n = s.progression.restoredCount(HOME);
    // Phase 4 E02.3: one short line each, written from live numbers ("Build a Drone Hub · 24/80🌿").
    const build = (t: BuildableType, why: string) => ({
      text: `${why} Build a ${MACHINES[t].icon} ${MACHINES[t].name} · ${this.costShort(s.build.cost(t))}`,
      target: `#buildTray [data-tool="${t}"]`,
    });
    switch (step) {
      case 0:
        return { text: `Walk up to a grey tile and press ${this.cb.keyFor('pulse')} to bring it back to life ✨` };
      case 1:
      case 2: {
        if (step === 1) return { text: `Green tiles grow 🌿. Restore a few more · ${n}/4` };
        const open = s.upgrades.all().map((u) => s.upgrades.status(u)).filter((st) => st.ok || st.reason?.startsWith('Need '));
        const cheapest = open.reduce<Big | undefined>((m, st) => (m && m.lte(st.cost) ? m : st.cost), undefined);
        return !cheapest || s.econ.get('biomass').gte(cheapest)
          ? { text: 'An upgrade is ready: open Upgrades', target: '#upgBtn' }
          : { text: `First upgrade · ${fmt(s.econ.get('biomass'))}/${fmt(cheapest)}🌿` };
      }
      case 3:
        return build('condenser', 'Steady water:');
      case 4:
        return build('pollinator', 'Plants help each other:');
      case 5:
        return { text: 'Restore a tile next to your 🌸 garden for a Bloom Chain' };
      case 6:
        return build('droneHub', 'Let drones help:');
      case 7: {
        const full = s.progression.fullBloomCount(HOME);
        const missing = SEED_CORE_MACHINES.filter((t) => !s.progression.built(t));
        if (missing.length) return build(missing[0], 'The fountain needs it:');
        const g = TUNING.park;
        return n < g.restoredTiles
          ? { text: `Restore the park · ${n}/${g.restoredTiles}`, target: '#obj' }
          : { text: `Pulse green tiles until they're in full bloom · ${full}/${g.fullBloomTiles}`, target: '#obj' };
      }
      case 8:
        return { text: `The fountain is ready: walk up and press ${this.cb.keyFor('interact')}, or use ✨ Wake the fountain`, target: '#coreBtn' };
      default:
        return this.hoodHint();
    }
  }

  /** The city objective after the fountain: the next area to clear. Returns the "Next:" line. */
  private suggestionAt = -1;
  private suggestionBtn = '';
  /** The advisor's next step as a button (recomputed twice a second; it scans the fog edge). */
  private suggestionHtml(): string {
    const now = performance.now();
    if (now - this.suggestionAt < 500) return this.suggestionBtn;
    this.suggestionAt = now;
    // E19.4.3: the advisor is asked either way (its "saving up" note steers drone spending); potter just hides it.
    const g = advisorStep(this.sim, !!this.settings.potter);
    if (!g) return (this.suggestionBtn = '');
    const a = g.action;
    const attr =
      a.kind === 'wake' ? `data-wake="${a.machineId}"` : a.kind === 'district' ? `data-district="${a.districtId}"` : a.kind === 'focus' ? `data-focus="${a.x + (a.layer ? (this.sim.grid.layer(a.layer)?.origin[0] ?? 0) : 0)},${a.z + (a.layer ? (this.sim.grid.layer(a.layer)?.origin[2] ?? 0) : 0)}"` : a.kind === 'build' ? `data-focus="${a.x},${a.z}" data-tool="${a.type}"` : a.kind === 'merge' ? `data-merge-at="${a.machineId}"` : a.kind === 'role' ? `data-inspect-at="${a.machineId}"` : a.kind === 'placeCore' ? `data-core-tool="super:${a.type}"` : a.kind === 'super' ? `data-super="${a.action}|${a.machineId}"` : a.kind === 'upgrades' ? 'data-upg="1"' : a.kind === 'harvest' ? 'data-harvest="1"' : 'disabled';
    this.suggestionBtn = `<p class="sugg">${esc(g.text)}</p><button class="act" ${attr}>${esc(g.label)}</button>`;
    return this.suggestionBtn;
  }

  private cityObjective(): string {
    const s = this.sim;
    const id = s.areas.nextGoal();
    const objList = $(this.root, '#objList');
    if (!id) {
      this.set('objTitle', $(this.root, '#objTitle'), 'text', '🌫️ Push back the fog');
      this.set('objList', objList, 'html', '');
      this.set('objAct', $(this.root, '#objAct'), 'html', this.suggestionHtml());
      return '';
    }
    const a = s.areas.info(id);
    const def = AREA_TYPES[a.type];
    const c = s.areas.counts(id);
    const need = s.areas.need(id);
    const pct = Math.min(100, Math.round((c.restored / Math.max(1, need)) * 100));
    const cleared = s.areas.revealed().filter((x) => s.areas.fog(x) === 'cleared').length;
    this.set('objTitle', $(this.root, '#objTitle'), 'text', `${def.icon} Clear the ${def.name.toLowerCase()}`);
    this.set('objPct', $(this.root, '#objPct'), 'text', `${a.landmarkName}: ${Math.min(c.restored, need)}/${need} tiles · ${cleared} area${cleared === 1 ? '' : 's'} cleared`);
    this.set('objBar', $(this.root, '#objBar'), 'width', `${pct}%`);
    const ready = s.areas.ready(id);
    const sp = s.milestones.specialty(id); // City 09.1: the landmark's specialty action
    const fr = s.advisor.nearestFrontier();
    const frontier = fr && fr.areaId !== id && !this.settings.potter ? `<li><span class="ck">·</span>Nearest frontier: the ${esc(fr.name.toLowerCase())}, ${fr.distance} block${fr.distance === 1 ? '' : 's'} out (${Math.round(fr.share * 100)}% restored)</li>` : '';
    this.set(
      'objList',
      objList,
      'html',
      `<li class="${c.restored >= need ? 'done' : ''}"><span class="ck">${c.restored >= need ? '✓' : ''}</span>Restore ${need} tiles of the ${esc(def.name.toLowerCase())} (next to clear ground first)</li>` +
        `<li class="${sp.met ? 'done' : ''}" title="${esc(sp.hint)}"><span class="ck">${sp.met ? '✓' : ''}</span>${esc(sp.label)}</li>` +
        `<li><span class="ck"></span>Wake the ${esc(a.landmarkName)}</li>${frontier}`,
    );
    // The suggested next step sits outside the checklist, so it stays visible when the list is collapsed.
    this.set('objAct', $(this.root, '#objAct'), 'html', this.suggestionHtml());
    if (ready) return '';
    return c.restored >= need && !sp.met ? `Next: ${sp.label.charAt(0).toLowerCase()}${sp.label.slice(1)}` : `Next: restore the ${def.name.toLowerCase()} (${Math.min(c.restored, need)}/${need})`;
  }

  /** After the fountain: hints follow the city objective. */
  private hoodHint(): { text: string; target?: string } {
    const s = this.sim;
    {
      const id = s.areas.nextGoal();
      if (!id) return { text: 'The fog is gone from everything you can reach. Keep growing your gardens.' };
      const a = s.areas.info(id);
      return s.areas.ready(id)
        ? { text: `The ${a.landmarkName} is ready. Wake it to clear this area's fog and reveal what lies beyond.`, target: '#objAct [data-wake]' }
        : s.areas.counts(id).restored >= s.areas.need(id) && !s.milestones.met(id)
          ? { text: `The ${a.landmarkName} wants one more thing: ${s.milestones.specialty(id).hint}` }
          : { text: `The fog recedes tile by tile: restore tiles touching clear ground. Drones, chains and Wide Pulse all help push it back.` };
    }
    return { text: 'Restore the park and wake its fountain.' };
  }

  setTool(t: Tool) {
    this.tool = t;
    this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    const building = t !== 'pulse' && t !== 'inspect';
    const tg = $(this.root, '#buildToggle');
    tg.classList.toggle('active', building);
    const st = superType(t);
    const def = st ? TIER3[st]! : building ? MACHINES[t as BuildableType] : undefined;
    $(tg, '.si').innerHTML = st ? iconize(def!.icon) : building ? ICONS[MACHINE_ICONS[t]] : ICONS.build;
    $(tg, '.sl').textContent = def ? (st ? def.name.split(' ').pop()! : def.name.replace('Water ', '').replace('Pollinator ', '')) : 'Build';
    this.toggleTray(false);
  }

  /** The Build tray: machines and their costs pop up above the hotbar (Phase 4 E02.2: all screen sizes). */
  toggleTray(open?: boolean) {
    const tray = $(this.root, '#buildTray');
    const o = open ?? !tray.classList.contains('open');
    tray.classList.toggle('open', o);
    $(this.root, '#buildToggle').setAttribute('aria-expanded', String(o));
  }

  get trayOpen() {
    return $(this.root, '#buildTray').classList.contains('open');
  }

  toggleUpgrades(open = !this.upgradesOpen) {
    this.upgradesOpen = open;
    $(this.root, '#upgrades').classList.toggle('open', open);
    if (open) this.renderUpgrades(true);
  }

  /**
   * Bloombot (G.16, G.7): the hotbar's key badges from the bindings, or gamepad buttons when the pad was used
   * last. Without bindings, the cursor map.
   */
  setKeyMap(mode: 'keys' | 'pad' | undefined, b?: Bindings) {
    const slots: [string, Action, string][] = [
      ['[data-tool="inspect"]', 'interact', '1'],
      ['[data-tool="pulse"]', 'pulse', '2'],
      ['#buildToggle', 'tray', 'B'],
      ['#harvestBtn', 'harvest', 'H'],
      ['#upgBtn', 'upgrades', 'U'],
    ];
    for (const [sel, action, cursor] of slots) {
      const el = this.root.querySelector<HTMLElement>(`#hotbar ${sel} .key`);
      if (!el) continue;
      el.textContent = !b || !mode ? cursor : mode === 'pad' ? padShort(b.pad[action]) : b.label(action);
    }
    this.root.classList.toggle('pad-keys', mode === 'pad');
  }

  /**
   * Bloombot (G.16): the Controls section of Settings: every action with its key and gamepad button. Clicking
   * one waits for the next key (or button) and binds it; a key another action had moves over to it (a swap).
   */
  renderControls(b: Bindings, listen: (kind: 'key' | 'pad', done: (code: string | number | undefined) => void) => void, changed: () => void) {
    const box = this.root.querySelector<HTMLElement>('#controlsBox');
    if (!box) return;
    const row = (a: (typeof ACTIONS)[number]) =>
      `<div class="ctl-row"><span>${a.label}</span><button class="ctl-key" data-act="${a.id}" data-kind="key">${[...new Set(b.keys[a.id].map(keyLabel))].join(' / ')}</button>` +
      `<button class="ctl-key" data-act="${a.id}" data-kind="pad" ${a.pad ? '' : 'disabled'}>${a.pad ? padLabel(b.pad[a.id]) : 'stick'}</button></div>`;
    box.innerHTML = `<h3>Controls</h3><p class="ctl-help">Choose an action, then press the new key or button. Esc cancels.</p>${ACTIONS.map(row).join('')}<button id="ctlReset" class="ctl-reset">Reset to defaults</button>`;
    box.querySelectorAll<HTMLButtonElement>('.ctl-key').forEach((btn) =>
      btn.addEventListener('click', () => {
        const act = btn.dataset.act as Action;
        const kind = btn.dataset.kind as 'key' | 'pad';
        btn.textContent = 'Press…';
        btn.classList.add('listening');
        listen(kind, (code) => {
          if (code !== undefined) {
            if (kind === 'key') b.setKey(act, code as string);
            else b.setButton(act, code as number);
            changed();
          }
          this.renderControls(b, listen, changed);
        });
      }),
    );
    box.querySelector('#ctlReset')!.addEventListener('click', () => {
      b.reset();
      changed();
    });
  }

  /** Steam Deck (#243): HUD size, 100 / 125 / 150%. Zooms the whole HUD; see UiScale. */
  setUiScale(percent: number) {
    const pct = percent === 125 || percent === 150 ? percent : 100;
    ui.scale = pct / 100;
    this.root.style.zoom = pct === 100 ? '' : String(ui.scale);
    const sel = this.root.querySelector<HTMLSelectElement>('#uiScaleSel');
    if (sel) sel.value = String(pct);
  }

  private backpackIsOpen = false;
  /** Bloombot (G.15): the backpack (Tab / d-pad up): what you've found, and later your plot options and decorations. */
  toggleBackpack(open = !this.backpackIsOpen) {
    this.backpackIsOpen = open;
    $(this.root, '#backpack').classList.toggle('open', open);
    if (open) this.renderBackpack();
  }

  get backpackOpen() {
    return this.backpackIsOpen;
  }

  private picker?: PlotPickerHandlers;
  /**
   * E19.1.2 (#248): the plot picker. Unlocked options are buttons (mouse, keys and the pad's focus ring); focusing
   * or hovering one previews it on the plot, choosing it keeps it, and closing without choosing puts the plot back.
   * Locked options show what they wait for. Choosing and changing are free.
   */
  openPlotPicker(m: PlotPickerModel, h: PlotPickerHandlers) {
    this.toggleBackpack(false);
    this.picker = h;
    $(this.root, '#ppTitle').innerHTML = iconize(esc(m.title));
    $(this.root, '#ppSub').textContent = m.sub;
    const rows = m.choices.map((c) => {
      const tag = c.solid ? 'Solid' : 'Walk over it';
      if (!c.unlocked) return `<div class="card pp-opt locked"><span class="ci">${c.icon}</span><span class="cn">${esc(c.name)}</span><span class="cd2">Unlocks when ${esc(c.hint ?? '')}</span></div>`;
      const on = c.id === m.current;
      return `<button class="card pp-opt${on ? ' on' : ''}" data-opt="${c.id}" aria-pressed="${on}"><span class="ci">${c.icon}</span><span class="cn">${esc(c.name)}${c.fresh ? '<em class="pp-new">New</em>' : ''}${on ? '<em>Chosen</em>' : ''}</span><span class="cd2">${esc(c.blurb)} <i>${tag}</i></span></button>`;
    });
    if (m.current) rows.push('<button class="pp-clear" data-opt="">Clear the plot</button>');
    const list = $(this.root, '#ppList');
    list.innerHTML = iconize(rows.join(''));
    list.querySelectorAll<HTMLButtonElement>('button[data-opt]').forEach((b) => {
      const id = b.dataset.opt || undefined;
      b.addEventListener('click', () => this.picker?.onChoose(id));
      if (id) {
        b.addEventListener('mouseenter', () => this.picker?.onPreview(id));
        b.addEventListener('focus', () => this.picker?.onPreview(id));
        b.addEventListener('mouseleave', () => this.picker?.onPreview(undefined));
        b.addEventListener('blur', () => this.picker?.onPreview(undefined));
      }
    });
    $(this.root, '#plotPicker').classList.add('open');
  }

  closePlotPicker() {
    const h = this.picker;
    if (!h) return;
    this.picker = undefined;
    $(this.root, '#plotPicker').classList.remove('open');
    h.onClose();
  }

  get plotPickerOpen() {
    return !!this.picker;
  }

  private renderBackpack() {
    const st = this.sim.state;
    const woken = this.sim.areas
      .revealed()
      .filter((id) => this.sim.areas.fog(id) === 'cleared')
      .map((id) => this.sim.areas.info(id));
    const card = (icon: string, name: string, detail: string) => `<div class="card"><span class="ci">${icon}</span><span class="cn">${name}</span><span class="cd2">${detail}</span></div>`;
    const fauna = Object.keys(st.fauna ?? {});
    const parts = [
      '<h3 class="bp-h">Discoveries</h3>',
      card('🐱', `Lucky Cats found: ${st.stats.catsFound}`, st.stats.catsFound ? 'Keep wandering: more hide as the city wakes.' : 'Wander the city. Paw prints mean a cat is close.'),
      card('⛲', `Landmarks woken: ${woken.length}`, woken.length ? woken.map((a) => a.landmarkName).join(', ') : 'Restore the park to wake the fountain.'),
      card('🦋', `Wildlife: ${fauna.length}`, fauna.length ? fauna.join(', ') : 'Wildlife arrives as gardens grow.'),
      '<h3 class="bp-h">Plots and decorations</h3>',
      ...this.backpackPlots(),
    ];
    $(this.root, '#bpList').innerHTML = iconize(parts.join(''));
  }

  /** E19.1: plots chosen so far, and the plot options you've earned (by area type). */
  private backpackPlots(): string[] {
    const cz = this.sim.state.cozy;
    const chosen = Object.values(cz?.plots ?? {});
    const card = (icon: string, name: string, detail: string) => `<div class="card"><span class="ci">${icon}</span><span class="cn">${name}</span><span class="cd2">${detail}</span></div>`;
    const got = PLOT_OPTIONS.filter((o) => 'start' in o.unlock || cz?.unlocked?.includes(o.id));
    const byKind = new Map<string, number>();
    for (const id of chosen) byKind.set(id, (byKind.get(id) ?? 0) + 1);
    const out = [
      card('🌱', `Plots chosen: ${chosen.length}`, chosen.length ? [...byKind].map(([id, n]) => `${esc(PLOT_OPTION[id]?.name ?? id)}${n > 1 ? ` ×${n}` : ''}`).join(', ') : 'Every area has a few plots. Restore one, face it and press the interact button.'),
      card('✨', `Plot options: ${got.length} of ${PLOT_OPTIONS.length}`, 'More unlock as the park grows and areas clear. Free, always.'),
    ];
    out.push(`<div class="bp-opts">${got.map((o) => `<span title="${esc(o.name)}">${o.icon}</span>`).join('')}</div>`);
    return out;
  }

  get isUpgradesOpen() {
    return this.upgradesOpen;
  }

  openSettings(open: boolean, focusCats = false) {
    $(this.root, '#modal').classList.toggle('open', open);
    if (open) {
      this.renderDiscoveries();
      if (focusCats) $(this.root, '#disc').scrollIntoView({ block: 'nearest' });
      const s = this.sim.state.stats;
      const avg = s.chains ? (s.chainEffects / s.chains).toFixed(1) : '—';
      $(this.root, '#statsBox').innerHTML = iconize(
        `Tiles restored: <b>${s.tilesRestored}</b> · Bloom chains: <b>${s.chains}</b> · Best: <b>×${s.maxCombo}</b> · Avg: <b>${avg}</b><br>Drone jobs: <b>${s.droneJobs}</b> · Lucky Cats: <b>${s.catsFound}</b> 🐱 · Play time: <b>${Math.floor(this.sim.time / 60)}m</b>` +
        `<details style="margin-top:6px"><summary>Playtest timings</summary><pre class="ptime">${esc(this.sim.metrics.summary())}</pre><button class="copyT" data-copy-timings>📋 Copy</button></details>`);
      this.root.querySelectorAll<HTMLInputElement>('[data-set]').forEach((inp) => (inp.checked = !!this.settings[inp.dataset.set as keyof Settings]));
      $<HTMLSelectElement>(this.root, '#gfxSel').value = this.settings.gfx ?? 'auto';
      const auto = $<HTMLOptionElement>(this.root, '#gfxSel option[value=auto]');
      auto.textContent = this.gfxDeck ? 'Auto (Steam Deck)' : this.gfxTier ? `Auto (${this.gfxTier[0].toUpperCase()}${this.gfxTier.slice(1)})` : 'Auto';
    }
  }

  private renderDiscoveries() {
    const d = this.sim.cat.discoveries();
    const names: Record<string, string> = { luckyHarvest: 'Lucky Harvest', solarFrenzy: 'Solar Surge', megaBloom: 'Mega Bloom', droneParty: 'Drone Party', jackpot: 'Jackpot', goldenRelay: 'Golden Relay', catsGarden: "Cat's Garden", fogWhisker: 'Fog Whisker' };
    // In the city, finds are grouped by area type (the city is endless; the list never grows).
    const spots = d.byType.length
      ? d.byType
          .map(
            (t) =>
              `<li class="${t.cats ? 'found' : ''}"><span>${t.cats ? t.icon : '❔'}</span>${esc(t.name)} nooks: ${t.cats ? `${t.cats} cat${t.cats === 1 ? '' : 's'} in ${t.nooks} nook${t.nooks === 1 ? '' : 's'} · ${t.kinds}/${t.totalKinds} kinds of reward` : 'none found yet'}</li>`,
          )
          .join('')
      : d.anchors.map((a) => `<li class="${a.found ? 'found' : ''}"><span>${a.found ? '🐱' : '❔'}</span>${a.found ? esc(a.hint) : 'Undiscovered nook'}</li>`).join('');
    const rewards = Object.entries(names)
      .map(([k, n]) => `<span class="rw ${d.rewards[k as keyof typeof d.rewards] ? 'got' : ''}">${n}${d.rewards[k as keyof typeof d.rewards] ? ` ×${d.rewards[k as keyof typeof d.rewards]}` : ''}</span>`)
      .join('');
    $(this.root, '#disc').innerHTML = iconize(`<h3>🐱 Lucky Cat discoveries · ${d.found}</h3><ul class="spots">${spots}</ul><div class="rws">${rewards}</div>`);
  }

  get modalOpen() {
    return $(this.root, '#modal').classList.contains('open');
  }

  resourceRect(kind: ResourceKind): DOMRect {
    return $(this.root, `[data-res="${kind}"] .ic`).getBoundingClientRect();
  }

  private flashedAt = new Map<string, number>();
  private prevRes = new Map<ResourceKind, number>();

  flashResource(kind: ResourceKind, cls: 'flash' | 'short' | 'bump') {
    // Restarting the animation forces a layout: at most a few times a second per counter (big chains call
    // this hundreds of times).
    const now = performance.now();
    const key = `${kind}|${cls}`;
    if (now - (this.flashedAt.get(key) ?? -1e9) < 180) return;
    this.flashedAt.set(key, now);
    const el = $(this.root, `[data-res="${kind}"]`);
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  renderUpgrades(force = false) {
    if (!this.upgradesOpen && !force) return;
    const u = this.sim.upgrades;
    // Grouped by system.
    const sorted = u
      .grouped()
      .flatMap((g) => g.upgrades);
    let lastGroup = '';
    const html = sorted
      .map((def) => {
        const head = def.group !== lastGroup ? `<h3 class="ugroup">${GROUP_ICONS[def.group] ? ICONS[GROUP_ICONS[def.group]] : ''} ${def.group}</h3>` : '';
        lastGroup = def.group;
        // Phase 5 E12: per-machine upgrades show the type's range of levels and an "Upgrade all" button that buys
        // cheapest-first; long-tail upgrades (no last level) show their level number instead of pips.
        const per = !!def.machine;
        const st = u.status(def);
        const n = per ? u.targets(def).length : 0;
        const lvl = per ? (st.machine ? u.levelOf(st.machine, def.id) : u.maxLevelOf(def.id)) : u.level(def.id);
        const maxed = st.reason === 'Maxed';
        const finite = Number.isFinite(def.maxLevel) && def.maxLevel <= 8;
        const pips = finite && !per ? `<span class="pips">${Array.from({ length: def.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span>` : '';
        const lvTxt = maxed ? '<em>MAX</em>' : per ? `<em>${n} built · next Lv ${lvl + 1}</em>` : `<em>Lv ${lvl}</em>`;
        const btn = per
          ? `<button class="buy" data-buy="${def.id}|*" ${st.ok ? '' : 'disabled'}>${maxed ? '✓' : `All · ${formatPriceHtml(st.price, u.short(st))}`}</button>`
          : `<button class="buy" data-buy="${def.id}" ${st.ok ? '' : 'disabled'}>${maxed ? '✓' : formatPriceHtml(st.price, u.short(st))}</button>`;
        return `${head}<div class="card"><span class="ci">${def.icon}</span><span class="cn">${esc(def.name)} ${lvTxt}</span>
          ${btn}
          <span class="cd2">${esc(def.describe(lvl + 1))}${per && n ? ' · inspect a machine to upgrade just that one' : ''}</span>${pips}
          ${!st.ok && !maxed && st.reason && !st.reason.startsWith('Need ') ? `<span class="why">${esc(st.reason)}</span>` : ''}</div>`;
      })
      .join('');
    this.set('upgList', $(this.root, '#upgList'), 'html', html);
  }

  showTip(x: number, y: number, html: string) {
    const tip = $(this.root, '#tip');
    this.set('tip', tip, 'html', html);
    tip.style.display = 'block';
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const px = Math.min(hudWidth() - w - 8, toHud(x) + 18);
    const py = Math.max(8, Math.min(hudHeight() - h - 90, toHud(y) + 18));
    tip.style.transform = `translate(${px}px, ${py}px)`;
    tip.style.left = '0';
    tip.style.top = '0';
  }

  hideTip() {
    $(this.root, '#tip').style.display = 'none';
  }

  private failTimer = 0;
  showFail(msg: string, x?: number, y?: number) {
    const el = $(this.root, '#fail');
    el.innerHTML = iconize(esc(msg));
    el.style.display = 'block';
    const px = x !== undefined ? toHud(x) : hudWidth() / 2 - 100;
    const py = y !== undefined ? toHud(y) : hudHeight() - 160;
    el.style.left = `${Math.max(8, Math.min(hudWidth() - 290, px - 20))}px`;
    el.style.top = `${Math.max(8, py - 48)}px`;
    this.failTimer = 2.2;
  }

  /**
   * Toasts: at most two on screen. A toast with the same headline as one showing just refreshes it
   * (with a ×N count) instead of stacking, so a burst of area clears or chains stays calm.
   */
  toast(html: string, kind: '' | 'gold' | 'cat' = '', secs = 3.2) {
    const box = $(this.root, '#toasts');
    // E19.4.2: the calm HUD keeps one toast at a time, drops number-heavy detail lines and the repeat count.
    const calm = !this.settings.showNumbers;
    if (calm) html = calmToast(html);
    const head = html.split('<small>')[0].replace(/[×x]\d+|\d+/g, '#');
    for (const c of Array.from(box.children) as HTMLElement[]) {
      if (c.dataset.head !== head || c.style.opacity === '0') continue;
      const n = Number(c.dataset.n ?? '1') + 1;
      c.dataset.n = String(n);
      if (!calm) c.innerHTML = iconize(`${html.replace('<small>', ` <b class="tn">×${n}</b><small>`)}${html.includes('<small>') ? '' : ` <b class="tn">×${n}</b>`}`);
      clearTimeout(Number(c.dataset.timer));
      c.dataset.timer = String(this.fadeLater(c, secs));
      return;
    }
    while (box.children.length >= (calm ? 1 : 2)) box.firstElementChild!.remove();
    const el = document.createElement('div');
    el.dataset.head = head;
    el.className = `toast panel ${kind}`;
    el.innerHTML = iconize(html);
    box.appendChild(el);
    el.dataset.timer = String(this.fadeLater(el, secs));
  }

  private fadeLater(el: HTMLElement, secs: number): number {
    return window.setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'scale(.96)'; // shrink in place: sliding up would overlap the toast above
      setTimeout(() => el.remove(), 600);
    }, secs * 1000);
  }

  feed(text: string) {
    const f = $(this.root, '#feed');
    while (f.children.length >= 4) f.firstElementChild!.remove();
    const el = document.createElement('div');
    el.innerHTML = iconize(esc(text));
    f.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 700);
    }, 2600);
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
    return ['#logo', '#res', '#obj', '#hotbar', '#hint', '#combo', '#quick', '#chips'].map((s) => $(this.root, s).getBoundingClientRect()).concat(extra);
  }

  setPaused(p: boolean) {
    const b = $(this.root, '#pauseBtn');
    this.set('pause', b, 'html', p ? ICONS.play : ICONS.pause);
    b.classList.toggle('on', p);
    b.setAttribute('aria-label', p ? 'Resume' : 'Pause');
    b.title = p ? 'Resume (P)' : 'Pause (P)';
  }

  setDebug(text: string | null) {
    const el = $(this.root, '#fps');
    el.classList.toggle('on', text !== null);
    if (text !== null) el.textContent = text;
  }

  renderInspect(html: string | null) {
    const el = $(this.root, '#inspect');
    if (html === null) {
      el.classList.remove('open');
      this.root.classList.remove('inspecting');
      this.last.delete('inspect');
      return;
    }
    el.classList.add('open');
    this.root.classList.add('inspecting');
    this.set('inspect', el, 'html', html);
  }

  /**
   * Phase 5 E15: the world event banner (small, above the hotbar, never blocks input: pointer-transparent) with
   * its effect and a timer bar, and the 🐾 chip once a cat has been hiding a while.
   */
  private updateEvents() {
    const s = this.sim;
    const el = $(this.root, '#eventBanner');
    const a = s.events.active;
    if (!a) {
      if (!el.hidden) el.hidden = true;
      this.last.delete('evT');
    } else {
      if (el.hidden) el.hidden = false;
      const info = WORLD_EVENT_INFO[a.type];
      const left = Math.max(0, a.until - s.time);
      const total = Math.max(0.1, a.until - a.startedAt);
      const hiding = s.state.cat.invasion?.length ?? 0;
      const effect = a.fallback ? a.fallback : a.type === 'invasion' ? `${hiding} cat${hiding === 1 ? '' : 's'} hiding · each with its own reward · no rush` : a.type === 'migration' ? `growing ${a.done ?? 0}/${(a.done ?? 0) + (a.queue?.length ?? 0)} tiles` : info.effect;
      this.set('evI', $(el, '.ei'), 'text', info.icon);
      this.set('evT', $(el, '.et'), 'html', `<b>${esc(info.name)}</b> ${esc(effect)}`);
      this.set('evC', $(el, '.ec'), 'text', a.type === 'invasion' ? '' : `${Math.ceil(left)}s`);
      this.set('evBar', $(el, '.ebar'), 'width', `${Math.round((left / total) * 100)}%`);
      this.set('evKind', el, 'title', `${info.name}: ${info.effect}`);
    }
    const hinted = s.cat.spots().filter((c) => s.cat.hinted(c)).length;
    const paw = $(this.root, '#pawBtn');
    if (paw.hidden !== !hinted) paw.hidden = !hinted;
    this.set('pawN', $(this.root, '#pawCount'), 'text', String(hinted));
  }

  private toastLayoutAt = 0;
  /** On narrow screens the top panels sit side by side: toasts drop below them instead of covering them. */
  private layoutToasts() {
    const now = performance.now();
    if (now - this.toastLayoutAt < 500) return;
    this.toastLayoutAt = now;
    const t = $(this.root, '#toasts');
    if (window.innerWidth > 760 && window.innerHeight > 500) {
      t.style.top = '';
      return;
    }
    const below = Math.max($(this.root, '#res').getBoundingClientRect().bottom, $(this.root, '#obj').getBoundingClientRect().bottom);
    t.style.top = `${Math.round(toHud(below) + 8)}px`;
  }

  update(dt: number) {
    this.layoutToasts();
    const s = this.sim;
    const rates = s.production.rates();
    // Phase 5 E12: the rate shown is NET (banked − spent over the last ~20 s), so production lost to a full store
    // is never shown as income. Tap a resource for the breakdown (gross, spending, overflow).
    const L = s.ledger;
    const surge = s.production.surgeActive();
    for (const k of KINDS) {
      const row = $(this.root, `[data-res="${k}"]`);
      const v = s.econ.get(k);
      const c = s.econ.cap(k);
      // Look 5.4: a big gain at once (a harvest, a chain payout, a cat reward) bumps the pill.
      const vn = toNum(v);
      const prev = this.prevRes.get(k);
      this.prevRes.set(k, vn);
      if (prev !== undefined && vn - prev > Math.max(1, 0.15 * (c ? toNum(c) : Math.max(prev, 10)))) this.flashResource(k, 'bump');
      this.set(`v-${k}`, $(row, '.n'), 'text', fmt(v));
      this.set(`c-${k}`, $(row, '.c'), 'text', c ? fmt(c) : '');
      this.set(`cw-${k}`, $(row, '.capw'), 'cls', c ? '0' : '1', 'nocap');
      const full = s.econ.isFull(k);
      const net = (L.warm ? L.net(k) : rates[k]).mul(60);
      const boost = k === 'energy' && surge ? ` ☀️×${TUNING.cat.frenzyMult}` : '';
      const sign = net.lt(0) ? '−' : '+';
      const rateTxt = `${sign}${fmt(net.abs(), 1)}/min`; // "· full" comes from the .full class
      this.set(`r-${k}`, $(row, '.rate'), 'html', `${rateTxt}${boost}`);
      this.set(`t-${k}`, row, 'title', this.settings.showNumbers ? this.resourceBreakdown(k, true) : RES_META[k].name);
      this.set(`b-${k}`, $(row, '.bar i'), 'width', c ? `${Math.round(Math.min(1, toNum(v) / Math.max(1e-9, toNum(c))) * 100)}%` : '100%');
      this.set(`f-${k}`, row, 'cls', full ? '1' : '0', 'full');
    }
    if (this.resInfo) this.set('resInfo', $(this.root, '#resInfo'), 'html', this.resourceBreakdown(this.resInfo));
    // Phase 4 E06: the Bloom Frenzy meter (appears with the first restored tile).
    const fb = $(this.root, '#frenzyBtn');
    if (fb.hidden && s.state.stats.tilesRestored > 0) fb.hidden = false;
    const fActive = s.frenzy.active();
    const fReady = s.frenzy.ready();
    const fill = fActive ? s.frenzy.remaining() / TUNING.frenzy.seconds : s.frenzy.charge / 100;
    this.set('frFill', fb, 'style', fill.toFixed(3), '--fill');
    this.set('frReady', fb, 'cls', fReady ? '1' : '0', 'ready');
    this.set('frActive', fb, 'cls', fActive ? '1' : '0', 'active');
    this.set('frBody', document.body, 'cls', fActive ? '1' : '0', 'frenzy'); // also right after loading mid-Frenzy
    this.set('frText', $(fb, '.ft'), 'text', fActive ? `${Math.ceil(s.frenzy.remaining())}s` : fReady ? 'FRENZY!' : `${Math.floor(s.frenzy.charge)}%`);
    this.updateEvents();
    this.set('frTitle', fb, 'title', fActive ? 'Bloom Frenzy! Pulse reach +2 tiers, biomass ×10, drones ×3' : fReady ? `Bloom Frenzy is ready: press ${this.cb.keyFor('frenzy')} to fire it` : 'Bloom Frenzy charges as you restore, chain and overflow');
    // Hotbar costs
    for (const t of BUILDABLE) {
      const btn = $(this.root, `#hotbar [data-tool="${t}"]`);
      const cost = s.build.cost(t);
      this.set(`hc-${t}`, $(btn, '.sc'), 'text', formatCost(cost));
      this.set(`hk-${t}`, btn, 'cls', s.econ.canAfford(cost) ? '0' : '1', 'cant');
      const locked = !s.build.isUnlocked(t);
      this.set(`hl-${t}`, btn, 'cls', locked ? '1' : '0', 'locked');
      // A rooftop's specialty piece only appears once that rooftop is reachable.
      const roofOnly = MACHINES[t].roofs;
      btn.hidden = !!roofOnly && !s.build.isUnlocked(t);
      if (locked) this.set(`hc-${t}`, $(btn, '.sc'), 'text', s.build.lockLabel(t));
    }
    // Phase 5 E14: core slots appear while a core waits to be placed; the Build button shows a badge.
    let cores = 0;
    for (const t of SUPER_TOOLS) {
      const n = s.supers.coreCount(superType(t)!);
      cores += n;
      const btn = $(this.root, `#hotbar [data-tool="${t}"]`);
      btn.hidden = !n;
      this.set(`hcs-${t}`, $(btn, '.sc'), 'text', n ? `core ×${n}` : '');
    }
    this.set('coresBadge', $(this.root, '#buildToggle .sc'), 'text', cores ? `✨ ${cores} core${cores > 1 ? 's' : ''}` : '');
    // Overcharge countdown on the Pulse button
    const every = s.upgrades.overchargeEvery;
    const pc0 = s.state.progression.pulseCharge ?? 0;
    const mega = s.restoration.megaReady();
    const pulseSc = mega ? '💥 MEGA next!' : every ? (pc0 === every - 1 ? '🌟 next!' : '●'.repeat(pc0) + '○'.repeat(every - pc0)) : '';
    this.set('pulseSc', $(this.root, '[data-tool="pulse"] .sc'), 'text', pulseSc);
    // Mega Pulse meter: a fill along the bottom of the Pulse button.
    const mf = s.state.progression.coreActivated ? Math.min(1, (s.state.progression.megaCharge ?? 0) / TUNING.mega.charge) : 0;
    const pb = $(this.root, '[data-tool="pulse"]');
    this.set('megaFill', pb, 'style', mf.toFixed(2), '--mega');
    this.set('megaOn', pb, 'cls', mega ? '1' : '0', 'mega');
    const cd = Math.max(0, s.state.harvestReadyAt - s.time);
    const hb = $(this.root, '#harvestBtn');
    this.set('hcd', $(hb, '.cd'), 'html', '');
    ($(hb, '.cd') as HTMLElement).style.transform = `scaleY(${cd / TUNING.harvest.cooldown})`;
    this.set('hsc', $(hb, '.sc'), 'text', cd > 0 ? `${Math.ceil(cd)}s` : `+${TUNING.harvest.energy}⚡`);
    // Phase 4 E02.5: a dot when there is something worth buying now, not a count of notifications.
    const useful = s.upgrades.all().find((u) => s.upgrades.status(u).ok);
    const badge = $(this.root, '#upgBtn .badge');
    this.set('badgeOn', badge, 'cls', useful ? '1' : '0', 'on');
    // Phase 5 E12: otherwise, how long until the next thing (seconds of current net income).
    const next = useful ? undefined : s.advisor.nextPurchase();
    // E19.4.2 / E20.7: time-to-afford is a number the calm HUD leaves out.
    const eta = this.settings.showNumbers && next ? (next.eta < 0.5 ? ' · affordable now' : ` · ~${etaText(next.eta)}`) : '';
    this.set('upgSc', $(this.root, '#upgBtn .sc'), 'text', useful ? formatCost(s.upgrades.status(useful).price).replace(/ /g, '') : next && eta ? `~${etaText(next.eta)}` : '\u00a0');
    this.set('upgNext', $(this.root, '#upgNext'), 'html', next ? `Next: ${next.icon} ${esc(next.name)} · ${formatCost(next.cost)}${eta}` : useful ? '' : '');
    this.renderUpgrades();

    const cats = s.state.cat.found;
    this.set('catCount', $(this.root, '#catCount'), 'text', String(cats));
    if (cats > 0) $(this.root, '#catBtn').hidden = false;
    // Look 5.9: the house shows a badge while a landmark (or the fountain) is ready to wake; a tap then flies there.
    const wakeReady = s.state.progression.coreActivated ? s.areas.revealed().some((id) => s.areas.fog(id) !== 'cleared' && s.areas.ready(id)) : s.progression.coreReady();
    const homeB = $(this.root, '#homeBtn');
    this.set('homeReady', homeB, 'cls', wakeReady ? '1' : '0', 'ready');
    this.set('homeTitle', homeB, 'title', wakeReady ? 'A landmark is ready to wake: look at it from above' : 'Home (Home key)');

    // Objective
    const p = s.progression;
    const restored = p.restoredCount(HOME);
    const total = p.restorableCount(HOME);
    const pct = Math.round((restored / Math.max(1, total)) * 100);
    let hoodNext = '';
    if (s.state.progression.coreActivated) {
      hoodNext = this.cityObjective();
    } else {
      this.set('objAct', $(this.root, '#objAct'), 'html', p.homeIsPark ? this.suggestionHtml() : '');
      const nm = p.nextMilestone();
      this.set('objPct', $(this.root, '#objPct'), 'text', `${restored}/${total} park tiles${nm ? ` · next reward at ${nm.at} 🌱` : ''}`);
      this.set('objBar', $(this.root, '#objBar'), 'width', `${pct}%`);
      const reqs = p.requirements();
      const html = reqs.map((r) => `<li class="${r.done ? 'done' : ''}"><span class="ck">${r.done ? '✓' : ''}</span>${esc(r.label)}</li>`).join('');
      this.set('objList', $(this.root, '#objList'), 'html', html);
    }
    const ready = p.coreReady();
    // Look 5.8: the card's checkbox ticks (with a flourish) once the current goal is ready to complete.
    const goal = s.state.progression.coreActivated ? s.areas.nextGoal() : undefined;
    const done = s.state.progression.coreActivated ? !!goal && s.areas.ready(goal) : ready;
    this.set('objDone', $(this.root, '#obj'), 'cls', done ? '1' : '0', 'done');
    this.set('objDoneLabel', $(this.root, '#objCheck'), 'title', done ? 'Ready: complete it now' : 'Not done yet');
    $(this.root, '#objCheck').setAttribute('aria-label', done ? 'Ready to complete' : 'Not done yet');
    const coreBtn = $(this.root, '#coreBtn');
    this.set('coreBtn', coreBtn, 'cls', ready ? '1' : '0', 'show');
    this.set('coreBtnText', coreBtn, 'text', `✨ ${p.homeIsPark ? 'Wake the fountain' : 'Awaken the Core'} · ${formatCost(TUNING.core.cost)}`);

    // Hint
    const step = s.state.progression.tutorialStep;
    const hint = $(this.root, '#hint');
    const h = this.hintFor(step);
    const showHint = this.settings.hints && !this.settings.potter && step !== this.hintDismissedStep && !this.introOpen;
    this.set('hintText', $(this.root, '#hintText'), 'text', h.text);
    this.set('hintShow', hint, 'cls', showHint ? '0' : '1', 'hide');
    // Glow the control the hint talks about (or a temporary nudge). On phones, machine cards live in the Build tray.
    let target = this.settings.potter ? '' : performance.now() < this.nudgeUntil ? this.nudgeSel : this.settings.hints ? (h.target ?? '') : '';
    const tray = $(this.root, '#buildTray');
    if (target.startsWith('#buildTray') && !tray.classList.contains('open')) target = '#buildToggle';
    if (this.last.get('nudgeTarget') !== target) {
      this.root.querySelectorAll('.nudge').forEach((e) => e.classList.remove('nudge'));
      if (target) this.root.querySelector(target)?.classList.add('nudge');
      this.last.set('nudgeTarget', target);
    }
    // "Next:" line (visible on phones, where the checklist is collapsed)
    const nextReq = s.state.progression.coreActivated ? undefined : p.requirements().find((r) => !r.done);
    const nm = s.state.progression.coreActivated ? undefined : p.nextMilestone();
    const nextText = s.state.progression.coreActivated ? hoodNext : ready ? 'Next: wake the fountain ✨' : nextReq ? `Next: ${nextReq.label}${nm && nextReq.label.startsWith('Restore') ? ` · 🌱 reward at ${nm.at}` : ''}` : '';
    // "Next:" is dropped on phones (CSS), so the goal itself fits on one line.
    this.set('objNext', $(this.root, '#objNext'), 'html', nextText.startsWith('Next: ') ? `<span class="nx">Next: </span>${esc(nextText.slice(6))}` : esc(nextText));

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
    if (this.failTimer > 0) {
      this.failTimer -= dt;
      if (this.failTimer <= 0) $(this.root, '#fail').style.display = 'none';
    }
  }

  machineHtml(m: MachineData, extra: string): string {
    const def = MACHINES[m.type];
    const tier = m.tier ?? 1;
    const t3 = tier >= 3 ? TIER3[m.type] : undefined;
    const t2 = tier === 2 ? TIER2[m.type] : undefined;
    const name = t3?.name ?? t2?.name ?? def.name;
    const icon = t3?.icon ?? t2?.icon ?? def.icon;
    const blurb = t3 ? `Superstructure (nine machines in one): ${t3.blurb}.` : t2 ? `Tier 2 (three merged): ${t2.blurb}. ${def.blurb}` : def.blurb;
    return `<h4><span>${icon} ${esc(name)}${m.starter ? ' <small class="dim">(old)</small>' : ''}</span><button data-close aria-label="Close">×</button></h4><p>${esc(blurb)}</p>${extra}`;
  }

  get currentTool() {
    return this.tool;
  }
}

/** "12 s", "3 min", "2 h": time-to-afford at the current net income (Phase 5 E12). */
export function etaText(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  if (sec < 60) return `${Math.max(1, Math.ceil(sec))} s`;
  if (sec < 3600) return `${Math.ceil(sec / 60)} min`;
  return `${Math.round(sec / 360) / 10} h`;
}

/** A short gamepad label for the small hotbar badges. */
function padShort(button: number | undefined): string {
  const short: Record<number, string> = { 0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT', 12: '↑', 13: '↓', 14: '←', 15: '→' };
  return button === undefined ? '' : (short[button] ?? padLabel(button));
}
