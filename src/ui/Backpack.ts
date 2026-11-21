import type { ItemId } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { blueprintRows, collection, itemCells, journalPages, oneOffItems, pinRequest, requestRows, TABS, type TabId } from './BackpackModel';
import { materialIcon } from './MaterialIcons';
import { BLOOMBOT_GROUPS, bloombotRows, howHeading, pips, stateWords, type BloombotRow } from './BloombotPage';
import { type BarItem, glyph, icon, setBar, tabEnd, wireBar } from './PanelShell';
import { reveal } from './PadFocus';
import './backpack.css';

/**
 * E22.6 (#343), E23.11 (Sunlit Glass): the backpack, a centre sheet with tabs Items, Requests, Journal,
 * Collection, Blueprints; the game pauses while it is open. LB / RB or Q / E change tab (their pictures sit at
 * the ends of the tab row), arrows or the d-pad move the leaf focus ring, Enter or A press, Esc or B close. The
 * action bar at the foot names those buttons for the device in hand.
 *
 * - Items: a grid of materials, each with its own shape as well as colour, its name in text and "32 of 40". The
 *   one in focus shows where it comes from, what needs it next and how many are in the store. Opened at a store
 *   (the fountain, a chest, a woken landmark) it is the storage panel: the same grid with both counts and move
 *   1 / 10 / a stack, and "Deposit everything".
 * - Bloombot (#620): the moves the fountain teaches and the workshop's five upgrades, each with what it does, where
 *   it stands (learned, level pips) and how to get the next; the one in focus shows it all, with Show me where.
 * - Requests: every open request with its Keeper and region; pressing one pins it to the objective card.
 * - Journal: the pages in book order, gaps for the ones not found. Collection: cats, keepsakes, wildlife,
 *   landmarks, plots and decorations. Blueprints: found and not.
 *
 * Enter or A on a material steps into its move buttons. Text is 16 px or more, every control has a visible focus
 * ring and a screen-reader label ("Copper, 32 of 40 in backpack, 110 in store"), moves are announced ("Deposited
 * 32 Copper"), and nothing depends on colour or time.
 */
export interface BackpackHost {
  sim: Sim;
  /** something changed that the rest of the HUD shows (a pin, a move) */
  changed?(): void;
  /** #620: Show me where from the Bloombot page (the backpack closes and the way is marked) */
  showWhere?(at: { roofId: string; x: number; z: number; name: string }): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const TAB_ICON: Record<TabId, string> = { items: 'pack', bloombot: 'sprout', requests: 'list', journal: 'book', collection: 'star', blueprints: 'hammer' };

export class Backpack {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private tabs: HTMLElement;
  private live: HTMLElement;
  private titleEl: HTMLElement;
  private foot: HTMLElement;
  current: TabId = 'items';
  /** the storage panel's title while opened at a store */
  private storage?: string;
  private selMat: ItemId = 'scrap';
  private selPage?: string;
  /** #620: the Bloombot row in focus */
  private selBot?: string;

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
      `<div class="panel sheet bp-card"><header class="sheet-head"><span class="pn-badge">${icon('pack')}</span><h2 id="bpTitle">Backpack</h2><span class="sheet-sub">Paused</span><span class="grow"></span><button class="pn-btn ghost sheet-back" data-back>${glyph('back')}Back</button></header>` +
      `<div class="sheet-tabs">${tabEnd(-1)}<div role="tablist" aria-label="Backpack sections">${TABS.map((t) => `<button role="tab" id="bptab-${t.id}" data-tab="${t.id}" aria-controls="bpBody" aria-selected="false" tabindex="-1">${icon(TAB_ICON[t.id])}${t.label}</button>`).join('')}</div>${tabEnd(1)}</div>` +
      `<div class="sheet-body bp-body" id="bpBody" role="tabpanel"></div>` +
      `<footer class="sheet-foot"><p class="bp-live" role="status" aria-live="polite"></p><span class="pn-acts"></span></footer></div>`;
    parent.appendChild(this.el);
    this.body = this.el.querySelector<HTMLElement>('#bpBody')!;
    this.tabs = this.el.querySelector<HTMLElement>('[role=tablist]')!;
    this.live = this.el.querySelector<HTMLElement>('.bp-live')!;
    this.titleEl = this.el.querySelector<HTMLElement>('#bpTitle')!;
    this.foot = this.el.querySelector<HTMLElement>('.sheet-foot')!;
    this.el.hidden = true;
    this.el.querySelector('[data-back]')!.addEventListener('click', () => this.close());
    wireBar(this.el, (p) => {
      if (p === 'prev' || p === 'next' || p === 'tabs') {
        this.tab(p === 'prev' ? -1 : 1, true);
        return true;
      }
      if (p === 'back') {
        this.close();
        return true;
      }
    });
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
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-mat], [data-page], [data-bb]');
      if (!t) return;
      if (t.dataset.bb && t.dataset.bb !== this.selBot) {
        this.selBot = t.dataset.bb;
        this.select();
      } else if (t.dataset.mat && t.dataset.mat !== this.selMat) {
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
    this.el.classList.toggle('bp-store', !!storage);
    this.el.hidden = false;
    this.el.classList.add('open');
    this.say('');
    this.show(storage ? 'items' : tab);
    // #616: the focus starts on the tab's first cell or row, not on the tab (d-pad up still reaches the tabs)
    const first = this.body.querySelector<HTMLElement>('.bp-cell, button:not([disabled]), [tabindex="0"]');
    if (first) {
      first.focus({ focusVisible: true } as FocusOptions);
      reveal(first);
    }
    else this.el.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus({ focusVisible: true } as FocusOptions);
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
    this.fitDetail();
    this.bar();
  }

