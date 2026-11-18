import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData, MachineType, WeatherKind } from '../src/core/types';
import { WATER_NET } from '../src/data/water';
import { Sim } from '../src/gameplay/Sim';
import { tankId } from '../src/gameplay/WaterPipes';

SaveService.clock = () => 0;
const DAY = WATER_NET.daySeconds;
const days = (sim: Sim, n: number) => {
  for (let i = 0; i < Math.round(n * 48); i++) sim.water.tick(DAY / 48);
};
const weather = (sim: Sim, kind: WeatherKind) => (sim.state.salvage!.weather = { kind, until: Infinity });

/** The park with its pond restored (full), plenty of materials, the bot standing by the store. */
function park() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.areas.clear(PARK, true);
  sim.state.salvage!.tier = 2;
  sim.state.salvage!.keepers.sluice = { step: 'request1' }; // E23.8.2: Cistern Basin's Keeper is awake (its unlocks held)
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const t = sim.grid.get(GROUND, x, z)!;
      if (t.feature === 'water' && !t.blocked) {
        t.ground = 'restored';
        sim.grid.touch(t);
      }
    }
  sim.state.salvage!.pack = { clay: 60, copper: 30, scrap: 40 };
  weather(sim, 'cloudy');
  // midday, all day (E23.7.1's clock turns the sun off at night; these tests are about the water, not the hour)
  const noon = { ...sim.power.sky(), sun: 1, solar: 1 };
  sim.power.skyOverride = () => noon;
  return { sim, pond: sim.water.body('1,10')! };
}

/** Puts a machine down as the build would (no checks), for the sim tests. */
function put(sim: Sim, type: MachineType, x: number, z: number, size = type === 'reservoir' ? 2 : 1): MachineData {
  const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  for (const t of sim.grid.footprint(GROUND, x, z, size)) if (t) t.occupantId = m.id;
  sim.grid.indexMachine(m);
  return m;
}

/** A solar panel touching the pump (diagonally): machines that touch share a grid network (E23.3), so it powers it. */
const powerUp = (sim: Sim) => put(sim, 'solar', 5, 10);
/** The grid's own answer (E23.3's sim.power, not a stand-in). */
const powered = (sim: Sim, m: MachineData) => sim.power.isPowered(m);
/** The grid switched off: a calm night (no sun, no wind), so nothing on the island makes power. */
const gridOff = (sim: Sim) => {
  const night = { ...sim.power.sky(), sun: 0, solar: 0, wind: 0 };
  sim.power.skyOverride = () => night;
  sim.power.tick(1);
  expect(sim.state.machines.some((m) => sim.power.output(m) > 0)).toBe(false);
};

const lay = (sim: Sim, cells: [number, number][]) => {
  for (const [x, z] of cells) expect(sim.water.pipes.lay(GROUND, x, z)).toBe(true);
};
const tile = (sim: Sim, x: number, z: number) => sim.grid.get(GROUND, x, z)!;
/** A straight run along a row from x0 to x1 (the park's lawn rows 4 and 11 are level and clear). */
const run = (x0: number, x1: number, z: number): [number, number][] => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, z]);

