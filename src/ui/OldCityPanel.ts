import type { MaterialId } from '../core/types';
import { MATERIALS, MATERIAL_IDS, tierGives, visibleMaterials } from '../data/salvage';
import { giftLabel } from '../gameplay/KeeperSystem';
import type { Sim } from '../gameplay/Sim';
import { iconize } from './Icons';
import { materialIcon } from './MaterialIcons';
import { type BarItem, barHtml, fillGlyphs, icon, wireBar } from './PanelShell';
import './oldcity.css';

export const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * E21: one panel the Old City's places open (the store, the fountain's deliveries, a planter, a compost bin, the
 * Bio Digester, Tally's trade). Every control is a button, so the gamepad's d-pad moves between them (PadFocus
 * lists `#ocPanel.open`), A presses one, and Cancel closes it.
 *
 * E23.11 (Sunlit Glass): a machine card docked on the right (the machine stays in view) when its markup starts
 * with `cardHead(…)` (the default), or a centre sheet when the head says `dock: 'sheet'` (the storage table). It
 * ends in an action bar with the device's glyphs: Enter / A on the control in focus, Esc / B back.
 */
export interface CardHead {
  /** an emoji or an icon's markup for the leaf badge */
  icon: string;
  title: string;
  /** one line in words under the title (how it is doing) */
  mood?: string;
  /** clay for "not yet" (thirsty, empty), leaf for good news */
  tone?: 'clay' | 'leaf' | 'sky' | '';
  badge?: 'sun' | 'sky' | 'clay' | '';
  dock?: 'side' | 'sheet';
  /** what Enter / A does here, for the action bar (default "Choose") */
  choose?: string;
}

/** A card's head: the leaf badge, the title and a line about how it is doing. */
export function cardHead(h: CardHead): string {
  return (
    `<header class="oc-head" data-dock="${h.dock ?? 'side'}" data-choose="${escHtml(h.choose ?? 'Choose')}"><span class="pn-badge big${h.badge ? ` ${h.badge}` : ''}" aria-hidden="true">${h.icon}</span>` +
    `<div class="grow"><h2 id="ocTitle">${escHtml(h.title)}</h2>${h.mood ? `<p class="oc-mood${h.tone ? ` ${h.tone}` : ''}">${escHtml(h.mood)}</p>` : ''}</div></header>`
  );
}

