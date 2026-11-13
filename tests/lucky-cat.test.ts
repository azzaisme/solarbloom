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
      sim.advance(TUNING.cat.dronePartySeconds * 1.6);
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
    const d = again.cat.discoveries();
    expect(d.anchors.find((a) => a.id === 'parapet-back')!.found).toBe(true);
    expect(d.anchors.filter((a) => a.found).length).toBe(1);
    expect(d.rewards.luckyHarvest).toBe(1);
  });

  it('a missed cat never blocks rewards: it stashes extras (capped) and pays them on discovery', () => {
    const sim = makeSim();
    sim.cat.spawn('parapet-back');
    sim.state.cat.found = 1;
    sim.advance(TUNING.cat.laterMax * (TUNING.cat.stashMax + 2));
    expect(sim.state.cat.active?.anchorId).toBe('parapet-back'); // still discoverable, only one cat
    expect(sim.state.cat.stash).toBe(TUNING.cat.stashMax);
    let extras = -1;
    sim.bus.on('cat.found', (e) => (extras = e.extras));
    sim.cat.claim();
    expect(extras).toBe(TUNING.cat.stashMax);
    expect(sim.state.cat.stash).toBe(0);
  });

  it('jackpot grants two different rewards', () => {
    for (let seed = 1; seed < 30; seed++) {
      const sim = makeSim(seed);
      rich(sim);
      fill(sim, 2, 2, 5, 5, 'restored');
      sim.state.cat.found = 1;
      sim.cat.rollReward = () => 'jackpot';
      sim.cat.spawn();
      let summary = '';
      sim.bus.on('cat.found', (e) => (summary = e.summary));
      sim.cat.claim();
      expect(summary).toMatch(/JACKPOT/);
      const kinds = [/🌿/, /Solar ×3/, /Mega Bloom|already blooming/, /party drones/].filter((r) => r.test(summary)).length;
      expect(kinds).toBeGreaterThanOrEqual(2);
    }
  });
});