describe('E23.4.2.1: reservoirs', () => {
  it('a reservoir starts empty and fills from the pond on its bank over game days, draining the pond', () => {
    const { sim, pond } = park();
    const r = put(sim, 'reservoir', 4, 10); // touches the pond's east edge (x = 3)
    const id = tankId(r);
    expect(sim.water.levelOf(id)).toBe(0);
    expect(sim.water.bankOf(r)?.id).toBe(pond.id);
    days(sim, 0.25);
    const mid = sim.water.levelOf(id);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(1);
    expect(sim.water.levelOf(pond.id)).toBeLessThan(1); // what the tank took, the pond gave
    days(sim, 2);
    // the pond (12 tiles) holds less than a tank: all of it moved across, nothing made or lost
    expect(sim.water.levelOf(pond.id)).toBe(0);
    expect(sim.water.levelOf(id) * WATER_NET.reservoir.capacity).toBeCloseTo(pond.capacity, 6);
    // rain tops both back up
    weather(sim, 'rain');
    days(sim, 1);
    expect(sim.water.levelOf(id)).toBe(1);
    expect(sim.water.levelOf(pond.id)).toBe(1);
  });

  it('rain fills a reservoir away from water; it drains as water is drawn from it; save and load keep it', () => {
    const { sim } = park();
    const r = put(sim, 'reservoir', 10, 2);
    expect(sim.water.bankOf(r)).toBeUndefined();
    days(sim, 1);
    expect(sim.water.levelOf(tankId(r))).toBe(0); // no rain, no bank: nothing
    weather(sim, 'rain');
    days(sim, 0.1);
    const wet = sim.water.levelOf(tankId(r));
    expect(wet).toBeGreaterThan(0.2);
    expect(sim.water.draw(tankId(r), 40)).toBe(40);
    expect(sim.water.levelOf(tankId(r))).toBeCloseTo(wet - 40 / WATER_NET.reservoir.capacity, 6);
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.water.levelOf(tankId(r))).toBeCloseTo(sim.water.levelOf(tankId(r)), 9);
  });

  it("a reservoir taken down takes its level with it", () => {
    const { sim } = park();
    const r = put(sim, 'reservoir', 10, 2);
    sim.water.fill(tankId(r), 100);
    expect(sim.water.tracked().some((b) => b.reservoir)).toBe(true);
    sim.bot = { roofId: GROUND, x: 11, z: 3 };
    sim.state.salvage!.tier = 2;
    expect(sim.build.remove(r.id)).toBe(true);
    expect(sim.water.tracked().some((b) => b.reservoir)).toBe(false);
    expect(sim.state.water!.levels[tankId(r)]).toBeUndefined();
  });
});

