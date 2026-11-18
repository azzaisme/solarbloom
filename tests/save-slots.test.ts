import { describe, expect, it } from 'vitest';
import { headerKey, SAVE_KEY, SaveService, slotKey, type Slot } from '../src/app/SaveService';
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
    const sim = new Sim(createInitialState(31, 'oldcity'));
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
      const sim = new Sim(createInitialState(100 + slot, 'oldcity'));
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
    for (const slot of [1, 2] as Slot[]) service(store, slot).save(new Sim(createInitialState(slot, 'oldcity')).state);
    const s2 = service(store, 2);
    expect(s2.rename('  Rooftop garden  ')).toBe(true);
    expect(s2.readHeader()?.name).toBe('Rooftop garden');
    // a later save keeps the name
    s2.save(new Sim(createInitialState(2, 'oldcity')).state);
    expect(s2.readHeader()?.name).toBe('Rooftop garden');
    service(store, 1).deleteSlot();
    expect(store.data.has(slotKey(1))).toBe(false);
    expect(store.data.has(headerKey(1))).toBe(false);
    const heads = await service(store, 1).slots();
    expect(heads.map((h) => h?.name)).toEqual([undefined, 'Rooftop garden', undefined]);
  });

  it('keeps backups per slot', () => {
    const store = memory();
    store.setItem(slotKey(2), JSON.stringify({ ...new Sim(createInitialState(9, 'oldcity')).state, version: 99 }));
    const r = service(store, 2).loadResult();
    expect(r.backedUpAs?.startsWith(`${slotKey(2)}.backup.`)).toBe(true);
  });

  it('the header carries what the game adds (the region bloombot is in)', () => {
    const store = memory();
    const s = service(store, 1);
    s.headerExtra = () => ({ region: 'The market' });
    s.save(new Sim(createInitialState(4, 'oldcity')).state);
    expect(s.readHeader()?.region).toBe('The market');
  });

  it('E23.1.1: a garden from an earlier version is marked old, then starts fresh without errors', async () => {
    const store = memory();
    const sim = new Sim(createInitialState(12, 'oldcity'));
    const old = { ...JSON.parse(new SaveService(undefined).serialize(sim.state)), version: SAVE_VERSION - 1, rules: 'classic' };
    store.setItem(slotKey(2), JSON.stringify(old));
    // a header from before E23.1.1: no version, a rules field
    store.setItem(headerKey(2), JSON.stringify({ name: 'Garden 2', played: 540, step: 'The fountain is awake', region: 'The park', rules: 'classic', savedAt: 1 }));
    service(store, 1).save(new Sim(createInitialState(13, 'oldcity')).state);
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
});
