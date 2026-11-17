import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { plotSpots } from '../src/core/Plots';
import { PLOT_OPTIONS } from '../src/data/cozy';
import { Sim } from '../src/gameplay/Sim';
import { PLOT_VISITORS, visitorSlots, type Rect } from '../src/rendering/FaunaPlan';

/** E19.3.2 (#258): animals visit what the player chose. Cosmetic: reading choices never changes the game. */

function world(seed = 4) {
  const sim = new Sim(createInitialState(seed));
  const g = sim.grid.layer(GROUND)!;
  g.unlocked = true;
  g.preview = false;
  return sim;
}

const around = (x: number, z: number): Rect => ({ x0: x - 10, x1: x + 10, z0: z - 10, z1: z + 10 });

describe('E19.3.2: animals visit what you chose', () => {
  it('every plot option has visitors, and at least four kinds of animal visit', () => {
    for (const o of PLOT_OPTIONS) expect(PLOT_VISITORS[o.id]?.length, o.id).toBeGreaterThan(0);
    expect(new Set(Object.values(PLOT_VISITORS).flat()).size).toBeGreaterThanOrEqual(4);
  });

  it('no choice, no visitors; a kitchen garden brings songbirds to its plot', () => {
    const sim = world();
    const gen = sim.grid.layer(GROUND)!.gen ?? 1;
    const spot = plotSpots(sim.grid.seed, PARK, gen)[0];
    expect(spot).toBeDefined();
    const rect = around(spot.x, spot.z);
    expect(visitorSlots(sim, rect)).toEqual([]);
    sim.state.cozy = { plots: { [spot.id]: 'garden' } };
    const v = visitorSlots(sim, rect);
    expect(v.map((x) => x.kind)).toEqual(PLOT_VISITORS.garden);
    for (const s of v) {
      expect(s.home.x).toBeGreaterThanOrEqual(spot.x);
      expect(s.home.x).toBeLessThanOrEqual(spot.x + spot.size);
      expect(s.home.z).toBeGreaterThanOrEqual(spot.z);
      expect(s.home.z).toBeLessThanOrEqual(spot.z + spot.size);
    }
    expect(visitorSlots(sim, rect)).toEqual(v); // seeded: the same every time
    expect(visitorSlots(sim, around(spot.x + 200, spot.z + 200))).toEqual([]); // only near the view
  });

  it('ducks only come to a plot with restored water beside it, and reading choices never changes the game', () => {
    const sim = world(9);
    const gen = sim.grid.layer(GROUND)!.gen ?? 1;
    const spot = plotSpots(sim.grid.seed, PARK, gen)[0];
    sim.state.cozy = { plots: { [spot.id]: 'mooring' } };
    const before = JSON.stringify(sim.state);
    const v = visitorSlots(sim, around(spot.x, spot.z));
    for (const s of v) {
      expect(s.kind).toBe('ducks');
      const t = sim.grid.get(GROUND, Math.floor(s.home.x), Math.floor(s.home.z))!;
      expect(t.feature).toBe('water');
      expect(t.ground).toBe('restored');
    }
    expect(JSON.stringify(sim.state)).toBe(before);
  });
});
