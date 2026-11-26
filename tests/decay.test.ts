import { expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { parseSettings } from '../src/app/Settings';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

function garden() {
  const sim = new Sim(createInitialState(7));
  sim.weather.forceForTest('sunny', Infinity);
  return sim;
}

function restore(sim: Sim, x = 11, z = 12) {
  const tile = sim.grid.get(GROUND, x, z)!;
  expect(tile.blocked || tile.occupantId || tile.feature === 'water').toBeFalsy();
  sim.restoration.complete(tile, 'pulse', undefined, true);
  tile.bloom = TUNING.restore.maxBloom;
  tile.plant = 'meadow';
  sim.grid.touch(tile);
  return tile;
}

function pass(sim: Sim, seconds: number) {
  for (let left = seconds; left > 0; left -= 5) sim.tick(Math.min(left, 5));
}

it('gives the starting park a grace period and then lets neglected plants wilt, die and be restored', () => {
  const sim = garden();
  const tile = restore(sim);
  pass(sim, 300);
  expect(tile.drySince).toBeUndefined();

  sim.state.salvage.tier = 1;
  pass(sim, 125);
  expect(tile.ground).toBe('restored');
  expect(sim.decay.wilting(tile)).toBe(true);
  expect(sim.water.bloomShown(tile)).toBe(1);
  expect(tile.bloom).toBe(TUNING.restore.maxBloom);
  pass(sim, 120);
  expect(tile).toMatchObject({ ground: 'polluted', bloom: 0, plant: undefined, drySince: undefined });
  expect(sim.restoration.pulse(tile.id)).toBe(true);
  pass(sim, 5);
  expect(tile.ground).toBe('restored');
});

it('lets a pulse and rainfall rescue wilting ground before it dies', () => {
  const sim = garden();
  sim.state.salvage.tier = 1;
  const tile = restore(sim);
  pass(sim, 125);
  expect(sim.restoration.pulse(tile.id)).toBe(true);
  expect(sim.decay.thirsty(tile)).toBe(false);
  expect(tile.plant).toBe('meadow');
  pass(sim, 125);
  expect(sim.decay.wilting(tile)).toBe(true);
  sim.weather.forceForTest('rain', Infinity);
  pass(sim, 270);
  expect(tile.drySince).toBeUndefined();
  expect(tile.ground).toBe('restored');
});

it('starts with Cozy Mode off and clears active neglect when it is enabled', () => {
  expect(parseSettings(null).cozyMode).toBe(false);
  expect(parseSettings('{"hints":true}').cozyMode).toBe(false);
  expect(parseSettings('{"cozyMode":true}').cozyMode).toBe(true);
  const sim = garden();
  sim.state.salvage.tier = 1;
  const tile = restore(sim);
  pass(sim, 125);
  expect(sim.decay.wilting(tile)).toBe(true);
  sim.decay.setCozyMode(true);
  pass(sim, 300);
  expect(tile.drySince).toBeUndefined();
  expect(tile.ground).toBe('restored');
  sim.decay.setCozyMode(false);
  pass(sim, 120);
  expect(sim.decay.wilting(tile)).toBe(false);
  pass(sim, 125);
  expect(tile.ground).toBe('polluted');
});

it('continues neglect after a save, including restored tiles outside the loaded chunks', () => {
  const sim = garden();
  sim.state.salvage.tier = 1;
  const tile = restore(sim, 26, 21);
  pass(sim, 125);
  const saver = new SaveService();
  const data = saver.serialize(sim.state);
  const back = new Sim(saver.deserialize(data)!);
  back.weather.forceForTest('sunny', Infinity);
  expect(back.grid.peek(GROUND, tile.x, tile.z)).toBeUndefined();
  pass(back, 5);
  const loaded = back.grid.peek(GROUND, tile.x, tile.z)!;
  expect(loaded.drySince).toBeCloseTo(tile.drySince!);
  expect(loaded.plant).toBe('meadow');
  expect(back.decay.wilting(loaded)).toBe(true);
  pass(back, 115);
  expect(loaded.ground).toBe('polluted');
});

it('lets a Water Condenser tend the plants beside it', () => {
  const sim = garden();
  sim.state.salvage.tier = 1;
  const beside = restore(sim);
  const far = restore(sim, 8, 12);
  const machine: MachineData = { id: sim.newId('m'), type: 'condenser', roofId: GROUND, x: 12, z: 12, size: 1, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(machine);
  sim.grid.indexMachine(machine);
  sim.grid.get(GROUND, 12, 12)!.occupantId = machine.id;
  pass(sim, 500);
  expect(beside.ground).toBe('restored');
  expect(beside.bloom).toBe(TUNING.restore.maxBloom);
  expect(far.ground).toBe('polluted');
});

it('keeps ground alive only while its piped water supply is connected', () => {
  const sim = garden();
  sim.areas.clear(PARK, true);
  sim.state.salvage.tier = 2;
  sim.state.salvage.keepers.sluice = { step: 'request1' };
  for (const tile of sim.grid.tilesWithin(GROUND, 2, 11, 4)) {
    if (tile.feature !== 'water' || tile.blocked) continue;
    sim.restoration.complete(tile, 'pulse', undefined, true);
  }
  sim.state.salvage.pack = { pipe: 40, clay: 60, copper: 30, scrap: 40 };
  const noon = { ...sim.power.sky(), sun: 1, solar: 1 };
  sim.power.skyOverride = () => noon;
  const put = (type: MachineData['type'], x: number, z: number) => {
    const machine = { id: sim.newId('m'), type, roofId: GROUND, x, z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
    sim.state.machines.push(machine);
    sim.grid.indexMachine(machine);
    sim.grid.get(GROUND, x, z)!.occupantId = machine.id;
  };
  const far = restore(sim);
  expect(sim.water.isWatered(far)).toBe(false);
  put('pump', 4, 11);
  put('solar', 5, 10);
  for (let x = 5; x <= 11; x++) expect(sim.water.pipes.lay(GROUND, x, 11)).toBe(true);
  pass(sim, 245);
  expect(sim.water.pipes.feeds(far)).toBe(true);
  expect(far.drySince).toBeUndefined();
  expect(far.ground).toBe('restored');
  sim.water.pipes.lift(8, 11);
  pass(sim, 250);
  expect(far.ground).toBe('polluted');
});
