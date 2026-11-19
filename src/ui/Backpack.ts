import type { ItemId } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { blueprintRows, collection, itemCells, journalPages, oneOffItems, pinRequest, requestRows, TABS, type TabId } from './BackpackModel';
import { materialIcon } from './MaterialIcons';
import './backpack.css';

/**
 * E22.6 (#343): the backpack. One full-screen panel with tabs Items, Requests, Journal, Collection, Blueprints;
 * the game pauses while it is open. LB / RB or Q / E change tab, arrows or the d-pad move the focus ring, Enter
 * or A press, Esc or B close.
 *
 * - Items: a grid of materials, each with its own shape as well as colour, its name in text and "32 / 40". The
 *   one in focus shows where it comes from, what needs it next and how many are in the store. Opened at a store
 *   (the fountain, a chest, a woken landmark) it is the storage panel: the same grid with both counts and move
 *   1 / 10 / a stack, and "Deposit everything".
 * - Requests: every open request with its Keeper and region; pressing one pins it to the objective card.
 * - Journal: the pages in book order, gaps for the ones not found. Collection: cats, keepsakes, wildlife,
 *   landmarks, plots and decorations. Blueprints: found and not.
 *
 * Enter or A on a material steps into its move buttons. Text is 16 px or more, every control has a visible focus ring and a screen-reader label ("Copper, 32 of 40 in
 * backpack, 110 in store"), moves are announced ("Deposited 32 Copper"), and nothing depends on colour or time.
 */
