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

describe('far-away drones as work rates (City 11.4)', () => {
  /** A cleared ring of areas with eight hubs spread around, some of it still to restore. */
  async function fleet(seed = 21) {
    const { createInitialState: create, GROUND: G } = await import('../src/core/GameState');
    const { Sim: S } = await import('../src/gameplay/Sim');
    const sim = new S(create(seed));
    const st = sim.state;
    st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
    st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
    st.progression.coreActivated = true;
    for (let cz = -3; cz <= 3; cz++) for (let cx = -3; cx <= 3; cx++) sim.areas.clear(sim.areas.map.areaOfChunk(cx, cz), true);
    let n = 0;
    for (const [x, z] of [[-40, -40], [-40, 0], [-40, 40], [0, -40], [0, 40], [40, -40], [40, 0], [40, 40]]) {
      const cells = sim.grid.footprint(G, x, z, 2);
      for (const c of cells) if (c) c.blocked = false;
      const m = { id: sim.newId('m'), type: 'droneHub' as const, roofId: G, x, z, size: 2, boostUntil: 0, timer: 0, charge: 0 };
      st.machines.push(m);
      sim.grid.indexMachine(m);
      for (const c of cells) c!.occupantId = m.id;
      n++;
    }
    expect(n).toBe(8);
    return sim;
  }

  it('over 10 minutes, drones far from the camera get as much done as fully simulated ones (within 5%)', async () => {
    const full = await fleet();
    const far = await fleet();
    far.drones.focus = { x: 5000, z: 5000, radius: 50 }; // the camera is somewhere else entirely
    let farFlights = 0;
    far.bus.on('drone.jobStarted', ({ droneId }) => {
      if (far.state.drones.find((d) => d.id === droneId)?.far) farFlights++;
    });
    full.advance(600);
    far.advance(600);
    const a = full.state.stats.droneJobs;
    const b = far.state.stats.droneJobs;
    expect(a).toBeGreaterThan(100);
    expect(farFlights).toBeGreaterThan(100);
    expect(Math.abs(a - b) / a).toBeLessThan(0.05);
    // Throughput and outcome: the same ground restored.
    expect(Math.abs(full.state.stats.tilesRestored - far.state.stats.tilesRestored) / full.state.stats.tilesRestored).toBeLessThan(0.05);
  });

  it('no drone teleports when the camera arrives mid-flight', async () => {
    const sim = await fleet(5);
    sim.drones.focus = { x: 5000, z: 5000, radius: 50 };
    let checked = 0;
    for (let i = 0; i < 3000 && checked < 6; i++) {
      sim.tick();
      for (const d of sim.state.drones) {
        if (!d.far || sim.time - d.far.t0 < 0.1 || d.far.t1 - sim.time < 0.15) continue;
        // Where the renderer would draw it now, and after the camera flies over and a tick passes.
        const before = sim.drones.worldOf(d);
        const hub = sim.machine(d.hubId)!;
        sim.drones.focus = { x: hub.x, z: hub.z, radius: 50 };
        sim.tick();
        const after = sim.drones.worldOf(d);
        expect(d.far).toBeUndefined();
        const step = 3 * 0.1 * sim.upgrades.droneFlyMult + 1e-6; // at most one tick of flight apart
        expect(Math.hypot(after[0] - before[0], after[2] - before[2])).toBeLessThanOrEqual(step * 1.01 + 0.31);
        checked++;
        sim.drones.focus = { x: 5000, z: 5000, radius: 50 };
        break;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('reservations stay right: no two drones ever head for the same tile', async () => {
    const sim = await fleet(9);
    sim.drones.focus = { x: 0, z: -40, radius: 30 }; // some near, most far
    for (let i = 0; i < 1200; i++) {
      sim.tick();
      const targets = sim.state.drones.map((d) => d.targetTileId).filter(Boolean);
      expect(new Set(targets).size).toBe(targets.length);
      for (const t of targets) expect(sim.drones.isReserved(t!)).toBe(true);
    }
  });
});
