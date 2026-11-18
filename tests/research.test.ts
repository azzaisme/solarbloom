import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { COMPONENT_RECIPES, DECOR_RECIPES, MACHINE_RECIPES } from '../src/data/crafting';
import { ITEM_DEFS } from '../src/data/items';
import { KEEPERS, REGIONS } from '../src/data/oldcity';
import { MATERIALS } from '../src/data/salvage';
import { BRANCHES, PROJECTS, RESEARCH, RESEARCH_UPGRADES } from '../src/data/research';
import { Sim } from '../src/gameplay/Sim';
import { SaveService } from '../src/app/SaveService';
import { projectMinutes, upgradeRows } from '../src/ui/CraftTable';

const NEAR = { roofId: GROUND, x: 8.5, z: 11.5 };
const CACHES = new Set(REGIONS.flatMap((r) => r.caches.map((c) => c.id)));
const RECIPE_IDS = new Set([...COMPONENT_RECIPES, ...MACHINE_RECIPES, ...DECOR_RECIPES].map((r) => r.id));
const realItem = (k: string) => k === 'biomass' || k in ITEM_DEFS;

/** A new old-city game with Pylon (Mast Row) awake: the station is there. */
function station() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.state.salvage!.tier = 1;
  sim.bot = NEAR;
  sim.state.salvage!.keepers.pylon = { step: 'request1' };
  return sim;
}
const DAY = RESEARCH.daySeconds;

describe('E23.6.2: research in data', () => {
  it('each branch has at least three projects, and every project unlocks something real', () => {
    for (const b of BRANCHES) expect(PROJECTS.filter((p) => p.branch === b.id).length, b.id).toBeGreaterThanOrEqual(3);
    const ids = PROJECTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROJECTS) {
      const g = p.gives;
      if ('upgrade' in g) expect(RESEARCH_UPGRADES.some((u) => u.id === g.upgrade), p.id).toBe(true);
      else if ('recipe' in g) expect(RECIPE_IDS.has(g.recipe), p.id).toBe(true);
      else expect(g.station).toBe(2);
      for (const k of Object.keys(p.cost)) expect(realItem(k), `${p.id}: ${k}`).toBe(true);
      expect(p.days).toBeGreaterThan(0);
      expect(p.days).toBeLessThanOrEqual(1);
    }
  });

  it('every project opens from something a player can find, with no loops', () => {
    for (const p of PROJECTS) {
      const f = p.opens;
      if ('material' in f) expect(MATERIALS[f.material], p.id).toBeDefined();
      else if ('keeper' in f) expect(KEEPERS.some((k) => k.region === f.keeper), p.id).toBe(true);
      else if ('tech' in f) expect(CACHES.has(f.tech), p.id).toBe(true);
      else expect(PROJECTS.some((q) => q.id === f.project), p.id).toBe(true);
      // follow the chain back to a find
      let q = p;
      for (let i = 0; 'project' in q.opens; i++) {
        expect(i, `${p.id} loops`).toBeLessThan(PROJECTS.length);
        const prev = (q.opens as { project: string }).project;
        q = PROJECTS.find((x) => x.id === prev)!;
      }
    }
  });

  it('upgrades have one to three levels, each paid in real items, and each is opened by a project', () => {
    for (const u of RESEARCH_UPGRADES) {
      expect(u.levels.length, u.id).toBeGreaterThanOrEqual(1);
      expect(u.levels.length, u.id).toBeLessThanOrEqual(3);
      for (const l of u.levels) for (const k of Object.keys(l.cost)) expect(realItem(k), `${u.id}: ${k}`).toBe(true);
      expect(PROJECTS.some((p) => 'upgrade' in p.gives && p.gives.upgrade === u.id), u.id).toBe(true);
    }
  });

  it('every recipe the crafting table says comes from research names a real project that gives it', () => {
    for (const r of [...COMPONENT_RECIPES, ...MACHINE_RECIPES, ...DECOR_RECIPES]) {
      if (!('research' in r.unlock)) continue;
      const pid = r.unlock.research;
      const p = PROJECTS.find((x) => x.id === pid);
      expect(p, r.id).toBeDefined();
      expect(p!.gives, r.id).toEqual({ recipe: r.id });
    }
  });
});

