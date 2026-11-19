import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import { keeperById } from '../src/core/OldCityLayout';
import type { MachineData, MachineType } from '../src/core/types';
import { COMPOST } from '../src/data/compost';
import { CROP_IDS, CROPS, type CropId } from '../src/data/crops';
import { DAY_SECONDS } from '../src/data/time';
import { BEEHIVE, DIVERSITY, GARDEN_REQUESTS, HOMES, KEEPER_GARDEN, MUSHROOM_LOG, ORCHARD, WORM_BIN, type HomeKind } from '../src/data/farmExtras';
import { KEEPERS, REGIONS } from '../src/data/oldcity';
import { DECOR_OPTION } from '../src/data/cozy';
import { Cozy, decorOpen } from '../src/gameplay/Cozy';
import { FARM_USES } from '../src/data/farm';
import { CHARGE } from '../src/data/charge';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;

function farm(): Sim {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = 3;
  // E23.8.2: Moss (Elder Grove) hands over beehives and orchards
  sim.state.salvage!.keepers.moss = { step: 'request1' };
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

/** Builds a farm machine (waking the Keeper its crafting-table recipe comes from, and stocking the recipe first). */
function build(sim: Sim, type: MachineType, x: number, z: number): MachineData {
  const cr = sim.crafting.machineRecipe(type as 'planter')!;
  if ('keeper' in cr.unlock) {
    const region = cr.unlock.keeper;
    sim.state.salvage!.keepers[KEEPERS.find((k) => k.region === region)!.id] ??= { step: 'request1' };
  }
  for (const [k, v] of Object.entries(sim.build.recipe(type as 'planter')!)) sim.inventory.addToStore(k as 'scrap', v!);
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

describe('E23.8.2: beehives and orchards come from Elder Grove', () => {
  it('locked until Moss wakes, with a reason that names Moss', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.tier = 5;
    ground(sim, 12, 16, 0, 1);
    for (const t of ['beehive', 'orchard'] as const) {
      expect(sim.build.isUnlocked(t), t).toBe(false);
      expect(sim.build.check(t, GROUND, 12, 16).reason).toMatch(/Moss/);
    }
    sim.state.salvage!.keepers.moss = { step: 'request1' };
    for (const t of ['beehive', 'orchard'] as const) expect(sim.build.isUnlocked(t), t).toBe(true);
  });
});

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
    // E23.4.1: real water three tiles from the pond keeps it filled
    for (const z of [16, 17]) {
      const t = sim.grid.get(GROUND, 8, z)!;
      Object.assign(t, { blocked: false, feature: 'water', ground: 'restored', pollution: 0 });
      sim.grid.touch(t);
    }
    const pond = build(sim, 'fishPond', 11, 16);
    const body = sim.water.bodyAt(sim.grid.get(GROUND, 8, 16))!;
    expect(sim.farmExtras.pondFilled(pond)).toBe(true);
    expect(sim.farmExtras.pondLevel(pond)).toBe(1);
    expect(sim.farm.look(p).unmet).not.toContain('fertiliser');
    // the pond drinks from that water each game day (its real level falls)
    run(sim, DAY_SECONDS / 2);
    expect(sim.water.amountOf(body.id)).toBeLessThan(body.capacity);
    // that water run dry: the pond is low and feeds nothing; filled again, it feeds again
    sim.water.draw(body.id, body.capacity);
    expect(sim.farmExtras.pondFilled(pond)).toBe(false);
    expect(sim.farmExtras.pondLevel(pond)).toBe(0);
    expect(sim.farm.look(p).unmet).toContain('fertiliser');
    sim.water.fill(body.id, body.capacity);
    expect(sim.farm.look(p).unmet).not.toContain('fertiliser');
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
    sim.weather.forceForTest('fog', 1e9);
    run(sim, MUSHROOM_LOG.flushDays * DAY_SECONDS + 60);
    expect(sim.farmExtras.pickMushrooms(log)).toBe(MUSHROOM_LOG.food);
    sim.weather.forceForTest('sunny', 1e9);
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
    sim.weather.forceForTest('sunny', 1e9);
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

/**
 * A spot for a Keeper's garden on the real map: a tile within reach of the Keeper that a planter can stand on once
 * bloombot restores it (the way into the region opened, as waking the Keeper needs). Restores it, as the player would.
 */
function gardenSpot(sim: Sim, keeperId: string): { x: number; z: number } | undefined {
  const k = keeperById(keeperId)!;
  const R = KEEPER_GARDEN.reach;
  sim.state.salvage!.keepers.tide ??= { step: 'request1' }; // planters open with Timber (Tide)
  const area = sim.areas.areaOf({ roofId: GROUND, x: k.x, z: k.z });
  if (area) {
    sim.areas.reveal(area);
    sim.areas.clear(area, true);
  }
  const near = [];
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) near.push([k.x + dx, k.z + dz, Math.max(Math.abs(dx), Math.abs(dz))]);
  near.sort((a, b) => a[2] - b[2]);
  for (const [x, z] of near) {
    const t = sim.grid.get(GROUND, x, z);
    if (!t || t.blocked || t.occupantId || t.feature === 'water') continue;
    sim.restoration.complete(t, 'pulse');
    const chk = sim.build.check('planter', GROUND, x, z);
    if (chk.ok || chk.spotOk) return { x, z };
  }
  return undefined;
}

