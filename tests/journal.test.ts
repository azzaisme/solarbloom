import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import { setPieceAt } from '../src/core/OldCityLayout';
import { JOURNAL, JOURNAL_STAGES, LAST_PAGE, PAGES } from '../src/data/journal';
import { PARK_SET, REGIONS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { journalPages } from '../src/ui/BackpackModel';

SaveService.clock = () => 0;

/** The stage a page's post belongs to, from where it stands. */
function placedStage(id: string): string | undefined {
  if (PARK_SET.pages.some((p) => p.id === id)) return 'arrival';
  const r = REGIONS.find((r) => r.pages.some((p) => p.id === id));
  return r ? `ring${r.ring}` : undefined;
}

describe('E23.9.1: the maker\'s journal', () => {
  it('every page is written, and every page but his last stands on a post in its stage\'s place', () => {
    const ids = JOURNAL.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of JOURNAL) {
      expect(p.title.length, p.id).toBeGreaterThan(0);
      expect(p.text.length, p.id).toBeGreaterThan(40);
      if (p.id === LAST_PAGE) expect(placedStage(p.id)).toBeUndefined();
      else expect(placedStage(p.id), p.id).toBe(p.stage);
    }
    const posts = [...PARK_SET.pages, ...REGIONS.flatMap((r) => r.pages)];
    for (const s of posts) expect(PAGES[s.id], s.id).toBeDefined();
    expect(posts.length).toBe(JOURNAL.length - 1);
  });

  it('the book runs in story order: arrival, ring 1, ring 2, ring 3, the Great Bloom', () => {
    const order = JOURNAL.map((p) => JOURNAL_STAGES.indexOf(p.stage));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(JOURNAL[0].text).toContain('Start with the park');
    expect(JOURNAL[JOURNAL.length - 1].id).toBe(LAST_PAGE);
    for (const st of JOURNAL_STAGES) expect(JOURNAL.some((p) => p.stage === st), st).toBe(true);
  });

  it('never names a person on the island or the mainland, and the maker is "he"', () => {
    const all = JOURNAL.map((p) => `${p.title} ${p.text}`).join(' ');
    expect(all).not.toMatch(/\bshe\b|\bher\b/i);
    expect(all).not.toMatch(/\bcat\b|lucky/i);
  });

  it('a page stands on its post in the world, is read with Interact, and keeps through a save', () => {
    const sim = new Sim(createInitialState(7, 'oldcity'));
    const [p] = PARK_SET.pages;
    expect(setPieceAt(p.x, p.z)).toMatchObject({ kind: 'page', id: p.id });
    expect(sim.grid.get(GROUND, p.x, p.z)?.prop).toBe(`page:${p.id}`);
    expect(sim.journal.pageAt(p.x, p.z)).toBe(p.id);
    expect(sim.journal.read(p.id)).toBe(true);
    expect(sim.journal.read(p.id)).toBe(false);
    expect(journalPages(sim).find((r) => r.id === p.id)).toMatchObject({ found: true, title: 'Start with the park' });
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.journal.found(p.id)).toBe(true);
  });

  it('a page in a region still under the clouds cannot be read yet', () => {
    const sim = new Sim(createInitialState(7, 'oldcity'));
    const pg = REGIONS.find((r) => r.id === 'glasshouse')!.pages[0];
    expect(sim.journal.pageAt(pg.x, pg.z)).toBeUndefined();
  });

  it('his last page comes with the Great Bloom', () => {
    const sim = new Sim(createInitialState(7, 'oldcity'));
    sim.bus.emit('fountain.tier', { tier: 4 });
    expect(sim.journal.found(LAST_PAGE)).toBe(false);
    sim.bus.emit('fountain.tier', { tier: 5 });
    expect(sim.journal.found(LAST_PAGE)).toBe(true);
  });
});
