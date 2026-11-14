import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';

describe('simulation at city scale (City 06)', () => {
  it('ticks never scan the whole world: no per-tick full-tile or full-chunk sweeps', () => {
    const sim = new Sim(createInitialState(3));
    const st = sim.state;
    st.caps.energy = st.caps.water = st.caps.biomass = 1e6;
    st.resources.energy = st.resources.water = st.resources.biomass = 1e5;
    for (let cz = -4; cz <= 4; cz++) for (let cx = -4; cx <= 4; cx++) sim.areas.clear(sim.areas.map.areaOfChunk(cx, cz), true);
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
    const { playCity } = await import('./pacing-city.test');
    const { SaveService } = await import('../src/app/SaveService');
    const saver = new SaveService(undefined);
    saver.now = () => 0; // saves stamp the wall clock (Phase 4 offline progress)
    const fast = playCity(21, 3, 20);
    const full = playCity(21, 3, 20, (sim) => (sim.fullScan = true));
    expect(fast.clears.length).toBeGreaterThan(2);
    expect(saver.serialize(fast.sim.state)).toBe(saver.serialize(full.sim.state));
  });

  it('only chunks with something happening are active, and they leave the set when they go quiet', () => {
    const sim = new Sim(createInitialState(4));
    const st = sim.state;
    st.caps.energy = st.caps.water = st.caps.biomass = 1e6;
    st.resources.energy = st.resources.water = st.resources.biomass = 1e5;
    sim.advance(1);
    const base = sim.activeChunks();
    // A pulse far out: its chunk is active while the tile grows, then quiet again.
    for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) sim.areas.clear(sim.areas.map.areaOfChunk(cx, cz), true);
    const t = sim.grid.get(GROUND, 40, 40)!;
    t.blocked = false;
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(sim.activeChunks().has(`${GROUND}|2|2`)).toBe(true);
    sim.advance(10);
    expect(sim.activeChunks().has(`${GROUND}|2|2`)).toBe(false);
    expect(sim.activeChunks().size).toBeLessThanOrEqual(base.size + 1);
  });
});
