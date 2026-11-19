import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { DroneRole, MachineData } from '../src/core/types';
import { DRONE_HUB, DRONE_SUPPLY } from '../src/data/drones';
import { Sim } from '../src/gameplay/Sim';

/**
 * E23.6.3 (#392): what drones run on. A hub with each role, on the real store (Biomass through a Storage chest beside
 * it) and the real water (a small pond in reach). Whether the grid powers the hub is stood in; the grid itself is
 * real, and reads the hub's draw from its drones.
 */
function hubSim() {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = 2;
  const grid = { on: true };
  Object.assign(sim.power, { isPowered: () => grid.on });
  const hub: MachineData = { id: 'hub1', type: 'droneHub', roofId: GROUND, x: 20, z: 20, size: 2 } as MachineData;
  const chest: MachineData = { id: 'chest1', type: 'chest', roofId: GROUND, x: 23, z: 20, size: 1 } as MachineData;
  sim.state.machines.push(hub, chest);
  // a small pond three tiles below the hub's middle (21, 21)
  for (let x = 19; x <= 22; x++) Object.assign(sim.grid.get(GROUND, x, 21 + DRONE_HUB.waterReach)!, { feature: 'water', ground: 'restored', occupantId: undefined });
  const pond = sim.water.bodyAt(sim.grid.get(GROUND, 20, 21 + DRONE_HUB.waterReach))!;
  sim.inventory.addToStore('biomass', 100);
  const drain = () => sim.water.draw(pond.id, sim.water.amountOf(pond.id));
  return { sim, hub, chest, grid, pond, drain };
}
const ROLES: DroneRole[] = ['restorer', 'gardener', 'scout', 'courier', 'harvester', 'spark'];

