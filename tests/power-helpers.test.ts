import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { CHARGE } from '../src/data/charge';
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
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = 2;
  // Clear noon: these tests are about chargers and helpers, not E23.7's sky (a new game starts at 07:30, when
  // panels are still waking up).
  sim.power.skyOverride = () => ({ sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 });
  return sim;
}

/**
 * E23.2.1's real charge meter (`sim.charge`), set to a level. `got()` is what has come back since: nothing else
 * recharges here (no meal, and these pads are far from home's trickle), which the first test checks.
 */
function charge(sim: Sim, value = 20) {
  sim.state.charge = { value };
  const sources: string[] = [];
  sim.bus.on('charge.full', (e: { source: string }) => sources.push(e.source));
  return {
    get value() {
      return sim.charge.value();
    },
    max: sim.charge.max,
    got: () => sim.charge.value() - value,
    sources,
  };
}

describe('E23.3.3 chargers', () => {
  it('bloombot on a powered charger refills fast; off it, or with no power, nothing', () => {
    const sim = oldCity();
    const c = charge(sim);
    const pad = put(sim, 'charger', 30, 30);
    sim.bot = { roofId: GROUND, x: 32.5, z: 32.5 }; // a step away from it
    sim.advance(2);
    expect(c.got()).toBe(0);
    sim.bot = { roofId: GROUND, x: 30.5, z: 31.5 }; // sitting at the pad's edge (its tile can't be walked onto)
    expect(sim.chargers.docked()).toBe(pad);
    sim.advance(2);
    expect(c.got()).toBe(0); // no power: a lone pad
    expect(sim.power.isPowered(pad)).toBe(false);
    put(sim, 'solar', 31, 30);
    put(sim, 'solar', 29, 30);
    sim.advance(2);
    expect(c.got()).toBeCloseTo(POWER.charger.rate * 2, 1);
    expect(POWER.charger.rate).toBe(CHARGE.meditatePerSecond);
    expect(sim.power.networkOf(pad)!.served).toBe(POWER.draw.charger);
  });

  it('draws nothing while nobody sits on it, or once bloombot is full', () => {
    const sim = oldCity();
    const c = charge(sim, sim.charge.max - 1);
    const pad = put(sim, 'charger', 30, 30);
    put(sim, 'solar', 31, 30);
    put(sim, 'solar', 29, 30);
    sim.advance(1);
    expect(sim.power.networkOf(pad)!.demand).toBe(0);
    sim.bot = { roofId: GROUND, x: 30.5, z: 30.5 };
    sim.advance(1);
    expect(c.value).toBe(c.max);
    expect(c.sources).toEqual(['charger']); // the real meter says where the fill came from
    sim.advance(1);
    expect(sim.power.networkOf(pad)!.demand).toBe(0);
  });

  it('is shed last: on a short grid the drone hub goes dark before the charger', () => {
    const sim = oldCity();
    charge(sim);
    const pad = put(sim, 'charger', 30, 30);
    const hub = put(sim, 'droneHub', 31, 30, 2);
    hub.role = 'scout'; // E23.6.3: a hub draws by its drones' roles; a Scout's is the most (4 W)
    (hub.roles ??= []).push('scout');
    put(sim, 'solar', 29, 30);
    put(sim, 'solar', 29, 31); // 8 W: the charger (6) fits, the Scout hub (4) does not
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
  it('extending poles into a new region lets bloombot recharge there and switches its helpers on', () => {
    const sim = oldCity();
    const c = charge(sim);
    // home: panels and a pole
    put(sim, 'solar', 0, 0);
    put(sim, 'solar', 1, 0);
    put(sim, 'solar', 2, 0);
    put(sim, 'relay', 3, 2);
    // far away: a pad and a drone hub, off the grid
    const pad = put(sim, 'charger', 50, 2);
    const hub = put(sim, 'droneHub', 51, 3, 2);
    sim.bot = { roofId: GROUND, x: 49.5, z: 2.5 };
    sim.advance(1);
    expect(sim.power.isPowered(pad)).toBe(false);
    expect(sim.power.isPowered(hub)).toBe(false);
    expect(c.got()).toBe(0);
    // a line of poles out to them
    const step = Math.floor(sim.relays.range());
    for (let x = 3 + step; x < 50; x += step) put(sim, 'relay', x, 2);
    put(sim, 'relay', 49, 4);
    sim.advance(1);
    expect(sim.power.networkOf(pad)).toBe(sim.power.networkOf(hub));
    expect(sim.power.isPowered(pad)).toBe(true);
    expect(sim.power.isPowered(hub)).toBe(true);
    expect(c.got()).toBeGreaterThan(0);
  });

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

  it('a Cultivator off the grid parks its tillers on the dock', () => {
    const sim = oldCity();
    sim.areas.helpersMayWork = () => true;
    const dock = put(sim, 'cultivator', 30, 30);
    sim.advance(10);
    expect(sim.power.isPowered(dock)).toBe(false);
    const units = dock.cult?.units ?? [];
    expect(units.length).toBeGreaterThan(0); // the loop below must check real tillers
    for (const u of units) {
      expect(u.parked).toBe(true);
      expect(Math.hypot(u.px - 30.5, u.pz - 30.5)).toBeLessThan(0.1);
    }
  });
});
