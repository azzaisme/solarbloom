import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { BuildableType, GroundState } from '../src/core/types';
import { BUILDABLE, MACHINES } from '../src/data/machines';
import { TIERS } from '../src/data/salvage';
import { MACHINE_RECIPES } from '../src/data/crafting';
import { KEEPERS } from '../src/data/oldcity';
import { KEEPER_RECIPES } from '../src/data/farmExtras';
import { Sim } from '../src/gameplay/Sim';

const NEAR = { roofId: GROUND, x: 8.5, z: 11.5 };
const oldSim = (tier = 4) => {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = tier;
  sim.bot = NEAR;
  return sim;
};
/** E23.6.1: wakes every Keeper (crafting-table machines unlock from them). */
const wakeKeepers = (sim: Sim) => {
  for (const k of KEEPERS) sim.state.salvage!.keepers[k.id] = { step: 'settled' };
};
/** Restores a 2×2 of park ground for building. */
function ground(sim: Sim, x: number, z: number, g: GroundState = 'restored') {
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const t = sim.grid.get(GROUND, x + dx, z + dz)!;
    t.ground = g;
    t.pollution = 0;
    t.bloom = 1;
    sim.grid.touch(t);
  }
}
/** Gives the backpack and store everything a recipe needs. */
function stock(sim: Sim, type: BuildableType) {
  for (const [k, v] of Object.entries(sim.build.recipe(type)!)) sim.inventory.addToStore(k as 'scrap', v!);
}

describe('E21.3: recipes', () => {
  it('each recipe is paid exactly, with no price growth, and the tray never shows a classic price', () => {
    for (const type of MACHINE_RECIPES.flatMap((r) => (r.builds ? [r.builds] : []))) {
      const sim = oldSim();
      wakeKeepers(sim);
      sim.state.salvage!.recipes = [...KEEPER_RECIPES]; // E23.5.4.6: these recipes come from Keeper gardens (tested there)
      const x = 12;
      const z = 12;
      ground(sim, x, z);
      if (MACHINES[type].areaTypes) continue; // needs its area type (the Reservoir Garden)
      if (type === 'pump' || type === 'desalination') continue; // on a bank / the shore only: paid exactly in tests/water-*.test.ts
      if (sim.water.unlockFor(type)) sim.state.salvage!.keepers.sluice = { step: 'request1' }; // E23.4: Cistern Basin's unlocks
      stock(sim, type);
      stock(sim, type);
      const first = sim.build.place(type, GROUND, x, z);
      expect(first, type).toBeDefined();
      // the second costs the same (what is left is exactly one more recipe)
      for (const [k, v] of Object.entries(sim.build.recipe(type)!)) expect(sim.inventory.stored(k as 'scrap'), `${type} ${k}`).toBe(v);
      expect(sim.build.costLabel(type)).not.toMatch(/⚡|💧/);
    }
  });

  it('machines are locked until their fountain tier', () => {
    const sim = oldSim(0);
    // E23.5.3: the compost bin is a home recipe, open from the start
    const home = (t: BuildableType) => MACHINE_RECIPES.some((r) => r.builds === t && 'home' in r.unlock);
    expect(sim.build.isUnlocked('compostBin')).toBe(true);
    for (const t of BUILDABLE) if (!home(t)) expect(sim.build.isUnlocked(t), t).toBe(false);
    sim.state.salvage!.tier = 1;
    // E23.6.1: the Solar panel and the Storage chest come from Keepers now (crafting-table recipes)
    expect(sim.build.isUnlocked('solar')).toBe(false);
    expect(sim.build.isUnlocked('condenser')).toBe(true);
    expect(sim.build.isUnlocked('chest')).toBe(false);
    expect(sim.build.isUnlocked('droneHub')).toBe(false);
    ground(sim, 12, 12);
    stock(sim, 'droneHub');
    expect(sim.build.check('droneHub', GROUND, 12, 12).reason).toMatch(/tier 2/);
    sim.state.salvage!.tier = 2;
    expect(sim.build.check('droneHub', GROUND, 12, 12).ok).toBe(true);
  });

  it('a missing material is named, with its region once that region has been seen', () => {
    const sim = oldSim(4);
    ground(sim, 12, 12);
    // E23.6.1: a component is named with where it is made; a material with its region once seen
    sim.inventory.add('scrap', 20);
    expect(sim.build.check('cultivator', GROUND, 12, 12).reason).toBe('Needs Motor 🌀 — make it at the crafting table');
    sim.inventory.add('motor', 2);
    expect(sim.build.check('cultivator', GROUND, 12, 12).reason).toBe('Needs Gears ⚙️');
    sim.state.areas.clockPlaza = { fog: 'frontier', revealedAt: 0, sealed: true };
    expect(sim.build.check('cultivator', GROUND, 12, 12).reason).toBe('Needs Gears ⚙️ — Clock Plaza');
    // E23.3: the power pole is a Bloom Relay, from Pylon in Mast Row
    expect(sim.build.lockLabel('relay')).toBe('🔒 Pylon, Mast Row');
  });

  it('the store only counts within reach of it', () => {
    const sim = oldSim(1);
    ground(sim, 12, 12);
    stock(sim, 'condenser');
    sim.bot = { roofId: GROUND, x: 8.5, z: -60.5 };
    expect(sim.build.check('condenser', GROUND, 12, 12).ok).toBe(false);
    sim.bot = NEAR;
    expect(sim.build.place('condenser', GROUND, 12, 12)).toBeDefined();
  });

  it('removing a machine gives the whole recipe back, over a stack to the store', () => {
    const sim = oldSim(1);
    ground(sim, 12, 12);
    sim.inventory.add('scrap', 12);
    sim.inventory.add('copper', 6);
    sim.inventory.add('wire', 2);
    const m = sim.build.place('condenser', GROUND, 12, 12)!;
    expect(sim.inventory.count('scrap')).toBe(0);
    sim.inventory.add('scrap', 31);
    expect(sim.build.remove(m.id)).toBe(true);
    expect(sim.inventory.count('scrap')).toBe(40);
    expect(sim.inventory.stored('scrap')).toBe(3);
    expect(sim.inventory.count('copper')).toBe(6);
    expect(sim.inventory.count('wire')).toBe(2);
    expect(sim.grid.get(GROUND, 12, 12)!.occupantId).toBeUndefined();
    // the fountain and the starter lamp never come down
    expect(sim.build.remove(sim.state.machines.find((q) => q.starter)!.id)).toBe(false);
  });

  it('E23.7.4: the Reclaimer is gone: not in the build list, no recipe, no tier gives it', () => {
    expect(BUILDABLE as string[]).not.toContain('reclaimer');
    expect(MACHINE_RECIPES.map((r) => r.id)).not.toContain('reclaimer');
    expect(TIERS.flatMap((t) => t.gives).join(' ')).not.toMatch(/Reclaimer/);
  });
});
