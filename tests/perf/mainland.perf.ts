import { big } from '../../src/core/Big';
import { describe, expect, it } from 'vitest';
import { SaveService } from '../../src/app/SaveService';
import { createInitialState, GROUND } from '../../src/core/GameState';
import type { BuildableType, MaterialId } from '../../src/core/types';
import { Sim } from '../../src/gameplay/Sim';

/**
 * E23.8.3.3 (#453): the sim with a very large mainland build: 40 restored districts and 400 machines of every kind
 * the mainland runs (panels, relays, grid batteries, long-range pumps, drone hubs, condensers, pollinators),
 * placed through BuildSystem like a player would. Times one game tick, and each subsystem's slowest call, so a
 * regression names its system. The browser side (draw calls, frames, reload) is tests/perf/mainland.perf.mjs.
 */
const DISTRICTS = 40;
const MACHINES = 400;
const MIX: BuildableType[] = ['solar', 'solar', 'relay', 'gridBattery', 'longPump', 'droneHub', 'condenser', 'pollinator', 'solar', 'relay'];
const log = (s: string) => console.log(`  ⏱ ${s}`); // eslint-disable-line no-console

export function bigMainland(seed = 7) {
  const sim = new Sim(createInitialState(seed, 'oldcity'));
  const sv = sim.state.salvage!;
  sv.tier = 5;
  sv.abilities = ['pry', 'hover', 'climb', 'glide'];
  sim.mainland.open();
  const land = sim.areas.map.areaOfChunk(9, 0);
  const queue = [land];
  const done: string[] = [];
  while (queue.length && done.length < DISTRICTS) {
    const id = queue.shift()!;
    if (done.includes(id) || !id.startsWith('ml_')) continue;
    sim.state.areas[id] ??= { fog: 'frontier', revealedAt: 0 };
    for (const t of sim.areas.tiles(id)) {
      if (t.blocked || t.occupantId) continue;
      t.ground = 'restored';
      t.bloom = 1 + (t.variant % 3);
      t.pollution = 0;
      sim.grid.touch(t);
    }
    sim.areas.clear(id, true);
    done.push(id);
    for (const nb of sim.areas.info(id).neighbours) if (nb.startsWith('ml_') && !done.includes(nb)) queue.push(nb);
  }
  let placed = 0;
  const fails: Record<string, number> = {};
  outer: for (const id of done)
    for (const [cx, cz] of sim.areas.info(id).chunks)
      for (let z = cz * 16 + 1; z < cz * 16 + 15; z += 3)
        for (let x = cx * 16 + 1; x < cx * 16 + 15; x += 3) {
          if (placed >= MACHINES) break outer;
          const type = MIX[placed % MIX.length];
          for (const m of ['scrap', 'seeds', 'copper', 'timber', 'glass', 'clay', 'gears', 'sunstone', 'steel'] as MaterialId[]) sim.inventory.add(m, 200);
          sim.state.resources.biomass = big(1e9);
          const c = sim.build.check(type, GROUND, x, z);
          if (!c.ok) {
            fails[c.reason ?? '?'] = (fails[c.reason ?? '?'] ?? 0) + 1;
            continue;
          }
          if (sim.build.place(type, GROUND, x, z)) placed++;
        }
  return { sim, districts: done.length, placed, fails };
}

/** Wraps every subsystem's tick/update to record its slowest call. */
function timeSystems(sim: Sim) {
  const slow: Record<string, number> = {};
  for (const [name, sys] of Object.entries(sim)) {
    if (!sys || typeof sys !== 'object') continue;
    for (const k of ['tick', 'update'] as const) {
      const f = (sys as Record<string, unknown>)[k];
      if (typeof f !== 'function') continue;
      (sys as Record<string, unknown>)[k] = function (this: unknown, ...a: unknown[]) {
        const t = performance.now();
        try {
          return (f as (...x: unknown[]) => unknown).apply(this, a);
        } finally {
          const d = performance.now() - t;
          if (d > (slow[`${name}.${k}`] ?? 0)) slow[`${name}.${k}`] = d;
        }
      };
    }
  }
  return slow;
}

describe('E23.8.3.3: a very large mainland build (sim)', () => {
  it('ticks within budget with 400 machines across 40 districts, and saves and loads', () => {
    const t0 = performance.now();
    const { sim, districts, placed, fails } = bigMainland();
    log(`built ${districts} districts, ${placed} machines, ${sim.state.drones.length} drones in ${(performance.now() - t0).toFixed(0)} ms; refused: ${JSON.stringify(Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 4))}`);
    expect(districts).toBe(DISTRICTS);
    expect(placed).toBeGreaterThanOrEqual(MACHINES * 0.9);

    // warm up, then time one game tick (0.1 s) at a time over 30 game seconds
    for (let i = 0; i < 20; i++) sim.tick(0.1);
    const slow = timeSystems(sim);
    const ts: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t = performance.now();
      sim.tick(0.1);
      ts.push(performance.now() - t);
    }
    ts.sort((a, b) => a - b);
    const median = ts[150];
    const p99 = ts[297];
    const top = Object.entries(slow).sort((a, b) => b[1] - a[1]).slice(0, 8);
    log(`tick median ${median.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms, worst ${ts[299].toFixed(1)} ms`);
    log(`slowest: ${top.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
    expect(median).toBeLessThan(4);
    expect(p99).toBeLessThan(16); // no hitch: one frame at 60 Hz

    // the power grid: every mainland machine on it is solved each tick
    const nets = sim.power.networks();
    log(`power: ${nets.length} networks, ${nets.reduce((a, n) => a + n.members.length, 0)} members`);

    // save and load
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const saver = new SaveService(storage as unknown as Storage);
    let t = performance.now();
    saver.save(sim.state);
    const saveMs = performance.now() - t;
    t = performance.now();
    const back = saver.load();
    const loaded = new Sim(back!);
    const loadMs = performance.now() - t;
    const bytes = [...store.values()].reduce((a, v) => a + v.length, 0);
    log(`save ${saveMs.toFixed(0)} ms, load ${loadMs.toFixed(0)} ms, ${(bytes / 1024).toFixed(0)} KB`);
    expect(loaded.state.machines.length).toBe(sim.state.machines.length);
    expect(saveMs).toBeLessThan(250);
    expect(loadMs).toBeLessThan(1500);
  }, 120_000);
});
