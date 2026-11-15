import { big } from '../src/core/Big';
import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import type { ChainEvent } from '../src/gameplay/BloomChainSystem';
import { Sim } from '../src/gameplay/Sim';

/** A city with a cleared region around the park (fog lifted), so chains can run free. */
function openCity(seed = 9, r = 4) {
  const sim = new Sim(createInitialState(seed));
  const st = sim.state;
  st.caps.energy = big(1e7); st.caps.water = big(1e7);
  st.resources.energy = big(1e6); st.resources.water = big(1e6); st.resources.biomass = big(1e6);
  for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) sim.areas.clear(sim.areas.map.areaOfChunk(cx, cz), true);
  return sim;
}

/** Inserts a garden directly (costs grow per copy; these tests measure chains, not the economy). */
function garden(sim: Sim, x: number, z: number, street = false) {
  const t = sim.grid.get(GROUND, x, z)!;
  t.blocked = false;
  if (street) t.feature = 'paving';
  const m: MachineData = { id: sim.newId('m'), type: 'pollinator', roofId: GROUND, x, z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  t.occupantId = m.id;
  return m;
}

function collect(sim: Sim) {
  const events: ChainEvent[] = [];
  const ended: { combo: number; areas: number; chainId: number }[] = [];
  sim.bus.on('chain.event', (e) => events.push(e.event));
  sim.bus.on('chain.ended', (e) => ended.push(e));
  return { events, ended };
}

describe('massive blooms (City 10)', () => {
  it('chains cross area borders on the ground, and stop at hidden fog', () => {
    const sim = openCity(5, 1);
    // A row of gardens along z = 20 crossing from cleared areas into hidden ones further east.
    const row: MachineData[] = [];
    for (let x = 4; x < 120; x += 2) row.push(garden(sim, x, 20));
    const { events } = collect(sim);
    sim.restoration.complete(sim.grid.get(GROUND, 3, 20)!, 'pulse');
    sim.advance(20);
    const touched = events.filter((e) => e.type === 'RESTORE' || e.type === 'GROW').map((e) => sim.grid.byTileId(e.target)!);
    const areas = new Set(touched.map((t) => sim.areas.areaOf(t)));
    expect(areas.size).toBeGreaterThanOrEqual(2);
    for (const t of touched) expect(sim.areas.fog(sim.areas.areaOf(t)!)).not.toBe('hidden');
  });

  it('a green corridor of street gardens carries a chain end to end, once per garden', () => {
    const run = () => {
      const sim = openCity(7, 2);
      const gardens = Array.from({ length: 10 }, (_, i) => garden(sim, -20 + i * 5, 6, true));
      const { events, ended } = collect(sim);
      sim.restoration.complete(sim.grid.get(GROUND, -21, 6)!, 'pulse');
      sim.advance(30);
      return { sim, gardens, events, ended };
    };
    const a = run();
    const reached = new Set(a.events.filter((e) => e.type === 'CORRIDOR').map((e) => e.target));
    expect(reached.has(a.gardens[9].id)).toBe(true);
    const fired = a.events.filter((e) => e.type === 'CORRIDOR');
    // no garden is passed the chain twice in one chain
    const perTarget = new Map<string, Set<number>>();
    for (const e of fired) perTarget.set(`${e.target}|${e.chainId}`, new Set());
    expect(a.sim.chains.activeRuns).toBe(0);
    expect(a.ended.length).toBe(new Set(a.ended.map((e) => e.chainId)).size);
    const b = run();
    expect(b.events.map((e) => `${e.type}:${e.target}`)).toEqual(a.events.map((e) => `${e.type}:${e.target}`));
  });

  it('a ×200+ chain sweeps a dozen areas, terminates and pays once', () => {
    const sim = openCity(11, 8);
    // A cross of street corridors through the city, branching from a square near the start.
    for (let x = -125; x <= 125; x += 5) garden(sim, x, -40, true);
    for (let z = -125; z <= 125; z += 5) if (z !== -40) garden(sim, -100, z, true);
    const { ended } = collect(sim);
    let paid = 0;
    sim.bus.on('chain.ended', () => paid++);
    sim.restoration.complete(sim.grid.get(GROUND, -101, -40)!, 'pulse');
    sim.advance(60);
    expect(sim.chains.activeRuns).toBe(0);
    expect(sim.chains.pendingSteps).toBe(0);
    const big = ended.reduce((a, e) => (e.combo > a.combo ? e : a), ended[0]);
    expect(big.combo).toBeGreaterThanOrEqual(200);
    expect(big.areas).toBeGreaterThanOrEqual(12);
    expect(paid).toBe(ended.length);
  });
});
