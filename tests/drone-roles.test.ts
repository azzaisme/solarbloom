import { describe, expect, it } from 'vitest';
import { big, toNum } from '../src/core/Big';
import { placeFixed } from '../src/core/GameState';
import type { DroneData, TileData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { SaveService } from '../src/app/SaveService';
import type { RoleStrategy } from '../src/gameplay/DroneSystem';
import { Sim } from '../src/gameplay/Sim';
import { fill, makeSim, PAD, rich } from './helpers';

/**
 * E18.1 (#201): the drone role framework. No role but Restorer has behaviour yet (E18.2–E18.4 add them), so
 * these tests register small stand-in strategies to exercise refits, switching, reservations and offline.
 */

/** Grows the nearest growable tile, pays 2 water, no offline effect unless asked. Records what it worked. */
function stubRole(sim: Sim, opts: { offline?: boolean } = {}) {
  const worked: { drone: string; tile: string }[] = [];
  const strat: RoleStrategy = {
    find: (d, _hub, inRange) => {
      let best: TileData | undefined;
      let bestD = Infinity;
      for (const t of inRange) {
        if (!sim.drones.nurturable(t) || sim.drones.areaMode(t) === 'off') continue;
        const dd = (t.x + 0.5 - d.px) ** 2 + (t.z + 0.5 - d.pz) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = t;
        }
      }
      return best;
    },
    price: () => ({ water: 2 }),
    work: (d, t) => {
      worked.push({ drone: d.id, tile: t.id });
      sim.restoration.grow(t);
      return 'grown';
    },
  };
  if (opts.offline) strat.offline = (_d, t) => (sim.restoration.grow(t, undefined, 'auto', true), 'grown');
  return { strat, worked };
}

function setup() {
  const sim = makeSim();
  rich(sim);
  fill(sim, 0, 0, 7, 7, 'restored');
  const hub = sim.build.place('droneHub', PAD, 4, 4)!;
  sim.droneRoles.unlocked = () => true; // unlocks are tested on their own below
  return { sim, hub };
}

const res = (sim: Sim) => ({ e: toNum(sim.state.resources.energy), w: toNum(sim.state.resources.water), b: toNum(sim.state.resources.biomass) });

