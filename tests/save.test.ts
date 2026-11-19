import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { Sim } from '../src/gameplay/Sim';
import { fill, makeSim, rich } from './helpers';

describe('save & progression', () => {
  it('round-trips tile state, machines and upgrades; rejects bad saves', () => {
    const saver = new SaveService(undefined);
    const sim = makeSim();
    rich(sim);
    fill(sim, 2, 2, 5, 5, 'restored');
    sim.build.place('condenser', 'r1', 3, 3);
    sim.upgrades.grant('solarArray');
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.progression.restoredCount('r1')).toBe(sim.progression.restoredCount('r1'));
    expect(copy.state.machines.length).toBe(sim.state.machines.length);
    expect(copy.upgrades.maxLevelOf('solarArray')).toBe(1); // Phase 5 E12: per-machine levels survive the round trip
    expect(saver.deserialize(JSON.stringify({ version: 999, rooftops: [] }))).toBeUndefined();
    expect(saver.deserialize('nope')).toBeUndefined();
  });

});

describe('save format v4', () => {
  it('discards a pre-city (v1–v3) save: the game starts fresh and says so', async () => {
    const { SaveService, SAVE_KEY } = await import('../src/app/SaveService');
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    for (const version of [1, 2, 3]) {
      store.set(SAVE_KEY, JSON.stringify({ version, seed: 5, rooftops: [], machines: [] }));
      const r = new SaveService(storage).loadResult();
      expect(r.scrapped).toBe(true);
      expect(r.state).toBeUndefined();
      expect(store.has(SAVE_KEY)).toBe(false);
    }
  });

  it('backs up a save from a newer version instead of overwriting it', async () => {
    const { SaveService, SAVE_KEY } = await import('../src/app/SaveService');
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const future = JSON.stringify({ ...makeSim().state, version: 99 });
    store.set(SAVE_KEY, future);
    const r = new SaveService(storage).loadResult();
    expect(r.state).toBeUndefined();
    expect(r.backedUpAs).toBeDefined();
    expect(store.get(r.backedUpAs!)).toBe(future);
  });
});
