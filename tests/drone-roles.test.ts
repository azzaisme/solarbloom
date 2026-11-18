import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { big, toNum } from '../src/core/Big';
import { PARK } from '../src/core/Areas';
import { Economy } from '../src/core/Economy';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { Cost, DroneRole, MachineData, TileData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

/** E18.1–E18.4 and E18.6 (#201–#204, #206): drone roles. */

function city(seed = 6, r = 3) {
  const sim = new Sim(createInitialState(seed));
  const st = sim.state;
  st.caps.energy = big(1e7); st.caps.water = big(1e7);
  st.resources.energy = big(1e7); st.resources.water = big(1e7); st.resources.biomass = big(1e7);
  st.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) sim.areas.clear(sim.areas.map.areaOfChunk(cx, cz), true);
  return sim;
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
  sim.production.markDirty();
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

/** Every price paid through payJob, by the role of the drone that paid it. */
function spyPayments(sim: Sim) {
  const paid: Cost[] = [];
  const pay = sim.drones.payJob.bind(sim.drones);
  sim.drones.payJob = (c: Cost) => {
    const ok = pay(c);
    if (ok && Object.keys(c).length) paid.push(c); // the old drone pays nothing (sunlight)
    return ok;
  };
  return paid;
}

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
    expect(sim.roles.lockedReason('scout')).toMatch(/fountain/);
    expect(sim.roles.lockedReason('courier')).toMatch(/Mother Tree|Relay/);
    expect(sim.roles.lockedReason('spark')).toMatch(/3 Pollinator/);
    expect(sim.roles.lockedReason('harvester')).toMatch(/full stores/);
    const c = city();
    put(c, 'condenser', 40, 40);
    put(c, 'motherTree', 44, 40);
    for (let i = 0; i < 3; i++) put(c, 'pollinator', 50 + 2 * i, 40);
    for (const r of ['gardener', 'courier', 'spark'] as const) expect(c.roles.lockedReason(r), r).toBeUndefined();
  });

  it('a refit charges once, all or nothing; owned roles switch free; a stale button changes nothing', () => {
    const sim = city();
    put(sim, 'condenser', 40, 40);
    const h = put(sim, 'droneHub', 20, 20);
    const price = sim.roles.refitPrice(h, 'gardener');
    expect(price).toEqual({ biomass: big(60), water: 20 });
    // Short of water: nothing spent, role unchanged.
    sim.state.resources.water = big(5);
    const before = toNum(sim.state.resources.biomass);
    expect(sim.roles.choose(h.id, 'gardener')).toBe(false);
    expect(h.role).toBeUndefined();
    expect(toNum(sim.state.resources.biomass)).toBe(before);
    // Enough: pays exactly the price, once.
    sim.state.resources.water = big(1000);
    expect(sim.roles.choose(h.id, 'gardener')).toBe(true);
    expect(h.role).toBe('gardener');
    expect(h.roles).toEqual(['gardener']);
    expect(toNum(sim.state.resources.biomass)).toBe(before - 60);
    expect(toNum(sim.state.resources.water)).toBe(980);
    // Back to Restorer and back again: free (owned), nothing refunded.
    expect(sim.roles.choose(h.id, 'restorer')).toBe(true);
    expect(h.role).toBeUndefined();
    expect(sim.roles.choose(h.id, 'gardener')).toBe(true);
    expect(toNum(sim.state.resources.biomass)).toBe(before - 60);
    expect(toNum(sim.state.resources.water)).toBe(980);
    // The next hub's refit costs ×1.5 biomass (energy and water don't grow).
    const h2 = put(sim, 'droneHub', 30, 20);
    expect(sim.roles.refitPrice(h2, 'gardener')).toEqual({ biomass: big(90), water: 20 });
    // Stale: the hub is gone.
    sim.state.machines = sim.state.machines.filter((m) => m !== h2);
    expect(sim.roles.choose(h2.id, 'gardener')).toBe(false);
    expect(toNum(sim.state.resources.biomass)).toBe(before - 60);
  });

  it('every refit fits the starting stores (60% rule)', () => {
    const sim = new Sim(createInitialState(1));
    const h = put(sim, 'droneHub', 3, 3);
    for (const role of ['gardener', 'scout', 'courier', 'spark', 'harvester'] as const) {
      const p = sim.roles.refitPrice(h, role);
      for (const k of ['energy', 'water'] as const) expect(Economy.part(p, k).toNumber(), `${role} ${k}`).toBeLessThanOrEqual(toNum(sim.state.caps[k]) * TUNING.machineCostMaxShare);
    }
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
  it('runs on water only, grows the target and 2 neighbours, and never restores', () => {
    const sim = city();
    roleHub(sim, 20, 20, 'gardener');
    box(sim, 12, 12, 30, 30, green(1));
    box(sim, 12, 12, 30, 13, grey); // grey ground in reach: a Gardener leaves it
    const paid = spyPayments(sim);
    const work: string[][] = [];
    sim.bus.on('drone.roleWork', (e) => e.role === 'gardener' && work.push(e.tileIds));
    sim.advance(60);
    expect(work.length).toBeGreaterThan(3);
    expect(work.filter((w) => w.length === 3).length).toBeGreaterThan(0);
    for (const c of paid) {
      expect(Economy.part(c, 'energy').toNumber()).toBe(0);
      expect([2, 3, 5]).toContain(Economy.part(c, 'water').toNumber());
    }
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
    const sim = city();
    const h = roleHub(sim, 20, 20, 'gardener');
    (h.upg ??= {}).droneSweep = 2;
    box(sim, 12, 12, 30, 30, green(1));
    let most = 0;
    sim.bus.on('drone.roleWork', (e) => (most = Math.max(most, e.tileIds.length)));
    sim.advance(30);
    expect(most).toBe(5); // target + 2 + 2 (a tile has only 4 orthogonal neighbours)
  });
});

