import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { DroneRole, MachineData, TileData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { offGrid, openIsland } from './helpers';

/** E18.1–E18.4 and E18.6 (#201–#204, #206): drone roles. */

function city(seed = 6) {
  const sim = new Sim(createInitialState(seed));
  sim.state.progression.coreActivated = true;
  // E23.1.1: the island open (the park, Saltwind and every region beyond), so helpers may work anywhere near home
  return openIsland(sim);
}

function put(sim: Sim, type: MachineData['type'], x: number, z: number, size = type === 'droneHub' || type === 'motherTree' ? 2 : 1): MachineData {
  const cells = sim.grid.footprint(GROUND, x, z, size);
  for (const c of cells) {
    c!.blocked = false;
    c!.ground = 'restored';
    c!.bloom = 3;
  }
  const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 };
  sim.state.machines.push(m);
  sim.grid.indexMachine(m);
  for (const c of cells) c!.occupantId = m.id;
  if (type === 'droneHub') sim.drones.spawn(m);
  return m;
}

/** A hub that already owns and uses a role (behaviour tests; refits are tested on their own). */
function roleHub(sim: Sim, x: number, z: number, role: DroneRole): MachineData {
  const h = put(sim, 'droneHub', x, z);
  if (role !== 'restorer') {
    h.roles = [role];
    h.role = role;
  }
  return h;
}

function box(sim: Sim, x0: number, z0: number, x1: number, z1: number, f: (t: TileData) => void) {
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const t = sim.grid.get(GROUND, x, z);
      if (!t || t.blocked || t.occupantId) continue;
      f(t);
      sim.grid.touch(t);
    }
}
const green = (bloom: number) => (t: TileData) => {
  t.ground = 'restored';
  t.bloom = bloom;
  t.pollution = 0;
};
const grey = (t: TileData) => {
  t.ground = 'polluted';
  t.bloom = 0;
  t.pollution = 60;
};

/** No two drones share a tile or machine target, checked every tick. */
function watchReservations(sim: Sim) {
  const clash: string[] = [];
  const tick = sim.tick.bind(sim);
  sim.tick = (dt?: number) => {
    tick(dt);
    const tiles = sim.state.drones.map((d) => d.targetTileId).filter(Boolean);
    const machines = sim.state.drones.map((d) => d.targetMachineId).filter(Boolean);
    if (new Set(tiles).size !== tiles.length) clash.push(`tile at ${sim.time.toFixed(1)}`);
    if (new Set(machines).size !== machines.length) clash.push(`machine at ${sim.time.toFixed(1)}`);
  };
  return clash;
}

