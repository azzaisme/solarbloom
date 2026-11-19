import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import { migrateSave } from '../src/core/SaveMigrations';
import type { CatVariant, MachineData } from '../src/core/types';
import { CAT_DECOR, DECOR_OPTION, DECOR_OPTIONS } from '../src/data/cozy';
import { DECOR_RECIPES } from '../src/data/crafting';
import { KEEPERS } from '../src/data/oldcity';
import { TUNING } from '../src/data/tuning';
import { Cozy, decorOpen } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { DECOR_ART } from '../src/rendering/DecorArt';
import { collection } from '../src/ui/BackpackModel';
import { decorRows } from '../src/ui/CraftTable';
import { openNextGoal } from './helpers';

SaveService.clock = () => 0;

/**
 * E23.12.2 (#529): rewards only a Lucky Cat gives. Cat-only decorations (one per cat until bloombot has them all,
 * then on the crafting table under E23.6.1's made-once rule) and "Ripe all around" (the planters near bloombot ripen
 * at once, offered only with something growing in one). Every test finds real cats through `sim.cat`.
 */

/** The fountain is awake, the park and `n` areas are grown (cats have nooks to hide in). */
function city(seed: number, n = 2): Sim {
  const sim = new Sim(createInitialState(seed));
  sim.state.progression.coreActivated = true;
  sim.state.salvage!.tier = 1; // build mode is open
  sim.bot = { roofId: GROUND, x: 8.5, z: 11.5 }; // by the fountain (in reach of the store)
  sim.areas.clear(PARK, true);
  for (const t of sim.areas.tiles(PARK)) {
    if (!isRestorable(t, sim.state.machines)) continue;
    t.ground = 'restored';
    t.bloom = 1;
    t.pollution = 0;
    sim.grid.touch(t);
  }
  for (let grown = 0; grown < n; grown++) {
    const id = openNextGoal(sim)!;
    for (const t of sim.areas.tiles(id)) {
      if (!isRestorable(t, sim.state.machines) || t.ground === 'restored') continue;
      t.ground = 'restored';
      t.bloom = 1;
      t.pollution = 0;
      sim.grid.touch(t);
    }
    expect(sim.areas.clear(id, true)).toBe(true);
  }
  return sim;
}

/** A cat hides (of the given rarity) and bloombot finds it. */
function findCat(sim: Sim, variant?: CatVariant) {
  sim.state.cat.active = undefined;
  expect(sim.cat.spawn()).toBe(true);
  if (variant) sim.state.cat.active!.variant = variant;
  const r = sim.cat.claim();
  expect(r).toBeDefined();
  return r!;
}

/** Restored open ground at (or, when something stands there, just beside) a spot, then a planter on it. */
function planter(sim: Sim, x0: number, z0: number): MachineData {
  sim.state.salvage!.keepers[KEEPERS.find((k) => k.region === 'saltwind')!.id] ??= { step: 'settled' };
  for (const [ox, oz] of [[0, 0], [0, 2], [0, -2], [2, 0], [-2, 0], [2, 2], [-2, 2], [2, -2], [-2, -2]]) {
    const x = x0 + ox;
    const z = z0 + oz;
    if (sim.grid.get(GROUND, x, z)?.occupantId) continue;
    clearAround(sim, x, z);
    if (sim.inventory.stored('planks') < 3) sim.inventory.addToStore('planks', 3);
    if (!sim.build.check('planter', GROUND, x, z).ok) continue;
    const m = sim.build.place('planter', GROUND, x, z);
    if (m) return m;
  }
  throw new Error(`no spot for a planter near ${x0},${z0}`);
}

/** Restored, open ground round a tile (as tests/farm-planters does). */
function clearAround(sim: Sim, x: number, z: number) {
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
}

function sow(sim: Sim, m: MachineData, crop: 'radish' | 'pumpkin' = 'radish') {
  if (!sim.farm.knows(crop)) (sim.state.salvage!.crops ??= []).push(crop);
  sim.inventory.add('seeds', 1);
  expect(sim.farm.plant(m, crop)).toBe(true);
}

