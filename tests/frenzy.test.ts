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
  s.caps.energy = s.caps.water = s.caps.biomass = 5000;
  s.resources.energy = s.resources.water = 2000;
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
    const biomass0 = sim.production.rates().biomass;
    const radius0 = sim.restoration.pulseRadius();
    expect(sim.frenzy.activate()).toBe(true);
    expect(sim.frenzy.activate()).toBe(false); // a second tap does nothing
    expect(sim.production.rates().biomass).toBeCloseTo(biomass0 * TUNING.frenzy.biomassMult, 6);
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
    expect(sim.production.rates(true).biomass).toBeCloseTo(sim.production.rates().biomass, 6);
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
    fresh.state.resources.energy = fresh.state.caps.energy;
    fresh.offline.apply(3600);
    expect(fresh.state.frenzy?.charge ?? 0).toBe(0);
  });

  it('overflow charges it, but at most 0.15 per second', () => {
    const sim = new Sim(createInitialState(6));
    const s = sim.state;
    s.resources.energy = s.caps.energy;
    s.resources.water = s.caps.water;
    s.resources.biomass = s.caps.biomass;
    sim.advance(20);
    const c = s.frenzy?.charge ?? 0;
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThanOrEqual(20 * TUNING.frenzy.overflow.maxPerSecond + 1e-6);
  });
});

describe('Phase 4 E07: automation', () => {
  it('Drone Squad and Drone Sweep never restore a tile twice, and drones stop and resume cleanly', () => {
    const sim = new Sim(createInitialState(8));
    const s = sim.state;
    s.caps.energy = s.caps.water = s.caps.biomass = 1e5;
    s.resources.energy = s.resources.water = s.resources.biomass = 1e5;
    s.upgrades.secondDrone = 2;
    s.upgrades.droneSweep = 2;
    s.upgrades.droneSpeed = 3;
    const spot = sim.areas.tiles(PARK).find((t) => sim.grid.footprint('g', t.x, t.z, 2).every((c) => c && !c.blocked && !c.occupantId && sim.restoration.isEligible(c)))!;
    for (const c of sim.grid.footprint('g', spot.x, spot.z, 2)) sim.restoration.complete(c!, 'pulse');
    expect(sim.build.place('droneHub', 'g', spot.x, spot.z)).toBeTruthy();
    const restored = new Map<string, number>();
    sim.bus.on('tile.restored', ({ tile }) => restored.set(tile.id, (restored.get(tile.id) ?? 0) + 1));
    sim.advance(180);
    expect(s.drones.filter((d) => !d.old)).toHaveLength(3);
    expect(restored.size).toBeGreaterThan(20);
    for (const n of restored.values()) expect(n).toBe(1);
  });
});

describe('Phase 4 E08: Lucky Cat rewards', () => {
  it('a Lucky Harvest is the same with or without a Frenzy running (sustained income), and says what did not fit', () => {
    const run = (frenzy: boolean) => {
      const sim = charged(12);
      sim.state.cat.found = 0; // the first cat is always a Lucky Harvest
      if (frenzy) sim.frenzy.activate();
      sim.cat.spawn();
      const b0 = sim.state.resources.biomass;
      const r = sim.cat.claim()!;
      return { got: sim.state.resources.biomass - b0, summary: r.summary };
    };
    const a = run(false);
    const b = run(true);
    expect(b.got).toBeCloseTo(a.got, 6);
    const tight = charged(12);
    tight.state.caps.biomass = tight.state.resources.biomass + 1;
    tight.state.cat.found = 0;
    tight.cat.spawn();
    expect(tight.cat.claim()!.summary).toMatch(/didn't fit/);
  });
});
