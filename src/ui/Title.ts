import type { Slot, SlotHeader } from '../app/SaveService';
import { LOGO_MARK } from './Icons';
import { playedText } from './Menu';
import { PadFocus } from './PadFocus';

/**
 * E22.12 (#350): the splash and the title screen.
 *
 * - Splash: the logo on a plain background for up to 2 s; any input skips it.
 * - Title: the logo over a slow pan across a painted park at dawn, "Press any button" until the first input
 *   (which picks the glyph set: keys or pad), then Continue · New game · Load game · Settings · Quit (the Deck
 *   build only). Three slots, each with its name, day, time played, the fountain's step, the last region and a
 *   "Classic" tag for old-rules saves; rename and delete, each confirmed. New game on a used slot asks first.
 *
 * Everything works with the keyboard (Tab, arrows, Enter, Esc) and the pad alone (the d-pad's focus ring, A,
 * B to go back). The title draws no 3D: it costs next to nothing, so it holds any frame limit.
 */
export interface TitleHost {
  slots(): Promise<(SlotHeader | undefined)[]>;
  /** start a slot (fresh: clear it first) */
  start(slot: Slot, fresh: boolean, device: 'keys' | 'pad'): void;
  rename(slot: Slot, name: string): void;
  remove(slot: Slot): void;
  /** opens Settings over the title (the same screen as in game); `back` when it closes */
  settings(parent: HTMLElement, back: () => void): void;
  /** the Settings screen is open (Esc and B go to it first) */
  settingsOpen(): boolean;
  closeSettings(): void;
  /** LB / RB, Q / E in Settings */
  settingsTab?(dir: number): void;
  /** the Deck build: Quit */
  quit?: () => void;
  reducedMotion: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Title {
  readonly el: HTMLElement;
  private heads: (SlotHeader | undefined)[] = [];
  private device: 'keys' | 'pad' = 'keys';
  private woke = false;
  private focus: PadFocus;
  private padPrev: boolean[] = [];
  private raf = 0;
  private confirm?: { text: string; yes: string; then: () => void };
  private view: 'press' | 'menu' | 'load' | 'new' = 'press';
  private renaming?: Slot;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(private host: TitleHost) {
    this.el = document.createElement('div');
    this.el.id = 'title';
    this.el.className = host.reducedMotion ? 'still' : '';
    document.body.appendChild(this.el);
    this.focus = new PadFocus(this.el, ['#settings.open', '.t-confirm', '.t-panel']);
    this.el.addEventListener('click', (e) => this.click(e));
    window.addEventListener('keydown', this.onKey);
  }

  /** The splash: up to 2 s, any key, click or pad button skips it. */
  splash(): Promise<void> {
    const s = document.createElement('div');
    s.id = 'splash';
    s.innerHTML = `<div class="sp-logo" role="img" aria-label="Solarbloom">${LOGO_MARK}<span>Solarbloom</span></div>`;
    document.body.appendChild(s);
    return new Promise((resolve) => {
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', end, true);
        window.removeEventListener('pointerdown', end, true);
        cancelAnimationFrame(poll);
        s.classList.add('gone');
        setTimeout(() => s.remove(), 300);
        resolve();
      };
      window.addEventListener('keydown', end, true);
      window.addEventListener('pointerdown', end, true);
      let poll = 0;
      const tick = () => {
        if (anyPadButton()) return end();
        poll = requestAnimationFrame(tick);
      };
      poll = requestAnimationFrame(tick);
      setTimeout(end, 2000);
    });
  }

  async show() {
    this.heads = await this.host.slots();
    this.view = 'press';
    this.render();
    this.loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }

  /** The most recently saved slot (Continue). */
  private latest(): Slot | undefined {
    let best: Slot | undefined;
    let at = -1;
    this.heads.forEach((h, i) => {
      if (h && h.savedAt > at) {
        at = h.savedAt;
        best = (i + 1) as Slot;
      }
    });
    return best;
  }

