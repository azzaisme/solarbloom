import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { levelAt } from '../src/core/Height';
import { LANDING, PARK_SET, REGIONS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { spawnPose, Walker } from '../src/gameplay/Walker';

const oldSim = (seed = 7) => new Sim(createInitialState(seed));

describe('E21.26 (data and the Landing, for Milestone A): the island', () => {
  it('every chunk outside the island, the coast band and the bay are unwalkable sea', () => {
    const sim = oldSim();
    const w = new Walker(sim);
    for (const [x, z] of [[120, 0], [-120, 0], [0, -120], [40, 140], [-97, 0], [111, 0], [0, -96], [60, 110], [0, 60]]) {
      const t = sim.grid.get(GROUND, x, z)!;
      expect(t.feature, `${x},${z}`).toBe('water');
      expect(w.walkable(GROUND, x, z), `${x},${z}`).toBe(false);
      expect(levelAt(x, z)).toBe(0);
    }
  });

  it('the coastline is closed: from the Landing nothing walkable leaves the island', () => {
    const sim = oldSim();
    // open every region, so only the coast holds bloombot in
    for (const r of REGIONS) sim.state.areas[r.id] = { fog: 'thinning', revealedAt: 0 };
    const w = new Walker(sim);
    const p = spawnPose(sim, w);
    const out = w.path(GROUND, p.x, p.z, (x, z) => x < -96 || x > 111 || z < -96 || z > 111, { x: 200, z: 8 });
    expect(out).toBeUndefined();
  });

  it('a new game starts on the jetty, facing the first pile, with the beach open', () => {
    const sim = oldSim();
    const w = new Walker(sim);
    const p = spawnPose(sim, w);
    expect([p.x, p.z]).toEqual(LANDING.spawn);
    expect(w.front(p)).toEqual({ x: 8, z: 44 });
    expect(sim.salvage.pileAt(8, 44)?.id).toBe('sw-s1');
    expect(sim.areas.fog('saltwind')).toBe('thinning');
    expect(sim.areas.landmark('saltwind')).toBeDefined();
    // up the beach and the park's south steps to the fountain on foot
    const path = w.path(GROUND, p.x, p.z, (x, z) => x === 8 && z === 10, { x: 8, z: 10 });
    expect(path).toBeDefined();
  });

  it("the beach's barricade only shuts off the Sea Lock, across the canal", () => {
    const sim = oldSim();
    const w = new Walker(sim);
    const p = spawnPose(sim, w);
    const lock = REGIONS.find((r) => r.id === 'saltwind')!.landmark;
    expect(w.path(GROUND, p.x, p.z, (x, z) => Math.abs(x - lock.x) + Math.abs(z - lock.z) <= 2, lock)).toBeUndefined();
    for (const [x, z] of REGIONS.find((r) => r.id === 'saltwind')!.gate.cells) {
      const t = sim.grid.get(GROUND, x, z)!;
      t.blocked = false;
      t.unblocked = true;
    }
    expect(w.path(GROUND, p.x, p.z, (x, z) => Math.abs(x - lock.x) + Math.abs(z - lock.z) <= 2, lock)).toBeDefined();
    // Mast Row, Old Market and Elder Grove stay shut
    expect(sim.areas.fog('mastRow')).toBe('hidden');
    void PARK_SET;
  });

  it('Spire Heights is region 10: a downtown at level 2 in ring 3', () => {
    const sim = oldSim();
    const info = sim.areas.info('spireHeights');
    expect(info.type).toBe('downtown');
    expect(info.chunks).toHaveLength(16);
    expect(info.difficulty).toBe(1.4);
    expect(levelAt(-50, -60)).toBe(2);
  });
});