describe('E18.1 role framework: unlocks, refits, switching', () => {
  it('locked roles say why; progress unlocks them', () => {
    const sim = new Sim(createInitialState(3));
    expect(sim.roles.lockedReason('restorer')).toBeUndefined();
    expect(sim.roles.lockedReason('gardener')).toMatch(/Condenser/);
    // E23.1.1: Saltwind is in fog from the start, so Scouts have work at once; with every open area clear (and
    // the rest behind gates) there is no fog to scout until the next gate opens
    expect(sim.roles.lockedReason('scout')).toBeUndefined();
    for (const id of sim.areas.revealed()) sim.areas.clear(id, true);
    expect(sim.roles.lockedReason('scout')).toMatch(/gate/);
    expect(sim.roles.lockedReason('courier')).toMatch(/Mother Tree|Relay/);
    expect(sim.roles.lockedReason('spark')).toMatch(/3 Pollinator/);
    expect(sim.roles.lockedReason('harvester')).toMatch(/Gather biomass by hand/);
    const c = city();
    put(c, 'condenser', 40, 40);
    put(c, 'motherTree', 44, 40);
    for (let i = 0; i < 3; i++) put(c, 'pollinator', 50 + 2 * i, 40);
    c.state.stats.firsts.gathered = c.time; // E23.1.4: the Harvester unlocks after the first hand gather
    for (const r of ['gardener', 'courier', 'spark', 'harvester'] as const) expect(c.roles.lockedReason(r), r).toBeUndefined();
  });

  it('a refit charges once, all or nothing; owned roles switch free; a stale button changes nothing', () => {
    const sim = city();
    put(sim, 'condenser', 40, 40);
    const h = put(sim, 'droneHub', 20, 20);
    const price = sim.roles.refitPrice(h, 'gardener');
    expect(price).toBe(60);
    // E23.1.4/E23.5.1: biomass is paid from what bloombot carries (and the store within reach)
    const bio = () => sim.inventory.available('biomass');
    // Short of biomass: nothing spent, role unchanged.
    sim.state.salvage.pack.biomass = 5;
    expect(bio()).toBeLessThan(price);
    expect(sim.roles.check(h.id, 'gardener')).toEqual({ ok: false, reason: `Needs ${price} Biomass`, price });
    const short = bio();
    expect(sim.roles.choose(h.id, 'gardener')).toBe(false);
    expect(h.role).toBeUndefined();
    expect(h.roles).toBeUndefined();
    expect(bio()).toBe(short);
    // Enough: pays exactly the price, once.
    sim.state.salvage.pack.biomass = 100;
    const before = bio();
    expect(sim.roles.choose(h.id, 'gardener')).toBe(true);
    expect(h.role).toBe('gardener');
    expect(h.roles).toEqual(['gardener']);
    expect(bio()).toBe(before - 60);
    expect(sim.roles.refitPrice(h, 'gardener')).toBe(0); // owned
    // Back to Restorer and back again: free (owned), nothing refunded.
    expect(sim.roles.choose(h.id, 'restorer')).toBe(true);
    expect(h.role).toBeUndefined();
    expect(sim.roles.choose(h.id, 'gardener')).toBe(true);
    expect(bio()).toBe(before - 60);
    // E23.1.5: the next hub's refit costs the same (no price grows with purchases).
    const h2 = put(sim, 'droneHub', 30, 20);
    expect(sim.roles.refitPrice(h2, 'gardener')).toBe(60);
    // Stale: the hub is gone.
    sim.state.machines = sim.state.machines.filter((m) => m !== h2);
    expect(sim.roles.choose(h2.id, 'gardener')).toBe(false);
    expect(bio()).toBe(before - 60);
  });

  it('a drone finishes the job it paid for after its hub switches role', () => {
    const sim = city();
    const h = roleHub(sim, 20, 20, 'gardener');
    box(sim, 14, 14, 28, 28, green(1));
    const work: { role: DroneRole; droneId: string }[] = [];
    sim.bus.on('drone.roleWork', (e) => work.push(e));
    let d = sim.state.drones.find((x) => x.hubId === h.id)!;
    for (let i = 0; i < 100 && !d.role; i++) sim.tick();
    expect(d.role).toBe('gardener');
    sim.roles.choose(h.id, 'restorer');
    for (let i = 0; i < 100 && d.role; i++) sim.tick();
    expect(work.some((w) => w.droneId === d.id && w.role === 'gardener')).toBe(true);
    d = sim.state.drones.find((x) => x.hubId === h.id)!;
    expect(d.role).toBeUndefined();
  });

  it('reload mid-flight keeps the drone’s role and target, and the job still completes', () => {
    const sim = city();
    const h = roleHub(sim, 20, 20, 'gardener');
    box(sim, 10, 10, 34, 34, green(1));
    const d = sim.state.drones.find((x) => x.hubId === h.id)!;
    for (let i = 0; i < 100 && d.mode !== 'flying'; i++) sim.tick();
    expect(d.mode).toBe('flying');
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    const d2 = copy.state.drones.find((x) => x.id === d.id)!;
    expect(d2.role).toBe('gardener');
    expect(d2.targetTileId).toBe(d.targetTileId);
    expect(copy.state.machines.find((m) => m.id === h.id)!.role).toBe('gardener');
    let done = false;
    copy.bus.on('drone.roleWork', (e) => e.droneId === d.id && (done = true));
    copy.advance(10);
    expect(done).toBe(true);
  });

  it('no two drones of any role share a tile or machine target', () => {
    const sim = city();
    for (const [i, r] of (['restorer', 'gardener', 'scout', 'courier', 'restorer', 'courier'] as const).entries()) {
      const h = roleHub(sim, 18 + i * 3, 20, r);
      (h.upg ??= {}).secondDrone = 3;
    }
    for (let i = 0; i < 6; i++) put(sim, i % 2 ? 'solar' : 'condenser', 18 + i * 3, 26);
    put(sim, 'motherTree', 24, 30);
    box(sim, 8, 8, 40, 19, grey);
    box(sim, 8, 22, 40, 40, green(1));
    const clash = watchReservations(sim);
    sim.advance(60);
    expect(clash).toEqual([]);
  });
});

