import type { AreaMode, ComponentId, MachineData } from '../core/types';
import { MACHINES, TIER2, TIER3 } from '../data/machines';
import { ICONS, iconize } from './Icons';
import { $, esc, HudPart } from './HudPart';
import { hudHeight, hudWidth, toHud } from './UiScale';
import type { PlotPickerHandlers, PlotPickerModel } from './Hud';
import { barHtml, fillGlyphs, setPanelGlyphs, wireBar } from './PanelShell';

/**
 * E22.5 (#342): the panels the HUD opens over the world: the plot picker, a machine's inspect panel, the Lucky Cat's
 * reward card, the hover tooltip and the "can't do that" note.
 *
 * E23.11 (Sunlit Glass): #inspect and the plot picker are machine cards docked on the right (the world stays in
 * view), each ending in an action bar with the device's glyphs. This part also keeps every panel's glyphs on the
 * device in hand (`setPanelGlyphs`, from the HUD's glyph set and bindings, checked each frame).
 */
export class Panels extends HudPart {
  private failTimer = 0;

  wire() {
    const r = this.root;
    $(r, '#catPanel button').addEventListener('click', () => ($(r, '#catPanel').hidden = true));
    $(r, '#inspect').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) this.cb.closeInspect();
      const w = t.closest<HTMLButtonElement>('[data-wake]');
      if (w && !w.disabled) this.cb.wake(w.dataset.wake!);
      const rl = t.closest<HTMLButtonElement>('[data-role]');
      if (rl && !rl.disabled) this.cb.chooseRole(rl.dataset.role!);
      // E23.6.5: what an Assembler makes
      const as = t.closest<HTMLButtonElement>('[data-asm]');
      if (as) {
        const [id, recipe] = as.dataset.asm!.split('|');
        const m = this.sim.machine(id);
        if (m) this.sim.automation.setRecipe(m, (recipe || undefined) as ComponentId | undefined);
      }
      // E23.6.5: which crate beside it an Assembler takes from or puts in (steps through the crates beside it)
      const io = t.closest<HTMLButtonElement>('[data-asm-io]');
      if (io) {
        const [id, which] = io.dataset.asmIo!.split('|');
        const m = this.sim.machine(id);
        if (m) this.sim.automation.nextCrate(m, which as 'input' | 'output');
      }
      const am = t.closest<HTMLButtonElement>('[data-area-mode]');
      if (am) {
        const [id, mode] = am.dataset.areaMode!.split('|');
        this.cb.setAreaMode(id, (mode || undefined) as AreaMode | undefined);
      }
    });
    $(r, '#plotPicker h2 button').addEventListener('click', () => this.closePlotPicker());
    // the machine cards: docked right, an action bar at the foot
    const insp = $(r, '#inspect');
    insp.classList.add('side');
    insp.setAttribute('role', 'region');
    insp.setAttribute('aria-label', 'Details');
    wireBar(insp);
    const pp = $(r, '#plotPicker');
    pp.classList.remove('drawer');
    pp.classList.add('side');
    pp.setAttribute('role', 'dialog');
    const foot = document.createElement('footer');
    foot.className = 'sheet-foot';
    foot.innerHTML = `<span class="pn-acts">${barHtml([
      { press: 'choose', label: 'Choose' },
      { press: 'back', label: 'Back' },
    ])}</span>`;
    pp.appendChild(foot);
    wireBar(pp, (p) => {
      if (p !== 'back') return false;
      this.closePlotPicker();
      return true;
    });
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
      const tag = c.solid ? 'Blocks the way' : 'Walk over it';
      if (!c.unlocked) return `<div class="pp-opt locked"><span class="ci">${c.icon}</span><span class="cn">${esc(c.name)}</span><span class="cd2">Unlocks when ${esc(c.hint ?? '')}</span></div>`;
      const on = c.id === m.current;
      return `<button class="pp-opt${on ? ' on' : ''}" data-opt="${c.id}" aria-pressed="${on}"><span class="ci">${c.icon}</span><span class="cn">${esc(c.name)}${c.fresh ? '<em class="pp-new">New</em>' : ''}${on ? '<em>Chosen</em>' : ''}</span><span class="cd2">${esc(c.blurb)} <i>${tag}</i></span></button>`;
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
      `<p class="set-stats">Patches of ground turned green: <b>${s.tilesRestored}</b> · Times the flowers spread: <b>${s.chains}</b> · Most flowers in one go: <b>${s.maxCombo}</b> · Flowers each time, on average: <b>${avg}</b><br>Jobs done by drones: <b>${s.droneJobs}</b>${this.sim.cat.known ? ` · Lucky Cats: <b>${s.catsFound}</b>` : ''}</p>` + // E23.12.3: no cat line before one is found
        // the playtest timings are a developer's: only with the developer numbers (F3) on
        (this.settings.debug ? `<details class="set-timings"><summary>Playtest timings</summary><pre class="ptime">${esc(this.sim.metrics.summary())}</pre></details>` : ''),
    );
  }

  /** the last tip shown (screen point and text), to place it again when the UI scale changes */
  private lastTip?: [number, number, string];

  /** #599: the UI scale changed: the tip finds its place again at once (clear of the prompt and the dock). */
  replaceTip() {
    const tip = this.root.querySelector<HTMLElement>('#tip');
    if (this.lastTip && tip && tip.style.display !== 'none') this.showTip(...this.lastTip);
  }

  showTip(x: number, y: number, html: string) {
    this.lastTip = [x, y, html];
    html = this.hud.words(html);
    const tip = $(this.root, '#tip');
    this.set('tip', tip, 'html', html);
    tip.style.display = 'block';
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const px = Math.min(hudWidth() - w - 8, toHud(x) + 18);
    let py = Math.max(8, Math.min(hudHeight() - h - 90, toHud(y) + 18));
    // #599: never over the prompt (and its cost chips), "Stop building" or the build dock: above them instead
    // (lowest first, and twice round: rising above one can land it on the next)
    for (const sel of ['#buildbar', '#buildStop', '#prompt', '#buildbar', '#buildStop', '#prompt']) {
      const e = this.root.querySelector<HTMLElement>(sel);
      const r = e && !e.hidden && e.getClientRects().length ? e.getBoundingClientRect() : undefined;
      if (!r || !r.width || !r.height) continue;
      const [l, t, rt, b] = [toHud(r.left), toHud(r.top), toHud(r.right), toHud(r.bottom)];
      if (px < rt && px + w > l && py < b && py + h > t) py = Math.max(8, t - h - 8);
    }
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
    // the panel redraws as the world runs (a drone's status, a craft's progress): the button in focus keeps it, so
    // the arrow keys and the d-pad don't lose their place (E23.6.4: a hub's roles, an Assembler's recipe)
    const a = document.activeElement as HTMLElement | null;
    const key = a && a !== el && el.contains(a) ? focusKey(a) : undefined;
    // a card's buttons (wake, the drones' modes, a role) are chosen with Enter / A; Esc / B closes it
    const acts = /<button(?![^>]*data-close)/.test(html) ? [{ press: 'choose' as const, label: 'Choose' }] : [];
    const bar = barHtml([...acts, { press: 'back', label: 'Close' }]);
    const full = `<div class="side-body">${html}</div><footer class="sheet-foot"><span class="pn-acts">${bar}</span></footer>`;
    if (this.last.get('inspect') === full) return;
    this.set('inspect', el, 'html', full);
    fillGlyphs(el);
    if (key && !el.contains(document.activeElement)) el.querySelector<HTMLElement>(key)?.focus({ focusVisible: true } as FocusOptions);
  }

  machineHtml(m: MachineData, extra: string): string {
    const def = MACHINES[m.type];
    const tier = m.tier ?? 1;
    const t3 = tier >= 3 ? TIER3[m.type] : undefined;
    const t2 = tier === 2 ? TIER2[m.type] : undefined;
    const name = t3?.name ?? t2?.name ?? def.name;
    const icon = t3?.icon ?? t2?.icon ?? def.icon;
    const blurb = t3 ? `A big machine, nine joined into one: ${t3.blurb}.` : t2 ? `Three joined into one: ${t2.blurb}. ${def.blurb}` : def.blurb;
    return `<h4><span>${icon} ${esc(name)}${m.starter ? ' <small class="dim">(here from the start)</small>' : ''}</span><button data-close aria-label="Close">×</button></h4><p>${esc(blurb)}</p>${extra}`;
  }

  private glyphKey = '';

  update(dt: number) {
    // every panel's glyphs follow the device in hand and the bindings (Back, the tab buttons)
    const st = this.hud.glyphStyle;
    const b = this.hud.bindings;
    const key = `${st}|${b ? `${b.keys.prevTab}|${b.keys.nextTab}|${b.pad.prevTab}|${b.pad.nextTab}|${b.pad.cancel}|${b.pad.menu}` : ''}`;
    if (key !== this.glyphKey) {
      this.glyphKey = key;
      setPanelGlyphs(st, b);
    }
    if (this.failTimer > 0) {
      this.failTimer -= dt;
      if (this.failTimer <= 0) $(this.root, '#fail').style.display = 'none';
    }  }
}

/** A selector that finds the same control after a redraw: its id, or its first data-* attribute. */
function focusKey(e: HTMLElement): string | undefined {
  if (e.id) return `#${CSS.escape(e.id)}`;
  const d = [...e.attributes].find((x) => x.name.startsWith('data-'));
  return d ? `[${d.name}="${CSS.escape(d.value)}"]` : undefined;
}
