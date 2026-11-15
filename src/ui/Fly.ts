import { fmt, type Big } from '../core/Big';
import type { ResourceKind } from '../core/types';

const ICON: Record<ResourceKind, string> = { energy: '⚡', water: '💧', biomass: '🌿' };

/** Pooled DOM "+2🌿" numbers that pop from a tile and fly into the HUD counter. */
export class FlyText {
  private pool: HTMLDivElement[] = [];
  private active = 0;
  reducedMotion = false;

  constructor(root: HTMLElement) {
    for (let i = 0; i < 28; i++) {
      const d = document.createElement('div');
      d.className = 'fly';
      d.style.display = 'none';
      root.appendChild(d);
      this.pool.push(d);
    }
  }

  spawn(kind: ResourceKind, amount: Big, from: { x: number; y: number }, to: DOMRect, onArrive?: () => void) {
    // Cap simultaneous flyers: past 8, the counter just flashes (keeps phones smooth during chains).
    const el = this.active < 8 ? this.pool.pop() : undefined;
    if (!el) {
      onArrive?.();
      return;
    }
    this.active++;
    el.textContent = `+${fmt(amount, 1)}${ICON[kind]}`;
    el.className = `fly ${kind}`;
    el.style.display = 'block';
    const tx = to.left + to.width / 2 - 10;
    const ty = to.top + to.height / 2 - 10;
    const finish = () => {
      el.style.display = 'none';
      this.pool.push(el);
      this.active--;
      onArrive?.();
    };
    if (this.reducedMotion || !el.animate) {
      el.style.transform = `translate(${from.x}px, ${from.y - 20}px)`;
      setTimeout(finish, 500);
      return;
    }
    const jx = (Math.random() - 0.5) * 30;
    const anim = el.animate(
      [
        { transform: `translate(${from.x}px, ${from.y}px) scale(.6)`, opacity: 0 },
        { transform: `translate(${from.x + jx}px, ${from.y - 34}px) scale(1.15)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${from.x + jx}px, ${from.y - 38}px) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${tx}px, ${ty}px) scale(.5)`, opacity: 0.6 },
      ],
      { duration: 950 + Math.random() * 200, easing: 'cubic-bezier(.5,0,.6,1)' },
    );
    anim.onfinish = finish;
    anim.oncancel = finish;
  }
}
