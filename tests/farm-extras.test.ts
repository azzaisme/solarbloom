import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import { keeperById } from '../src/core/OldCityLayout';
import type { MachineData, MachineType } from '../src/core/types';
import { COMPOST } from '../src/data/compost';
import { CROPS } from '../src/data/crops';
import { DAY_SECONDS } from '../src/data/time';
import { BEEHIVE, GARDEN_REQUESTS, HOMES, MUSHROOM_LOG, ORCHARD, WORM_BIN, type HomeKind } from '../src/data/farmExtras';
import { KEEPERS, REGIONS } from '../src/data/oldcity';
import { RECIPES } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;

function farm(): Sim {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.state.salvage!.tier = 3;
  sim.state.salvage!.recipes = ['wormBin', 'fishPond', 'butterflyGarden', 'batBox'];
  sim.bot = { roofId: GROUND, x: 8.5, z: 11.5 };
  return sim;
}

/** Sets a square of ground (centre x, z) to restored at a bloom, open and dry. */
function ground(sim: Sim, x: number, z: number, r: number, bloom: number) {
  for (let dx = -r; dx <= r; dx++)
    for (let dz = -r; dz <= r; dz++) {
      const t = sim.grid.get(GROUND, x + dx, z + dz)!;
      t.blocked = false;
      t.feature = undefined;
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = bloom;
      sim.grid.touch(t);
    }
}

/** Builds a farm machine (stocking its recipe first). */
function build(sim: Sim, type: MachineType, x: number, z: number): MachineData {
  for (const [k, v] of Object.entries(RECIPES[type as 'planter']!.cost)) sim.inventory.addToStore(k as 'scrap', v!);
  const t = sim.grid.get(GROUND, x, z)!;
  if (t.ground !== 'restored') ground(sim, x, z, 0, 1);
  const m = sim.build.place(type as 'planter', GROUND, x, z);
  expect(m, `${type} at ${x},${z}: ${sim.build.check(type as 'planter', GROUND, x, z).reason ?? ''}`).toBeDefined();
  return m!;
}

/** Runs the farm systems alone for some seconds of play, in minute steps. */
function run(sim: Sim, seconds: number) {
  for (let left = seconds; left > 0; left -= 60) {
    const dt = Math.min(60, left);
    sim.state.time += dt;
    sim.farm.tick(dt);
    sim.compost.tick(dt);
    sim.farmExtras.tick(dt);
  }
}

describe('E23.5.4.1: beehives', () => {
  it('bees settle near flowers, make honey over game days, and speed the crops in reach', () => {
    const sim = farm();
    ground(sim, 12, 16, 4, 1);
    const hive = build(sim, 'beehive', 12, 16);
    const p = build(sim, 'planter', 14, 16);
    sim.inventory.add('seeds', 1);
    sim.state.salvage!.crops = ['pumpkin']; // five days: still growing when the bees arrive
    sim.farm.plant(p, 'pumpkin');
    expect(sim.farmExtras.hiveSettled(hive)).toBe(false);
    const before = sim.farm.look(p).rate;
    run(sim, DAY_SECONDS);
    expect(sim.farmExtras.st(hive).ready ?? 0).toBe(0); // no flowers, no bees, no honey
    ground(sim, 10, 16, 1, 2); // a patch of flowers beside it
    expect(sim.farmExtras.hiveSettled(hive)).toBe(true);
    expect(sim.farm.look(p).rate).toBeCloseTo(before * BEEHIVE.cropBoost);
    run(sim, BEEHIVE.honeyDays * DAY_SECONDS + 1);
    expect(sim.farmExtras.takeHoney(hive)).toBe(1);
    expect(sim.inventory.count('honey')).toBe(1);
  });
});