describe('E18.2 Gardener', () => {
  it('grows the target and 2 neighbours, and never restores', () => {
    const sim = city();
    roleHub(sim, 20, 20, 'gardener');
    box(sim, 12, 12, 30, 30, green(1));
    box(sim, 12, 12, 30, 13, grey); // grey ground in reach: a Gardener leaves it
    const work: string[][] = [];
    sim.bus.on('drone.roleWork', (e) => e.role === 'gardener' && work.push(e.tileIds));
    sim.advance(60);
    expect(work.length).toBeGreaterThan(3);
    expect(work.filter((w) => w.length === 3).length).toBeGreaterThan(0);
    let grey0 = 0;
    box(sim, 12, 12, 30, 13, (t) => t.ground === 'polluted' && grey0++);
    expect(grey0).toBeGreaterThan(0);
    for (const w of work) for (const id of w) expect(sim.grid.byTileId(id)!.ground).toBe('restored');
  });

  it('naps when nothing can grow (no fallback to restoring)', () => {
    const sim = city();
    const h = roleHub(sim, 20, 20, 'gardener');
    box(sim, 8, 8, 34, 34, (t) => ((t.x + t.z) % 2 ? grey(t) : green(TUNING.restore.maxBloom)(t)));
    sim.advance(20);
    const d = sim.state.drones.find((x) => x.hubId === h.id)!;
    expect(sim.drones.statusOf(d)).toBe('napping');
    let restoring = 0;
    box(sim, 8, 8, 34, 34, (t) => t.ground === 'growing' && restoring++);
    expect(restoring).toBe(0);
  });

  it('Drone Sweep adds a grown neighbour per level', () => {
    // E23.1.1: on the Mast Row's open paving (few obstacles), so a target with four growable neighbours comes up
    const sim = city();
    const h = roleHub(sim, 16, -32, 'gardener');
    (h.upg ??= {}).droneSweep = 2;
    box(sim, 8, -40, 26, -22, green(1));
    let most = 0;
    sim.bus.on('drone.roleWork', (e) => (most = Math.max(most, e.tileIds.length)));
    sim.advance(30);
    expect(most).toBe(5); // target + 2 + 2 (a tile has only 4 orthogonal neighbours)
  });

});

describe('E18.3 Scout', () => {
  /** A park with one revealed area beside it in fog, and a Scout hub near their edge. */
  function frontier() {
    const sim = offGrid(new Sim(createInitialState(8)));
    sim.state.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    // E23.1.1: Saltwind, beside the park and still in fog; helpers work there once bloombot has done its share (E21.9)
    const id = sim.areas.nextGoal()!;
    expect(sim.areas.fog(id)).toBe('thinning');
    sim.state.areas[id].byBot = sim.areas.shareTarget(id);
    const e = sim.areas.entryTiles(id).find((t) => sim.grid.neighbors(t).some((n) => sim.areas.areaOf(n) === PARK))!;
    return { sim, area: id, entry: e };
  }

  it('restores fog-edge tiles first, from 1.5× the reach, flying 1.5× as fast', () => {
    const { sim, area, entry } = frontier();
    expect(sim.roles.lockedReason('scout')).toBeUndefined();
    const spot = sim.areas.tiles(PARK).filter((t) => !t.occupantId && !t.blocked).sort((a, b) => Math.hypot(a.x - entry.x, a.z - entry.z) - Math.hypot(b.x - entry.x, b.z - entry.z))[4];
    const h = roleHub(sim, spot.x, spot.z, 'scout');
    expect(sim.roles.scoutReach(h)).toBe(TUNING.drone.hubRadius + 3);
    const hits: string[] = [];
    sim.bus.on('drone.roleWork', (e) => e.role === 'scout' && hits.push(e.tileIds[0]));
    const d = sim.state.drones.find((x) => x.hubId === h.id)!;
    let fast = false;
    const base = TUNING.drone.flySpeed * sim.upgrades.droneSpeed(h);
    for (let i = 0; i < 300; i++) {
      sim.tick();
      if (d.mode === 'flying') fast ||= Math.abs(sim.drones.speedOf(d) - base * 1.5) < 1e-9;
    }
    expect(hits.length).toBeGreaterThan(0);
    expect(fast).toBe(true);
    // The first jobs are in the fogged area, not the cleared park.
    expect(sim.areas.areaOf(sim.grid.byTileId(hits[0])!)).toBe(area);
  });

  it('a Scout working near a hidden Lucky Cat never hints it (E20.1: bloombot finds cats)', () => {
    const sim = city();
    sim.cat.anchorView = () => 'offscreen';
    expect(sim.cat.spawn()).toBe(true);
    const spot = sim.cat.spots()[0];
    const a = sim.cat.anchor(spot.anchorId)!;
    const [ax, az] = [Math.floor(a.pos[0]), Math.floor(a.pos[2])];
    expect(sim.cat.hinted(spot)).toBe(false);
    box(sim, ax - 14, az - 14, ax + 14, az + 14, green(1)); // nothing else to restore nearby…
    box(sim, ax - 2, az - 2, ax + 2, az + 2, grey); // …but the cat's corner
    const free = sim.grid.tilesNear({ roofId: GROUND, x: ax, z: az, size: 1 }, 6).find((t) => Math.hypot(t.x - ax, t.z - az) >= 4 && !t.occupantId && !t.blocked && sim.grid.footprint(GROUND, t.x, t.z, 2).every((c) => c && !c.occupantId && !c.blocked))!;
    roleHub(sim, free.x, free.z, 'scout');
    sim.advance(20);
    expect(sim.time - spot.spawnedAt).toBeLessThan(TUNING.cat.hintAfter);
    expect(spot.scouted).toBeUndefined();
    expect(sim.cat.hinted(spot)).toBe(false);
  });

  it('never nurtures', () => {
    const sim = city();
    roleHub(sim, 20, 20, 'scout');
    box(sim, 6, 6, 36, 36, green(1));
    sim.advance(20);
    let grown = 0;
    box(sim, 6, 6, 36, 36, (t) => t.bloom > 1 && grown++);
    expect(grown).toBe(0);
  });
});

