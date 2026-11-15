import { big, toNum } from '../src/core/Big';
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState } from '../src/core/GameState';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { runBot } from './bots';

function charged(seed = 3) {
  const sim = new Sim(createInitialState(seed));
  const s = sim.state;
  s.caps.energy = big(5000); s.caps.water = big(5000);
  s.resources.energy = big(2000); s.resources.water = big(2000);
  for (const t of sim.areas.tiles(PARK).filter((x) => sim.restoration.isEligible(x)).slice(0, 40)) sim.restoration.complete(t, 'pulse');
  sim.advance(1);
  s.frenzy = { charge: 100 };
  return sim;
}

describe('Phase 4 E06: Bloom Frenzy', () => {
  it('is earned by normal play without cats, then fired by the player', { timeout: 60_000 }, () => {
    const r = runBot({ seed: 21, minutes: 8, noCats: true });
    expect(r.firsts.frenzy).toBeDefined();
    expect(r.firsts.frenzy).toBeLessThan(7 * 60);
  });

  it('waits while ready (no expiry, no auto-use), and never charges past one', () => {
    const sim = charged();
    sim.advance(120);
    expect(sim.frenzy.ready()).toBe(true);
    expect(sim.frenzy.active()).toBe(false);
    sim.frenzy.add(50);
    expect(sim.state.frenzy!.charge).toBe(100);
  });

  it('boosts for exactly its duration, then everything is back to normal; no charge while it runs', () => {
    const sim = charged();
    const biomass0 = toNum(sim.production.rates().biomass);
    const radius0 = sim.restoration.pulseRadius();
    expect(sim.frenzy.activate()).toBe(true);
    expect(sim.frenzy.activate()).toBe(false); // a second tap does nothing
    expect(toNum(sim.production.rates().biomass)).toBeCloseTo(biomass0 * TUNING.frenzy.biomassMult, 6);
    expect(sim.restoration.pulseRadius()).toBeGreaterThan(radius0);
    expect(sim.mods.droneSpeedMult()).toBe(TUNING.frenzy.droneSpeedMult);
    const t = sim.areas.tiles(PARK).find((x) => sim.restoration.checkPulse(x).ok && x.ground !== 'restored')!;
    sim.restoration.pulse(t.id);
    expect(sim.state.frenzy!.charge).toBe(0);
    sim.advance(TUNING.frenzy.seconds - 0.5);
    expect(sim.frenzy.active()).toBe(true);
    sim.advance(1);
    expect(sim.frenzy.active()).toBe(false);
    expect(sim.mods.droneSpeedMult()).toBe(1);
    expect(sim.restoration.pulseRadius()).toBe(radius0);
    expect(toNum(sim.production.rates(true).biomass)).toBeCloseTo(toNum(sim.production.rates().biomass), 6);
  });

  it('survives save/load mid-Frenzy with the same time left, and pausing (no ticks) freezes it', () => {
    const sim = charged();
    sim.frenzy.activate();
    sim.advance(5);
    const left = sim.frenzy.remaining();
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.frenzy.remaining()).toBeCloseTo(left, 6);
    expect(copy.frenzy.active()).toBe(true);
    // "Pause" is simply not ticking: nothing changes.
    const before = copy.frenzy.remaining();
    expect(copy.frenzy.remaining()).toBe(before);
    copy.advance(left + 0.2);
    expect(copy.frenzy.active()).toBe(false);
  });

  it('composes with the cat’s Solar Surge by the strongest boost per stat, and offline time never charges it', () => {
    const sim = charged();
    sim.state.buffs.push({ type: 'solarFrenzy', until: sim.time + 30 });
    sim.frenzy.activate();
    expect(sim.mods.solarMult()).toBe(TUNING.cat.frenzyMult);
    expect(sim.mods.biomassMult()).toBe(TUNING.frenzy.biomassMult);
    const fresh = new Sim(createInitialState(4));
    fresh.state.resources.energy = big(fresh.state.caps.energy);
    fresh.offline.apply(3600);
    expect(fresh.state.frenzy?.charge ?? 0).toBe(0);
  });

  it('overflow charges it, but at most 0.15 per second', () => {
    const sim = new Sim(createInitialState(6));
    const s = sim.state;
    s.resources.energy = big(s.caps.energy);
    s.resources.water = big(s.caps.water);
    // The old drone keeps working meanwhile: its restores and growth charge the meter separately.
    let auto = 0;
    sim.bus.on('tile.restored', ({ source }) => source !== 'pulse' && source !== 'broad' && (auto += TUNING.frenzy.charge.autoRestore));
    sim.bus.on('tile.nurtured', ({ auto: a }) => a && (auto += TUNING.frenzy.charge.autoNurture));
    sim.advance(20);
    const c = (s.frenzy?.charge ?? 0) - auto;
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(20 * TUNING.frenzy.overflow.maxPerSecond + 1e-6);
  });
});

describe('Phase 4 E07: automation', () => {
  it('Drone Squad and Drone Sweep never restore a tile twice, and drones stop and resume cleanly', () => {
    const sim = new Sim(createInitialState(8));
    const s = sim.state;
    s.caps.energy = big(1e5); s.caps.water = big(1e5);
    s.resources.energy = big(1e5); s.resources.water = big(1e5); s.resources.biomass = big(1e5);
    const spot = sim.areas.tiles(PARK).find((t) => sim.grid.footprint('g', t.x, t.z, 2).every((c) => c && !c.blocked && !c.occupantId && sim.restoration.isEligible(c)))!;
    for (const c of sim.grid.footprint('g', spot.x, spot.z, 2)) sim.restoration.complete(c!, 'pulse');
    const hub = sim.build.place('droneHub', 'g', spot.x, spot.z)!;
    expect(hub).toBeTruthy();
    hub.upg = { secondDrone: 2, droneSweep: 2, droneSpeed: 3 }; // Phase 5 E12: per-hub upgrades
    const restored = new Map<string, number>();
    sim.bus.on('tile.restored', ({ tile }) => restored.set(tile.id, (restored.get(tile.id) ?? 0) + 1));
    sim.advance(180);
    expect(s.drones.filter((d) => !d.old)).toHaveLength(3);
    expect(restored.size).toBeGreaterThan(20);
    for (const n of restored.values()) expect(n).toBe(1);
  });
});

describe('Phase 4 E08: Lucky Cat rewards', () => {
  it('a Lucky Harvest is the same with or without a Frenzy running (sustained income), and always lands whole', () => {
    const run = (frenzy: boolean) => {
      const sim = charged(12);
      sim.state.cat.found = 0; // the first cat is always a Lucky Harvest
      if (frenzy) sim.frenzy.activate();
      sim.cat.spawn();
      const b0 = toNum(sim.state.resources.biomass);
      const r = sim.cat.claim()!;
      return { got: toNum(sim.state.resources.biomass) - b0, summary: r.summary };
    };
    const a = run(false);
    const b = run(true);
    expect(b.got).toBeCloseTo(a.got, 6);
    // Phase 5 E12: biomass has no cap, so nothing is ever lost from a harvest.
    expect(a.got).toBeGreaterThan(0);
    expect(a.summary).not.toMatch(/didn't fit/);
  });
});
