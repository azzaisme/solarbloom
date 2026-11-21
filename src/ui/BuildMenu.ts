import { type Bindings, SLOTS } from '../app/Bindings';
import { buildItems, buildTabs, type BuildItem, type BuildTabId, costWords, HOTBAR_DEFAULT, shortWords } from './BuildCatalog';
import { actionGlyph, keyGlyph, padGlyph, type GlyphStyle } from './Glyphs';
import { ICONS } from './Icons';
import { $, esc, HudPart } from './HudPart';
import type { Tool } from './Hud';
import { materialIcon } from './MaterialIcons';

/** E23.11: how long after a mouse click takes a piece the world ignores the mouse (the rest of a double click). */
const SWALLOW_MS = 450;

/**
 * E23.11 (#344): the build menu (BuildMenu.dc.html). Q, or Y on the pad, opens a sheet "Build" over the paused
 * world: tabs (LB / RB, Q / E) for the kinds of thing there are, a grid of cells (a locked one says who to wake),
 * and a detail pane with the recipe as chips ("1 of 2 Copper"), a line about it and its hotbar slot.
 *
 * Choosing: the d-pad or the arrow keys move between cells (PadFocus), and the cell under the focus is the one
 * shown. A (Enter) builds it: it goes into bloombot's hands and the menu closes. A mouse click selects; a double
 * click, or the Build button, takes it. Y (P) pins it to a hotbar slot: pick 1–9 and it replaces what is there.
 */
export class BuildMenu extends HudPart {
  private el!: HTMLElement;
  private cells!: HTMLElement;
  private detail!: HTMLElement;
  private tabsEl!: HTMLElement;
  private live!: HTMLElement;
  private items: BuildItem[] = [];
  private current: BuildTabId = 'machines';
  private sel?: Tool;
  /** picking a slot to pin the selected piece to */
  private picking = false;
  private style: GlyphStyle = 'keys';
  private b?: Bindings;
  /** which cell was selected when the mouse went down (a click on it takes it) */
  private downSel?: Tool;
  /** the slot button last focused while picking (the footer's "Pin here" pins there) */
  private pinAt = 0;

