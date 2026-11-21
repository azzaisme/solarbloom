/**
 * Bloombot (G.7): gamepad navigation for the HUD's panels. While a panel is open and the pad is in use, the
 * d-pad moves a visible focus ring between its buttons and controls (spatially: the nearest one in that
 * direction), A presses the focused one, and B is left to Cancel (which closes the panel). With no panel open
 * the d-pad keeps its game actions (E23.11: in build mode d-pad left and right walk the build dock's slots).
 */
import { stepStepper } from './Stepper';

const PANELS = ['#settings.open', '#bpScreen.open', '#craftScreen.open', '#crateScreen.open', '#menu.open', '#ocPanel.open', '#catPanel:not([hidden])', '#plotPicker.open', '#buildMenu.open', '#inspect.open'] as const;
// a stepper's arrows are for the mouse: the stepper itself is the one stop (#616)
const FOCUSABLE = 'button:not([disabled]):not(.st-arrow), input:not([disabled]), select:not([disabled]), [tabindex="0"]';
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

  /** the panel open last frame, and how many more frames to try giving a new one its first focus */
  private seen?: HTMLElement;
  private tries = 0;

  /**
   * #616: call once a frame. When a menu opens (or another one comes on top) and nothing in it has the focus, its
   * first control gets it, ringed, so the pad and the keyboard always start somewhere they can see. A panel that
   * draws its controls a frame or two late (a machine's panel) is tried for a few frames.
   */
  tick(): void {
    const p = this.panel();
    if (p !== this.seen) {
      this.seen = p;
      this.tries = 12;
    }
    if (!p || this.tries <= 0) return;
    this.tries--;
    if (p.contains(document.activeElement) || this.focusFirst(p)) this.tries = 0;
  }

  /** The topmost open panel, if any. */
  panel(): HTMLElement | undefined {
    for (const sel of this.panels) {
      const el = this.root.querySelector<HTMLElement>(sel);
      if (el && shown(el)) return el;
    }
    return undefined;
  }

  private items(panel: HTMLElement): HTMLElement[] {
    // #616: of a row of tabs only the open one is a stop (up from the body lands on it); left and right there change tab.
    // A sheet's Back button isn't one either: B does it (the bar says so), and above a setting it beat the tabs.
    return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (e) => shown(e) && e.getBoundingClientRect().width > 0 && !(e.getAttribute('role') === 'tab' && e.getAttribute('aria-selected') === 'false') && e.getAttribute('data-back') === null,
    );
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
        (firstItem(items) ?? items[0])?.focus({ focusVisible: true } as FocusOptions);
        return true;
      }
      // #616: left and right on a tab open the tab beside it (as LB and RB do)
      if (dir[0] && cur.getAttribute('role') === 'tab') {
        const tabs = [...(cur.closest('[role=tablist]')?.querySelectorAll<HTMLElement>('[role=tab]') ?? [])].filter(shown);
        const next = tabs[tabs.indexOf(cur) + dir[0]];
        if (next) {
          next.click();
          if (document.activeElement !== next && shown(next)) next.focus({ focusVisible: true } as FocusOptions);
        }
        return true;
      }
      // #616: left and right change a stepper or a slider in place (up and down still leave it)
      if (dir[0] && cur.classList.contains('stepper')) {
        stepStepper(cur, dir[0]);
        return true;
      }
      if (dir[0] && cur instanceof HTMLInputElement && cur.type === 'range') {
        if (dir[0] > 0) cur.stepUp();
        else cur.stepDown();
        cur.dispatchEvent(new Event('input', { bubbles: true }));
        cur.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      // #616: in a table (Settings › Controls), left and right stay on the row: the next cell along it, or nowhere at
      // its end. (A row without a gamepad button used to send right to another row's cell, a row or two away.)
      const row = dir[0] ? cur.closest<HTMLElement>('[role=row]') : null;
      if (row) {
        const x = (e: HTMLElement) => e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2;
        const along = items.filter((e) => e !== cur && row.contains(e) && (x(e) - x(cur)) * dir[0] > 2).sort((p, q) => (x(p) - x(cur)) * dir[0] - (x(q) - x(cur)) * dir[0]);
        if (along[0]) {
          along[0].focus({ focusVisible: true } as FocusOptions);
          reveal(along[0]);
        }
        return true;
      }
      const next = this.nearest(cur, trapped(cur, items), dir);
      if (next) {
        next.focus({ focusVisible: true } as FocusOptions);
        reveal(next);
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

  /**
   * #616: puts the focus on a menu's sensible first control when it has none inside it: `[data-pad-first]` if the
   * menu marks one, else its selected card or cell, else the first control in its body (not the Back button or a
   * tab). `visible` shows the ring (true for the pad and the keyboard; the mouse needs none). True if it moved.
   */
  focusFirst(panel = this.panel(), visible = true): boolean {
    if (!panel || panel.contains(document.activeElement)) return false;
    const el = firstItem(this.items(panel));
    el?.focus({ focusVisible: visible } as FocusOptions);
    if (el) reveal(el);
    return !!el && document.activeElement === el;
  }

  /**
   * The closest focusable in a direction (by centre, favouring straight lines). #616: from a control in a ringed row
   * (a setting's toggle, at the row's far end) it goes from the row, which is what wears the ring: up from the first
   * setting is the open tab above it, not the Back button above the toggle.
   */
  private nearest(from: HTMLElement, items: HTMLElement[], [dx, dy]: [number, number]): HTMLElement | undefined {
    const a = (from.closest?.('[data-ring-host]') ?? from).getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    type C = { e: HTMLElement; along: number; across: number; band: boolean };
    const cands: C[] = [];
    for (const e of items) {
      if (e === from) continue;
      const b = e.getBoundingClientRect();
      const vx = b.left + b.width / 2 - ax;
      const vy = b.top + b.height / 2 - ay;
      const along = vx * dx + vy * dy;
      if (along <= 2) continue;
      const across = Math.abs(vx * dy - vy * dx);
      const band = dx ? b.top < a.bottom - 2 && b.bottom > a.top + 2 : b.left < a.right - 2 && b.right > a.left + 2;
      cands.push({ e, along, across, band });
    }
    if (!cands.length) return undefined;
    // #616: in a scrolled list, what has scrolled out of sight sits (on screen) behind the header above it: up from the
    // top card must go to the card above it in the list, not jump to the tabs. So a move stays in the focused
    // control's scrolling list while that list has anything that way; it leaves the list only from its ends.
    const list = scroller(from);
    if (list) {
      const inside = cands.filter((c) => list.contains(c.e));
      if (inside.length) cands.splice(0, cands.length, ...inside);
    }
    const near = Math.min(...cands.map((c) => c.along));
    const bandNear = Math.min(...cands.filter((c) => c.band).map((c) => c.along));
    // E22.4: in a table, left and right stay on the row (and up and down in the column) when anything does:
    // something in the same band beats anything off it, however near.
    // #573: ...within reach (about three of the focused control). A Back button in the top bar has another one far
    // below it in the bottom bar; that one must not beat the tabs and cards in between, so past reach the move goes
    // to the nearest row (or column) instead, to the one in it closest across.
    const size = dx ? a.width : a.height;
    const reach = Math.max(120, size * 3);
    if (bandNear !== Infinity && bandNear - near > reach) {
      const line = cands.filter((c) => c.along <= near + Math.max(16, size / 2));
      return line.reduce((m, c) => (c.across < m.across ? c : m)).e;
    }
    let best: HTMLElement | undefined;
    let bestScore = Infinity;
    for (const c of cands) {
      const score = c.band ? c.along : c.along + c.across * 2.5 + 10000;
      if (score < bestScore) {
        bestScore = score;
        best = c.e;
      }
    }
    return best;
  }
}

/**
 * #616: scrolls a control into its list so it shows: all of it, with room for its ring; or, when it is taller
 * than the list (a long card of the backpack's Collection), its top, so the player sees which one it is.
 */
export function reveal(el: HTMLElement): void {
  let box: HTMLElement | null = el.parentElement;
  while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement;
  const tall = !!box && box !== document.body && el.getBoundingClientRect().height > box.clientHeight - 32;
  el.scrollIntoView({ block: tall ? 'start' : 'nearest' });
}

/** The nearest box around `e` that scrolls (its content is taller than it), if any. */
function scroller(e: HTMLElement): HTMLElement | undefined {
  for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (p.scrollHeight > p.clientHeight + 1) return p;
  return undefined;
}

/** #616: a menu's first stop (see `PadFocus.focusFirst`). */
export function firstItem(items: readonly HTMLElement[]): HTMLElement | undefined {
  const marked = items.find((e) => e.matches('[data-pad-first]'));
  if (marked) return marked;
  const selected = items.find((e) => e.matches('[aria-selected=true]:not([role=tab]), .sel, [aria-pressed=true]:not([role=tab])'));
  if (selected) return selected;
  return items.find((e) => !e.matches('[role=tab], [data-back], .sheet-back, .pn-tab-end') && !e.closest('[role=tablist], .sheet-head, .sheet-foot')) ?? items[0];
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
