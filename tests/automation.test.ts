import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { AUTOMATION, HAND_JOBS } from '../src/data/automation';
import { gameDays } from '../src/data/time';
import { Sim } from '../src/gameplay/Sim';

const NEAR = { roofId: GROUND, x: 8.5, z: 11.5 };

/** A park with restored, open ground round (10..30, 10..30), bloombot by the fountain. */
function park() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.state.salvage!.tier = 2;
  sim.bot = NEAR;
  for (let x = 10; x < 30; x++)
    for (let z = 10; z < 30; z++) {
      const t = sim.grid.get(GROUND, x, z);
      if (!t || t.occupantId) continue;
      t.blocked = false;
      t.ground = 'restored';
      t.pollution = 0;
      if (t.feature === 'water') t.feature = 'lawn';
      sim.grid.touch(t);
    }
  // the real grid (E23.3) stays; these machines stand on a powered network (no poles laid in a test)
  Object.assign(sim.power, { isPowered: () => true });
  return sim;
}

/** Places a machine straight into the world (what build mode does once it's paid). */
function put(sim: Sim, type: MachineData['type'], x: number, z: number, size = 1): MachineData {
  const m = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, charge: 0, boostUntil: 0, builtAt: 0 } as unknown as MachineData;
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  for (const t of sim.grid.footprint(GROUND, x, z, size)) if (t) t.occupantId = m.id;
  return m;
}

/** Carries things to and from the store by hand until couriers open. */
function carryByHand(sim: Sim) {
  for (let i = 0; i < HAND_JOBS.carry.times; i++) {
    sim.inventory.add('scrap', 1);
    sim.inventory.deposit('scrap', 1);
  }
}

describe('E23.6.4: jobs done by hand open their automation', () => {
  it('the supply crate opens after things are carried to and from the store a few times', () => {
    const sim = park();
    expect(sim.build.isUnlocked('crate')).toBe(false);
    expect(sim.build.lockLabel('crate')).toBe(`🔒 Move things to and from the store (0 of ${HAND_JOBS.carry.times})`);
    sim.inventory.add('scrap', 3);
    sim.inventory.deposit('scrap', 3);
    expect(sim.automation.handCount('carry')).toBe(1);
    carryByHand(sim);
    expect(sim.automation.handDone('carry')).toBe(true);
    expect(sim.build.isUnlocked('crate')).toBe(true);
    // paying a recipe from the store is not carrying by hand
    sim.state.salvage!.hand = {};
    sim.inventory.addToStore('copper', 4);
    sim.crafting.craft('wire', 2);
    expect(sim.automation.handCount('carry')).toBe(0);
  });

  it('the Assembler needs its Keeper and things crafted by hand at the table', () => {
    const sim = park();
    sim.state.salvage!.keepers.atlas = { step: 'request1' };
    expect(sim.build.isUnlocked('assembler')).toBe(false);
    expect(sim.build.lockLabel('assembler')).toMatch(/Make components at the crafting table \(0 of 12\)/);
    sim.inventory.add('copper', 40);
    sim.crafting.craft('wire', HAND_JOBS.craft.times);
    sim.crafting.work(1000);
    expect(sim.build.isUnlocked('assembler')).toBe(true);
  });
});

describe('E23.6.4: supply crates', () => {
  it('a crate holds its own things, up to its capacity, filled and emptied by hand', () => {
    const sim = park();
    const c = put(sim, 'crate', 12, 12);
    sim.inventory.add('scrap', 30);
    expect(sim.automation.fill(c.id, 'scrap', 20)).toBe(20);
    expect(sim.automation.count(c.id, 'scrap')).toBe(20);
    expect(sim.inventory.count('scrap')).toBe(10);
    expect(sim.inventory.stored('scrap')).toBe(0); // its own box, not the shared store
    expect(sim.automation.empty(c.id, 'scrap', 5)).toBe(5);
    expect(sim.automation.count(c.id, 'scrap')).toBe(15);
    expect(sim.automation.put(c.id, 'clay', 1000)).toBe(AUTOMATION.crate.capacity - 15);
    expect(sim.automation.room(c.id)).toBe(0);
  });

  it('taking a crate down gives its contents back and drops its routes', () => {
    const sim = park();
    carryByHand(sim);
    const a = put(sim, 'crate', 12, 12);
    const b = put(sim, 'crate', 16, 12);
    sim.automation.put(a.id, 'copper', 30);
    expect(sim.automation.addRoute(a.id, b.id).id).toBeDefined();
    const copper = sim.inventory.count('copper') + sim.inventory.stored('copper');
    sim.build.remove(a.id);
    expect(sim.inventory.count('copper') + sim.inventory.stored('copper')).toBe(copper + 30);
    expect(sim.automation.routes()).toEqual([]);
  });
});

