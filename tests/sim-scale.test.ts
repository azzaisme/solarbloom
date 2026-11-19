import { big } from '../src/core/Big';
import { unlockAll } from './helpers';
import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { CHUNK } from '../src/core/Hash';

describe('simulation at city scale (City 06)', () => {
  it('ticks never scan the whole world: no per-tick full-tile or full-chunk sweeps', () => {
    const sim = new Sim(createInitialState(3));
    const st = sim.state;
    st.caps.energy = big(1e6); st.caps.water = big(1e6);
    st.resources.energy = big(1e5); st.resources.water = big(1e5); st.resources.biomass = big(1e5);
    for (let cz = -4; cz <= 4; cz++) for (let cx = -4; cx <= 4; cx++) sim.areas.clear(sim.areas.map.areaOfChunk(cx, cz), true);
    unlockAll(sim);
    sim.advance(1); // warm-up (first full sum is allowed)
    const g = sim.grid as unknown as Record<string, (...a: unknown[]) => unknown>;
    const sweeps: string[] = [];
    for (const name of ['playableTiles', 'loadedChunks']) {
      const orig = g[name].bind(sim.grid);
      g[name] = (...a: unknown[]) => {
        sweeps.push(name);
        return orig(...a);
      };
    }
    // Busy play: pulses all over, growth, chains.
    let k = 0;
    for (let i = 0; i < 300; i++) {
      if (i % 3 === 0) {
        const t = sim.grid.get(GROUND, (k * 7) % 60 - 30, (k * 13) % 60 - 30)!;
        k++;
        if (sim.restoration.checkPulse(t).ok) sim.restoration.pulse(t.id);
      }
      sim.tick();
    }
    expect(sweeps).toEqual([]);
  });
});

describe('active-region ticking (City 06.1)', () => {
  it('indexed, active-only ticking plays out exactly like scanning every machine every tick', { timeout: 120000 }, async () => {
    const { runOldCityBot } = await import('./oldcity-bot');
    const { SaveService } = await import('../src/app/SaveService');
    const saver = new SaveService(undefined);
    saver.now = () => 0; // saves stamp the wall clock
    // E23.1.1: a played Old City session (salvage, pulses, the fountain, a build, a gate, a Keeper)
    const fast = runOldCityBot(21, 20, 'keeper');
    const full = runOldCityBot(21, 20, 'keeper', { setup: (sim) => (sim.fullScan = true) });
    expect(fast.firsts.tier1).toBeDefined(); // the session really played out
    expect(fast.sim.state.machines.length).toBeGreaterThan(2);
    expect(saver.serialize(fast.sim.state)).toBe(saver.serialize(full.sim.state));
  });

  it('only chunks with something happening are active, and they leave the set when they go quiet', () => {
    const sim = new Sim(createInitialState(4));
    const st = sim.state;
    st.caps.energy = big(1e6); st.caps.water = big(1e6);
    st.resources.energy = big(1e5); st.resources.water = big(1e5); st.resources.biomass = big(1e5);
    sim.advance(1);
    const base = sim.activeChunks();
    // A pulse away from home (on Saltwind Beach, open from the start): its chunk is active while the tile grows,
    // then quiet again.
    const t = sim.areas.tiles('saltwind').find((x) => {
      const key = `${GROUND}|${Math.floor(x.x / CHUNK)}|${Math.floor(x.z / CHUNK)}`;
      return !base.has(key) && sim.restoration.checkPulse(x).ok;
    })!;
    expect(t).toBeDefined();
    const key = `${GROUND}|${Math.floor(t.x / CHUNK)}|${Math.floor(t.z / CHUNK)}`;
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(sim.activeChunks().has(key)).toBe(true);
    sim.advance(10);
    expect(sim.activeChunks().has(key)).toBe(false);
    expect(sim.activeChunks().size).toBeLessThanOrEqual(base.size + 1);
  });
});
