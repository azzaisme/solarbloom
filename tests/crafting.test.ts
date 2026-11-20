import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { GroundState } from '../src/core/types';
import { COMPONENT_IDS, COMPONENT_RECIPES, DECOR_RECIPES, MACHINE_RECIPES, type Unlock } from '../src/data/crafting';
import { CAT_DECOR, DECOR_OPTION } from '../src/data/cozy';
import { LIGHTS } from '../src/data/lights';
import { ITEM_DEFS } from '../src/data/items';
import { BUILDABLE, MACHINES } from '../src/data/machines';
import { KEEPERS, REGIONS } from '../src/data/oldcity';
import { GARDEN_REQUESTS } from '../src/data/farmExtras';
import { PROJECTS } from '../src/data/research';
import { HAND_JOBS } from '../src/data/automation';
import { Sim } from '../src/gameplay/Sim';
import { SaveService } from '../src/app/SaveService';
import { componentRows, machineRows } from '../src/ui/CraftTable';
import { itemCells } from '../src/ui/BackpackModel';
import { Cozy } from '../src/gameplay/Cozy';

const NEAR = { roofId: GROUND, x: 8.5, z: 11.5 };
const oldSim = () => {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = 1;
  sim.bot = NEAR;
  return sim;
};
const CACHES = new Set(REGIONS.flatMap((r) => r.caches.map((c) => c.id)));
const realItem = (k: string) => k in ITEM_DEFS;
/** Is an unlock somewhere a player can reach? */
function reachable(u: Unlock): boolean {
  if ('home' in u) return true;
  if ('keeper' in u) return KEEPERS.some((k) => k.region === u.keeper);
  if ('find' in u) return CACHES.has(u.find);
  if ('tier' in u) return u.tier >= 1 && u.tier <= 5;
  // E23.5.4.6: a garden gift is handed over by some Keeper's garden request
  if ('gift' in u) return Object.values(GARDEN_REQUESTS).some((rs) => rs.some((r) => r.reward.kind === 'recipe' && r.reward.machine === u.gift));
  if ('cat' in u) return CAT_DECOR.includes(u.cat); // E23.12.2: a cat-only decoration (a Lucky Cat leaves it)
  if ('hand' in u) return u.hand in HAND_JOBS; // E23.6.4: a job done by hand
  if ('all' in u) return u.all.every(reachable);
  return PROJECTS.some((p) => p.id === u.research); // E23.6.2: a real project
}

