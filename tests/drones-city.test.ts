import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';

function city(seed = 6, r = 3) {
  const sim = new Sim(createInitialState(seed));
  const st = sim.state;
  st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
  st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
  st.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) sim.areas.clear(sim.areas.map.areaOfChunk(cx, cz), true);
  return sim;
}

/** Inserts a hub directly (costs grow per copy; these tests are about drones). */
function hub(sim: Sim, x: number, z: number): MachineData {
  const cells = sim.grid.footprint(GROUND, x, z, 2);
  for (const c of cells) {
    c!.blocked = false;
    c!.ground = 'restored';
    c!.bloom = 3;
  }
  const m: MachineData = { id: sim.newId('m'), type: 'droneHub', roofId: GROUND, x, z, size: 2, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  for (const c of cells) c!.occupantId = m.id;
  sim.drones.spawn(m);
  return m;
}

/** Everything restored and in full bloom inside a box (so drones there have nothing to do). */
function finish(sim: Sim, x0: number, z0: number, x1: number, z1: number) {
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const t = sim.grid.get(GROUND, x, z)!;
      if (t.blocked) continue;
      t.ground = 'restored';
      t.bloom = 3;
      t.pollution = 0;
      sim.grid.touch(t);
    }
}

describe('drone networks (City 11)', () => {
  it('hubs within range link up: an idle drone works the other hub’s reach', () => {
    const sim = city();
    const a = hub(sim, 20, 20);
    const b = hub(sim, 31, 20); // 9 tiles apart: linked
    expect(sim.drones.network(a).map((h) => h.id).sort()).toEqual([a.id, b.id].sort());
    finish(sim, 10, 10, 26, 30); // nothing left near A
    const worked: string[] = [];
    sim.bus.on('drone.jobStarted', ({ droneId, tileId }) => {
      if (sim.state.drones.find((d) => d.id === droneId)?.hubId === a.id) worked.push(tileId);
    });
    sim.advance(30);
    expect(worked.length).toBeGreaterThan(0);
    for (const id of worked) expect(Number(id.split(':')[1])).toBeGreaterThan(26);
  });

  it('hubs far apart are separate networks', () => {
    const sim = city();
    const a = hub(sim, -30, -30);
    hub(sim, 10, 10);
    expect(sim.drones.network(a)).toHaveLength(1);
  });

  it('drones prefer restoring at the fog’s edge', () => {
    const sim = new Sim(createInitialState(8));
    const st = sim.state;
    st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
    st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
    st.progression.coreActivated = true;
    for (const t of sim.areas.tiles(PARK)) if (!t.blocked && !t.occupantId) {
      t.ground = 'restored';
      t.bloom = 3;
      sim.grid.touch(t);
    }
    sim.areas.clear(PARK, true);
    // A hub near the park's edge: frontier tiles beyond the edge are its first jobs.
    hub(sim, 13, 7);
    const first: string[] = [];
    sim.bus.on('drone.jobStarted', ({ tileId }) => first.length < 3 && first.push(tileId));
    sim.advance(20);
    expect(first.length).toBeGreaterThan(0);
    for (const id of first) {
      const t = sim.grid.byTileId(id)!;
      expect(sim.areas.areaOf(t)).not.toBe(PARK);
    }
  });

  it('soak: 50 hubs never target fog, blocked, finished or double-booked tiles', { timeout: 60000 }, () => {
    const sim = city(13, 4);
    let n = 0;
    for (let z = -56; z <= 56 && n < 50; z += 16) for (let x = -56; x <= 56 && n < 50; x += 14) {
      hub(sim, x, z);
      n++;
    }
    const bad: string[] = [];
    sim.bus.on('drone.jobStarted', ({ droneId, tileId }) => {
      const t = sim.grid.byTileId(tileId)!;
      if (t.blocked) bad.push(`blocked ${tileId}`);
      if (t.roofId === GROUND && sim.areas.fog(sim.areas.areaOf(t)!) === 'hidden') bad.push(`hidden ${tileId}`);
      if (t.ground === 'restored' && t.bloom >= 3) bad.push(`finished ${tileId}`);
      const others = sim.state.drones.filter((d) => d.id !== droneId && d.targetTileId === tileId);
      if (others.length) bad.push(`double ${tileId}`);
    });
    sim.advance(60);
    expect(sim.state.drones.length).toBeGreaterThanOrEqual(50);
    expect(bad).toEqual([]);
  });
});
