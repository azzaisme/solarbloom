import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { localSlots, type Rect } from '../src/rendering/FaunaPlan';

/** E19.3.1 (#257): animals move into cleared areas, by area type. Cosmetic: planning never touches the sim. */

function restoreAll(sim: Sim, id: string) {
  for (const t of sim.areas.tiles(id)) {
    if (!isRestorable(t, sim.state.machines) || t.ground === 'restored') continue;
    t.ground = 'restored';
    t.bloom = 1;
    t.pollution = 0;
    sim.grid.touch(t);
  }
}

function rectOf(sim: Sim, id: string): Rect {
  const ts = sim.areas.tiles(id);
  const xs = ts.map((t) => t.x);
  const zs = ts.map((t) => t.z);
  return { x0: Math.min(...xs), x1: Math.max(...xs) + 1, z0: Math.min(...zs), z1: Math.max(...zs) + 1 };
}

function world(seed = 4) {
  const sim = new Sim(createInitialState(seed));
  const g = sim.grid.layer(GROUND)!;
  g.unlocked = true;
  g.preview = false;
  return sim;
}

describe('E19.3.1: animals for each area type', () => {
  it('a park still in fog has no animals; once cleared, its cast (rabbits) moves in', () => {
    const sim = world();
    restoreAll(sim, PARK);
    const rect = rectOf(sim, PARK);
    expect(localSlots(sim, rect)).toEqual([]);
    expect(sim.areas.clear(PARK, true)).toBe(true);
    const slots = localSlots(sim, rect);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(TUNING.ecosystem.locals.park).toContain(s.species);
  });

  it('each cleared area type gets only its own cast, only on cleared ground, and the same slots every time', () => {
    const sim = world(7);
    restoreAll(sim, PARK);
    sim.areas.clear(PARK, true);
    const seen = new Set<string>();
    for (const id of sim.areas.info(PARK).neighbours) {
      restoreAll(sim, id);
      sim.areas.clear(id, true);
      const type = sim.areas.info(id).type;
      const rect = rectOf(sim, id);
      const a = localSlots(sim, rect);
      expect(localSlots(sim, rect)).toEqual(a);
      for (const s of a) {
        const t = sim.grid.get(GROUND, Math.floor(s.home.x), Math.floor(s.home.z))!;
        const area = sim.areas.areaOf(t)!;
        expect(sim.areas.fog(area)).toBe('cleared');
        expect(TUNING.ecosystem.locals[sim.areas.info(area).type]).toContain(s.species);
        expect(t.blocked || !!t.occupantId).toBe(false);
        if (s.species === 'ducks') expect(t.feature).toBe('water');
      }
      if (a.length) seen.add(type);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('planning animals never changes the game', () => {
    const sim = world(11);
    restoreAll(sim, PARK);
    sim.areas.clear(PARK, true);
    const before = JSON.stringify(sim.state);
    for (let i = 0; i < 5; i++) localSlots(sim, rectOf(sim, PARK));
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it('every area type has a cast, and every species has a cap on every tier', () => {
    for (const type of ['park', 'street', 'plaza', 'canal', 'market', 'reservoir', 'rooftops', 'grove']) expect(TUNING.ecosystem.locals[type]?.length, type).toBeGreaterThan(0);
    for (const tier of ['low', 'medium', 'high'] as const)
      for (const sp of ['rabbits', 'pigeons', 'ducks', 'frogs', 'squirrels'] as const) expect(TUNING.ecosystem.caps[tier][sp]).toBeGreaterThan(0);
  });
});
