import { HOME } from '../gameplay/ProgressionSystem';
import { formatCost, KINDS } from '../core/Economy';
import type { Cost } from '../core/types';
import type { BuildableType, MachineData, ResourceKind } from '../core/types';
import { BUILDABLE, MACHINES } from '../data/machines';
import { AREA_TYPES } from '../data/city';
import { TUNING } from '../data/tuning';
import type { Sim } from '../gameplay/Sim';
import { SEED_CORE_MACHINES } from '../gameplay/ProgressionSystem';

export type Tool = 'inspect' | 'pulse' | BuildableType;

const RES_META: Record<ResourceKind, { icon: string; name: string; color: string }> = {
  energy: { icon: '⚡', name: 'Energy', color: 'var(--energy)' },
  water: { icon: '💧', name: 'Water', color: 'var(--water)' },
  biomass: { icon: '🌿', name: 'Biomass', color: 'var(--biomass)' },
};

export interface HudCallbacks {
  selectTool(t: Tool): void;
  harvest(): void;
  buyUpgrade(id: string): void;
  activateCore(): void;
  newGame(): void;
  setSetting(key: keyof Settings, v: boolean): void;
  skipCinematic(): void;
  closeInspect(): void;
  togglePause(): void;
  cycleSpeed(): number;
  focusRoof(roofId: string): void;
  buildLink(linkId: string): void;
  activateRoofCore(roofId: string): void;
  neighbourhoodBloom(replay: boolean): void;
  /** Wake a city landmark (by machine id). */
  wake(machineId: string): void;
  /** Open an area's panel (from its label in the overview). */
  openArea(areaId: string): void;
  /** Fly the camera to a ground tile and point at it (the objective's suggestion). */
  focusTile(x: number, z: number): void;
}

export interface Settings {
  sound: boolean;
  music: boolean;
  reducedMotion: boolean;
  hints: boolean;
  debug: boolean;
  /** Fewer particles and softer sparkles (Lucky Cat, chains), independent of motion. */
  lowVfx: boolean;
}

