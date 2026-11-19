import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { ItemId, MachineData } from '../src/core/types';
import { AUTOMATION, HAND_JOBS } from '../src/data/automation';
import { gameDays } from '../src/data/time';
import { Sim } from '../src/gameplay/Sim';

const NEAR = { roofId: GROUND, x: 8.5, z: 11.5 };

/** A park with restored, open ground round (10..30, 10..30), bloombot by the fountain. */
function park() {
  const sim = new Sim(createInitialState(7));
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

/** Every unit of an item in the world: crates, couriers' baskets, the backpack and the store (nothing may vanish). */
function total(sim: Sim, item: ItemId): number {
  let n = sim.inventory.count(item) + sim.inventory.stored(item);
  for (const c of sim.automation.crates()) n += sim.automation.count(c.id, item);
  for (const d of sim.state.drones) for (const b of d.cargo ?? []) if (b.item === item) n += b.n;
  return n;
}

describe('E23.6.4 / E23.6.5: nothing is lost', () => {
  function courierLine(drones = 1) {
    const sim = park();
    carryByHand(sim);
    const hub = put(sim, 'droneHub', 18, 18, 2);
    hub.role = 'courier';
    (hub.roles ??= []).push('courier');
    if (drones > 1) hub.upg = { secondDrone: drones - 1 };
    const a = put(sim, 'crate', 14, 16);
    const b = put(sim, 'crate', 22, 20);
    return { sim, hub, a, b };
  }
  const flying = (sim: Sim) => sim.state.drones.find((d) => d.cargo?.length);
  const until = (sim: Sim, ok: () => boolean, max = 600) => {
    for (let t = 0; t < max && !ok(); t += 0.25) sim.advance(0.25);
    return ok();
  };

  it('a courier hub taken down mid-trip: its basket goes back to its source crate', () => {
    const { sim, hub, a } = courierLine();
    sim.automation.put(a.id, 'scrap', 30);
    sim.automation.addRoute(a.id, put(sim, 'crate', 22, 22).id, 'scrap');
    expect(until(sim, () => !!flying(sim))).toBe(true);
    const before = total(sim, 'scrap');
    expect(sim.automation.count(a.id, 'scrap')).toBeLessThan(30);
    expect(sim.build.remove(hub.id)).toBe(true);
    expect(sim.state.drones.some((d) => d.hubId === hub.id)).toBe(false);
    expect(total(sim, 'scrap')).toBe(before + (sim.build.recipe('droneHub')!.scrap ?? 0)); // and the hub's own recipe back
    expect(sim.automation.count(a.id, 'scrap')).toBe(30);
  });

  it('a crate taken down while a basket is on its way to it: the basket goes back, its contents to bloombot', () => {
    const { sim, a, b } = courierLine();
    sim.automation.put(a.id, 'scrap', 30);
    sim.automation.put(b.id, 'clay', 5);
    sim.automation.addRoute(a.id, b.id, 'scrap');
    expect(until(sim, () => !!flying(sim))).toBe(true);
    const scrap = total(sim, 'scrap');
    const clay = total(sim, 'clay');
    sim.build.remove(b.id);
    expect(flying(sim)).toBeUndefined();
    expect(total(sim, 'scrap')).toBe(scrap);
    expect(total(sim, 'clay')).toBe(clay);
    expect(sim.automation.count(a.id, 'scrap')).toBe(30);
  });

  it('filled by hand while a basket was on its way: what does not fit goes back to the source, else the backpack', () => {
    const { sim, a, b } = courierLine();
    sim.automation.put(a.id, 'scrap', 10);
    sim.automation.addRoute(a.id, b.id, 'scrap');
    expect(until(sim, () => !!flying(sim))).toBe(true);
    // the target fills up by hand, and so does the source: the basket has nowhere in either
    sim.automation.put(b.id, 'clay', AUTOMATION.crate.capacity);
    sim.automation.put(a.id, 'clay', AUTOMATION.crate.capacity);
    const scrap = total(sim, 'scrap');
    const held = sim.inventory.count('scrap') + sim.inventory.stored('scrap');
    expect(until(sim, () => !flying(sim))).toBe(true);
    expect(total(sim, 'scrap')).toBe(scrap);
    expect(sim.inventory.count('scrap') + sim.inventory.stored('scrap')).toBe(held + 10);
  });

  it('two routes into one crate never book the same room', () => {
    const { sim, hub, a, b } = courierLine(2);
    const c = put(sim, 'crate', 15, 20);
    expect(sim.automation.hubsFor({ from: c.id, to: b.id })).toEqual([hub]);
    sim.automation.put(b.id, 'clay', AUTOMATION.crate.capacity - 12); // room for 12
    sim.automation.put(a.id, 'scrap', 50);
    sim.automation.put(c.id, 'copper', 50);
    sim.automation.addRoute(a.id, b.id, 'scrap');
    sim.automation.addRoute(c.id, b.id, 'copper');
    const scrap = total(sim, 'scrap');
    const copper = total(sim, 'copper');
    let over = 0;
    let both = false;
    for (let t = 0; t < 300; t += 0.25) {
      sim.advance(0.25);
      over = Math.max(over, sim.automation.booked(b.id) - sim.automation.room(b.id));
      both ||= sim.state.drones.filter((d) => d.route).length === 2;
    }
    expect(both).toBe(true); // both couriers were out at once
    expect(over).toBe(0);
    expect(sim.automation.room(b.id)).toBe(0);
    expect(total(sim, 'scrap')).toBe(scrap);
    expect(total(sim, 'copper')).toBe(copper);
    expect(sim.inventory.count('scrap') + sim.inventory.count('copper')).toBe(0); // nothing had to spill
  });

  function shop() {
    const sim = park();
    const asm = put(sim, 'assembler', 16, 16, 2);
    const inp = put(sim, 'crate', 15, 16);
    const out = put(sim, 'crate', 19, 17);
    return { sim, asm, inp, out };
  }

  it('choosing the same recipe mid-craft changes nothing; another one gives back what the craft took', () => {
    const { sim, asm, inp } = shop();
    sim.automation.setRecipe(asm, 'motor'); // 2 Gears and 1 Wire, 4 s
    sim.automation.put(inp.id, 'gears', 2);
    sim.automation.put(inp.id, 'wire', 1);
    sim.advance(1);
    const st = () => sim.state.salvage!.assemblers?.[asm.id];
    expect(st()!.left).toBeGreaterThan(0);
    expect(sim.automation.count(inp.id, 'gears')).toBe(0);
    const left = st()!.left;
    sim.automation.setRecipe(asm, 'motor');
    expect(st()!.left).toBe(left);
    sim.automation.setRecipe(asm, 'wire');
    expect(st()!.left).toBeUndefined();
    expect(sim.automation.count(inp.id, 'gears')).toBe(2);
    expect(sim.automation.count(inp.id, 'wire')).toBe(1);
    // and stopping it gives back too
    sim.automation.setRecipe(asm, 'motor');
    sim.advance(1);
    expect(sim.automation.count(inp.id, 'gears')).toBe(0);
    sim.automation.setRecipe(asm, undefined);
    expect(sim.automation.count(inp.id, 'gears')).toBe(2);
    expect(st()).toBeUndefined();
  });

  it('an Assembler taken down mid-craft gives back what the craft took', () => {
    const { sim, asm, inp } = shop();
    sim.automation.setRecipe(asm, 'motor');
    sim.automation.put(inp.id, 'gears', 2);
    sim.automation.put(inp.id, 'wire', 1);
    sim.advance(1);
    expect(sim.automation.count(inp.id, 'gears')).toBe(0);
    sim.build.remove(asm.id);
    expect(sim.automation.count(inp.id, 'gears')).toBe(2);
    expect(sim.automation.count(inp.id, 'wire')).toBe(1);
    expect(sim.state.salvage!.assemblers?.[asm.id]).toBeUndefined();
  });

  it('a craft whose output crate filled meanwhile puts what it made somewhere it is kept', () => {
    const { sim, asm, inp, out } = shop();
    sim.automation.setRecipe(asm, 'wire');
    sim.automation.put(inp.id, 'copper', 2);
    sim.advance(1);
    sim.automation.put(out.id, 'clay', AUTOMATION.crate.capacity);
    sim.automation.put(inp.id, 'clay', AUTOMATION.crate.capacity);
    sim.advance(3);
    expect(total(sim, 'wire')).toBe(2);
  });
});

describe('E23.6.5: the Assembler, chosen by the player', () => {
  it('the player chooses which crate beside it is its input and which its output', () => {
    const sim = park();
    const asm = put(sim, 'assembler', 16, 16, 2);
    const near = put(sim, 'crate', 15, 16);
    const mid = put(sim, 'crate', 19, 17);
    const far = put(sim, 'crate', 16, 19);
    expect(sim.automation.io(asm)).toEqual({ input: near, output: mid });
    expect(sim.automation.setCrate(asm, 'input', far.id)).toBe(true);
    expect(sim.automation.setCrate(asm, 'output', near.id)).toBe(true);
    expect(sim.automation.io(asm)).toEqual({ input: far, output: near });
    expect(sim.automation.setCrate(asm, 'input', put(sim, 'crate', 26, 26).id)).toBe(false); // not beside it
    sim.automation.setRecipe(asm, 'planks');
    sim.automation.put(far.id, 'timber', 1);
    sim.automation.put(near.id, 'timber', 5); // not its input now
    sim.advance(3);
    expect(sim.automation.count(near.id, 'planks')).toBe(2);
    expect(sim.automation.count(near.id, 'timber')).toBe(5);
    // the panel's button steps through the crates beside it
    expect(sim.automation.nextCrate(asm, 'output')).toBe(true);
    expect(sim.automation.io(asm).output).not.toBe(near);
  });

  it('makes any item recipe the table knows (every component today)', () => {
    const sim = park();
    expect(sim.crafting.itemRecipes().map((r) => r.id)).toEqual(sim.crafting.components().map((r) => r.id));
    const asm = put(sim, 'assembler', 16, 16, 2);
    for (const r of sim.crafting.itemRecipes()) expect(sim.automation.setRecipe(asm, r.id), r.id).toBe(true);
  });

  it('draws its power only while it crafts', () => {
    const sim = park();
    const asm = put(sim, 'assembler', 16, 16, 2);
    const inp = put(sim, 'crate', 15, 16);
    sim.automation.setRecipe(asm, 'wire');
    expect(sim.power.draw(asm)).toBe(0);
    sim.automation.put(inp.id, 'copper', 2);
    sim.advance(0.5);
    expect(sim.power.draw(asm)).toBe(AUTOMATION.assembler.draw);
    sim.advance(3);
    expect(sim.power.draw(asm)).toBe(0);
  });
});

describe('E23.6.4: building from supply crates', () => {
  it('putting everything in the store at once counts as one job by hand', () => {
    const sim = park();
    sim.inventory.add('scrap', 3);
    sim.inventory.add('copper', 3);
    sim.inventory.add('clay', 3);
    sim.inventory.depositAll();
    expect(sim.automation.handCount('carry')).toBe(1);
  });

  it('a build takes from supply crates near bloombot after the backpack, before the store', () => {
    const sim = park();
    const sv = sim.state.salvage!;
    sv.pack = { scrap: 4 };
    sv.store = { scrap: 50, copper: 50, wire: 50 };
    const crate = put(sim, 'crate', 24, 24);
    sim.automation.put(crate.id, 'scrap', 20);
    sim.automation.put(crate.id, 'copper', 6);
    sim.automation.put(crate.id, 'wire', 2);
    sim.bot = { roofId: GROUND, x: 25.5, z: 26.5 };
    const store = sim.inventory.nearStore() ? 50 : 0;
    expect(sim.inventory.available('scrap')).toBe(4 + 20 + store);
    expect(sim.inventory.pay({ scrap: 12, copper: 6, wire: 2 })).toBe(true);
    expect(sim.inventory.count('scrap')).toBe(0); // the backpack first
    expect(sim.automation.count(crate.id, 'scrap')).toBe(12); // then the crate
    expect(sim.automation.count(crate.id, 'copper')).toBe(0);
    expect(sv.store.scrap).toBe(50); // the store untouched
    // too far from the crate: it does not count
    sim.bot = { roofId: GROUND, x: 24.5, z: 24.5 + AUTOMATION.build.crateReach + 3 };
    expect(sim.inventory.available('scrap') - (sim.inventory.nearStore() ? 50 : 0)).toBe(0);
  });

  it('end to end: couriers and an Assembler keep a build site supplied, and it builds with nothing carried', () => {
    const sim = park();
    const sv = sim.state.salvage!;
    carryByHand(sim);
    sv.pack = {};
    sv.store = {};
    const asm = put(sim, 'assembler', 16, 16, 2);
    const inp = put(sim, 'crate', 15, 16);
    const out = put(sim, 'crate', 19, 17);
    const hub = put(sim, 'droneHub', 17, 19, 2);
    hub.role = 'courier';
    (hub.roles ??= []).push('courier');
    hub.upg = { secondDrone: 1 };
    const supply = put(sim, 'crate', 13, 21);
    const site = put(sim, 'crate', 22, 20);
    sim.automation.put(supply.id, 'copper', 30);
    sim.automation.put(supply.id, 'scrap', 40);
    // Copper to the Assembler; its Wire to the site; Scrap and the rest of the Copper straight to the site
    sim.automation.addRoute(supply.id, inp.id, 'copper');
    sim.automation.addRoute(out.id, site.id, 'wire');
    sim.automation.addRoute(supply.id, site.id, 'scrap');
    sim.automation.setCrate(asm, 'input', inp.id);
    sim.automation.setCrate(asm, 'output', out.id);
    sim.automation.setRecipe(asm, 'wire');
    sim.advance(gameDays(0.5));
    expect(sim.automation.count(site.id, 'scrap')).toBe(40);
    expect(sim.automation.count(site.id, 'wire')).toBeGreaterThanOrEqual(2);
    // the condenser needs Copper as well: a route for it, and more Copper to the supply crate than the Assembler uses
    sim.automation.removeRoute(sim.automation.routes().find((r) => r.to === inp.id)!.id);
    sim.automation.put(supply.id, 'copper', 6);
    sim.automation.setRouteItem(sim.automation.routes().find((r) => r.from === supply.id && r.to === site.id)!.id, 'all');
    sim.advance(gameDays(0.2));
    expect(sim.automation.count(site.id, 'copper')).toBeGreaterThanOrEqual(6);
    // bloombot at the site with an empty backpack, the store empty: the Water Condenser (12 Scrap, 6 Copper, 2 Wire)
    sim.bot = { roofId: GROUND, x: 23.5, z: 22.5 };
    expect(sim.inventory.count('scrap') + sim.inventory.count('copper') + sim.inventory.count('wire')).toBe(0);
    const before = { scrap: sim.automation.count(site.id, 'scrap'), copper: sim.automation.count(site.id, 'copper'), wire: sim.automation.count(site.id, 'wire') };
    const spot = [[24, 22], [24, 23], [25, 22], [23, 24], [21, 22]].find(([x, z]) => sim.build.check('condenser', GROUND, x, z).ok);
    expect(spot, sim.build.check('condenser', GROUND, 24, 22).reason).toBeDefined();
    expect(sim.build.place('condenser', GROUND, spot![0], spot![1])).toBeDefined();
    expect(sim.automation.count(site.id, 'scrap')).toBe(before.scrap - 12);
    expect(sim.automation.count(site.id, 'copper')).toBe(before.copper - 6);
    expect(sim.automation.count(site.id, 'wire')).toBe(before.wire - 2);
  });
});
