import { keyGlyph, padGlyph, type PadStyle } from './Glyphs';
import './confirm.css';

/**
 * E23.11: the are-you-sure dialog for a choice that can't be undone (start a garden over, delete it, quit without
 * saving). Sunlit Glass, after docs/art/ui-sunlit-glass/Confirm.dc.html:
 *
 * - role=alertdialog over a dimmed screen: a clay badge, the question, the thing at stake (its picture and facts),
 *   and one plain line that it goes for good;
 * - the safe button ("Keep my garden") is the primary one and has the focus when the dialog opens, so a quick A,
 *   Enter or click never deletes anything;
 * - the destructive button is clay and needs a hold of about a second (pad A, Enter or Space, or a mouse press) while
 *   a ring fills; letting go early empties the ring and nothing happens;
 * - B and Esc always back out (the same as the safe button).
 *
 * It is self-contained: it traps the keyboard while open (Tab and the arrows move between its two buttons) and
 * reads the pad's A itself for the hold. A host with its own pad loop hands it each new button press through
 * `pad(i)`. `result` settles once: true when the destructive choice was held to the end.
 */
export interface ConfirmSpec {
  /** the question, e.g. "Start Hillside garden over?" */
  title: string;
  /** the thing at stake: its name in bold, a line of facts, and an optional picture (classes for a div) */
  what?: { name: string; facts?: string; pictureClass?: string };
  /** the plain line: what goes, and that it can't be got back */
  body: string;
  /** the safe button, e.g. "Keep my garden" */
  keep: string;
  /** the destructive button, e.g. "Hold to start over" */
  go: string;
  /** how long the hold takes (ms) */
  holdMs?: number;
  /** the glyph set the footer names its buttons with */
  device?: 'keys' | 'pad';
  padStyle?: PadStyle;
  /** where it opens (default: the document body) */
  parent?: HTMLElement;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
let seq = 0;

/** The hold in progress, 0 … 1, after `ms` held of `holdMs`. */
export function holdProgress(ms: number, holdMs: number): number {
  return Math.max(0, Math.min(1, ms / Math.max(1, holdMs)));
}

export class Confirm {
  readonly el: HTMLElement;
  readonly result: Promise<boolean>;
  private settle!: (v: boolean) => void;
  private keepBtn: HTMLButtonElement;
  private goBtn: HTMLButtonElement;
  private ring: HTMLElement;
  private holdMs: number;
  /** what is holding the destructive button down now */
  private held = { key: false, pointer: false, pad: false };
  private heldMs = 0;
  private last = 0;
  private raf = 0;
  private padA = true; // treat A as down at first: the press that opened the dialog must be let go before it counts
  private closed = false;
  private onKeyDown = (e: KeyboardEvent) => this.keyDown(e);
  private onKeyUp = (e: KeyboardEvent) => this.keyUp(e);
  private onBlur = () => this.release();

