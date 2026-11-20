// PadFocus: the d-pad / arrow keys move the focus ring between a panel's buttons, spatially. Tested on a small fake
// page laid out like the build menu (cards on the left, the detail pane with its slot picker on the right).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PadFocus } from '../src/ui/PadFocus';

type Box = { x: number; y: number; w: number; h: number };

class El {
  children: El[] = [];
  parent?: El;
  attrs: Record<string, string> = {};
  constructor(
    public name: string,
    public box: Box = { x: 0, y: 0, w: 0, h: 0 },
    public button = false,
  ) {}
  add(...c: El[]) {
    for (const e of c) {
      e.parent = this;
      this.children.push(e);
    }
    return this;
  }
  set(k: string, v = '') {
    this.attrs[k] = v;
    return this;
  }
  hidden = false;
  /** a position: fixed element (the build menu) has no offsetParent however it shows */
  fixed = false;
  get offsetParent(): El | null {
    return this.fixed ? null : (this.parent ?? null);
  }
  getClientRects() {
    for (let n: El | undefined = this; n; n = n.parent) if (n.hidden) return [];
    return [this.getBoundingClientRect()];
  }
  getBoundingClientRect() {
    const { x, y, w, h } = this.box;
    return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h };
  }
  focus() {
    doc.activeElement = this;
  }
  scrollIntoView() {}
  click() {
    clicks.push(this.name);
  }
  contains(e: El | null): boolean {
    for (let n: El | undefined = e ?? undefined; n; n = n.parent) if (n === this) return true;
    return false;
  }
  closest(sel: string): El | null {
    const attr = /^\[([\w-]+)\]$/.exec(sel)?.[1];
    for (let n: El | undefined = this; n; n = n.parent) if (attr ? attr in n.attrs : n.name === sel) return n;
    return null;
  }
  all(): El[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelectorAll() {
    return this.all().filter((e) => e.button);
  }
  querySelector(sel: string) {
    return sel === '#buildMenu.open' ? (this.all().find((e) => e.name === 'menu') ?? null) : null;
  }
}

const doc = { activeElement: null as El | null };
let clicks: string[] = [];
const had = (globalThis as Record<string, unknown>).document;
const hadInput = (globalThis as Record<string, unknown>).HTMLInputElement;

const btn = (name: string, x: number, y: number, w = 100, h = 60) => new El(name, { x, y, w, h }, true);

/** The build menu, roughly as it sits at 1280×800: a row of cards, the detail pane with the slot picker, Back and Build. */
function buildMenu(picking: boolean) {
  const root = new El('hud');
  const menu = new El('menu', { x: 80, y: 60, w: 1120, h: 680 });
  menu.fixed = true; // #buildMenu is position: fixed
  const head = new El('head').add(btn('backTop', 1080, 80, 90, 40));
  const cards = new El('cards').add(btn('card-cultivator', 100, 200, 150, 112), btn('card-hub', 260, 200, 150, 112), btn('card-assembler', 420, 200, 150, 112));
  const pick = new El('pick');
  if (picking) {
    pick.set('data-pad-trap');
    for (let i = 0; i < 9; i++) pick.add(btn(`slot${i + 1}`, 820 + (i % 5) * 70, 400 + Math.floor(i / 5) * 70, 60, 60));
  }
  const detail = new El('detail', { x: 800, y: 180, w: 380, h: 470 }).add(pick);
  const foot = new El('foot').add(btn('build', 900, 690, 110, 40), btn('backFoot', 1080, 690, 90, 40));
  menu.add(head, cards, detail, foot);
  root.add(menu);
  const by = (n: string) => root.all().find((e) => e.name === n)!;
  return { focus: new PadFocus(root as unknown as HTMLElement, ['#buildMenu.open']), by };
}

const LEFT = 14, RIGHT = 15, UP = 12, A = 0;

beforeEach(() => {
  clicks = [];
  doc.activeElement = null;
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  (globalThis as Record<string, unknown>).HTMLInputElement = class {}; // no inputs on this page
});
afterEach(() => {
  Object.defineProperty(globalThis, 'document', { value: had, configurable: true, writable: true });
  (globalThis as Record<string, unknown>).HTMLInputElement = hadInput;
});

describe('#564: the build menu takes the d-pad and A', () => {
  it('a position: fixed panel (the build menu) still counts as open', () => {
    const { focus, by } = buildMenu(false);
    by('card-cultivator').focus();
    expect(focus.panel()).toBeDefined();
    expect(focus.button(RIGHT)).toBe(true);
    expect(doc.activeElement?.name).toBe('card-hub');
    expect(focus.button(A)).toBe(true);
    expect(clicks).toEqual(['card-hub']);
  });

  it('a hidden panel does not', () => {
    const { focus, by } = buildMenu(false);
    by('menu').hidden = true;
    expect(focus.panel()).toBeUndefined();
    expect(focus.button(RIGHT)).toBe(false);
  });
});

describe('#564: the slot picker keeps the d-pad on its slots', () => {
  it('left past slot 1 stays on slot 1, so A pins there instead of taking a card', () => {
    const { focus, by } = buildMenu(true);
    by('slot1').focus();
    for (let i = 0; i < 6; i++) focus.button(LEFT);
    expect(doc.activeElement?.name).toBe('slot1');
    focus.button(A);
    expect(clicks).toEqual(['slot1']);
  });

  it('moves freely among the slots, and up from the top row stays in the picker', () => {
    const { focus, by } = buildMenu(true);
    by('slot1').focus();
    focus.button(RIGHT);
    expect(doc.activeElement?.name).toBe('slot2');
    focus.button(UP);
    expect(doc.activeElement?.name).toBe('slot2');
    focus.button(13); // down: the second row
    expect(doc.activeElement?.name).toBe('slot7');
  });

  it('outside a picker the d-pad still crosses the whole panel', () => {
    const { focus, by } = buildMenu(false);
    by('card-assembler').focus();
    focus.button(LEFT);
    expect(doc.activeElement?.name).toBe('card-hub');
    by('build').focus();
    focus.button(LEFT);
    expect(doc.activeElement?.name).not.toBe('build');
  });
});