describe('E23.6.1: recipes in data', () => {
  it('every component has one recipe, naming real items, making something in a few seconds', () => {
    expect(COMPONENT_RECIPES.map((r) => r.id).sort()).toEqual([...COMPONENT_IDS].sort());
    for (const r of COMPONENT_RECIPES) {
      for (const k of Object.keys(r.cost)) expect(realItem(k), `${r.id}: ${k}`).toBe(true);
      expect(r.cost[r.id], `${r.id} needs itself`).toBeUndefined();
      expect(r.makes).toBeGreaterThan(0);
      expect(r.seconds).toBeGreaterThan(0);
      expect(r.seconds).toBeLessThanOrEqual(6);
      expect(reachable(r.unlock), r.id).toBe(true);
    }
  });

  it('the epic\'s component recipes', () => {
    const r = Object.fromEntries(COMPONENT_RECIPES.map((x) => [x.id, x]));
    expect(r.wire).toMatchObject({ cost: { copper: 2 }, makes: 2 });
    expect(r.planks).toMatchObject({ cost: { timber: 1 }, makes: 2 });
    expect(r.glassPane).toMatchObject({ cost: { glass: 2 }, makes: 1 });
    expect(r.pipe).toMatchObject({ cost: { copper: 1, clay: 2 }, makes: 4 });
    expect(r.motor.cost).toEqual({ gears: 2, wire: 1 });
    expect(r.batteryCell.cost).toEqual({ scrap: 2, wire: 2 });
    expect(r.sunCell.cost).toEqual({ sunstone: 1, glassPane: 1 });
  });

  it('every machine recipe names real items and is unlocked somewhere reachable', () => {
    const ids = MACHINE_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const want of ['planterBox', 'compostBin', 'powerPole', 'charger', 'solar', 'windTurbine', 'chest', 'beehive', 'reservoir', 'pump', 'desalination', 'battery', 'bioDigester', 'drone', 'largeSolar', 'assembler']) expect(ids).toContain(want);
    // planter boxes are Planks, so they open with Timber (Tide, Saltwind Beach); before that the farm is the ground
    expect(MACHINE_RECIPES.find((r) => r.id === 'planterBox')).toMatchObject({ cost: { planks: 3 }, unlock: { keeper: 'saltwind' } });
    for (const r of MACHINE_RECIPES) {
      expect(Object.keys(r.cost).length, r.id).toBeGreaterThan(0);
      for (const k of Object.keys(r.cost)) expect(realItem(k), `${r.id}: ${k}`).toBe(true);
      expect(reachable(r.unlock), r.id).toBe(true);
      if (r.builds) expect(MACHINES[r.builds], r.id).toBeDefined();
      else expect(r.owner, `${r.id} waits for its sub-epic`).toBeTruthy();
    }
    // the chain stays short: a machine recipe uses materials and components, never another machine
    for (const r of MACHINE_RECIPES) for (const k of Object.keys(r.cost)) expect(ids).not.toContain(k);
  });

  it('every decoration recipe is a real decoration, naming real items, unlocked somewhere reachable', () => {
    for (const r of DECOR_RECIPES) {
      expect(DECOR_OPTION[r.id], r.id).toBeDefined();
      for (const k of Object.keys(r.cost)) expect(realItem(k), `${r.id}: ${k}`).toBe(true);
      expect(reachable(r.unlock), r.id).toBe(true);
    }
  });
});

