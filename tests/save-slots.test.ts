import { describe, expect, it } from 'vitest';
import { dayPartAt, headerKey, SAVE_KEY, SaveService, slotKey, type Slot, type SlotHeader } from '../src/app/SaveService';
import { holdProgress } from '../src/ui/Confirm';
import { dayText, factsLine, fountainText } from '../src/ui/Title';
import { createInitialState, SAVE_VERSION } from '../src/core/GameState';
import { TIERS } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';

/** E22.12 (#350): three save slots, each with a small header beside it. */
function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}
const service = (store: ReturnType<typeof memory>, slot: Slot) => {
  const s = new SaveService(store, slot);
  s.now = () => 1_700_000_000_000;
  return s;
};

describe('E22.12: save slots', () => {
  it('moves the old single save into slot 1, once, with a header', async () => {
    const store = memory();
    const sim = new Sim(createInitialState(31));
    sim.state.time = 3725;
    store.setItem(SAVE_KEY, new SaveService(undefined).serialize(sim.state));
    const heads = await service(store, 1).slots();
    expect(store.data.has(SAVE_KEY)).toBe(false);
    expect(store.data.has(slotKey(1))).toBe(true);
    expect(heads[0]?.played).toBe(3725);
    expect(heads[0]?.name).toBe('Garden 1');
    expect(heads[0]?.version).toBe(SAVE_VERSION);
    expect(heads[0]?.old).toBe(false);
    expect([heads[1], heads[2]]).toEqual([undefined, undefined]);
    const r = service(store, 1).loadResult();
    expect(r.state?.seed).toBe(31);
  });

  it('never moves the old save over a slot 1 that is already there', () => {
    const store = memory();
    store.setItem(SAVE_KEY, 'old');
    store.setItem(slotKey(1), 'newer');
    expect(service(store, 1).migrateLegacy()).toBe(false);
    expect(store.getItem(slotKey(1))).toBe('newer');
  });

  it('saves and loads three slots independently, each with a header that matches its save', () => {
    const store = memory();
    for (const slot of [1, 2, 3] as Slot[]) {
      const sim = new Sim(createInitialState(100 + slot));
      sim.state.time = slot * 600;
      if (slot === 3) sim.state.salvage!.tier = 1;
      expect(service(store, slot).save(sim.state)).toBe(true);
    }
    for (const slot of [1, 2, 3] as Slot[]) {
      const s = service(store, slot);
      const st = s.loadResult().state!;
      expect(st.seed).toBe(100 + slot);
      const h = s.readHeader()!;
      expect(h.played).toBe(Math.round(st.time));
      expect(h.step).toBe(slot === 3 ? `Fountain: ${TIERS[0].name}` : 'The fountain is dry');
      expect(h.savedAt).toBe(1_700_000_000_000);
    }
  });

  it('renames and deletes a slot, leaving the others alone', async () => {
    const store = memory();
    for (const slot of [1, 2] as Slot[]) service(store, slot).save(new Sim(createInitialState(slot)).state);
    const s2 = service(store, 2);
    expect(s2.rename('  Rooftop garden  ')).toBe(true);
    expect(s2.readHeader()?.name).toBe('Rooftop garden');
    // a later save keeps the name
    s2.save(new Sim(createInitialState(2)).state);
    expect(s2.readHeader()?.name).toBe('Rooftop garden');
    service(store, 1).deleteSlot();
    expect(store.data.has(slotKey(1))).toBe(false);
    expect(store.data.has(headerKey(1))).toBe(false);
    const heads = await service(store, 1).slots();
    expect(heads.map((h) => h?.name)).toEqual([undefined, 'Rooftop garden', undefined]);
  });

  it('keeps each exact sketch once and clears it only with its garden', () => {
    const store = memory();
    const first = service(store, 1);
    const second = service(store, 2);
    const page = { seed: 39, title: 'Frog', note: 'It stayed still.', image: 'data:image/jpeg;base64,/9j/2Q==' };
    expect(first.keepSketch(page)).toBe(true);
    expect(first.keepSketch({ ...page, note: 'A repeated save' })).toBe(true);
    expect(service(store, 1).sketches()).toEqual([page]);
    expect(second.sketches()).toEqual([]);
    expect(second.keepSketch(page)).toBe(true);
    first.deleteSlot();
    expect(first.sketches()).toEqual([]);
    expect(second.sketches()).toEqual([page]);
  });

  it('keeps backups per slot', () => {
    const store = memory();
    store.setItem(slotKey(2), JSON.stringify({ ...new Sim(createInitialState(9)).state, version: 99 }));
    const r = service(store, 2).loadResult();
    expect(r.backedUpAs?.startsWith(`${slotKey(2)}.backup.`)).toBe(true);
  });

  it('the header carries what the game adds (the region bloombot is in)', () => {
    const store = memory();
    const s = service(store, 1);
    s.headerExtra = () => ({ region: 'The market' });
    s.save(new Sim(createInitialState(4)).state);
    expect(s.readHeader()?.region).toBe('The market');
  });

  it('E23.1.1: a garden from an earlier version is marked old, then starts fresh without errors', async () => {
    const store = memory();
    const sim = new Sim(createInitialState(12));
    const old = { ...JSON.parse(new SaveService(undefined).serialize(sim.state)), version: SAVE_VERSION - 1, rules: 'classic' };
    store.setItem(slotKey(2), JSON.stringify(old));
    // a header from before E23.1.1: no version, a rules field
    store.setItem(headerKey(2), JSON.stringify({ name: 'Garden 2', played: 540, step: 'The fountain is awake', region: 'The park', rules: 'classic', savedAt: 1 }));
    service(store, 1).save(new Sim(createInitialState(13)).state);
    const heads = await service(store, 1).slots();
    expect(heads[0]?.old).toBe(false);
    expect(heads[1]?.old).toBe(true);
    expect(heads[1]?.name).toBe('Garden 2');
    // loading it drops it calmly: no state, no backup, the slot is empty again
    const r = service(store, 2).loadResult();
    expect(r).toEqual({ scrapped: true });
    expect(store.data.has(slotKey(2))).toBe(false);
    expect([...store.data.keys()].some((k) => k.includes('.backup.'))).toBe(false);
    // and a compressed old save does the same
    store.setItem(slotKey(3), await new SaveService(undefined).serializeCompressed({ ...sim.state, version: 3 } as typeof sim.state));
    expect(await service(store, 3).loadResultAsync()).toEqual({ scrapped: true });
  });

  it('E23.1.1: the title can tell a save from an earlier version under a current header, without touching it', async () => {
    const store = memory();
    const sim = new Sim(createInitialState(12));
    service(store, 1).save(sim.state);
    // slot 2: a current header over an earlier version's save, plain; slot 3 the same, compressed
    const old = { ...JSON.parse(new SaveService(undefined).serialize(sim.state)), version: SAVE_VERSION - 1 };
    store.setItem(slotKey(2), JSON.stringify(old));
    store.setItem(headerKey(2), JSON.stringify({ name: 'Garden 2', played: 60, step: 'The fountain is dry', region: 'The park', version: SAVE_VERSION, savedAt: 2 }));
    store.setItem(slotKey(3), await new SaveService(undefined).serializeCompressed({ ...sim.state, version: 3 } as typeof sim.state));
    store.setItem(headerKey(3), JSON.stringify({ name: 'Garden 3', played: 60, step: 'The fountain is dry', region: 'The park', version: SAVE_VERSION, savedAt: 3 }));
    const heads = await service(store, 1).slots();
    expect([heads[1]?.old, heads[2]?.old]).toEqual([false, false]); // the cards can't tell: their headers are current
    expect(await service(store, 1).fromEarlierVersion()).toBe(false);
    expect(await service(store, 2).fromEarlierVersion()).toBe(true);
    expect(await service(store, 3).fromEarlierVersion()).toBe(true);
    // an empty slot or an unreadable save is not "earlier": loading those goes its own way (new garden, backup)
    store.removeItem(slotKey(3));
    expect(await service(store, 3).fromEarlierVersion()).toBe(false);
    store.setItem(slotKey(3), 'not a save');
    expect(await service(store, 3).fromEarlierVersion()).toBe(false);
    // asking changes nothing: the save is still there until a choice is made
    expect(store.getItem(slotKey(2))).toBe(JSON.stringify(old));
    expect(service(store, 2).loadResult()).toEqual({ scrapped: true });
  });
});

