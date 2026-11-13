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
});