export interface BackpackHost {
  sim: Sim;
  /** something changed that the rest of the HUD shows (a pin, a move) */
  changed?(): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Backpack {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private tabs: HTMLElement;
  private live: HTMLElement;
  private titleEl: HTMLElement;
  current: TabId = 'items';
  /** the storage panel's title while opened at a store */
  private storage?: string;
  private selMat: ItemId = 'scrap';
  private selPage?: string;

  constructor(
    parent: HTMLElement,
    private host: BackpackHost,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'bpScreen';
    this.el.className = 'screen';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'bpTitle');
    this.el.innerHTML =
      `<div class="panel screen-card bp-card"><header class="screen-head"><h2 id="bpTitle">Backpack</h2><button class="screen-back" data-back>Back</button></header>` +
      `<div class="tabs" role="tablist" aria-label="Backpack sections">${TABS.map((t) => `<button role="tab" id="bptab-${t.id}" data-tab="${t.id}" aria-controls="bpBody" aria-selected="false" tabindex="-1">${t.label}</button>`).join('')}</div>` +
      `<div class="screen-body bp-body" id="bpBody" role="tabpanel"></div><p class="bp-live" role="status" aria-live="polite"></p></div>`;
    parent.appendChild(this.el);
    this.body = this.el.querySelector<HTMLElement>('#bpBody')!;
    this.tabs = this.el.querySelector<HTMLElement>('.tabs')!;
    this.live = this.el.querySelector<HTMLElement>('.bp-live')!;
    this.titleEl = this.el.querySelector<HTMLElement>('#bpTitle')!;
    this.el.hidden = true;
    this.el.querySelector('[data-back]')!.addEventListener('click', () => this.close());
    this.tabs.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (t) this.show(t.dataset.tab as TabId, true);
    });
    this.tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      this.tab(e.key === 'ArrowRight' ? 1 : -1, true);
    });
    this.body.addEventListener('click', (e) => this.click(e.target as HTMLElement));
    // the cell or page in focus is the one shown beside the list (keyboard and pad read by moving)
    this.body.addEventListener('focusin', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-mat], [data-page]');
      if (!t) return;
      if (t.dataset.mat && t.dataset.mat !== this.selMat) {
        this.selMat = t.dataset.mat as ItemId;
        this.select();
      } else if (t.dataset.page && t.dataset.page !== this.selPage) {
        this.selPage = t.dataset.page;
        this.select();
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Opens the backpack; with `storage` it is the storage panel (the Items grid with the store beside it). */
  open(tab: TabId = this.current, storage?: string) {
    this.storage = storage;
    this.titleEl.textContent = storage ?? 'Backpack';
    this.el.hidden = false;
    this.el.classList.add('open');
    this.say('');
    this.show(storage ? 'items' : tab, true);
    if (storage) this.body.querySelector<HTMLElement>('.bp-cell')?.focus({ focusVisible: true } as FocusOptions);
  }

  /** E23.9.1: opens the journal at a page (a page just read from its post). */
  openPage(id: string) {
    this.selPage = id;
    this.open('journal');
  }

  close() {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.el.classList.remove('open');
    this.storage = undefined;
  }

  tab(dir: number, focusTab = false) {
    const i = TABS.findIndex((t) => t.id === this.current);
    this.show(TABS[(i + dir + TABS.length) % TABS.length].id, focusTab);
  }

  show(tab: TabId, focusTab = false) {
    this.current = tab;
    for (const b of this.tabs.querySelectorAll<HTMLElement>('[data-tab]')) {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focusTab) b.focus({ focusVisible: true } as FocusOptions);
    }
    this.body.setAttribute('aria-labelledby', `bptab-${tab}`);
    this.body.innerHTML = this[tab]();
  }

  /** Redraws the open tab, keeping the focus on the same control. */
  refresh() {
    if (!this.isOpen) return;
    const id = (document.activeElement as HTMLElement | null)?.id;
    this.body.innerHTML = this[this.current]();
    if (id) this.body.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.focus({ focusVisible: true } as FocusOptions);
  }

  private say(text: string) {
    this.live.textContent = text;
  }

  // ───────── Items (and the storage panel) ─────────

  private items(): string {
    const sim = this.host.sim;
    const cells = itemCells(sim);
    if (!cells.length) return `<p class="bp-empty">There is nothing to carry in this garden. Materials belong to the Old City.</p>`;
    const store = !!this.storage;
    const grid = cells
      .map(
        (c) =>
          `<button class="bp-cell${c.seen ? '' : ' unseen'}" role="option" id="bpmat-${c.id}" data-mat="${c.id}" aria-selected="${c.id === this.selMat}" aria-label="${esc(c.label)}">` +
          `${materialIcon(c.seen ? c.id : 'unknown', 40)}<span class="bp-name">${esc(c.name)}</span><span class="bp-count">${c.seen ? `${c.count} / ${c.limit}` : ''}</span>${store && c.seen ? `<span class="bp-stored">Store ${c.stored}</span>` : ''}</button>`,
      )
      .join('');
    const extra = oneOffItems(sim);
    const row = extra.length ? `<h3 class="set-h">Special things</h3><ul class="bp-special">${extra.map((i) => `<li><b>${esc(i.name)}</b> <span>${esc(i.from)}</span></li>`).join('')}</ul>` : '';
    return `<div class="bp-split"><div><div class="bp-grid" role="listbox" aria-label="Materials" aria-orientation="horizontal">${grid}</div>${row}</div><div class="bp-detail" id="bpDetail">${this.detail()}</div></div>`;
  }

  private detail(): string {
    const sim = this.host.sim;
    const c = itemCells(sim).find((x) => x.id === this.selMat);
    if (!c) return '';
    if (!c.seen) return `<h3>${materialIcon('unknown', 28)} Not found yet</h3><p>${esc(c.from)}.</p>`;
    const near = sim.inventory.nearStore();
    const room = sim.inventory.room(c.id);
    const btn = (act: string, n: string, label: string, ok: boolean, aria: string) => `<button id="bp-${act}-${n}" data-move="${act}" data-n="${n}" aria-label="${esc(aria)}" ${ok ? '' : 'aria-disabled="true"'}>${label}</button>`;
    const canPut = near && c.count > 0;
    const canTake = near && c.stored > 0 && room > 0;
    const moves =
      `<h4 id="bpPutH">Put in the store</h4><div class="bp-moves" role="group" aria-labelledby="bpPutH">${btn('put', '1', '1', canPut, `Put 1 ${c.name} in the store`)}${btn('put', '10', '10', canPut, `Put 10 ${c.name} in the store`)}${btn('put', 'stack', 'All of it', canPut, `Put all your ${c.name} in the store`)}</div>` +
      `<h4 id="bpTakeH">Take from the store</h4><div class="bp-moves" role="group" aria-labelledby="bpTakeH">${btn('takeOut', '1', '1', canTake, `Take 1 ${c.name} from the store`)}${btn('takeOut', '10', '10', canTake, `Take 10 ${c.name} from the store`)}${btn('takeOut', 'stack', 'A stack', canTake, `Take a stack of ${c.name} from the store`)}</div>` +
      `<div class="bp-moves">${btn('depositAll', 'all', 'Deposit everything', near && itemCells(sim).some((x) => x.count > 0), 'Put everything you carry in the store')}</div>`;
    return (
      `<h3>${materialIcon(c.id, 28)} ${esc(c.name)}</h3>` +
      `<dl><dt>In your backpack</dt><dd>${c.count} of ${c.limit}</dd><dt>In the store</dt><dd>${c.stored}</dd><dt>Where it comes from</dt><dd>${esc(c.from)}</dd><dt>What needs it next</dt><dd>${esc(c.next)}</dd></dl>` +
      moves +
      (near ? '' : `<p class="bp-note">Stand by the fountain, a chest or a woken landmark to move things to and from the store.</p>`)
    );
  }

  /** Shows the selection without rebuilding the list (the focus stays where it is). */
  private select() {
    for (const b of this.body.querySelectorAll<HTMLElement>('[data-mat]')) b.setAttribute('aria-selected', String(b.dataset.mat === this.selMat));
    for (const b of this.body.querySelectorAll<HTMLElement>('[data-page]')) b.setAttribute('aria-selected', String(b.dataset.page === this.selPage));
    const d = this.body.querySelector<HTMLElement>('#bpDetail');
    if (d) d.innerHTML = this.current === 'journal' ? this.pageText() : this.detail();
  }

  private move(act: string, n: string) {
    const sim = this.host.sim;
    const inv = sim.inventory;
    const name = itemCells(sim).find((c) => c.id === this.selMat)?.name ?? '';
    if (!inv.nearStore()) return this.say('Stand by the fountain, a chest or a woken landmark to move things.');
    let done = 0;
    if (act === 'depositAll') {
      done = inv.depositAll();
      this.say(done ? `Deposited everything: ${done} things` : 'Nothing to deposit');
    } else if (act === 'put') {
      done = inv.deposit(this.selMat, n === 'stack' ? undefined : Number(n));
      this.say(done ? `Deposited ${done} ${name}` : `No ${name} to deposit`);
    } else {
      done = inv.withdraw(this.selMat, n === 'stack' ? undefined : Number(n));
      this.say(done ? `Took ${done} ${name}` : `No room for more ${name}`);
    }
    this.host.changed?.();
    this.refresh();
  }

  // ───────── Requests ─────────

  private requests(): string {
    const rows = requestRows(this.host.sim);
    if (!rows.length) return `<p class="bp-empty">No requests yet. Wake a Keeper and it will ask for help.</p>`;
    return (
      `<p class="bp-help">Press a request to pin it to the top of the screen.</p><ul class="bp-list">` +
      rows.map((r) => `<li><button class="bp-req" id="bpreq-${r.id}" data-pin="${r.id}" aria-pressed="${r.pinned}"><b>${esc(r.keeper)}</b> <span class="bp-where">${esc(r.region)}</span><span class="bp-text">${esc(r.text)}</span>${r.pinned ? '<em class="bp-pin">Pinned</em>' : ''}</button></li>`).join('') +
      `</ul>`
    );
  }

  // ───────── Journal ─────────

  private journal(): string {
    const pages = journalPages(this.host.sim);
    const found = pages.filter((p) => p.found).length;
    this.selPage ??= pages.find((p) => p.found)?.id ?? pages[0]?.id;
    return (
      `<div class="bp-split"><div><p class="bp-help">${found} of ${pages.length} pages found.</p><div class="bp-pages" role="listbox" aria-label="Journal pages">` +
      pages.map((p) => `<button class="bp-page${p.found ? '' : ' unseen'}" role="option" id="bppage-${p.id}" data-page="${p.id}" aria-selected="${p.id === this.selPage}" aria-label="Page ${p.n}: ${esc(p.title)}"><span class="bp-pn">${p.n}</span> ${esc(p.title)}</button>`).join('') +
      `</div></div><div class="bp-detail" id="bpDetail">${this.pageText()}</div></div>`
    );
  }

  private pageText(): string {
    const p = journalPages(this.host.sim).find((x) => x.id === this.selPage);
    return p ? `<h3>Page ${p.n}: ${esc(p.title)}</h3><p class="bp-prose">${esc(p.text)}</p>` : '';
  }

  // ───────── Collection ─────────

  private collection(): string {
    return collection(this.host.sim)
      .map(
        (g, i) =>
          `<section class="bp-group" tabindex="0" role="group" aria-labelledby="bpg-${i}"><h3 id="bpg-${i}">${esc(g.title)} <span class="bp-gcount">${esc(g.count)}</span></h3>` +
          (g.rows.length ? `<ul>${g.rows.map((r) => `<li class="${r.found ? '' : 'unseen'}"><b>${esc(r.name)}</b> <span>${esc(r.detail)}</span></li>`).join('')}</ul>` : `<p class="bp-empty">${esc(g.empty)}</p>`) +
          `</section>`,
      )
      .join('');
  }

  // ───────── Blueprints ─────────

  private blueprints(): string {
    const rows = blueprintRows(this.host.sim);
    return `<section class="bp-group" tabindex="0" role="group" aria-labelledby="bpbh"><h3 id="bpbh">Blueprints <span class="bp-gcount">${rows.filter((r) => r.found).length} of ${rows.length}</span></h3><ul>${rows.map((r) => `<li class="${r.found ? '' : 'unseen'}"><b>${esc(r.name)}</b> <span>${esc(r.where)}</span></li>`).join('')}</ul></section>`;
  }

  private click(t: HTMLElement) {
    const mv = t.closest<HTMLElement>('[data-move]');
    if (mv) return mv.getAttribute('aria-disabled') ? this.say(this.host.sim.inventory.nearStore() ? 'Nothing to move' : 'Stand by the fountain, a chest or a woken landmark to move things.') : this.move(mv.dataset.move!, mv.dataset.n!);
    const pin = t.closest<HTMLElement>('[data-pin]');
    if (pin) {
      pinRequest(this.host.sim, pin.dataset.pin!);
      const r = requestRows(this.host.sim).find((x) => x.pinned);
      this.say(r ? `Pinned: ${r.keeper}'s request` : '');
      this.host.changed?.();
      return this.refresh();
    }
    const cell = t.closest<HTMLElement>('[data-mat], [data-page]');
    if (cell?.dataset.mat) this.selMat = cell.dataset.mat as ItemId;
    if (cell?.dataset.page) this.selPage = cell.dataset.page;
    if (cell) this.select();
    // Enter or A on a material steps into its moves (the grid beside it would change the selection on the way)
    if (cell?.dataset.mat) this.body.querySelector<HTMLElement>('#bpDetail [data-move]:not([aria-disabled])')?.focus({ focusVisible: true } as FocusOptions);
  }
}
