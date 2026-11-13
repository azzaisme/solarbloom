import { formatCost, KINDS } from '../core/Economy';
import type { BuildableType, MachineData, ResourceKind } from '../core/types';
import { BUILDABLE, MACHINES } from '../data/machines';
import { TUNING } from '../data/tuning';
import type { Sim } from '../gameplay/Sim';
import { TUTORIAL } from '../gameplay/ProgressionSystem';

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
}

export interface Settings {
  sound: boolean;
  music: boolean;
  reducedMotion: boolean;
  hints: boolean;
  debug: boolean;
}

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
      ...BUILDABLE.map(
        (t) =>
          `<button class="slot" data-tool="${t}" aria-label="Build ${MACHINES[t].name} (${MACHINES[t].hotkey})"><span class="key">${MACHINES[t].hotkey}</span><span class="si">${MACHINES[t].icon}</span><span class="sl">${MACHINES[t].name.replace('Water ', '').replace('Pollinator ', '')}</span><span class="sc"></span></button>`,
      ),
      `<span class="sep"></span>`,
      `<button class="slot" id="harvestBtn" aria-label="Harvest sunlight (H)"><span class="key">H</span><span class="si">🌞</span><span class="sl">Harvest</span><span class="sc">+${TUNING.harvest.energy}⚡</span><span class="cd"></span></button>`,
      `<button class="slot" id="upgBtn" aria-label="Upgrades (U)"><span class="key">U</span><span class="si">⬆️</span><span class="sl">Upgrades</span><span class="sc">🌿</span><span class="badge">!</span></button>`,
    ].join('');
    return `
      <div id="res" class="panel"><div class="logo"><span class="sun"></span>Solarbloom</div>${rows}</div>
      <div id="obj" class="panel">
        <h3 id="objTitle">Wake the Rooftop Core</h3>
        <div class="pct" id="objPct">0% restored</div>
        <div class="pbar"><i id="objBar" style="width:0%"></i></div>
        <ul id="objList"></ul>
        <button id="coreBtn">✨ Awaken the Core</button>
        <div class="tools">
          <button class="chip" id="pauseBtn" aria-label="Pause">⏸<span class="lbl"> Pause</span></button>
          <button class="chip" id="setBtn" aria-label="Settings">⚙️<span class="lbl"> Settings</span></button>
          <button class="chip" id="objToggle" aria-label="Toggle objective list">📋</button>
        </div>
      </div>
      <div id="combo"><div class="big" id="comboBig">BLOOM ×0</div><div id="feed"></div></div>
      <div id="hotbar" class="panel">${slots}</div>
      <div id="hint" class="panel hide"><span id="hintText"></span><button aria-label="Dismiss hint">×</button></div>
      <div id="toasts"></div>
      <div id="tip" class="panel"></div>
      <div id="fail"></div>
      <div id="upgrades" class="drawer panel"><h2>Upgrades <button aria-label="Close upgrades">×</button></h2><div id="upgList"></div></div>
      <div id="inspect" class="panel"></div>
      <div id="modal"><div class="panel">
        <h2>Settings</h2>
        <label>Sound effects <input type="checkbox" data-set="sound"></label>
        <label>Music <input type="checkbox" data-set="music"></label>
        <label>Reduced motion <input type="checkbox" data-set="reducedMotion"></label>
        <label>Tutorial hints <input type="checkbox" data-set="hints"></label>
        <label>Debug / FPS (F3) <input type="checkbox" data-set="debug"></label>
        <div class="stats" id="statsBox"></div>
        <div class="row"><button id="closeModal">Back to the garden</button><button class="danger" id="newGame">New game</button></div>
      </div></div>
      <div id="cine"><div class="bar t"></div><div class="bar b"></div><div class="title" id="cineTitle"></div><button id="skipBtn">Skip ⏭</button></div>
      <div class="wlabel panel" id="roof2Label"></div>
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
    $(r, '#pauseBtn').addEventListener('click', () => this.cb.togglePause());
    $(r, '#objToggle').addEventListener('click', () => $(r, '#obj').classList.toggle('expanded'));
    $(r, '#closeModal').addEventListener('click', () => this.openSettings(false));
    $(r, '#modal').addEventListener('click', (e) => {
      if (e.target === $(r, '#modal')) this.openSettings(false);
    });
    $(r, '#newGame').addEventListener('click', () => {
      if (confirm('Start a brand new rooftop? Your current garden will be cleared.')) this.cb.newGame();
    });
    $(r, '#skipBtn').addEventListener('click', () => this.cb.skipCinematic());
    r.querySelectorAll<HTMLInputElement>('[data-set]').forEach((inp) => {
      const key = inp.dataset.set as keyof Settings;
      inp.checked = this.settings[key];
      inp.addEventListener('change', () => this.cb.setSetting(key, inp.checked));
    });
    $(r, '#upgList').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-buy]');
      if (b && !b.disabled) this.cb.buyUpgrade(b.dataset.buy!);
    });
    $(r, '#inspect').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) this.cb.closeInspect();
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

  setTool(t: Tool) {
    this.tool = t;
    this.root.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  }

  toggleUpgrades(open = !this.upgradesOpen) {
    this.upgradesOpen = open;
    $(this.root, '#upgrades').classList.toggle('open', open);
    if (open) this.renderUpgrades(true);
  }

  get isUpgradesOpen() {
    return this.upgradesOpen;
  }

  openSettings(open: boolean) {
    $(this.root, '#modal').classList.toggle('open', open);
    if (open) {
      const s = this.sim.state.stats;
      $(this.root, '#statsBox').innerHTML = `Tiles restored: <b>${s.tilesRestored}</b> · Bloom chains: <b>${s.chains}</b> · Best combo: <b>×${s.maxCombo}</b><br>Drone jobs: <b>${s.droneJobs}</b> · Lucky Cats found: <b>${s.catsFound}</b> 🐱 · Play time: <b>${Math.floor(this.sim.time / 60)}m</b>`;
      this.root.querySelectorAll<HTMLInputElement>('[data-set]').forEach((inp) => (inp.checked = this.settings[inp.dataset.set as keyof Settings]));
    }
  }

  get modalOpen() {
    return $(this.root, '#modal').classList.contains('open');
  }

  resourceRect(kind: ResourceKind): DOMRect {
    return $(this.root, `[data-res="${kind}"] .ic`).getBoundingClientRect();
  }

  flashResource(kind: ResourceKind, cls: 'flash' | 'short') {
    const el = $(this.root, `[data-res="${kind}"]`);
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  renderUpgrades(force = false) {
    if (!this.upgradesOpen && !force) return;
    const u = this.sim.upgrades;
    const html = u
      .all()
      .map((def) => {
        const lvl = u.level(def.id);
        const st = u.status(def);
        const maxed = lvl >= def.maxLevel;
        const pips = Array.from({ length: def.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
        const roman = ['I', 'II', 'III', 'IV', 'V'][Math.min(lvl, def.maxLevel - 1)];
        return `<div class="card"><span class="ci">${def.icon}</span><span class="cn">${esc(def.name)} ${maxed ? '' : roman}<em>${maxed ? 'MAX' : ''}</em></span>
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

  toast(html: string, kind: '' | 'gold' | 'cat' = '', secs = 3.2) {
    const box = $(this.root, '#toasts');
    while (box.children.length >= 3) box.firstElementChild!.remove();
    const el = document.createElement('div');
    el.className = `toast panel ${kind}`;
    el.innerHTML = html;
    box.appendChild(el);
    setTimeout(() => {
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

  combo(n: number) {
    const el = $(this.root, '#comboBig');
    el.textContent = `BLOOM ×${n}`;
    el.classList.add('on');
    el.classList.toggle('tier2', n >= 5 && n < 10);
    el.classList.toggle('tier3', n >= 10);
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    this.comboTimer = 2.2;
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

  worldLabel(id: string, html: string | null, x = 0, y = 0) {
    const el = $(this.root, `#${id}`);
    if (!html) {
      el.style.display = 'none';
      return;
    }
    this.set(`wl-${id}`, el, 'html', html);
    el.style.display = 'block';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
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
      this.set(`r-${k}`, $(row, '.rate'), 'text', `+${rates[k] < 10 ? rates[k].toFixed(1) : Math.round(rates[k])}/s`);
      this.set(`b-${k}`, $(row, '.bar i'), 'width', `${Math.round((v / c) * 100)}%`);
      this.set(`f-${k}`, row, 'cls', s.econ.isFull(k) ? '1' : '0', 'full');
    }
    // Hotbar costs
    for (const t of BUILDABLE) {
      const btn = $(this.root, `[data-tool="${t}"]`);
      const cost = s.build.cost(t);
      this.set(`hc-${t}`, $(btn, '.sc'), 'text', formatCost(cost));
      this.set(`hk-${t}`, btn, 'cls', s.econ.canAfford(cost) ? '0' : '1', 'cant');
    }
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

    // Objective
    const p = s.progression;
    const restored = p.restoredCount('r1');
    const total = p.restorableCount('r1');
    const pct = Math.round((restored / Math.max(1, total)) * 100);
    this.set('objPct', $(this.root, '#objPct'), 'text', `${pct}% of the rooftop restored · ${restored}/${total} tiles`);
    this.set('objBar', $(this.root, '#objBar'), 'width', `${pct}%`);
    if (s.state.progression.coreActivated) {
      this.set('objTitle', $(this.root, '#objTitle'), 'text', '🌉 Next: Greenhouse Tower');
      this.set('objList', $(this.root, '#objList'), 'html', `<li class="done"><span class="ck">✓</span>Rooftop Core awakened</li><li><span class="ck"></span>Grow every tile to full bloom (${p.fullBloomCount('r1')}/${total})</li><li><span class="ck"></span>Rooftop 2 opens in the next update</li>`);
    } else {
      const reqs = p.requirements();
      const html = reqs.map((r) => `<li class="${r.done ? 'done' : ''}"><span class="ck">${r.done ? '✓' : ''}</span>${esc(r.label)}</li>`).join('');
      this.set('objList', $(this.root, '#objList'), 'html', html);
    }
    const ready = p.coreReady();
    const coreBtn = $(this.root, '#coreBtn');
    this.set('coreBtn', coreBtn, 'cls', ready ? '1' : '0', 'show');
    this.set('coreBtnText', coreBtn, 'text', `✨ Awaken the Core · ${formatCost(TUNING.core.cost)}`);

    // Hint
    const step = s.state.progression.tutorialStep;
    const hint = $(this.root, '#hint');
    const showHint = this.settings.hints && step !== this.hintDismissedStep && TUTORIAL[step];
    this.set('hintText', $(this.root, '#hintText'), 'text', TUTORIAL[step] ?? '');
    this.set('hintShow', hint, 'cls', showHint ? '0' : '1', 'hide');

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) $(this.root, '#comboBig').classList.remove('on');
    }
    if (this.failTimer > 0) {
      this.failTimer -= dt;
      if (this.failTimer <= 0) $(this.root, '#fail').style.display = 'none';
    }
  }

  machineHtml(m: MachineData, extra: string): string {
    const def = MACHINES[m.type];
    return `<h4><span>${def.icon} ${esc(def.name)}${m.starter ? ' <small style="font-weight:700;color:var(--ink-soft)">(old)</small>' : ''}</span><button data-close aria-label="Close">×</button></h4><p>${esc(def.blurb)}</p>${extra}`;
  }

  get currentTool() {
    return this.tool;
  }
}