/** E23.11 (Sunlit Glass): what a slot card and the are-you-sure dialog say about a garden. */
describe('E23.11: the gardens screen', () => {
  it('the header carries the fountain steps done and the time of day it was left at', () => {
    const store = memory();
    const sim = new Sim(createInitialState(5));
    sim.state.salvage!.tier = 2;
    const s = service(store, 1);
    s.save(sim.state);
    const h = s.readHeader()!;
    expect(h.steps).toBe(2);
    expect(['morning', 'afternoon', 'evening', 'night']).toContain(h.daypart);
    // a new game starts on a fresh morning
    s.save(new Sim(createInitialState(6)).state);
    expect(s.readHeader()!.daypart).toBe('morning');
  });

  it('names the parts of the day by the clock', () => {
    expect([6, 11.9, 12, 16.9, 17, 20.9, 21, 2].map(dayPartAt)).toEqual(['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night']);
  });

  it('says the fountain as "Step 3 of 5", and the day with its time of day', () => {
    expect(fountainText({ steps: 0, step: 'The fountain is dry' })).toBe('Step 1 of 5');
    expect(fountainText({ steps: 2, step: 'Fountain: The pump turns' })).toBe('Step 3 of 5');
    expect(fountainText({ steps: 5, step: 'Fountain: The Great Bloom' })).toBe('All 5 steps done');
    // a header from before E23.11 keeps its words
    expect(fountainText({ step: 'Fountain: Water returns' })).toBe('Water returns');
    expect(dayText({ day: 14, daypart: 'morning' })).toBe('14 · morning');
    expect(dayText({ day: 3 })).toBe('3');
    expect(dayText({})).toBeUndefined();
  });

  it('sums a garden up in one line for the are-you-sure dialog, in plain words', () => {
    const h: SlotHeader = { name: 'Hillside garden', day: 14, played: 6 * 3600 + 20 * 60, step: 'Fountain: The pump turns', steps: 2, region: 'Tram stop', savedAt: 1 };
    expect(factsLine(h)).toBe('Day 14 · 6 hours 20 minutes played · Fountain step 3 of 5');
    expect(factsLine({ ...h, old: true })).toBe('From an earlier version of Solarbloom');
    for (const line of [factsLine(h), fountainText(h), dayText(h)!]) expect(line).not.toMatch(/\b(rate|cap|tier|combo|multiplier|buff|biomass|node|seam)\b|\/min|\d\s*\/\s*\d/i);
  });

  it('the destructive choice fills over a one-second hold, and only a full hold finishes it', () => {
    expect(holdProgress(0, 1000)).toBe(0);
    expect(holdProgress(350, 1000)).toBeCloseTo(0.35);
    expect(holdProgress(999, 1000)).toBeLessThan(1);
    expect(holdProgress(1000, 1000)).toBe(1);
    expect(holdProgress(5000, 1000)).toBe(1);
  });
});
