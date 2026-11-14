import { describe, expect, it } from 'vitest';
import { SaveService } from '../../src/app/SaveService';
import { createInitialState, GROUND } from '../../src/core/GameState';
import type { MachineData } from '../../src/core/types';
import { Sim } from '../../src/gameplay/Sim';

const ms = (fn: () => void, reps = 1) => {
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) fn();
  return (performance.now() - t0) / reps;
};
const log = (s: string) => console.log(`  ⏱ ${s}`); // eslint-disable-line no-console

/** About 1,000 areas: 2,000 ground chunks (512k tiles), most restored, 2,000 machines. */
function syntheticCity(seed = 99) {
  const sim = new Sim(createInitialState(seed, { rooftops: true }));
  const side = 45; // 45×45 ≈ 2,025 chunks
  let n = 0;
  for (let cz = 0; cz < side; cz++)
    for (let cx = 0; cx < side; cx++) {
      const c = sim.grid.chunkAt(GROUND, cx - 22, cz - 22)!;
      for (const t of c.tiles) {
        if (!t || (t.variant % 10) < 3) continue; // ~30% still dead
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = 1 + (t.variant % 3);
        if (t.variant % 97 === 0) t.lushUntil = 1234.5;
      }
      c.dirty = true;
      if ((cx + cz) % 1 === 0 && n < 2000) {
        const m: MachineData = { id: `m${1000 + n}`, type: 'pollinator', roofId: GROUND, x: c.cx * 16 + 5, z: c.cz * 16 + 5, size: 1, boostUntil: 0, timer: 0, charge: 0 };
        sim.state.machines.push(m);
        sim.grid.indexMachine(m);
        n++;
      }
    }
  return sim;
}

describe('performance: world model (City 01.3)', () => {
  it('lookups cost the same in a 100-tile world and a 100,000+-tile world', () => {
    const small = new Sim(createInitialState(1, { rooftops: true }));
    const big = syntheticCity();
    const probe = (sim: Sim, layer: string, x: number, z: number) => () => {
      sim.grid.tilesNear({ roofId: layer, x, z, size: 2 }, 2);
      sim.grid.tilesWithin(layer, x, z, 3);
      sim.grid.machinesNear(layer, x, z, 3);
      sim.grid.neighbors(sim.grid.get(layer, x, z)!);
    };
    probe(small, 'r1', 3, 3)();
    probe(big, GROUND, 40, -40)();
    const a = ms(probe(small, 'r1', 3, 3), 20000);
    const b = ms(probe(big, GROUND, 40, -40), 20000);
    log(`lookup set: small world ${(a * 1000).toFixed(2)} µs · big world (${big.grid.loadedChunks().length} chunks) ${(b * 1000).toFixed(2)} µs`);
    expect(b).toBeLessThan(a * 3 + 0.002);
  });
});

describe('performance: saves (City 02.5)', () => {
  it('a ~1,000-area city saves small and fast, and loads fast', async () => {
    const sim = syntheticCity();
    const saver = new SaveService(undefined);
    const firstPack = ms(() => saver.packTiles(sim.state));
    // Steady state: an autosave after a little play touches a handful of chunks.
    for (let i = 0; i < 5; i++) {
      const t = sim.grid.get(GROUND, i * 16 + 3, 7)!;
      t.bloom = 3;
      sim.grid.touch(t);
    }
    const incremental = ms(() => saver.serialize(sim.state));
    const json = saver.serialize(sim.state);
    const t0 = performance.now();
    const z = await saver.serializeCompressed(sim.state);
    const compress = performance.now() - t0;
    const loadMs = ms(() => new Sim(saver.deserialize(json)!));
    log(`first full pack ${firstPack.toFixed(0)} ms · autosave serialize ${incremental.toFixed(1)} ms · gzip ${compress.toFixed(0)} ms (async)`);
    log(`save: ${(json.length / 1e6).toFixed(2)} MB plain → ${(z.length / 1e6).toFixed(3)} MB stored · load ${loadMs.toFixed(1)} ms`);
    expect(incremental).toBeLessThan(8);
    expect(z.length).toBeLessThan(1_000_000);
    expect(loadMs).toBeLessThan(50);
  });
});
