import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { CROPS, type CropId } from '../src/data/crops';
import { FRIENDSHIP, KEEPER_STORIES } from '../src/data/keepers';
import { KEEPERS } from '../src/data/oldcity';
import { MATERIALS } from '../src/data/salvage';
import { DAY_SECONDS } from '../src/data/time';
import { Sim } from '../src/gameplay/Sim';
import { oneOffItems } from '../src/ui/BackpackModel';
import { tradeHtml } from '../src/ui/OldCityPanel';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);

/** An old-city game by the fountain, every bed watered (tests/water-levels has the real water). */
function farm(): Sim {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = 1;
  sim.bot = { roofId: GROUND, x: 8.5, z: 11.5 };
  sim.water.isWatered = () => true; // every bed watered; the rest of the water system stays real (E23.4.2 checks a build against it)
  return sim;
}

/** A planter on restored open ground (as tests/farm-planters places one). */
function planter(sim: Sim, x: number, z: number): MachineData {
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      const t = sim.grid.get(GROUND, x + dx, z + dz)!;
      t.blocked = false;
      t.feature = undefined;
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = 1;
      sim.grid.touch(t);
    }
  sim.state.salvage!.keepers[KEEPERS.find((k) => k.region === 'saltwind')!.id] ??= { step: 'settled' };
  sim.inventory.addToStore('planks', 3);
  const m = sim.build.place('planter', GROUND, x, z);
  expect(m, 'planter placed').toBeDefined();
  return m!;
}

/** Plants, grows and harvests one crop for real. */
function harvestOne(sim: Sim, m: MachineData, crop: CropId) {
  if (!sim.farm.knows(crop)) (sim.state.salvage!.crops ??= []).push(crop);
  sim.inventory.add('seeds', 1);
  expect(sim.farm.plant(m, crop), crop).toBe(true);
  for (let i = 0; i < 60 * 24 && !sim.farm.look(m).ripe; i++) {
    sim.state.time += 60;
    sim.farm.tick(60);
  }
  expect(sim.farm.look(m).ripe, `${crop} ripe`).toBe(true);
  expect(sim.farm.harvest(m)).toBeDefined();
}

describe('E23.9.2: crops from E23.5 count as gifts', () => {
  it('everything a Keeper loves is a material or a crop the farm grows', () => {
    for (const k of KEEPERS) {
      const st = KEEPER_STORIES[k.id];
      for (const like of [...st.likes, FRIENDSHIP.everyoneLikes]) expect(like in MATERIALS || like in CROPS, `${k.id} loves ${like}`).toBe(true);
    }
    expect(FRIENDSHIP.everyoneLikes in CROPS).toBe(true);
  });

  it('a harvested tomato is kept for a friend, and a Keeper takes it as a gift (every Keeper loves a tomato)', () => {
    const sim = farm();
    const m = planter(sim, 12, 16);
    // Pylon settled, bloombot carrying nothing else it loves
    sim.gates.openRegion('mastRow');
    sim.state.salvage!.keepers.pylon = { step: 'settled' };
    for (const l of KEEPER_STORIES.pylon.likes) if (l in MATERIALS) expect(sim.inventory.count(l as never)).toBe(0);
    expect(sim.keepers.giftFor('pylon')).toBeUndefined();

    harvestOne(sim, m, 'tomato');
    expect(sim.state.salvage!.basket).toEqual({ tomato: 1 });
    // the Backpack shows it
    expect(oneOffItems(sim)).toContainEqual({ id: 'basket:tomato', name: 'Tomato', from: 'Kept for a friend' });
    // and a save keeps it
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.state.salvage!.basket).toEqual({ tomato: 1 });

    expect(sim.keepers.giftFor('pylon')).toBe('tomato');
    expect(sim.keepers.interact('pylon')).toBe('gave');
    expect(sim.keepers.hearts('pylon')).toBe(1);
    expect(sim.state.salvage!.basket?.tomato ?? 0).toBe(0);
    expect(oneOffItems(sim).some((i) => i.id === 'basket:tomato')).toBe(false);
  });

  it('flowers are Fern\'s gift; the basket keeps one from each harvest, up to its limit', () => {
    const sim = farm();
    const m = planter(sim, 12, 16);
    sim.gates.openRegion('glasshouse');
    sim.state.salvage!.keepers.fern = { step: 'settled' };
    harvestOne(sim, m, 'flowers');
    expect(sim.keepers.giftFor('fern')).toBe('flowers');
    // up to the limit
    for (let i = 0; i < FRIENDSHIP.basketMax + 2; i++) harvestOne(sim, m, 'flowers');
    expect(sim.state.salvage!.basket!.flowers).toBe(FRIENDSHIP.basketMax);
    // a Keeper takes one gift a game day
    expect(sim.keepers.interact('fern')).toBe('gave');
    expect(sim.state.salvage!.basket!.flowers).toBe(FRIENDSHIP.basketMax - 1);
    expect(sim.keepers.giftFor('fern')).toBeUndefined();
    sim.state.time += DAY_SECONDS;
    expect(sim.keepers.giftFor('fern')).toBe('flowers');
  });

  it('Tally\'s panel names a crop gift', () => {
    const sim = farm();
    const m = planter(sim, 12, 16);
    sim.state.salvage!.keepers.tally = { step: 'settled' };
    harvestOne(sim, m, 'radish');
    const html = tradeHtml(sim, undefined);
    expect(html).toContain('Give Tally 1 Radish');
  });
});