  /** Redraws the open tab, keeping the focus on the same control. */
  refresh() {
    if (!this.isOpen) return;
    const id = (document.activeElement as HTMLElement | null)?.id;
    this.body.innerHTML = this[this.current]();
    this.fitDetail();
    if (id) this.body.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.focus({ focusVisible: true } as FocusOptions);
    this.bar();
  }

  /** The action bar: what Enter / A does on this tab, the tab buttons and Back. */
  private bar() {
    const choose: Partial<Record<TabId, string>> = { items: this.storage ? 'Move' : 'Choose', bloombot: 'Choose', requests: 'Pin', journal: 'Read' };
    const items: BarItem[] = [];
    if (choose[this.current]) items.push({ press: 'choose', label: choose[this.current]! });
    items.push({ press: 'tabs', label: 'Change tab' });
    items.push({ press: 'back', label: this.storage ? 'Back' : 'Back to the world' });
    setBar(this.foot, items);
  }

  private say(text: string) {
    this.live.textContent = text;
  }

  // ───────── Items (and the storage panel) ─────────

  private items(): string {
    const sim = this.host.sim;
    const cells = itemCells(sim);
    if (!cells.length) return `<p class="pn-empty bp-empty">There is nothing to carry in this garden. Materials are found out in the city.</p>`;
    const store = !!this.storage;
    const grid = cells
      .map(
        (c) =>
          `<button class="pn-cell bp-cell${c.seen ? '' : ' unseen'}" role="option" id="bpmat-${c.id}" data-mat="${c.id}" aria-selected="${c.id === this.selMat}" aria-label="${esc(c.label)}">` +
          `${materialIcon(c.seen ? c.id : 'unknown', 40)}<span class="bp-name">${esc(c.name)}</span>${c.seen ? `<span class="pn-n bp-count">${c.count} of ${c.limit}</span>` : ''}${store && c.seen ? `<span class="pn-n bp-stored">${c.stored} stored</span>` : ''}</button>`,
      )
      .join('');
    const extra = oneOffItems(sim);
    const row = extra.length ? `<h3 class="pn-label">One of a kind</h3><ul class="pn-chips bp-special">${extra.map((i) => `<li class="pn-chip"><b>${esc(i.name)}</b> <span>${esc(i.from)}</span></li>`).join('')}</ul>` : '';
    return `<div class="pn-split"><div class="pn-main"><div class="pn-cells bp-grid" role="listbox" aria-label="Materials" aria-orientation="horizontal">${grid}</div>${row}</div><aside class="pn-detail bp-detail" id="bpDetail">${this.detail()}</aside></div>`;
  }

