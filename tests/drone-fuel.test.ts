import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { DroneData, DroneRole, MachineData } from '../src/core/types';
import { DRONE_HUB, DRONE_SUPPLY } from '../src/data/drones';
import { Sim } from '../src/gameplay/Sim';

/**
 * E23.6.3 (#392): what drones run on. A hub with each role, on the real store (Biomass through a Storage chest beside
 * it) and the real water (a small pond in reach). Whether the grid powers the hub, and has room for one more drone
 * at work, is stood in (tests/power-helpers puts hubs on a real grid of panels); the grid itself is real, and reads
 * the hub's draw from its drones.
 */
function hubSim() {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = 2;
  const grid = { on: true };
  Object.assign(sim.power, { isPowered: () => grid.on, headroom: () => (grid.on ? Infinity : 0) });
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
    // with jobs all round (young lawn to nurture), they still go all the way home and wait there (never hover part way)
    sim.areas.clear(sim.areas.areaOf(hub)!, true); // helpers may work there
    for (let x = 16; x < 27; x++)
      for (let z = 16; z < 27; z++) {
        const t = sim.grid.get(GROUND, x, z);
        if (t && !t.occupantId && t.feature !== 'water' && !t.blocked) Object.assign(t, { ground: 'restored', bloom: 0.2, pollution: 0 });
      }
    expect(sim.drones.findJob(mine()[0])).toBeTruthy();
    // send them out to a job, then run the store dry under them
    sim.inventory.addToStore('biomass', 100);
    const home = (d: { px: number; pz: number }) => Math.hypot(d.px - (hub.x + hub.size / 2), d.pz - (hub.z + hub.size / 2));
    for (let t = 0; t < 30 && !mine().some((d) => home(d) > 2); t += 0.25) sim.advance(0.25);
    expect(mine().some((d) => home(d) > 2)).toBe(true);
    sim.inventory.takeFromStore('biomass', sim.inventory.stored('biomass'));
    let strayIdle = 0;
    for (let t = 0; t < 30; t += 0.25) {
      sim.advance(0.25);
      for (const d of mine()) if (sim.drones.statusOf(d) === 'docked' && d.mode === 'idle' && home(d) > 0.06) strayIdle++;
    }
    expect(strayIdle).toBe(0);
    for (const d of mine()) {
      expect(d.mode).toBe('idle');
      expect(Math.hypot(d.px - (hub.x + hub.size / 2), d.pz - (hub.z + hub.size / 2)), d.id).toBeLessThan(0.06);
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

  it('the grid reads a hub\'s draw from its drones at work only (a Scout draws more; napping or docked, nothing)', () => {
    const { sim, hub } = hubSim();
    expect(sim.power.draw(hub)).toBe(0);
    const d1 = { id: 'd1', hubId: hub.id, mode: 'idle', px: 20, pz: 20, timer: 0 } as DroneData;
    sim.state.drones.push(d1);
    expect(sim.power.draw(hub)).toBe(0); // napping or docked at home
    d1.mode = 'cooldown';
    expect(sim.power.draw(hub)).toBe(0);
    for (const mode of ['flying', 'working', 'returning'] as const) {
      d1.mode = mode;
      expect(sim.power.draw(hub), mode).toBe(DRONE_SUPPLY.restorer.power);
    }
    sim.state.drones.push({ id: 'd2', hubId: hub.id, role: 'scout', mode: 'flying', px: 20, pz: 20, timer: 0 } as never);
    sim.state.drones.push({ id: 'd3', hubId: hub.id, role: 'scout', mode: 'idle', px: 20, pz: 20, timer: 0 } as never);
    expect(sim.power.draw(hub)).toBe(DRONE_SUPPLY.restorer.power + DRONE_SUPPLY.scout.power);
  });

  it('a hub draws from the best water in reach that still has a job\'s worth, not the nearest', () => {
    const { sim, hub, pond, drain } = hubSim();
    // a second pond along the hub's west edge of reach (its own body)
    const wx = 21 - DRONE_HUB.waterReach;
    for (let z = 19; z <= 22; z++) Object.assign(sim.grid.get(GROUND, wx, z)!, { feature: 'water', ground: 'restored', occupantId: undefined });
    const west = sim.water.bodyAt(sim.grid.get(GROUND, wx, 20))!;
    expect(west.id).not.toBe(pond.id);
    const w = sim.water;
    // the south pond dry: the job draws from the west one, so the hub works on
    drain();
    w.draw(west.id, w.amountOf(west.id));
    w.fill(west.id, 20);
    expect(sim.droneFuel.short(hub, 'gardener')).toBeUndefined();
    expect(sim.droneFuel.take(hub, 'gardener')).toBe(true);
    expect(w.amountOf(west.id)).toBeCloseTo(20 - DRONE_SUPPLY.gardener.water!, 6);
    expect(w.amountOf(pond.id)).toBe(0);
    // both holding water: the fuller is drawn, whichever is nearer
    w.fill(pond.id, 30);
    const south = w.amountOf(pond.id);
    const westNow = w.amountOf(west.id);
    expect(south).toBeGreaterThan(westNow);
    expect(sim.droneFuel.take(hub, 'gardener')).toBe(true);
    expect(w.amountOf(pond.id)).toBeCloseTo(south - DRONE_SUPPLY.gardener.water!, 6);
    expect(w.amountOf(west.id)).toBeCloseTo(westNow, 6);
    // less than a job's worth in each: the Gardener docks, and nothing is taken
    w.draw(pond.id, w.amountOf(pond.id) - 1);
    w.draw(west.id, w.amountOf(west.id) - 1);
    expect(sim.droneFuel.short(hub, 'gardener')).toBe('water');
    expect(sim.droneFuel.take(hub, 'gardener')).toBe(false);
    expect(w.amountOf(pond.id)).toBeCloseTo(1, 6);
    expect(w.amountOf(west.id)).toBeCloseTo(1, 6);
  });

  it('Lighter drones (research) is offered with drones and makes every role draw less from its hub', () => {
    const { sim, hub } = hubSim();
    expect(sim.droneFuel.supply('gardener')).toEqual(DRONE_SUPPLY.gardener);
    expect(sim.research.upgradeDef('droneThrift')?.needs).toBe('drones');
    sim.state.salvage!.research = { analysed: [], done: [], running: [], levels: { droneThrift: 3 } };
    const g = sim.droneFuel.supply('gardener');
    expect(g.power).toBeCloseTo(DRONE_SUPPLY.gardener.power * 0.55, 6);
    expect(g.water).toBeCloseTo(DRONE_SUPPLY.gardener.water! * 0.55, 6);
    expect(sim.droneFuel.supply('restorer').biomass).toBeCloseTo(DRONE_SUPPLY.restorer.biomass! * 0.55, 6);
    sim.state.drones.push({ id: 'd1', hubId: hub.id, mode: 'working', px: 20, pz: 20, timer: 0 } as never);
    expect(sim.power.draw(hub)).toBeCloseTo(DRONE_SUPPLY.restorer.power * 0.55, 6);
  });

  // Every level saves something real on each fuel: 20 jobs take 20 x the cut share, never rounded back up per job.
  for (const level of [0, 1, 2, 3]) {
    const k = 1 - 0.15 * level;
    const bio = Math.round(20 * DRONE_SUPPLY.restorer.biomass! * k);
    const water = +(20 * DRONE_SUPPLY.gardener.water! * k).toFixed(3);
    it(`Lighter drones level ${level}: 20 jobs take ${bio} Biomass, ${water} water, and a drone at work draws ${+(DRONE_SUPPLY.restorer.power * k).toFixed(2)} W`, () => {
      const { sim, hub, pond } = hubSim();
      sim.state.salvage!.research = { analysed: [], done: [], running: [], levels: level ? { droneThrift: level } : {} };
      const f = sim.droneFuel;
      // Biomass: whole items from the store; the part paid ahead stays on the hub
      const before = sim.inventory.stored('biomass');
      for (let i = 0; i < 20; i++) expect(f.take(hub, 'restorer'), `job ${i}`).toBe(true);
      expect(before - sim.inventory.stored('biomass')).toBe(bio);
      // water: drawn in fractions
      sim.water.fill(pond.id, 100);
      const full = sim.water.amountOf(pond.id);
      for (let i = 0; i < 20; i++) expect(f.take(hub, 'gardener'), `job ${i}`).toBe(true);
      expect(full - sim.water.amountOf(pond.id)).toBeCloseTo(20 * DRONE_SUPPLY.gardener.water! * k, 6);
      // power: each drone at work draws its cut share
      sim.state.drones = [{ id: 'd1', hubId: hub.id, mode: 'working', px: 20, pz: 20, timer: 0 } as DroneData];
      expect(sim.power.draw(hub)).toBeCloseTo(DRONE_SUPPLY.restorer.power * k, 6);
      if (level) expect(bio).toBeLessThan(20 * DRONE_SUPPLY.restorer.biomass!);
    });
  }

  it('paid ahead: under one Biomass a job, a hub pays a whole one only when its credit runs out', () => {
    const { sim, hub } = hubSim();
    sim.state.salvage!.research = { analysed: [], done: [], running: [], levels: { droneThrift: 2 } }; // 0.7 a job
    sim.inventory.takeFromStore('biomass', sim.inventory.stored('biomass'));
    sim.inventory.addToStore('biomass', 1);
    expect(sim.droneFuel.take(hub, 'restorer')).toBe(true); // pays 1: 0.3 ahead
    expect(sim.inventory.stored('biomass')).toBe(0);
    expect(hub.fuelCredit).toBeCloseTo(0.3, 6);
    // 0.3 ahead is not a job's worth: with an empty store it docks, and takes nothing
    expect(sim.droneFuel.short(hub, 'restorer')).toBe('biomass');
    expect(sim.droneFuel.take(hub, 'restorer')).toBe(false);
    expect(hub.fuelCredit).toBeCloseTo(0.3, 6);
    sim.inventory.addToStore('biomass', 1);
    expect(sim.droneFuel.take(hub, 'restorer')).toBe(true); // pays 1: 1.3 - 0.7 = 0.6 ahead
    expect(hub.fuelCredit).toBeCloseTo(0.6, 6);
    expect(sim.droneFuel.biomassDue(hub, 'restorer')).toBe(1);
  });
});
