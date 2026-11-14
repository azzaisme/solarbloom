import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { UPGRADE_GROUPS } from '../src/data/upgrades';
import { Sim } from '../src/gameplay/Sim';

function rich(sim: Sim) {
  const st = sim.state;
  st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
  st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
}

function insert(sim: Sim, type: MachineData['type'], x: number, z: number, size = 1) {
  const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  return m;
}

/** What the drawer shows: section, card text and lock reason, for each upgrade. */
function drawer(sim: Sim) {
  return sim.upgrades.grouped().map((g) => ({
    group: g.group,
    cards: g.upgrades.map((d) => {
      const st = sim.upgrades.status(d);
      return `${d.icon} ${d.name}: ${d.describe(sim.upgrades.level(d.id) + 1)}${st.ok || !d.lockedReason || st.reason !== d.lockedReason ? '' : ` [locked: ${st.reason}]`}`;
    }),
  }));
}

describe('upgrades drawer grouped by system (City 14.4)', () => {
  it('the city drawer: Pulse, Machines, Drones, Networks, Fog, Storage; no rooftop-only cards', () => {
    const sim = new Sim(createInitialState(3));
    rich(sim);
    const d = drawer(sim);
    expect(d.map((g) => g.group)).toEqual(['Pulse', 'Machines', 'Drones', 'Networks', 'Fog', 'Storage']);
    expect(d).toMatchSnapshot();
  });

  it('every card says what it changes, and every locked card says exactly what unlocks it', () => {
    {
      const sim = new Sim(createInitialState(5));
      rich(sim);
      for (const d of sim.upgrades.all()) {
        expect(UPGRADE_GROUPS).toContain(d.group);
        for (let n = 1; n <= d.maxLevel; n++) expect(d.describe(n).length, d.id).toBeGreaterThan(12);
        const st = sim.upgrades.status(d);
        if (!st.ok && d.available && !d.available(sim.state)) {
          expect(st.reason, d.id).toBe(d.lockedReason);
          expect(st.reason, d.id).toMatch(/^(Build|Plant|Wake)/);
        }
      }
    }
  });

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
    expect(sim.upgrades.purchase('corridorReach')).toBe(true);
    expect(sim.chains.corridorNext(a)).toContain(b);
    // Mesh: two hubs 15 apart join one network after an upgrade.
    const h1 = insert(sim, 'droneHub', 0, 50, 2);
    const h2 = insert(sim, 'droneHub', 17, 50, 2);
    expect(sim.drones.network(h1)).not.toContain(h2);
    expect(sim.upgrades.purchase('droneMesh')).toBe(true);
    expect(sim.drones.network(h1)).toContain(h2);
    // Lanterns: the next area needs 10% fewer tiles.
    const id = sim.areas.nextGoal()!;
    const before = sim.areas.need(id);
    expect(sim.upgrades.purchase('fogLantern')).toBe(true);
    expect(sim.areas.need(id)).toBe(Math.ceil(Math.min(sim.areas.counts(id).restorable * TUNING.city.clearShare, TUNING.city.clearCap * sim.areas.info(id).difficulty) * 0.9));
    expect(sim.areas.need(id)).toBeLessThan(before);
  });
});
