import { setPieceAt } from '../core/OldCityLayout';
import { JOURNAL, LAST_PAGE, PAGES } from '../data/journal';
import type { Sim } from './Sim';

/**
 * E23.9.1 (#402): the maker's journal. Its pages stand on posts in the park and in every region (data/oldcity),
 * so each stage of the story is only reachable once bloombot gets that far. Reading a post keeps the page in the
 * journal (`salvage.pages`); his last page comes with the Great Bloom (fountain tier 5).
 */
export class JournalSystem {
  constructor(private sim: Sim) {
    sim.bus.on('fountain.tier', ({ tier }) => {
      if (tier >= 5) this.read(LAST_PAGE);
    });
  }

  get on(): boolean {
    return !!this.sim.state.salvage;
  }

  /** The page on its post on a ground cell, if any (read or not: a read page can be read again). */
  pageAt(x: number, z: number): string | undefined {
    if (!this.on) return undefined;
    const sp = setPieceAt(x, z);
    if (sp?.kind !== 'page' || !PAGES[sp.id]) return undefined;
    if (sp.region && this.sim.areas.fog(sp.region) === 'hidden') return undefined;
    return sp.id;
  }

  found(id: string): boolean {
    return !!this.sim.state.salvage?.pages.includes(id);
  }

  /** Keeps a page in the journal. True the first time. */
  read(id: string): boolean {
    const sv = this.sim.state.salvage;
    if (!sv || !PAGES[id] || sv.pages.includes(id)) return false;
    sv.pages.push(id);
    this.sim.bus.emit('journal.page', { id });
    return true;
  }

  /** Pages found, out of all of them. */
  count(): { found: number; total: number } {
    return { found: JOURNAL.filter((p) => this.found(p.id)).length, total: JOURNAL.length };
  }
}