  wire() {
    const el = document.createElement('div');
    el.id = 'buildMenu';
    el.className = 'bm';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'bmTitle');
    el.innerHTML =
      `<div class="bm-veil" data-back></div>` +
      `<section class="bm-sheet">` +
      `<header class="bm-head"><span class="bm-badge" aria-hidden="true">${ICONS.build}</span><h2 id="bmTitle">Build</h2><span class="bm-grow"></span><button class="bm-act bm-back" data-back><span class="bm-g" data-g="back"></span>Back</button></header>` +
      `<div class="bm-tabrow"><span class="bm-g bm-bump" data-g="prev" aria-hidden="true"></span><div class="bm-tabs" role="tablist" aria-label="Kinds of build"></div><span class="bm-g bm-bump" data-g="next" aria-hidden="true"></span></div>` +
      `<div class="bm-body"><div class="bm-cells" id="bmCells" role="tabpanel"></div><aside class="bm-detail" id="bmDetail" aria-live="polite"></aside></div>` +
      `<footer class="bm-foot"><p class="bm-live" role="status" aria-live="polite"></p><span class="bm-grow"></span><button class="bm-act" data-do="take"><span class="bm-g" data-g="take"></span><span class="bm-al">Build</span></button><button class="bm-act" data-do="pin"><span class="bm-g" data-g="pin"></span><span class="bm-al">Pin to a slot</span></button><button class="bm-act" data-back><span class="bm-g" data-g="back"></span>Back</button></footer>` +
      `</section>`;
    this.root.appendChild(el);
    this.el = el;
    this.cells = $(el, '#bmCells');
    this.detail = $(el, '#bmDetail');
    this.tabsEl = $(el, '.bm-tabs');
    this.live = $(el, '.bm-live');
    el.addEventListener('click', (e) => this.click(e));
    this.cells.addEventListener('pointerdown', () => (this.downSel = this.sel));
    this.cells.addEventListener('dblclick', (e) => {
      if (this.isOpen && (e.target as HTMLElement).closest('[data-tool]')) this.take();
    });
    this.cells.addEventListener('focusin', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-tool]');
      if (c && c.dataset.tool !== this.sel) this.select(c.dataset.tool as Tool);
    });
    this.tabsEl.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      this.tab(e.key === 'ArrowRight' ? 1 : -1, true);
    });
    this.detail.addEventListener('focusin', (e) => {
      const p = (e.target as HTMLElement).closest<HTMLElement>('[data-pin]');
      if (p) this.pinAt = Number(p.dataset.pin);
    });
    // the number row pins straight to that slot while picking
    el.addEventListener('keydown', (e) => {
      const n = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code);
      if (!n || !this.picking) return;
      e.preventDefault();
      this.pin(Number(n[1]) - 1);
    });
  }

  get isOpen(): boolean {
    return !!this.el && !this.el.hidden;
  }

  /** Opens on the tab of the piece in hand, else the tab last used, else the first. */
  open(inHand?: Tool) {
    if (!this.el) return;
    this.items = buildItems(this.sim);
    const tabs = buildTabs(this.items);
    const held = this.items.find((i) => i.tool === inHand);
    this.current = held?.tab ?? (tabs.some((t) => t.id === this.current) ? this.current : (tabs[0]?.id ?? 'machines'));
    this.sel = held?.tool;
    this.picking = false;
    this.el.hidden = false;
    this.el.classList.add('open');
    this.say('');
    this.show(this.current);
    this.focusSel();
  }

  close() {
    if (!this.isOpen) return;
    this.picking = false;
    this.el.hidden = true;
    this.el.classList.remove('open');
    const a = document.activeElement as HTMLElement | null;
    if (a && this.el.contains(a)) a.blur(); // a shut menu keeps no focus: A and Space go back to the game
  }

  /** B / Esc: leaves the slot picker first, then the menu. */
  back() {
    if (this.picking) {
      this.picking = false;
      this.renderDetail();
      this.renderFoot();
      this.focusSel();
      return;
    }
    this.close();
  }

  /** LB / RB, Q / E: the next tab that has something in it. */
  tab(dir: number, focusTab = false) {
    const tabs = buildTabs(this.items);
    if (!tabs.length) return;
    const i = Math.max(0, tabs.findIndex((t) => t.id === this.current));
    this.picking = false;
    this.show(tabs[(i + dir + tabs.length) % tabs.length].id, focusTab);
    if (!focusTab) this.focusSel();
  }

  setKeys(style: GlyphStyle | undefined, b?: Bindings) {
    if (!b) return;
    this.style = style ?? 'keys';
    this.b = b;
    this.renderGlyphs();
    if (this.isOpen) {
      // the device changed with the menu open: redraw, keeping the focus where it was
      const a = document.activeElement as HTMLElement | null;
      const id = a?.id;
      const pinAt = a?.dataset?.pin;
      this.renderCells();
      this.renderDetail();
      const back = id ? this.el.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : pinAt !== undefined ? this.detail.querySelector<HTMLElement>(`[data-pin="${pinAt}"]`) : null;
      back?.focus({ focusVisible: true } as FocusOptions);
    }
  }

  /** Y / P: pick a slot for the piece shown. */
  startPin() {
    const it = this.selected();
    if (!it) return;
    if (it.locked) {
      this.say(`${it.name} is locked: ${it.lockText}.`);
      return;
    }
    this.picking = true;
    this.renderDetail();
    this.renderFoot();
    const slots = this.slots();
    const at = slots.indexOf(it.tool);
    const first = at >= 0 ? at : Math.max(0, slots.indexOf(''));
    this.pinAt = first;
    this.detail.querySelector<HTMLElement>(`[data-pin="${first}"]`)?.focus({ focusVisible: true } as FocusOptions);
  }

  /** Puts the piece shown in a slot (replacing what was there; it leaves any other slot it was in). */
  pin(i: number) {
    const it = this.selected();
    if (!it || i < 0 || i > 8) return;
    const slots = this.slots().map((t) => (t === it.tool ? '' : t));
    const was = slots[i];
    slots[i] = it.tool;
    this.cb.setHotbar(slots);
    this.picking = false;
    const wasItem = was ? this.items.find((x) => x.tool === was) : undefined;
    this.say(`${it.name} is on slot ${i + 1}${wasItem ? ` instead of the ${wasItem.name}` : ''}.`);
    this.renderCells();
    this.renderDetail();
    this.renderFoot();
    this.focusSel();
  }

  /** A: the piece shown goes into bloombot's hands and the menu closes (not when it can't be built yet). */
  take() {
    const it = this.selected();
    if (!it) return;
    if (it.locked) {
      this.say(`${it.name} is locked: ${it.lockText}.`);
      return;
    }
    if (!it.affordable) {
      this.say(`Not enough to build the ${it.name} yet. ${shortWords(it.cost)}`);
      return;
    }
    this.close();
    this.cb.selectTool(it.tool);
  }

  // ───────── drawing ─────────

  private slots(): string[] {
    const h = this.settings.hotbar ?? HOTBAR_DEFAULT;
    return Array.from({ length: 9 }, (_, i) => h[i] ?? '');
  }

  private selected(): BuildItem | undefined {
    return this.items.find((i) => i.tool === this.sel);
  }

  private say(text: string) {
    if (this.live) this.live.textContent = text;
  }

  private glyph(which: 'take' | 'pin' | 'back' | 'prev' | 'next'): string {
    const b = this.b;
    if (!b) return '';
    const pad = this.style !== 'keys';
    if (which === 'take') return pad ? padGlyph(this.style as Exclude<GlyphStyle, 'keys'>, 0) : keyGlyph('Enter');
    if (which === 'pin') return actionGlyph(b, 'pinSlot', this.style);
    if (which === 'back') return pad ? actionGlyph(b, 'cancel', this.style) : keyGlyph('Escape');
    return actionGlyph(b, which === 'prev' ? 'prevTab' : 'nextTab', this.style);
  }

  private renderGlyphs() {
    if (!this.el) return;
    for (const g of this.el.querySelectorAll<HTMLElement>('[data-g]')) g.innerHTML = this.glyph(g.dataset.g as 'take');
  }

  private show(tab: BuildTabId, focusTab = false) {
    this.current = tab;
    const tabs = buildTabs(this.items);
    this.tabsEl.innerHTML = tabs
      .map((t) => `<button role="tab" id="bmtab-${t.id}" data-tab="${t.id}" aria-controls="bmCells" aria-selected="${t.id === tab}" tabindex="${t.id === tab ? 0 : -1}"${t.id === tab ? ' class="on"' : ''}>${t.id === tab ? `<span class="bm-tic" aria-hidden="true">${ICONS[t.icon]}</span>` : ''}${t.label}</button>`)
      .join('');
    this.cells.setAttribute('aria-labelledby', `bmtab-${tab}`);
    const inTab = this.items.filter((i) => i.tab === tab);
    if (!inTab.some((i) => i.tool === this.sel)) this.sel = (inTab.find((i) => !i.locked) ?? inTab[0])?.tool;
    this.renderCells();
    this.renderDetail();
    this.renderFoot();
    this.renderGlyphs();
    if (focusTab) this.tabsEl.querySelector<HTMLElement>('[aria-selected=true]')?.focus({ focusVisible: true } as FocusOptions);
  }

  private focusSel() {
    const c = this.sel ? this.cells.querySelector<HTMLElement>(`[data-tool="${CSS.escape(this.sel)}"]`) : undefined;
    (c ?? this.cells.querySelector<HTMLElement>('[data-tool]'))?.focus({ focusVisible: true } as FocusOptions);
  }

  private select(t: Tool) {
    this.sel = t;
    this.picking = false;
    for (const c of this.cells.querySelectorAll<HTMLElement>('[data-tool]')) c.classList.toggle('sel', c.dataset.tool === t);
    this.renderDetail();
    this.renderFoot();
  }

  private renderCells() {
    const slots = this.slots();
    this.cells.innerHTML = this.items
      .filter((i) => i.tab === this.current)
      .map((i) => {
        const at = slots.indexOf(i.tool);
        const note = i.locked ? `<span class="bm-why">${esc(i.lockText ?? '')}</span>` : at >= 0 ? `<span class="bm-slot">Slot ${at + 1}</span>` : '';
        const label = `${i.name}${i.locked ? `, locked: ${i.lockText}` : at >= 0 ? `, on hotbar slot ${at + 1}` : ''}${!i.locked && !i.affordable ? ', not enough yet' : ''}`;
        return `<button class="bm-card t-${i.tab}${i.tool === this.sel ? ' sel' : ''}${i.locked ? ' locked' : ''}${!i.locked && !i.affordable ? ' short' : ''}" id="bm-${esc(i.tool.replace(':', '-'))}" data-tool="${esc(i.tool)}" aria-label="${esc(label)}"${i.locked ? ' aria-disabled="true"' : ''}><span class="bm-ic" aria-hidden="true">${i.locked ? ICONS.lock : i.icon}</span><span class="bm-nm">${esc(i.name)}</span>${note}</button>`;
      })
      .join('');
  }

  private renderDetail() {
    const it = this.selected();
    if (!it) {
      this.detail.innerHTML = `<p class="bm-line">Nothing to build here yet.</p>`;
      return;
    }
    const chips = it.cost.length
      ? `<div class="bm-label">You need</div><div class="bm-chips">${it.cost.map((c) => `<span class="bm-chip ${c.have >= c.need ? 'ok' : 'need'}">${materialIcon(c.id as never, 18)}${esc(costWords(c))}</span>`).join('')}</div>`
      : `<div class="bm-label">You need</div><div class="bm-chips"><span class="bm-chip ok">Nothing: free to place</span></div>`;
    const short = it.locked ? `<p class="bm-warn">${esc(it.lockText ?? '')} to build it.</p>` : !it.affordable ? `<p class="bm-warn">${esc(shortWords(it.cost))}</p>` : '';
    const slots = this.slots();
    const at = slots.indexOf(it.tool);
    let foot: string;
    if (this.picking) {
      foot =
        `<div class="bm-label" id="bmPickLabel">Pick a slot for the ${esc(it.name)}</div>` +
        `<div class="bm-pick" role="group" data-pad-trap aria-labelledby="bmPickLabel">${slots
          .map((t, i) => {
            const there = t ? this.items.find((x) => x.tool === t) : undefined;
            const what = there ? there.name : t ? 'something' : 'empty';
            return `<button class="bm-pslot${t === it.tool ? ' here' : ''}${t ? '' : ' empty'}" data-pin="${i}" aria-label="Slot ${i + 1}, ${esc(what)}"><span class="bm-pn">${i + 1}</span><span class="bm-pi" aria-hidden="true">${there ? (there.locked ? ICONS.lock : there.icon) : ''}</span></button>`;
          })
          .join('')}</div>`;
    } else {
      const key = at >= 0 && this.style === 'keys' && this.b ? actionGlyph(this.b, SLOTS[at], 'keys') : `<span class="bm-n">${at + 1}</span>`;
      foot = at >= 0 ? `<div class="bm-onbar">${key}<span>On your hotbar, slot ${at + 1}</span></div>` : `<div class="bm-onbar off"><span>Not on your hotbar</span></div>`;
    }
    this.detail.innerHTML =
      `<div class="bm-dhead"><span class="bm-dic t-${it.tab}" aria-hidden="true">${it.locked ? ICONS.lock : it.icon}</span><div><h3 class="bm-dname">${esc(it.name)}</h3><div class="bm-kind">${esc(it.kind)}</div></div></div>` +
      `<p class="bm-line">${esc(it.line)}</p>${chips}${short}<span class="bm-grow"></span>${foot}`;
  }

  /** The footer: Build dims with its reason, and while picking a slot it reads Pin here / Cancel. */
  private renderFoot() {
    const it = this.selected();
    const take = $(this.el, '[data-do="take"]');
    const pin = $(this.el, '[data-do="pin"]');
    const can = !!it && !it.locked && it.affordable;
    take.classList.toggle('dim', !can);
    take.setAttribute('aria-disabled', String(!can));
    $(take, '.bm-al').textContent = this.picking ? 'Pin here' : 'Build';
    pin.hidden = this.picking;
    pin.classList.toggle('dim', !it || it.locked);
    pin.setAttribute('aria-disabled', String(!it || it.locked));
    take.title = !it ? '' : it.locked ? `${it.lockText} first` : !it.affordable ? shortWords(it.cost) : '';
  }

  private click(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('[data-back]')) return this.cb.buildAct('cancel');
    const tab = t.closest<HTMLElement>('[data-tab]');
    if (tab) {
      this.picking = false;
      return this.show(tab.dataset.tab as BuildTabId, true);
    }
    const p = t.closest<HTMLElement>('[data-pin]');
    if (p) return this.pin(Number(p.dataset.pin));
    const d = t.closest<HTMLElement>('[data-do]');
    if (d?.dataset.do === 'pin') return this.startPin();
    if (d?.dataset.do === 'take') {
      if (this.picking) return this.pin(this.pinAt);
      this.take();
      if (e.detail > 0 && !this.isOpen) this.swallowFollowUp();
      return;
    }
    const c = t.closest<HTMLElement>('[data-tool]');
    if (!c) return;
    const tool = c.dataset.tool as Tool;
    // The keyboard and the pad press a cell (no pointer: detail 0): that builds it. A mouse click selects it, and a
    // second click (or a double click) on the one already shown builds it.
    if (e.detail === 0 || this.downSel === tool) {
      this.take();
      if (e.detail > 0 && !this.isOpen) this.swallowFollowUp();
    } else this.select(tool);
    this.downSel = undefined;
  }

  /**
   * A mouse click that takes a piece closes the menu under the pointer: the rest of that double click (or a quick
   * second click) must not fall through to the world, where it would build the piece at once wherever the pointer is.
   */
  private swallowFollowUp() {
    const stop = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const evs = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'];
    for (const ev of evs) window.addEventListener(ev, stop, true);
    setTimeout(() => {
      for (const ev of evs) window.removeEventListener(ev, stop, true);
    }, SWALLOW_MS);
  }
}