describe('E23.4.2.2: pumps and pipe placement', () => {
  it('pipes are laid tile by tile: a Pipe lays 4, not in water or under machines, and lift back into the stock', () => {
    const { sim } = park();
    const pack = sim.state.salvage!.pack;
    lay(sim, [[6, 4]]);
    expect(pack.copper).toBe(29);
    expect(pack.clay).toBe(58);
    expect(sim.water.pipes.stock).toBe(3);
    lay(sim, [[7, 4], [8, 4], [9, 4]]);
    expect(pack.copper).toBe(29); // still the first Pipe
    lay(sim, [[10, 4]]);
    expect(pack.copper).toBe(28);
    expect(sim.water.pipes.layProblem(GROUND, 2, 11)).toMatch(/water/);
    expect(sim.water.pipes.layProblem(GROUND, 6, 4)).toMatch(/already/);
    expect(sim.water.pipes.layProblem(GROUND, 3, 3)).toMatch(/in the way/);
    put(sim, 'solar', 12, 4);
    expect(sim.water.pipes.layProblem(GROUND, 12, 4)).toMatch(/stands/);
    expect(sim.water.pipes.lift(10, 4)).toBe(true);
    expect(sim.water.pipes.stock).toBe(4);
    // corners and junctions: links per tile
    lay(sim, [[8, 5], [8, 3]]);
    expect(sim.water.pipes.links(8, 4).length).toBe(4);
    expect(sim.water.pipes.links(9, 4)).toEqual([[8, 4]]);
    // walkable: a pipe never occupies its tile
    expect(tile(sim, 8, 4).occupantId).toBeUndefined();
    expect(sim.water.pipes.networks().length).toBe(1);
  });

  it('the pump and the reservoir are built from their recipes, paid exactly', () => {
    const { sim } = park();
    sim.bot = { roofId: GROUND, x: 5, z: 11 };
    for (const [x, z] of [[4, 11], [9, 4], [10, 4], [9, 5], [10, 5]]) Object.assign(tile(sim, x, z), { ground: 'restored', pollution: 0 });
    sim.state.salvage!.pack = { scrap: 10, copper: 2, clay: 12 };
    expect(sim.build.place('pump', GROUND, 4, 11)).toBeDefined();
    expect(sim.state.salvage!.pack).toEqual({ scrap: 4, clay: 10 }); // the copper is used up (empty stacks are dropped)
    sim.bot = { roofId: GROUND, x: 9, z: 6 };
    expect(sim.build.place('reservoir', GROUND, 9, 4)).toBeDefined();
    expect(sim.state.salvage!.pack).toEqual({});
  });

  it('a pump stands only on a bank', () => {
    const { sim } = park();
    sim.bot = { roofId: GROUND, x: 5, z: 12 };
    for (const [x, z] of [[4, 11], [9, 4]]) Object.assign(tile(sim, x, z), { ground: 'restored', pollution: 0 });
    expect(sim.build.check('pump', GROUND, 4, 11).reason ?? '').not.toMatch(/bank/);
    expect(sim.build.check('pump', GROUND, 9, 4).reason).toMatch(/bank/);
    expect(sim.build.check('pump', GROUND, 3, 11).reason).toMatch(/Not in the water/); // a restored pond tile
    expect(sim.build.check('reservoir', GROUND, 2, 10).reason).toMatch(/Not in the water/);
  });

  it('a tile far from water is fed by pump and pipe, and draws through it from the pond', () => {
    const { sim, pond } = park();
    const far = tile(sim, 11, 12);
    expect(sim.water.isWatered(far)).toBe(false);
    const pump = put(sim, 'pump', 4, 11); // on the pond's bank (3,11)
    lay(sim, run(5, 11, 11));
    // no power yet: the pump asks the grid, gets nothing, and the line stays dry
    days(sim, 0.05);
    sim.power.tick(1);
    expect(sim.water.pipes.pumping.has(pump.id)).toBe(true);
    expect(powered(sim, pump)).toBe(false);
    days(sim, 0.05);
    expect(sim.water.pipes.carries(11, 11)).toBe(false);
    expect(sim.water.isWatered(far)).toBe(false);
    // a solar panel beside it: the grid powers it, and the far tile is fed
    powerUp(sim);
    sim.power.tick(1);
    expect(powered(sim, pump)).toBe(true);
    days(sim, 0.05);
    expect(sim.water.pipes.carries(11, 11)).toBe(true);
    expect(sim.water.isWatered(far)).toBe(true);
    const before = sim.water.levelOf(pond.id);
    expect(sim.water.drawNear(far, 30)).toBe(30);
    expect(sim.water.levelOf(pond.id)).toBeCloseTo(before - 30 / pond.capacity, 9);
    // a pipe tile lifted mid-run cuts the line: the far end is dry again
    sim.water.pipes.lift(8, 11);
    days(sim, 0.05);
    expect(sim.water.isWatered(far)).toBe(false);
  });

  it('a pump pushes water uphill into a higher reservoir, and stops without power', () => {
    const { sim, pond } = park();
    const pump = put(sim, 'pump', 4, 11);
    const panel = powerUp(sim);
    sim.power.tick(1);
    const r = put(sim, 'reservoir', 9, 12);
    for (const t of sim.grid.footprint(GROUND, 9, 12, 2)) t!.level = 3; // a tank on a terrace two levels up
    lay(sim, run(5, 9, 11)); // (9,11) touches the tank's top edge
    sim.power.tick(1);
    days(sim, 0.02);
    expect(sim.water.pipes.pumping.has(pump.id)).toBe(true); // asks the grid for power while it has water to push
    expect(powered(sim, pump)).toBe(true);
    days(sim, 0.23);
    const lv = sim.water.levelOf(tankId(r));
    expect(lv).toBeGreaterThan(0.5);
    expect(sim.water.levelOf(pond.id)).toBeLessThan(1);
    sim.water.fill(pond.id, pond.capacity); // keep the pond topped up
    sim.water.draw(tankId(r), 100);
    sim.water.tick(WATER_NET.step); // the pump asks for power again (it has water to push)
    const lv2 = sim.water.levelOf(tankId(r));
    // the grid goes dark: the pump stops, nothing breaks
    sim.bot = { roofId: GROUND, x: 6, z: 10 };
    expect(sim.build.remove(panel.id)).toBe(true);
    sim.power.tick(1);
    expect(powered(sim, pump)).toBe(false);
    const tank = sim.water.levelOf(tankId(r));
    const pondNow = sim.water.levelOf(pond.id);
    days(sim, 0.25);
    expect(lv).toBeGreaterThan(lv2);
    expect(sim.water.levelOf(tankId(r))).toBe(tank); // nothing moves without power…
    expect(sim.water.levelOf(pond.id)).toBe(pondNow); // …and nothing is lost
  });
});

