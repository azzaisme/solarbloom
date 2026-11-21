import { $, esc, HudPart } from './HudPart';

/** How long a guide line stays (seconds), and its fade (ms). */
const SHOW_SECS = 9;
const FADE_MS = 500;

/**
 * #607 (E24): the guide's line, once per idea (GuideLines.ts decides which, and when). One short sentence in the
 * HUD's voice, centred low where the player is looking, just above the Interact prompt (it rides up when the
 * prompt grows), then it fades. Never a panel: nothing waits on it.
 */
export class GuideLine extends HudPart {
  private until = 0;
  private fadeAt = 0;

  private tallyUntil = 0;

  static template(): string {
    return (
      `<div id="guide" class="sg-card" role="status" aria-live="polite" hidden><span class="sg-badge sm" aria-hidden="true"><span class="sg-ic s i-sprout"></span></span><p id="guideText"></p></div>` +
      `<div id="tally" class="sg-card" aria-live="off" hidden><span class="tl-ic" id="tallyIc" aria-hidden="true">🌿</span><span id="tallyText"></span><span class="sg-bar" aria-hidden="true"><i id="tallyBar"></i></span></div>`
    );
  }

  /**
   * #608: a count where the player is looking ("Park 42 of 60"), for a moment after each tile it counts: just above
   * the prompt and the guide line.
   */
  tally(label: string, have: number, need: number, secs = 2.6) {
    this.chip('🌿', `${esc(label)} <b>${have} of ${need}</b>`, have / Math.max(1, need), secs);
  }

  /** #613: while bloombot rests at home, so the player knows to stand still: "⚡ Charging up" and how full. */
  charging(text: string, share: number) {
    this.chip('⚡', esc(text), share, 0.4);
  }

  private chip(icon: string, html: string, share: number, secs: number) {
    const el = $(this.root, '#tally');
    const ic = $(this.root, '#tallyIc');
    if (ic.textContent !== icon) ic.textContent = icon;
    const t = $(this.root, '#tallyText');
    if (t.innerHTML !== html) t.innerHTML = html;
    $(this.root, '#tallyBar').style.width = `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
    el.classList.toggle('done', share >= 1);
    el.hidden = false;
    this.tallyUntil = performance.now() + secs * 1000;
    this.place();
  }

  /** The tally showing now, if any. */
  get tallyText(): string | undefined {
    const el = $(this.root, '#tally');
    return el.hidden ? undefined : $(this.root, '#tallyText').textContent ?? undefined;
  }

  /** Shows a line (HTML: the words, with the player's own key or button as a glyph). */
  show(html: string, secs = SHOW_SECS) {
    const el = $(this.root, '#guide');
    $(this.root, '#guideText').innerHTML = html;
    this.lastText = $(this.root, '#guideText').textContent ?? '';
    el.classList.remove('out');
    el.hidden = false;
    this.until = performance.now() + secs * 1000;
    this.fadeAt = 0;
    this.place();
  }

  /** Fades the line now (its moment has passed). */
  hide() {
    const el = $(this.root, '#guide');
    if (el.hidden || this.fadeAt) return;
    el.classList.add('out');
    this.fadeAt = performance.now() + FADE_MS;
  }

  /** The last line shown, faded or not (tests read it). */
  lastText = '';

  /** The line showing now, if any (tests and shots read it). */
  get text(): string | undefined {
    const el = $(this.root, '#guide');
    return el.hidden ? undefined : $(this.root, '#guideText').textContent ?? undefined;
  }

  update() {
    const tally = $(this.root, '#tally');
    if (!tally.hidden && performance.now() > this.tallyUntil) tally.hidden = true;
    const el = $(this.root, '#guide');
    if (el.hidden) {
      if (!tally.hidden) this.place();
      return;
    }
    const now = performance.now();
    if (!this.fadeAt && now > this.until) {
      el.classList.add('out');
      this.fadeAt = now + FADE_MS;
    }
    if (this.fadeAt && now > this.fadeAt) {
      el.hidden = true;
      return;
    }
    this.place();
  }

  /** Just above the prompt (whatever its height), or where the prompt would sit when there is none. */
  private place() {
    const el = $(this.root, '#guide');
    this.fit(el);
    const p = $(this.root, '#prompt');
    const cs = p ? getComputedStyle(p) : undefined;
    const base = cs ? parseFloat(cs.bottom) || 26 : 26;
    const up = p && !p.hidden ? p.offsetHeight + 10 : 0;
    const bottom = `${Math.round(base + up)}px`;
    if (el.style.bottom !== bottom) el.style.bottom = bottom;
    const tally = $(this.root, '#tally');
    const over = `${Math.round(base + up + (el.hidden ? 0 : el.offsetHeight + 8))}px`;
    if (tally.style.bottom !== over) tally.style.bottom = over;
  }

  /**
   * Centred between the minimap (bottom left) and the dock (bottom right), never over either, nor over a toast beside
   * it: at a large interface size on a small screen the line wraps instead (1280 × 800 at 150%).
   */
  private fit(el: HTMLElement) {
    const box = (sel: string) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r && r.width > 0 && r.height > 0 ? r : undefined;
    };
    const me = el.getBoundingClientRect();
    const left = box('#minimap');
    const toasts = box('#toasts');
    const rights = [box('#dock'), toasts && me.height && toasts.bottom > me.top && toasts.top < me.bottom ? toasts : undefined];
    const mid = innerWidth / 2;
    const half = Math.min(left ? mid - left.right : mid, ...rights.map((r) => (r ? r.left - mid : mid))) - 14;
    const zoom = parseFloat(getComputedStyle(this.root).getPropertyValue('--ui-zoom')) || 1;
    const max = `${Math.min(560, Math.max(200, Math.floor((2 * half) / zoom)))}px`;
    if (el.style.maxWidth !== max) el.style.maxWidth = max;
  }
}
