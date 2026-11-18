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
      else if ('creature' in f) expect(['butterflies', 'birds', 'koi'], p.id).toContain(f.creature);
      else if ('crop' in f) expect(f.crop, p.id).toBe('radish'); // E23.5.2's first crop (data/crops once it lands)
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

  it('every upgrade bought does something: the systems read their levels', () => {
    const sim = station();
    sim.state.salvage!.research = { analysed: [], done: PROJECTS.map((p) => p.id), running: [], levels: {} };
    for (const m of ['seeds', 'copper', 'motor', 'gears', 'glassPane', 'wire', 'sunCell', 'glass', 'sunstone'] as const) sim.inventory.addToStore(m, 60);
    // Wider pulse: a tile further
    const broad = sim.upgrades.broadExtra;
    expect(sim.research.upgrade('pulseRadius')).toBe(1);
    expect(sim.upgrades.broadExtra).toBe(broad + 1);
    // Quicker and Further wings: drones fly faster and work further
    const hub = { id: 'h1', type: 'droneHub', roofId: GROUND, x: 20, z: 20, size: 2 } as never;
    const speed = sim.upgrades.droneSpeed(hub);
    const radius = sim.upgrades.droneRadius(hub);
    expect(sim.research.upgrade('droneSpeed')).toBe(1);
    expect(sim.research.upgrade('droneRange')).toBe(1);
    expect(sim.upgrades.droneSpeed(hub)).toBeCloseTo(speed * 1.15, 6);
    expect(sim.upgrades.droneRadius(hub)).toBe(radius + 2);
    // and none of it writes the idle upgrade state (E23.1 removes it)
    expect(sim.state.upgrades.broadPulse ?? 0).toBe(0);
    expect((hub as { upg?: unknown }).upg).toBeUndefined();
    // Longer lines and Clearer panels: the grid's pole range and solar output
    const relay = { id: 'r1', type: 'relay', roofId: GROUND, x: 10, z: 10, size: 1 } as never;
    const solar = { id: 's1', type: 'solar', roofId: GROUND, x: 12, z: 10, size: 1 } as never;
    const role = (m: unknown) => (sim.power as unknown as { roleOf(m: unknown): { pole?: { range(m: unknown, s: unknown): number }; source?(m: unknown, s: unknown, sky: unknown): number } }).roleOf(m)!;
    const range = role(relay).pole!.range(relay, sim);
    const out = role(solar).source!(solar, sim, { solar: 1, wind: 0, night: false });
    expect(sim.research.upgrade('poleReach')).toBe(1);
    expect(sim.research.upgrade('solarYield')).toBe(1);
    expect(role(relay).pole!.range(relay, sim)).toBeCloseTo(range * 1.15, 6);
    expect(role(solar).source!(solar, sim, { solar: 1, wind: 0, night: false })).toBeCloseTo(out * 1.1, 6);
  });

  it('an upgrade whose system has not landed yet is never offered', () => {
    const sim = station();
    sim.state.salvage!.research = { analysed: [], done: PROJECTS.map((p) => p.id), running: [], levels: {} };
    const offered = sim.research.upgrades().map((u) => u.id);
    // E23.4 water, E23.5 farm, E23.2.1 charge and E23.6.4 couriers are not in this game yet; no battery machine either
    for (const id of ['pumpRate', 'reservoirSize', 'evaporation', 'compostSpeed', 'cropGrowth', 'crossbreed', 'chargeCells', 'chargeEfficiency', 'sprint', 'droneCarry', 'batteryStore'])
      expect(offered, id).not.toContain(id);
    expect(sim.research.upgradeProblem('cropGrowth')).toBe('Not open yet');
    for (const id of ['backpack', 'pulseRadius', 'poleReach', 'solarYield', 'droneRange', 'droneSpeed', 'droneThrift']) expect(offered, id).toContain(id);
  });

  it('crops and creatures found open projects', () => {
    const sim = station();
    const keys = () => sim.research.finds().map((f) => JSON.stringify(f));
    expect(keys()).not.toContain(JSON.stringify({ creature: 'birds' }));
    sim.state.fauna = { ...(sim.state.fauna ?? {}), birds: 0 } as never;
    expect(keys()).toContain(JSON.stringify({ creature: 'birds' }));
    sim.research.analyse({ creature: 'birds' });
    expect(sim.research.open().map((p) => p.id)).toContain('dc-birdbath');
    (sim.state.salvage as unknown as { crops: string[] }).crops = ['radish'];
    expect(keys()).toContain(JSON.stringify({ crop: 'radish' }));
    expect(sim.research.findName({ crop: 'radish' })).toBe('Radish seeds');
    sim.research.analyse({ crop: 'radish' });
    expect(sim.research.open().map((p) => p.id)).toContain('fm-crossbreed');
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