describe('E23.5.4.2: fish ponds', () => {
  it('done when: a planter fed from a fish pond needs no fertiliser', () => {
    const sim = farm();
    ground(sim, 12, 16, 3, 1);
    const p = build(sim, 'planter', 13, 16);
    sim.state.salvage!.crops = ['pumpkin'];
    sim.inventory.add('seeds', 1);
    sim.farm.plant(p, 'pumpkin');
    expect(sim.farm.look(p).unmet).toContain('fertiliser');
    const pond = build(sim, 'fishPond', 11, 16);
    expect(sim.farm.look(p).unmet).not.toContain('fertiliser');
    // a pond left dry (no water near it, once E23.4's network is there) feeds nothing
    (sim as unknown as { water: unknown }).water = { isWatered: (t: MachineData) => t.id !== pond.id };
    expect(sim.farm.look(p).unmet).toContain('fertiliser');
  });
});

describe('E23.5.4.3: orchards', () => {
  it('fruit every few game days after the first crop; pruning gives timber; an unpruned tree fruits less, never none', () => {
    const sim = farm();
    const tree = build(sim, 'orchard', 12, 16);
    run(sim, (ORCHARD.firstFruitDays - 0.1) * DAY_SECONDS);
    expect(sim.farmExtras.fruitReady(tree)).toBe(false);
    run(sim, 0.2 * DAY_SECONDS);
    expect(sim.farmExtras.fruitReady(tree)).toBe(true);
    expect(sim.farmExtras.pick(tree)).toBe(ORCHARD.fruit);
    run(sim, (ORCHARD.fruitDays + 0.1) * DAY_SECONDS);
    expect(sim.farmExtras.overgrown(tree)).toBe(true);
    // this crop grew while overgrown: half
    expect(sim.farmExtras.pick(tree)).toBe(Math.round(ORCHARD.fruit * ORCHARD.overgrownFruit));
    expect(sim.farmExtras.prune(tree)).toBe(ORCHARD.timber);
    expect(sim.inventory.count('timber')).toBeGreaterThanOrEqual(ORCHARD.timber);
    expect(sim.farmExtras.overgrown(tree)).toBe(false);
    run(sim, (ORCHARD.fruitDays + 0.1) * DAY_SECONDS);
    expect(sim.farmExtras.pick(tree)).toBe(ORCHARD.fruit);
  });
});

describe('E23.5.4.4: mushroom logs and worm bins', () => {
  it('a log fed compost grows food only shaded, and only at night or in fog', () => {
    const sim = farm();
    ground(sim, 12, 16, 2, 1);
    const log = build(sim, 'mushroomLog', 12, 16);
    sim.inventory.add('compost', 1);
    expect(sim.farmExtras.inoculate(log)).toBe(true);
    let night = true;
    sim.clock.gameIsNight = () => night; // the game clock's night, held still for the test
    run(sim, DAY_SECONDS);
    expect(sim.farmExtras.st(log).ready ?? 0).toBe(0); // no shade
    const shade = sim.grid.get(GROUND, 13, 16)!;
    shade.blocked = true;
    night = false;
    run(sim, DAY_SECONDS);
    expect(sim.farmExtras.st(log).ready ?? 0).toBe(0); // shaded, but daytime and clear
    sim.state.salvage!.weather = { kind: 'mist', until: 1e9 };
    run(sim, MUSHROOM_LOG.flushDays * DAY_SECONDS + 60);
    expect(sim.farmExtras.pickMushrooms(log)).toBe(MUSHROOM_LOG.food);
    sim.state.salvage!.weather = { kind: 'clear', until: 1e9 };
    night = true;
    run(sim, MUSHROOM_LOG.flushDays * DAY_SECONDS + 60);
    expect(sim.farmExtras.pickMushrooms(log)).toBe(MUSHROOM_LOG.food);
  });

  it('E23.8.1: in Glasshouse Gardens (shelter) a shaded log grows mushrooms by day too', () => {
    const sim = farm();
    const r = REGIONS.find((q) => q.id === 'glasshouse')!;
    const x = r.landmark.x + 4;
    const z = r.landmark.z + 4;
    ground(sim, x, z, 2, 1);
    const log = build(sim, 'mushroomLog', x, z);
    const shade = sim.grid.get(GROUND, x + 1, z)!;
    shade.blocked = true;
    sim.inventory.add('compost', 1);
    sim.farmExtras.inoculate(log);
    sim.clock.gameIsNight = () => false;
    sim.state.salvage!.weather = { kind: 'clear', until: 1e9 };
    expect(sim.farmExtras.logGrowing(log)).toBe(true);
  });

  it('a fed worm bin makes the compost bin beside it work twice as fast', () => {
    const slow = farm();
    const fast = farm();
    for (const sim of [slow, fast]) {
      ground(sim, 12, 16, 2, 1);
      const bin = build(sim, 'compostBin', 12, 16);
      sim.inventory.add('biomass', 12);
      sim.compost.fill(bin, 'biomass');
    }
    const worms = build(fast, 'wormBin', 13, 16);
    fast.inventory.add('food', WORM_BIN.feedCost);
    expect(fast.farmExtras.feedWorms(worms)).toBe(true);
    const t = COMPOST.compostDays * DAY_SECONDS + 60;
    run(slow, t);
    run(fast, t);
    const made = (sim: Sim) => {
      const st = sim.compost.bin(sim.machinesOfType('compostBin')[0]);
      return (st.compost ?? 0) + (st.fertiliser ?? 0);
    };
    expect(made(slow)).toBe(1);
    expect(made(fast)).toBe(2);
    // the worms go hungry after their feeding runs out, and the bin slows back down
    run(fast, WORM_BIN.feedDays * DAY_SECONDS);
    expect(fast.compost.speed(fast.machinesOfType('compostBin')[0])).toBe(1);
  });
});

