/**
 * E22.11 (#349): the in-game menu. Esc with nothing open, or Menu on the pad, opens it and pauses the game.
 * Resume · Backpack · Map · Photo mode · Settings · Save now · Quit to title (and Quit to desktop in the Deck
 * build). Its header shows the save's name, the region bloombot is in, the day number (once E21's clock exists)
 * and the time played. Esc or B resumes. "Quit to title" saves first: nothing in the menu loses progress.
 */
export type MenuItem = 'resume' | 'backpack' | 'map' | 'photo' | 'settings' | 'save' | 'title' | 'desktop';

export interface MenuHeader {
  name: string;
  region: string;
  day?: number;
  /** seconds played */
  played: number;
}

export interface MenuHost {
  header(): MenuHeader;
  choose(item: MenuItem): void;
  /** the Deck (desktop) build: offers Quit to desktop */
  desktop: boolean;
}

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
    this.el.innerHTML = `<div class="panel menu-card"><header class="menu-head"></header><nav class="menu-list" aria-label="Menu">${items.map((i) => `<button data-menu="${i}" id="menu-${i}">${LABELS[i]}</button>`).join('')}</nav><p class="menu-saved" role="status" aria-live="polite"></p></div>`;
    parent.appendChild(this.el);
    this.head = this.el.querySelector<HTMLElement>('.menu-head')!;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-menu]');
      if (b) this.host.choose(b.dataset.menu as MenuItem);
    });
    this.el.hidden = true;
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open() {
    const h = this.host.header();
    this.head.innerHTML =
      `<h2 id="menuName">${esc(h.name)}</h2>` +
      `<p class="menu-where">${esc(h.region)}${h.day !== undefined ? ` · Day ${h.day}` : ''}</p>` +
      `<p class="menu-time">Played for ${playedText(h.played)}</p>`;
    this.note('');
    this.el.hidden = false;
    this.el.classList.add('open');
    this.el.querySelector<HTMLElement>('#menu-resume')?.focus({ focusVisible: true } as FocusOptions);
  }

  close() {
    this.el.hidden = true;
    this.el.classList.remove('open');
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