describe('E23.6.4: courier routes', () => {
  function line() {
    const sim = park();
    carryByHand(sim);
    const hub = put(sim, 'droneHub', 18, 18, 2);
    hub.role = 'courier';
    (hub.roles ??= []).push('courier');
    const a = put(sim, 'crate', 14, 16);
    const b = put(sim, 'crate', 22, 20);
    return { sim, hub, a, b };
  }

  it('a route needs couriers opened, two crates, and is set once', () => {
    const sim = park();
    const a = put(sim, 'crate', 14, 16);
    const b = put(sim, 'crate', 22, 20);
    expect(sim.automation.routeProblem(a.id, b.id)).toMatch(/Couriers open once/);
    carryByHand(sim);
    expect(sim.automation.routeProblem(a.id, a.id)).toBe('Pick another crate to send to');
    expect(sim.automation.addRoute(a.id, b.id).id).toBeDefined();
    expect(sim.automation.routeProblem(a.id, b.id)).toBe('These crates are already linked');
  });

  it('a courier drone flies a route unattended for a game day: baskets go from one crate to the other', () => {
    const { sim, hub, a, b } = line();
    sim.automation.put(a.id, 'scrap', 150);
    sim.automation.put(a.id, 'copper', 20);
    sim.automation.addRoute(a.id, b.id, 'scrap');
    expect(sim.automation.hubsFor({ from: a.id, to: b.id })).toEqual([hub]);
    let delivered = 0;
    sim.bus.on('route.delivered', (e) => (delivered += e.items));
    sim.advance(gameDays(1));
    expect(delivered).toBe(150);
    expect(sim.automation.count(b.id, 'scrap')).toBe(150);
    expect(sim.automation.count(a.id, 'scrap')).toBe(0);
    expect(sim.automation.count(a.id, 'copper')).toBe(20); // the route carries Scrap only
    // everything goes when the route carries 'all'
    sim.automation.setRouteItem(sim.automation.routes()[0].id, 'all');
    sim.advance(gameDays(0.1));
    expect(sim.automation.count(b.id, 'copper')).toBe(20);
  });

  it('a route waits while the target is full and carries on by itself', () => {
    const { sim, a, b } = line();
    sim.automation.put(b.id, 'clay', AUTOMATION.crate.capacity);
    sim.automation.put(a.id, 'scrap', 40);
    sim.automation.addRoute(a.id, b.id);
    sim.advance(120);
    expect(sim.automation.count(a.id, 'scrap')).toBe(40);
    sim.automation.take(b.id, 'clay', 100);
    sim.advance(gameDays(0.2));
    expect(sim.automation.count(b.id, 'scrap')).toBe(40);
  });

  it('a courier hub without power docks and waits (E23.6.3), then flies again', () => {
    const { sim, a, b } = line();
    let on = false;
    Object.assign(sim.power, { isPowered: () => on });
    sim.automation.put(a.id, 'scrap', 40);
    sim.automation.addRoute(a.id, b.id);
    sim.advance(120);
    expect(sim.automation.count(b.id, 'scrap')).toBe(0);
    on = true;
    sim.advance(gameDays(0.2));
    expect(sim.automation.count(b.id, 'scrap')).toBe(40);
  });

  it('Bigger baskets (research) is offered once couriers open, and each level bought carries 5 more a trip', () => {
    const sim = park();
    sim.state.salvage!.research = { analysed: [], done: ['dr-carry'], running: [], levels: {} };
    // the Baskets project is done, but nothing has been carried by hand yet: no couriers, so no upgrade for them
    expect(sim.research.upgrades().map((u) => u.id)).not.toContain('droneCarry');
    carryByHand(sim);
    expect(sim.research.upgrades().map((u) => u.id)).toContain('droneCarry');
    const base = sim.automation.carry();
    expect(base).toBe(AUTOMATION.route.carry);
    sim.inventory.add('planks', 16);
    sim.inventory.add('wire', 4);
    expect(sim.research.upgrade('droneCarry')).toBe(1);
    expect(sim.automation.carry()).toBe(base + 5);
    expect(sim.research.upgrade('droneCarry')).toBe(2);
    expect(sim.automation.carry()).toBe(base + 10);
  });
});