describe('E23.5.4.5: wildlife homes', () => {
  /** Puts a home in its right habitat (true) or a bare one (false), and lets a quarter day pass. */
  function home(kind: HomeKind, right: boolean): { sim: Sim; m: MachineData } {
    const sim = farm();
    ground(sim, 12, 16, 4, right && kind !== 'batBox' ? 3 : 1);
    const m = build(sim, kind, 12, 16);
    if (right && kind === 'batBox') {
      const t = sim.grid.get(GROUND, 14, 16)!;
      t.feature = 'water';
      sim.grid.touch(t);
    }
    run(sim, 0.3 * DAY_SECONDS);
    return { sim, m };
  }

  it.each(Object.keys(HOMES) as HomeKind[])('%s attracts its creature in the right habitat, and not in a bare one', (kind) => {
    const yes = home(kind, true);
    expect(yes.sim.farmExtras.missing(yes.m)).toEqual([]);
    expect(yes.sim.farmExtras.occupied(yes.m), `${kind} in its habitat`).toBe(true);
    const no = home(kind, false);
    expect(no.sim.farmExtras.occupied(no.m), `${kind} in bare ground`).toBe(false);
    expect(no.sim.farmExtras.missing(no.m).length).toBeGreaterThan(0);
  });

  it('a hedgehog moves out gently when a machine is built right beside its house, and back when it goes', () => {
    const { sim, m } = home('hedgehogHouse', true);
    expect(sim.farmExtras.occupied(m)).toBe(true);
    const moved: boolean[] = [];
    sim.bus.on('wildlife.moved', (e) => moved.push(e.in));
    const chest = build(sim, 'chest' as MachineType, 13, 16);
    run(sim, 60);
    expect(sim.farmExtras.occupied(m)).toBe(false);
    sim.build.remove(chest.id);
    run(sim, 0.3 * DAY_SECONDS);
    expect(sim.farmExtras.occupied(m)).toBe(true);
    expect(moved).toEqual([false, true]);
  });

  it('bats live in their box by day and fly at night', () => {
    const { sim, m } = home('batBox', true);
    let night = false;
    sim.clock.gameIsNight = () => night; // the game clock's night, held still for the test
    expect(sim.farmExtras.occupied(m)).toBe(true);
    expect(sim.farmExtras.creatureOut(m)).toBe(false);
    night = true;
    expect(sim.farmExtras.creatureOut(m)).toBe(true);
  });
});