describe('E23.12.2: cat-only decorations', () => {
  it('at least five, each with art and a recipe the table learns only from a cat', () => {
    expect(CAT_DECOR.length).toBeGreaterThanOrEqual(5);
    for (const id of CAT_DECOR) {
      expect(DECOR_ART, id).toContain(id);
      expect(DECOR_RECIPES.find((r) => r.id === id)?.unlock, id).toEqual({ cat: id });
    }
    // nothing else gives them: no other decoration's unlock is a cat's, and a fresh game has none open
    const sim = new Sim(createInitialState(3));
    for (const id of CAT_DECOR) expect(decorOpen(sim, DECOR_OPTION[id]), id).toBe(false);
    expect(DECOR_OPTIONS.filter((o) => 'cat' in o.unlock).map((o) => o.id)).toEqual([...CAT_DECOR]);
  });

  it('each cat leaves the next one, made: it shows in decorate mode, places free, and the table knows it', () => {
    const sim = city(11);
    const cozy = new Cozy(sim);
    const got: string[] = [];
    for (let i = 0; i < CAT_DECOR.length; i++) {
      const before = new Set(sim.state.salvage!.decorMade ?? []);
      const r = findCat(sim, 'standard');
      const fresh = CAT_DECOR.filter((id) => sim.crafting.decorMade(id) && !before.has(id));
      expect(fresh.length, `cat ${i + 1} leaves exactly one`).toBe(1);
      got.push(fresh[0]);
      expect(r.summary).toContain(`${DECOR_OPTION[fresh[0]].name} to place in your gardens`);
      // the first cat is always a Lucky Harvest (onboarding), and still is with its decoration
      if (i === 0) expect(r.type).toBe('luckyHarvest');
    }
    expect(new Set(got).size).toBe(CAT_DECOR.length);
    expect(got[0]).toBe('catstatue');
    // the rarer cats' pieces come last from ordinary cats
    expect(got.slice(-2).sort()).toEqual(['goldlantern', 'rainbowbunting']);
    // in decorate mode: open, announced once, and placed free (nothing in the backpack changes)
    const announced = cozy.checkDecorUnlocks().map((o) => o.id);
    for (const id of CAT_DECOR) {
      expect(decorOpen(sim, DECOR_OPTION[id]), id).toBe(true);
      expect(announced, id).toContain(id);
    }
    const pack = JSON.stringify(sim.state.salvage!.pack);
    const spots = sim.areas.tiles(PARK).filter((t) => !cozy.canDecorate('catstatue', GROUND, t.x, t.z));
    expect(spots.length).toBeGreaterThan(CAT_DECOR.length);
    CAT_DECOR.forEach((id, i) => expect(cozy.placeDecor(id, 0, GROUND, spots[i].x, spots[i].z), id).toBeUndefined());
    expect(JSON.stringify(sim.state.salvage!.pack)).toBe(pack);
    // the crafting table: every one is a known recipe, made (so every copy is free), under the made-once rule
    const rows = decorRows(sim);
    for (const id of CAT_DECOR) {
      expect(sim.crafting.decorations().map((r) => r.id), id).toContain(id);
      expect(rows.find((r) => r.id === id)?.made, id).toBe(true);
      expect(sim.crafting.decorProblem(id)).toBe('Already made: place it from the build menu');
    }
    // and the backpack's keepsakes list them by name
    const keeps = collection(sim).find((g) => g.title === 'Keepsakes')!;
    for (const id of CAT_DECOR) expect(keeps.rows.some((r) => r.found && r.name === DECOR_OPTION[id].name), id).toBe(true);
  });

  it('a Golden Cat leaves the golden lantern and a Rainbow Cat the rainbow bunting first', () => {
    const sim = city(12);
    findCat(sim); // the first cat is always standard: the statue
    expect(sim.crafting.decorMade('catstatue')).toBe(true);
    findCat(sim, 'golden');
    expect(sim.crafting.decorMade('goldlantern')).toBe(true);
    findCat(sim, 'rainbow');
    expect(sim.crafting.decorMade('rainbowbunting')).toBe(true);
    // a second Golden Cat, its lantern found: the next missing one instead
    const before = CAT_DECOR.filter((id) => sim.crafting.decorMade(id)).length;
    findCat(sim, 'golden');
    expect(CAT_DECOR.filter((id) => sim.crafting.decorMade(id)).length).toBe(before + 1);
  });

  it('a save that has every cat decoration gets no more decoration drops, before and after a reload', () => {
    const saver = new SaveService(undefined);
    const sim = city(13);
    sim.state.salvage!.decorMade = [...CAT_DECOR].sort();
    const made = JSON.stringify(sim.state.salvage!.decorMade);
    for (let i = 0; i < 6; i++) {
      const r = findCat(sim, i % 3 === 1 ? 'golden' : i % 3 === 2 ? 'rainbow' : 'standard');
      expect(r.summary).not.toMatch(/to place in your gardens/);
      expect(JSON.stringify(sim.state.salvage!.decorMade)).toBe(made);
    }
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.cat.nextDecor('rainbow')).toBeUndefined();
    const r = findCat(copy);
    expect(r.summary).not.toMatch(/to place in your gardens/);
    expect(JSON.stringify(copy.state.salvage!.decorMade)).toBe(made);
  });

  it('an older save keeps the cat keepsakes it earned: they come made, open to place', () => {
    const sim = new Sim(createInitialState(4));
    sim.state.cozy = { decorUnlocked: ['catstatue', 'goldlantern', 'bench'] };
    const state = migrateSave(JSON.parse(JSON.stringify(sim.state)));
    expect(state.salvage!.decorMade).toEqual(['catstatue', 'goldlantern']);
    const loaded = new Sim(state);
    expect(decorOpen(loaded, DECOR_OPTION.catstatue)).toBe(true);
    expect(decorOpen(loaded, DECOR_OPTION.pawstones)).toBe(false);
    // the next cat leaves one it didn't have
    expect(['catstatue', 'goldlantern']).not.toContain(loaded.cat.nextDecor());
    // a save without them is left as it was
    const plain = new Sim(createInitialState(4)).state;
    expect(JSON.stringify(migrateSave(JSON.parse(JSON.stringify(plain))))).toBe(JSON.stringify(plain));
  });
});