export class OldCityPanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private foot: HTMLElement;
  private render?: () => string;
  private act?: (act: string, arg: string) => void;
  /** the markup on show (a redraw that changes nothing leaves the DOM, and the focus, alone) */
  private shown = '';
  /** called whenever the panel closes */
  onClose?: () => void;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'ocPanel';
    this.el.className = 'panel side';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-labelledby', 'ocTitle');
    this.el.innerHTML = `<button class="oc-x" data-act="close" aria-label="Close">${icon('close', 's')}</button><div class="oc-body"></div><footer class="sheet-foot"><span class="pn-acts"></span></footer>`;
    this.body = this.el.querySelector('.oc-body')!;
    this.foot = this.el.querySelector('.sheet-foot')!;
    root.appendChild(this.el);
    wireBar(this.el, (p) => {
      if (p !== 'back') return false;
      this.close();
      return true;
    });
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b || (b as HTMLButtonElement).disabled) return;
      const act = b.dataset.act!;
      if (act === 'close') return this.close();
      this.act?.(act, b.dataset.arg ?? '');
      this.refresh();
    });
  }

  get isOpen(): boolean {
    return this.el.classList.contains('open');
  }

  open(render: () => string, act: (act: string, arg: string) => void) {
    this.render = render;
    this.act = act;
    this.el.classList.add('open');
    this.refresh();
    // the pad and the keys start on the first control, and can see it (#616)
    this.el.querySelector<HTMLElement>('.oc-body button:not([disabled])')?.focus({ focusVisible: true } as FocusOptions);
  }

  /** Redraws the panel, keeping the focused control (by its action) where it was. */
  refresh() {
    if (!this.render || !this.isOpen) return;
    const f = document.activeElement as HTMLElement | null;
    const key = f && this.el.contains(f) ? `${f.dataset.act}|${f.dataset.arg}` : undefined;
    const html = iconize(this.render());
    if (html !== this.shown) {
      this.shown = html;
      this.body.innerHTML = html;
      // docked right (a machine) or a centre sheet (the storage table), and the action bar for it
      const head = this.body.querySelector<HTMLElement>('.oc-head');
      const sheet = head?.dataset.dock === 'sheet';
      this.el.classList.toggle('side', !sheet);
      this.el.classList.toggle('sheet', sheet);
      const items: BarItem[] = [];
      if (this.body.querySelector('button:not([disabled])')) items.push({ press: 'choose', label: head?.dataset.choose ?? 'Choose' });
      items.push({ press: 'back', label: 'Back' });
      const bar = barHtml(items);
      const acts = this.foot.querySelector<HTMLElement>('.pn-acts')!;
      if (acts.innerHTML !== bar) acts.innerHTML = bar;
      fillGlyphs(this.el);
    } else return;
    if (key) {
      const [a, g] = key.split('|');
      const same = [...this.body.querySelectorAll<HTMLElement>('[data-act]')].find((e) => e.dataset.act === a && (e.dataset.arg ?? '') === (g === 'undefined' ? '' : g));
      same?.focus();
    }
  }

  close() {
    if (!this.isOpen) return;
    this.el.classList.remove('open');
    this.shown = '';
    this.render = undefined;
    this.act = undefined;
    this.onClose?.();
  }
}