describe('E23.4.2.3: gravity feeds', () => {
  it('gravity feeds come with the reservoirs in Cistern Basin: before Sluice wakes, nothing is handed over', () => {
    const { sim } = park();
    sim.state.salvage!.keepers = {};
    expect(sim.water.unlocked('gravityFeed')).toBe(false);
    expect(sim.build.isUnlocked('reservoir')).toBe(false);
    expect(sim.build.isUnlocked('pump')).toBe(false);
    expect(sim.water.pipes.layProblem(GROUND, 6, 4)).toMatch(/Sluice/);
    sim.state.salvage!.keepers.sluice = { step: 'request1' };
    expect(sim.build.isUnlocked('reservoir')).toBe(true);
    expect(sim.water.pipes.layProblem(GROUND, 6, 4)).toBeUndefined();
  });

  it('a reservoir on higher ground feeds the pipe below it with the grid switched off; not uphill', () => {
    const { sim } = park();
    gridOff(sim);
    const r = put(sim, 'reservoir', 14, 4);
    for (const t of sim.grid.footprint(GROUND, 14, 4, 2)) t!.level = 2;
    sim.water.fill(tankId(r), 300);
    // a line down from the tank across the lawn, and a spur that climbs to a level-3 tile
    lay(sim, run(6, 13, 4));
    tile(sim, 13, 4).level = 1.5;
    lay(sim, [[10, 3]]);
    tile(sim, 10, 3).level = 3;
    days(sim, 0.02);
    const end = tile(sim, 6, 5);
    expect(sim.water.pipes.carries(6, 4)).toBe(true);
    expect(sim.water.isWatered(end)).toBe(true);
    expect(sim.water.pipes.carries(10, 3)).toBe(false); // water doesn't climb on its own
    const before = sim.water.levelOf(tankId(r));
    expect(sim.water.drawNear(end, 50)).toBe(50);
    expect(sim.water.levelOf(tankId(r))).toBeCloseTo(before - 50 / WATER_NET.reservoir.capacity, 9);
    // empty, the line runs dry: nothing else happens
    sim.water.draw(tankId(r), 1e9);
    days(sim, 0.02);
    expect(sim.water.isWatered(end)).toBe(false);
  });

  it('a higher reservoir fills a lower one down a pipe, with no pump and no power', () => {
    const { sim } = park();
    gridOff(sim);
    const hi = put(sim, 'reservoir', 14, 4);
    for (const t of sim.grid.footprint(GROUND, 14, 4, 2)) t!.level = 2;
    const lo = put(sim, 'reservoir', 6, 5);
    sim.water.fill(tankId(hi), WATER_NET.reservoir.capacity);
    lay(sim, run(7, 13, 4));
    days(sim, 0.25);
    expect(sim.water.levelOf(tankId(lo))).toBeGreaterThan(0.3);
    expect(sim.water.levelOf(tankId(hi))).toBeLessThan(1);
    const sum = (sim.water.levelOf(tankId(lo)) + sim.water.levelOf(tankId(hi))) * WATER_NET.reservoir.capacity;
    expect(sum).toBeCloseTo(WATER_NET.reservoir.capacity, 6); // nothing made or lost on the way
  });
});