describe('E23.5.4: every one raises its area’s diversity', () => {
  it('each tended kind and each creature adds to diversityIn(area) and to the city’s biodiversity', () => {
    const sim = farm();
    ground(sim, 12, 20, 3, 3);
    const area = sim.areas.map.areaOfCell(12, 20); // all of these stand in Saltwind (the park ends at z 16)
    let last = sim.farmExtras.diversityIn(area);
    const bio0 = sim.ecosystem.score().score;
    for (const [type, x, z] of [['orchard', 10, 18], ['mushroomLog', 11, 18], ['wormBin', 12, 18], ['fishPond', 13, 18], ['beehive', 14, 18], ['birdBox', 10, 22], ['hedgehogHouse', 12, 22], ['butterflyGarden', 14, 22]] as const) {
      build(sim, type, x, z);
      expect(sim.areas.map.areaOfCell(x, z)).toBe(area);
      run(sim, 0.3 * DAY_SECONDS);
      const now = sim.farmExtras.diversityIn(area);
      expect(now, type).toBeGreaterThan(last);
      last = now;
    }
    expect(sim.ecosystem.score().score).toBeGreaterThan(bio0);
  });
});

describe('E23.5.4.6: Keeper gardens', () => {
  it('done when: each Keeper has at least one garden request', () => {
    for (const k of KEEPERS) {
      const reqs = GARDEN_REQUESTS[k.id];
      expect(reqs?.length, k.id).toBeGreaterThan(0);
      for (const r of reqs) expect(CROPS[r.crop], `${k.id} asks for ${r.crop}`).toBeDefined();
    }
  });

  it('growing what a woken Keeper asks for in its garden gives the reward, then its next request', () => {
    const sim = farm();
    const k = keeperById('tally')!;
    sim.state.salvage!.keepers.tally = { step: 'request1' };
    ground(sim, k.x + 2, k.z, 1, 1);
    const p = build(sim, 'planter', k.x + 2, k.z);
    expect(sim.farmExtras.gardenOf(p)).toBe('tally');
    expect(sim.farmExtras.request('tally')!.crop).toBe('tomato');
    const fulfilled: string[] = [];
    sim.bus.on('garden.fulfilled', (e) => fulfilled.push(e.crop));
    // a radish isn't what Tally asked for
    sim.inventory.add('seeds', 2);
    sim.farm.plant(p, 'radish');
    run(sim, DAY_SECONDS + 60);
    sim.farm.harvest(p);
    expect(fulfilled).toEqual([]);
    sim.state.salvage!.crops = ['tomato'];
    sim.farm.plant(p, 'tomato');
    sim.state.salvage!.weather = { kind: 'clear', until: 1e9 };
    run(sim, 6 * DAY_SECONDS);
    sim.farm.harvest(p);
    expect(fulfilled).toEqual(['tomato']);
    expect(sim.farm.knows('sunflower')).toBe(true); // Tally's reward: sunflower seeds
    expect(sim.farmExtras.request('tally')!.crop).toBe('potato');
  });

  it('a sleeping Keeper has no garden; recipe rewards unlock their machines', () => {
    const sim = farm();
    sim.state.salvage!.recipes = [];
    const k = keeperById('moss')!;
    ground(sim, k.x + 2, k.z, 1, 1);
    const p = build(sim, 'planter', k.x + 2, k.z);
    expect(sim.farmExtras.gardenOf(p)).toBeUndefined();
    expect(sim.build.check('wormBin', GROUND, 12, 16).ok).toBe(false);
    sim.state.salvage!.recipes = ['wormBin'];
    ground(sim, 12, 16, 0, 1);
    sim.inventory.addToStore('timber', 3);
    sim.inventory.addToStore('scrap', 2);
    expect(sim.build.check('wormBin', GROUND, 12, 16).ok).toBe(true);
  });

  it('extras survive a save', () => {
    const sim = farm();
    const tree = build(sim, 'orchard', 12, 16);
    run(sim, DAY_SECONDS);
    const saver = new SaveService(undefined);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(back.farmExtras.st(tree.id)).toEqual(sim.farmExtras.st(tree));
    expect(saver.serialize(back.state)).toBe(json);
  });
});