  constructor(spec: ConfirmSpec) {
    this.holdMs = spec.holdMs ?? 1000;
    this.result = new Promise((r) => (this.settle = r));
    const n = ++seq;
    const glyph = (key: string, pad: number) => (spec.device === 'pad' ? padGlyph(spec.padStyle ?? 'xbox', pad) : keyGlyph(key));
    const w = spec.what;
    this.el = document.createElement('div');
    this.el.className = 'cf-veil';
    this.el.innerHTML =
      `<section class="cf" role="alertdialog" aria-modal="true" aria-labelledby="cfTitle${n}" aria-describedby="cfBody${n}">` +
      `<div class="cf-badge" aria-hidden="true"><span class="cf-ic"></span></div>` +
      `<h2 id="cfTitle${n}" class="cf-title">${esc(spec.title)}</h2>` +
      (w ? `<div class="cf-what">${w.pictureClass ? `<div class="cf-pic ${esc(w.pictureClass)}" aria-hidden="true"></div>` : ''}<p><b>${esc(w.name)}</b>${w.facts ? `<br>${esc(w.facts)}` : ''}</p></div>` : '') +
      `<p id="cfBody${n}" class="cf-body">${esc(spec.body)}</p>` +
      `<div class="cf-choices">` +
      `<button type="button" class="cf-keep" data-cf="keep"><span class="cf-heart" aria-hidden="true"></span>${esc(spec.keep)}</button>` +
      `<button type="button" class="cf-go" data-cf="go" aria-describedby="cfHow${n}"><span class="cf-ring" aria-hidden="true">${glyph('Enter', 0)}</span><span>${esc(spec.go)}</span></button>` +
      `<p id="cfHow${n}" class="cf-sr">Press and hold for a second. Letting go early does nothing.</p>` +
      `</div>` +
      `<footer class="cf-foot"><span class="cf-act">${glyph('Enter', 0)}Choose</span><span class="cf-act">${glyph('Escape', 1)}${esc(spec.keep)}</span></footer>` +
      `</section>`;
    (spec.parent ?? document.body).appendChild(this.el);
    this.keepBtn = this.el.querySelector<HTMLButtonElement>('.cf-keep')!;
    this.goBtn = this.el.querySelector<HTMLButtonElement>('.cf-go')!;
    this.ring = this.el.querySelector<HTMLElement>('.cf-ring')!;
    this.keepBtn.addEventListener('click', () => this.close(false));
    // the destructive button never acts on a click: only a hold finishes it
    this.goBtn.addEventListener('click', (e) => e.preventDefault());
    this.goBtn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.goBtn.focus({ focusVisible: true } as FocusOptions);
      try {
        this.goBtn.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer */
      }
      this.held.pointer = true;
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) this.goBtn.addEventListener(ev, () => (this.held.pointer = false));
    this.goBtn.addEventListener('blur', () => {
      this.held.key = false;
      this.held.pad = false;
    });
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    this.keepBtn.focus({ focusVisible: true } as FocusOptions);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Whether the dialog is still open. */
  get open(): boolean {
    return !this.closed;
  }

  /**
   * A new pad button press from a host's loop (the dialog is modal: it always uses it). D-pad moves between the
   * two buttons; A on the safe button keeps; B backs out. A on the destructive button is a hold, read each frame.
   */
  pad(i: number): boolean {
    if (this.closed) return true;
    if (i >= 12 && i <= 15) this.flip(i === 12 || i === 14 ? this.keepBtn : this.goBtn);
    else if (i === 1) this.close(false);
    else if (i === 0 && document.activeElement !== this.goBtn) this.close(false);
    return true;
  }

  /** Backs out (the host's Back, e.g. when something else closes it). */
  cancel() {
    this.close(false);
  }

  private flip(to?: HTMLButtonElement) {
    const next = to ?? (document.activeElement === this.keepBtn ? this.goBtn : this.keepBtn);
    if (next !== this.goBtn) this.release();
    next.focus({ focusVisible: true } as FocusOptions);
  }

  private release() {
    this.held = { key: false, pointer: false, pad: false };
  }

  private keyDown(e: KeyboardEvent) {
    if (this.closed) return;
    const c = e.code;
    const handled = ['Escape', 'Tab', 'Enter', 'NumpadEnter', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c);
    if (!handled) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (c === 'Escape') return this.close(false);
    if (c === 'Tab') return this.flip();
    if (c === 'ArrowUp' || c === 'ArrowLeft') return this.flip(this.keepBtn);
    if (c === 'ArrowDown' || c === 'ArrowRight') return this.flip(this.goBtn);
    // Enter / Space
    if (e.repeat) return;
    if (document.activeElement === this.goBtn) this.held.key = true;
    else this.close(false);
  }

  private keyUp(e: KeyboardEvent) {
    if (this.closed) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
      this.held.key = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  private tick = (now: number) => {
    if (this.closed) return;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    // the pad's A: a fresh press while the destructive button has the focus
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p?.connected);
    const a = !!gp?.buttons[0]?.pressed;
    if (a && !this.padA && document.activeElement === this.goBtn) this.held.pad = true;
    if (!a) this.held.pad = false;
    this.padA = a;
    const holding = this.held.key || this.held.pointer || this.held.pad;
    this.heldMs = holding ? this.heldMs + dt : 0;
    const p = holdProgress(this.heldMs, this.holdMs);
    this.ring.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
    this.goBtn.classList.toggle('holding', holding);
    if (p >= 1) return this.close(true);
    this.raf = requestAnimationFrame(this.tick);
  };

  private close(go: boolean) {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    this.el.remove();
    this.settle(go);
  }
}

/** Opens an are-you-sure dialog; resolves true when the destructive choice was held to the end. */
export function confirmHold(spec: ConfirmSpec): Confirm {
  return new Confirm(spec);
}