  private render(focusId?: string) {
    const latest = this.latest();
    const art = `<div class="t-art" aria-hidden="true"><i class="t-sky"></i><i class="t-sun"></i><i class="t-hills"></i><i class="t-city"></i><i class="t-park"></i><i class="t-fountain"></i></div>`;
    const logo = `<h1 class="t-logo" aria-label="Solarbloom">${LOGO_MARK}<span>Solarbloom</span></h1>`;
    let body = '';
    if (this.view === 'press') body = `<button class="t-press" id="tPress">Press any button</button>`;
    else if (this.view === 'menu')
      body =
        `<nav class="t-panel t-menu" aria-label="Title menu">` +
        (latest ? `<button id="tContinue" data-t="continue">Continue <small>${esc(this.heads[latest - 1]!.name)}</small></button>` : '') +
        `<button id="tNew" data-t="new">New game</button>` +
        (this.heads.some(Boolean) ? `<button id="tLoad" data-t="load">Load game</button>` : '') +
        `<button id="tSettings" data-t="settings">Settings</button>` +
        (this.host.quit ? `<button id="tQuit" data-t="quit">Quit</button>` : '') +
        `</nav>`;
    else body = this.slotsHtml(this.view);
    const confirm = this.confirm
      ? `<div class="t-confirm panel" role="alertdialog" aria-labelledby="tConfirmText"><p id="tConfirmText">${esc(this.confirm.text)}</p><div class="t-row"><button id="tYes" data-t="yes">${esc(this.confirm.yes)}</button><button id="tNo" data-t="no">Cancel</button></div></div>`
      : '';
    // Keep Settings (if open) where it is: it lives in its own element.
    const settings = this.el.querySelector('#settings');
    this.el.innerHTML = `${art}<div class="t-fore">${logo}${body}</div>${confirm}`;
    if (settings) this.el.appendChild(settings);
    const target = focusId ? this.el.querySelector<HTMLElement>(`#${focusId}`) : this.confirm ? this.el.querySelector<HTMLElement>('#tNo') : this.el.querySelector<HTMLElement>('.t-fore button, .t-fore input');
    target?.focus({ focusVisible: true } as FocusOptions);
  }

  private slotsHtml(mode: 'load' | 'new'): string {
    const cards = this.heads
      .map((h, i) => {
        const slot = (i + 1) as Slot;
        if (!h)
          return `<div class="t-slot empty"><h3>Empty slot ${slot}</h3>${mode === 'new' ? `<button id="tStart${slot}" data-t="start" data-slot="${slot}">Start here</button>` : '<p>No garden here yet</p>'}</div>`;
        const name = this.renaming === slot ? `<label class="t-rename">Name <input id="tName${slot}" maxlength="40" value="${esc(h.name)}"></label><button id="tSaveName${slot}" data-t="saveName" data-slot="${slot}">Save name</button>` : `<h3>${esc(h.name)}${h.rules === 'classic' ? ' <em class="t-tag">Classic</em>' : ''}</h3>`;
        const facts = [h.day !== undefined ? `Day ${h.day}` : '', `Played for ${playedText(h.played)}`, h.step, h.region].filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join('');
        const actions =
          mode === 'load'
            ? `<button id="tLoad${slot}" data-t="loadSlot" data-slot="${slot}">Load</button><button id="tRename${slot}" data-t="rename" data-slot="${slot}">Rename</button><button id="tDelete${slot}" data-t="delete" data-slot="${slot}" class="danger">Delete</button>`
            : `<button id="tStart${slot}" data-t="start" data-slot="${slot}">Start a new garden here</button>`;
        return `<div class="t-slot" aria-label="Slot ${slot}: ${esc(h.name)}">${name}<ul>${facts}</ul><div class="t-row">${actions}</div></div>`;
      })
      .join('');
    return `<section class="t-panel t-slots" aria-label="${mode === 'load' ? 'Load game' : 'New game'}"><h2>${mode === 'load' ? 'Load game' : 'New game: choose a slot'}</h2><div class="t-slot-list">${cards}</div><button id="tBack" data-t="back">Back</button></section>`;
  }

  private wake(device: 'keys' | 'pad') {
    if (this.woke) return;
    this.woke = true;
    this.device = device; // the first input picks the glyph set
    this.view = 'menu';
    this.render();
  }

