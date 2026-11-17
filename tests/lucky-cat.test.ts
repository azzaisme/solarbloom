import { toNum } from '../src/core/Big';
import { describe, expect, it } from 'vitest';
import { SaveService, type StorageLike } from '../src/app/SaveService';
import { Sim } from '../src/gameplay/Sim';
import { TUNING } from '../src/data/tuning';
import { PARK } from '../src/core/Areas';
import { fill, GROUND, makeSim, rich } from './helpers';

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
  it('first cat appears in the park after enough play', () => {
    const sim = makeSim();
    let n = 0;
    for (const t of sim.areas.tiles(PARK)) {
      if (t.blocked || t.occupantId || n >= 24) continue;
      t.ground = 'restored';
      t.bloom = 1;
      sim.grid.touch(t);
      n++;
    }
    sim.advance(TUNING.cat.firstMinTime - 5);
    expect(sim.state.cat.active).toBeUndefined();
    sim.advance(10);
    expect(sim.state.cat.active).toBeDefined();
    expect(sim.cat.anchor(sim.state.cat.active!.anchorId)!.roofId).toBe(GROUND);
  });

  it('appears by the force time even for slow players', () => {
    const sim = makeSim();
    sim.advance(TUNING.cat.firstForceTime + 1);
    expect(sim.state.cat.active).toBeDefined();
  });

  it('pays exactly once; first reward is a Lucky Harvest', () => {
    const sim = makeSim();
    sim.cat.spawn();
    const b0 = toNum(sim.state.resources.biomass);
    const r = sim.cat.claim();
    expect(r?.type).toBe('luckyHarvest');
    expect(toNum(sim.state.resources.biomass)).toBeGreaterThan(b0);
    const b1 = toNum(sim.state.resources.biomass);
    expect(sim.cat.claim()).toBeUndefined();
    expect(toNum(sim.state.resources.biomass)).toBe(b1);
    expect(sim.state.cat.nextSpawnAt).toBeGreaterThan(sim.time);
  });

  it('skips anchors whose tile has a machine, and vetoed (invisible) anchors', () => {
    const sim = makeSim();
    sim.cat.anchorView = (a) => (a.id === 'park-bench' || a.id === 'fountain-rim' ? 'visible' : 'covered');
    rich(sim);
    const t = sim.grid.get(GROUND, 9, 8)!; // the fountain rim's tile
    t.ground = 'restored';
    sim.grid.touch(t);
    expect(sim.build.place('solar', GROUND, 9, 8)).toBeTruthy();
    expect(sim.cat.candidates().map((a) => a.id)).toEqual(['park-bench']);
  });

  it('rewards never push resources out of range', { timeout: 60000 }, () => {
    for (let seed = 1; seed < 40; seed++) {
      const sim = makeSim(seed);
      rich(sim);
      fill(sim, 2, 2, 5, 5, 'restored');
      sim.build.place('droneHub', 'r1', 2, 2);
      sim.state.cat.found = 1; // skip the guaranteed first reward
      sim.cat.spawn();
      sim.cat.claim();
      sim.advance(TUNING.cat.partyMaxSeconds + 1); // Phase 5 E15: rarer cats party longer, never past the cap
      for (const k of ['energy', 'water', 'biomass'] as const) {
        expect(toNum(sim.state.resources[k])).toBeGreaterThanOrEqual(0);
        const cap = sim.econ.cap(k);
        if (cap) expect(toNum(sim.state.resources[k])).toBeLessThanOrEqual(toNum(cap) + 1e-9);
      }
      expect(sim.state.drones.filter((d) => !d.old).length).toBe(1); // party drones expired (the park's old drone stays)
    }
  });

  it('cat spawn and claim survive save/load without double rewards', () => {
    const store = new MemStorage();
    const saver = new SaveService(store);
    const sim = makeSim();
    sim.cat.spawn('park-bench');
    saver.save(sim.state);
    const loaded = new Sim(saver.load()!);
    expect(loaded.state.cat.active?.anchorId).toBe('park-bench');
    expect(loaded.cat.claim()).toBeDefined();
    saver.save(loaded.state);
    const again = new Sim(saver.load()!);
    expect(again.state.cat.active).toBeUndefined();
    expect(again.cat.claim()).toBeUndefined();
    expect(again.state.cat.found).toBe(1);
    const d = again.cat.discoveries();
    expect(d.rewards.luckyHarvest).toBe(1);
  });

  it('E20.1: a cat waits to be found: no stash grows, and the next timer starts from the find', () => {
    const sim = makeSim();
    sim.cat.spawn('park-bench');
    sim.state.cat.found = 1;
    sim.advance(TUNING.cat.laterMax * 4);
    expect(sim.state.cat.active?.anchorId).toBe('park-bench'); // still there, only one cat
    expect(sim.state.cat.stash ?? 0).toBe(0);
    let extras = -1;
    sim.bus.on('cat.found', (e) => (extras = e.extras));
    sim.cat.claim();
    expect(extras).toBe(0);
    expect(sim.state.cat.nextSpawnAt).toBeGreaterThanOrEqual(sim.time + TUNING.cat.laterMin);
  });

  it('E20.1: a stash from an older save is paid once with the next find', () => {
    const sim = makeSim();
    sim.cat.spawn('park-bench');
    sim.state.cat.found = 1;
    sim.state.cat.stash = 2;
    let extras = -1;
    sim.bus.on('cat.found', (e) => (extras = e.extras));
    sim.cat.claim();
    expect(extras).toBe(2);
    expect(sim.state.cat.stash).toBe(0);
  });

  it('E20.1: a cat never hides in view or right beside bloombot, and prefers a short walk away', () => {
    for (let seed = 1; seed < 12; seed++) {
      const sim = makeSim(seed);
      const all = sim.cat.candidates();
      if (all.length < 3) continue;
      const seen = new Set([all[0].id]);
      sim.cat.anchorView = (a) => (seen.has(a.id) ? 'visible' : 'offscreen');
      const near = all[1];
      sim.state.bot = { roofId: near.roofId, x: near.pos[0], z: near.pos[2], facing: 0 };
      expect(sim.cat.spawn()).toBe(true);
      const id = sim.state.cat.active!.anchorId;
      expect(seen.has(id)).toBe(false);
      const a = sim.cat.anchor(id)!;
      if (a.roofId === near.roofId) expect(Math.hypot(a.pos[0] - near.pos[0], a.pos[2] - near.pos[2])).toBeGreaterThan(TUNING.cat.minFromBot);
    }
  });

  it('E20.1: with every spot in view, no cat appears (it tries again later)', () => {
    const sim = makeSim();
    sim.cat.anchorView = () => 'visible';
    expect(sim.cat.spawn()).toBe(false);
    expect(sim.state.cat.active).toBeUndefined();
    expect(sim.state.cat.nextSpawnAt).toBeGreaterThan(sim.time);
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
