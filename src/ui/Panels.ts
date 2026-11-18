import type { AreaMode, MachineData } from '../core/types';
import { MACHINES, TIER2, TIER3 } from '../data/machines';
import { ICONS, iconize } from './Icons';
import { $, esc, HudPart } from './HudPart';
import { hudHeight, hudWidth, toHud } from './UiScale';
import type { PlotPickerHandlers, PlotPickerModel } from './Hud';

/**
 * E22.5 (#342): the panels the HUD opens over the world: the plot picker, a machine's inspect panel, the Lucky Cat's reward card, the welcome card,
 * the hover tooltip and the "can't do that" note, and the classic quick chips (home, cats, paw prints).
 */
export class Panels extends HudPart {
  private failTimer = 0;

  wire() {
    const r = this.root;
    $(r, '#catBtn').addEventListener('click', () => this.hud.backpack.open('collection'));
    $(r, '#pawBtn').addEventListener('click', () => this.cb.findCat());
    $(r, '#homeBtn').addEventListener('click', () => this.cb.goHome($(r, '#homeBtn').classList.contains('ready')));
    $(r, '#catPanel button').addEventListener('click', () => ($(r, '#catPanel').hidden = true));
    $(r, '#introGo').addEventListener('click', () => {
      $(r, '#intro').hidden = true;
      this.sim.state.progression.introSeen = true;
    });
    $(r, '#inspect').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) this.cb.closeInspect();
      const w = t.closest<HTMLButtonElement>('[data-wake]');
      if (w && !w.disabled) this.cb.wake(w.dataset.wake!);
      const db = t.closest<HTMLButtonElement>('[data-district]');
      if (db && !db.disabled) this.cb.districtBloom(db.dataset.district!, db.dataset.replay === '1');
      const rl = t.closest<HTMLButtonElement>('[data-role]');
      if (rl && !rl.disabled) this.cb.chooseRole(rl.dataset.role!);
      const am = t.closest<HTMLButtonElement>('[data-area-mode]');
      if (am) {
        const [id, mode] = am.dataset.areaMode!.split('|');
        this.cb.setAreaMode(id, (mode || undefined) as AreaMode | undefined);
      }
    });
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

  private picker?: PlotPickerHandlers;
  /**
   * E19.1.2 (#248): the plot picker. Unlocked options are buttons (mouse, keys and the pad's focus ring); focusing
   * or hovering one previews it on the plot, choosing it keeps it, and closing without choosing puts the plot back.
   * Locked options show what they wait for. Choosing and changing are free.
   */
  openPlotPicker(m: PlotPickerModel, h: PlotPickerHandlers) {
    this.hud.toggleBackpack(false);
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

  /** E22.11: the game's stats for Settings › Game (numbers live in panels, never over the world). */
  statsHtml(): string {
    const s = this.sim.state.stats;
    const avg = s.chains ? (s.chainEffects / s.chains).toFixed(1) : '—';
    return iconize(
      `<p class="set-stats">Tiles restored: <b>${s.tilesRestored}</b> · Bloom chains: <b>${s.chains}</b> · Best: <b>×${s.maxCombo}</b> · Average: <b>${avg}</b><br>Drone jobs: <b>${s.droneJobs}</b> · Lucky Cats: <b>${s.catsFound}</b></p>` +
        `<details class="set-timings"><summary>Playtest timings</summary><pre class="ptime">${esc(this.sim.metrics.summary())}</pre></details>`,
    );
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
