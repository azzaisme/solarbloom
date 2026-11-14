import { TUNING } from '../src/data/tuning';
import { describe, expect, it } from 'vitest';
import { fill, makeSim, rich, setGround } from './helpers';

describe('drones', () => {
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

  it('respects resource costs and waits when broke', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 4, 4, 5, 5, 'restored');
    sim.build.place('droneHub', 'r1', 4, 4);
    sim.state.machines = sim.state.machines.filter((m) => m.type !== 'solar');
    sim.state.resources.energy = 0;
    sim.advance(10);
    expect(sim.state.stats.droneJobs).toBe(0);
    expect(sim.state.resources.energy).toBeGreaterThanOrEqual(0);
    expect(sim.drones.statusOf(sim.state.drones[0])).toBe('waitingEnergy');
  });

  it('stays stable with zero eligible jobs', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    for (const t of sim.grid.tilesOf('r1')) t.bloom = 3; // nothing to restore or nurture
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
    sim.build.place('droneHub', 'r1', 4, 4);
    const hubDrones = () => sim.state.drones.filter((d) => !d.old); // not the park's old drone
    expect(hubDrones()).toHaveLength(1);
    sim.state.upgrades.secondDrone = 1;
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
    sim.build.place('droneHub', 'r1', 3, 3);
    sim.build.place('pollinator', 'r1', 6, 3);
    const d = sim.state.drones[0];
    const plain = sim.drones.findJob(d)!;
    sim.state.upgrades.chainIntel = 1;
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
    for (const t of sim.grid.tilesOf('r1')) t.bloom = 3;
    setGround(sim, 6, 4, 'polluted'); // 4 tiles from the hub's footprint; base radius is 3
    sim.build.place('droneHub', 'r1', 2, 2);
    expect(sim.drones.findJob(sim.state.drones[0])).toBeUndefined();
    sim.state.upgrades.droneRadius = 1;
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
