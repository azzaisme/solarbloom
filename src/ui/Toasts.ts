import { iconize } from './Icons';
import { $, esc, HudPart } from './HudPart';
import { calmToast } from './Pace';
import { MATERIALS } from '../data/salvage';
import type { MaterialId } from '../core/types';
import { MATERIAL_ICON_IDS, materialIcon, type MaterialIconId } from './MaterialIcons';

/** A toast's leading emoji (its picture), if it starts with one. */
const LEAD = /^\s*(\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*)\s*/u;

/**
 * E22.5 (#342) / E23.11: toasts, bottom right above the shortcut dock: paper cards with a leaf badge
 * (docs/art/ui-sunlit-glass/Walk.dc.html). One at a time on the calm HUD; a toast with the same headline as the one
 * showing refreshes it instead of stacking. Material pick-ups merge: "+3 Copper" then "+3 Copper" shows "+6 Copper",
 * with the material's own mark in the badge.
 *
 * #662: each toast gets READ_SECS on screen before another may take its place. One that comes sooner waits its turn
 * (a park milestone, Bloombot growing and a new plot option used to wipe each other out in the same second).
 */
export class Toasts extends HudPart {
  /** how long a toast is left alone before the next one may replace it (its own time if that's shorter) */
  static readonly READ_SECS = 2.4;
  /** at most this many wait; past that the oldest is dropped */
  static readonly QUEUE_MAX = 4;
  private queue: { head: string; run: () => void; pickup?: string; n?: number }[] = [];
  private readUntil = 0;
  private drainTimer = 0;
  /** the clock (a test's own) */
  now = () => performance.now();

  /**
   * A toast. A toast with the same headline as one showing just refreshes it instead of stacking, so a burst of
   * area clears stays calm. A leading emoji becomes the badge's picture; gold toasts get a sun badge.
   */
  toast(html: string, kind: '' | 'gold' | 'cat' = '', secs = 3.2) {
    const box = $(this.root, '#toasts');
    // E19.4.2 / E22.10: the calm HUD drops number-heavy detail lines and the repeat count (numbers live in panels).
    html = calmToast(html);
    html = this.hud.words(html);
    const head = html.split('<small>')[0].replace(/[×x]\d+|\d+/g, '#');
    for (const c of Array.from(box.children) as HTMLElement[]) {
      if (c.dataset.head !== head || c.style.opacity === '0') continue;
      clearTimeout(Number(c.dataset.timer));
      c.dataset.timer = String(this.fadeLater(c, secs));
      return;
    }
    const lead = LEAD.exec(html);
    const pic = lead ? iconize(lead[1]) : `<span class="sg-ic s ${kind === 'gold' ? 'i-spark' : kind === 'cat' ? 'i-heart' : 'i-sprout'}"></span>`;
    const body = lead ? html.slice(lead[0].length) : html;
    const inner = `<span class="sg-badge sm" aria-hidden="true">${pic}</span><span class="tb">${iconize(body)}</span>`;
    this.enqueue({ head, run: () => this.show(box, `toast sg-card ${kind}`, inner, head, secs) });
  }

  /** #662: what's waiting its turn, by headline (for tests). */
  waiting(): string[] {
    return this.queue.map((q) => q.head);
  }

  /** Shows it now if the toast up has been read, else after it (the same headline waiting is replaced, not doubled). */
  private enqueue(item: { head: string; run: () => void; pickup?: string; n?: number }) {
    if (!this.queue.length && this.now() >= this.readUntil) return item.run();
    const same = this.queue.findIndex((q) => q.head === item.head);
    if (same >= 0) this.queue[same] = item;
    else this.queue.push(item);
    while (this.queue.length > Toasts.QUEUE_MAX) this.queue.shift();
    this.drainLater();
  }

  private drainLater() {
    clearTimeout(this.drainTimer);
    if (!this.queue.length) return;
    this.drainTimer = window.setTimeout(() => {
      this.queue.shift()?.run();
      this.drainLater();
    }, Math.max(0, this.readUntil - this.now()));
  }

  private show(box: HTMLElement, cls: string, inner: string, head: string, secs: number): HTMLElement {
    this.readUntil = this.now() + Math.min(secs, Toasts.READ_SECS) * 1000;
    while (box.children.length >= 1) box.firstElementChild!.remove();
    const el = document.createElement('div');
    el.dataset.head = head;
    el.className = cls;
    el.innerHTML = inner;
    box.appendChild(el);
    el.dataset.timer = String(this.fadeLater(el, secs));
    return el;
  }

  private fadeLater(el: HTMLElement, secs: number): number {
    return window.setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'scale(.96)'; // shrink in place: sliding would overlap the toast above
      setTimeout(() => el.remove(), 600);
    }, secs * 1000);
  }

  /** E22.5: a material picked up ("+3 Copper"); the same material again while it shows adds to it. */
  pickup(name: string, n: number, secs = 2.6) {
    const box = $(this.root, '#toasts');
    const cur = Array.from(box.children).find((c) => (c as HTMLElement).dataset.pickup === name && (c as HTMLElement).style.opacity !== '0') as HTMLElement | undefined;
    const total = (cur ? Number(cur.dataset.n ?? '0') : 0) + n;
    if (cur) {
      cur.dataset.n = String(total);
      $(cur, '.tb').textContent = `+${total} ${name}`;
      clearTimeout(Number(cur.dataset.timer));
      cur.dataset.timer = String(this.fadeLater(cur, secs));
      return;
    }
    // #662: the same material already waiting its turn just adds to it
    const queued = this.queue.find((q) => q.pickup === name);
    if (queued) {
      queued.n = (queued.n ?? 0) + n;
      return;
    }
    const id = (Object.keys(MATERIALS) as MaterialId[]).find((k) => MATERIALS[k].name === name);
    const mark = id && (MATERIAL_ICON_IDS as string[]).includes(id) ? materialIcon(id as MaterialIconId, 20) : `<span class="sg-ic s i-sprout"></span>`;
    const item: { head: string; run: () => void; pickup?: string; n?: number } = {
      head: `pickup:${name}`,
      pickup: name,
      n: total,
      run: () => {
        const el = this.show(box, 'toast sg-card pickup', `<span class="sg-badge sm" aria-hidden="true">${mark}</span><span class="tb">${esc(`+${item.n} ${name}`)}</span>`, `pickup:${name}`, secs);
        el.dataset.pickup = name;
        el.dataset.n = String(item.n);
      },
    };
    this.enqueue(item);
  }
}