describe('E23.6.5: the Assembler', () => {
  function shop() {
    const sim = park();
    const asm = put(sim, 'assembler', 16, 16, 2);
    const inp = put(sim, 'crate', 15, 16);
    const out = put(sim, 'crate', 19, 17);
    return { sim, asm, inp, out };
  }

  it("crafts a known component from the crate beside it into the next one, at the table's speed", () => {
    const { sim, asm, inp, out } = shop();
    expect(sim.automation.io(asm)).toEqual({ input: inp, output: out });
    expect(sim.automation.assemblerProblem(asm)).toBe('Choose what it makes');
    expect(sim.automation.setRecipe(asm, 'wire')).toBe(true);
    expect(sim.automation.assemblerProblem(asm)).toBe('Waiting for Copper');
    sim.automation.put(inp.id, 'copper', 10);
    sim.advance(10); // a craft takes 2 s: five crafts
    expect(sim.automation.count(out.id, 'wire')).toBe(10);
    expect(sim.automation.count(inp.id, 'copper')).toBe(0);
    expect(sim.automation.assemblerProblem(asm)).toBe('Waiting for Copper');
  });

  it('pauses without grid power and carries on by itself', () => {
    const { sim, asm, inp, out } = shop();
    let on = false;
    Object.assign(sim.power, { isPowered: () => on });
    sim.automation.setRecipe(asm, 'planks');
    sim.automation.put(inp.id, 'timber', 4);
    sim.advance(10);
    expect(sim.automation.count(out.id, 'planks')).toBe(0);
    expect(sim.automation.assemblerProblem(asm)).toBe('Waiting for power');
    on = true;
    sim.advance(10);
    expect(sim.automation.count(out.id, 'planks')).toBe(8);
  });

  it('an Assembler line keeps a build supplied: a courier brings materials, the Assembler makes components', () => {
    const { sim, asm, inp, out } = shop();
    carryByHand(sim);
    const hub = put(sim, 'droneHub', 17, 19, 2);
    hub.role = 'courier';
    (hub.roles ??= []).push('courier');
    const supply = put(sim, 'crate', 13, 21);
    const site = put(sim, 'crate', 22, 20);
    expect(sim.automation.hubsFor({ from: supply.id, to: inp.id })).toEqual([hub]);
    expect(sim.automation.hubsFor({ from: out.id, to: site.id })).toEqual([hub]);
    sim.automation.put(supply.id, 'copper', 60);
    sim.automation.addRoute(supply.id, inp.id, 'copper');
    sim.automation.addRoute(out.id, site.id, 'wire');
    sim.automation.setRecipe(asm, 'wire');
    sim.advance(gameDays(0.5));
    expect(sim.automation.count(site.id, 'wire')).toBe(60);
  });

  it('only components the table knows', () => {
    const { sim, asm } = shop();
    expect(sim.automation.setRecipe(asm, 'wire')).toBe(true);
    sim.state.salvage!.tier = 0;
    expect(sim.automation.setRecipe(asm, 'nonsense' as never)).toBe(false);
  });
});
