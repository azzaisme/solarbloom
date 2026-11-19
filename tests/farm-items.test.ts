import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { TileData } from '../src/core/types';
import { FARM_ITEMS, GATHER } from '../src/data/farm';
import { DAY_SECONDS, gameDays } from '../src/data/time';
import { MATERIALS } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import { big } from '../src/core/Big';
import { TUNING } from '../src/data/tuning';
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
    sim.advance(30);
    expect(sim.econ.get('biomass').toNumber()).toBe(before);
    const classic = new Sim(createInitialState(7));
    const c0 = classic.econ.get('biomass').toNumber();
    classic.econ.add('biomass', 50);
    expect(classic.econ.get('biomass').toNumber()).toBe(c0 + 50);
  });

  it('biomass prices (a drone refit) are paid from the backpack and the store within reach, never a frozen counter', () => {
    const sim = oldSim();
    sim.state.caps.energy = big(1000);
    sim.state.caps.water = big(1000);
    sim.econ.add('energy', 500);
    sim.econ.add('water', 500);
    const hub = { id: 'hub1', type: 'droneHub' as const, roofId: GROUND, x: 4, z: 4, size: 2, boostUntil: 0, timer: 0, charge: 0 };
    sim.state.machines.push(hub);
    sim.roles.lockedReason = () => undefined;
    const price = TUNING.drone.roles.refit.gardener.biomass;
    // the old counter holds plenty, but it no longer pays for anything
    sim.state.resources.biomass = big(10_000);
    expect(sim.econ.get('biomass').toNumber()).toBe(0);
    expect(sim.roles.check(hub.id, 'gardener').ok).toBe(false);
    expect(sim.roles.check(hub.id, 'gardener').reason).toMatch(/🌿/);
    // gathered biomass pays: part from the backpack, the rest from the store
    sim.inventory.add('biomass', 30);
    sim.inventory.addToStore('biomass', price);
    const ap = sim.inventory.accessPoints()[0];
    sim.bot = { roofId: ap.roofId, x: ap.x, z: ap.z }; // bloombot beside the store
    expect(sim.econ.get('biomass').toNumber()).toBe(sim.inventory.available('biomass'));
    expect(sim.roles.choose(hub.id, 'gardener')).toBe(true);
    expect(sim.inventory.count('biomass') + sim.inventory.stored('biomass')).toBe(30); // the refit took exactly its price
    expect(sim.inventory.count('biomass')).toBe(0); // the backpack is spent first
    // classic rules still pay from the counter
    const classic = new Sim(createInitialState(7));
    classic.econ.add('biomass', 5);
    expect(classic.econ.spend({ biomass: 5 })).toBe(true);
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
