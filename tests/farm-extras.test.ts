import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import { keeperById, regionPond, regionWater, seaCell, surfCell } from '../src/core/OldCityLayout';
import type { MachineData, MachineType } from '../src/core/types';
import { COMPOST } from '../src/data/compost';
import { CROP_IDS, CROPS, type CropId } from '../src/data/crops';
import { DAY_SECONDS } from '../src/data/time';
import { BEEHIVE, DIVERSITY, FISH_POND, GARDEN_REQUESTS, HOMES, KEEPER_GARDEN, MUSHROOM_LOG, ORCHARD, WORM_BIN, type HomeKind } from '../src/data/farmExtras';
import { KEEPERS, PARK_SET, REGIONS } from '../src/data/oldcity';
import { DECOR_OPTION } from '../src/data/cozy';
import { Cozy, decorOpen } from '../src/gameplay/Cozy';
import { FARM_USES } from '../src/data/farm';
import { CHARGE } from '../src/data/charge';
import { PONDS_LAYOUT, Sim } from '../src/gameplay/Sim';

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
  it('#430: a pond kept filled by pipe, and its water piped on to a planter far from it (E23.4.2’s real pipes)', () => {
    const sim = farm();
    sim.state.salvage!.keepers.sluice = { step: 'request1' }; // pipes and reservoirs come from Cistern Basin's Keeper
    sim.state.salvage!.pack = { ...(sim.state.salvage!.pack ?? {}), pipe: 40, clay: 40, scrap: 40 };
    // the park's lawn row 4: no canal or pond within reach of these tiles
    const pond = build(sim, 'fishPond', 6, 5);
    expect(sim.water.bodyNear(sim.grid.get(GROUND, 6, 5)!, FISH_POND.waterReach)).toBeUndefined();
    expect(sim.farmExtras.pondFilled(pond)).toBe(false);
    // a full reservoir on higher ground feeds a pipe that runs past the pond and on along the row
    const r: MachineData = { id: sim.newId('m'), type: 'reservoir', roofId: GROUND, x: 14, z: 4, size: 2, boostUntil: 0, timer: 0, charge: 0 };
    sim.state.machines.push(r);
    for (const t of sim.grid.footprint(GROUND, 14, 4, 2)) Object.assign(t!, { occupantId: r.id, level: 2 });
    sim.grid.indexMachine(r);
    sim.water.fill(`r:${r.id}`, 300);
    for (let x = 6; x <= 13; x++) expect(sim.water.pipes.lay(GROUND, x, 4), `pipe ${x},4`).toBe(true);
    sim.water.tick(60);
    expect(sim.water.pipes.carries(6, 4)).toBe(true);
    // the pipe beside it keeps the pond filled, and the pond drinks from it
    expect(sim.farmExtras.pondFilled(pond)).toBe(true);
    const tank = sim.water.levelOf(`r:${r.id}`);
    run(sim, DAY_SECONDS);
    expect(sim.water.levelOf(`r:${r.id}`)).toBeLessThan(tank);
    // a planter six tiles off, beside the same run: the pond's water is piped to it, so it needs no fertiliser
    ground(sim, 12, 3, 0, 1);
    const p = build(sim, 'planter', 12, 3);
    expect(Math.max(Math.abs(p.x - pond.x), Math.abs(p.z - pond.z))).toBeGreaterThan(FISH_POND.feedReach);
    expect(sim.farmExtras.pipedTo(pond, p)).toBe(true);
    expect(sim.farmExtras.pondFeeds(p)).toBe(true);
    expect(sim.farm.fertilised(p)).toBe(true);
    // lift the pipe between them: no longer piped
    expect(sim.water.pipes.lift(9, 4)).toBe(true);
    expect(sim.farmExtras.pipedTo(pond, p)).toBe(false);
    expect(sim.farmExtras.pondFeeds(p)).toBe(false);
  });

  it('a wildlife home’s water habitat is fresh water only: a dead silted pond does not count, restored it does', () => {
    const sim = farm();
    ground(sim, 12, 16, 3, 1);
    const box = build(sim, 'batBox', 12, 16);
    const bed = sim.grid.get(GROUND, 14, 16)!;
    Object.assign(bed, { feature: 'water', ground: 'polluted', pollution: 60, blocked: false });
    sim.grid.touch(bed);
    expect(sim.farmExtras.habitat(box, 'water')).toBe(false);
    Object.assign(bed, { ground: 'restored', pollution: 0 });
    sim.grid.touch(bed);
    expect(sim.farmExtras.habitat(box, 'water')).toBe(true);
  });

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
  it('fruit once a game day; pruning gives timber; an unpruned tree fruits less, never none', () => {
    const sim = farm();
    const tree = build(sim, 'orchard', 12, 16);
    run(sim, (ORCHARD.fruitDays - 0.05) * DAY_SECONDS);
    expect(sim.farmExtras.fruitReady(tree)).toBe(false);
    run(sim, 0.1 * DAY_SECONDS);
    expect(sim.farmExtras.fruitReady(tree)).toBe(true);
    expect(sim.farmExtras.pick(tree)).toBe(ORCHARD.fruit);
    // a full picking a day until it wants pruning (the fourth day's fruit grows on an overgrown tree)
    for (let d = 1; d < ORCHARD.pruneDays - 1; d++) {
      run(sim, ORCHARD.fruitDays * DAY_SECONDS + 60);
      expect(sim.farmExtras.pick(tree), `day ${d + 1}`).toBe(ORCHARD.fruit);
    }
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
    const area = sim.areas.map.areaOfCell(12, 20); // all of these stand in Saltwind (the park ends at z 15; #763: clear of Tide's pool)
    let last = sim.farmExtras.diversityIn(area);
    const bio0 = sim.ecosystem.score().score;
    for (const [type, x, z] of [['orchard', 10, 16], ['mushroomLog', 11, 16], ['wormBin', 12, 16], ['fishPond', 13, 16], ['beehive', 14, 16], ['birdBox', 10, 22], ['hedgehogHouse', 12, 22], ['butterflyGarden', 14, 22]] as const) {
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
    sim.state.areas[area]!.sealed = false; // its gate open: the way in, as waking the Keeper needs
  }
  // E23.5.4.6: the Keeper's garden pond comes back with the ground (bloombot pulses its silted bed)
  for (const t of pondTiles(sim, keeperId)) if (t.ground !== 'restored') sim.restoration.complete(t, 'pulse');
  const near = [];
  for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) near.push([k.x + dx, k.z + dz, Math.max(Math.abs(dx), Math.abs(dz))]);
  near.sort((a, b) => a[2] - b[2]);
  let dry: { x: number; z: number } | undefined;
  for (const [x, z] of near) {
    const t = sim.grid.get(GROUND, x, z);
    if (!t || t.blocked || t.occupantId || t.feature === 'water') continue;
    sim.restoration.complete(t, 'pulse');
    const chk = sim.build.check('planter', GROUND, x, z);
    if (!(chk.ok || chk.spotOk)) continue;
    if (sim.water.isWatered(t)) return { x, z }; // a spot the pond's water reaches, as a player would pick
    dry ??= { x, z };
  }
  return dry;
}