  private detail(): string {
    const sim = this.host.sim;
    const c = itemCells(sim).find((x) => x.id === this.selMat);
    if (!c) return '';
    if (!c.seen) return `<h3><span class="pn-tile">${materialIcon('unknown', 40)}</span>Not found yet</h3><p>${esc(c.from)}.</p>`;
    const near = sim.inventory.nearStore();
    const room = sim.inventory.room(c.id);
    const btn = (act: string, n: string, label: string, ok: boolean, aria: string, cls = '') => `<button class="pn-btn small${cls}" id="bp-${act}-${n}" data-move="${act}" data-n="${n}" aria-label="${esc(aria)}" ${ok ? '' : 'aria-disabled="true"'}>${label}</button>`;
    const canPut = near && c.count > 0;
    const canTake = near && c.stored > 0 && room > 0;
    const moves = near
      ? `<h4 id="bpPutH">Put in the store</h4><div class="pn-moves" role="group" aria-labelledby="bpPutH">${btn('put', '1', '1', canPut, `Put 1 ${c.name} in the store`)}${btn('put', '10', '10', canPut, `Put 10 ${c.name} in the store`)}${btn('put', 'stack', 'All of it', canPut, `Put all your ${c.name} in the store`)}</div>` +
        `<h4 id="bpTakeH">Take from the store</h4><div class="pn-moves" role="group" aria-labelledby="bpTakeH">${btn('takeOut', '1', '1', canTake, `Take 1 ${c.name} from the store`)}${btn('takeOut', '10', '10', canTake, `Take 10 ${c.name} from the store`)}${btn('takeOut', 'stack', 'A stack', canTake, `Take a stack of ${c.name} from the store`)}</div>` +
        `<div class="pn-moves bp-all">${btn('depositAll', 'all', 'Deposit everything', itemCells(sim).some((x) => x.count > 0), 'Put everything you carry in the store', ' primary')}</div>`
      : `<p class="pn-note bp-note">Stand by the fountain, a chest or a woken landmark to move things to and from the store.</p>`;
    return (
      `<h3><span class="pn-tile">${materialIcon(c.id, 40)}</span>${esc(c.name)}</h3>` +
      `<dl><dt>In your backpack</dt><dd>${c.count} of ${c.limit}</dd><dt>In the store</dt><dd>${c.stored}</dd></dl>` +
      `<h4>Where it comes from</h4><p>${esc(c.from)}.</p><h4>Needed next</h4><p>${esc(c.next)}.</p>` +
      moves
    );
  }

  /** Shows the selection without rebuilding the list (the focus stays where it is). */
  private select() {
    for (const b of this.body.querySelectorAll<HTMLElement>('[data-mat]')) b.setAttribute('aria-selected', String(b.dataset.mat === this.selMat));
    for (const b of this.body.querySelectorAll<HTMLElement>('[data-page]')) b.setAttribute('aria-selected', String(b.dataset.page === this.selPage));
    for (const b of this.body.querySelectorAll<HTMLElement>('[data-bb]')) b.setAttribute('aria-selected', String(b.dataset.bb === this.selBot));
    const d = this.body.querySelector<HTMLElement>('#bpDetail');
    if (d) d.innerHTML = this.current === 'journal' ? this.pageText() : this.current === 'bloombot' ? this.botDetail() : this.detail();
    this.fitDetail();
  }

