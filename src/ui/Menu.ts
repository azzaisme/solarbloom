import { confirmHold } from './Confirm';
import { PadFocus } from './PadFocus';
import { type BarItem, barHtml, fillGlyphs, icon, panelStyle, wireBar } from './PanelShell';

/**
 * E22.11 (#349): the in-game menu. Esc with nothing open, or Menu on the pad, opens it and pauses the game.
 * Resume · Backpack · Map · Photo mode · Settings · Save now · Quit to title (and Quit to desktop in the Deck
 * build). Its header shows the save's name, the region bloombot is in, the day number (once E21's clock exists)
 * and the time played. Esc or B resumes. "Quit to title" saves first: nothing in the menu loses progress.
 *
 * E23.11 (Sunlit Glass, docs/art/ui-sunlit-glass/Pause.dc.html): a paper panel down the left, like the title's:
 * "Paused" over the garden's name, a tile with the region, the day, the clock and the time played, then Resume
 * (primary, with the focus) and the rest, each with its icon, and the action bar ("A Choose  B Resume"). When the
 * save Quit to title makes can't be written (storage full or turned off), it asks first, with the hold-to-confirm
 * dialog (Confirm.ts): the safe choice, Keep playing, has the focus.
 */
export type MenuItem = 'resume' | 'backpack' | 'map' | 'photo' | 'settings' | 'save' | 'title' | 'desktop';

export interface MenuHeader {
  name: string;
  region: string;
  day?: number;
  /** the clock, "07:34" */
  time?: string;
  /** seconds played */
  played: number;
}

export interface MenuHost {
  header(): MenuHeader;
  choose(item: MenuItem): void;
  /** the Deck (desktop) build: offers Quit to desktop */
  desktop: boolean;
  /** true when quitting now would lose progress (its save can't be written): Quit asks first */
  unsaved?(): boolean;
}

const ICON: Record<MenuItem, string> = { resume: 'play', backpack: 'pack', map: 'map', photo: 'camera', settings: 'gear', save: 'save', title: 'door', desktop: 'door' };

const LABELS: Record<MenuItem, string> = {
  resume: 'Resume',
  backpack: 'Backpack',
  map: 'Map',
  photo: 'Photo mode',
  settings: 'Settings',
  save: 'Save now',
  title: 'Quit to title',
  desktop: 'Quit to desktop',
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "2 hours 5 minutes", "12 minutes", "less than a minute" (plain words, no abbreviations). */
export function playedText(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 1) return 'less than a minute';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return h ? (mm ? `${part(h, 'hour')} ${part(mm, 'minute')}` : part(h, 'hour')) : part(m, 'minute');
}

export class Menu {
  readonly el: HTMLElement;
  private head: HTMLElement;
  private where: HTMLElement;
  private asking = false;

  constructor(
    parent: HTMLElement,
    private host: MenuHost,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'menu';
    this.el.className = 'screen';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'menuName');
    const items: MenuItem[] = ['resume', 'backpack', 'map', 'photo', 'settings', 'save', 'title', ...(host.desktop ? (['desktop'] as MenuItem[]) : [])];
    const bar: BarItem[] = [
      { press: 'choose', label: 'Choose' },
      { press: 'back', label: 'Resume' },
    ];
    this.el.innerHTML =
      `<div class="panel menu-card"><header class="menu-head"></header><div class="menu-where"></div>` +
      `<nav class="menu-list" aria-label="Menu">${items.map((i) => `<button class="pn-btn${i === 'resume' ? ' primary' : ''}" data-menu="${i}" id="menu-${i}">${icon(ICON[i])}${LABELS[i]}</button>`).join('')}</nav>` +
      `<p class="menu-saved" role="status" aria-live="polite"></p><div class="pn-acts">${barHtml(bar)}</div></div>`;
    parent.appendChild(this.el);
    this.head = this.el.querySelector<HTMLElement>('.menu-head')!;
    this.where = this.el.querySelector<HTMLElement>('.menu-where')!;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-menu]');
      if (b) this.choose(b.dataset.menu as MenuItem);
    });
    wireBar(this.el);
    fillGlyphs(this.el);
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open() {
    const h = this.host.header();
    this.head.innerHTML = `<span class="pn-badge big">${icon('leaf', 'l')}</span><div><p class="pn-label">Paused</p><h2 id="menuName">${esc(h.name)}</h2></div>`;
    const when = [h.day !== undefined ? `Day ${h.day}` : '', h.time ?? '', `played ${playedText(h.played)}`].filter(Boolean).join(' · ');
    this.where.innerHTML = `<p class="menu-region">${esc(h.region)}</p><p class="menu-time pn-soft">${esc(when)}</p>`;
    this.note('');
    this.el.hidden = false;
    this.el.classList.add('open');
    this.el.querySelector<HTMLElement>('#menu-resume')?.focus({ focusVisible: true } as FocusOptions);
  }

  close() {
    this.el.hidden = true;
    this.el.classList.remove('open');
  }

  /** A menu item chosen. Quit to title asks first when its save can't be written. */
  private choose(item: MenuItem) {
    if (this.asking) return;
    if ((item === 'title' || item === 'desktop') && this.host.unsaved?.()) {
      this.asking = true;
      const style = panelStyle();
      const c = confirmHold({
        title: 'Quit without saving?',
        what: { name: this.el.querySelector('#menuName')?.textContent ?? 'Your garden', facts: this.where.querySelector('.menu-time')?.textContent ?? undefined },
        body: 'This garden can’t be saved right now: the browser’s storage is full or turned off. What you did since the last save will be lost.',
        keep: 'Keep playing',
        go: 'Hold to quit anyway',
        device: style === 'keys' ? 'keys' : 'pad',
        padStyle: style === 'keys' ? undefined : style,
        parent: this.el.parentElement ?? undefined,
      });
      PadFocus.modal = c;
      void c.result.then((go) => {
        if (PadFocus.modal === c) PadFocus.modal = undefined;
        this.asking = false;
        if (go) this.host.choose(item);
        else this.focus(item);
      });
      return;
    }
    this.host.choose(item);
  }

  /** The are-you-sure dialog is open over the menu (it takes the keys and the pad). */
  get confirming(): boolean {
    return this.asking;
  }

  /** A short line under the list ("Saved"). */
  note(text: string) {
    const p = this.el.querySelector<HTMLElement>('.menu-saved');
    if (p) p.textContent = text;
  }

  /** Puts the focus back on an item (coming back from Settings). */
  focus(item: MenuItem) {
    this.el.querySelector<HTMLElement>(`#menu-${item}`)?.focus({ focusVisible: true } as FocusOptions);
  }
}
