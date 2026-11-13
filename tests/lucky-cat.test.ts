import { describe, expect, it } from 'vitest';
import { SaveService, type StorageLike } from '../src/app/SaveService';
import { Sim } from '../src/gameplay/Sim';
import { TUNING } from '../src/data/tuning';
import { fill, makeSim, rich } from './helpers';

class MemStorage implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe('lucky cat', () => {
  it('first cat appears on the tutorial roof after enough play', () => {
    const sim = makeSim();
    fill(sim, 2, 3, 7, 6, 'restored');
    sim.advance(TUNING.cat.firstMinTime - 5);
    expect(sim.state.cat.active).toBeUndefined();
    sim.advance(10);
    expect(sim.state.cat.active).toBeDefined();
    expect(sim.cat.anchor(sim.state.cat.active!.anchorId)!.roofId).toBe('r1');
  });

  it('appears by the force time even for slow players', () => {
    const sim = makeSim();
    sim.advance(TUNING.cat.firstForceTime + 1);
    expect(sim.state.cat.active).toBeDefined();
  });

  it('pays exactly once; first reward is a Lucky Harvest', () => {
    const sim = makeSim();
    sim.cat.spawn();
    const b0 = sim.state.resources.biomass;
    const r = sim.cat.claim();
    expect(r?.type).toBe('luckyHarvest');
    expect(sim.state.resources.biomass).toBeGreaterThan(b0);
    const b1 = sim.state.resources.biomass;
    expect(sim.cat.claim()).toBeUndefined();
    expect(sim.state.resources.biomass).toBe(b1);
    expect(sim.state.cat.nextSpawnAt).toBeGreaterThan(sim.time);
  });

  it('skips anchors whose tile has a machine, and vetoed (invisible) anchors', () => {
    const sim = makeSim();
    sim.cat.isAnchorVisible = (a) => a.id === 'vent-east' || a.id === 'core-step';
    rich(sim);
    fill(sim, 2, 0, 2, 0, 'restored');
    sim.build.place('solar', 'r1', 2, 0);
    expect(sim.cat.candidates().map((a) => a.id)).toEqual(['vent-east']);
  });

  it('rewards never push resources out of range', () => {
    for (let seed = 1; seed < 40; seed++) {
      const sim = makeSim(seed);
      rich(sim);
      fill(sim, 2, 2, 5, 5, 'restored');
      sim.build.place('droneHub', 'r1', 2, 2);
      sim.state.cat.found = 1; // skip the guaranteed first reward
      sim.cat.spawn();
      sim.cat.claim();
      sim.advance(40);
      for (const k of ['energy', 'water', 'biomass'] as const) {
        expect(sim.state.resources[k]).toBeGreaterThanOrEqual(0);
        expect(sim.state.resources[k]).toBeLessThanOrEqual(sim.state.caps[k] + 1e-9);
      }
      expect(sim.state.drones.length).toBe(1); // party drones expired
    }
  });

  it('cat spawn and claim survive save/load without double rewards', () => {
    const store = new MemStorage();
    const saver = new SaveService(store);
    const sim = makeSim();
    sim.cat.spawn('parapet-back');
    saver.save(sim.state);
    const loaded = new Sim(saver.load()!);
    expect(loaded.state.cat.active?.anchorId).toBe('parapet-back');
    expect(loaded.cat.claim()).toBeDefined();
    saver.save(loaded.state);
    const again = new Sim(saver.load()!);
    expect(again.state.cat.active).toBeUndefined();
    expect(again.cat.claim()).toBeUndefined();
    expect(again.state.cat.found).toBe(1);
  });
});