describe('E18.4 Courier', () => {
  it('delivers to each machine at most once per 8 s', () => {
    const sim = city();
    const h = roleHub(sim, 20, 20, 'courier');
    (h.upg ??= {}).secondDrone = 4;
    const tree = put(sim, 'motherTree', 24, 20);
    const panel = put(sim, 'solar', 20, 24);
    const cond = put(sim, 'condenser', 17, 20);
    box(sim, 8, 8, 34, 34, green(TUNING.restore.maxBloom)); // nothing else to do
    const at = new Map<string, number[]>();
    sim.bus.on('drone.roleWork', (e) => {
      for (const id of e.machineIds) at.set(id, [...(at.get(id) ?? []), sim.time]);
    });
    sim.advance(60);
    for (const m of [tree, panel, cond]) {
      const ts = at.get(m.id) ?? [];
      expect(ts.length, m.type).toBeGreaterThan(0);
      for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1], m.type).toBeGreaterThanOrEqual(TUNING.drone.roles.courier.everySeconds - 1e-6);
    }
  });

  it('a Mother Tree charged full by Couriers waits for its normal release path', () => {
    const sim = city();
    const tree = put(sim, 'motherTree', 24, 20);
    tree.charge = TUNING.motherTree.threshold - 1;
    expect(sim.roles.deliver(tree)).toBe(true);
    expect(tree.charge).toBe(TUNING.motherTree.threshold);
    expect(sim.roles.courierUseful(tree)).toBe(false); // full: nothing to add, no loop
    expect(sim.roles.deliver(tree)).toBe(false);
  });

  it('a relay delivery cuts 25% of each link’s remaining recharge', () => {
    const sim = city();
    const a = put(sim, 'relay', 20, 20);
    const b = put(sim, 'relay', 26, 20);
    const id = a.id < b.id ? `relay:${a.id}|${b.id}` : `relay:${b.id}|${a.id}`;
    sim.relays.state(id).readyAt = sim.time + 40;
    expect(sim.roles.deliver(a)).toBe(true);
    expect(sim.state.links[id].readyAt - sim.time).toBeCloseTo(30, 6);
    expect(sim.roles.deliver(a)).toBe(false); // 8 s limit
  });
});