  private click(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t], #tPress');
    if (!b) return;
    if (b.id === 'tPress') return this.wake('keys');
    const slot = Number(b.dataset.slot) as Slot;
    switch (b.dataset.t) {
      case 'continue':
        return this.host.start(this.latest()!, false, this.device);
      case 'new':
        this.view = 'new';
        return this.render();
      case 'load':
        this.view = 'load';
        return this.render();
      case 'settings':
        return this.host.settings(this.el, () => this.render('tSettings'));
      case 'quit':
        return this.host.quit?.();
      case 'back':
        this.view = 'menu';
        this.renaming = undefined;
        return this.render(this.heads.some(Boolean) ? 'tLoad' : 'tNew');
      case 'loadSlot':
        return this.host.start(slot, false, this.device);
      case 'start':
        if (!this.heads[slot - 1]) return this.host.start(slot, true, this.device);
        this.confirm = { text: `Start a new garden in ${this.heads[slot - 1]!.name}? The garden saved there will be replaced.`, yes: 'Start a new garden', then: () => this.host.start(slot, true, this.device) };
        return this.render();
      case 'rename':
        this.renaming = slot;
        return this.render(`tName${slot}`);
      case 'saveName': {
        const v = this.el.querySelector<HTMLInputElement>(`#tName${slot}`)?.value ?? '';
        this.confirm = {
          text: `Rename this garden to "${v.trim() || this.heads[slot - 1]!.name}"?`,
          yes: 'Rename',
          then: () => {
            this.host.rename(slot, v);
            this.renaming = undefined;
            void this.reload(`tRename${slot}`);
          },
        };
        return this.render();
      }
      case 'delete':
        this.confirm = {
          text: `Delete ${this.heads[slot - 1]!.name}? This can't be undone.`,
          yes: 'Delete',
          then: () => {
            this.host.remove(slot);
            void this.reload('tBack');
          },
        };
        return this.render();
      case 'yes': {
        const c = this.confirm;
        this.confirm = undefined;
        return c?.then();
      }
      case 'no':
        this.confirm = undefined;
        return this.render();
    }
  }

  private async reload(focusId?: string) {
    this.heads = await this.host.slots();
    if (this.view === 'load' && !this.heads.some(Boolean)) this.view = 'menu';
    this.render(focusId);
  }

  /** Back: closes the top thing (Settings, a question, a list). */
  private back() {
    if (this.host.settingsOpen()) return this.host.closeSettings();
    if (this.confirm) {
      this.confirm = undefined;
      return this.render();
    }
    if (this.view === 'load' || this.view === 'new') {
      this.view = 'menu';
      this.renaming = undefined;
      this.render();
    }
  }

  private key(e: KeyboardEvent) {
    if (!this.el.isConnected) return;
    if (!this.woke) {
      e.preventDefault();
      return this.wake('keys');
    }
    const field = e.target instanceof HTMLInputElement && e.target.type === 'text';
    if (e.code === 'Escape') {
      e.preventDefault();
      return this.back();
    }
    if (field) return;
    const dpad: Record<string, number> = { ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15 };
    if (dpad[e.code] !== undefined && !(e.target as HTMLElement)?.closest?.('[role=tablist], select, input[type=range]')) {
      e.preventDefault();
      this.focus.button(dpad[e.code]);
    } else if (this.host.settingsOpen() && (e.code === 'KeyQ' || e.code === 'KeyE')) this.host.settingsTab?.(e.code === 'KeyE' ? 1 : -1);
  }

  /** The pad: the first press wakes the title; the d-pad and A move and press; B goes back; LB / RB change tab. */
  private loop() {
    const tick = () => {
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = [...pads].find((p) => p?.connected);
      if (gp)
        gp.buttons.forEach((b, i) => {
          if (b.pressed && !this.padPrev[i]) this.pad(i);
          this.padPrev[i] = b.pressed;
        });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** The pad's buttons on the title (also driven directly by tests). */
  pad(i: number) {
    if (!this.woke) return this.wake('pad');
    this.device = 'pad';
    if (this.listener) return this.listener(i);
    if (this.focus.button(i)) return;
    if (i === 1) this.back();
    else if ((i === 4 || i === 5) && this.host.settingsOpen()) this.host.settingsTab?.(i === 5 ? 1 : -1);
  }

  /** Settings › Controls waits for a pad button through here. */
  listener?: (i: number) => void;
}

function anyPadButton(): boolean {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  return [...pads].some((p) => p?.connected && p.buttons.some((b) => b.pressed));
}