/** E21.2: a short "+3 Copper" that rises from a spot on screen and fades. */
export function flyUp(root: HTMLElement, text: string, x: number, y: number) {
  const el = document.createElement('div');
  el.className = 'oc-fly';
  el.innerHTML = iconize(escHtml(text));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  root.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// ───────────── the storage panel (E21.1) ─────────────

/** HTML of the storage panel: one row per material with backpack and store counts, move 1 / 10 / a stack. */
export function storageHtml(sim: Sim, title = 'Storage'): string {
  const inv = sim.inventory;
  const limit = inv.stackLimit();
  const rows = MATERIAL_IDS.filter((m) => inv.count(m) || inv.stored(m) || seen(sim, m))
    .map((m) => {
      const p = inv.count(m);
      const st = inv.stored(m);
      const room = inv.room(m);
      const name = MATERIALS[m].name;
      const btn = (act: string, n: number | 'stack', label: string, ok: boolean, aria: string) =>
        `<button class="pn-btn small" data-act="${act}" data-arg="${m}:${n}" aria-label="${escHtml(aria)}" ${ok ? '' : 'disabled'}>${label}</button>`;
      const out = st >= 1 && room >= 1;
      return `<tr><th scope="row"><span class="oc-mat-name">${materialIcon(m, 28)}${name}</span></th><td class="n">${p} of ${limit}</td>
        <td class="mv">${btn('put', 1, '1', p >= 1, `Put 1 ${name} in the store`)}${btn('put', 10, '10', p >= 1, `Put 10 ${name} in the store`)}${btn('put', 'stack', 'All', p >= 1, `Put all your ${name} in the store`)}</td>
        <td class="mv">${btn('takeOut', 1, '1', out, `Take 1 ${name} from the store`)}${btn('takeOut', 10, '10', out, `Take 10 ${name} from the store`)}${btn('takeOut', 'stack', 'A stack', out, `Take a stack of ${name} from the store`)}</td>
        <td class="n">${st}</td></tr>`;
    })
    .join('');
  return (
    cardHead({ icon: icon('pack', 'l'), title, mood: 'Move things between your backpack and the store.', dock: 'sheet', choose: 'Move' }) +
    `<div class="oc-content"><table class="oc-store"><thead><tr><th scope="col">Material</th><th scope="col">With you</th><th scope="col">Put in the store</th><th scope="col">Take out</th><th scope="col">In the store</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="oc-empty">Nothing found yet. Salvage piles to fill your backpack.</td></tr>'}</tbody></table>
    <div class="oc-row"><button class="pn-btn primary" data-act="depositAll" ${MATERIAL_IDS.some((m) => inv.count(m)) ? '' : 'disabled'}>Deposit everything</button></div></div>`
  );
}

/** Runs a storage panel button. */
export function storageAct(sim: Sim, act: string, arg: string) {
  const inv = sim.inventory;
  if (act === 'depositAll') return void inv.depositAll();
  const [m, nRaw] = arg.split(':') as [MaterialId, string];
  if (!MATERIALS[m]) return;
  const n = nRaw === 'stack' ? undefined : Number(nRaw);
  if (act === 'put') inv.deposit(m, n);
  else if (act === 'takeOut') inv.withdraw(m, n);
}

/** A material shows in the panel once it has been held (or its region seen); empty rows would only be noise. */
function seen(sim: Sim, m: MaterialId): boolean {
  return m === 'scrap' || m === 'seeds' || !!sim.state.salvage?.seen?.includes(`mat:${m}`);
}

// ───────────── the fountain's delivery panel (E21.6) ─────────────

/** HTML of the fountain panel: the next step's name, each material given of needed ("6 of 10"), what it brings. */
export function fountainHtml(sim: Sim): string {
  const f = sim.fountain;
  const t = f.next();
  if (!t)
    return (
      cardHead({ icon: '⛲', title: 'The fountain', mood: 'Every step of the fountain is awake.', tone: 'leaf', badge: 'sky' }) +
      `<div class="oc-content"><div class="oc-row"><button class="pn-btn" data-act="storage">${icon('pack', 's')}Storage</button></div></div>`
    );
  const rows = (Object.entries(t.delivery) as [MaterialId | 'biomass', number][])
    .filter(([k]) => k !== 'biomass')
    .map(([k, need]) => {
      const m = k as MaterialId;
      const got = f.given(m);
      const have = sim.inventory.available(m);
      const left = f.remaining(m);
      return `<li class="oc-need${left ? '' : ' done'}">${materialIcon(m, 28)}<span class="grow">${MATERIALS[m].name}<small>${left ? `You have ${have}` : 'All given'}</small></span><span class="pn-chip ${left ? 'need' : 'ok'}">${left ? '' : icon('check', 's')}${Math.min(got, need)} of ${need}</span></li>`;
    })
    .join('');
  const c = f.condition(t);
  const canGive = (Object.keys(t.delivery) as MaterialId[]).some((m) => f.remaining(m) > 0 && sim.inventory.available(m) > 0);
  return (
    cardHead({ icon: '⛲', title: 'The fountain', mood: `Step ${t.tier}: ${t.name}`, badge: 'sky', choose: 'Give' }) +
    `<div class="oc-content"><h3 class="pn-label">Bring</h3><ul class="oc-needs">${rows}` +
    `<li class="oc-need${c.done ? ' done' : ''}">${icon('sprout')}<span class="grow">${escHtml(c.label)}</span><span class="pn-chip ${c.done ? 'ok' : 'need'}">${c.done ? icon('check', 's') : ''}${Math.min(c.have, c.need)} of ${c.need}</span></li></ul>` +
    `<h3 class="pn-label">It brings</h3><ul class="oc-gives">${tierGives(t).map((g) => `<li>${icon('spark', 's')}${escHtml(g)}</li>`).join('')}</ul>` +
    `<div class="oc-row"><button class="pn-btn primary" data-act="giveAll" ${canGive ? '' : 'disabled'}>Give all I have</button><button class="pn-btn" data-act="storage">${icon('pack', 's')}Storage</button></div></div>`
  );
}

// ───────────── Keeper speech bubbles (E21.8) ─────────────

/** A speech bubble that follows a point in the world for a few seconds (one to three lines, no voice, no choices). */
export class SpeechBubble {
  readonly el: HTMLElement;
  private until = 0;
  /** a second bubble from the same speaker, shown once this one has been read */
  private next?: { name: string; lines: string[] };
  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'oc-bubble';
    this.el.hidden = true;
    root.appendChild(this.el);
  }
  say(name: string, lines: string[], secs = 3 + lines.length * 1.6, then?: string[], now = performance.now()) {
    this.next = then?.length ? { name, lines: then } : undefined;
    this.el.innerHTML = iconize(`<b>${escHtml(name)}</b>${lines.map((l) => `<p>${escHtml(l)}</p>`).join('')}`);
    this.el.hidden = false;
    this.until = now + secs * 1000;
  }
  /**
   * Per frame: follow the speaker on screen (undefined: off screen or gone). A second bubble waits for the first to
   * be read and for its speaker to be on screen, so walking away mid-speech never loses it (#625: the knack and the
   * first request come in it).
   */
  place(at: { x: number; y: number } | undefined, now = performance.now()) {
    if (at && now > this.until && this.next) {
      const n = this.next;
      this.say(n.name, n.lines, undefined, undefined, now);
    }
    if (this.el.hidden) return;
    if (!at || now > this.until) {
      this.el.hidden = true;
      return;
    }
    // #610: kept whole on screen (a speaker near an edge used to squeeze it to a word a line, or push it off)
    const half = this.el.offsetWidth / 2;
    const room = this.el.offsetParent?.clientWidth ?? innerWidth;
    this.el.style.left = `${Math.max(half + 16, Math.min(room - half - 16, at.x))}px`;
    this.el.style.top = `${Math.max(this.el.offsetHeight + 16, at.y)}px`;
  }
}

