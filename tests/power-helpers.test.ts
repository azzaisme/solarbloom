import { big } from '../src/core/Big';
import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { POWER } from '../src/data/power';
import { Sim } from '../src/gameplay/Sim';

function put(sim: Sim, type: MachineData['type'], x: number, z: number, size = 1): MachineData {
  for (let dz = 0; dz < size; dz++)
    for (let dx = 0; dx < size; dx++) {
      const t = sim.grid.get(GROUND, x + dx, z + dz)!;
      t.ground = 'restored';
      t.blocked = false;
    }
  const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  for (const t of sim.grid.footprint(GROUND, x, z, size)) if (t) t.occupantId = m.id;
  sim.grid.indexMachine(m);
  return m;
}

function oldCity() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.state.salvage!.tier = 2;
  sim.state.resources.energy = big(1e6);
  return sim;
}

/** A stand-in for E23.2.1's `sim.charge`. */
function fakeCharge(sim: Sim, value = 20, max = 100) {
  const c = {
    value,
    max,
    got: 0,
    get share() {
      return c.value / c.max;
    },
    recharge(n: number, source: string) {
      expect(source).toBe('charger');
      c.got += n;
      c.value = Math.min(c.max, c.value + n);
    },
  };
  (sim as unknown as { charge: typeof c }).charge = c;
  return c;
}

describe('E23.3.3 chargers', () => {
  it('bloombot on a powered charger refills fast; off it, or with no power, nothing', () => {
    const sim = oldCity();
    const c = fakeCharge(sim);
    const pad = put(sim, 'charger', 30, 30);
    sim.bot = { roofId: GROUND, x: 31.5, z: 31.5 }; // next to it, not on it
    sim.advance(2);
    expect(c.got).toBe(0);
    sim.bot = { roofId: GROUND, x: 30.5, z: 30.5 };
    expect(sim.chargers.docked()).toBe(pad);
    sim.advance(2);
    expect(c.got).toBe(0); // no power: a lone pad
    expect(sim.power.isPowered(pad)).toBe(false);
    put(sim, 'solar', 31, 30);
    put(sim, 'solar', 29, 30);
    sim.advance(2);
    expect(c.got).toBeCloseTo(POWER.charger.rate * 2, 1);
    expect(sim.power.networkOf(pad)!.served).toBe(POWER.draw.charger);
  });

  it('draws nothing while nobody sits on it, or once bloombot is full', () => {
    const sim = oldCity();
    const c = fakeCharge(sim, 99);
    const pad = put(sim, 'charger', 30, 30);
    put(sim, 'solar', 31, 30);
    put(sim, 'solar', 29, 30);
    sim.advance(1);
    expect(sim.power.networkOf(pad)!.demand).toBe(0);
    sim.bot = { roofId: GROUND, x: 30.5, z: 30.5 };
    sim.advance(1);
    expect(c.value).toBe(100);
    sim.advance(1);
    expect(sim.power.networkOf(pad)!.demand).toBe(0);
  });

  it('is shed last: on a short grid the drone hub goes dark before the charger', () => {
    const sim = oldCity();
    fakeCharge(sim);
    const pad = put(sim, 'charger', 30, 30);
    const hub = put(sim, 'droneHub', 31, 30, 2);
    put(sim, 'solar', 29, 30);
    put(sim, 'solar', 29, 31); // 8 W: the charger (6) fits, the hub (4) does not
    sim.bot = { roofId: GROUND, x: 30.5, z: 30.5 };
    sim.advance(1);
    expect(sim.power.isPowered(pad)).toBe(true);
    expect(sim.power.isPowered(hub)).toBe(false);
    // bloombot steps off: the charger idles and the hub comes back by itself
    sim.bot = { roofId: GROUND, x: 40.5, z: 40.5 };
    sim.advance(1);
    expect(sim.power.isPowered(hub)).toBe(true);
  });
});

describe('E23.3.3 powered helpers', () => {
  it('a drone hub off the grid sends nobody out and says it is waiting for power', () => {
    const sim = oldCity();
    sim.areas.helpersMayWork = () => true;
    const hub = put(sim, 'droneHub', 30, 30, 2);
    sim.drones.spawn(hub);
    sim.advance(20);
    const mine = sim.state.drones.filter((d) => d.hubId === hub.id);
    expect(mine.length).toBeGreaterThan(0);
    for (const d of mine) {
      expect(['idle', 'returning']).toContain(d.mode);
      expect(sim.drones.statusOf(d)).toBe('waitingEnergy');
    }
  });

  it('helpers stay unpowered-proof in the classic game (no grid there)', () => {
    const sim = new Sim(createInitialState(7));
    const hub = put(sim, 'droneHub', 30, 30, 2);
    expect(sim.power.isPowered(hub)).toBe(true);
  });

  it('a Cultivator off the grid parks its tillers on the dock', () => {
    const sim = oldCity();
    sim.areas.helpersMayWork = () => true;
    const dock = put(sim, 'cultivator', 30, 30);
    sim.advance(10);
    expect(sim.power.isPowered(dock)).toBe(false);
    for (const u of dock.cult?.units ?? []) {
      expect(u.parked).toBe(true);
      expect(Math.hypot(u.px - 30.5, u.pz - 30.5)).toBeLessThan(0.1);
    }
  });
});