/** The tiles of a Keeper's garden pond (data/oldcity `ponds` of the Keeper's region). */
function pondTiles(sim: Sim, keeperId: string) {
  const r = REGIONS.find((q) => q.id === keeperById(keeperId)!.region)!;
  const out = [];
  for (const q of r.ponds ?? []) for (let x = q.x; x < q.x + q.w; x++) for (let z = q.z; z < q.z + q.d; z++) out.push(sim.grid.get(GROUND, x, z)!);
  return out;
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
    ground(sim, k.x, k.z + 2, 0, 1);
    const p = build(sim, 'planter', k.x, k.z + 2);
    expect(sim.farmExtras.gardenOf(p)).toBe('tally');
    // Tally's own pond, restored, two tiles from the bed: it drinks there on the dry days (E23.4.1)
    for (const t of pondTiles(sim, 'tally')) sim.restoration.complete(t, 'pulse');
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

  it('no Keeper pond sits where bloombot arrives or crosses: 2+ tiles from gates, glide perches and landings, ladders and ramps', () => {
    const hot: [number, number][] = [];
    for (const r of REGIONS) {
      for (const c of r.gate?.cells ?? []) hot.push(c as [number, number]);
      for (const p of r.perches) hot.push([p.x, p.z], p.to);
      for (const l of r.ladders) hot.push([l.x, l.z], l.to);
      for (const q of r.ramps) for (let x = q.x; x < q.x + q.w; x++) for (let z = q.z; z < q.z + q.d; z++) hot.push([x, z]);
    }
    for (const r of REGIONS)
      for (const q of r.ponds ?? [])
        for (let x = q.x; x < q.x + q.w; x++)
          for (let z = q.z; z < q.z + q.d; z++)
            for (const [a, b] of hot) expect(Math.max(Math.abs(a - x), Math.abs(b - z)), `${r.id} pond ${x},${z} by ${a},${b}`).toBeGreaterThan(2);
    // and never on the sea, the surf or a canal (the shoreline's widened canal mouth and surf band included)
    for (const r of REGIONS)
      for (const q of r.ponds ?? [])
        for (let x = q.x; x < q.x + q.w; x++)
          for (let z = q.z; z < q.z + q.d; z++) expect(seaCell(x, z) || surfCell(x, z) || regionWater(x, z), `${r.id} pond ${x},${z}`).toBe(false);
  });

  it('every Keeper’s garden has fresh water: a silted pond beside it fills once restored, and waters the garden', () => {
    for (const k of KEEPERS) {
      const sim = farm();
      const ponds = pondTiles(sim, k.id);
      if (!ponds.length) {
        // only Moss's Elder Grove has its own canal close by
        expect(k.region, `${k.name} needs a pond`).toBe('elderGrove');
        continue;
      }
      // a dead, walkable silted bed beside the Keeper: not water to drink yet
      for (const t of ponds) {
        expect(t.feature, `${k.name} pond ${t.x},${t.z}`).toBe('water');
        expect(t.blocked).toBe(false);
        expect(t.ground).not.toBe('restored');
        expect(sim.water.isFresh(t)).toBe(false);
        expect(Math.max(Math.abs(t.x - k.x), Math.abs(t.z - k.z))).toBeLessThanOrEqual(KEEPER_GARDEN.reach);
      }
      sim.state.salvage!.keepers[k.id] = { step: 'request1' };
      const spot = gardenSpot(sim, k.id)!; // restores the pond as bloombot would
      const body = sim.water.bodyAt(ponds[0]);
      expect(body, `${k.name}'s pond is fresh water once restored`).toBeDefined();
      if (sim.water.levelOf(body!.id) < 0.5) {
        // only the Cistern's dry basin: Sluice's pond fills with it once the Old Cistern wakes and its springs run
        expect(k.region).toBe('cistern');
        sim.areas.clear('cistern', true);
        expect(sim.water.dormant(body!)).toBe(false);
        // its springs fill it within the day (the wake's rush may have come before the pond was restored)
        for (let h = 0; h < 12; h++) sim.water.tick(DAY_SECONDS / 24);
      }
      expect(sim.water.levelOf(body!.id), `${k.name}'s pond level`).toBeGreaterThan(0.5);
      // a planter in the Keeper's garden is watered by it, with no rain
      for (const [key, v] of Object.entries(sim.build.recipe('planter')!)) sim.inventory.add(key as 'scrap', v!);
      const p = sim.build.place('planter', GROUND, spot.x, spot.z)!;
      expect(sim.farmExtras.gardenOf(p), k.name).toBe(k.id);
      sim.weather.forceForTest('sunny', 1e9);
      expect(sim.water.isWatered(sim.grid.get(GROUND, p.x, p.z)!), `${k.name}'s garden is watered`).toBe(true);
      expect(sim.farm.look(p).wilting ?? false).toBe(false);
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

  it('an older save with something built on a Keeper pond’s spot: that pond stays dry land, nothing ends up under water', () => {
    // a game from before the ponds: a planter and a decoration on two of the Keeper ponds' spots
    const sim = farm();
    const m = build(sim, 'planter', 12, 16);
    const saver = new SaveService(undefined);
    const json = JSON.parse(saver.serialize(sim.state));
    const tock = REGIONS.find((r) => r.id === 'clockPlaza')!.ponds![0];
    const vega = REGIONS.find((r) => r.id === 'observatory')!.ponds![0];
    // a save from before the ponds: its ground layer was never checked for them
    const layer = json.layers.find((l: { kind: string }) => l.kind === 'ground');
    delete layer.pondsChecked;
    delete layer.dryPonds;
    const old = json.machines.find((x: { id: string }) => x.id === m.id);
    Object.assign(old, { x: tock.x + 1, z: tock.z + 1 });
    (json.cozy ??= {}).decor = { ...(json.cozy.decor ?? {}), [`${GROUND}|${vega.x}|${vega.z + 2}`]: 'bench' };
    const back = new Sim(saver.deserialize(JSON.stringify(json))!);
    const ground = back.state.layers.find((l) => l.kind === 'ground')!;
    expect(ground.dryPonds).toEqual(expect.arrayContaining(['clockPlaza', 'observatory']));
    // both ponds are land: the planter stands on dry ground, and no water body is there
    for (const q of [tock, vega])
      for (let x = q.x; x < q.x + q.w; x++)
        for (let z = q.z; z < q.z + q.d; z++) {
          const t = back.grid.get(GROUND, x, z)!;
          expect(t.feature, `${x},${z}`).not.toBe('water');
          expect(back.water.bodyAt(t)).toBeUndefined();
        }
    expect(back.grid.get(GROUND, tock.x + 1, tock.z + 1)!.occupantId).toBe(m.id);
    // every other Keeper's pond is still there
    const tide = REGIONS.find((r) => r.id === 'saltwind')!.ponds![0];
    expect(back.grid.get(GROUND, tide.x, tide.z)!.feature).toBe('water');
    // and it stays so through the next save and load
    const again = new Sim(saver.deserialize(saver.serialize(back.state))!);
    expect(again.state.layers.find((l) => l.kind === 'ground')!.dryPonds).toEqual(ground.dryPonds);
    expect(again.grid.get(GROUND, tock.x, tock.z)!.feature).not.toBe('water');
  });

  it('nothing can be built in a Keeper’s pond (machines or decorations); beside it is fine, and a later load keeps the pond', () => {
    const sim = farm();
    sim.state.salvage!.keepers.tide = { step: 'request1' };
    gardenSpot(sim, 'tide'); // opens Saltwind and restores Tide's rock pool
    const pool = REGIONS.find((r) => r.id === 'saltwind')!.ponds![0];
    const t = sim.grid.get(GROUND, pool.x, pool.z)!;
    expect(sim.water.bodyAt(t)).toBeDefined();
    for (const type of ['planter', 'fishPond'] as const) {
      for (const [k, v] of Object.entries(sim.build.recipe(type) ?? {})) sim.inventory.addToStore(k as 'scrap', v!);
      expect(sim.build.check(type, GROUND, pool.x, pool.z).reason, type).toMatch(/Keeper’s pond/);
      expect(sim.build.place(type, GROUND, pool.x, pool.z), type).toBeUndefined();
    }
    expect(sim.build.footprintProblem(GROUND, pool.x, pool.z, 1, ['restored'])).toMatch(/Keeper’s pond/); // decorations ask this too
    // beside it: allowed (a planter by the pool is Tide's garden)
    const side = { x: pool.x + pool.w, z: pool.z + 1 };
    const beside = sim.grid.get(GROUND, side.x, side.z)!;
    sim.restoration.complete(beside, 'pulse');
    expect(sim.build.check('planter', GROUND, side.x, side.z).reason ?? 'ok').not.toMatch(/Keeper’s pond/);
    // save and load after the refused attempts: the pond is still water, and this save is never dried out again
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    const ground = back.state.layers.find((l) => l.kind === 'ground')!;
    expect(ground.pondsChecked).toBe(PONDS_LAYOUT);
    expect(ground.dryPonds ?? []).toEqual([]);
    expect(back.grid.get(GROUND, pool.x, pool.z)!.feature).toBe('water');
    // even something written onto a pond after the first check (an edited save) never turns the pond to land
    const json = JSON.parse(saver.serialize(back.state));
    json.cozy = { ...(json.cozy ?? {}), decor: { [`${GROUND}|${pool.x}|${pool.z + 1}`]: 'bench' } };
    const later = new Sim(saver.deserialize(JSON.stringify(json))!);
    expect(later.state.layers.find((l) => l.kind === 'ground')!.dryPonds ?? []).toEqual([]);
    expect(later.grid.get(GROUND, pool.x, pool.z)!.feature).toBe('water');
  });

  it('#763: Tide’s rock pool sits beside Tide, clear of the park’s beach steps and the ground in front of them', () => {
    const pool = REGIONS.find((r) => r.id === 'saltwind')!.ponds![0];
    const stair = PARK_SET.ramps[0];
    const tide = keeperById('tide')!;
    // nothing of the pool within two rows of the bottom step, across the stair's width and a tile either side
    for (let x = stair.x - 1; x <= stair.x + stair.w; x++)
      for (let z = stair.z + stair.d; z < stair.z + stair.d + 2; z++) expect(regionPond(x, z), `${x},${z}`).toBe(false);
    // beside Tide: its nearest cell within two tiles, and never on Tide's own cell
    const dx = Math.max(pool.x - tide.x, 0, tide.x - (pool.x + pool.w - 1));
    const dz = Math.max(pool.z - tide.z, 0, tide.z - (pool.z + pool.d - 1));
    expect(Math.max(dx, dz)).toBeGreaterThan(0);
    expect(Math.max(dx, dz)).toBeLessThanOrEqual(2);
  });

  it('#763: a save checked against the old pond layout is checked again for the moved pool', () => {
    const saver = new SaveService(undefined);
    const pool = REGIONS.find((r) => r.id === 'saltwind')!.ponds![0];
    const save = (edit: (layer: Record<string, unknown>, json: Record<string, unknown>) => void) => {
      const sim = farm();
      const json = JSON.parse(saver.serialize(sim.state));
      const layer = json.layers.find((l: { kind: string }) => l.kind === 'ground');
      edit(layer, json);
      return new Sim(saver.deserialize(JSON.stringify(json))!);
    };
    // checked against layout 1, with a bench where the pool is now: the pool stays dry land under it
    const built = save((layer, json) => {
      layer.pondsChecked = true;
      delete layer.dryPonds;
      json.cozy = { ...((json.cozy as object) ?? {}), decor: { [`${GROUND}|${pool.x}|${pool.z + 1}`]: 'bench' } };
    });
    let ground = built.state.layers.find((l) => l.kind === 'ground')!;
    expect(ground.pondsChecked).toBe(PONDS_LAYOUT);
    expect(ground.dryPonds).toContain('saltwind');
    expect(built.grid.get(GROUND, pool.x, pool.z)!.feature).not.toBe('water');
    // checked against layout 1 and dried for something on the old spot: the new spot is clear, so the pool comes back
    const moved = save((layer) => {
      layer.pondsChecked = true;
      layer.dryPonds = ['saltwind', 'clockPlaza'];
    });
    ground = moved.state.layers.find((l) => l.kind === 'ground')!;
    expect(ground.dryPonds).toEqual(['clockPlaza']); // other regions' dried ponds stay dry
    expect(moved.grid.get(GROUND, pool.x, pool.z)!.feature).toBe('water');
    expect(moved.grid.get(GROUND, 7, 16)!.feature).not.toBe('water'); // the old spot is plain beach now
    // and an up-to-date save is never checked again (a bench written onto the pool afterwards doesn't dry it)
    const fresh = save((layer, json) => {
      layer.pondsChecked = PONDS_LAYOUT;
      json.cozy = { ...((json.cozy as object) ?? {}), decor: { [`${GROUND}|${pool.x}|${pool.z}`]: 'bench' } };
    });
    expect(fresh.state.layers.find((l) => l.kind === 'ground')!.dryPonds ?? []).toEqual([]);
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
