import type { Slot, SlotHeader } from '../app/SaveService';
import { LOGO_MARK } from './Icons';
import { playedText } from './Menu';
import { PadFocus } from './PadFocus';

/**
 * E22.12 (#350): the splash and the title screen.
 *
 * - Splash: the logo on a plain background for up to 2 s; any input skips it.
 * - Title: the logo over a slow turn across the restored park at dawn (a painted still, src/ui/images), "Press any button" until the first input
 *   (which picks the glyph set: keys or pad), then Play · Settings (and Quit in the Deck build), centred in a pale
 *   panel over the left third (owner, 18 Nov 2026). Play opens the three slots, each with its name, day, time played,
 *   the fountain's step and the last region: Load, Rename, Start over or Delete a garden, or Start one in an empty
 *   slot. Rename, Start over and Delete each ask first. A garden from an earlier version (E23.1.1) can't be loaded:
 *   its card says so calmly and offers Start fresh (no question: nothing playable is lost) or Delete.
 *
 * Everything works with the keyboard (Tab, arrows, Enter, Esc) and the pad alone (the d-pad's focus ring, A,
 * B to go back). The title draws no 3D: it costs next to nothing, so it holds any frame limit.
 */
export interface TitleHost {
  slots(): Promise<(SlotHeader | undefined)[]>;
  /** start a slot (fresh: clear it first) */
  start(slot: Slot, fresh: boolean, device: 'keys' | 'pad', realClock?: boolean): void;
  /** E23.7.1.2: Settings' "Follow my clock" on the title: the new-game question offers it first */
  preferRealClock?(): boolean;
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
  private confirm?: { text: string; yes: string; then: () => void; detail?: string; alt?: { label: string; then: () => void } };
  private view: 'press' | 'menu' | 'play' = 'press';
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
      if (h && !h.old && h.savedAt > at) {
        at = h.savedAt;
        best = (i + 1) as Slot;
      }
    });
    return best;
  }

  private render(focusId?: string) {
    const latest = this.latest();
    const art = `<div class="t-art" aria-hidden="true"></div>`;
    const logo = `<h1 class="t-logo" aria-label="Solarbloom">${LOGO_MARK}<span>Solarbloom</span></h1>`;
    let body = '';
    if (this.view === 'press') body = `<button class="t-press" id="tPress">Press any button</button>`;
    else if (this.view === 'menu')
      body =
        `<nav class="t-menu" aria-label="Title menu">` +
        `<button id="tPlay" data-t="play">Play${latest ? ` <small>${esc(this.heads[latest - 1]!.name)}</small>` : ''}</button>` +
        `<button id="tSettings" data-t="settings">Settings</button>` +
        (this.host.quit ? `<button id="tQuit" data-t="quit">Quit</button>` : '') +
        `</nav>`;
    const slots = this.view === 'play' ? this.slotsHtml() : '';
    const confirm = this.confirm
      ? `<div class="t-confirm panel${this.confirm.alt ? ' t-choice' : ''}" role="alertdialog" aria-labelledby="tConfirmText"><p id="tConfirmText">${esc(this.confirm.text)}</p>${this.confirm.detail ? `<p class="t-detail">${esc(this.confirm.detail)}</p>` : ''}<div class="t-row"><button id="tYes" data-t="yes">${esc(this.confirm.yes)}</button>${this.confirm.alt ? `<button id="tAlt" data-t="alt">${esc(this.confirm.alt.label)}</button>` : ''}<button id="tNo" data-t="no">Cancel</button></div></div>`
      : '';
    // Keep Settings (if open) where it is: it lives in its own element.
    const settings = this.el.querySelector('#settings');
    // the left third: a pale veil with the logo and the menu in its middle; the slots open over the rest
    this.el.innerHTML = `${art}<div class="t-side">${logo}${body}</div>${slots ? `<div class="t-main">${slots}</div>` : ''}${confirm}`;
    if (settings) this.el.appendChild(settings);
    const target = focusId ? this.el.querySelector<HTMLElement>(`#${focusId}`) : this.confirm ? this.el.querySelector<HTMLElement>(this.confirm.alt ? '#tYes' : '#tNo') : this.el.querySelector<HTMLElement>(this.view === 'play' ? this.slotFocus() : '.t-side button');
    target?.focus({ focusVisible: true } as FocusOptions);
  }

  /** The slot picker's first focus: Load on the latest garden, else the first empty slot's Start. */
  private slotFocus(): string {
    const latest = this.latest();
    return latest ? `#tLoad${latest}` : '.t-main button';
  }

  private slotsHtml(): string {
    const cards = this.heads
      .map((h, i) => {
        const slot = (i + 1) as Slot;
        if (!h)
          return `<div class="t-slot empty"><h3>Empty slot ${slot}</h3><p>No garden here yet</p><button id="tStart${slot}" data-t="start" data-slot="${slot}">Start here</button></div>`;
        if (h.old)
          return `<div class="t-slot old" aria-label="Slot ${slot}: ${esc(h.name)}, from an earlier version"><h3>${esc(h.name)} <em class="t-tag">Earlier version</em></h3><p>This garden grew in an earlier version of Solarbloom. It starts fresh here.</p><div class="t-row"><button id="tLoad${slot}" class="primary" data-t="fresh" data-slot="${slot}">Start fresh</button><button id="tDelete${slot}" data-t="delete" data-slot="${slot}" class="danger">Delete</button></div></div>`;
        const name = this.renaming === slot ? `<label class="t-rename">Name <input id="tName${slot}" maxlength="40" value="${esc(h.name)}"></label><button id="tSaveName${slot}" data-t="saveName" data-slot="${slot}">Save name</button>` : `<h3>${esc(h.name)}</h3>`;
        const facts = [h.day !== undefined ? `Day ${h.day}` : '', `Played for ${playedText(h.played)}`, h.step, h.region].filter(Boolean).map((f) => `<li>${esc(f)}</li>`).join('');
        const actions = `<button id="tLoad${slot}" class="primary" data-t="loadSlot" data-slot="${slot}">Load</button><button id="tRename${slot}" data-t="rename" data-slot="${slot}">Rename</button><button id="tStart${slot}" data-t="start" data-slot="${slot}">Start over</button><button id="tDelete${slot}" data-t="delete" data-slot="${slot}" class="danger">Delete</button>`;
        return `<div class="t-slot" aria-label="Slot ${slot}: ${esc(h.name)}">${name}<ul>${facts}</ul><div class="t-row">${actions}</div></div>`;
      })
      .join('');
    return `<section class="t-panel t-slots" aria-label="Choose a garden"><h2>Choose a garden</h2><div class="t-slot-list">${cards}</div><button id="tBack" data-t="back">Back</button></section>`;
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
      case 'play':
        this.view = 'play';
        return this.render();
      case 'settings':
        return this.host.settings(this.el, () => this.render('tSettings'));
      case 'quit':
        return this.host.quit?.();
      case 'back':
        this.view = 'menu';
        this.renaming = undefined;
        return this.render('tPlay');
      case 'loadSlot':
        return this.host.start(slot, false, this.device);
      case 'fresh': // E23.1.1: an earlier version's garden
        return this.host.start(slot, true, this.device);
      case 'start':
        if (!this.heads[slot - 1]) return this.askClock(slot);
        this.confirm = { text: `Start a new garden in ${this.heads[slot - 1]!.name}? The garden saved there will be replaced.`, yes: 'Start a new garden', then: () => this.askClock(slot) };
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
      case 'alt': {
        const a = this.confirm?.alt;
        this.confirm = undefined;
        return a?.then();
      }
      case 'no':
        this.confirm = undefined;
        return this.render();
    }
  }

  /**
   * E23.7.1.2 (#446): a new garden asks how its days go: the game's own day (48 minutes of play), or the real clock
   * (only the sky, the light and solar follow it). Settings can switch it later.
   */
  private askClock(slot: Slot) {
    const own = { label: "The game's own day", then: () => this.host.start(slot, true, this.device, false) };
    const real = { label: 'Follow my clock', then: () => this.host.start(slot, true, this.device, true) };
    const [first, second] = this.host.preferRealClock?.() ? [real, own] : [own, real];
    this.confirm = {
      text: 'How should the days go?',
      detail: "The game's own day lasts 48 minutes of play. Following your clock, the sky and the sun keep your local time. Everything grows at the same pace either way, and Settings can switch it later.",
      yes: first.label,
      then: first.then,
      alt: second,
    };
    this.render();
  }

  private async reload(focusId?: string) {
    this.heads = await this.host.slots();
    this.render(focusId);
  }

  /** Back: closes the top thing (Settings, a question, a list). */
  private back() {
    if (this.host.settingsOpen()) return this.host.closeSettings();
    if (this.confirm) {
      this.confirm = undefined;
      return this.render();
    }
    if (this.view === 'play') {
      this.view = 'menu';
      this.renaming = undefined;
      this.render('tPlay');
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
    const onTab = !!(e.target as HTMLElement)?.closest?.('[role=tablist]') && (e.code === 'ArrowLeft' || e.code === 'ArrowRight');
    if (dpad[e.code] !== undefined && !onTab && !(e.target as HTMLElement)?.closest?.('select, input[type=range]')) {
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