describe('E18.1: drone roles', () => {
  it('a hub starts as a Restorer and saves no role fields', () => {
    const { sim, hub } = setup();
    expect(sim.droneRoles.roleOf(hub)).toBe('restorer');
    expect(sim.droneRoles.owned(hub)).toEqual(['restorer']);
    expect('role' in hub || 'roles' in hub).toBe(false);
    sim.advance(10);
    for (const d of sim.state.drones) expect('role' in d).toBe(false);
  });

  it('a role without behaviour yet cannot be picked (nothing half-built reaches players)', () => {
    const { sim, hub } = setup();
    const before = res(sim);
    expect(sim.droneRoles.status(hub, 'gardener').reason).toBe('Coming soon');
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(false);
    expect(res(sim)).toEqual(before);
    expect(hub.role).toBeUndefined();
  });

  it('a refit charges its price once, all or nothing; switching between owned roles is free', () => {
    const { sim, hub } = setup();
    sim.drones.registerRole('gardener', stubRole(sim).strat);
    const price = sim.droneRoles.refitPrice('gardener', hub);
    expect(toNum(price.biomass!)).toBe(TUNING.drone.roles.refit.gardener.biomass);
    expect(toNum(price.water!)).toBe(TUNING.drone.roles.refit.gardener.water);
    const before = res(sim);
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(true);
    const after = res(sim);
    expect(before.b - after.b).toBe(60);
    expect(before.w - after.w).toBe(20);
    expect(before.e - after.e).toBe(0);
    expect(hub.role).toBe('gardener');
    expect(hub.roles).toEqual(['gardener']);
    // Back to Restorer and back again: free, and nothing is refunded.
    expect(sim.droneRoles.setRole(hub.id, 'restorer')).toBe(true);
    expect(hub.role).toBeUndefined();
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(true);
    expect(res(sim)).toEqual(after);
    expect(hub.roles).toEqual(['gardener']);
  });

  it('a refit it can’t afford changes nothing', () => {
    const { sim, hub } = setup();
    sim.drones.registerRole('gardener', stubRole(sim).strat);
    sim.state.resources.water = big(5); // biomass is there, water isn't
    const before = res(sim);
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(false);
    expect(res(sim)).toEqual(before);
    expect(hub.role).toBeUndefined();
    expect(hub.roles).toBeUndefined();
  });

  it('a stale button changes nothing: hub gone, not a hub, role already current, unknown role', () => {
    const { sim, hub } = setup();
    sim.drones.registerRole('gardener', stubRole(sim).strat);
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(true);
    const before = res(sim);
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(false); // already its role
    expect(sim.droneRoles.setRole('nope', 'gardener')).toBe(false);
    const solar = sim.state.machines.find((m) => m.type === 'solar')!;
    expect(sim.droneRoles.setRole(solar.id, 'gardener')).toBe(false);
    expect(sim.droneRoles.setRole(hub.id, 'bogus' as never)).toBe(false);
    expect(res(sim)).toEqual(before);
    expect(solar.role).toBeUndefined();
  });

  it('a locked role says why and can’t be bought', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    const hub = sim.build.place('droneHub', PAD, 4, 4)!;
    sim.drones.registerRole('courier', stubRole(sim).strat);
    const st = sim.droneRoles.status(hub, 'courier');
    expect(st.ok).toBe(false);
    expect(st.reason).toMatch(/Mother Tree|Relay/);
    expect(sim.droneRoles.setRole(hub.id, 'courier')).toBe(false);
    placeFixed(sim.state, PAD, 'motherTree', 0, 4, 1);
    expect(sim.droneRoles.unlocked('courier')).toBe(true);
  });

  it('unlocks follow progress (2.2)', () => {
    const sim = makeSim();
    expect(sim.droneRoles.unlocked('restorer')).toBe(true);
    for (const r of ['gardener', 'scout', 'courier', 'spark', 'harvester'] as const) expect(sim.droneRoles.unlocked(r)).toBe(false);
    for (let i = 0; i < TUNING.drone.roles.unlock.sparkGardens; i++) placeFixed(sim.state, PAD, 'pollinator', i, 6, 1);
    expect(sim.droneRoles.unlocked('spark')).toBe(true);
  });

  it('the biomass part grows ×1.5 per other hub refitted to the role; energy and water stay within 60% of the store', () => {
    const { sim, hub } = setup();
    sim.drones.registerRole('scout', stubRole(sim).strat);
    fill(sim, 0, 0, 7, 7, 'restored');
    const hub2 = sim.build.place('droneHub', PAD, 2, 5)!; // hubs are 2×2
    const hub3 = sim.build.place('droneHub', PAD, 6, 1)!;
    expect(toNum(sim.droneRoles.refitPrice('scout', hub2).biomass!)).toBe(60);
    expect(sim.droneRoles.setRole(hub.id, 'scout')).toBe(true);
    expect(toNum(sim.droneRoles.refitPrice('scout', hub2).biomass!)).toBe(90);
    expect(sim.droneRoles.setRole(hub2.id, 'scout')).toBe(true);
    expect(toNum(sim.droneRoles.refitPrice('scout', hub3).biomass!)).toBe(135);
    // A hub's own refit doesn't count against itself.
    expect(toNum(sim.droneRoles.refitPrice('scout', hub).biomass!)).toBe(90);
    // A tiny store: the energy part stops at 60% of it, never an impossible price.
    sim.state.caps.energy = big(20);
    expect(toNum(sim.droneRoles.refitPrice('scout', hub3).energy!)).toBe(12);
    expect(toNum(sim.droneRoles.refitPrice('scout', hub3).biomass!)).toBe(135);
  });

  it('every refit fits the starting stores (60% rule)', () => {
    const sim = new Sim((makeSim().state));
    for (const def of sim.droneRoles.defs()) {
      const p = sim.droneRoles.refitPrice(def.id);
      for (const k of ['energy', 'water'] as const) if (p[k] !== undefined) expect(toNum(p[k]!)).toBeLessThanOrEqual(toNum(sim.state.caps[k]) * TUNING.machineCostMaxShare);
    }
  });

  it('drones work and pay in their hub’s role; a switch mid-flight lets the paid job finish in its role', () => {
    const { sim, hub } = setup();
    const g = stubRole(sim);
    sim.drones.registerRole('gardener', g.strat);
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(true);
    const drone = sim.state.drones.find((d) => d.hubId === hub.id)!;
    for (let i = 0; i < 50 && drone.mode !== 'flying'; i++) sim.tick();
    expect(drone.mode).toBe('flying');
    expect(drone.role).toBe('gardener');
    const target = drone.targetTileId!;
    expect(sim.droneRoles.setRole(hub.id, 'restorer')).toBe(true);
    expect(sim.drones.roleOf(drone)).toBe('gardener'); // still the job it paid for
    for (let i = 0; i < 100 && drone.mode !== 'cooldown'; i++) sim.tick();
    expect(g.worked.some((w) => w.drone === drone.id && w.tile === target)).toBe(true);
    expect(drone.role).toBeUndefined();
    expect(sim.drones.roleOf(drone)).toBe('restorer');
    const n = g.worked.length;
    sim.advance(20);
    expect(g.worked.length).toBe(n); // the next jobs are a Restorer's
  });

  it('the running cost goes through payJob: the 25% reserve applies to every role', () => {
    const { sim, hub } = setup();
    sim.drones.registerRole('gardener', stubRole(sim).strat);
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(true);
    sim.state.resources.water = sim.state.caps.water.mul(TUNING.drone.reserve); // exactly at the reserve
    sim.advance(5);
    const drone = sim.state.drones.find((d) => d.hubId === hub.id)!;
    expect(sim.drones.statusOf(drone)).toBe('waitingEnergy');
    expect(toNum(sim.state.resources.water)).toBeGreaterThanOrEqual(toNum(sim.state.caps.water) * TUNING.drone.reserve - 1e-6);
  });

  it('a reload mid-flight keeps the drone’s role and target', () => {
    const { sim, hub } = setup();
    sim.drones.registerRole('gardener', stubRole(sim).strat);
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(true);
    const drone = sim.state.drones.find((d) => d.hubId === hub.id)!;
    for (let i = 0; i < 50 && drone.mode !== 'flying'; i++) sim.tick();
    const saver = new SaveService(undefined);
    saver.now = () => 0;
    const loaded = saver.deserialize(saver.serialize(sim.state))!;
    const sim2 = new Sim(loaded);
    const g2 = stubRole(sim2);
    sim2.drones.registerRole('gardener', g2.strat);
    const hub2 = sim2.machine(hub.id)!;
    const d2 = sim2.state.drones.find((d) => d.id === drone.id)!;
    expect(hub2.role).toBe('gardener');
    expect(hub2.roles).toEqual(['gardener']);
    expect(d2.role).toBe('gardener');
    expect(d2.targetTileId).toBe(drone.targetTileId);
    for (let i = 0; i < 100 && d2.mode !== 'cooldown'; i++) sim2.tick();
    expect(g2.worked.some((w) => w.drone === d2.id && w.tile === drone.targetTileId)).toBe(true);
  });

  it('no two drones of any role share a target', () => {
    const { sim, hub } = setup();
    sim.drones.registerRole('gardener', stubRole(sim).strat);
    for (let i = 0; i < 3; i++) sim.drones.spawn(hub);
    fill(sim, 0, 0, 7, 7, 'restored');
    const hub2 = sim.build.place('droneHub', PAD, 2, 5)!; // a Restorer next door, same tiles
    for (let i = 0; i < 3; i++) sim.drones.spawn(hub2);
    for (const t of sim.grid.tilesOf(PAD)) if (t.ground === 'restored') t.bloom = 1;
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(true);
    let checks = 0;
    for (let i = 0; i < 600; i++) {
      sim.tick();
      const targets = sim.state.drones.map((d) => d.targetTileId).filter(Boolean);
      expect(new Set(targets).size).toBe(targets.length);
      checks += targets.length;
    }
    expect(checks).toBeGreaterThan(100);
  });

  it('Drone Party drones copy their hub’s role', () => {
    const { sim, hub } = setup();
    sim.drones.registerRole('gardener', stubRole(sim).strat);
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(true);
    const temp: DroneData = sim.drones.spawn(hub, 30);
    expect(sim.drones.roleOf(temp)).toBe('gardener');
  });

  it('offline, only roles that work offline earn (2.7); Restorer offline is unchanged', () => {
    const run = (offline: boolean | 'restorer') => {
      const { sim, hub } = setup();
      for (const t of sim.grid.tilesOf(PAD)) if (t.ground === 'restored') t.bloom = 1;
      if (offline !== 'restorer') {
        sim.drones.registerRole('courier', stubRole(sim, { offline }).strat);
        expect(sim.droneRoles.setRole(hub.id, 'courier')).toBe(true);
      }
      return sim.offline.apply(600)!.droneJobs;
    };
    expect(run('restorer')).toBeGreaterThan(0);
    expect(run(true)).toBeGreaterThan(0);
    // The old drone still works offline (it's always a Restorer), but the hub's drone doesn't.
    expect(run(false)).toBeLessThan(run(true));
  });

  it('a merged hub owns every refit its parts had and keeps the anchor’s role', () => {
    const { sim, hub } = setup();
    sim.drones.registerRole('gardener', stubRole(sim).strat);
    sim.drones.registerRole('scout', stubRole(sim).strat);
    const b = sim.build.place('droneHub', PAD, 6, 4)!; // hubs are 2×2: three in a row, touching
    const c = sim.build.place('droneHub', PAD, 2, 4)!;
    expect(sim.droneRoles.setRole(hub.id, 'gardener')).toBe(true);
    expect(sim.droneRoles.setRole(b.id, 'scout')).toBe(true);
    const plan = sim.merge.plan(hub.id, [b.id, c.id]);
    expect(plan?.ok).toBe(true);
    const merged = sim.merge.commit(hub.id, plan!.partners.map((m) => m.id), plan!.key, plan!.fee);
    expect(merged!.role).toBe('gardener');
    expect([...(merged!.roles ?? [])].sort()).toEqual(['gardener', 'scout']);
  });
});
