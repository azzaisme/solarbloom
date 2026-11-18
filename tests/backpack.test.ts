import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { MATERIAL_IDS } from '../src/data/salvage';
import { PAGES } from '../src/data/oldcity';
import { blueprintRows, collection, itemCells, journalPages, pinNext, pinnedRequest, pinRequest, requestRows, TABS } from '../src/ui/BackpackModel';
import { materialIcon, MATERIAL_ICON_IDS } from '../src/ui/MaterialIcons';
import { bannedIn } from '../src/ui/words';
import { SaveService } from '../src/app/SaveService';

/** E22.6 (#343): the backpack screen's contents, from E21's real data. */
function oldCity() {
  const sim = new Sim(createInitialState(11, 'oldcity'));
  const sv = sim.state.salvage!;
  sv.pack.copper = 32;
  sv.store.copper = 110;
  sv.keepers.pylon = { step: 'request1' };
  sv.keepers.tide = { step: 'request1' };
  return sim;
}

describe('E22.6: the backpack', () => {
  it('has the five tabs', () => {
    expect(TABS.map((t) => t.label)).toEqual(['Items', 'Requests', 'Journal', 'Collection', 'Blueprints']);
  });

  it('labels a material for screen readers and shows where it comes from and what needs it next', () => {
    const sim = oldCity();
    const copper = itemCells(sim).find((c) => c.id === 'copper')!;
    expect(copper.label).toBe('Copper, 32 of 40 in backpack, 110 in store');
    expect([copper.count, copper.limit, copper.stored]).toEqual([32, 40, 110]);
    expect(copper.from).toBe('Found in Mast Row');
    expect(copper.next).toMatch(/Copper|needs|takes|asks/i);
    expect(itemCells(sim).map((c) => c.id)).toEqual(MATERIAL_IDS);
  });

  it('keeps a material not found yet to itself', () => {
    const sunstone = itemCells(oldCity()).find((c) => c.id === 'sunstone')!;
    expect(sunstone.seen).toBe(false);
    expect(sunstone.name).toBe('Not found yet');
    expect(sunstone.label).not.toMatch(/sunstone/i);
    expect(sunstone.from).not.toMatch(/terraces/i);
  });

  it('every material icon has its own shape (nothing is told by colour alone)', () => {
    const shapes = new Set(MATERIAL_ICON_IDS.map((id) => materialIcon(id).replace(/class="mi mi-[a-z]+"/, '')));
    expect(shapes.size).toBe(MATERIAL_ICON_IDS.length);
    for (const m of MATERIAL_IDS) expect(MATERIAL_ICON_IDS).toContain(m);
  });

  it('lists every open request with its Keeper and region, and pins the one chosen', () => {
    const sim = oldCity();
    const rows = requestRows(sim);
    expect(rows.map((r) => [r.keeper, r.region, r.pinned])).toEqual([
      ['Pylon', 'Mast Row', true],
      ['Tide', 'Saltwind Beach', false],
    ]);
    pinRequest(sim, 'tide');
    expect(pinnedRequest(sim)?.id).toBe('tide');
    expect(requestRows(sim).find((r) => r.pinned)?.keeper).toBe('Tide');
    expect(pinNext(sim)?.keeper).toBe('Pylon'); // the "Pin next request" button cycles
    // a pin on a Keeper with nothing left to ask falls back to the first open request
    pinRequest(sim, 'tide');
    sim.state.salvage!.keepers.tide = { step: 'settled' };
    expect(pinnedRequest(sim)?.id).toBe('pylon');
  });

  it('the pin is presentation: it rides in the save without touching the simulation', () => {
    const a = oldCity();
    const b = oldCity();
    pinRequest(b, 'tide');
    for (let i = 0; i < 600; i++) {
      a.tick(0.1);
      b.tick(0.1);
    }
    const strip = (sim: Sim) => new SaveService(undefined).serialize({ ...sim.state, salvage: { ...sim.state.salvage!, seen: [] } }).replace(/"savedAt":\d+,?/, '');
    expect(strip(b)).toBe(strip(a));
  });

  it('shows the journal in book order with gaps for pages not found', () => {
    const sim = oldCity();
    sim.state.salvage!.pages = ['p-mastRow-1'];
    const pages = journalPages(sim);
    expect(pages.length).toBe(Object.keys(PAGES).length);
    expect(pages.filter((p) => p.found).map((p) => p.title)).toEqual(['Tram timetable']);
    expect(pages[0]).toMatchObject({ n: 1, found: false, title: 'A missing page' });
  });

  it('lists blueprints found and not', () => {
    const sim = oldCity();
    sim.state.salvage!.blueprints = ['packFrame'];
    const rows = blueprintRows(sim);
    expect(rows.find((r) => r.id === 'packFrame')).toMatchObject({ found: true, name: 'Pack Frame (+40 to every stack)' });
    expect(rows.filter((r) => !r.found).every((r) => r.name === 'Not found yet')).toBe(true);
  });

  it('the collection speaks plainly: no old cat-reward names, no banned words', () => {
    const sim = oldCity();
    sim.state.cat.found = 2;
    const text = JSON.stringify(collection(sim));
    for (const old of ['Lucky Harvest', 'Solar Surge', 'Mega Bloom', 'Drone Party', 'Jackpot', 'Golden Relay', "Cat's Garden", 'Fog Whisker']) expect(text).not.toContain(old);
    expect(collection(sim).map((g) => g.title)).toEqual(['Lucky Cats', 'Keepsakes', 'Wildlife', 'Landmarks', 'Plots', 'Decorations']);
    const words = [...collection(sim).flatMap((g) => [g.title, g.count, g.empty, ...g.rows.flatMap((r) => [r.name, r.detail])]), ...itemCells(sim).flatMap((c) => [c.label, c.from, c.next]), ...requestRows(sim).map((r) => r.text)];
    expect(words.filter((w) => bannedIn(w).length)).toEqual([]);
  });

  it('a classic game has no materials or requests to show', () => {
    const sim = new Sim(createInitialState(3, 'classic'));
    expect(itemCells(sim)).toEqual([]);
    expect(requestRows(sim)).toEqual([]);
    expect(collection(sim).length).toBe(6);
  });
});
