import { iconize } from './Icons';
import { $, esc, HudPart } from './HudPart';
import { calmToast } from './Pace';

/**
 * E22.5 (#342): toasts, bottom right. One at a time on the calm HUD (always under old-city rules); a toast with
 * the same headline as the one showing refreshes it instead of stacking. Material pick-ups merge: "+3 Copper"
 * then "+3 Copper" shows "+6 Copper".
 */
export class Toasts extends HudPart {
  /**
   * Toasts: at most two on screen. A toast with the same headline as one showing just refreshes it
   * (with a ×N count) instead of stacking, so a burst of area clears or chains stays calm.
   */
  toast(html: string, kind: '' | 'gold' | 'cat' = '', secs = 3.2) {
    const box = $(this.root, '#toasts');
    // E19.4.2: the calm HUD keeps one toast at a time, drops number-heavy detail lines and the repeat count.
    const calm = !this.settings.showNumbers || this.hud.oldCity;
    if (calm) html = calmToast(html);
    html = this.hud.words(html);
    const head = html.split('<small>')[0].replace(/[×x]\d+|\d+/g, '#');
    for (const c of Array.from(box.children) as HTMLElement[]) {
      if (c.dataset.head !== head || c.style.opacity === '0') continue;
      const n = Number(c.dataset.n ?? '1') + 1;
      c.dataset.n = String(n);
      if (!calm) c.innerHTML = iconize(`${html.replace('<small>', ` <b class="tn">×${n}</b><small>`)}${html.includes('<small>') ? '' : ` <b class="tn">×${n}</b>`}`);
      clearTimeout(Number(c.dataset.timer));
      c.dataset.timer = String(this.fadeLater(c, secs));
      return;
    }
    while (box.children.length >= (calm ? 1 : 2)) box.firstElementChild!.remove();
    const el = document.createElement('div');
    el.dataset.head = head;
    el.className = `toast panel ${kind}`;
    el.innerHTML = iconize(html);
    box.appendChild(el);
    el.dataset.timer = String(this.fadeLater(el, secs));
  }

  private fadeLater(el: HTMLElement, secs: number): number {
    return window.setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'scale(.96)'; // shrink in place: sliding up would overlap the toast above
      setTimeout(() => el.remove(), 600);
    }, secs * 1000);
  }

  feed(text: string) {
    const f = $(this.root, '#feed');
    while (f.children.length >= 4) f.firstElementChild!.remove();
    const el = document.createElement('div');
    el.innerHTML = iconize(esc(text));
    f.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 700);
    }, 2600);
  }

  /** E22.5: a material picked up ("+3 Copper"); the same material again while it shows adds to it. */
  pickup(name: string, n: number, secs = 2.6) {
    const box = $(this.root, '#toasts');
    const cur = Array.from(box.children).find((c) => (c as HTMLElement).dataset.pickup === name && (c as HTMLElement).style.opacity !== '0') as HTMLElement | undefined;
    const total = (cur ? Number(cur.dataset.n ?? '0') : 0) + n;
    if (cur) {
      cur.dataset.n = String(total);
      cur.textContent = `+${total} ${name}`;
      clearTimeout(Number(cur.dataset.timer));
      cur.dataset.timer = String(this.fadeLater(cur, secs));
      return;
    }
    while (box.children.length >= 1) box.firstElementChild!.remove();
    const el = document.createElement('div');
    el.className = 'toast panel pickup';
    el.dataset.pickup = name;
    el.dataset.n = String(total);
    el.textContent = `+${total} ${name}`;
    box.appendChild(el);
    el.dataset.timer = String(this.fadeLater(el, secs));
  }
}
