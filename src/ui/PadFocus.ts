/**
 * Bloombot (G.7): gamepad navigation for the HUD's panels. While a panel is open and the pad is in use, the
 * d-pad moves a visible focus ring between its buttons and controls (spatially: the nearest one in that
 * direction), A presses the focused one, and B is left to Cancel (which closes the panel). With no panel open
 * the d-pad keeps its game actions (E22.1: the hotbar is for the keyboard; the pad builds from the build menu).
 */
const PANELS = ['#modal.open', '#ocPanel.open', '#intro:not([hidden])', '#catPanel:not([hidden])', '#upgrades.open', '#plotPicker.open', '#backpack.open', '#buildTray.open', '#inspect.open'] as const;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';
const DIRS: Partial<Record<number, [number, number]>> = { 12: [0, -1], 13: [0, 1], 14: [-1, 0], 15: [1, 0] };

export class PadFocus {
  constructor(private root: HTMLElement) {}

  /** The topmost open panel, if any. */
  panel(): HTMLElement | undefined {
    for (const sel of PANELS) {
      const el = this.root.querySelector<HTMLElement>(sel);
      if (el && el.offsetParent !== null) return el;
    }
    const bar = this.root.querySelector<HTMLElement>('#hotbar');
    return bar && bar.contains(document.activeElement) ? bar : undefined;
  }

  private items(panel: HTMLElement): HTMLElement[] {
    return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0);
  }

  /**
   * Handles a pad button. True when the panel used it (the game should not also act on it). D-pad down with
   * nothing open focuses the hotbar.
   */
  button(i: number): boolean {
    const panel = this.panel();
    if (!panel) return false;
    const items = this.items(panel);
    const cur = items.includes(document.activeElement as HTMLElement) ? (document.activeElement as HTMLElement) : undefined;
    const dir = DIRS[i];
    if (dir) {
      if (!cur) {
        items[0]?.focus({ focusVisible: true } as FocusOptions);
        return true;
      }
      const next = this.nearest(cur, items, dir);
      if (next) {
        next.focus({ focusVisible: true } as FocusOptions);
        next.scrollIntoView({ block: 'nearest' });
      } else if (panel.id === 'hotbar' && dir[1] < 0) (document.activeElement as HTMLElement).blur();
      return true;
    }
    if (i === 0 && cur) {
      if (cur instanceof HTMLInputElement && cur.type === 'checkbox') cur.click();
      else if (cur instanceof HTMLInputElement && cur.type === 'range') {
        cur.stepUp();
        cur.dispatchEvent(new Event('input', { bubbles: true }));
      } else cur.click();
      return true;
    }
    if (i === 1 && panel.id === 'hotbar') {
      (document.activeElement as HTMLElement).blur();
      return true;
    }
    return false;
  }

  /** The closest focusable in a direction (by centre, favouring straight lines). */
  private nearest(from: HTMLElement, items: HTMLElement[], [dx, dy]: [number, number]): HTMLElement | undefined {
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: HTMLElement | undefined;
    let bestScore = Infinity;
    for (const e of items) {
      if (e === from) continue;
      const b = e.getBoundingClientRect();
      const vx = b.left + b.width / 2 - ax;
      const vy = b.top + b.height / 2 - ay;
      const along = vx * dx + vy * dy;
      if (along <= 2) continue;
      const across = Math.abs(vx * dy - vy * dx);
      const score = along + across * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }
}
