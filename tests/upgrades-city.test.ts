import { big } from '../src/core/Big';
import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';

function rich(sim: Sim) {
  const st = sim.state;
  st.caps.energy = big(1e7); st.caps.water = big(1e7);
  st.resources.energy = big(1e6); st.resources.water = big(1e6); st.resources.biomass = big(1e6);
}

function insert(sim: Sim, type: MachineData['type'], x: number, z: number, size = 1) {
  const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  return m;
}

describe('upgrade effects in the city (City 14.4; E23.1.5: granted, never bought)', () => {
  it('Green Corridors reach further, Drone Mesh links hubs further apart, Fog Lanterns lower wake needs', () => {
    const sim = new Sim(createInitialState(4));
    rich(sim);
    sim.state.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    // Corridors: two street gardens 8 apart only link after an upgrade.
    const a = insert(sim, 'pollinator', 0, 30);
    const b = insert(sim, 'pollinator', 8, 30);
    for (const m of [a, b]) sim.grid.get(GROUND, m.x, m.z)!.feature = 'paving';
    expect(sim.chains.corridorNext(a)).not.toContain(b);
    expect(sim.upgrades.grant('corridorReach')).toBeGreaterThan(0);
    expect(sim.chains.corridorNext(a)).toContain(b);
    // Mesh: two hubs 15 apart join one network after an upgrade.
    const h1 = insert(sim, 'droneHub', 0, 50, 2);
    const h2 = insert(sim, 'droneHub', 17, 50, 2);
    expect(sim.drones.network(h1)).not.toContain(h2);
    expect(sim.upgrades.grant('droneMesh')).toBeGreaterThan(0);
    expect(sim.drones.network(h1)).toContain(h2);
    // Lanterns: the next area needs 10% fewer tiles.
    const id = sim.areas.nextGoal()!;
    const before = sim.areas.need(id);
    expect(sim.upgrades.grant('fogLantern')).toBeGreaterThan(0);
    // E21.9 / E23.1.1: a region wakes at half its restorable tiles; a Lantern level takes 10% off that
    expect(sim.areas.need(id)).toBe(Math.max(1, Math.ceil((sim.areas.counts(id).restorable / 2) * 0.9)));
    expect(sim.areas.need(id)).toBeLessThan(before);
  });
});
