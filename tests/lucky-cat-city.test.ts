import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

type Applier = { apply(t: string, mult: number, hidden: number): string };
const saver = new SaveService(undefined);

/** The fountain is awake and `n` areas are cleared (directly, like a very fast player). */
function grownCity(seed: number, n: number) {
  const sim = new Sim(createInitialState(seed));
  sim.state.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  for (let i = 0; i < n; i++) {
    const id = sim.areas.nextGoal()!;
    for (const t of sim.areas.tiles(id)) {
      if (!isRestorable(t, sim.state.machines) || t.ground === 'restored') continue;
      t.ground = 'restored';
      t.bloom = 1;
      t.pollution = 0;
      sim.grid.touch(t);
    }
    sim.areas.clear(id);
  }
  return sim;
}

describe('Lucky Cat in the endless city (City 13)', () => {
  it('hides in the park at first, then in nooks beside obstacles of cleared areas', () => {
    const fresh = new Sim(createInitialState(4));
    expect(fresh.cat.candidates().every((a) => a.roofId === GROUND && !a.id.startsWith('nook:'))).toBe(true);
    const sim = grownCity(4, 6);
    const nooks = sim.cat.candidates().filter((a) => a.id.startsWith('nook:'));
    expect(nooks.length).toBeGreaterThan(3);
    for (const a of nooks) {
      const [x, z] = a.needsFreeTile!;
      const t = sim.grid.get(GROUND, x, z)!;
      expect(t.blocked).toBe(false);
      expect(sim.areas.fog(sim.areas.areaOf(t)!)).toBe('cleared');
      expect(sim.grid.neighbors(t).some((n) => n.blocked && !!n.prop)).toBe(true);
      expect(a.hint).toMatch(/^beside a /);
    }
  });

  it('soak: 200 spawns across a 40-area city are all valid, one at a time, never in fog', { timeout: 60000 }, () => {
    const sim = grownCity(9, 40);
    for (let i = 0; i < 200; i++) {
      sim.state.cat.active = undefined;
      expect(sim.cat.spawn()).toBe(true);
      expect(sim.cat.spawn()).toBe(false);
      const a = sim.cat.anchor(sim.state.cat.active!.anchorId)!;
      expect(a).toBeDefined();
      if (a.roofId === GROUND && a.needsFreeTile) {
        const t = sim.grid.get(GROUND, a.needsFreeTile[0], a.needsFreeTile[1])!;
        expect(['cleared', 'thinning']).toContain(sim.areas.fog(sim.areas.areaOf(t)!));
        expect(t.occupantId).toBeUndefined();
      }
    }
  });

  it('a cat in a city nook survives a reload in the same nook and pays once', () => {
    const sim = grownCity(12, 5);
    const nook = sim.cat.candidates().find((a) => a.id.startsWith('nook:'))!;
    expect(sim.cat.spawn(nook.id)).toBe(true);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.state.cat.active?.anchorId).toBe(nook.id);
    expect(copy.cat.anchor(nook.id)?.pos).toEqual(nook.pos);
    expect(copy.cat.claim()).toBeDefined();
    expect(copy.cat.claim()).toBeUndefined();
  });

  it('Fog Whisker restores the next fogged area from its edge inward, within the fog rules and its cap', () => {
    const before = new Sim(createInitialState(3));
    expect(before.cat.fogWhiskerTiles()).toEqual([]); // not before the fountain
    const sim = grownCity(3, 2);
    const id = sim.areas.nextGoal()!;
    const tiles = sim.cat.fogWhiskerTiles();
    expect(tiles.length).toBeGreaterThan(3);
    expect(tiles.length).toBeLessThanOrEqual(TUNING.cat.fogWhiskerTiles);
    for (const t of tiles) expect(sim.areas.areaOf(t)).toBe(id);
    const summary = (sim.cat as unknown as Applier).apply('fogWhisker', 1, 0);
    expect(summary).toMatch(/fog thins/);
    sim.advance(5);
    for (const t of tiles) expect(t.ground).toBe('restored');
  });
});
