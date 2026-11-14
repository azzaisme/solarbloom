import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import type { DroneData, MachineData } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';

/** A cleared park, its neighbour areas revealed, a hub on the park's edge reaching into both. */
function setup(seed = 8) {
  const sim = new Sim(createInitialState(seed));
  const st = sim.state;
  st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
  st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
  st.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  return sim;
}

function hubAt(sim: Sim, x: number, z: number): MachineData {
  const m: MachineData = { id: sim.newId('m'), type: 'droneHub', roofId: GROUND, x, z, size: 2, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  return m;
}

function drone(hub: MachineData): DroneData {
  return { id: 'd-test', hubId: hub.id, px: hub.x + 1, pz: hub.z + 1 } as DroneData;
}

/** Park tiles: half restored (green, can still grow), half dead. */
function mixPark(sim: Sim) {
  sim.areas.tiles(PARK).forEach((t, i) => {
    if (!isRestorable(t, sim.state.machines)) return;
    if (i % 2) {
      t.ground = 'restored';
      t.bloom = 1;
      t.pollution = 0;
    } else {
      t.ground = 'polluted';
      t.pollution = 50;
    }
    sim.grid.touch(t);
  });
}

describe('area automation switches (City 11.3)', () => {
  it('"Leave this area alone": drones never pick its tiles', () => {
    const sim = setup();
    mixPark(sim);
    const hub = hubAt(sim, 6, 6);
    const d = drone(hub);
    expect(sim.areas.areaOf(sim.drones.findJob(d)!)).toBe(PARK);
    sim.areas.setMode(PARK, 'off');
    for (let i = 0; i < 20; i++) {
      const j = sim.drones.findJob(d);
      if (!j) break;
      expect(sim.areas.areaOf(j)).not.toBe(PARK);
      sim.restoration.complete(j, 'drone');
    }
  });

  it('"Keep this area blooming": its green tiles come before restoring dead ones', () => {
    const sim = setup();
    mixPark(sim);
    const hub = hubAt(sim, 6, 6);
    const d = drone(hub);
    expect(sim.drones.findJob(d)!.ground).not.toBe('restored'); // normally: restore first
    sim.areas.setMode(PARK, 'bloom');
    const j = sim.drones.findJob(d)!;
    expect(j.ground).toBe('restored');
    expect(sim.areas.areaOf(j)).toBe(PARK);
  });

  it("\"Focus the frontier\": the hub's drones go for the fog edge over nearer dead tiles at home", () => {
    const sim = setup();
    mixPark(sim);
    // A hub two tiles inside the park from its fog edge, its drone hovering on the far side: normally it
    // finishes the dead park tiles around it first.
    const edge = sim.areas.entryTiles(sim.areas.nextGoal()!).find((t) => t.z === -1 && t.x >= 4 && t.x <= 12) ?? sim.areas.entryTiles(sim.areas.nextGoal()!)[0];
    const hub = hubAt(sim, edge.x, edge.z + 3);
    for (const t of sim.grid.footprint(GROUND, hub.x, hub.z, 2)) if (t) t.occupantId = hub.id;
    const d = drone(hub);
    d.pz = hub.z + 2.5;
    const inFog = (t: { roofId: string; x: number; z: number }) => sim.areas.fog(sim.areas.areaOf(t)!) !== 'cleared';
    expect(inFog(sim.drones.findJob(d)!)).toBe(false);
    sim.areas.setMode(PARK, 'frontier');
    expect(inFog(sim.drones.findJob(d)!)).toBe(true);
  });

  it('switches survive save and load, and can be turned back to normal', () => {
    const sim = setup();
    const id = sim.areas.nextGoal()!;
    sim.areas.setMode(PARK, 'bloom');
    sim.areas.setMode(id, 'off');
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.areas.mode(PARK)).toBe('bloom');
    expect(copy.areas.mode(id)).toBe('off');
    copy.areas.setMode(PARK, undefined);
    expect(copy.areas.mode(PARK)).toBeUndefined();
    expect(copy.areas.setMode('nowhere', 'off')).toBe(false);
  });
});
