import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { fill, makeSim, rich, setGround } from './helpers';

function setupGarden() {
  const sim = makeSim();
  rich(sim);
  fill(sim, 0, 0, 7, 7, 'polluted');
  setGround(sim, 4, 4, 'restored');
  sim.build.place('pollinator', 'r1', 4, 4);
  sim.state.upgrades.pollinatorReach = 1; // zone radius 2
  return sim;
}

describe('bloom chains', () => {
  it('spreads through mossy tiles in the pollinator zone with a matching combo count', () => {
    const sim = setupGarden();
    for (const [x, z] of [[4, 3], [4, 2], [5, 2], [3, 3]]) setGround(sim, x, z, 'prepared');
    const steps: number[] = [];
    let ended: { combo: number; bonus: number } | undefined;
    sim.bus.on('chain.step', (e) => steps.push(e.combo));
    sim.bus.on('chain.ended', (e) => (ended = e));
    const origin = setGround(sim, 4, 5, 'polluted');
    origin.pollution = 100;
    sim.restoration.pulse(setGround(sim, 3, 4, 'prepared').id);
    sim.advance(4);
    expect(ended).toBeDefined();
    expect(ended!.combo).toBe(steps.length);
    expect(steps).toEqual(steps.map((_, i) => i + 1));
    expect(ended!.combo).toBeGreaterThanOrEqual(3);
    expect(ended!.bonus).toBeGreaterThan(0);
  });

  it('never restores the same tile twice and always terminates under the event cap', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'prepared');
    for (const [x, z] of [[2, 2], [5, 5], [2, 5], [5, 2]]) {
      setGround(sim, x, z, 'restored');
      sim.build.place('pollinator', 'r1', x, z);
    }
    sim.state.upgrades.pollinatorReach = 2;
    const restoredIds: string[] = [];
    sim.bus.on('tile.restored', (e) => restoredIds.push(e.tile.id));
    let combo = 0;
    sim.bus.on('chain.ended', (e) => (combo = Math.max(combo, e.combo)));
    sim.restoration.complete(sim.grid.get('r1', 3, 3)!, 'pulse');
    for (let i = 0; i < 100; i++) sim.tick();
    expect(new Set(restoredIds).size).toBe(restoredIds.length);
    expect(restoredIds.length).toBeLessThanOrEqual(TUNING.chain.maxEvents);
    expect(combo).toBeGreaterThanOrEqual(10);
    expect(sim.chains.pendingSteps).toBe(0);
    expect(sim.chains.activeRuns).toBe(0);
  });

  it('does not spread outside pollinator zones or through concrete', () => {
    const sim = setupGarden();
    setGround(sim, 0, 7, 'prepared'); // vent, irrelevant
    let steps = 0;
    sim.bus.on('chain.step', () => steps++);
    sim.restoration.complete(setGround(sim, 4, 3, 'polluted'), 'pulse');
    sim.advance(2);
    expect(steps).toBe(0);
  });

  it('solar boost from blooms is terminal (no feedback loop)', () => {
    const sim = makeSim();
    rich(sim);
    const panel = sim.state.machines.find((m) => m.starter)!;
    let boosts = 0;
    sim.bus.on('solar.boost', () => boosts++);
    sim.restoration.complete(setGround(sim, panel.x + 1, panel.z, 'polluted'), 'pulse');
    sim.advance(3);
    expect(boosts).toBe(1);
    expect(panel.boostUntil).toBeGreaterThan(0);
  });

  it('mega bloom is bounded by its budget and may break concrete', () => {
    const sim = makeSim();
    rich(sim);
    setGround(sim, 4, 4, 'restored');
    let combo = 0;
    sim.bus.on('chain.ended', (e) => (combo = e.combo));
    expect(sim.chains.startMega(6)).toBe(true);
    sim.advance(4);
    expect(combo).toBeGreaterThan(0);
    expect(combo).toBeLessThanOrEqual(6);
  });
});
