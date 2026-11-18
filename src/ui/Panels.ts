import type { AreaMode, MachineData } from '../core/types';
import { DECOR_OPTION, DECOR_OPTIONS, PLOT_OPTION, PLOT_OPTIONS } from '../data/cozy';
import { MATERIAL_IDS, MATERIALS } from '../data/salvage';
import { formatPriceHtml } from '../core/Economy';
import { MACHINES, TIER2, TIER3 } from '../data/machines';
import { GROUP_ICONS, ICONS, iconize } from './Icons';
import { $, esc, HudPart } from './HudPart';
import { hudHeight, hudWidth, toHud } from './UiScale';
import type { PlotPickerHandlers, PlotPickerModel } from './Hud';

/**
 * E22.5 (#342): the panels the HUD opens over the world: upgrades (classic), the plot picker, the backpack
 * (until E22.6's full-screen one), a machine's inspect panel, the Lucky Cat's reward card, the welcome card,
 * the hover tooltip and the "can't do that" note, and the classic quick chips (home, cats, paw prints).
 */
export class Panels extends HudPart {
  private upgradesOpen = false;
  private failTimer = 0;

  wire() {
    const r = this.root;
    $(r, '#upgrades h2 button').addEventListener('click', () => this.toggleUpgrades(false));
    $(r, '#catBtn').addEventListener('click', () => this.toggleBackpack(true));
    $(r, '#pawBtn').addEventListener('click', () => this.cb.findCat());
    $(r, '#homeBtn').addEventListener('click', () => this.cb.goHome($(r, '#homeBtn').classList.contains('ready')));
    $(r, '#catPanel button').addEventListener('click', () => ($(r, '#catPanel').hidden = true));
    $(r, '#introGo').addEventListener('click', () => {
      $(r, '#intro').hidden = true;
      this.sim.state.progression.introSeen = true;
    });
    $(r, '#upgList').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-buy]');
      if (b && !b.disabled) this.cb.buyUpgrade(b.dataset.buy!);
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
      const am = t.closest<HTMLButtonElement>('[data-area-mode]');
      if (am) {
        const [id, mode] = am.dataset.areaMode!.split('|');
        this.cb.setAreaMode(id, (mode || undefined) as AreaMode | undefined);
      }
    });
    $(r, '#backpack h2 button').addEventListener('click', () => this.toggleBackpack(false));
    $(r, '#plotPicker h2 button').addEventListener('click', () => this.closePlotPicker());
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

  toggleUpgrades(open = !this.upgradesOpen) {
    this.upgradesOpen = open;
    $(this.root, '#upgrades').classList.toggle('open', open);
    if (open) this.renderUpgrades(true);
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
    // E21.1 / E21.8: in the Old City the backpack lists what bloombot carries and the Keepers' other requests
    const oldCity = this.sim.oldCity
      ? [
          '<h3 class="bp-h">Carrying</h3>',
          ...MATERIAL_IDS.filter((m) => this.sim.inventory.count(m)).map((m) => card(MATERIALS[m].icon, `${MATERIALS[m].name}: ${this.sim.inventory.count(m)}/${this.sim.inventory.stackLimit()}`, `${this.sim.inventory.stored(m)} in storage`)),
          '<h3 class="bp-h">Requests</h3>',
          ...(this.sim.keepers.requests().length ? this.sim.keepers.requests().map((r, i) => card('🤖', i === 0 ? 'Pinned' : 'Waiting', esc(r.text))) : [card('🤖', 'No requests yet', 'Wake a Keeper and it will ask for help.')]),
        ]
      : [];
    const parts = [
      ...oldCity,
      '<h3 class="bp-h">Discoveries</h3>',
      card('🐱', `Lucky Cats found: ${st.stats.catsFound}`, st.stats.catsFound ? 'Keep wandering: more hide as the city wakes.' : 'Wander the city. Paw prints mean a cat is close.'),
      card('⛲', `Landmarks woken: ${woken.length}`, woken.length ? woken.map((a) => a.landmarkName).join(', ') : 'Restore the park to wake the fountain.'),
      card('🦋', `Wildlife: ${fauna.length}`, fauna.length ? fauna.join(', ') : 'Wildlife arrives as gardens grow.'),
      '<h3 class="bp-h">Plots and decorations</h3>',
      ...this.backpackPlots(),
      this.discoveriesHtml(),
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
    // E19.2: decorations placed, and the ones earned (keepsakes from Lucky Cats among them)
    const placed = Object.values(cz?.decor ?? {}).map((v) => v.split('@')[0]);
    const dGot = DECOR_OPTIONS.filter((o) => 'start' in o.unlock || cz?.decorUnlocked?.includes(o.id));
    const dKinds = new Map<string, number>();
    for (const id of placed) dKinds.set(id, (dKinds.get(id) ?? 0) + 1);
    out.push(
      card('🪑', `Decorations placed: ${placed.length}`, placed.length ? [...dKinds].map(([id, n]) => `${esc(DECOR_OPTION[id]?.name ?? id)}${n > 1 ? ` ×${n}` : ''}`).join(', ') : 'Open the Build tray and choose a decoration. Place it on restored ground near bloombot.'),
      card('✨', `Decorations: ${dGot.length} of ${DECOR_OPTIONS.length}`, 'Earned as the park grows and areas clear; keepsakes come from Lucky Cats. Place as many as you like.'),
      `<div class="bp-opts">${dGot.map((o) => `<span title="${esc(o.name)}">${o.icon}</span>`).join('')}</div>`,
    );
    return out;
  }

  get isUpgradesOpen() {
    return this.upgradesOpen;
  }

  /** E22.11: the game's stats for Settings › Game (numbers live in panels, never over the world). */
  statsHtml(): string {
    const s = this.sim.state.stats;
    const avg = s.chains ? (s.chainEffects / s.chains).toFixed(1) : '—';
    return iconize(
      `<p class="set-stats">Tiles restored: <b>${s.tilesRestored}</b> · Bloom chains: <b>${s.chains}</b> · Best: <b>×${s.maxCombo}</b> · Average: <b>${avg}</b><br>Drone jobs: <b>${s.droneJobs}</b> · Lucky Cats: <b>${s.catsFound}</b></p>` +
        `<details class="set-timings"><summary>Playtest timings</summary><pre class="ptime">${esc(this.sim.metrics.summary())}</pre></details>`,
    );
  }

  /** Phase 5 E15: the Lucky Cat discoveries (in the backpack since E22.11 moved Settings into the menu). */
  discoveriesHtml(): string {
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
    return `<h3 class="bp-h">🐱 Lucky Cat discoveries · ${d.found}</h3><div id="disc"><ul class="spots">${spots}</ul><div class="rws">${rewards}</div></div>`;
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
    html = this.hud.words(html);
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

  showFail(msg: string, x?: number, y?: number) {
    msg = this.hud.words(msg);
    const el = $(this.root, '#fail');
    el.innerHTML = iconize(esc(msg));
    el.style.display = 'block';
    const px = x !== undefined ? toHud(x) : hudWidth() / 2 - 100;
    const py = y !== undefined ? toHud(y) : hudHeight() - 160;
    el.style.left = `${Math.max(8, Math.min(hudWidth() - 290, px - 20))}px`;
    el.style.top = `${Math.max(8, py - 48)}px`;
    this.failTimer = 2.2;
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

  update(dt: number) {
    const s = this.sim;
    const cats = s.state.cat.found;
    this.set('catCount', $(this.root, '#catCount'), 'text', String(cats));
    if (cats > 0) $(this.root, '#catBtn').hidden = false;
    // Look 5.9: the house shows a badge while a landmark (or the fountain) is ready to wake; a tap then flies there.
    const wakeReady = s.state.progression.coreActivated ? s.areas.revealed().some((id) => s.areas.fog(id) !== 'cleared' && s.areas.ready(id)) : s.progression.coreReady();
    const homeB = $(this.root, '#homeBtn');
    this.set('homeReady', homeB, 'cls', wakeReady ? '1' : '0', 'ready');
    this.set('homeTitle', homeB, 'title', wakeReady ? 'A landmark is ready to wake: look at it from above' : 'Home (Home key)');

    if (this.failTimer > 0) {
      this.failTimer -= dt;
      if (this.failTimer <= 0) $(this.root, '#fail').style.display = 'none';
    }  }
}
