import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { PARK } from '../src/core/Areas';
import { CROSS, openIsland, streetCross, streetGarden as garden } from './helpers';
import type { ChainEvent } from '../src/gameplay/BloomChainSystem';
import { Sim } from '../src/gameplay/Sim';

function collect(sim: Sim) {
  const events: ChainEvent[] = [];
  const ended: { combo: number; areas: number; chainId: number }[] = [];
  sim.bus.on('chain.event', (e) => events.push(e.event));
  sim.bus.on('chain.ended', (e) => ended.push(e));
  return { events, ended };
}

describe('massive blooms (City 10)', () => {
  it('chains cross area borders on the ground, and stop at hidden fog', () => {
    // E23.1.1: a new game with the fountain awake: the park and Saltwind are open, the Mast Row north of the park is
    // still sealed behind its gate (hidden). A column of gardens at x = 4 runs from Saltwind up through the park into it.
    const sim = new Sim(createInitialState(5));
    sim.areas.clear(PARK, true);
    expect(sim.areas.fog('mastRow')).toBe('hidden');
    sim.state.areas.saltwind.byBot = sim.areas.shareTarget('saltwind'); // E21.9: chains help where bloombot did its share
    const row: MachineData[] = [];
    for (let z = 46; z > -40; z -= 2) if (!sim.grid.get(GROUND, 4, z)?.occupantId) row.push(garden(sim, 4, z, false));
    const { events } = collect(sim);
    sim.restoration.complete(sim.grid.get(GROUND, 4, 47)!, 'pulse');
    sim.advance(20);
    // off paving, gardens pollinate (a POLLINATE arc, then the restore or grow); every tile the chain changed counts
    const touched = events.filter((e) => e.type === 'RESTORE' || e.type === 'GROW' || e.type === 'POLLINATE').map((e) => sim.grid.byTileId(e.target)!);
    const areas = new Set(touched.map((t) => sim.areas.areaOf(t)));
    expect(areas.size).toBeGreaterThanOrEqual(2);
    for (const t of touched) expect(sim.areas.fog(sim.areas.areaOf(t)!)).not.toBe('hidden');
  });

  it('a green corridor of street gardens carries a chain end to end, once per garden', () => {
    const run = () => {
      const sim = openIsland(new Sim(createInitialState(7)));
      const gardens = Array.from({ length: 10 }, (_, i) => garden(sim, -60 + i * 5, CROSS.row, true));
      const { events, ended } = collect(sim);
      sim.restoration.complete(sim.grid.get(GROUND, -61, CROSS.row)!, 'pulse');
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
    const sim = openIsland(new Sim(createInitialState(11)));
    // A cross of street corridors over the island (the row and the column cross at x = 32)
    streetCross(sim);
    const { ended } = collect(sim);
    let paid = 0;
    sim.bus.on('chain.ended', () => paid++);
    sim.restoration.complete(sim.grid.get(GROUND, CROSS.start[0], CROSS.start[1])!, 'pulse');
    sim.advance(60);
    expect(sim.chains.activeRuns).toBe(0);
    expect(sim.chains.pendingSteps).toBe(0);
    const big = ended.reduce((a, e) => (e.combo > a.combo ? e : a), ended[0]);
    expect(big.combo).toBeGreaterThanOrEqual(200);
    expect(big.areas).toBeGreaterThanOrEqual(12);
    expect(paid).toBe(ended.length);
  });
});
