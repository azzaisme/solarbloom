import { big } from '../../src/core/Big';
import { describe, expect, it } from 'vitest';
import { SaveService } from '../../src/app/SaveService';
import { createInitialState, GROUND } from '../../src/core/GameState';
import type { MachineData } from '../../src/core/types';
import { Sim } from '../../src/gameplay/Sim';
import { makeSim } from '../helpers';

const ms = (fn: () => void, reps = 1) => {
  const t0 = performance.now();
  for (let i = 0; i < reps; i++) fn();
  return (performance.now() - t0) / reps;
};
const log = (s: string) => console.log(`  ⏱ ${s}`); // eslint-disable-line no-console

/** About 1,000 areas: 2,000 ground chunks (512k tiles), most restored, 2,000 machines. */
function syntheticCity(seed = 99) {
  const sim = new Sim(createInitialState(seed)); // the city: saved ground chunks load eagerly
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

describe('performance: chunk generation with the road network (City 16.8)', () => {
  it('a fresh generation-4 chunk generates within the streaming budget', () => {
    // Fresh plan caches each seed: every area's roads are routed the first time one of its chunks generates.
    const per: number[] = [];
    for (const seed of [11, 12, 13]) {
      const sim = new Sim(createInitialState(seed));
      let n = 0;
      const t0 = performance.now();
      for (let cz = -12; cz <= 12; cz++)
        for (let cx = -12; cx <= 12; cx++) {
          sim.grid.chunkAt(GROUND, cx, cz);
          n++;
        }
      per.push((performance.now() - t0) / n);
    }
    const avg = per.reduce((a, b) => a + b, 0) / per.length;
    log(`chunk generation (gen 4, cold road plan): ${avg.toFixed(3)} ms per chunk (${per.map((p) => p.toFixed(3)).join(' / ')})`);
    // City 07 streams chunks at a few per frame; keep a cold chunk (roads included) to a couple of ms.
    expect(avg).toBeLessThan(3);
  });
});

describe('performance: world model (City 01.3)', () => {
  it('lookups cost the same in a 100-tile world and a 100,000+-tile world', () => {
    const small = makeSim(1);
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

describe('performance: simulation at city scale (City 06.6)', () => {
  it('a 0.1 s step with 10k restored tiles, 300 machines and 30 drones stays under 2 ms', () => {
    const sim = new Sim(createInitialState(5));
    const st = sim.state;
    st.caps.energy = big(1e9); st.caps.water = big(1e9);
    st.resources.energy = big(1e8); st.resources.water = big(1e8); st.resources.biomass = big(1e8);
    // ~40 chunks of city around the park, mostly restored.
    let restored = 0;
    for (let cz = -3; cz <= 3; cz++)
      for (let cx = -3; cx <= 3; cx++) {
        const c = sim.grid.chunkAt(GROUND, cx, cz)!;
        for (const t of c.tiles) {
          if (!t || t.blocked || restored >= 10000) continue;
          t.ground = 'restored';
          t.bloom = 1 + (t.variant % 3);
          t.pollution = 0;
          sim.grid.touch(t);
          restored++;
        }
      }
    for (let cz = -3; cz <= 3; cz++) for (let cx = -3; cx <= 3; cx++) sim.areas.clear(sim.areas.map.areaOfChunk(cx, cz), true);
    // 300 machines spread around (solar, condensers, gardens) + 30 drone hubs, inserted directly: machine costs
    // grow ×1.5 per copy, and this measures the simulation, not the economy.
    const types = ['solar', 'condenser', 'pollinator'] as const;
    let n = 0;
    const add = (type: MachineData['type'], x: number, z: number, size: number) => {
      const cells = sim.grid.footprint(GROUND, x, z, size);
      if (cells.some((c) => !c || c.blocked || c.occupantId)) return false;
      const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
      sim.state.machines.push(m);
      sim.grid.indexMachine(m);
      for (const c of cells) c!.occupantId = m.id;
      if (type === 'droneHub') sim.drones.spawn(m);
      return true;
    };
    let hubs = 0;
    for (let z = -46; z < 60 && n < 300; z += 4)
      for (let x = -46; x < 60 && n < 300; x += 4) {
        const hub = hubs < 30 && (x + z) % 3 === 0;
        if (add(hub ? 'droneHub' : types[n % 3], x, z, hub ? 2 : 1)) {
          n++;
          if (hub) hubs++;
        }
      }
    sim.production.markDirty();
    for (let i = 0; i < 50; i++) sim.tick();
    const steps = 300;
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) sim.tick();
    const per = (performance.now() - t0) / steps;
    log(`sim step: ${per.toFixed(3)} ms with ${restored} restored tiles, ${sim.state.machines.length} machines, ${sim.state.drones.length} drones`);
    expect(sim.state.machines.length).toBeGreaterThanOrEqual(300);
    expect(sim.state.drones.length).toBeGreaterThanOrEqual(30);
    expect(per).toBeLessThan(2);
  });
});

describe('performance: active-region ticking (City 06.1)', () => {
  it('a 1,000-area world with 5 active chunks ticks in under 0.3 ms', () => {
    const sim = new Sim(createInitialState(8));
    const st = sim.state;
    st.caps.energy = big(1e9); st.caps.water = big(1e9);
    st.resources.energy = big(1e8); st.resources.water = big(1e8); st.resources.biomass = big(1e8);
    st.progression.coreActivated = true;
    // Clear 1,000 areas ring by ring.
    const ids: string[] = [];
    const seen = new Set<string>();
    for (let r = 0; ids.length < 1000; r++)
      for (let cz = -r; cz <= r; cz++)
        for (let cx = -r; cx <= r; cx++) {
          if (Math.max(Math.abs(cx), Math.abs(cz)) !== r) continue;
          const id = sim.areas.map.areaOfChunk(cx, cz);
          if (seen.has(id)) continue;
          seen.add(id);
          ids.push(id);
        }
    for (const id of ids) sim.areas.clear(id, true);
    // At rest everywhere: two passive machines (solar, garden) on every area's landmark chunk, ground restored.
    const add = (type: MachineData['type'], x: number, z: number, size = 1) => {
      const cells = sim.grid.footprint(GROUND, x, z, size);
      if (cells.some((c) => !c || c.blocked || c.occupantId)) return undefined;
      const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
      st.machines.push(m);
      sim.grid.indexMachine(m);
      for (const c of cells) c!.occupantId = m.id;
      if (type === 'droneHub') sim.drones.spawn(m);
      return m;
    };
    for (const id of ids) {
      const [x, z] = sim.areas.info(id).landmark;
      add('solar', x + 3, z);
      add('pollinator', x, z + 3);
    }
    // Five busy chunks next to the park: a condenser, a drone hub and growing tiles in each.
    for (let k = 0; k < 5; k++) {
      const x0 = 16 * (k - 2) + 4;
      const z0 = 20;
      add('condenser', x0, z0);
      if (k < 2) add('droneHub', x0 + 4, z0 + 4, 2);
      for (let i = 0; i < 6; i++) {
        const t = sim.grid.get(GROUND, x0 + 2 + i, z0 + 8)!;
        if (!t.blocked && !t.occupantId && t.ground !== 'restored') sim.restoration.pulse(t.id);
      }
    }
    sim.production.markDirty();
    for (let i = 0; i < 20; i++) sim.tick();
    const active = sim.activeChunks().size;
    const steps = 400;
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) sim.tick();
    const per = (performance.now() - t0) / steps;
    log(`active-region tick: ${per.toFixed(3)} ms · ${ids.length} areas, ${sim.grid.loadedChunks().length} chunks loaded, ${st.machines.length} machines, ${active} active chunks`);
    expect(active).toBeLessThanOrEqual(8); // 5 busy chunks (+ drones flying into neighbours)
    expect(per).toBeLessThan(0.3);
  });
});

