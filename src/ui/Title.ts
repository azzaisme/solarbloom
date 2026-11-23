import type { Slot, SlotHeader } from '../app/SaveService';
import { TIERS } from '../data/salvage';
import { lotusSvg } from '../rendering/Emblem';
import { Confirm } from './Confirm';
import { keyGlyph, padGlyph, type PadStyle } from './Glyphs';
import { playedText } from './Menu';
import { PadFocus } from './PadFocus';

/**
 * E22.12 (#350), restyled in E23.11 (Sunlit Glass, docs/art/ui-sunlit-glass/Title, Saves and Confirm): the splash
 * and the title screen.
 *
 * - Splash: the leaf badge and the wordmark on plain paper for up to 2 s; any input skips it.
 * - Title: the painted park (a still, src/ui/images) with a frosted pale strip over the left third. In its middle:
 *   the leaf badge, the Solarbloom wordmark, "Bring the island back to life", then "Press any button" until the
 *   first input (which picks the glyph set: keys or pad), then Play (focused), Settings, and Quit where the game
 *   can quit (the desktop and Deck build).
 * - Play opens "Your gardens": three slot cards, each with its picture, name, day and time of day, time played,
 *   the fountain's step ("Step 3 of 5") and where bloombot was last. The last-played card is tagged and its
 *   Carry on has the focus. A garden can be carried on, renamed (which asks first), started over or deleted; an
 *   empty card starts a new one, which asks how the days go. Start over and Delete open the are-you-sure dialog
 *   (Confirm.ts): "Keep my garden" first, the destructive choice only on a one-second hold.
 * - A garden from an earlier version (E23.1.1) can't be loaded: its card says so calmly and offers Start fresh
 *   (no are-you-sure: nothing playable is lost) or Delete. Start fresh asks the day-clock question like any new
 *   garden, and so does a Carry on whose save turns out to be from an earlier version under a current header.
 *
 * Everything works with the keyboard (Tab, arrows, Enter, Esc), the pad alone (the d-pad's focus ring, A to choose,
 * B to go back, Y to rename the focused garden) and the mouse. The title draws no 3D: it holds any frame limit.
 */
export interface TitleHost {
  slots(): Promise<(SlotHeader | undefined)[]>;
  /** start a slot (fresh: clear it first) */
  start(slot: Slot, fresh: boolean, device: 'keys' | 'pad', realClock?: boolean): void;
  /** E23.1.1: the slot's save is from an earlier version (its header can be current), so loading it starts fresh */
  earlierVersion?(slot: Slot): Promise<boolean>;
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
  /** the pad's glyph style (Xbox, PlayStation, Deck) for the button pictures */
  padStyle?(): PadStyle;
  /** the desktop and Deck build: Quit */
  quit?: () => void;
  reducedMotion: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The fountain's progress on a slot card: "Step 3 of 5" (the step under way), or the old header's words. */
export function fountainText(h: Pick<SlotHeader, 'steps' | 'step'>): string {
  const n = TIERS.length;
  if (h.steps === undefined) return h.step.replace(/^Fountain:\s*/, '');
  return h.steps >= n ? `All ${n} steps done` : `Step ${h.steps + 1} of ${n}`;
}

/** The day line on a slot card: "14 · morning" (the time of day only when the header has it). */
export function dayText(h: Pick<SlotHeader, 'day' | 'daypart'>): string | undefined {
  if (h.day === undefined) return undefined;
  return h.daypart ? `${h.day} · ${h.daypart}` : String(h.day);
}

/** The garden's facts on one line, for the are-you-sure dialog. */
export function factsLine(h: SlotHeader): string {
  if (h.old) return 'From an earlier version of Solarbloom';
  const f = fountainText(h);
  return [h.day !== undefined ? `Day ${h.day}` : '', `${playedText(h.played)} played`, /^Step /.test(f) ? `Fountain step ${f.slice(5)}` : `Fountain: ${f}`].filter(Boolean).join(' · ');
}

/** The picture's look: a garden further along is greener (the painted park, washed out while the fountain is dry). */
const picClass = (h: SlotHeader) => `t-pic p${Math.max(0, Math.min(TIERS.length, h.old ? 0 : (h.steps ?? 0)))}`;

interface Ask {
  text: string;
  yes: string;
  then: () => void;
  detail?: string;
  alt?: { label: string; then: () => void };
}

export class Title {
  readonly el: HTMLElement;
  private heads: (SlotHeader | undefined)[] = [];
  private device: 'keys' | 'pad' = 'keys';
  private woke = false;
  private focus: PadFocus;
  private padPrev: boolean[] = [];
  private raf = 0;
  /** a plain question (rename, the day clock): Sunlit Glass card, nothing destructive */
  private confirm?: Ask;
  /** the are-you-sure dialog for Start over and Delete */
  private hold?: Confirm;
  private view: 'press' | 'menu' | 'play' = 'press';
  private renaming?: Slot;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(private host: TitleHost) {
    this.el = document.createElement('div');
    this.el.id = 'title';
    this.el.className = host.reducedMotion ? 'still' : '';
    document.body.appendChild(this.el);
    this.focus = new PadFocus(this.el, ['#settings.open', '.t-confirm', '.t-gardens', '.t-menu']);
    this.el.addEventListener('click', (e) => this.click(e));
    window.addEventListener('keydown', this.onKey);
  }

