import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { CROP_HOMES, CROP_IDS, CROPS, PLANTER, SEED_FINDS, STARTING_CROPS, type CropId, type Like } from '../src/data/crops';
import { DAY_SECONDS } from '../src/data/farm';
import { REGIONS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;

/** A fresh old-city game at fountain tier 1, with stock for building. */
function farm(seed = 7): Sim {
  const sim = new Sim(createInitialState(seed, 'oldcity'));
  sim.state.salvage!.tier = 1;
  sim.bot = { roofId: GROUND, x: 8.5, z: 11.5 }; // by the fountain (a way into the store)
  return sim;
}

/** Restored open ground, then a planter on it. */
function planter(sim: Sim, x: number, z: number): MachineData {
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
  sim.inventory.addToStore('scrap', 6);
  sim.inventory.addToStore('biomass', 4);
  const m = sim.build.place('planter', GROUND, x, z);
  expect(m, 'planter placed').toBeDefined();
  return m!;
}

/** Plants a crop (knowing its seeds) in a planter. */
function sow(sim: Sim, m: MachineData, crop: CropId) {
  if (!sim.farm.knows(crop)) (sim.state.salvage!.crops ??= []).push(crop);
  sim.inventory.add('seeds', 1);
  expect(sim.farm.plant(m, crop), crop).toBe(true);
}

/** Runs the farm for some seconds of play (in minute steps: the farm alone, so a game day stays quick). */
function grow(sim: Sim, seconds: number) {
  for (let left = seconds; left > 0; left -= 60) {
    const dt = Math.min(60, left);
    sim.state.time += dt;
    sim.farm.tick(dt);
  }
}

/** Game days of growth this crop gets in one game day where it stands. */
function dayOfGrowth(sim: Sim, m: MachineData): number {
  const before = sim.farm.bed(m).grown ?? 0;
  grow(sim, DAY_SECONDS / 8); // an eighth of a day keeps the clock out of the picture
  return ((sim.farm.bed(m).grown ?? 0) - before) * 8;
}

describe('E23.5.2.1: planter growth', () => {
  it('a planted radish ripens in one game day and harvests into the backpack', () => {
    const sim = farm();
    const m = planter(sim, 12, 16);
    sow(sim, m, 'radish');
    expect(sim.farm.look(m).stage).toBe(1);
    grow(sim, DAY_SECONDS / 2);
    const mid = sim.farm.look(m);
    expect(mid.ripe).toBe(false);
    expect(mid.progress).toBeCloseTo(0.5, 2);
    expect(mid.stage).toBeGreaterThan(1);
    grow(sim, DAY_SECONDS / 2 + 1);
    expect(sim.farm.look(m).ripe).toBe(true);
    const got = sim.farm.harvest(m)!;
    expect(got).toEqual(CROPS.radish.harvest);
    expect(sim.inventory.count('food')).toBe(CROPS.radish.harvest.food);
    expect(sim.farm.bed(m).crop).toBeUndefined();
  });

  it('without water a crop wilts: growth pauses, and it never dies', () => {
    const sim = farm();
    const m = planter(sim, 12, 16);
    sow(sim, m, 'radish');
    let wet = true;
    (sim as unknown as { water: { isWatered(): boolean } }).water = { isWatered: () => wet };
    grow(sim, DAY_SECONDS / 4);
    const grown = sim.farm.bed(m).grown!;
    wet = false;
    expect(sim.farm.look(m).wilting).toBe(true);
    grow(sim, DAY_SECONDS * 3); // three dry days
    expect(sim.farm.bed(m).grown).toBe(grown);
    expect(sim.farm.bed(m).crop).toBe('radish');
    wet = true;
    expect(sim.farm.look(m).wilting).toBe(false);
    grow(sim, DAY_SECONDS);
    expect(sim.farm.look(m).ripe).toBe(true);
  });

  it('a growing bed draws water from the network near it (E23.4), and none when the sky waters it', () => {
    const sim = farm();
    const m = planter(sim, 12, 16);
    sow(sim, m, 'radish');
    let drawn = 0;
    let dry = 1;
    const hooks = sim as unknown as { water: unknown; weather: unknown };
    hooks.water = { isWatered: () => true, drawNear: (_t: unknown, n: number) => ((drawn += n), n) };
    hooks.weather = { kind: () => 'sunny', effects: () => ({ planterDrying: dry }) };
    grow(sim, DAY_SECONDS / 2);
    // whole units only (a fraction carries over), so half a day draws 2 units give or take the last fraction
    expect(drawn).toBeGreaterThanOrEqual(PLANTER.waterPerDay / 2 - 1);
    expect(drawn).toBeLessThanOrEqual(PLANTER.waterPerDay / 2);
    drawn = 0;
    dry = 0;
    grow(sim, DAY_SECONDS / 4);
    expect(drawn).toBe(0);
  });

  it('reads E23.7’s weather kinds: storms rain and blow, fog is mist', () => {
    const sim = farm();
    const m = planter(sim, 12, 16);
    let kind = 'storm';
    (sim as unknown as { weather: unknown }).weather = { kind: () => kind };
    expect(sim.farm.weather()).toBe('rain');
    expect(sim.farm.likeMet(m, 'wind')).toBe(true);
    kind = 'fog';
    expect(sim.farm.weather()).toBe('mist');
    kind = 'sunny';
    expect(sim.farm.likeMet(m, 'rain')).toBe(false);
  });

  it('rain waters every planter', () => {
    const sim = farm();
    const m = planter(sim, 12, 16);
    sow(sim, m, 'radish');
    (sim as unknown as { water: { isWatered(): boolean } }).water = { isWatered: () => false };
    expect(sim.farm.look(m).wilting).toBe(true);
    sim.state.salvage!.weather = { kind: 'rain', until: 1e9 };
    expect(sim.farm.look(m).wilting).toBe(false);
  });

  it('planting takes plain Seeds and a known crop; beds survive a save, and removing the planter forgets its bed', () => {
    const sim = farm();
    const m = planter(sim, 12, 16);
    expect(sim.farm.plantProblem(m, 'radish')).toMatch(/Seeds/);
    expect(sim.farm.plantProblem(m, 'tomato')).toMatch(/No seeds/);
    sim.inventory.add('seeds', 1);
    expect(sim.farm.plant(m, 'radish')).toBe(true);
    expect(sim.inventory.count('seeds')).toBe(0);
    grow(sim, 60);
    const saver = new SaveService(undefined);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(back.farm.bed(m.id)).toEqual(sim.farm.bed(m));
    expect(saver.serialize(back.state)).toBe(json);
    expect(sim.build.remove(m.id)).toBe(true);
    expect(sim.state.salvage!.planters?.[m.id]).toBeUndefined();
  });
});

describe('E23.5.2.2: every crop’s likes change its growth', () => {
  /** Puts a planter in each condition for a like (true = met). */
  const set: Record<Like, (sim: Sim, m: MachineData, on: boolean) => void> = {
    sun: (sim, _m, on) => {
      sim.state.salvage!.weather = { kind: on ? 'clear' : 'cloudy', until: 1e9 };
      sim.state.time = 0; // morning
    },
    rain: (sim, _m, on) => void (sim.state.salvage!.weather = { kind: on ? 'rain' : 'clear', until: 1e9 }),
    wind: (sim, _m, on) => void (sim.state.salvage!.weather = { kind: on ? 'windy' : 'cloudy', until: 1e9 }),
    shade: (sim, m, on) => {
      const t = sim.grid.get(GROUND, m.x + 1, m.z)!;
      t.blocked = on;
      sim.grid.touch(t);
    },
    trellis: (sim, m, on) => void (on && (sim.inventory.add('timber', 2), sim.farm.addExtra(m, 'trellis'))),
    flooded: (sim, m, on) => void (on && (sim.inventory.add('clay', 2), sim.farm.addExtra(m, 'flooded'))),
    fertiliser: (sim, m, on) => void (on && (sim.inventory.add('fertiliser', 1), sim.farm.feed(m))),
    runningWater: (sim, m, on) => {
      const t = sim.grid.get(GROUND, m.x, m.z + 1)!;
      t.feature = on ? 'water' : undefined;
      sim.grid.touch(t);
    },
    night: (sim, _m, on) => void (sim.state.time = on ? DAY_SECONDS * 0.6 : 0),
    saltAir: () => {},
  };

  /** One crop's growth over an eighth of a day with one like met or not (all its others met). */
  function growth(crop: CropId, like: Like, on: boolean, at?: { x: number; z: number }): number {
    const sim = farm();
    const m = planter(sim, at?.x ?? 12, at?.z ?? 16);
    const def = CROPS[crop];
    sow(sim, m, crop);
    for (const l of [...def.likes, ...def.needs]) if (l !== like) set[l](sim, m, true);
    set[like](sim, m, on);
    const lk = sim.farm.look(m);
    expect(lk.wilting).toBe(false);
    return lk.rate;
  }

  /** A spot on Saltwind Beach that takes a planter. */
  const beachSpot = () => regionCell(farm(), 'saltwind');

  it.each(CROP_IDS)('%s', (crop) => {
    const def = CROPS[crop];
    if (!def.likes.length && !def.needs.length) {
      // radish (anything), herbs and flowers grow at full rate wherever they are
      expect(growth(crop, 'rain', false)).toBe(1);
      expect(growth(crop, 'rain', true)).toBe(1);
      return;
    }
    for (const like of def.likes) {
      if (like === 'saltAir') {
        expect(growth(crop, like, true, beachSpot()), `${crop} by the sea`).toBe(1);
        expect(growth(crop, like, false, regionCell(farm(), 'mastRow')), `${crop} inland`).toBe(PLANTER.unmetLike);
        continue;
      }
      const yes = growth(crop, like, true);
      const no = growth(crop, like, false);
      expect(yes, `${crop} with ${like}`).toBeGreaterThan(no);
      expect(no, `${crop} without ${like}`).toBeGreaterThan(0);
    }
    for (const need of def.needs) {
      expect(growth(crop, need, true), `${crop} with ${need}`).toBeGreaterThan(0);
      expect(growth(crop, need, false), `${crop} without ${need}`).toBe(0);
    }
  });

  it('beans feed the planters beside them; lavender and mint bring pollinators', () => {
    const sim = farm();
    const a = planter(sim, 12, 16);
    const b = planter(sim, 13, 16);
    sow(sim, a, 'pumpkin');
    expect(sim.farm.look(a).unmet).toContain('fertiliser');
    sow(sim, b, 'beans');
    expect(sim.farm.look(a).unmet).not.toContain('fertiliser');
    const c = planter(sim, 12, 19);
    sow(sim, c, 'radish');
    const before = sim.farm.look(c).rate;
    const d = planter(sim, 14, 19);
    sow(sim, d, 'herbs');
    expect(sim.farm.look(c).rate).toBeCloseTo(before * PLANTER.pollinatorBoost);
  });

  it('a crop grows over its days in game time with every like met', () => {
    const sim = farm();
    const m = planter(sim, 12, 16);
    sow(sim, m, 'potato');
    set.shade(sim, m, true);
    expect(dayOfGrowth(sim, m)).toBeCloseTo(1, 1);
  });
});

describe('E23.5.2.3: seeds from exploring', () => {
  it('every crop’s seeds are found somewhere reachable, and each region has a crop of its own', () => {
    const homes = new Map<CropId, string[]>();
    for (const [region, crops] of Object.entries(CROP_HOMES)) for (const c of crops) homes.set(c, [...(homes.get(c) ?? []), region]);
    for (const c of CROP_IDS) expect(homes.get(c)?.length ?? STARTING_CROPS.includes(c) ? 1 : 0, c).toBeGreaterThan(0);
    for (const r of REGIONS) expect(CROP_HOMES[r.id]?.some((c) => homes.get(c)!.length === 1), r.id).toBe(true);
    expect(homes.get('seaKale')).toEqual(['saltwind']);
  });

  it('reachability: gathering each region’s own restored ground finds every crop’s seeds', () => {
    const sim = farm();
    const found: string[] = [];
    sim.bus.on('seeds.found', (e) => found.push(e.crop));
    for (const region of Object.keys(CROP_HOMES)) {
      // an open ground tile of the region (generated walkable ground, not sea or a building), restored to flowers
      const t = openTile(sim, region);
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = 2;
      sim.grid.touch(t);
      for (let i = 0; i < SEED_FINDS.gathersPerPacket * CROP_HOMES[region].length; i++) {
        expect(sim.gather.gather(t), `${region} gather ${i}`).toBeGreaterThan(0);
        sim.inventory.deposit('biomass');
        sim.state.time += 2000; // past the regrow
      }
      for (const c of CROP_HOMES[region]) expect(sim.farm.knows(c), `${c} from ${region}`).toBe(true);
    }
    for (const c of CROP_IDS) expect(sim.farm.knows(c), c).toBe(true);
    expect(found.length).toBe(CROP_IDS.length - STARTING_CROPS.length);
  });

  it('emptying a pile finds the region’s next packet at once', () => {
    const sim = farm();
    const cell = regionCell(sim, 'oldMarket');
    sim.bus.emit('pile.salvaged', { pileId: 'x', material: 'glass', got: 3, left: 0, x: cell.x, z: cell.z });
    expect(sim.farm.knows('tomato')).toBe(true);
  });
});

/** An open, generated ground tile inside a region (park: by the fountain). */
function openTile(sim: Sim, region: string) {
  for (let cx = -8; cx <= 8; cx++)
    for (let cz = -8; cz <= 8; cz++)
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 16; j++) {
          const x = cx * 16 + i;
          const z = cz * 16 + j;
          if (sim.farm.regionAt(x, z) !== region) continue;
          const t = sim.grid.get(GROUND, x, z);
          if (t && !t.blocked && !t.occupantId && t.feature !== 'water') return t;
        }
  throw new Error(`no open tile in ${region}`);
}

/** A cell inside a region (searching its chunks). */
function regionCell(sim: Sim, region: string): { x: number; z: number } {
  for (let cx = -8; cx <= 8; cx++)
    for (let cz = -8; cz <= 8; cz++) {
      const x = cx * 16 + 8;
      const z = cz * 16 + 8;
      if (sim.farm.regionAt(x, z) === region) return { x, z };
    }
  throw new Error(`no cell in ${region}`);
}
