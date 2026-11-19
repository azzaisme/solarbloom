import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData, TileData } from '../src/core/types';
import { WATER_NET } from '../src/data/water';
import { Sim } from '../src/gameplay/Sim';
import { WaterSystem } from '../src/gameplay/WaterSystem';
import { TUNING } from '../src/data/tuning';

/** the lushest bloom (the land starts there: the fade has to take all of it back to plain restored ground) */
const LUSH = TUNING.restore.maxBloom;

const DAY = WATER_NET.daySeconds;

/** The park with its pond restored and full, and lush ground all round it. */
function park() {
  const sim = new Sim(createInitialState(7));
  sim.areas.clear(PARK, true);
  const pond: TileData[] = [];
  const land: TileData[] = [];
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const t = sim.grid.get(GROUND, x, z)!;
      if (t.feature === 'water' && !t.blocked) pond.push(t);
      else if (!t.blocked && t.feature !== 'water') land.push(t);
      else continue;
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = LUSH;
      sim.grid.touch(t);
    }
  const body = sim.water.bodyAt(pond[0])!;
  return { sim, pond, land, body };
}

const near = (sim: Sim, land: TileData[], body: string) => {
  const b = sim.water.body(body)!;
  const [x0, z0, x1, z1] = sim.water.fadeBounds(b);
  const R = WATER_NET.fadeReach;
  // (and out of reach of Saltwind's canal, x ≤ −2, which is full and keeps its own side green)
  return land.filter((t) => t.x > -2 + R && t.x >= x0 + R - 1 && t.x <= x1 - R + 1 && t.z >= z0 + R - 1 && t.z <= z1 - R + 1);
};