describe('E18.3 Scout', () => {
  /** A park with one revealed area beside it in Frontier fog, and a Scout hub near their edge. */
  function frontier() {
    const sim = new Sim(createInitialState(8));
    const st = sim.state;
    st.caps.energy = big(1e7); st.caps.water = big(1e7);
    st.resources.energy = big(1e7); st.resources.water = big(1e7); st.resources.biomass = big(1e7);
    st.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    const id = sim.areas.revealed().find((a) => a !== PARK && sim.areas.fog(a) === 'frontier' && sim.areas.info(a).distance === 1)!;
    const e = sim.areas.entryTiles(id)[0];
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

  it('pays the restore cost plus 1 ⚡ for every 4 tiles past the base radius', () => {
    const sim = city();
    const h = put(sim, 'droneHub', 20, 20);
    const near = sim.grid.get(GROUND, 24, 20)!; // 3 tiles from the footprint: no surcharge
    const far = sim.grid.get(GROUND, 35, 20)!; // 14 tiles: 8 past the base radius → +2 ⚡
    grey(near);
    grey(far);
    const pulse = (t: TileData) => Economy.part(sim.restoration.pulseCost(t), 'energy').toNumber();
    expect(Economy.part(sim.roles.scoutCost(h, near), 'energy').toNumber()).toBe(pulse(near));
    expect(Economy.part(sim.roles.scoutCost(h, far), 'energy').toNumber()).toBeCloseTo(pulse(far) + 2, 9);
    expect(Economy.part(sim.roles.scoutCost(h, far), 'water').toNumber()).toBe(Economy.part(sim.restoration.pulseCost(far), 'water').toNumber());
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
  it('delivers to each machine at most once per 8 s, priced by what the machine runs on', () => {
    const sim = city();
    const h = roleHub(sim, 20, 20, 'courier');
    (h.upg ??= {}).secondDrone = 4;
    const tree = put(sim, 'motherTree', 24, 20);
    const panel = put(sim, 'solar', 20, 24);
    const cond = put(sim, 'condenser', 17, 20);
    box(sim, 8, 8, 34, 34, green(TUNING.restore.maxBloom)); // nothing else to do
    const paid = spyPayments(sim);
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
    const kinds = paid.map((c) => `${Economy.part(c, 'energy').toNumber()}/${Economy.part(c, 'water').toNumber()}`);
    for (const k of kinds) expect(['0/4', '4/0', '0/3', '6/0']).toContain(k);
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

  it('a Harvester never pays out more than it collects, and only while a store is full', () => {
    const sim = city();
    sim.state.caps.energy = big(50);
    sim.state.resources.energy = big(50);
    for (let i = 0; i < 6; i++) put(sim, 'solar', 30 + i, 30);
    const h = roleHub(sim, 20, 20, 'harvester');
    (h.upg ??= {}).secondDrone = 2;
    const b0 = toNum(sim.state.resources.biomass);
    sim.advance(60);
    expect(sim.roles.harvest.collected).toBeGreaterThan(0);
    expect(sim.roles.harvest.paid).toBeLessThanOrEqual(sim.roles.harvest.collected * (1 - TUNING.drone.roles.harvester.keep) * TUNING.drone.roles.harvester.rate + 1e-9);
    expect(toNum(sim.state.resources.biomass)).toBeGreaterThan(b0);
    expect(sim.roles.lostSeconds).toBeGreaterThan(TUNING.drone.roles.harvester.unlockLostSeconds - 5);
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
