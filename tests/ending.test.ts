import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import { levelAt } from '../src/core/Height';
import { onCauseway } from '../src/core/OldCityLayout';
import { CAUSEWAY } from '../src/data/ending';
import { LAST_PAGE } from '../src/data/journal';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;

/** A game one delivery from the end: tier 4, every landmark awake, bloombot at the causeway's island end. */
function nearTheEnd() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.bot = { roofId: GROUND, x: 107.5, z: 0.5 };
  sim.state.salvage!.tier = 4;
  return sim;
}

/** What the last delivery does, without the 240 materials and two items it takes. */
function greatBloom(sim: Sim) {
  sim.state.salvage!.tier = 5;
  sim.bus.emit('fountain.tier', { tier: 5 });
}

describe('E23.9.3: the Great Bloom ending', () => {
  it('the Long Causeway runs from the east shore to the mainland\'s edge, level with the streets', () => {
    expect(onCauseway(CAUSEWAY.x0, 0)).toBe(true);
    expect(onCauseway(CAUSEWAY.x1, 0)).toBe(true);
    expect(onCauseway(CAUSEWAY.x0 - 1, 0)).toBe(false);
    expect(CAUSEWAY.x1 + 1).toBe(CAUSEWAY.mainlandX);
    for (let x = CAUSEWAY.x0; x <= CAUSEWAY.x1; x++) expect(levelAt(x, 0)).toBe(levelAt(CAUSEWAY.x0 - 1, 0));
    const sim = nearTheEnd();
    const t = sim.grid.get(GROUND, CAUSEWAY.x0 + 5, 0)!;
    expect(t.prop).toBe('causeway');
  });

  it('before the Great Bloom the causeway can\'t be walked; after it, it can, all the way to the mainland', () => {
    const sim = nearTheEnd();
    expect(sim.ending.bloomed).toBe(false);
    for (const x of [CAUSEWAY.x0, CAUSEWAY.x1]) expect(sim.ending.causewayOpen(x, 0)).toBe(false);
    greatBloom(sim);
    expect(sim.ending.bloomed).toBe(true);
    for (let x = CAUSEWAY.x0; x <= CAUSEWAY.x1; x++) expect(sim.ending.causewayOpen(x, 0), `x ${x}`).toBe(true);
    // the fog is off the way there
    expect(sim.areas.fog(sim.areas.map.areaOfCell(CAUSEWAY.x0, 0))).toBe('cleared');
  });

  it('wildlife floods back, his last page arrives, and the mainland hears about it once', () => {
    const sim = nearTheEnd();
    const events: unknown[] = [];
    sim.bus.on('ending.bloomed', (e) => events.push(e));
    greatBloom(sim);
    expect(Object.keys(sim.state.fauna ?? {}).sort()).toEqual(['birds', 'butterflies', 'koi', 'robots']);
    expect(sim.journal.found(LAST_PAGE)).toBe(true);
    expect(events).toEqual([{ causewayEnd: { x: CAUSEWAY.x1, z: 0 }, mainlandX: CAUSEWAY.mainlandX }]);
    expect(sim.ending.bloom()).toBe(false);
    expect(events.length).toBe(1);
  });

  it('the ending keeps through a save, byte for byte', () => {
    const sim = nearTheEnd();
    greatBloom(sim);
    const saver = new SaveService(undefined);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(saver.serialize(back.state)).toBe(json);
    expect(back.ending.bloomed).toBe(true);
    expect(back.ending.causewayOpen(CAUSEWAY.x0 + 3, 0)).toBe(true);
  });
});
