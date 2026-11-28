import { describe, expect, it } from 'vitest';
import { BUILDABLE } from '../src/data/machines';
import { KEEPERS } from '../src/data/oldcity';
import { BUILD_TAB, BUILD_TABS, buildItem, buildItems, buildTabs, costWords, HOTBAR_DEFAULT, shortWords, unlockText } from '../src/ui/BuildCatalog';
import { bannedIn } from '../src/ui/words';
import { makeSim, unlockAll } from './helpers';

/** E23.11 (#344): the build menu's catalogue, read from the real data. */
describe('E23.11: the build menu catalogue', () => {
  it('puts every buildable machine (and the pipe) under a tab', () => {
    for (const t of BUILDABLE) expect(BUILD_TABS.map((x) => x.id), t).toContain(BUILD_TAB[t]);
    expect(BUILD_TAB.pipe).toBe('water');
  });

  it('shows only the tabs that have something, in board order', () => {
    const sim = makeSim();
    unlockAll(sim);
    const items = buildItems(sim);
    const tabs = buildTabs(items).map((t) => t.label);
    expect(tabs[0]).toBe('Machines');
    expect(tabs).toEqual(expect.arrayContaining(['Power', 'Water', 'Farm', 'Storage', 'Decorations']));
    // a tab with nothing in it is left out
    expect(buildTabs(items.filter((i) => i.tab !== 'storage')).map((t) => t.id)).not.toContain('storage');
  });

  it('a locked piece says which Keeper to wake; an open one has its recipe as have-of-need', () => {
    const sim = makeSim();
    const solar = buildItem(sim, 'solar')!;
    expect(solar.locked).toBe(true);
    const k = KEEPERS.find((q) => q.region === 'oldMarket')!;
    expect(solar.lockText).toBe(`Wake ${k.name}`);
    unlockAll(sim, 1);
    const open = buildItem(sim, 'solar')!;
    expect(open.locked).toBe(false);
    expect(open.cost.length).toBeGreaterThan(0);
    for (const c of open.cost) expect(costWords(c)).toMatch(/^\d+ of \d+ \S/);
  });

  it('footpaths, roads and grass are under Ground: open from the start and free; the footpath is in the first hotbar', () => {
    const sim = makeSim(); // a new game: nothing unlocked
    const items = buildItems(sim);
    expect(buildTabs(items).map((t) => t.label)).toContain('Ground');
    for (const tool of ['footpath', 'road', 'grass'] as const) {
      const i = buildItem(sim, tool)!;
      expect([i.tab, i.locked, i.cost], tool).toEqual(['paths', false, []]);
      if (tool === 'footpath') expect(HOTBAR_DEFAULT).toContain(tool);
      expect(items.some((q) => q.tool === tool)).toBe(true);
    }
  });

  it('says what is short in plain words, never with a slash', () => {
    const cost = [
      { id: 'copper' as const, name: 'Copper', have: 1, need: 2 },
      { id: 'scrap' as const, name: 'Scrap', have: 4, need: 4 },
    ];
    expect(costWords(cost[0])).toBe('1 of 2 Copper');
    expect(shortWords(cost)).toBe('One more Copper.');
    expect(shortWords([{ id: 'wire' as const, name: 'Wire', have: 0, need: 2 }, cost[0]])).toBe('2 more Wire and one more Copper.');
    expect(shortWords([cost[1]])).toBe('');
  });

  it('every line, name and lock reads plainly (no banned words, no Lucky Cat hints)', () => {
    const sim = makeSim();
    unlockAll(sim);
    for (const i of buildItems(sim)) {
      const text = `${i.name} ${i.short} ${i.kind} ${i.line} ${i.lockText ?? ''} ${i.cost.map(costWords).join(' ')}`;
      expect(bannedIn(text), i.tool).toEqual([]);
      expect(text, i.tool).not.toMatch(/\//);
    }
    for (const u of [{ tier: 2 }, { research: 'x' }, { find: 'x' }, { home: true }] as const) expect(bannedIn(unlockText(u as never))).toEqual([]);
    // a decoration a Lucky Cat leaves is never listed before it is given
    expect(buildItems(makeSim()).some((i) => i.tool === 'decor:catstatue')).toBe(false);
  });

  it('the default hotbar holds real pieces (and empty slots)', () => {
    const sim = makeSim();
    expect(HOTBAR_DEFAULT).toHaveLength(9);
    for (const t of HOTBAR_DEFAULT) if (t) expect(buildItem(sim, t), t).toBeDefined();
  });

  it('the default hotbar keeps a free button, so the first gift decoration has somewhere to go (#782)', () => {
    // Game.offerDecor puts a gift on an empty button only: a full default bar would leave the Flower pot off it
    expect(HOTBAR_DEFAULT).toContain('');
    expect(HOTBAR_DEFAULT[8]).toBe('');
  });
});
