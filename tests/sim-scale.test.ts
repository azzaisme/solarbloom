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
