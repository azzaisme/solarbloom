import { describe, expect, it } from 'vitest';
import { big } from '../src/core/Big';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { BuildableType, GroundState } from '../src/core/types';
import { BUILDABLE, MACHINES } from '../src/data/machines';
import { RECIPES } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';

const NEAR = { roofId: GROUND, x: 8.5, z: 11.5 };
const oldSim = (tier = 4) => {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = tier;
  sim.bot = NEAR;
  return sim;
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
  for (const [k, v] of Object.entries(RECIPES[type]!.cost)) {
    if (k === 'biomass') sim.state.resources.biomass = sim.state.resources.biomass.add(v!);
    else sim.inventory.addToStore(k as 'scrap', v!);
  }
}

describe('E21.3: recipes', () => {
  it('each recipe is paid exactly, with no price growth, and the tray never shows a classic price', () => {
    for (const type of Object.keys(RECIPES) as BuildableType[]) {
      if (type === 'reclaimer') continue; // seams only (below)
      const sim = oldSim();
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
      for (const [k, v] of Object.entries(RECIPES[type]!.cost)) {
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
    expect(sim.build.isUnlocked('solar')).toBe(true);
    expect(sim.build.isUnlocked('condenser')).toBe(true);
    expect(sim.build.isUnlocked('chest')).toBe(true);
    expect(sim.build.isUnlocked('droneHub')).toBe(false);
    ground(sim, 12, 12);
    stock(sim, 'droneHub');
    expect(sim.build.check('droneHub', GROUND, 12, 12).reason).toMatch(/tier 2/);
    sim.state.salvage!.tier = 2;
    expect(sim.build.check('droneHub', GROUND, 12, 12).ok).toBe(true);
  });

  it('a missing material is named, with its region once that region has been seen', () => {
    const sim = oldSim(1);
    ground(sim, 12, 12);
    sim.inventory.add('scrap', 12);
    expect(sim.build.check('condenser', GROUND, 12, 12).reason).toBe('Needs Copper 🔧');
    sim.state.areas.mastRow = { fog: 'frontier', revealedAt: 0, sealed: true };
    expect(sim.build.check('condenser', GROUND, 12, 12).reason).toBe('Needs Copper 🔧 — Mast Row');
  });

  it('the store only counts within reach of it', () => {
    const sim = oldSim(1);
    ground(sim, 12, 12);
    sim.inventory.addToStore('scrap', 10);
    sim.bot = { roofId: GROUND, x: 8.5, z: -60.5 };
    expect(sim.build.check('solar', GROUND, 12, 12).ok).toBe(false);
    sim.bot = NEAR;
    expect(sim.build.place('solar', GROUND, 12, 12)).toBeDefined();
  });

  it('removing a machine gives the whole recipe back, over a stack to the store', () => {
    const sim = oldSim(1);
    ground(sim, 12, 12);
    sim.inventory.add('scrap', 12);
    sim.inventory.add('copper', 6);
    const m = sim.build.place('condenser', GROUND, 12, 12)!;
    expect(sim.inventory.count('scrap')).toBe(0);
    sim.inventory.add('scrap', 35);
    expect(sim.build.remove(m.id)).toBe(true);
    expect(sim.inventory.count('scrap')).toBe(40);
    expect(sim.inventory.stored('scrap')).toBe(7);
    expect(sim.inventory.count('copper')).toBe(6);
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
});