  /** The splash: up to 2 s, any key, click or pad button skips it. */
  splash(): Promise<void> {
    const s = document.createElement('div');
    s.id = 'splash';
    s.innerHTML = `<div class="sp-logo" role="img" aria-label="Solarbloom">${BADGE}<span>Solarbloom</span></div>`;
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
    this.hold?.cancel();
    this.el.remove();
  }

  /** The most recently saved slot (the last played). */
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

  private padStyle(): PadStyle {
    return this.host.padStyle?.() ?? 'xbox';
  }

  /** A button's picture in the glyph set in use: a key or a pad button. */
  private glyph(key: string, pad: number): string {
    return this.device === 'pad' ? padGlyph(this.padStyle(), pad) : keyGlyph(key);
  }

  private render(focusId?: string) {
    const art = `<div class="t-art" aria-hidden="true"></div>`;
    let html = art;
    if (this.view === 'play') html += this.gardensHtml();
    else {
      const brand = `<div class="t-brand">${BADGE}<h1 class="t-logo">Solarbloom</h1><p class="t-tagline">Bring the island back to life</p></div>`;
      const body =
        this.view === 'press'
          ? `<button class="t-press" id="tPress">Press any button</button>`
          : `<nav class="t-menu" aria-label="Main menu">` +
            `<button id="tPlay" class="t-btn primary" data-t="play">${ICON.play}Play</button>` +
            `<button id="tSettings" class="t-btn" data-t="settings">${ICON.gear}Settings</button>` +
            (this.host.quit ? `<button id="tQuit" class="t-btn" data-t="quit">${ICON.door}Quit</button>` : '') +
            `</nav>`;
      html += `<div class="t-side">${brand}${body}</div><p class="t-note">Early build · saves on this device</p>`;
    }
    if (this.confirm) html += this.askHtml(this.confirm);
    // Keep Settings (if open) where it is: it lives in its own element. So does the are-you-sure dialog.
    const keep = [...this.el.querySelectorAll<HTMLElement>(':scope > #settings, :scope > .cf-veil')];
    this.el.innerHTML = html;
    this.el.dataset.view = this.view;
    for (const k of keep) this.el.appendChild(k);
    if (this.hold?.open) return;
    const target = focusId ? this.el.querySelector<HTMLElement>(`#${focusId}`) : this.confirm ? this.el.querySelector<HTMLElement>(this.confirm.alt ? '#tYes' : '#tNo') : this.el.querySelector<HTMLElement>(this.view === 'play' ? this.slotFocus() : '.t-side button');
    target?.focus({ focusVisible: true } as FocusOptions);
  }

  /** The gardens' first focus: Carry on on the last-played garden, else the first card's first button. */
  private slotFocus(): string {
    const latest = this.latest();
    return latest ? `#tLoad${latest}` : '.t-slot button';
  }

  private askHtml(c: Ask): string {
    const yes = `<button id="tYes" class="t-btn${c.alt ? '' : ' primary'}" data-t="yes">${esc(c.yes)}</button>`;
    const alt = c.alt ? `<button id="tAlt" class="t-btn" data-t="alt">${esc(c.alt.label)}</button>` : '';
    return (
      `<div class="t-scrim" aria-hidden="true"></div>` +
      `<section class="t-confirm${c.alt ? ' t-choice' : ''}" role="dialog" aria-modal="true" aria-labelledby="tConfirmText">` +
      `<div class="t-ask"><h2 id="tConfirmText">${esc(c.text)}</h2>${c.detail ? `<p class="t-detail">${esc(c.detail)}</p>` : ''}</div>` +
      `<div class="t-ask-btns">${yes}${alt}<button id="tNo" class="t-btn quiet" data-t="no">Cancel</button></div>` +
      `<footer class="t-acts"><span class="t-act">${this.glyph('Enter', 0)}Choose</span><span class="t-act">${this.glyph('Escape', 1)}Cancel</span></footer>` +
      `</section>`
    );
  }

