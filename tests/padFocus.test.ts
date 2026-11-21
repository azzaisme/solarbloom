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
  classes = new Set<string>();
  get classList() {
    return { contains: (c: string) => this.classes.has(c) };
  }
  /** only attribute tests ("[data-pad-first]", "[role=tab]") and classes (".sel") mean anything here */
  matches(sel: string): boolean {
    return sel.split(',').some((part) => {
      const p = part.trim().replace(/:not\([^)]*\)/g, '');
      const attr = /^\[([\w-]+)(?:=([\w"]+))?\]$/.exec(p);
      if (attr) return attr[1] in this.attrs && (attr[2] === undefined || this.attrs[attr[1]] === attr[2].replace(/"/g, ''));
      if (p.startsWith('.')) return this.classes.has(p.slice(1));
      return false;
    });
  }
  /** a scrolling list: content taller than the box */
  scrollHeight = 0;
  clientHeight = 0;
  get parentElement(): El | undefined {
    return this.parent;
  }
  getAttribute(k: string): string | null {
    return k in this.attrs ? this.attrs[k] : null;
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
  const tabs = new El('tabs').add(...['machines', 'power', 'water', 'farm', 'storage', 'decorations'].map((t, i) => btn(`tab-${t}`, 140 + i * 105, 135, 95, 40)));
  const cards = new El('cards').add(btn('card-cultivator', 100, 200, 150, 112), btn('card-hub', 260, 200, 150, 112), btn('card-assembler', 420, 200, 150, 112));
  const pick = new El('pick');
  if (picking) {
    pick.set('data-pad-trap');
    for (let i = 0; i < 9; i++) pick.add(btn(`slot${i + 1}`, 820 + (i % 5) * 70, 400 + Math.floor(i / 5) * 70, 60, 60));
  }
  const detail = new El('detail', { x: 800, y: 180, w: 380, h: 470 }).add(pick);
  const foot = new El('foot').add(btn('build', 900, 690, 110, 40), btn('backFoot', 1080, 690, 90, 40));
  menu.add(head, tabs, cards, detail, foot);
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

describe('#573: Up and Down from a Back button reach the menu, not the other Back button', () => {
  it('Down from the top Back goes into the menu (the tab row, then the cards), never to the bottom bar', () => {
    const { focus, by } = buildMenu(false);
    by('backTop').focus();
    focus.button(13);
    expect(doc.activeElement?.name).toMatch(/^tab-/);
    focus.button(13);
    expect(doc.activeElement?.name).toMatch(/^card-/);
  });

  it('Up from the bottom Back goes to the cards above it', () => {
    const { focus, by } = buildMenu(false);
    by('backFoot').focus();
    focus.button(UP);
    expect(doc.activeElement?.name).toMatch(/^card-/);
  });

  it('a table keeps its column: down goes to the next row in the same column, not a nearer one beside it', () => {
    const root = new El('hud');
    const menu = new El('menu', { x: 0, y: 0, w: 800, h: 600 });
    // two columns of rows 60 apart; the right column's rows sit a little higher (nearer) than the left's
    menu.add(btn('l1', 0, 0, 200, 40), btn('l2', 0, 60, 200, 40), btn('r1', 300, 0, 200, 40), btn('r2', 300, 40, 200, 40));
    root.add(menu);
    const focus = new PadFocus(root as unknown as HTMLElement, ['#buildMenu.open']);
    root.all().find((e) => e.name === 'l1')!.focus();
    focus.button(13);
    expect(doc.activeElement?.name).toBe('l2');
  });

  it('in a table, left and right stay on the row, and stop at its end', () => {
    const root = new El('hud');
    const menu = new El('menu', { x: 0, y: 0, w: 1200, h: 800 });
    // Interact has both cells; Pulse below has a wider key cell, so its centre sits right of Interact's key
    const r1 = new El('[role=row]', { x: 0, y: 400, w: 1200, h: 60 }).set('role', 'row').add(btn('interact-key', 780, 410, 64, 46), btn('interact-pad', 980, 410, 64, 46));
    const r2 = new El('[role=row]', { x: 0, y: 470, w: 1200, h: 60 }).set('role', 'row').add(btn('pulse-key', 780, 470, 106, 46));
    menu.add(r1, r2);
    root.add(menu);
    const focus = new PadFocus(root as unknown as HTMLElement, ['#buildMenu.open']);
    const by = (n: string) => root.all().find((e) => e.name === n)!;
    by('interact-key').focus();
    focus.button(RIGHT);
    expect(doc.activeElement?.name).toBe('interact-pad');
    focus.button(RIGHT); // the row's end: stays
    expect(doc.activeElement?.name).toBe('interact-pad');
    by('pulse-key').focus();
    focus.button(RIGHT); // no gamepad cell on this row: stays, never jumps to another row
    expect(doc.activeElement?.name).toBe('pulse-key');
  });
});

/** A stepper as Stepper.ts draws it, on the fake page: its value, its label and its two arrows. */
function stepperEl(name: string, x: number, y: number, value: string) {
  const e = new El(name, { x, y, w: 220, h: 44 }, true) as El & { dataset: Record<string, string>; dispatchEvent(ev: Event): boolean };
  e.classes.add('stepper');
  e.dataset = { value, options: JSON.stringify([['80', 'Small'], ['100', 'Normal'], ['150', 'Large']]) };
  const val = { textContent: '' };
  const arrows = [{ disabled: false }, { disabled: false }];
  const changes: string[] = [];
  Object.assign(e, {
    setAttribute: (k: string, v: string) => (e.attrs[k] = v),
    querySelector: () => val,
    querySelectorAll: () => arrows,
    dispatchEvent: (ev: Event) => (changes.push(`${ev.type}:${e.dataset.value}`), true),
  });
  return { e, val, arrows, changes };
}

describe('#616: steppers and the first focus', () => {
  const page = () => {
    const root = new El('hud');
    const menu = new El('menu', { x: 0, y: 0, w: 800, h: 600 });
    const back = btn('back', 680, 10, 90, 40).set('data-back');
    const tab = btn('tab', 20, 60, 90, 40).set('role', 'tab');
    const s = stepperEl('scale', 400, 140, '100');
    const below = btn('below', 400, 220, 220, 44);
    menu.add(back, tab, s.e, below);
    root.add(menu);
    return { root, focus: new PadFocus(root as unknown as HTMLElement, ['#buildMenu.open']), s, by: (n: string) => root.all().find((x) => x.name === n)! };
  };

  it('left and right change a stepper in place; up and down still leave it', () => {
    const { focus, s, by } = page();
    s.e.focus();
    focus.button(RIGHT);
    expect(s.e.dataset.value).toBe('150');
    expect(s.val.textContent).toBe('Large');
    expect(s.changes).toEqual(['change:150']);
    expect(doc.activeElement).toBe(s.e);
    focus.button(RIGHT); // at its last choice: stays, no change
    expect(s.changes).toEqual(['change:150']);
    expect(s.arrows[1].disabled).toBe(true);
    focus.button(LEFT);
    focus.button(LEFT);
    expect(s.e.dataset.value).toBe('80');
    expect(s.arrows[0].disabled).toBe(true);
    focus.button(13);
    expect(doc.activeElement).toBe(by('below'));
  });

  it('a menu with nothing in focus starts on its first control in the body: not Back, not a tab', () => {
    const { focus, s } = page();
    expect(focus.focusFirst()).toBe(true);
    expect(doc.activeElement).toBe(s.e);
  });

  it('a menu can name its first stop, and a selected card beats the first one', () => {
    const { focus, by } = page();
    by('below').set('data-pad-first');
    focus.focusFirst();
    expect(doc.activeElement).toBe(by('below'));
    const p2 = page();
    p2.by('below').classes.add('sel');
    doc.activeElement = null;
    p2.focus.focusFirst();
    expect(doc.activeElement).toBe(p2.by('below'));
  });

  it('tick gives a menu that just opened its first focus once, and leaves a menu the player has moved in alone', () => {
    const { focus, by, s } = page();
    focus.tick();
    expect(doc.activeElement).toBe(s.e);
    by('below').focus();
    focus.tick();
    expect(doc.activeElement).toBe(by('below'));
  });

  it('of a row of tabs only the open one is a stop: up from the body lands on it, and left and right change tab', () => {
    const root = new El('hud');
    const menu = new El('menu', { x: 0, y: 0, w: 800, h: 600 });
    const list = new El('[role=tablist]').set('role', 'tablist');
    const tabs = ['a', 'b', 'c'].map((t, i) => btn(`tab-${t}`, 100 + i * 200, 60, 150, 40).set('role', 'tab').set('aria-selected', String(t === 'c')));
    list.add(...tabs);
    // the body's first row sits right under the first tab: without the rule, up would land on that closed tab
    const row = btn('row', 80, 160, 200, 44);
    menu.add(list, row);
    root.add(menu);
    const focus = new PadFocus(root as unknown as HTMLElement, ['#buildMenu.open']);
    row.focus();
    focus.button(UP);
    expect(doc.activeElement?.name).toBe('tab-c');
    focus.button(LEFT);
    expect(clicks).toEqual(['tab-b']);
    expect(doc.activeElement?.name).toBe('tab-b');
  });

  it('in a scrolled list, up from the top card goes to the card scrolled out of sight above it, not to the tabs', () => {
    const root = new El('hud');
    const menu = new El('menu', { x: 0, y: 0, w: 800, h: 600 });
    const tab = btn('tab', 300, 60, 150, 40).set('role', 'tab').set('aria-selected', 'true');
    const list = new El('list', { x: 0, y: 120, w: 800, h: 300 });
    list.scrollHeight = 1200;
    list.clientHeight = 300;
    // scrolled down: card "above" sits at y -300 on screen, behind the header; "top" is the first one in view
    list.add(btn('above', 20, -300, 760, 140), btn('top', 20, 140, 760, 140));
    menu.add(tab, list);
    root.add(menu);
    const focus = new PadFocus(root as unknown as HTMLElement, ['#buildMenu.open']);
    root.all().find((e) => e.name === 'top')!.focus();
    focus.button(UP);
    expect(doc.activeElement?.name).toBe('above');
    // the list scrolls it into view (reveal), under the tabs; it is the list's first, so up now leaves the list
    const above = root.all().find((e) => e.name === 'above')!;
    above.box = { x: 20, y: 140, w: 760, h: 140 };
    root.all().find((e) => e.name === 'top')!.box = { x: 20, y: 300, w: 760, h: 140 };
    focus.button(UP);
    expect(doc.activeElement?.name).toBe('tab');
  });
});
