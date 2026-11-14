import { describe, expect, it } from 'vitest';
import { SaveService, SAVE_KEY } from '../src/app/SaveService';
import { createInitialState } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';

/** A storage that is full: every write throws the browser's quota error, reads still work. */
function fullStorage(): Storage {
  const data = new Map<string, string>([[SAVE_KEY, 'previous save']]);
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: () => {
      const e = new Error('The quota has been exceeded.');
      e.name = 'QuotaExceededError';
      throw e;
    },
  };
}

describe('saving when storage is full (City 02.4)', () => {
  it('reports failure instead of throwing, and leaves the previous save intact', async () => {
    const storage = fullStorage();
    const saver = new SaveService(storage);
    const sim = new Sim(createInitialState(2));
    expect(saver.save(sim.state)).toBe(false);
    expect(saver.write('x')).toBe(false);
    expect(await saver.saveCompressed(sim.state)).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe('previous save');
  });

  it('records the main-thread cost of each autosave step', async () => {
    const saver = new SaveService(undefined);
    const sim = new Sim(createInitialState(2));
    await saver.serializeCompressed(sim.state);
    expect(saver.timings.serialize).toBeGreaterThan(0);
  });
});