  private gardensHtml(): string {
    const latest = this.latest();
    const cards = this.heads
      .map((h, i) => {
        const slot = (i + 1) as Slot;
        if (!h)
          return (
            `<article class="t-slot empty" data-slot="${slot}" aria-label="Garden ${slot}, empty">` +
            `<div class="t-badge sun big" aria-hidden="true">${ICON.seed}</div>` +
            `<h3>Start a new garden</h3><p class="t-soft">You'll pick how the days go before you begin.</p>` +
            `<button id="tStart${slot}" class="t-btn" data-t="start" data-slot="${slot}">Start</button></article>`
          );
        if (h.old)
          return (
            `<article class="t-slot old" data-slot="${slot}" aria-label="Garden ${slot}, ${esc(h.name)}, from an earlier version">` +
            `<div class="${picClass(h)}" aria-hidden="true"><span class="t-tag">Earlier version</span></div>` +
            `<div class="t-info"><h3>${esc(h.name)}</h3>` +
            `<p class="t-soft">This garden grew in an earlier version of Solarbloom. It starts fresh here.</p>` +
            `<div class="t-btns"><button id="tLoad${slot}" class="t-btn primary" data-t="fresh" data-slot="${slot}">${ICON.seed}Start fresh</button>` +
            `<div class="t-row"><button id="tDelete${slot}" class="t-btn quiet clay" data-t="delete" data-slot="${slot}">Delete</button></div></div></div></article>`
          );
        const isLatest = slot === latest;
        const name =
          this.renaming === slot
            ? `<div class="t-rename"><label for="tName${slot}">Name</label><div class="t-row"><input id="tName${slot}" maxlength="40" value="${esc(h.name)}" autocomplete="off" spellcheck="false"><button id="tSaveName${slot}" class="t-btn" data-t="saveName" data-slot="${slot}">Save name</button></div></div>`
            : `<h3>${esc(h.name)}</h3>`;
        const day = dayText(h);
        const facts =
          `<dl class="t-facts">` +
          (day ? `<dt>Day</dt><dd>${esc(day)}</dd>` : '') +
          `<dt>Played</dt><dd>${esc(playedText(h.played))}</dd>` +
          `<dt>Fountain</dt><dd>${esc(fountainText(h))}</dd>` +
          `<dt>Last seen</dt><dd>${esc(h.region)}</dd>` +
          `</dl>`;
        const actions =
          `<div class="t-btns"><button id="tLoad${slot}" class="t-btn${isLatest ? ' primary' : ''}" data-t="loadSlot" data-slot="${slot}">${ICON.play}Carry on</button>` +
          `<div class="t-row"><button id="tRename${slot}" class="t-btn" data-t="rename" data-slot="${slot}">Rename</button>` +
          `<button id="tStart${slot}" class="t-btn quiet clay" data-t="start" data-slot="${slot}">Start over</button>` +
          `<button id="tDelete${slot}" class="t-btn quiet clay" data-t="delete" data-slot="${slot}">Delete</button></div></div>`;
        return (
          `<article class="t-slot${isLatest ? ' latest' : ''}" data-slot="${slot}" aria-label="Garden ${slot}, ${esc(h.name)}${isLatest ? ', last played' : ''}">` +
          `<div class="${picClass(h)}" aria-hidden="true">${isLatest ? `<span class="t-tag">${ICON.star}Last played</span>` : ''}</div>` +
          `<div class="t-info">${name}${facts}${actions}</div></article>`
        );
      })
      .join('');
    const canRename = this.heads.some((h) => h && !h.old);
    return (
      `<section class="t-gardens" aria-labelledby="tGardensTitle">` +
      `<div class="t-veil" aria-hidden="true"></div>` +
      `<header class="t-head"><div class="t-badge" aria-hidden="true">${ICON.sprout}</div><div><h2 id="tGardensTitle">Your gardens</h2><p class="t-soft">Pick a garden to carry on, or start a new one.</p></div></header>` +
      `<div class="t-slot-list">${cards}</div>` +
      `<footer class="t-acts t-gardens-foot">` +
      `<span class="t-act">${this.glyph('Enter', 0)}Choose</span>` +
      (canRename && this.device === 'pad' ? `<span class="t-act">${padGlyph(this.padStyle(), 3)}Rename</span>` : '') +
      `<button id="tBack" class="t-act" data-t="back">${this.glyph('Escape', 1)}Back</button>` +
      `</footer></section>`
    );
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
    if (!b || this.hold?.open) return;
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
        return this.toMenu();
      case 'loadSlot':
        return void this.load(slot);
      case 'fresh': // E23.1.1: an earlier version's garden starts a new one, which asks about the day clock like any new garden
        return this.askClock(slot);
      case 'start':
        if (!this.heads[slot - 1]) return this.askClock(slot);
        return this.areYouSure(slot, 'start');
      case 'rename':
        return this.rename(slot);
      case 'saveName':
        return this.saveName(slot);
      case 'delete':
        return this.areYouSure(slot, 'delete');
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

  private toMenu() {
    this.view = 'menu';
    this.renaming = undefined;
    this.render('tPlay');
  }

  private rename(slot: Slot) {
    const h = this.heads[slot - 1];
    if (!h || h.old) return;
    this.renaming = slot;
    this.render(`tName${slot}`);
    this.el.querySelector<HTMLInputElement>(`#tName${slot}`)?.select();
  }

  private saveName(slot: Slot) {
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
    this.render();
  }

  /**
   * E23.11: Start over and Delete ask first, in the are-you-sure dialog: "Keep my garden" has the focus, the
   * destructive choice needs a one-second hold, and B or Esc backs out. Backing out returns the focus to the button.
   */
  private areYouSure(slot: Slot, what: 'start' | 'delete') {
    const h = this.heads[slot - 1];
    if (!h) return;
    const back = `${what === 'start' ? 'tStart' : 'tDelete'}${slot}`;
    this.hold = new Confirm({
      title: what === 'start' ? `Start ${h.name} over?` : `Delete ${h.name}?`,
      what: { name: h.name, facts: factsLine(h), pictureClass: picClass(h) },
      body:
        what === 'start'
          ? "Everything in this garden goes away for good: your builds, your backpack and your friends' progress. A new garden starts in its place. You can't get it back."
          : "Everything in this garden goes away for good: your builds, your backpack and your friends' progress. You can't get it back.",
      keep: 'Keep my garden',
      go: what === 'start' ? 'Hold to start over' : 'Hold to delete',
      device: this.device,
      padStyle: this.padStyle(),
      parent: this.el,
    });
    const c = this.hold;
    void c.result.then((go) => {
      if (this.hold === c) this.hold = undefined;
      if (!this.el.isConnected) return;
      if (!go) return this.el.querySelector<HTMLElement>(`#${back}`)?.focus({ focusVisible: true } as FocusOptions);
      if (what === 'start') return this.askClock(slot);
      this.host.remove(slot);
      void this.reload(`tStart${slot}`);
    });
  }

  /**
   * E23.1.1: Carry on. A save from an earlier version under a current header can't be told from the card, so a
   * Carry on that would start fresh says so in the new-garden question, which it asks like every new garden.
   */
  private async load(slot: Slot) {
    if (await this.host.earlierVersion?.(slot)) return this.askClock(slot, 'This garden grew in an earlier version of Solarbloom, so a new one starts here.');
    this.host.start(slot, false, this.device);
  }

  /**
   * E23.7.1.2 (#446): a new garden asks how its days go: the game's own day (48 minutes of play), or the real clock
   * (only the sky, the light and solar follow it). Settings can switch it later.
   */
  private askClock(slot: Slot, why?: string) {
    const own = { label: "The game's own day", then: () => this.host.start(slot, true, this.device, false) };
    const real = { label: 'Follow my clock', then: () => this.host.start(slot, true, this.device, true) };
    const [first, second] = this.host.preferRealClock?.() ? [real, own] : [own, real];
    this.confirm = {
      text: 'How should the days go?',
      detail: `${why ? `${why} ` : ''}The game's own day lasts 48 minutes of play. Following your clock, the sky and the sun keep your local time. Everything grows at the same pace either way, and Settings can switch it later.`,
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

  /** Back: closes the top thing (Settings, the are-you-sure dialog, a question, a rename, the gardens). */
  private back() {
    if (this.host.settingsOpen()) return this.host.closeSettings();
    if (this.hold?.open) return this.hold.cancel();
    if (this.confirm) {
      this.confirm = undefined;
      return this.render();
    }
    if (this.view === 'play' && this.renaming) {
      const s = this.renaming;
      this.renaming = undefined;
      return this.render(`tRename${s}`);
    }
    if (this.view === 'play') this.toMenu();
  }

  private key(e: KeyboardEvent) {
    if (!this.el.isConnected) return;
    if (!this.woke) {
      e.preventDefault();
      return this.wake('keys');
    }
    if (this.hold?.open) return; // the dialog reads its own keys
    if (this.device !== 'keys' && !e.repeat && e.code !== 'Escape') {
      this.device = 'keys'; // the button pictures follow the device in use (after this key has done its job)
      requestAnimationFrame(() => this.relabel());
    }
    const field = e.target instanceof HTMLInputElement && e.target.type === 'text';
    if (e.code === 'Escape') {
      e.preventDefault();
      return this.back();
    }
    if (field) {
      const slot = Number(e.target.id.replace('tName', '')) as Slot;
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && slot) {
        e.preventDefault();
        this.saveName(slot);
      }
      return;
    }
    const dpad: Record<string, number> = { ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15 };
    const onTab = !!(e.target as HTMLElement)?.closest?.('[role=tablist]') && (e.code === 'ArrowLeft' || e.code === 'ArrowRight');
    if (dpad[e.code] !== undefined && !onTab && !(e.target as HTMLElement)?.closest?.('select, input[type=range]')) {
      e.preventDefault();
      this.focus.button(dpad[e.code]);
    } else if (this.host.settingsOpen() && (e.code === 'KeyQ' || e.code === 'KeyE')) this.host.settingsTab?.(e.code === 'KeyE' ? 1 : -1);
  }

  /** Redraws the footers' button pictures for the device in use, keeping the focus where it is. */
  private relabel() {
    if (this.view === 'press' || this.host.settingsOpen()) return;
    const id = (document.activeElement as HTMLElement | null)?.id;
    const field = this.el.querySelector<HTMLInputElement>('.t-rename input');
    const text = field?.value;
    this.render(id && this.el.contains(document.activeElement) ? id : undefined);
    const again = this.el.querySelector<HTMLInputElement>('.t-rename input');
    if (again && text !== undefined) again.value = text;
  }

  /** The pad: the first press wakes the title; the d-pad and A move and press; B goes back; Y renames; LB / RB change tab. */
  private loop() {
    const tick = () => {
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = [...pads].find((p) => p?.connected);
      if (gp)
        gp.buttons.forEach((b, i) => {
          if (b.pressed && !this.padPrev[i]) this.pad(i);
          this.padPrev[i] = b.pressed;
        });
      if (this.woke) this.focus.tick(); // #616: a menu that just opened starts with its first control in focus
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** The pad's buttons on the title (also driven directly by tests). */
  pad(i: number) {
    if (!this.woke) return this.wake('pad');
    if (this.device !== 'pad') {
      this.device = 'pad';
      if (!this.hold?.open && !this.listener) this.relabel();
    }
    if (this.listener) return this.listener(i);
    if (this.hold?.open) return void this.hold.pad(i);
    if (i === 3 && this.view === 'play' && !this.confirm && !this.renaming && !this.host.settingsOpen()) {
      const slot = Number((document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.t-slot')?.dataset.slot);
      if (slot) return this.rename(slot as Slot);
    }
    if (this.focus.button(i)) return;
    if (i === 1) this.back();
    else if ((i === 4 || i === 5) && this.host.settingsOpen()) this.host.settingsTab?.(i === 5 ? 1 : -1);
  }

  /** Settings › Controls waits for a pad button through here. */
  listener?: (i: number) => void;
}

/** Stroke icons drawn with the text colour (masks, like the design's .ic). */
const icon = (name: string) => `<span class="t-ic t-ic-${name}" aria-hidden="true"></span>`;
const ICON = { play: icon('play'), gear: icon('gear'), door: icon('door'), seed: icon('seed'), sprout: icon('sprout'), star: icon('star'), leaf: icon('leaf') };
/** The logo badge: the Solarbloom lotus (the same lotus the waymark carries) in a leaf-shaped tile (round with one sharp corner). */
const BADGE = `<div class="t-badge logo" aria-hidden="true">${lotusSvg()}</div>`;

function anyPadButton(): boolean {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  return [...pads].some((p) => p?.connected && p.buttons.some((b) => b.pressed));
}