describe('E23.6.2: the research station', { timeout: 60000 }, () => {
  it('is at home once the first Keeper wakes', () => {
    const sim = new Sim(createInitialState(7, 'oldcity'));
    expect(sim.research.on).toBe(false);
    expect(sim.research.finds()).toEqual([]);
    sim.state.salvage!.keepers.tide = { step: 'request1' };
    expect(sim.research.on).toBe(true);
  });

  it('analysing a find opens its projects; a project pays, runs over game time on power, pauses without it, and finishes', () => {
    const sim = station();
    const keys = sim.research.finds().map((f) => JSON.stringify(f));
    expect(keys).toContain(JSON.stringify({ keeper: 'mastRow' }));
    expect(sim.research.open().map((p) => p.id)).not.toContain('pw-lines');
    sim.research.analyse({ keeper: 'mastRow' });
    expect(sim.research.open().map((p) => p.id)).toContain('pw-lines');
    expect(sim.research.problem('pw-lines')).toBe('Needs Copper');
    sim.inventory.add('copper', 12);
    expect(sim.research.start('pw-lines')).toBe(true);
    expect(sim.inventory.count('copper')).toBe(0);
    const p = sim.research.project('pw-lines')!;
    sim.research.tick(p.days * DAY * 0.5);
    expect(sim.research.bench()[0].progress).toBeCloseTo(0.5, 1);
    // the grid runs dry: the project waits, and carries on by itself when power comes back
    let on = false;
    (sim as unknown as { power: { isPowered(): boolean } }).power = { isPowered: () => on };
    const before = sim.research.bench()[0].progress;
    sim.research.tick(p.days * DAY);
    expect(sim.research.bench()[0].progress).toBe(before);
    expect(sim.research.done('pw-lines')).toBe(false);
    on = true;
    sim.research.tick(p.days * DAY * 0.6);
    expect(sim.research.done('pw-lines')).toBe(true);
    expect(sim.research.bench()).toEqual([]);
    // the next project on the branch follows on, and the upgrade appears at the crafting table
    expect(sim.research.open().map((x) => x.id)).toContain('pw-battery');
    expect(upgradeRows(sim).map((u) => u.id)).toEqual(['poleReach']);
  });

  it('one project at a time until a second station is researched', () => {
    const sim = station();
    sim.state.salvage!.research = { analysed: ['keeper:mastRow'], done: ['pw-lines', 'pw-battery', 'pw-station'], running: [], levels: {} };
    for (const m of ['scrap', 'copper', 'seeds', 'timber'] as const) sim.inventory.addToStore(m, 100);
    expect(sim.research.stations()).toBe(2);
    sim.state.salvage!.research.done = ['pw-lines'];
    expect(sim.research.stations()).toBe(1);
    expect(sim.research.start('pw-battery')).toBe(true);
    expect(sim.research.problem('fm-compost')).toBe('Not open yet');
    sim.research.analyse({ material: 'seeds' });
    expect(sim.research.problem('fm-compost')).toBe('The bench is busy');
    sim.state.salvage!.research.done.push('pw-station');
    expect(sim.research.start('fm-compost')).toBe(true);
    expect(sim.research.bench().length).toBe(2);
  });

  it('stopping a project gives back what it took', () => {
    const sim = station();
    sim.research.analyse({ keeper: 'mastRow' });
    sim.inventory.add('copper', 12);
    sim.research.start('pw-lines');
    expect(sim.research.stop('pw-lines')).toBe(true);
    expect(sim.inventory.count('copper')).toBe(12);
    expect(sim.research.open().map((p) => p.id)).toContain('pw-lines');
  });

  it('upgrades are bought at the table for materials, three levels at most; the backpack one makes stacks bigger', () => {
    const sim = station();
    sim.state.salvage!.research = { analysed: [], done: ['rb-backpack'], running: [], levels: {} };
    for (const m of ['planks', 'scrap', 'clay', 'gears'] as const) sim.inventory.addToStore(m, 40);
    const base = sim.inventory.stackLimit();
    expect(sim.research.upgrade('backpack')).toBe(1);
    expect(sim.inventory.stackLimit()).toBe(base + 20);
    expect(sim.research.upgrade('backpack')).toBe(2);
    expect(sim.research.upgrade('backpack')).toBe(3);
    expect(sim.research.upgrade('backpack')).toBe(0);
    expect(sim.research.upgradeProblem('backpack')).toBe('As good as it gets');
    expect(sim.inventory.stackLimit()).toBe(base + 60);
    expect(sim.research.upgrade('sprint')).toBe(0);
  });

  it('upgrades that drive an existing effect grant its levels, also to machines built later', () => {
    const sim = station();
    sim.state.salvage!.research = { analysed: [], done: ['rb-pulse', 'dr-speed'], running: [], levels: {} };
    for (const m of ['seeds', 'copper', 'motor', 'gears'] as const) sim.inventory.addToStore(m, 40);
    expect(sim.upgrades.level('broadPulse')).toBe(0);
    expect(sim.research.upgrade('pulseRadius')).toBe(1);
    expect(sim.upgrades.level('broadPulse')).toBe(1);
    const hub = { id: 'h1', type: 'droneHub', roofId: GROUND, x: 20, z: 20, size: 2 } as never;
    sim.state.machines.push(hub);
    expect(sim.research.upgrade('droneSpeed')).toBe(1);
    expect(sim.upgrades.levelOf(hub, 'droneSpeed')).toBe(1);
    const later = { id: 'h2', type: 'droneHub', roofId: GROUND, x: 30, z: 20, size: 2 } as never;
    sim.state.machines.push(later);
    sim.bus.emit('machine.built', { machine: later });
    expect(sim.upgrades.levelOf(later, 'droneSpeed')).toBe(1);
  });

  it('a research recipe appears at the crafting table once its project is done', () => {
    const sim = station();
    expect(sim.crafting.unlocked(DECOR_RECIPES.find((r) => r.id === 'topiary')!.unlock)).toBe(false);
    sim.state.salvage!.research = { analysed: [], done: ['dc-topiary'], running: [], levels: {} };
    expect(sim.crafting.unlocked(DECOR_RECIPES.find((r) => r.id === 'topiary')!.unlock)).toBe(true);
  });

  it('the bench survives a save', () => {
    const sim = station();
    sim.research.analyse({ keeper: 'mastRow' });
    sim.inventory.add('copper', 12);
    sim.research.start('pw-lines');
    sim.advance(60);
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.research.bench()[0].progress).toBeCloseTo(sim.research.bench()[0].progress, 5);
  });

  it('project times read in minutes of play', () => {
    expect(projectMinutes(0.1)).toBe(5);
    expect(projectMinutes(1)).toBe(48);
  });
});