describe('E23.4.4: land fades around low water', () => {
  it('fade steps grow as a body empties, from nothing at the threshold', () => {
    expect(WaterSystem.fadeSteps(1)).toBe(0);
    expect(WaterSystem.fadeSteps(WATER_NET.fadeBelow)).toBe(0);
    expect(WaterSystem.fadeSteps(WATER_NET.fadeBelow * 0.9)).toBe(1);
    expect(WaterSystem.fadeSteps(WATER_NET.fadeBelow * 0.5)).toBe(2); // lush → flowers → closing → plain restored
    expect(WaterSystem.fadeSteps(WATER_NET.fadeBelow * 0.1)).toBe(3);
    expect(WaterSystem.fadeSteps(0)).toBe(WATER_NET.fadeSteps);
  });

  it('a full pond fades nothing', () => {
    const { sim, land } = park();
    expect(land.every((t) => sim.water.bloomShown(t) === LUSH)).toBe(true);
  });

  it('draining a pond fades the ground beside it, never below restored, and loses nothing', () => {
    const { sim, land, body } = park();
    const banks = near(sim, land, body.id);
    // the bank column east of the pond (x 4, z 9…14) less the rock at (4,12) and E23.9.1's first journal page at (4,13)
    expect(banks.length).toBeGreaterThanOrEqual(4);
    const machines = sim.state.machines.length;
    const decor = JSON.stringify(sim.state.cozy?.decor ?? {});
    sim.weather.forceForTest('sunny', Infinity);
    sim.water.draw(body.id, body.capacity);
    // a whole sunny game day of the full sim at the water's step, plus a few minutes of every system
    for (let i = 0; i < 24; i++) sim.water.tick(DAY / 24);
    sim.advance(30);
    expect(sim.water.levelOf(body.id)).toBe(0);
    for (const t of land) {
      expect(t.ground).toBe('restored'); // never back to dead ground
      expect(t.bloom).toBe(LUSH); // the tile itself keeps its bloom
      expect(sim.water.bloomShown(t)).toBeGreaterThanOrEqual(1);
    }
    // the fade spans the whole bloom range: the lushest bank shows plain restored ground, its flowers closed
    expect(WATER_NET.fadeSteps).toBe(LUSH - 1);
    for (const t of banks) expect(sim.water.bloomShown(t)).toBe(1);
    expect(sim.state.machines.length).toBe(machines);
    expect(JSON.stringify(sim.state.cozy?.decor ?? {})).toBe(decor);
    // land beyond the water's reach doesn't depend on it
    const far = land.filter((t) => sim.water.fadeAt(t) === 0);
    expect(far.length).toBeGreaterThan(0);
    // refilling greens it all up again
    sim.weather.forceForTest('rain', Infinity);
    for (let i = 0; i < 12; i++) sim.water.tick(DAY / 24);
    expect(sim.water.levelOf(body.id)).toBe(1);
    for (const t of land) expect(sim.water.bloomShown(t)).toBe(t.bloom);
  });

  it("E23.5's planters by a drained pond wilt with the land, no crop is removed, and they grow on when it refills", () => {
    const { sim, land, body } = park();
    sim.weather.forceForTest('sunny', Infinity); // dry days: rain would water the beds itself
    const banks = near(sim, land, body.id).filter((t) => !t.occupantId);
    const beds: MachineData[] = [];
    for (const t of banks.slice(0, 3)) {
      const m: MachineData = { id: sim.newId('m'), type: 'planter', roofId: GROUND, x: t.x, z: t.z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
      sim.state.machines.push(m);
      t.occupantId = m.id;
      sim.grid.indexMachine(m);
      beds.push(m);
    }
    expect(beds.length).toBe(3);
    (sim.state.salvage!.crops ??= []).push('radish');
    sim.inventory.add('seeds', 5);
    for (const m of beds) expect(sim.farm.plant(m, 'radish')).toBe(true);
    expect(beds.every((m) => !sim.farm.look(m).wilting)).toBe(true);
    const step = () => {
      sim.state.time += DAY / 24;
      sim.water.tick(DAY / 24);
      sim.farm.tick(DAY / 24);
    };
    for (let i = 0; i < 3; i++) step();
    const grown = beds.map((m) => sim.state.salvage!.planters![m.id].grown!);
    expect(grown.every((g) => g > 0)).toBe(true);
    // the pond runs dry: the land fades, the beds wilt and wait
    sim.water.draw(body.id, body.capacity);
    for (const m of beds) {
      expect(sim.farm.look(m).wilting).toBe(true);
      expect(sim.water.fadeAt(sim.grid.get(GROUND, m.x, m.z)!)).toBe(WATER_NET.fadeSteps);
    }
    for (let i = 0; i < 24; i++) step();
    beds.forEach((m, i) => {
      expect(sim.state.machines).toContain(m);
      expect(sim.state.salvage!.planters![m.id]).toMatchObject({ crop: 'radish', grown: grown[i] }); // nothing removed, nothing lost
    });
    // refilled: green again, and they grow on
    sim.water.fill(body.id, body.capacity);
    expect(beds.every((m) => !sim.farm.look(m).wilting)).toBe(true);
    for (let i = 0; i < 3; i++) step();
    beds.forEach((m, i) => expect(sim.state.salvage!.planters![m.id].grown).toBeGreaterThan(grown[i]));
  });

  it('a nearby full body keeps the land green even when another runs dry (two bodies)', () => {
    const { sim, land, body } = park();
    // Saltwind's canal: a second body, south-west of the park's pond
    const canal = sim.water.bodyAt(sim.grid.get(GROUND, -3, 20))!;
    expect(canal).toBeDefined();
    expect(canal.id).not.toBe(body.id);
    const R = WATER_NET.fadeReach;
    const dist = (t: TileData, b: typeof canal) => Math.min(...[...b.tiles].map((id) => sim.grid.byTileId(id)!).map((w) => Math.max(Math.abs(w.x - t.x), Math.abs(w.z - t.z))));
    const both = land.filter((t) => dist(t, body) <= R && dist(t, canal) <= R);
    const pondOnly = land.filter((t) => dist(t, body) <= R && dist(t, canal) > R);
    expect(both.length).toBeGreaterThan(0);
    expect(pondOnly.length).toBeGreaterThan(0);
    // the pond runs dry, the canal stays full
    sim.water.draw(body.id, body.capacity);
    expect(sim.water.levelOf(canal.id)).toBe(1);
    for (const t of pondOnly) expect(sim.water.fadeAt(t)).toBe(WATER_NET.fadeSteps);
    for (const t of both) expect(sim.water.fadeAt(t)).toBe(0); // the full canal keeps its side green
    // the canal runs dry too: now that side fades as well
    sim.water.draw(canal.id, canal.capacity);
    for (const t of both) expect(sim.water.fadeAt(t)).toBe(WATER_NET.fadeSteps);
    // the canal comes back: its side greens up, the pond's own side stays faded
    sim.water.fill(canal.id, canal.capacity);
    for (const t of both) expect(sim.water.fadeAt(t)).toBe(0);
    for (const t of pondOnly) expect(sim.water.fadeAt(t)).toBe(WATER_NET.fadeSteps);
  });

  it('a chunk rebuild reads the fade with one lookup per tile: no rebuild of the map between level changes', () => {
    const { sim, land, body } = park();
    sim.water.draw(body.id, body.capacity);
    sim.water.fadeAt(land[0]);
    const w = sim.water as unknown as { refreshFade: () => void };
    let builds = 0;
    const orig = w.refreshFade.bind(w);
    w.refreshFade = () => {
      builds++;
      orig();
    };
    for (let i = 0; i < 20; i++) for (const t of land) sim.water.bloomShown(t);
    for (let i = 0; i < 600; i++) sim.water.takeFadeChanges();
    expect(builds).toBe(0);
    sim.water.fill(body.id, 1); // a level changes: the next read refreshes once
    for (const t of land) sim.water.bloomShown(t);
    expect(builds).toBe(1);
  });

  it('reports the areas to repaint only when a body crosses a fade step', () => {
    const { sim, body } = park();
    sim.water.takeFadeChanges(); // what is already showing (the dry Cistern pond)
    sim.water.draw(body.id, 1); // tracked, still full enough
    expect(sim.water.takeFadeChanges()).toEqual([]);
    sim.water.draw(body.id, body.capacity);
    expect(sim.water.takeFadeChanges().length).toBe(1);
    expect(sim.water.takeFadeChanges()).toEqual([]);
    sim.water.fill(body.id, body.capacity);
    expect(sim.water.takeFadeChanges().length).toBe(1);
  });

  it("has the gentle-failure suite's hooks, and reads E23.7.2's weather", () => {
    const { sim, pond, land, body } = park();
    const bank = near(sim, land, body.id)[0];
    expect(sim.water.isDry(bank)).toBe(false);
    sim.water.bodyAt(pond[0]);
    sim.water.drainForTest();
    expect(sim.water.levelOf(body.id)).toBe(0);
    expect(sim.water.isDry(bank)).toBe(true);
    expect(land.every((t) => t.ground === 'restored')).toBe(true);
    sim.water.refillForTest();
    expect(sim.water.isDry(bank)).toBe(false);
    // E23.7.2's weather: its rain units and its evaporation share
    sim.weather.forceForTest('storm', Infinity);
    expect(sim.water.weather()).toBe('storm');
    expect(sim.water.sky()).toEqual({ fill: 2 * WATER_NET.rainShare, evap: 0 });
    sim.weather.forceForTest('rain', Infinity);
    expect(sim.water.sky()).toEqual({ fill: WATER_NET.rainShare, evap: 0 });
    sim.weather.forceForTest('sunny', Infinity);
    expect(sim.water.sky()).toEqual({ fill: 0, evap: sim.weather.effects().evaporation });
    expect(sim.water.sky().evap).toBeGreaterThan(0);
  });
});
