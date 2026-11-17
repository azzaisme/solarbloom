import { describe, expect, it } from 'vitest';
import { headerKey, SAVE_KEY, SaveService, slotKey, type Slot } from '../src/app/SaveService';
import { createInitialState } from '../src/core/GameState';
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
    expect(heads[0]?.rules).toBe('classic');
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
      if (slot === 3) sim.state.progression.coreActivated = true;
      expect(service(store, slot).save(sim.state)).toBe(true);
    }
    for (const slot of [1, 2, 3] as Slot[]) {
      const s = service(store, slot);
      const st = s.loadResult().state!;
      expect(st.seed).toBe(100 + slot);
      const h = s.readHeader()!;
      expect(h.played).toBe(Math.round(st.time));
      expect(h.step).toBe(slot === 3 ? 'The fountain is awake' : 'The fountain is asleep');
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
});