describe('E23.6.1: the crafting table', () => {
  it('a craft pays from the backpack, then the store, takes its seconds and puts what it makes in the backpack', () => {
    const sim = oldSim();
    sim.inventory.add('copper', 1);
    sim.inventory.addToStore('copper', 3);
    expect(sim.crafting.craft('wire', 2)).toBe(2);
    expect(sim.inventory.count('copper')).toBe(0);
    expect(sim.inventory.stored('copper')).toBe(0);
    expect(sim.crafting.queued()).toBe(2);
    sim.crafting.work(1.9);
    expect(sim.inventory.count('wire')).toBe(0);
    sim.crafting.work(0.1);
    expect(sim.inventory.count('wire')).toBe(2);
    sim.advance(2);
    expect(sim.inventory.count('wire')).toBe(4);
    expect(sim.crafting.queued()).toBe(0);
    expect(sim.state.salvage!.craft).toBeUndefined();
  });

  it('a craft needs what it costs, and far from the store only the backpack counts', () => {
    const sim = oldSim();
    expect(sim.crafting.problem('wire')).toBe('Needs Copper');
    sim.inventory.addToStore('copper', 2);
    sim.bot = { roofId: GROUND, x: 8.5, z: -60.5 };
    expect(sim.crafting.craft('wire')).toBe(0);
    sim.bot = NEAR;
    expect(sim.crafting.craft('wire')).toBe(1);
  });

  it('a component can be part of a component recipe (the chain is material → component → machine)', () => {
    const sim = oldSim();
    sim.inventory.add('gears', 2);
    expect(sim.crafting.problem('motor')).toBe('Needs Wire');
    sim.inventory.add('wire', 1);
    expect(sim.crafting.craft('motor')).toBe(1);
    sim.advance(4);
    expect(sim.inventory.count('motor')).toBe(1);
  });

  it('stopping a queued craft gives back everything it had not made yet', () => {
    const sim = oldSim();
    sim.inventory.add('timber', 3);
    expect(sim.crafting.craft('planks', 3)).toBe(3);
    sim.crafting.work(2);
    expect(sim.inventory.count('planks')).toBe(2);
    expect(sim.crafting.cancel(0)).toBe(true);
    expect(sim.inventory.count('timber')).toBe(2);
    sim.advance(5);
    expect(sim.inventory.count('planks')).toBe(2);
  });

  it('what a craft makes over a full stack goes to the store', () => {
    const sim = oldSim();
    sim.inventory.add('wire', sim.inventory.stackLimit() - 1);
    sim.inventory.add('copper', 2);
    sim.crafting.craft('wire');
    sim.advance(2);
    expect(sim.inventory.count('wire')).toBe(sim.inventory.stackLimit());
    expect(sim.inventory.stored('wire')).toBe(1);
  });

  it('a crafting-table machine is built from its recipe, unlocks when its Keeper wakes, and comes down whole', () => {
    const sim = oldSim();
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const t = sim.grid.get(GROUND, 12 + dx, 12 + dz)!;
      t.ground = 'restored' as GroundState;
      t.pollution = 0;
      sim.grid.touch(t);
    }
    expect(sim.build.recipe('solar')).toEqual({ scrap: 4, glassPane: 2, wire: 1 });
    expect(sim.build.isUnlocked('solar')).toBe(false);
    expect(sim.build.lockLabel('solar')).toBe('🔒 Tally, Old Market');
    sim.state.salvage!.keepers.tally = { step: 'request1' };
    expect(sim.build.isUnlocked('solar')).toBe(true);
    sim.inventory.add('scrap', 4);
    sim.inventory.add('wire', 1);
    expect(sim.build.check('solar', GROUND, 12, 12).reason).toMatch(/Glass pane/);
    sim.inventory.add('glassPane', 2);
    const m = sim.build.place('solar', GROUND, 12, 12)!;
    expect(m).toBeDefined();
    expect(sim.inventory.count('glassPane')).toBe(0);
    expect(sim.build.remove(m.id)).toBe(true);
    expect(sim.inventory.count('glassPane')).toBe(2);
    expect(sim.inventory.count('wire')).toBe(1);
    expect(sim.inventory.count('scrap')).toBe(4);
  });

  it('the table lists the components known, and only machines that can be built', () => {
    const sim = oldSim();
    sim.inventory.add('copper', 4);
    const rows = componentRows(sim);
    expect(rows.map((r) => r.id)).toEqual(COMPONENT_IDS);
    const wire = rows.find((r) => r.id === 'wire')!;
    expect(wire.problem).toBeUndefined();
    expect(wire.label).toBe('Wire, makes 2 from 2 Copper, 0 at hand');
    expect(rows.find((r) => r.id === 'motor')!.problem).toBeDefined();
    // at fountain tier 1 the table knows the home kit (the compost bin, E23.5.3) and the Water Condenser; each Keeper adds its machines
    expect(machineRows(sim).map((m) => m.id)).toEqual(['compostBin', 'condenser']);
    for (const k of KEEPERS) sim.state.salvage!.keepers[k.id] = { step: 'settled' };
    expect(machineRows(sim).map((m) => m.id)).toEqual(MACHINE_RECIPES.filter((r) => r.builds && sim.crafting.unlocked(r.unlock)).map((r) => r.id));
    expect(machineRows(sim).map((m) => m.id)).toContain('solar');
  });

  it('components carried show in the backpack after the materials', () => {
    const sim = oldSim();
    expect(itemCells(sim).some((c) => c.id === 'wire')).toBe(false);
    sim.inventory.add('wire', 3);
    const wire = itemCells(sim).find((c) => c.id === 'wire')!;
    expect(wire.label).toBe(`Wire, 3 of ${sim.inventory.stackLimit()} in backpack, 0 in store`);
    expect(wire.from).toBe('Made at the crafting table');
  });

  it('a decoration is made once at the table, then placed free; a found one waits for its cache', () => {
    const sim = oldSim();
    const cozy = new Cozy(sim);
    const t = sim.grid.get(GROUND, 12, 12)!;
    t.ground = 'restored';
    t.pollution = 0;
    sim.grid.touch(t);
    expect(cozy.canDecorate('bench', GROUND, 12, 12)).toBe('Not made yet: it is made at the crafting table');
    expect(sim.crafting.decorProblem('bench')).toBe('Needs Planks');
    sim.inventory.add('planks', 3);
    expect(sim.crafting.makeDecor('bench')).toBe(true);
    expect(sim.inventory.count('planks')).toBe(1);
    expect(sim.crafting.decorProblem('bench')).toMatch(/Already made/);
    // placing copies is free, and so is taking them away
    expect(cozy.placeDecor('bench', 0, GROUND, 12, 12)).toBeUndefined();
    expect(sim.inventory.count('planks')).toBe(1);
    cozy.removeDecor(GROUND, 12, 12);
    expect(sim.inventory.count('planks')).toBe(1);
    expect(cozy.checkDecorUnlocks().map((o) => o.id)).toEqual(['bench']);
    // the crate stack is found in a Saltwind Beach cache
    expect(sim.crafting.decorProblem('cratestack')).toBe('🔒 Not found yet');
    expect(cozy.decorChoices().find((c) => c.option.id === 'cratestack')!.unlocked).toBe(false);
    sim.state.salvage!.caches.push('c-saltwind-1');
    expect(cozy.canDecorate('cratestack', GROUND, 12, 12)).toBe('Not made yet: it is made at the crafting table');
    sim.inventory.add('planks', 3);
    expect(sim.crafting.makeDecor('cratestack')).toBe(true);
    expect(cozy.checkDecorUnlocks().map((o) => o.id)).toEqual(['cratestack']);
    expect(cozy.checkDecorUnlocks()).toEqual([]);
    expect(cozy.canDecorate('cratestack', GROUND, 12, 12)).toBeUndefined();
  });

  it('E23.3.5: every night light is made at the table at its own cost, and only made ones can be placed', () => {
    for (const l of LIGHTS) {
      const r = DECOR_RECIPES.find((d) => d.id === l.id);
      expect(r, l.id).toBeDefined();
      expect(r!.cost, l.id).toEqual(l.cost);
    }
    expect(DECOR_RECIPES.find((d) => d.id === 'solarlamppost')).toEqual({ id: 'solarlamppost', cost: { scrap: 3, glassPane: 1, sunCell: 1 }, unlock: { find: 'c-mastRow-1' } });
    const sim = oldSim();
    const cozy = new Cozy(sim);
    const t = sim.grid.get(GROUND, 12, 12)!;
    t.ground = 'restored';
    t.pollution = 0;
    sim.grid.touch(t);
    const open = (id: string) => cozy.decorChoices().find((c) => c.option.id === id)!.unlocked;
    // a starting light is known at home, but not placed until it is made
    expect(sim.crafting.decorProblem('solarstake')).toBe('Needs Sun cell');
    expect(open('solarstake')).toBe(false);
    // a found light: its cache alone no longer opens it (no fallback to the light's own unlock)
    sim.state.salvage!.caches.push('c-mastRow-1');
    expect(open('solarlamppost')).toBe(false);
    expect(cozy.canDecorate('solarlamppost', GROUND, 12, 12)).toBe('Not made yet: it is made at the crafting table');
    sim.inventory.add('scrap', 3);
    sim.inventory.add('glassPane', 1);
    sim.inventory.add('sunCell', 1);
    expect(sim.crafting.makeDecor('solarlamppost')).toBe(true);
    expect(open('solarlamppost')).toBe(true);
    expect(cozy.canDecorate('solarlamppost', GROUND, 12, 12)).toBeUndefined();
    // a researched light waits for its research, whatever else is done
    expect(sim.crafting.decorProblem('fairylights')).toBe('🔒 Research');
  });

  it('every machine is built from a crafting-table recipe', () => {
    for (const t of BUILDABLE) {
      expect(MACHINE_RECIPES.find((r) => r.builds === t), t).toBeDefined();
    }
  });

  it('the queue survives a save (it lives in the salvage state)', () => {
    const sim = oldSim();
    sim.inventory.add('timber', 2);
    sim.crafting.craft('planks', 2);
    sim.crafting.work(1);
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    copy.bot = NEAR;
    expect(copy.crafting.queued()).toBe(2);
    copy.advance(3);
    expect(copy.inventory.count('planks')).toBe(4);
  });
});