describe('E23.12.2: Ripe all around', () => {
  it('ripens every growing crop in the planters near bloombot at once, and none further away', () => {
    const sim = city(14);
    sim.water.isWatered = () => true; // every bed watered; the rest of the water system stays real (E23.4.2 checks a build against it)
    const near = [planter(sim, 12, 16), planter(sim, 15, 16)];
    const far = planter(sim, 12 + TUNING.cat.ripeRadius + 8, 16);
    for (const m of [...near, far]) sow(sim, m, 'pumpkin');
    sim.bot = { roofId: GROUND, x: 13.5, z: 18.5 };
    expect(sim.cat.ripeTargets().map((m) => m.id).sort()).toEqual(near.map((m) => m.id).sort());
    const ripened: string[] = [];
    sim.bus.on('planter.ripe', (e) => ripened.push(e.machineId));
    const text = (sim.cat as unknown as { apply(t: string, mult: number): string }).apply('ripeAround', 1);
    expect(text).toBe('The planters nearby ripen all at once');
    for (const m of near) expect(sim.farm.look(m).ripe, m.id).toBe(true);
    expect(sim.farm.look(far).ripe).toBe(false);
    expect(ripened.sort()).toEqual(near.map((m) => m.id).sort());
    // the crops are really ripe: harvesting gives the pumpkin's food
    const food = sim.inventory.count('food');
    expect(sim.farm.harvest(near[0])).toBeDefined();
    expect(sim.inventory.count('food')).toBeGreaterThan(food);
  });

  it('is offered only once there are planters with something growing near bloombot', () => {
    const sim = city(15);
    sim.water.isWatered = () => true; // every bed watered; the rest of the water system stays real (E23.4.2 checks a build against it)
    const rolls = (n = 400) => {
      const seen = new Set<string>();
      for (let i = 0; i < n; i++) seen.add(sim.cat.rollReward());
      return seen;
    };
    expect(rolls().has('ripeAround')).toBe(false); // no planters
    const m = planter(sim, 12, 16);
    sim.bot = { roofId: GROUND, x: m.x + 1.5, z: m.z + 2.5 }; // bloombot beside it
    expect(rolls().has('ripeAround')).toBe(false); // an empty planter
    sow(sim, m);
    expect(rolls().has('ripeAround')).toBe(true);
    // ripe already: nothing to ripen, never offered
    sim.farm.ripenNow(m);
    expect(rolls().has('ripeAround')).toBe(false);
  });

  it('found through a real cat: the reward ripens the planter, and its words carry no number', () => {
    const sim = city(16);
    sim.water.isWatered = () => true; // every bed watered; the rest of the water system stays real (E23.4.2 checks a build against it)
    const m = planter(sim, 12, 16);
    sow(sim, m);
    sim.bot = { roofId: GROUND, x: 13.5, z: 18.5 };
    findCat(sim); // the first cat: a Lucky Harvest
    let r = findCat(sim);
    for (let i = 0; i < 60 && r.type !== 'ripeAround'; i++) r = findCat(sim);
    expect(r.type).toBe('ripeAround');
    expect(r.summary).toMatch(/^The planter nearby ripens at once/);
    expect(r.summary).not.toMatch(/\d/);
    expect(sim.farm.look(m).ripe).toBe(true);
  });
});
