import { big } from '../src/core/Big';
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { AreaMap, PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import { Rng } from '../src/core/Rng';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

/** A sim where the city ground is playable (the park arrives in City 05). */
function city(seed = 4) {
  const sim = new Sim(createInitialState(seed));
  const g = sim.grid.layer(GROUND)!;
  g.unlocked = true;
  g.preview = false;
  const s = sim.state;
  s.caps.energy = big(1e6); s.caps.water = big(1e6);
  s.resources.energy = big(1e5); s.resources.water = big(1e5); s.resources.biomass = big(1e5);
  return sim;
}

/** Restores enough of an area to wake its landmark (directly, like a very fast player). */
function restoreArea(sim: Sim, id: string, share: number = TUNING.city.clearShare, fast = false) {
  const tiles = sim.areas.tiles(id).filter((t) => isRestorable(t, sim.state.machines) && t.ground !== 'restored');
  const target = share >= 1 ? sim.areas.counts(id).restorable : sim.areas.need(id);
  const need = target - sim.areas.counts(id).restored;
  for (const t of tiles.slice(0, Math.max(0, need))) {
    if (!fast) {
      sim.restoration.complete(t, 'pulse');
      continue;
    }
    // Soak shortcut: the end state of a restoration, without chains and rewards.
    t.ground = 'restored';
    t.bloom = 1;
    t.pollution = 0;
    sim.grid.touch(t);
  }
}

describe('areas: the static layout (City 03.1)', () => {
  it('every chunk belongs to exactly one area, and each area lists it', () => {
    const map = new AreaMap(77);
    for (let cz = -12; cz <= 12; cz++)
      for (let cx = -12; cx <= 12; cx++) {
        const id = map.areaOfChunk(cx, cz);
        expect(map.info(id).chunks).toContainEqual([cx, cz]);
      }
    expect(map.areaOfChunk(0, 0)).toBe(PARK);
    expect(map.info(PARK).chunks).toEqual([[0, 0]]);
  });

  it('adjacency is symmetric, every area has neighbours, and sizes stay small', () => {
    const map = new AreaMap(31);
    const sizes: number[] = [];
    const ids = new Set<string>();
    for (let cz = -15; cz <= 15; cz++) for (let cx = -15; cx <= 15; cx++) ids.add(map.areaOfChunk(cx, cz));
    for (const id of ids) {
      const a = map.info(id);
      sizes.push(a.chunks.length);
      expect(a.neighbours.length).toBeGreaterThan(0);
      for (const nb of a.neighbours) expect(map.info(nb).neighbours).toContain(id);
    }
    const inner = [...ids].filter((id) => map.info(id).chunks.every(([x, z]) => Math.abs(x) < 13 && Math.abs(z) < 13));
    const s = inner.map((id) => map.info(id).chunks.length);
    expect(Math.max(...s)).toBeLessThanOrEqual(9);
    expect(s.reduce((a, b) => a + b, 0) / s.length).toBeGreaterThan(1.5);
    expect(s.reduce((a, b) => a + b, 0) / s.length).toBeLessThan(4.5);
  });

  it('is order-independent: the same seed gives the same areas whatever is asked first', () => {
    const a = new AreaMap(9);
    const b = new AreaMap(9);
    const cells: [number, number][] = [];
    for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) cells.push([i, j]);
    const ra = cells.map(([x, z]) => a.areaOfChunk(x, z));
    const rng = new Rng(3);
    for (const [x, z] of [...cells].sort(() => rng.next() - 0.5)) b.info(b.areaOfChunk(x, z));
    expect(cells.map(([x, z]) => b.areaOfChunk(x, z))).toEqual(ra);
  });
});

describe('areas: the fog (City 03.2–03.4)', () => {
  it('starts with only the park revealed; everything else is hidden and untouchable', () => {
    const sim = city();
    expect(sim.areas.fog(PARK)).toBe('thinning');
    const nb = sim.areas.info(PARK).neighbours[0];
    expect(sim.areas.fog(nb)).toBe('hidden');
    const t = sim.areas.tiles(nb).find((x) => !x.occupantId)!;
    expect(sim.restoration.checkPulse(t).ok).toBe(false);
    expect(sim.restoration.checkPulse(t).reason).toMatch(/fog/);
    // the park itself is home: any tile can be restored
    const p = sim.areas.tiles(PARK).find((x) => !x.occupantId && x.ground !== 'restored')!;
    expect(sim.restoration.checkPulse(p).ok).toBe(true);
  });

  // E23.1.1: one rule set. The park wakes with the fountain (E21.6), its neighbours come into view behind their gates
  // (E21.5), and an open region can be restored anywhere: there is no receding Frontier any more.
  it('waking the park reveals its neighbours, each sealed behind its gate until opened', () => {
    const sim = city();
    const revealed: string[] = [];
    sim.bus.on('area.revealed', ({ areaId }) => revealed.push(areaId));
    const before = new Set(Object.keys(sim.state.areas));
    expect(sim.areas.clear(PARK)).toBe(false); // the park is not a region: the fountain wakes it
    expect(sim.areas.clear(PARK, true)).toBe(true);
    expect(sim.areas.fog(PARK)).toBe('cleared');
    const fresh = sim.areas.info(PARK).neighbours.filter((n) => !before.has(n) && sim.state.areas[n]);
    expect(revealed.sort()).toEqual(fresh.sort());
    for (const id of fresh) {
      expect(sim.areas.sealed(id)).toBe(true);
      expect(sim.areas.fog(id)).toBe('hidden'); // still fog to everything in the game
      const t = sim.areas.tiles(id).find((x) => !x.occupantId && !x.blocked)!;
      expect(sim.restoration.checkPulse(t).ok).toBe(false);
    }
    expect(sim.areas.clear(PARK, true)).toBe(false); // claimed once
  });

  it('an open region can be restored anywhere, not only at its edge, and its fog thins as it is restored', () => {
    const sim = city(12);
    const id = sim.areas.nextGoal()!;
    expect(sim.areas.sealed(id)).toBe(false);
    const tiles = sim.areas.tiles(id).filter((t) => !t.occupantId && !t.blocked && t.ground !== 'restored');
    const deep = tiles.filter((t) => !sim.grid.neighbors(t).some((n) => sim.areas.isClear(n)));
    expect(deep.length).toBeGreaterThan(0);
    for (const t of deep.slice(0, 50)) expect(sim.areas.canTouch(t)).toBe(true);
    const d0 = sim.areas.density(id);
    restoreArea(sim, id);
    expect(sim.areas.density(id)).toBeLessThan(d0);
    sim.areas.clear(id, true);
    expect(sim.areas.density(id)).toBe(0);
    expect(sim.areas.fog(id)).toBe('cleared');
  });

  it('fog state and landmarks survive a save', () => {
    const sim = city(5);
    sim.areas.clear(PARK, true);
    const copy = new Sim(new SaveService(undefined).deserialize(new SaveService(undefined).serialize(sim.state))!);
    for (const id of sim.areas.revealed()) {
      expect(copy.areas.fog(id)).toBe(sim.areas.fog(id));
      expect(copy.areas.landmark(id)?.id).toBe(sim.areas.landmark(id)?.id);
    }
    expect(copy.state.machines.length).toBe(sim.state.machines.length);
  });
});
