import { TUNING } from '../src/data/tuning';
import { GROUND } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { describe, expect, it } from 'vitest';
import { fill, makeSim, rich, setGround } from './helpers';

describe('drones', () => {
  it('wakes the old drone as a buddy that follows across the city and up to a rooftop', () => {
    const sim = makeSim();
    sim.advance(0.3);
    const old = sim.state.drones.find((d) => d.old)!;
    const home = sim.machine(old.hubId)!;
    const bot = { roofId: GROUND, x: home.x + 1.5, z: home.z + 0.5 };
    sim.bot = bot;
    sim.advance(0.3);
    expect(sim.drones.statusOf(old)).toBe('asleep');
    expect(old.px).toBe(home.x + 0.5);

    expect(sim.drones.wakeOld()).toBe(true);
    // Let it start its first nearby job, then leave before the tile finishes.
    for (let i = 0; i < 32 && !old.targetTileId; i++) sim.tick();
    const target = old.targetTileId!;
    expect(target).toBeDefined();
    expect(sim.drones.isReserved(target)).toBe(true);
    bot.x += 18;
    sim.tick();
    expect(sim.drones.isReserved(target)).toBe(false);
    expect(sim.drones.statusOf(old)).toBe('following');
    expect(old.px).toBeCloseTo(bot.x);

    for (let i = 0; i < 16; i++) {
      bot.x += 4.6 * TUNING.simStep;
      sim.tick();
    }
    expect(old.px).toBeCloseTo(bot.x);
    expect(old.targetTileId).toBeUndefined();
    sim.bot = { roofId: 'r1', x: 2.5, z: 3.5 };
    sim.tick();
    expect(sim.drones.roofOf(old)).toBe('r1');
    expect([old.px, old.pz]).toEqual([2.5, 3.5]);
    expect(sim.state.drones.filter((d) => d.old)).toEqual([old]);

    const loaded = new Sim(structuredClone(sim.state));
    loaded.bot = sim.bot;
    loaded.tick();
    const [buddy] = loaded.state.drones.filter((d) => d.old);
    expect(buddy.id).toBe(old.id);
    expect(loaded.drones.oldAsleep).toBe(false);
    expect(loaded.drones.statusOf(buddy)).toBe('following');
  });

  it('restores tiles automatically and never doubles up via reservations', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 4, 4, 5, 5, 'restored');
    const hub = sim.build.place('droneHub', 'r1', 4, 4)!;
    sim.drones.spawn(hub); // second drone on the same hub
    const started: string[] = [];
    sim.bus.on('drone.jobStarted', (e) => {
      expect(started.filter((id) => id === e.tileId).length).toBe(0);
      started.push(e.tileId);
    });
    sim.advance(30);
    expect(sim.state.stats.droneJobs).toBeGreaterThanOrEqual(4);
    const targets = sim.state.drones.map((d) => d.targetTileId).filter(Boolean);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('stays stable with zero eligible jobs', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    for (const t of sim.grid.tilesOf('r1')) t.bloom = TUNING.restore.maxBloom; // nothing to restore or nurture
    sim.build.place('droneHub', 'r1', 4, 4);
    sim.advance(20);
    const d = sim.state.drones[0];
    expect(['idle', 'returning']).toContain(d.mode);
    expect(d.targetTileId).toBeUndefined();
    expect(sim.drones.statusOf(d)).toBe('napping');
  });

  it('player cannot pulse a reserved tile', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 4, 4, 5, 5, 'restored');
    sim.build.place('droneHub', 'r1', 4, 4);
    let target: string | undefined;
    sim.bus.on('drone.jobStarted', (e) => (target = e.tileId));
    for (let i = 0; i < 20 && !target; i++) sim.tick();
    expect(target).toBeDefined();
    expect(sim.restoration.pulse(target!)).toBe(false);
    setGround(sim, 0, 5, 'polluted');
  });

  it('Second Drone adds a permanent drone to the first hub', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 4, 4, 5, 5, 'restored');
    const hub = sim.build.place('droneHub', 'r1', 4, 4)!;
    const hubDrones = () => sim.state.drones.filter((d) => !d.old); // not the park's old drone
    expect(hubDrones()).toHaveLength(1);
    expect(sim.upgrades.grant('secondDrone', hub.id)).toBeGreaterThan(0); // Phase 5 E12: per hub
    sim.tick();
    expect(hubDrones().filter((d) => d.expiresAt === undefined)).toHaveLength(2);
    sim.advance(5);
    expect(hubDrones()).toHaveLength(2);
  });

  it('Chain Intelligence prefers a tile next to a garden over a closer plain tile', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'polluted');
    fill(sim, 3, 3, 4, 4, 'restored');
    setGround(sim, 6, 3, 'restored');
    const hub = sim.build.place('droneHub', 'r1', 3, 3)!;
    sim.build.place('pollinator', 'r1', 6, 3);
    const d = sim.state.drones[0];
    const plain = sim.drones.findJob(d)!;
    expect(sim.upgrades.grant('chainIntel', hub.id)).toBeGreaterThan(0);
    const smart = sim.drones.findJob(d)!;
    const near = (id: string) => {
      const t = sim.grid.byTileId(id)!;
      return Math.abs(t.x - 6) + Math.abs(t.z - 3) === 1;
    };
    expect(near(plain.id)).toBe(false);
    expect(near(smart.id)).toBe(true);
  });

  it('Work Radius lets the drone reach further', () => {
    // Laid out for a base radius of 3 on the 8×8 pad (Phase 4 raised the real base radius).
    const R = TUNING.drone as { hubRadius: number };
    const was = R.hubRadius;
    R.hubRadius = 3;
    try {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    for (const t of sim.grid.tilesOf('r1')) t.bloom = TUNING.restore.maxBloom;
    setGround(sim, 6, 4, 'polluted'); // 4 tiles from the hub's footprint; base radius is 3
    const hub = sim.build.place('droneHub', 'r1', 2, 2)!;
    expect(sim.drones.findJob(sim.state.drones[0])).toBeUndefined();
    expect(sim.upgrades.grant('droneRadius', hub.id)).toBeGreaterThan(0);
    expect(sim.drones.findJob(sim.state.drones[0])?.id).toBe('r1:6:4');
    } finally {
      R.hubRadius = was;
    }
  });

  it('nurtures green tiles toward full bloom once nothing is left to restore', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    sim.build.place('droneHub', 'r1', 3, 3);
    sim.advance(20);
    expect(sim.state.stats.droneJobs).toBeGreaterThan(0);
    expect(sim.grid.tilesOf('r1').some((t) => t.bloom >= 2)).toBe(true);
  });
});