/** Each rooftop's Core landmark. */
export const CORE_TEXT: Record<string, { name: string; icon: string; blurb: string }> = {
  r1: { name: 'Rooftop Core', icon: '✨', blurb: 'An ancient bloom engine. Awaken it to restore the whole building.' },
  r2: { name: 'Old Cistern', icon: '💧', blurb: 'A dry rainwater cistern. Wake it to fill the basin with cascading water and steady 💧.' },
  r3: { name: 'Elder Tree', icon: '🌳', blurb: 'A dormant giant. Blooms around it charge its ring; a full ring releases a Canopy Burst.' },
};

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** DOM HUD. Reads sim state each frame (cheaply, with change detection); never mutates the sim directly. */
export class Hud {
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
    this.root.innerHTML = this.template();
    this.wire();
  }

  private template() {
    const rows = KINDS.map(
      (k) => `<div class="res-row" data-res="${k}" title="${RES_META[k].name}">
        <span class="ic" aria-hidden="true">${RES_META[k].icon}</span>
        <span class="val"><span class="n">0</span> <small>/ <span class="c">0</span> ${RES_META[k].name}</small></span>
        <span class="rate">+0/s</span>
        <span class="bar"><i style="background:${RES_META[k].color}"></i></span>
      </div>`,
    ).join('');
    const slots = [
      `<button class="slot" data-tool="inspect" aria-label="Inspect tool (1)"><span class="key">1</span><span class="si">🔍</span><span class="sl">Inspect</span><span class="sc">&nbsp;</span></button>`,
      `<button class="slot" data-tool="pulse" aria-label="Restoration Pulse (2)"><span class="key">2</span><span class="si">✨</span><span class="sl">Pulse</span><span class="sc">restore</span></button>`,
      `<span class="sep"></span>`,
      `<button class="slot" id="buildToggle" aria-label="Build menu" aria-expanded="false"><span class="si">🔨</span><span class="sl">Build</span><span class="sc">machines</span></button>`,
      `<div id="buildTray">`,
      ...BUILDABLE.map(
        (t) =>
          `<button class="slot" data-tool="${t}" aria-label="Build ${MACHINES[t].name} (${MACHINES[t].hotkey})"><span class="key">${MACHINES[t].hotkey}</span><span class="si">${MACHINES[t].icon}</span><span class="sl">${MACHINES[t].name.replace('Water ', '').replace('Pollinator ', '')}</span><span class="sc"></span></button>`,
      ),
      `</div>`,
      `<span class="sep"></span>`,
      `<button class="slot" id="harvestBtn" aria-label="Harvest sunlight (H)"><span class="key">H</span><span class="si">🌞</span><span class="sl">Harvest</span><span class="sc">+${TUNING.harvest.energy}⚡</span><span class="cd"></span></button>`,
      `<button class="slot" id="upgBtn" aria-label="Upgrades (U)"><span class="key">U</span><span class="si">⬆️</span><span class="sl">Upgrades</span><span class="sc">🌿</span><span class="badge">!</span></button>`,
    ].join('');
    return `
      <div id="res" class="panel"><div class="logo"><span class="sun"></span>Solarbloom</div>${rows}</div>
      <div id="obj" class="panel">
        <h3 id="objTitle">Wake the fountain</h3>
        <div class="pct" id="objPct">0% restored</div>
        <div class="next" id="objNext"></div>
        <div class="pbar"><i id="objBar" style="width:0%"></i></div>
        <ul id="objList"></ul>
        <div id="objAct"></div>
        <button id="coreBtn">✨ Awaken the Core</button>
        <div class="tools">
          <button class="chip" id="pauseBtn" aria-label="Pause">⏸<span class="lbl"> Pause</span></button>
          <button class="chip" id="speedBtn" aria-label="Game speed">1×</button>
          <button class="chip" id="catBtn" aria-label="Lucky Cat discoveries" hidden>🐱 <span id="catCount">0</span></button>
          <button class="chip" id="setBtn" aria-label="Settings">⚙️<span class="lbl"> Settings</span></button>
          <button class="chip" id="objToggle" aria-label="Toggle objective list">📋</button>
        </div>
        <div class="tools" id="roofNav" hidden></div>
      </div>
      <div id="combo"><div class="big" id="comboBig">BLOOM CHAIN ×0</div><div class="total" id="comboTotal"></div><div id="feed"></div></div>
      <div id="hotbar" class="panel">${slots}</div>
      <div id="hint" class="panel hide"><span id="hintText"></span><button aria-label="Dismiss hint">×</button></div>
      <div id="toasts"></div>
      <div id="catPanel" class="panel" hidden><button aria-label="Dismiss">×</button><div id="catPanelBody"></div></div>
      <div id="intro" hidden><div class="panel card-intro">
        <h2>🌱 Welcome to Solarbloom</h2>
        <p>This old park is dead and grey, and the city around it is lost in a gloomy fog. Bring it back to life.</p>
        <ol>
          <li><b>Tap a grey tile</b> to restore it. Each tap uses a little ⚡ energy and 💧 water, which refill on their own.</li>
          <li><b>Green tiles grow 🌿 biomass.</b> Spend it on machines and upgrades. Tap a green tile again to grow flowers.</li>
          <li><b>Goal:</b> wake the dry fountain. Then the fog starts to lift. The checklist is in the top-right corner.</li>
        </ol>
        <button id="introGo">Start restoring ✨</button>
      </div></div>
      <div id="tip" class="panel"></div>
      <div id="fail"></div>
      <div id="upgrades" class="drawer panel"><h2>Upgrades <button aria-label="Close upgrades">×</button></h2><div id="upgList"></div></div>
      <div id="inspect" class="panel"></div>
      <div id="modal"><div class="panel">
        <h2>Settings</h2>
        <label>Sound effects <input type="checkbox" data-set="sound"></label>
        <label>Music <input type="checkbox" data-set="music"></label>
        <label>Reduced motion &amp; effects <input type="checkbox" data-set="reducedMotion"></label>
        <label>Fewer particles &amp; softer sparkles <input type="checkbox" data-set="lowVfx"></label>
        <label>Tutorial hints <input type="checkbox" data-set="hints"></label>
        <label>Debug / FPS (F3) <input type="checkbox" data-set="debug"></label>
        <div class="stats" id="statsBox"></div>
        <div id="disc"></div>
        <div class="row"><button id="closeModal">Back to the garden</button><button class="danger" id="newGame">New game</button></div>
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
      $(r, '#speedBtn').textContent = `${sp}×`;
    });
    $(r, '#catBtn').addEventListener('click', () => this.openSettings(true, true));
    $(r, '#buildToggle').addEventListener('click', () => this.toggleTray());
    $(r, '#pauseBtn').addEventListener('click', () => this.cb.togglePause());
    $(r, '#objToggle').addEventListener('click', () => $(r, '#obj').classList.toggle('expanded'));
    $(r, '#closeModal').addEventListener('click', () => this.openSettings(false));
    $(r, '#modal').addEventListener('click', (e) => {
      if (e.target === $(r, '#modal')) this.openSettings(false);
    });
    // In-page two-tap confirmation (native confirm() dialogs are blocked in some embeds).
    let armed = 0;
    const ng = $<HTMLButtonElement>(r, '#newGame');
    ng.addEventListener('click', () => {
      if (Date.now() - armed < 4000) return this.cb.newGame();
      armed = Date.now();
      ng.textContent = 'Tap again to clear your garden';
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
    r.querySelectorAll<HTMLInputElement>('[data-set]').forEach((inp) => {
      const key = inp.dataset.set as keyof Settings;
      inp.checked = this.settings[key];
      inp.addEventListener('change', () => this.cb.setSetting(key, inp.checked));
    });
    $(r, '#upgList').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-buy]');
      if (b && !b.disabled) this.cb.buyUpgrade(b.dataset.buy!);
    });
    // World labels can carry actions (build a bridge, awaken a rooftop).
    $(r, '#wlabels').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const link = t.closest<HTMLButtonElement>('[data-link]');
      if (link && !link.disabled) this.cb.buildLink(link.dataset.link!);
      const core = t.closest<HTMLButtonElement>('[data-core]');
      if (core && !core.disabled) this.cb.activateRoofCore(core.dataset.core!);
      const roof = t.closest<HTMLElement>('[data-roof]');
      if (roof && !link && !core) this.cb.focusRoof(roof.dataset.roof!);
      const wake = t.closest<HTMLButtonElement>('[data-wake]');
      if (wake && !wake.disabled) this.cb.wake(wake.dataset.wake!);
      const area = t.closest<HTMLElement>('[data-area]') ?? t.closest<HTMLElement>('.wlabel')?.querySelector<HTMLElement>('[data-area]');
      if (area && !wake && !link && !core) this.cb.openArea(area.dataset.area!);
    });
    $(r, '#roofNav').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-roof]');
      if (b) this.cb.focusRoof(b.dataset.roof!);
    });
    $(r, '#obj').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const link = t.closest<HTMLButtonElement>('[data-link]');
      if (link && !link.disabled) this.cb.buildLink(link.dataset.link!);
      const core = t.closest<HTMLButtonElement>('[data-core]');
      if (core && !core.disabled) this.cb.activateRoofCore(core.dataset.core!);
      const wk = t.closest<HTMLButtonElement>('[data-wake]');
      if (wk && !wk.disabled) this.cb.wake(wk.dataset.wake!);
      const fo = t.closest<HTMLButtonElement>('[data-focus]');
      if (fo) {
        const [x, z] = fo.dataset.focus!.split(',').map(Number);
        this.cb.focusTile(x, z);
      }
      if (t.closest('[data-upg]')) this.toggleUpgrades(true);
      if (t.closest('[data-harvest]')) this.cb.harvest();
      if (fo || wk || t.closest('[data-upg]') || t.closest('[data-harvest]')) this.suggestionAt = -1;
      const nb = t.closest<HTMLButtonElement>('[data-bloom]');
      if (nb && !nb.disabled) this.cb.neighbourhoodBloom(nb.dataset.bloom === 'replay');
    });
    $(r, '#inspect').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) this.cb.closeInspect();
      const w = t.closest<HTMLButtonElement>('[data-wake]');
      if (w && !w.disabled) this.cb.wake(w.dataset.wake!);
      const b = t.closest<HTMLButtonElement>('[data-buy]');
      if (b && !b.disabled) this.cb.buyUpgrade(b.dataset.buy!);
    });
  }

  private set(key: string, el: HTMLElement, prop: 'text' | 'html' | 'width' | 'cls', value: string, cls?: string) {
    if (this.last.get(key) === value) return;
    this.last.set(key, value);
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else if (prop === 'width') el.style.width = value;
    else if (prop === 'cls' && cls) el.classList.toggle(cls, value === '1');
  }

  private catPanelTimer?: number;
  /** Lucky Cat reward summary: stays in the corner until dismissed (or fades after a while). */
  catReward(title: string, detail: string) {
    const p = $(this.root, '#catPanel');
    $(this.root, '#catPanelBody').innerHTML = `<b>🐱 ${esc(title)}</b><span>${esc(detail)}</span>`;
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
    this.nudgeSel = sel;
    this.nudgeUntil = performance.now() + secs * 1000;
  }

  private costNote(cost: Cost): string {
    const s = this.sim;
    if (s.econ.canAfford(cost)) return `Cost ${formatCost(cost)}, and you can afford it now.`;
    const short = KINDS.filter((k) => (cost[k] ?? 0) > s.econ.get(k)).map((k) => `${Math.floor(s.econ.get(k))}/${Math.ceil(cost[k]!)}${RES_META[k].icon}`);
    return `Cost ${formatCost(cost)}. You have ${short.join(', ')}. Keep restoring!`;
  }

  /** The current tutorial hint, written from live numbers, plus the control it refers to. */
  private hintFor(step: number): { text: string; target?: string } {
    const s = this.sim;
    const n = s.progression.restoredCount(HOME);
    const build = (t: BuildableType, what: string) => ({
      text: `${what} Tap ${MACHINES[t].icon} ${MACHINES[t].name}, then a green or mossy tile. ${this.costNote(s.build.cost(t))}`,
      target: `[data-tool="${t}"]`,
    });
    switch (step) {
      case 0:
        return { text: 'Tap a grey tile to bring it back to life ✨ (the bouncing marker is a good start).' };
      case 1:
      case 2: {
        if (step === 1) return { text: `Nice! Green tiles grow 🌿 biomass. Restore a few more (${n}/4). Brown mossy tiles are cheaper.` };
        const cheapest = Math.min(...s.upgrades.all().filter((u) => s.upgrades.level(u.id) < u.maxLevel && (!u.available || u.available(s.state))).map((u) => s.upgrades.cost(u)));
        return s.econ.get('biomass') >= cheapest
          ? { text: 'You can afford an upgrade! Tap ⬆️ Upgrades and pick one.', target: '#upgBtn' }
          : { text: `Keep restoring to earn 🌿. Your first upgrade costs ${cheapest}🌿 (you have ${Math.floor(s.econ.get('biomass'))}).` };
      }
      case 3:
        return build('condenser', 'Water is the slowest resource. Build a Water Condenser for steady water:');
      case 4:
        return build('pollinator', 'Plants and machines help each other. Build a Pollinator Garden, ideally right next to a solar panel:');
      case 5:
        return { text: 'Restore a grey tile right next to your 🌸 garden: it pollinates its other neighbours, and any that touch a solar panel or another garden keep the Bloom Chain going!' };
      case 6:
        return build('droneHub', 'Let a drone take over the small jobs (it also unlocks the 🌳 Mother Tree). Build a Drone Hub:');
      case 7: {
        const full = s.progression.fullBloomCount(HOME);
        const missing = SEED_CORE_MACHINES.filter((t) => !s.progression.built(t));
        if (missing.length) return build(missing[0], `The Core also needs a ${MACHINES[missing[0]].name}.`);
        const g = s.progression.homeIsPark ? TUNING.park : TUNING.core;
        const what = s.progression.homeIsPark ? 'the fountain' : 'the Core';
        return { text: `Wake ${what}: restore ${g.restoredTiles} tiles (${n}/${g.restoredTiles}) and tap green tiles again until ${g.fullBloomTiles} are in full bloom 🌳 (${full}/${g.fullBloomTiles}).`, target: '#obj' };
      }
      case 8:
        return { text: s.progression.homeIsPark ? 'The fountain is ready! Tap ✨ Wake the fountain in the top-right panel.' : 'The Core is ready! Tap ✨ Awaken the Core in the top-right panel.', target: '#coreBtn' };
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
    const g = this.sim.advisor.suggest();
    const a = g.action;
    const attr =
      a.kind === 'wake' ? `data-wake="${a.machineId}"` : a.kind === 'focus' ? `data-focus="${a.x},${a.z}"` : a.kind === 'upgrades' ? 'data-upg="1"' : a.kind === 'harvest' ? 'data-harvest="1"' : 'disabled';
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
    const fr = s.advisor.nearestFrontier();
    const frontier = fr && fr.areaId !== id ? `<li><span class="ck">·</span>Nearest frontier: the ${esc(fr.name.toLowerCase())}, ${fr.distance} block${fr.distance === 1 ? '' : 's'} out (${Math.round(fr.share * 100)}% restored)</li>` : '';
    this.set(
      'objList',
      objList,
      'html',
      `<li class="${c.restored >= need ? 'done' : ''}"><span class="ck">${c.restored >= need ? '✓' : ''}</span>Restore ${need} tiles of the ${esc(def.name.toLowerCase())} (next to clear ground first)</li><li><span class="ck"></span>Wake the ${esc(a.landmarkName)}</li>${frontier}`,
    );
    // The suggested next step sits outside the checklist, so it stays visible when the list is collapsed.
    this.set('objAct', $(this.root, '#objAct'), 'html', this.suggestionHtml());
    return ready ? '' : `Next: restore the ${def.name.toLowerCase()} (${Math.min(c.restored, need)}/${need})`;
  }

  /** Phase 3 hints follow the neighbourhood objective. */
  private hoodHint(): { text: string; target?: string } {
    const s = this.sim;
    if (s.progression.homeIsPark) {
      const id = s.areas.nextGoal();
      if (!id) return { text: 'The fog is gone from everything you can reach. Keep growing your gardens.' };
      const a = s.areas.info(id);
      return s.areas.ready(id)
        ? { text: `The ${a.landmarkName} is ready. Wake it to clear this area's fog and reveal what lies beyond.`, target: '#objAct [data-wake]' }
        : { text: `The fog recedes tile by tile: restore tiles touching clear ground. Drones, chains and Wide Pulse all help push it back.` };
    }
    const o = s.hood.objective();
    switch (o.step) {
      case 'link1':
        return { text: `The Reservoir is just across the gap. Build the 🌉 Skybridge Relay (button in the objective panel, or on the dashed bridge). ${o.action?.ok ? '' : o.action?.reason ?? ''}`, target: '[data-link]' };
      case 'core2': {
        const gardens = s.state.machines.some((m) => m.type === 'reservoirGarden');
        if (!gardens) return { text: 'Restore the dry Reservoir, then build a ⛲ Reservoir Garden (8) within 2 tiles of a 💧 Water Condenser. Condensers fill its basin; when full it Overflows.', target: '[data-tool="reservoirGarden"]' };
        if (!o.items[2]?.done) return { text: 'Water Condensers within 2 tiles fill a ⛲ Reservoir Garden each time their meter fills. Full basin → Overflow! Select the garden to see its reach.' };
        return { text: o.action ? 'The Old Cistern is ready — awaken it from the objective panel or click it.' : 'Keep restoring the Reservoir to wake the Old Cistern.', target: o.action ? '[data-core]' : undefined };
      }
      case 'link2':
        return { text: 'Chains near a relay pylon jump across its bridge. Next, open the Canopy with the 🌉 Canopy Bridge.', target: '[data-link]' };
      case 'core3':
        return { text: 'Restorations and blooms near the 🌳 Elder Tree charge its ring. Full ring → Canopy Burst. 🌸 Gardens inside its reach make the burst spread further.' };
      case 'bloom':
        return { text: 'Every rooftop is awake! Press 🌸 Activate the Neighbourhood Bloom.', target: '[data-bloom]' };
      default:
        return { text: 'The neighbourhood lives. Keep growing every tile to full bloom — and look at the horizon…' };
    }
  }

  setTool(t: Tool) {
    this.tool = t;
    this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    const building = t !== 'pulse' && t !== 'inspect';
    const tg = $(this.root, '#buildToggle');
    tg.classList.toggle('active', building);
    $(tg, '.si').textContent = building ? MACHINES[t].icon : '🔨';
    $(tg, '.sl').textContent = building ? 'Building' : 'Build';
    this.toggleTray(false);
  }

  /** Phone-only build tray (on wide screens the machine cards are always in the hotbar). */
  toggleTray(open?: boolean) {
    const tray = $(this.root, '#buildTray');
    const o = open ?? !tray.classList.contains('open');
    tray.classList.toggle('open', o);
    $(this.root, '#buildToggle').setAttribute('aria-expanded', String(o));
  }

  toggleUpgrades(open = !this.upgradesOpen) {
    this.upgradesOpen = open;
    $(this.root, '#upgrades').classList.toggle('open', open);
    if (open) this.renderUpgrades(true);
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
      const f = s.firsts ?? {};
      const t = (k: string) => (f[k] === undefined ? '—' : `${Math.floor(f[k] / 60)}:${String(f[k] % 60).padStart(2, '0')}`);
      const avg = s.chains ? (s.chainEffects / s.chains).toFixed(1) : '—';
      $(this.root, '#statsBox').innerHTML =
        `Tiles restored: <b>${s.tilesRestored}</b> · Bloom chains: <b>${s.chains}</b> · Best: <b>×${s.maxCombo}</b> · Avg: <b>${avg}</b><br>Drone jobs: <b>${s.droneJobs}</b> · Lucky Cats: <b>${s.catsFound}</b> 🐱 · Play time: <b>${Math.floor(this.sim.time / 60)}m</b>` +
        `<details style="margin-top:6px"><summary>Playtest timings</summary>First upgrade ${t('upgrade')} · ×5 chain ${t('chain5')} · ×10 chain ${t('chain10')}<br>Drone Hub ${t('droneHub')} · first cat ${t('cat')} · Mother Tree ${t('motherTree')} (pulse ${t('treePulse')}) · Core ${t('core')}<br>Skybridge ${t('bridge:seed-reservoir')} · first cross-roof chain ${t('remoteChain')} · Cistern ${t('core:r2')} · Canopy Bridge ${t('bridge:seed-canopy')} · Elder Tree ${t('core:r3')} · Neighbourhood Bloom ${t('neighbourhoodBloom')}<br>Biggest chain ×${s.maxCombo} · cats found ${s.catsFound}<br>Time with nothing to do: ${Math.round(s.stuckSeconds)} s</details>`;
      this.root.querySelectorAll<HTMLInputElement>('[data-set]').forEach((inp) => (inp.checked = this.settings[inp.dataset.set as keyof Settings]));
    }
  }

  private renderDiscoveries() {
    const d = this.sim.cat.discoveries();
    const names: Record<string, string> = { luckyHarvest: 'Lucky Harvest', solarFrenzy: 'Solar Frenzy', megaBloom: 'Mega Bloom', droneParty: 'Drone Party', jackpot: 'Jackpot', goldenRelay: 'Golden Relay', catsGarden: "Cat's Garden", fogWhisker: 'Fog Whisker' };
    const spots = d.anchors
      .map((a) => `<li class="${a.found ? 'found' : ''}"><span>${a.found ? '🐱' : '❔'}</span>${a.found ? esc(a.hint) : 'Undiscovered nook'}</li>`)
      .join('');
    const rewards = Object.entries(names)
      .map(([k, n]) => `<span class="rw ${d.rewards[k as keyof typeof d.rewards] ? 'got' : ''}">${n}${d.rewards[k as keyof typeof d.rewards] ? ` ×${d.rewards[k as keyof typeof d.rewards]}` : ''}</span>`)
      .join('');
    $(this.root, '#disc').innerHTML = `<h3>🐱 Lucky Cat discoveries · ${d.found}</h3><ul class="spots">${spots}</ul><div class="rws">${rewards}</div>`;
  }

  get modalOpen() {
    return $(this.root, '#modal').classList.contains('open');
  }

  resourceRect(kind: ResourceKind): DOMRect {
    return $(this.root, `[data-res="${kind}"] .ic`).getBoundingClientRect();
  }

  private flashedAt = new Map<string, number>();

  flashResource(kind: ResourceKind, cls: 'flash' | 'short') {
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
    // Grouped by system. Rooftop-campaign Neighbourhood upgrades appear once there is a neighbourhood.
    const hood = this.sim.state.progression.coreActivated;
    const sorted = u
      .grouped()
      .filter((g) => g.group !== 'Neighbourhood' || hood)
      .flatMap((g) => g.upgrades);
    let lastGroup = '';
    const html = sorted
      .map((def) => {
        const head = def.group !== lastGroup ? `<h3 class="ugroup">${def.group}</h3>` : '';
        lastGroup = def.group;
        const lvl = u.level(def.id);
        const st = u.status(def);
        const maxed = lvl >= def.maxLevel;
        const pips = Array.from({ length: def.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
        const roman = ['I', 'II', 'III', 'IV', 'V'][Math.min(lvl, def.maxLevel - 1)];
        return `${head}<div class="card"><span class="ci">${def.icon}</span><span class="cn">${esc(def.name)} ${maxed ? '' : roman}<em>${maxed ? 'MAX' : ''}</em></span>
          <button class="buy" data-buy="${def.id}" ${st.ok ? '' : 'disabled'}>${maxed ? '✓' : `${st.cost} 🌿`}</button>
          <span class="cd2">${esc(def.describe(lvl + 1))}</span><span class="pips">${pips}</span>
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
    const px = Math.min(window.innerWidth - w - 8, x + 18);
    const py = Math.max(8, Math.min(window.innerHeight - h - 90, y + 18));
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
    el.textContent = msg;
    el.style.display = 'block';
    const px = x ?? window.innerWidth / 2 - 100;
    const py = y ?? window.innerHeight - 160;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - 290, px - 20))}px`;
    el.style.top = `${Math.max(8, py - 48)}px`;
    this.failTimer = 2.2;
  }

  /**
   * Toasts: at most two on screen. A toast with the same headline as one showing just refreshes it
   * (with a ×N count) instead of stacking, so a burst of area clears or chains stays calm.
   */
  toast(html: string, kind: '' | 'gold' | 'cat' = '', secs = 3.2) {
    const box = $(this.root, '#toasts');
    const head = html.split('<small>')[0].replace(/[×x]\d+|\d+/g, '#');
    for (const c of Array.from(box.children) as HTMLElement[]) {
      if (c.dataset.head !== head || c.style.opacity === '0') continue;
      const n = Number(c.dataset.n ?? '1') + 1;
      c.dataset.n = String(n);
      c.innerHTML = `${html.replace('<small>', ` <b class="tn">×${n}</b><small>`)}${html.includes('<small>') ? '' : ` <b class="tn">×${n}</b>`}`;
      clearTimeout(Number(c.dataset.timer));
      c.dataset.timer = String(this.fadeLater(c, secs));
      return;
    }
    while (box.children.length >= 2) box.firstElementChild!.remove();
    const el = document.createElement('div');
    el.dataset.head = head;
    el.className = `toast panel ${kind}`;
    el.innerHTML = html;
    box.appendChild(el);
    el.dataset.timer = String(this.fadeLater(el, secs));
  }

  private fadeLater(el: HTMLElement, secs: number): number {
    return window.setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';
      setTimeout(() => el.remove(), 600);
    }, secs * 1000);
  }

  feed(text: string) {
    const f = $(this.root, '#feed');
    while (f.children.length >= 4) f.firstElementChild!.remove();
    const el = document.createElement('div');
    el.textContent = text;
    f.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 700);
    }, 2600);
  }

  combo(n: number, total?: string) {
    const el = $(this.root, '#comboBig');
    el.textContent = `BLOOM CHAIN ×${n}`;
    el.classList.add('on');
    el.classList.toggle('tier2', n >= 5 && n < 10);
    el.classList.toggle('tier3', n >= 10);
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    const tot = $(this.root, '#comboTotal');
    tot.textContent = total ?? '';
    tot.classList.toggle('on', !!total);
    this.comboTimer = total ? 3.2 : 2.2;
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
  worldLabel(id: string, html: string | null, x = 0, y = 0, action = false) {
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
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  /** Rooftop chips (shown once a second rooftop is revealed). */
  roofNav(html: string | null) {
    const nav = $(this.root, '#roofNav');
    nav.hidden = !html;
    if (html) this.set('roofNav', nav, 'html', html);
  }

  /** Rectangles the Lucky Cat must never hide under. */
  blockedRects(): DOMRect[] {
    return ['#res', '#obj', '#hotbar', '#hint', '#combo'].map((s) => $(this.root, s).getBoundingClientRect());
  }

  setPaused(p: boolean) {
    this.set('pause', $(this.root, '#pauseBtn'), 'html', p ? '▶<span class="lbl"> Resume</span>' : '⏸<span class="lbl"> Pause</span>');
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
      this.last.delete('inspect');
      return;
    }
    el.classList.add('open');
    this.set('inspect', el, 'html', html);
  }

  update(dt: number) {
    const s = this.sim;
    const rates = s.production.rates();
    for (const k of KINDS) {
      const row = $(this.root, `[data-res="${k}"]`);
      const v = s.econ.get(k);
      const c = s.econ.cap(k);
      this.set(`v-${k}`, $(row, '.n'), 'text', String(Math.floor(v)));
      this.set(`c-${k}`, $(row, '.c'), 'text', String(Math.floor(c)));
      const perMin = rates[k] * 60;
      this.set(`r-${k}`, $(row, '.rate'), 'text', `+${perMin < 10 ? perMin.toFixed(1) : Math.round(perMin)}/min`);
      this.set(`b-${k}`, $(row, '.bar i'), 'width', `${Math.round((v / c) * 100)}%`);
      this.set(`f-${k}`, row, 'cls', s.econ.isFull(k) ? '1' : '0', 'full');
    }
    // Hotbar costs
    for (const t of BUILDABLE) {
      const btn = $(this.root, `[data-tool="${t}"]`);
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
    // Overcharge countdown on the Pulse button
    const every = s.upgrades.overchargeEvery;
    const pc0 = s.state.progression.pulseCharge ?? 0;
    const pulseSc = every ? (pc0 === every - 1 ? '🌟 next!' : '●'.repeat(pc0) + '○'.repeat(every - pc0)) : 'restore';
    this.set('pulseSc', $(this.root, '[data-tool="pulse"] .sc'), 'text', pulseSc);
    const cd = Math.max(0, s.state.harvestReadyAt - s.time);
    const hb = $(this.root, '#harvestBtn');
    this.set('hcd', $(hb, '.cd'), 'html', '');
    ($(hb, '.cd') as HTMLElement).style.transform = `scaleY(${cd / TUNING.harvest.cooldown})`;
    this.set('hsc', $(hb, '.sc'), 'text', cd > 0 ? `${Math.ceil(cd)}s` : `+${TUNING.harvest.energy}⚡`);
    const affordable = s.upgrades.all().filter((u) => s.upgrades.status(u).ok).length;
    const badge = $(this.root, '#upgBtn .badge');
    this.set('badge', badge, 'text', String(affordable));
    this.set('badgeOn', badge, 'cls', affordable > 0 ? '1' : '0', 'on');
    this.renderUpgrades();

    const cats = s.state.cat.found;
    this.set('catCount', $(this.root, '#catCount'), 'text', String(cats));
    if (cats > 0) $(this.root, '#catBtn').hidden = false;

    // Objective
    const p = s.progression;
    const restored = p.restoredCount(HOME);
    const total = p.restorableCount(HOME);
    const pct = Math.round((restored / Math.max(1, total)) * 100);
    let hoodNext = '';
    if (s.state.progression.coreActivated && p.homeIsPark) {
      hoodNext = this.cityObjective();
    } else if (s.state.progression.coreActivated) {
      const o = s.hood.objective();
      const roof = s.grid.roof(o.roofId)!;
      const rn = p.restoredCount(o.roofId);
      const rt = p.restorableCount(o.roofId);
      const rp = Math.round((rn / Math.max(1, rt)) * 100);
      this.set('objTitle', $(this.root, '#objTitle'), 'text', o.title);
      if (o.step === 'done' || o.step === 'bloom') {
        const rs = s.grid.rooftops;
        const all = rs.reduce((a, r) => a + p.restorableCount(r.id), 0);
        const full = rs.reduce((a, r) => a + p.fullBloomCount(r.id), 0);
        const fp = Math.round((full / Math.max(1, all)) * 100);
        this.set('objPct', $(this.root, '#objPct'), 'text', `The neighbourhood: ${fp}% in full bloom`);
        this.set('objBar', $(this.root, '#objBar'), 'width', `${fp}%`);
      } else {
        this.set('objPct', $(this.root, '#objPct'), 'text', s.grid.isPlayable(o.roofId) ? `${roof.name}: ${rp}% restored · ${rn}/${rt} tiles` : `${roof.name} is waiting across the bridge`);
        this.set('objBar', $(this.root, '#objBar'), 'width', `${s.grid.isPlayable(o.roofId) ? rp : 0}%`);
      }
      const items = o.items.map((r) => `<li class="${r.done ? 'done' : ''}"><span class="ck">${r.done ? '✓' : ''}</span>${esc(r.label)}</li>`).join('');
      const a = o.action;
      const attr = a ? (a.kind === 'link' ? `data-link="${a.id}"` : a.kind === 'core' ? `data-core="${a.id}"` : a.kind === 'bloom' ? 'data-bloom="go"' : 'data-bloom="replay"') : '';
      // The action sits outside the checklist so it stays visible when the list is collapsed (phones).
      const btn = a ? `<button class="act${a.kind === 'replay' ? ' green' : ''}" ${attr} ${a.ok ? '' : 'disabled'}>${esc(a.ok || !a.reason ? a.label : `${a.label} — ${a.reason}`)}</button>` : '';
      this.set('objList', $(this.root, '#objList'), 'html', items);
      this.set('objAct', $(this.root, '#objAct'), 'html', btn);
      const nx = o.items.find((r) => !r.done);
      hoodNext = a && a.ok && a.kind !== 'replay' ? '' : nx ? `Next: ${nx.label}` : ''; // a ready action is its own button
    } else {
      this.set('objAct', $(this.root, '#objAct'), 'html', p.homeIsPark ? this.suggestionHtml() : '');
      this.set('objPct', $(this.root, '#objPct'), 'text', `${pct}% of the ${p.homeIsPark ? 'park' : 'rooftop'} restored · ${restored}/${total} tiles`);
      this.set('objBar', $(this.root, '#objBar'), 'width', `${pct}%`);
      const reqs = p.requirements();
      const html = reqs.map((r) => `<li class="${r.done ? 'done' : ''}"><span class="ck">${r.done ? '✓' : ''}</span>${esc(r.label)}</li>`).join('');
      this.set('objList', $(this.root, '#objList'), 'html', html);
    }
    const ready = p.coreReady();
    const coreBtn = $(this.root, '#coreBtn');
    this.set('coreBtn', coreBtn, 'cls', ready ? '1' : '0', 'show');
    this.set('coreBtnText', coreBtn, 'text', `✨ ${p.homeIsPark ? 'Wake the fountain' : 'Awaken the Core'} · ${formatCost(TUNING.core.cost)}`);

    // Hint
    const step = s.state.progression.tutorialStep;
    const hint = $(this.root, '#hint');
    const h = this.hintFor(step);
    const showHint = this.settings.hints && step !== this.hintDismissedStep && !this.introOpen;
    this.set('hintText', $(this.root, '#hintText'), 'text', h.text);
    this.set('hintShow', hint, 'cls', showHint ? '0' : '1', 'hide');
    // Glow the control the hint talks about (or a temporary nudge). On phones, machine cards live in the Build tray.
    let target = performance.now() < this.nudgeUntil ? this.nudgeSel : this.settings.hints ? (h.target ?? '') : '';
    const tray = $(this.root, '#buildTray');
    if (target.startsWith('[data-tool') && getComputedStyle($(this.root, '#buildToggle')).display !== 'none' && !tray.classList.contains('open')) target = '#buildToggle';
    if (this.last.get('nudgeTarget') !== target) {
      this.root.querySelectorAll('.nudge').forEach((e) => e.classList.remove('nudge'));
      if (target) this.root.querySelector(target)?.classList.add('nudge');
      this.last.set('nudgeTarget', target);
    }
    // "Next:" line (visible on phones, where the checklist is collapsed)
    const nextReq = s.state.progression.coreActivated ? undefined : p.requirements().find((r) => !r.done);
    this.set('objNext', $(this.root, '#objNext'), 'text', s.state.progression.coreActivated ? hoodNext : ready ? 'Next: awaken the Core ✨' : nextReq ? `Next: ${nextReq.label}` : '');

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        $(this.root, '#comboBig').classList.remove('on');
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
    const core = m.type === 'core' ? CORE_TEXT[m.roofId] : undefined;
    const name = core?.name ?? def.name;
    const icon = core?.icon ?? def.icon;
    const blurb = core?.blurb ?? def.blurb;
    return `<h4><span>${icon} ${esc(name)}${m.starter ? ' <small style="font-weight:700;color:var(--ink-soft)">(old)</small>' : ''}</span><button data-close aria-label="Close">×</button></h4><p>${esc(blurb)}</p>${extra}`;
  }

  get currentTool() {
    return this.tool;
  }
}
