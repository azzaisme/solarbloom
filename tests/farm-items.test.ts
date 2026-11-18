import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { TileData } from '../src/core/types';
import { FARM_ITEMS, GATHER } from '../src/data/farm';
import { DAY_SECONDS, gameDays } from '../src/data/time';
import { MATERIALS } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import { MATERIAL_ICON_IDS } from '../src/ui/MaterialIcons';

SaveService.clock = () => 0;
const oldSim = (seed = 7) => new Sim(createInitialState(seed, 'oldcity'));

/** An open ground tile near the park, restored to a bloom. */
function restored(sim: Sim, bloom: number, x = 10, z = 14): TileData {
  const t = sim.grid.get(GROUND, x, z)!;
  t.blocked = false;
  t.occupantId = undefined;
  t.ground = 'restored';
  t.pollution = 0;
  t.bloom = bloom;
  sim.grid.touch(t);
  return t;
}

describe('E23.5.1: farm items', () => {
  it('biomass, food, compost and fertiliser are backpack items with stacks, icons and names', () => {
    const sim = oldSim();
    for (const id of FARM_ITEMS) {
      expect(MATERIALS[id].name).toBeTruthy();
      expect(MATERIAL_ICON_IDS).toContain(id);
      expect(sim.inventory.add(id, 45)).toBe(5); // a stack of 40, like any material
      expect(sim.inventory.deposit(id)).toBe(40);
      expect(sim.inventory.stored(id)).toBe(40);
    }
  });

  it('biomass no longer grows as a counter under old-city rules (classic still earns it)', () => {
    const sim = oldSim();
    const before = sim.econ.get('biomass').toNumber();
    const t = restored(sim, 1);
    sim.restoration.grow(t, undefined, 'player', true);
    sim.econ.add('biomass', 50);
    sim.advance(5);
    expect(sim.econ.get('biomass').toNumber()).toBe(before);
    const classic = new Sim(createInitialState(7));
    const c0 = classic.econ.get('biomass').toNumber();
    classic.econ.add('biomass', 50);
    expect(classic.econ.get('biomass').toNumber()).toBe(c0 + 50);
  });

  it('a game day is 48 minutes of play', () => {
    expect(DAY_SECONDS).toBe(2880);
    // the farm's timers are written with E23.7's game-day helper
    expect(gameDays(GATHER.regrowDays)).toBe(GATHER.regrowDays * 2880);
  });
});

describe('E23.5.1: gathering biomass from restored ground', () => {
  it('only flowered, restored, open ground has clippings; lusher ground gives more', () => {
    const sim = oldSim();
    const grass = restored(sim, 1, 10, 14);
    const flowers = restored(sim, 2, 11, 14);
    const shrubs = restored(sim, 3, 12, 14);
    expect(sim.gather.canGather(grass)).toBe(false);
    expect(sim.gather.canGather(flowers)).toBe(true);
    expect(sim.gather.yieldOf(flowers)).toBe(GATHER.base);
    expect(sim.gather.yieldOf(shrubs)).toBe(GATHER.base + GATHER.perBloom);
    const dead = sim.grid.get(GROUND, 13, 14)!;
    dead.ground = 'polluted';
    expect(sim.gather.canGather(dead)).toBe(false);
  });

  it('gathering puts biomass in the backpack and the tile grows back after a quarter game day', () => {
    const sim = oldSim();
    const t = restored(sim, 3);
    const seen: number[] = [];
    sim.bus.on('biomass.gathered', (e) => seen.push(e.got));
    expect(sim.gather.gather(t)).toBe(3);
    expect(sim.inventory.count('biomass')).toBe(3);
    expect(seen).toEqual([3]);
    expect(t.bloom).toBe(3); // clipping never takes the bloom away
    expect(sim.gather.canGather(t)).toBe(false);
    expect(sim.gather.gather(t)).toBe(0);
    sim.state.time += GATHER.regrowDays * DAY_SECONDS - 1;
    expect(sim.gather.canGather(t)).toBe(false);
    sim.state.time += 2;
    expect(sim.gather.canGather(t)).toBe(true);
    expect(sim.gather.gather(t)).toBe(3);
    expect(sim.inventory.count('biomass')).toBe(6);
  });

  it('E23.7.2: a windy day’s gather bonus multiplies the clippings', () => {
    const sim = oldSim();
    const t = restored(sim, 2);
    (sim as unknown as { weather: unknown }).weather = { effects: () => ({ gatherBonus: 2 }) };
    expect(sim.gather.yieldOf(t)).toBe(GATHER.base * 2);
  });

  it('a full stack refuses with a reason and leaves the tile unclipped', () => {
    const sim = oldSim();
    const t = restored(sim, 2);
    sim.inventory.add('biomass', 40);
    expect(sim.gather.problem(t)).toMatch(/full/);
    expect(sim.gather.gather(t)).toBe(0);
    expect(sim.gather.canGather(t)).toBe(true);
  });

  it('clipped tiles survive a save and load', () => {
    const sim = oldSim();
    const t = restored(sim, 2);
    sim.gather.gather(t);
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    const t2 = back.grid.get(GROUND, t.x, t.z)!;
    expect(back.inventory.count('biomass')).toBe(2);
    expect(back.gather.canGather(t2)).toBe(false);
  });
});
