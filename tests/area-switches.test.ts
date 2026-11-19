import { big } from '../src/core/Big';
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
  st.caps.energy = big(1e7); st.caps.water = big(1e7);
  st.resources.energy = big(1e6); st.resources.water = big(1e6); st.resources.biomass = big(1e6);
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
    // E23.1.1: in the Old City the frontier is Saltwind, and helpers work there once bloombot has done its share (E21.9)
    const goal = sim.areas.nextGoal()!;
    sim.state.areas[goal].byBot = sim.areas.shareTarget(goal);
    // a fog-edge tile with open park ground running three tiles straight in from it
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    const parkFree = (x: number, z: number) => {
      const t = sim.grid.get(GROUND, x, z);
      return !!t && !t.blocked && !t.occupantId && sim.areas.areaOf(t) === PARK;
    };
    let edge: { x: number; z: number } | undefined;
    let dir: readonly [number, number] = [0, 1];
    for (const t of sim.areas.entryTiles(goal)) {
      const d = D.find(([dx, dz]) => [1, 2, 3, 4, 5].every((k) => parkFree(t.x + dx * k, t.z + dz * k) && parkFree(t.x + dx * k + Math.abs(dz), t.z + dz * k + Math.abs(dx))));
      if (d) {
        edge = t;
        dir = d;
        break;
      }
    }
    expect(edge).toBeDefined();
    // the 2×2 hub three tiles in (its corner toward the park when walking north or west)
    const hub = hubAt(sim, edge!.x + dir[0] * (dir[0] < 0 ? 4 : 3), edge!.z + dir[1] * (dir[1] < 0 ? 4 : 3));
    for (const t of sim.grid.footprint(GROUND, hub.x, hub.z, 2)) if (t) t.occupantId = hub.id;
    const d = drone(hub);
    d.px = hub.x + 1 + dir[0] * 1.5;
    d.pz = hub.z + 1 + dir[1] * 1.5;
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