describe('E18.6 Spark and Harvester', () => {
  it('a Spark hub starts at most one chain per 30 s, counted as automation', () => {
    const sim = city();
    const h = roleHub(sim, 20, 20, 'spark');
    (h.upg ??= {}).secondDrone = 4;
    for (const [x, z] of [[24, 20], [24, 23], [27, 20], [27, 23]]) put(sim, 'pollinator', x, z);
    box(sim, 12, 12, 32, 32, green(1));
    const at: number[] = [];
    sim.bus.on('drone.roleWork', (e) => e.role === 'spark' && at.push(sim.time));
    const before = sim.state.stats.bigChains?.player ?? 0;
    sim.advance(100);
    expect(at.length).toBeGreaterThan(0);
    expect(at.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(TUNING.drone.roles.spark.everySeconds - 1e-6);
    expect(sim.state.stats.bigChains?.player ?? 0).toBe(before); // never counted as the player's
  });

  it('a Harvester flies to flowered ground in reach, clips it and carries the biomass to the store', () => {
    const sim = city();
    sim.state.stats.firsts.gathered = sim.time;
    const h = roleHub(sim, 20, 20, 'harvester');
    (h.upg ??= {}).secondDrone = 2;
    box(sim, 8, 8, 34, 34, green(3)); // flowered: something to gather
    const b0 = sim.inventory.stored('biomass');
    const pack0 = sim.inventory.count('biomass');
    const gathered: { tileId: string; got: number; by: string }[] = [];
    sim.bus.on('biomass.gathered', (e) => gathered.push(e));
    const work: string[] = [];
    sim.bus.on('drone.roleWork', (e) => e.role === 'harvester' && work.push(...e.tileIds));
    const d = sim.state.drones.find((x) => x.hubId === h.id)!;
    let flew = false;
    for (let i = 0; i < 600; i++) {
      sim.tick();
      if (d.role === 'harvester' && d.mode === 'flying') flew = true;
    }
    expect(flew).toBe(true);
    expect(work.length).toBeGreaterThan(0);
    expect(gathered.length).toBe(work.length);
    for (const g of gathered) expect(g.by).toBe('drone');
    expect(gathered.map((g) => g.tileId).sort()).toEqual([...work].sort());
    const got = gathered.reduce((n, g) => n + g.got, 0);
    expect(got).toBeGreaterThan(0);
    expect(sim.inventory.stored('biomass')).toBe(b0 + got); // into the store...
    expect(sim.inventory.count('biomass')).toBe(pack0); // ...not bloombot's backpack
    // a clipped tile stays restored but can't be gathered again until it regrows
    for (const id of work) {
      const t = sim.grid.byTileId(id)!;
      expect(t.ground).toBe('restored');
      expect(sim.gather.canGather(t)).toBe(false);
    }
  });

  it('a Harvester naps when nothing in reach has flowered', () => {
    const sim = city();
    sim.state.stats.firsts.gathered = sim.time;
    const h = roleHub(sim, 20, 20, 'harvester');
    box(sim, 8, 8, 34, 34, (t) => ((t.x + t.z) % 2 ? grey(t) : green(1)(t))); // bloom 1: not flowered yet
    let clipped = 0;
    sim.bus.on('biomass.gathered', () => clipped++);
    sim.advance(20);
    const d = sim.state.drones.find((x) => x.hubId === h.id)!;
    expect(sim.drones.statusOf(d)).toBe('napping');
    expect(clipped).toBe(0);
  });
});

describe('E18.8 role slots on a Megahub', () => {
  it('a Megahub sets each drone’s role; unset drones follow the hub; clearing goes back to the hub’s role', () => {
    const sim = city();
    put(sim, 'condenser', 40, 40);
    const h = put(sim, 'droneHub', 20, 20);
    h.tier = 3;
    for (let i = 0; i < 2; i++) sim.drones.spawn(h);
    const ds = sim.state.drones.filter((d) => d.hubId === h.id);
    expect(ds.length).toBe(3);
    expect(sim.roles.chooseForDrone(h.id, 1, 'gardener')).toBe(true); // pays the Gardener refit once
    expect(h.roles).toEqual(['gardener']);
    expect(ds.map((d) => sim.roles.roleFor(d, h))).toEqual(['restorer', 'gardener', 'restorer']);
    expect(sim.roles.chooseForDrone(h.id, 1, undefined)).toBe(true);
    expect(h.droneRoles).toBeUndefined();
    const lone = put(sim, 'droneHub', 30, 30); // not a Megahub
    expect(sim.roles.chooseForDrone(lone.id, 0, 'gardener')).toBe(false);
  });
});
