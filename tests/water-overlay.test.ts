import { describe, expect, it } from 'vitest';
import { Bindings, defaultKeys, defaultPad } from '../src/app/Bindings';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData, MachineType } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';
import { tankId } from '../src/gameplay/WaterPipes';

function park() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.areas.clear(PARK, true);
  sim.state.salvage!.keepers.sluice = { step: 'request1' };
  sim.state.salvage!.pack = { copper: 20, clay: 40 };
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const t = sim.grid.get(GROUND, x, z)!;
      if (t.feature === 'water' && !t.blocked) {
        t.ground = 'restored';
        sim.grid.touch(t);
      }
    }
  const noon = { ...sim.power.sky(), sun: 1, solar: 1 };
  sim.power.skyOverride = () => noon;
  return sim;
}
function put(sim: Sim, type: MachineType, x: number, z: number, size = type === 'reservoir' ? 2 : 1): MachineData {
  const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  for (const t of sim.grid.footprint(GROUND, x, z, size)) if (t) t.occupantId = m.id;
  sim.grid.indexMachine(m);
  return m;
}

describe('E23.4.5: the Water view', () => {
  it('shows the way water flows: away from a running pump, down a line from a reservoir; nothing on dry pipe', () => {
    const sim = park();
    put(sim, 'pump', 4, 11);
    put(sim, 'solar', 5, 10);
    for (let x = 5; x <= 9; x++) sim.water.pipes.lay(GROUND, x, 11);
    expect(sim.water.pipes.lay(GROUND, 7, 10)).toBe(true); // a branch (north)
    sim.power.tick(1);
    sim.water.tick(1);
    sim.power.tick(1);
    sim.water.tick(1);
    const flow = sim.water.pipes.flow();
    expect(flow.get('5,11')).toEqual([[1, 0]]); // from the pump eastward
    expect(flow.get('7,11')).toEqual(expect.arrayContaining([[1, 0], [0, -1]])); // on along the line and up the branch
    expect(flow.get('9,11')).toBeUndefined(); // the end of the line
    // a dry line (its own, with nothing feeding it) has no arrows
    for (let x = 6; x <= 9; x++) sim.water.pipes.lay(GROUND, x, 4);
    expect([...sim.water.pipes.flow().keys()].some((k) => k.endsWith(',4'))).toBe(false);
    // a reservoir on that line feeds it by gravity: arrows run away from it
    const r = put(sim, 'reservoir', 10, 3);
    sim.water.fill(tankId(r), 200);
    sim.water.tick(1);
    const f2 = sim.water.pipes.flow();
    expect(f2.get('9,4')).toEqual([[-1, 0]]);
    expect(f2.get('6,4')).toBeUndefined();
  });

  it('is toggled in build mode on keyboard (V) and pad (d-pad left), clashing with nothing', () => {
    for (const oldCity of [false, true]) {
      expect(defaultKeys(oldCity).waterOverlay).toEqual(['KeyV']);
      expect(defaultPad(oldCity).waterOverlay).toBe(14);
      const b = new Bindings(undefined, { oldCity });
      expect(b.conflicts()).toEqual([]);
      expect(b.actionForButton(14, ['build', 'world', 'any'])).toBe('waterOverlay');
      expect(b.actionForCode('KeyV', ['build', 'world', 'any'])).toBe('waterOverlay');
      expect(b.actionForCode('KeyV', ['world', 'any'])).toBeUndefined(); // walking: V does nothing
    }
  });
});