/** Builds a Keeper's garden on the real map, grows the crop it asked for and harvests it there. */
function fulfil(sim: Sim, keeperId: string, crop: CropId, learn = true) {
  const spot = gardenSpot(sim, keeperId)!;
  for (const [key, v] of Object.entries(sim.build.recipe('planter')!)) sim.inventory.add(key as 'scrap', v!);
  const p = sim.build.place('planter', GROUND, spot.x, spot.z)!;
  expect(sim.farmExtras.gardenOf(p)).toBe(keeperId);
  if (learn && !sim.farm.knows(crop)) (sim.state.salvage!.crops ??= []).push(crop);
  sim.inventory.add('seeds', 1);
  expect(sim.farm.plant(p, crop)).toBe(true);
  // E23.4.1: the bed drinks the map's own water where some reaches it; elsewhere it waits for rain, as in play
  const bed = sim.grid.get(GROUND, p.x, p.z)!;
  sim.weather.forceForTest(sim.water.isWatered(bed) ? 'sunny' : 'rain', 1e9);
  run(sim, (CROPS[crop].days + 1) * 4 * DAY_SECONDS);
  expect(sim.farm.look(p).ripe, `${crop} ripe`).toBe(true);
  sim.farm.harvest(p);
}

describe('E23.5.4.1: honey', () => {
  it('honey is eaten like food, a strong snack (more charge than food)', () => {
    const sim = farm();
    sim.state.charge = { value: 10 };
    sim.bot = { roofId: GROUND, x: 30, z: 30 }; // away from home (no trickle)
    const pack = sim.state.salvage!.pack as Record<string, number>;
    for (const key of Object.keys(pack)) delete pack[key];
    pack.honey = 1;
    pack.food = 1;
    expect(sim.charge.eat()).toMatchObject({ id: 'honey' }); // best first
    sim.advance(4);
    expect(sim.charge.value()).toBeCloseTo(10 + FARM_USES.honey.charge * CHARGE.max, 1); // (less a hair of idle use)
    expect(FARM_USES.honey.charge).toBeGreaterThan(FARM_USES.food.charge);
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
    // a real little pond two tiles from the bed, so it drinks on the dry days (E23.4.1)
    for (const dz of [0, 1]) {
      const t = sim.grid.get(GROUND, k.x + 4, k.z + dz)!;
      Object.assign(t, { blocked: false, feature: 'water', ground: 'restored', pollution: 0 });
      sim.grid.touch(t);
    }
    expect(sim.farm.isWatered(p)).toBe(true);
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
    sim.weather.forceForTest('sunny', 1e9);
    run(sim, 6 * DAY_SECONDS);
    sim.farm.harvest(p);
    expect(fulfilled).toEqual(['tomato']);
    expect(sim.farm.knows('sunflower')).toBe(true); // Tally's reward: sunflower seeds
    expect(sim.farmExtras.request('tally')!.crop).toBe('potato');
  });

  it('a sleeping Keeper has no garden; recipe rewards unlock their machines', () => {
    const sim = farm();
    sim.state.salvage!.recipes = [];
    const k = keeperById('fern')!;
    ground(sim, k.x + 2, k.z, 1, 1);
    const p = build(sim, 'planter', k.x + 2, k.z);
    expect(sim.farmExtras.gardenOf(p)).toBeUndefined();
    expect(sim.build.check('wormBin', GROUND, 12, 16).ok).toBe(false);
    sim.state.salvage!.recipes = ['wormBin'];
    ground(sim, 12, 16, 0, 1);
    for (const [k, v] of Object.entries(sim.build.recipe('wormBin')!)) sim.inventory.addToStore(k as 'scrap', v!);
    expect(sim.build.check('wormBin', GROUND, 12, 16).ok).toBe(true);
  });

  it('every Keeper’s garden can really be made: a planter fits within reach of each Keeper on the real map', () => {
    for (const k of KEEPERS) {
      const sim = farm();
      sim.state.salvage!.keepers[k.id] = { step: 'request1' };
      const spot = gardenSpot(sim, k.id);
      expect(spot, `${k.name}: a planter spot within ${KEEPER_GARDEN.reach} tiles`).toBeDefined();
      for (const [key, v] of Object.entries(sim.build.recipe('planter')!)) sim.inventory.add(key as 'scrap', v!);
      const p = sim.build.place('planter', GROUND, spot!.x, spot!.z);
      expect(p, `${k.name}'s planter placed`).toBeDefined();
      expect(sim.farmExtras.gardenOf(p!), k.name).toBe(k.id);
    }
  });

  it('a decoration gift is really given: made, open to place, and announced once', () => {
    const sim = farm();
    sim.state.salvage!.keepers.pylon = { step: 'request1' };
    const option = DECOR_OPTION.birdbath;
    expect(decorOpen(sim, option)).toBe(false);
    fulfil(sim, 'pylon', 'radish');
    expect(sim.crafting.decorMade('birdbath')).toBe(true);
    expect(decorOpen(sim, option)).toBe(true);
    const cozy = new Cozy(sim);
    expect(cozy.checkDecorUnlocks().map((o) => o.id)).toContain('birdbath');
    expect(cozy.checkDecorUnlocks().map((o) => o.id)).not.toContain('birdbath'); // announced once
  });

  it('a seed reward is always real seeds: a crop already known gives the next one not known, then plain Seeds', () => {
    const said: unknown[] = [];
    // Tally's first reward is sunflower seeds; sunflower already known
    let sim = farm();
    sim.state.salvage!.keepers.tally = { step: 'request1' };
    sim.state.salvage!.crops = ['sunflower'];
    sim.bus.on('garden.fulfilled', (e) => said.push(e.reward));
    fulfil(sim, 'tally', 'tomato');
    const got = said[0] as { kind: string; crop: string };
    expect(got.kind).toBe('seeds');
    expect(got.crop).not.toBe('sunflower');
    expect(sim.farm.knows(got.crop as 'radish')).toBe(true);
    // every crop known: a handful of plain Seeds, in the backpack
    sim = farm();
    sim.state.salvage!.keepers.tally = { step: 'request1' };
    sim.state.salvage!.crops = [...CROP_IDS];
    const seeds = () => sim.inventory.count('seeds') + sim.inventory.stored('seeds');
    let rewards: unknown[] = [];
    sim.bus.on('garden.fulfilled', (e) => rewards.push(e.reward));
    const before = seeds();
    fulfil(sim, 'tally', 'tomato', false);
    expect(rewards[0]).toEqual({ kind: 'items', item: 'seeds', n: KEEPER_GARDEN.plainSeeds });
    expect(seeds() - before).toBeGreaterThanOrEqual(KEEPER_GARDEN.plainSeeds - 1); // planting took one
    rewards = [];
  });

  it('a Keeper’s garden raises its area’s diversity', () => {
    const sim = farm();
    sim.state.salvage!.keepers.pylon = { step: 'request1' };
    const spot = gardenSpot(sim, 'pylon')!;
    const area = sim.areas.areaOf({ roofId: GROUND, x: spot.x, z: spot.z });
    const before = sim.farmExtras.diversityIn(area);
    for (const [key, v] of Object.entries(sim.build.recipe('planter')!)) sim.inventory.add(key as 'scrap', v!);
    sim.build.place('planter', GROUND, spot.x, spot.z);
    expect(sim.farmExtras.diversityIn(area)).toBe(before + DIVERSITY.perGarden);
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