describe('E23.6.3: what drones run on', () => {
  it('each role draws power; Gardeners and Cultivators water; Restorers biomass; Scouts and Cultivators more power', () => {
    for (const r of [...ROLES, 'cultivator' as const]) expect(DRONE_SUPPLY[r].power, r).toBeGreaterThan(0);
    expect(DRONE_SUPPLY.restorer.biomass).toBeGreaterThan(0);
    expect(DRONE_SUPPLY.gardener.water).toBeGreaterThan(0);
    expect(DRONE_SUPPLY.cultivator.water).toBeGreaterThan(0);
    expect(DRONE_SUPPLY.scout.power).toBeGreaterThan(DRONE_SUPPLY.courier.power);
    expect(DRONE_SUPPLY.cultivator.power).toBeGreaterThan(DRONE_SUPPLY.courier.power);
    for (const r of ['scout', 'courier', 'harvester'] as const) {
      expect(DRONE_SUPPLY[r].water, r).toBeUndefined();
      expect(DRONE_SUPPLY[r].biomass, r).toBeUndefined();
    }
  });

  it('starving a hub of each input stops only the roles that need it, and supply restarts them', () => {
    const { sim, hub, grid, pond, drain } = hubSim();
    const f = sim.droneFuel;
    const stopped = () => ROLES.filter((r) => f.short(hub, r));
    expect(stopped()).toEqual([]);
    // the pond runs dry: only the Gardener stops; rain (here, a fill) brings it back
    drain();
    expect(stopped()).toEqual(['gardener']);
    sim.water.fill(pond.id, 50);
    expect(stopped()).toEqual([]);
    // the store runs out of Biomass: only the Restorer stops
    sim.inventory.takeFromStore('biomass', 100);
    expect(stopped()).toEqual(['restorer']);
    sim.inventory.addToStore('biomass', 100);
    // the grid goes: every role stops
    grid.on = false;
    expect(stopped()).toEqual(ROLES);
    grid.on = true;
    expect(stopped()).toEqual([]);
  });

  it('water roles need water within reach of the hub', () => {
    const { sim, hub } = hubSim();
    const far: MachineData = { ...hub, id: 'hub2', z: 10 };
    sim.state.machines.push(far);
    expect(sim.droneFuel.short(far, 'gardener')).toBe('water');
    expect(sim.droneFuel.short(far, 'scout')).toBeUndefined();
  });

  it('biomass roles need a Storage chest beside the hub', () => {
    const { sim, hub, chest } = hubSim();
    sim.state.machines = sim.state.machines.filter((m) => m !== chest);
    expect(sim.droneFuel.short(hub, 'restorer')).toBe('biomass');
    expect(sim.droneFuel.short(hub, 'courier')).toBeUndefined();
  });

  it('a job takes its water from the pond and its Biomass from the store; nothing is taken when short', () => {
    const { sim, hub, pond, drain } = hubSim();
    const full = sim.water.amountOf(pond.id);
    expect(sim.droneFuel.take(hub, 'gardener')).toBe(true);
    expect(sim.water.amountOf(pond.id)).toBeCloseTo(full - DRONE_SUPPLY.gardener.water!, 6);
    expect(sim.droneFuel.take(hub, 'restorer')).toBe(true);
    expect(sim.inventory.stored('biomass')).toBe(100 - DRONE_SUPPLY.restorer.biomass!);
    drain();
    expect(sim.droneFuel.take(hub, 'gardener')).toBe(false);
    sim.inventory.takeFromStore('biomass', sim.inventory.stored('biomass'));
    expect(sim.droneFuel.take(hub, 'restorer')).toBe(false);
    expect(sim.water.amountOf(pond.id)).toBe(0);
  });

  it('short of supply, drones finish their job, dock and wait, then start again by themselves', () => {
    const { sim, hub, grid } = hubSim();
    sim.state.drones = [];
    sim.advance(1); // the hub spawns its drones
    const mine = () => sim.state.drones.filter((d) => d.hubId === hub.id);
    expect(mine().length).toBeGreaterThan(0);
    // a Restorer hub with no Biomass left in the store
    sim.inventory.takeFromStore('biomass', sim.inventory.stored('biomass'));
    sim.advance(30);
    for (const d of mine()) {
      expect(['idle', 'returning', 'cooldown'], d.mode).toContain(d.mode);
      expect(sim.drones.statusOf(d)).toBe('docked');
    }
    sim.inventory.addToStore('biomass', 100);
    sim.advance(10);
    for (const d of mine()) expect(sim.drones.statusOf(d)).not.toBe('docked');
    // the grid goes: they come home and wait for power (E23.3.3), then go again
    grid.on = false;
    sim.advance(30);
    for (const d of mine()) expect(['idle', 'returning', 'cooldown'], d.mode).toContain(d.mode);
    grid.on = true;
    sim.advance(10);
    for (const d of mine()) expect(sim.drones.statusOf(d)).not.toBe('waitingEnergy');
  });

  it('the grid reads a hub\'s draw from its drones\' roles (a Scout hub draws more)', () => {
    const { sim, hub } = hubSim();
    expect(sim.power.draw(hub)).toBe(0);
    sim.state.drones.push({ id: 'd1', hubId: hub.id, mode: 'idle', px: 20, pz: 20, timer: 0 } as never);
    expect(sim.power.draw(hub)).toBe(DRONE_SUPPLY.restorer.power);
    sim.state.drones.push({ id: 'd2', hubId: hub.id, role: 'scout', mode: 'flying', px: 20, pz: 20, timer: 0 } as never);
    expect(sim.power.draw(hub)).toBe(DRONE_SUPPLY.restorer.power + DRONE_SUPPLY.scout.power);
  });

  it('Lighter drones (research) is offered with drones and makes every role draw less from its hub', () => {
    const { sim, hub } = hubSim();
    expect(sim.droneFuel.supply('gardener')).toEqual(DRONE_SUPPLY.gardener);
    expect(sim.research.upgradeDef('droneThrift')?.needs).toBe('drones');
    sim.state.salvage!.research = { analysed: [], done: [], running: [], levels: { droneThrift: 3 } };
    const g = sim.droneFuel.supply('gardener');
    expect(g.power).toBeCloseTo(DRONE_SUPPLY.gardener.power * 0.55, 6);
    expect(g.water).toBe(1);
    expect(sim.droneFuel.supply('restorer').biomass).toBe(1);
    sim.state.drones.push({ id: 'd1', hubId: hub.id, mode: 'idle', px: 20, pz: 20, timer: 0 } as never);
    expect(sim.power.draw(hub)).toBeCloseTo(DRONE_SUPPLY.restorer.power * 0.55, 6);
  });
});
