/**
 * Bloombot (G.7): gamepad navigation for the HUD's panels. While a panel is open and the pad is in use, the
 * d-pad moves a visible focus ring between its buttons and controls (spatially: the nearest one in that
 * direction), A presses the focused one, and B is left to Cancel (which closes the panel). With no panel open
 * the d-pad keeps its game actions (E23.11: in build mode d-pad left and right walk the build dock's slots).
 */
const PANELS = ['#settings.open', '#bpScreen.open', '#craftScreen.open', '#crateScreen.open', '#menu.open', '#ocPanel.open', '#catPanel:not([hidden])', '#plotPicker.open', '#buildMenu.open', '#inspect.open'] as const;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';
const DIRS: Partial<Record<number, [number, number]>> = { 12: [0, -1], 13: [0, 1], 14: [-1, 0], 15: [1, 0] };

export class PadFocus {
  /**
   * E23.11: a modal dialog over every panel (the are-you-sure, Confirm.ts) takes each pad press while it is open;
   * the panel under it, and the game, get none of them.
   */
  static modal?: { pad(i: number): boolean };

  constructor(
    private root: HTMLElement,
    private panels: readonly string[] = PANELS,
  ) {}

  /** The topmost open panel, if any. */
  panel(): HTMLElement | undefined {
    for (const sel of this.panels) {
      const el = this.root.querySelector<HTMLElement>(sel);
      if (el && shown(el)) return el;
    }
    return undefined;
  }

  private items(panel: HTMLElement): HTMLElement[] {
    return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => shown(e) && e.getBoundingClientRect().width > 0);
  }

  /**
   * Handles a pad button. True when the panel used it (the game should not also act on it).
   */
  button(i: number): boolean {
    if (PadFocus.modal) return PadFocus.modal.pad(i);
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
      const next = this.nearest(cur, trapped(cur, items), dir);
      if (next) {
        next.focus({ focusVisible: true } as FocusOptions);
        next.scrollIntoView({ block: 'nearest' });
      }
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
      // E22.4: in a table, left and right stay on the row (and up and down in the column) when anything does:
      // something in the same band beats anything off it, however near.
      const band = dx ? b.top < a.bottom - 2 && b.bottom > a.top + 2 : b.left < a.right - 2 && b.right > a.left + 2;
      const score = band ? along : along + across * 2.5 + 10000;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }
}

/**
 * #564: a group marked `data-pad-trap` (the build menu's slot picker) keeps the d-pad among its own buttons: a press
 * past its edge stays put instead of landing on something outside, where A would do something else (take the
 * piece instead of pinning it). B leaves the group as usual.
 */
export function trapped(cur: HTMLElement, items: readonly HTMLElement[]): HTMLElement[] {
  const trap = cur.closest('[data-pad-trap]');
  return trap ? items.filter((e) => trap.contains(e)) : [...items];
}

/**
 * #564: on screen (laid out, not display: none). Not `offsetParent`, which is always null for a position: fixed
 * element: the build menu is one, so the d-pad, the arrow keys and A never reached it.
 */
function shown(e: HTMLElement): boolean {
  return !e.hidden && e.getClientRects().length > 0;
}
