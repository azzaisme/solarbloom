import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { DECOR_RECIPES } from '../src/data/crafting';
import { HOUSE_GROWTH, HOUSE_INSIDE } from '../src/data/oldcity';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';

/** A garden at the fountain's first step, every material in its chests and every decoration made. */
function scene(level: number, seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.areas.clear(PARK, true);
  const sv = sim.state.salvage!;
  sv.tier = HOUSE_GROWTH.opensAtStep;
  for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone'] as const) sv.store[m] = 500;
  sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
  while (sim.house.level < level) sim.house.giveAll();
  sv.decorMade = DECOR_RECIPES.map((r) => r.id).sort();
  return { sim, cozy: new Cozy(sim), id: HOUSE_INSIDE.layer };
}

const reload = (sim: Sim) => {
  const saver = new SaveService(undefined);
  saver.now = () => 1;
  const again = new Sim(saver.deserialize(saver.serialize(sim.state))!);
  const cozy = new Cozy(again);
  cozy.settleHouse();
  return { again, cozy };
};

const spots = (cozy: Cozy, id: string) =>
  cozy
    .decorations()
    .filter((d) => d.roofId === id)
    .map((d) => `${d.kind}@${d.x},${d.z}`)
    .sort();

describe('the house’s decorations after a reload', () => {
  it('a houseplant in each room of the Home is still in its square after a save and a load', () => {
    const { sim, cozy, id } = scene(4);
    for (const [x, z] of [
      [5, 7],
      [3, 2],
      [9, 1],
    ])
      expect(cozy.placeDecor('houseplant', 0, id, x, z), `${x},${z}`).toBeUndefined();
    const before = spots(cozy, id);
    expect(before).toHaveLength(3);
    const { cozy: c2 } = reload(sim);
    expect(spots(c2, id)).toEqual(before);
  });
});