  /**
   * The Bloombot page's detail, when it is taller than its column (a long "how to learn it" at a big interface size)
   * and has no Show me where at its foot: its last paragraph becomes a stop the focus can reach (Enter or A on the
   * row, or right from the list), and the pad and keys scroll it into view there, so its end is never out of reach.
   */
  private fitDetail() {
    if (this.current !== 'bloombot') return;
    const d = this.body.querySelector<HTMLElement>('#bpDetail');
    const how = d?.querySelector<HTMLElement>('#bb-how');
    if (!d || !how) return;
    const stop = !d.querySelector('#bb-where') && d.scrollHeight > d.clientHeight + 1;
    if (stop) how.tabIndex = 0;
    else how.removeAttribute('tabindex');
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

  // ───────── Bloombot (#620) ─────────

  private bloombot(): string {
    const rows = bloombotRows(this.host.sim);
    if (!rows.some((r) => r.id === this.selBot)) this.selBot = (rows.find((r) => r.state === 'next') ?? rows[0])?.id;
    const row = (r: BloombotRow) =>
      `<button class="bb-row ${r.state}" role="option" id="bb-${r.id}" data-bb="${r.id}" aria-selected="${r.id === this.selBot}" aria-label="${esc(`${r.name}, ${stateWords(r)}`)}">` +
      `<b class="bb-name">${esc(r.name)}</b>` +
      (r.kind === 'upgrade' ? `<span class="bb-pips" aria-hidden="true">${pips(r.level ?? 0, r.max ?? 3)}</span>` : '') +
      `<span class="bb-state">${esc(stateWords(r))}</span></button>`;
    const groups = BLOOMBOT_GROUPS.map((g) => {
      const list = rows.filter((r) => r.kind === g.kind);
      if (!list.length) return '';
      const id = `bbH-${g.kind}`;
      return `<h3 class="pn-label" id="${id}">${esc(g.title)} <span class="bb-count">${esc(g.note(list))}</span></h3><div class="bb-rows" role="listbox" aria-labelledby="${id}">${list.map(row).join('')}</div>`;
    }).join('');
    return `<div class="pn-split bb-split"><div class="pn-main bb-main">${groups}</div><aside class="pn-detail bp-detail bb-detail" id="bpDetail">${this.botDetail()}</aside></div>`;
  }

  private botDetail(): string {
    const r = bloombotRows(this.host.sim).find((x) => x.id === this.selBot);
    if (!r) return '';
    const level = r.kind === 'upgrade' ? `<p class="bb-level"><span class="bb-pips" aria-hidden="true">${pips(r.level ?? 0, r.max ?? 3)}</span>${esc(stateWords(r))}</p>` : `<p class="bb-level">${esc(stateWords(r))}</p>`;
    const where = r.where ? `<button class="pn-btn primary bb-where" id="bb-where" data-bbwhere="${r.id}">${icon('pin', 's')}Show me where</button>` : '';
    return (
      `<h3><span class="pn-badge">${icon(r.kind === 'move' || r.kind === 'move2' ? 'sprout' : r.kind === 'park' ? 'star' : r.kind === 'knack' ? 'heart' : 'spark')}</span>${esc(r.name)}</h3>` +
      level +
      `<p class="bb-does">${esc(r.does)}</p>` +
      (r.now ? `<p class="bb-now">${esc(r.now)}</p>` : '') +
      `<h4>${esc(howHeading(r))}</h4><p class="bb-how" id="bb-how">${esc(r.how)}</p>` +
      where
    );
  }

  // ───────── Requests ─────────

  private requests(): string {
    const rows = requestRows(this.host.sim);
    if (!rows.length) return `<p class="pn-empty bp-empty">No requests yet. Wake a Keeper and it will ask for help.</p>`;
    return (
      `<p class="pn-note bp-help">Press a request to pin it to the top of the screen.</p><ul class="bp-list">` +
      rows
        .map(
          (r) =>
            `<li><button class="bp-req" id="bpreq-${r.id}" data-pin="${r.id}" aria-pressed="${r.pinned}"><span class="pn-badge sun">${icon('list')}</span><b>${esc(r.keeper)}</b><span class="bp-where">${esc(r.region)}</span>${r.pinned ? `<em class="bp-pin">${icon('pin', 's')}Pinned</em>` : ''}<span class="bp-text">${esc(r.text)}</span></button></li>`,
        )
        .join('') +
      `</ul>`
    );
  }

  // ───────── Journal ─────────

  private journal(): string {
    const pages = journalPages(this.host.sim);
    const found = pages.filter((p) => p.found).length;
    this.selPage ??= pages.find((p) => p.found)?.id ?? pages[0]?.id;
    return (
      `<div class="pn-split"><div class="pn-main"><p class="pn-note bp-help">${found} of ${pages.length} pages found.</p><div class="bp-pages" role="listbox" aria-label="Journal pages">` +
      pages.map((p) => `<button class="bp-page${p.found ? '' : ' unseen'}" role="option" id="bppage-${p.id}" data-page="${p.id}" aria-selected="${p.id === this.selPage}" aria-label="Page ${p.n}: ${esc(p.title)}"><span class="bp-pn">${p.n}</span>${esc(p.title)}</button>`).join('') +
      `</div></div><aside class="pn-detail bp-detail bp-read" id="bpDetail">${this.pageText()}</aside></div>`
    );
  }

  private pageText(): string {
    const p = journalPages(this.host.sim).find((x) => x.id === this.selPage);
    return p ? `<h3><span class="pn-badge">${icon('book')}</span>Page ${p.n}: ${esc(p.title)}</h3><p class="bp-prose">${esc(p.text)}</p>` : '';
  }

  // ───────── Collection ─────────

  private collection(): string {
    return `<div class="bp-groups">${collection(this.host.sim)
      .map(
        (g, i) =>
          `<section class="bp-group" tabindex="0" role="group" aria-labelledby="bpg-${i}"><h3 id="bpg-${i}">${esc(g.title)} <span class="bp-gcount">${esc(g.count)}</span></h3>` +
          (g.rows.length ? `<ul>${g.rows.map((r) => `<li class="${r.found ? '' : 'unseen'}"><b>${esc(r.name)}</b> <span>${esc(r.detail)}</span></li>`).join('')}</ul>` : `<p class="pn-empty bp-empty">${esc(g.empty)}</p>`) +
          `</section>`,
      )
      .join('')}</div>`;
  }

  // ───────── Blueprints ─────────

  private blueprints(): string {
    const rows = blueprintRows(this.host.sim);
    return `<section class="bp-group" tabindex="0" role="group" aria-labelledby="bpbh"><h3 id="bpbh">Blueprints <span class="bp-gcount">${rows.filter((r) => r.found).length} of ${rows.length}</span></h3><ul>${rows.map((r) => `<li class="${r.found ? '' : 'unseen'}"><b>${esc(r.name)}</b> <span>${esc(r.where)}</span></li>`).join('')}</ul></section>`;
  }

  private click(t: HTMLElement) {
    const go = t.closest<HTMLElement>('[data-bbwhere]');
    if (go) {
      const r = bloombotRows(this.host.sim).find((x) => x.id === go.dataset.bbwhere);
      if (r?.where && this.host.showWhere) {
        this.close();
        this.host.showWhere(r.where);
      }
      return;
    }
    const bb = t.closest<HTMLElement>('[data-bb]');
    if (bb) {
      this.selBot = bb.dataset.bb;
      this.select();
      // Enter or A on a row steps to its Show me where, or (a detail too tall to show whole) to its last lines
      const to = this.body.querySelector<HTMLElement>('#bb-where') ?? this.body.querySelector<HTMLElement>('#bb-how[tabindex="0"]');
      to?.focus({ focusVisible: true } as FocusOptions);
      to?.scrollIntoView({ block: 'nearest' });
      return;
    }
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