// ───────────── Tally's trade (E21.9) ─────────────

/** HTML of Tally's trade panel: 3 of one material for 1 of another. */
export function tradeHtml(sim: Sim, give: MaterialId | undefined): string {
  const can = sim.landmarks.tradable();
  const gives = visibleMaterials().map(
    (m) => `<button data-act="give" data-arg="${m}" ${can.includes(m) ? '' : 'disabled'} class="pn-cell oc-mat${give === m ? ' on' : ''}" aria-pressed="${give === m}">${materialIcon(m, 30)}<span>${MATERIALS[m].name}</span></button>`,
  ).join('');
  const gets = sim.landmarks.tradeTargets().filter((m) => m !== give)
    .map((m) => `<button data-act="get" data-arg="${m}" ${give ? '' : 'disabled'} class="pn-cell oc-mat">${materialIcon(m, 30)}<span>${MATERIALS[m].name}</span></button>`)
    .join('');
  // E23.9.2: when bloombot carries something Tally loves, it can be given as a gift (a choice, never a surprise)
  const gift = sim.keepers.giftFor('tally');
  const label = giftLabel(gift ?? '');
  const giftRow = gift
    ? `<h3 class="pn-label">A gift</h3><div class="oc-row"><button class="pn-btn" data-act="gift" data-arg="${gift}">${label.icon ? `${label.icon} ` : icon('heart', 's')}Give Tally 1 ${label.name}</button></div>`
    : '';
  return (
    cardHead({ icon: icon('rotate', 'l'), title: 'Tally’s trade', mood: 'Any 3 of one material for 1 of another.', badge: 'sun', choose: 'Pick' }) +
    `<div class="oc-content">${giftRow}<h3 class="pn-label">Give 3</h3><div class="oc-mats">${gives}</div>` +
    `<h3 class="pn-label">Get 1</h3><div class="oc-mats">${gets}</div></div>`
  );
}
