import { describe, expect, it } from 'vitest';
import { big } from '../src/core/Big';
import { formatCost } from '../src/core/Economy';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { BuildableType, GroundState } from '../src/core/types';
import { BUILDABLE, MACHINES } from '../src/data/machines';
import { RECIPES } from '../src/data/salvage';
import { KEEPERS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';

const NEAR = { roofId: GROUND, x: 8.5, z: 11.5 };
const oldSim = (tier = 4) => {
  const sim = new Sim(createInitialState(7, 'oldcity'));
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
  for (const [k, v] of Object.entries(sim.build.recipe(type)!)) {
    if (k === 'biomass') sim.state.resources.biomass = sim.state.resources.biomass.add(v!);
    else sim.inventory.addToStore(k as 'scrap', v!);
  }
}

describe('E21.3: recipes', () => {
  it('each recipe is paid exactly, with no price growth, and the tray never shows a classic price', () => {
    for (const type of Object.keys(RECIPES) as BuildableType[]) {
      if (type === 'reclaimer') continue; // seams only (below)
      const sim = oldSim();
      wakeKeepers(sim);
      sim.state.resources.biomass = big(0);
      const x = 12;
      const z = 12;
      ground(sim, x, z);
      if (MACHINES[type].areaTypes) continue; // needs its area type (the Reservoir Garden)
      stock(sim, type);
      stock(sim, type);
      const first = sim.build.place(type, GROUND, x, z);
      expect(first, type).toBeDefined();
      // the second costs the same (what is left is exactly one more recipe)
      for (const [k, v] of Object.entries(sim.build.recipe(type)!)) {
        if (k === 'biomass') expect(sim.econ.get('biomass').toNumber()).toBe(v);
        else expect(sim.inventory.stored(k as 'scrap'), `${type} ${k}`).toBe(v);
      }
      expect(sim.build.costLabel(type)).not.toMatch(/⚡|💧/);
    }
  });

  it('machines are locked until their fountain tier', () => {
    const sim = oldSim(0);
    for (const t of BUILDABLE) expect(sim.build.isUnlocked(t), t).toBe(false);
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
    expect(sim.build.check('relay', GROUND, 12, 12).reason).toBe('Needs Wire ➰ — make it at the crafting table');
    sim.inventory.add('wire', 10);
    sim.inventory.add('sunCell', 2);
    expect(sim.build.check('relay', GROUND, 12, 12).reason).toBe('Needs Gears ⚙️');
    sim.state.areas.clockPlaza = { fog: 'frontier', revealedAt: 0, sealed: true };
    expect(sim.build.check('relay', GROUND, 12, 12).reason).toBe('Needs Gears ⚙️ — Clock Plaza');
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
    sim.inventory.add('scrap', 8);
    sim.inventory.add('pipe', 2);
    sim.inventory.add('glassPane', 1);
    const m = sim.build.place('condenser', GROUND, 12, 12)!;
    expect(sim.inventory.count('scrap')).toBe(0);
    sim.inventory.add('scrap', 35);
    expect(sim.build.remove(m.id)).toBe(true);
    expect(sim.inventory.count('scrap')).toBe(40);
    expect(sim.inventory.stored('scrap')).toBe(3);
    expect(sim.inventory.count('pipe')).toBe(2);
    expect(sim.inventory.count('glassPane')).toBe(1);
    expect(sim.grid.get(GROUND, 12, 12)!.occupantId).toBeUndefined();
    // the fountain and the starter lamp never come down
    expect(sim.build.remove(sim.state.machines.find((q) => q.starter)!.id)).toBe(false);
  });

  it('a Reclaimer stands only on the seam of a woken region', () => {
    const sim = oldSim(2);
    stock(sim, 'reclaimer');
    sim.bot = { roofId: GROUND, x: 20.5, z: -6.5 };
    sim.inventory.withdraw('scrap');
    sim.inventory.withdraw('copper');
    sim.inventory.withdraw('timber');
    sim.state.areas.mastRow = { fog: 'thinning', revealedAt: 0 };
    ground(sim, 23, -8);
    expect(sim.build.check('reclaimer', GROUND, 22, -8).reason).toMatch(/seam/);
    expect(sim.build.check('reclaimer', GROUND, 23, -8).reason).toMatch(/Wake Signal Mast/);
    sim.state.areas.mastRow.fog = 'cleared';
    expect(sim.build.check('reclaimer', GROUND, 23, -8).ok).toBe(true);
  });

  it('classic costs are untouched', () => {
    const classic = new Sim(createInitialState(7));
    expect(classic.build.costLabel('solar')).toBe(formatCost(classic.build.cost('solar')));
    expect(classic.build.isUnlocked('chest')).toBe(false);
    expect(classic.build.cost('droneHub')).toEqual({ biomass: big(80), energy: big(30) });
  });
});
