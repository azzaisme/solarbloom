import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hud } from '../src/ui/Hud';

/**
 * #662: toasts that come together are each given time to be read, and nothing of Bloombot's lands under a Keeper's
 * bubble. The tests run without a page, so the toast box is a stand-in.
 */

/** Just enough of an element for Toasts: children, dataset, style, a remove(). */
class Box {
  children: Box[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = '';
  innerHTML = '';
  parent?: Box;
  get firstElementChild() {
    return this.children[0];
  }
  appendChild(c: Box) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  querySelector() {
    return { textContent: '' };
  }
}

let clock = 0;
async function toasts() {
  const box = new Box();
  (globalThis as { document?: unknown }).document = { createElement: () => new Box() };
  (globalThis as { window?: unknown }).window = globalThis;
  const { Toasts } = await import('../src/ui/Toasts');
  const hud = { root: { querySelector: () => box }, words: (s: string) => s } as unknown as Hud;
  const t = new Toasts(hud);
  t.now = () => clock;
  const showing = () => box.children.filter((c) => c.style.opacity !== '0').map((c) => c.dataset.head);
  return { t, box, showing };
}
const tick = (ms: number) => {
  clock += ms;
  vi.advanceTimersByTime(ms);
};

describe('#662: toasts wait their turn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('a park milestone, Bloombot growing and a new plot option each get read, in the order they came', async () => {
    const { t, showing } = await toasts();
    t.toast('💡 Three quarters of the way there<small>The lamps are lit again.</small>', 'gold', 4);
    t.toast('The park helped Bloombot grow: Nimble hands<small>Digging takes a quarter less time.</small>', 'gold', 5);
    t.toast('☕ New plot option: Café terrace<small>Tables and parasols.</small>', 'gold', 4.5);
    expect(showing()).toEqual(['💡 Three quarters of the way there']);
    expect(t.waiting()).toEqual(['The park helped Bloombot grow: Nimble hands', '☕ New plot option: Café terrace']);
    tick(1000);
    expect(showing()).toEqual(['💡 Three quarters of the way there']); // not cut short
    tick(1500);
    expect(showing()).toEqual(['The park helped Bloombot grow: Nimble hands']);
    tick(2500);
    expect(showing()).toEqual(['☕ New plot option: Café terrace']);
    expect(t.waiting()).toEqual([]);
  });

  it('a toast on its own shows at once, and so does one after the last was read', async () => {
    const { t, showing } = await toasts();
    t.toast('🔓 Mast Row is open!', 'gold', 4);
    expect(showing()).toEqual(['🔓 Mast Row is open!']);
    tick(3000);
    t.toast('Bloombot got better: Keen eye, level 1 of 3', 'gold', 3.5);
    expect(showing()).toEqual(['Bloombot got better: Keen eye, level # of #']);
    expect(t.waiting()).toEqual([]);
  });

  it('the same headline again refreshes the one showing, or the one waiting, and never doubles up', async () => {
    const { t, showing } = await toasts();
    t.toast('🔓 Mast Row is open!', 'gold', 4);
    t.toast('🔓 Mast Row is open!', 'gold', 4);
    expect(t.waiting()).toEqual([]);
    t.toast('Bloombot got better: Quick hands, level 1 of 3', 'gold', 3.5);
    t.toast('Bloombot got better: Quick hands, level 2 of 3', 'gold', 3.5);
    expect(t.waiting()).toEqual(['Bloombot got better: Quick hands, level # of #']);
    tick(2400);
    expect(showing()).toEqual(['Bloombot got better: Quick hands, level # of #']);
  });

  it('pick-ups that come while a toast is read add up while they wait', async () => {
    const { t, box } = await toasts();
    t.toast('🔓 Mast Row is open!', 'gold', 4);
    t.pickup('Copper', 3);
    t.pickup('Copper', 3);
    expect(t.waiting()).toEqual(['pickup:Copper']);
    tick(2400);
    expect(box.children[0].dataset.n).toBe('6');
  });

  it('never more than a few wait: the oldest goes first', async () => {
    const { t } = await toasts();
    t.toast('First', '', 3);
    for (const n of ['A', 'B', 'C', 'D', 'E']) t.toast(`Toast ${n}`, '', 3);
    expect(t.waiting()).toEqual(['Toast B', 'Toast C', 'Toast D', 'Toast E']);
  });
});

describe('#662: a Keeper talking holds Bloombot\'s moment', () => {
  async function bubble() {
    const el = { hidden: true, innerHTML: '', className: '', style: {} as Record<string, string>, offsetWidth: 200, offsetHeight: 80, offsetParent: { clientWidth: 1280 } };
    (globalThis as { document?: unknown }).document = { createElement: () => el };
    const { SpeechBubble } = await import('../src/ui/OldCityPanel');
    return new SpeechBubble({ appendChild: () => {} } as unknown as HTMLElement);
  }
  const ON = { x: 100, y: 100 };

  it('is speaking through both of a waking Keeper\'s bubbles, and not after', async () => {
    const b = await bubble();
    expect(b.speaking(0)).toBe(false);
    b.say('Tide', ['Tide, keeper of Saltwind Beach.'], 2, ['The sea always brings things back.'], 0);
    expect(b.speaking(1000)).toBe(true);
    b.place(ON, 2500); // the second bubble
    expect(b.speaking(3000)).toBe(true);
    b.place(ON, 10_000); // read
    expect(b.speaking(10_000)).toBe(false);
  });

  it('if Bloombot walks off before the second bubble, the wait ends after a few seconds', async () => {
    const b = await bubble();
    b.say('Tide', ['Tide, keeper of Saltwind Beach.'], 2, ['The sea always brings things back.'], 0);
    b.place(undefined, 2500);
    expect(b.speaking(2500)).toBe(true);
    expect(b.speaking(2000 + 4100)).toBe(false);
  });
});
