import { describe, expect, it } from 'vitest';
import { big } from '../src/core/Big';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { DroneRole, MachineData, TileData } from '../src/core/types';
import { DRONE_SUPPLY } from '../src/data/drones';
import { Sim } from '../src/gameplay/Sim';

/**
 * E23.6.3 (#392): what drones run on. A hub with each role, fed by a stand-in grid and water (E23.3 and E23.4 plug
 * in through `sim.power` and `sim.water`), and a Storage chest beside it for biomass.
 */
function hubSim() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.state.salvage!.tier = 2;
  const grid = { on: true, isPowered: () => grid.on };
  const water = { on: true, drawn: 0, isWatered: () => water.on, drawNear: (_t: TileData, n: number) => (water.on ? ((water.drawn += n), n) : 0) };
  Object.assign(sim, { power: grid, water });
  const hub: MachineData = { id: 'hub1', type: 'droneHub', roofId: GROUND, x: 20, z: 20, size: 2 } as MachineData;
  const chest: MachineData = { id: 'chest1', type: 'chest', roofId: GROUND, x: 23, z: 20, size: 1 } as MachineData;
  sim.state.machines.push(hub, chest);
  sim.state.resources.biomass = big(100);
  return { sim, hub, chest, grid, water };
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

  it('starving a hub of each input stops only the roles that need it', () => {
    const { sim, hub, grid, water } = hubSim();
    const f = sim.droneFuel;
    const stopped = () => ROLES.filter((r) => f.short(hub, r));
    expect(stopped()).toEqual([]);
    water.on = false;
    expect(stopped()).toEqual(['gardener']);
    water.on = true;
    sim.state.resources.biomass = big(0);
    expect(stopped()).toEqual(['restorer']);
    sim.state.resources.biomass = big(100);
    grid.on = false;
    expect(stopped()).toEqual(ROLES);
    grid.on = true;
    expect(stopped()).toEqual([]);
  });

  it('biomass roles need a Storage chest beside the hub', () => {
    const { sim, hub, chest } = hubSim();
    sim.state.machines = sim.state.machines.filter((m) => m !== chest);
    expect(sim.droneFuel.short(hub, 'restorer')).toBe('biomass');
    expect(sim.droneFuel.short(hub, 'courier')).toBeUndefined();
  });

  it('a job takes its water and biomass; nothing is taken when short', () => {
    const { sim, hub, water } = hubSim();
    expect(sim.droneFuel.take(hub, 'gardener')).toBe(true);
    expect(water.drawn).toBe(DRONE_SUPPLY.gardener.water);
    expect(sim.droneFuel.take(hub, 'restorer')).toBe(true);
    expect(sim.econ.get('biomass').toNumber()).toBe(100 - DRONE_SUPPLY.restorer.biomass!);
    water.on = false;
    expect(sim.droneFuel.take(hub, 'gardener')).toBe(false);
    expect(water.drawn).toBe(DRONE_SUPPLY.gardener.water);
  });

  it('short of supply, drones finish their job, dock and wait, then start again by themselves', () => {
    const { sim, hub, grid } = hubSim();
    sim.state.drones = [];
    sim.advance(1); // the hub spawns its drones
    const mine = () => sim.state.drones.filter((d) => d.hubId === hub.id);
    expect(mine().length).toBeGreaterThan(0);
    grid.on = false;
    sim.advance(30);
    for (const d of mine()) {
      expect(['idle', 'returning', 'cooldown'], d.mode).toContain(d.mode);
      expect(sim.drones.statusOf(d)).toBe('docked');
    }
    grid.on = true;
    sim.advance(10);
    for (const d of mine()) expect(sim.drones.statusOf(d)).not.toBe('docked');
  });

  it('a hub draws power for each drone out on a job', () => {
    const { sim, hub } = hubSim();
    expect(sim.droneFuel.draw(hub)).toBe(0);
    sim.state.drones.push({ id: 'd1', hubId: hub.id, mode: 'flying', px: 20, pz: 20, timer: 0 } as never);
    expect(sim.droneFuel.draw(hub)).toBe(DRONE_SUPPLY.restorer.power);
  });
});
