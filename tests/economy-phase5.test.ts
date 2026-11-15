import { describe, expect, it } from 'vitest';
import { big, toNum } from '../src/core/Big';
import { createInitialState, GROUND } from '../src/core/GameState';
import { PARK } from '../src/core/Areas';
import { TUNING } from '../src/data/tuning';
import { UPGRADE_BY_ID } from '../src/data/upgrades';
import { Sim } from '../src/gameplay/Sim';
import { fill, makeSim, PAD, rich } from './helpers';
import { runBot } from './bots';

const panels = (sim: Sim) => sim.machinesOfType('solar');

describe('Phase 5 E12: uncapped biomass', () => {
  it('biomass passes 100 and keeps growing; a full energy store still caps', () => {
    const sim = new Sim(createInitialState(4));
    sim.state.resources.biomass = big(99);
    sim.econ.add('biomass', 1e6);
    expect(toNum(sim.state.resources.biomass)).toBeCloseTo(1e6 + 99, 6);
    sim.econ.add('energy', 1e6);
    expect(sim.econ.isFull('energy')).toBe(true);
    expect(sim.econ.isFull('biomass')).toBe(false);
  });

  it('Seed Vault still grows energy and water, never biomass', () => {
    const sim = new Sim(createInitialState(4));
    sim.state.resources.biomass = big(1e6);
    expect(sim.upgrades.purchase('seedVault')).toBe(true);
    expect(toNum(sim.state.caps.energy)).toBe(TUNING.storageTiers.energy[1]);
    expect(toNum(sim.state.caps.water)).toBe(TUNING.storageTiers.water[1]);
    expect(sim.econ.cap('biomass')).toBeUndefined();
  });
});

describe('Phase 5 E12: per-machine upgrades', () => {
  it('a level belongs to the machine it was bought for; others keep theirs', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    const a = sim.build.place('solar', PAD, 5, 5)!;
    const b = sim.build.place('solar', PAD, 6, 6)!;
    const e0 = sim.production.solarOutput(b, true);
    expect(sim.upgrades.purchase('solarArray', a.id)).toBe(true);
    expect(sim.upgrades.levelOf(a, 'solarArray')).toBe(1);
    expect(sim.upgrades.levelOf(b, 'solarArray')).toBe(0);
    expect(sim.production.solarOutput(b, true)).toBe(e0);
    expect(sim.production.solarOutput(a, true)).toBeCloseTo(e0 * 1.5, 9);
  });

  it('"Upgrade all" buys cheapest-first while biomass lasts, never overspends, one transaction per level', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    sim.build.place('solar', PAD, 5, 5);
    sim.build.place('solar', PAD, 6, 6);
    const def = UPGRADE_BY_ID.solarArray;
    // Exactly enough for one level on every panel (base cost each; the park and the pad each have an old one).
    const count = panels(sim).length;
    expect(count).toBeGreaterThanOrEqual(3);
    sim.state.resources.biomass = big(def.baseCost * count);
    const n = sim.upgrades.purchaseAll('solarArray');
    expect(n).toBe(count);
    for (const m of panels(sim)) expect(sim.upgrades.levelOf(m, 'solarArray')).toBe(1);
    expect(toNum(sim.state.resources.biomass)).toBe(0);
    expect(sim.upgrades.purchaseAll('solarArray')).toBe(0); // nothing left: no change, no negative balance
    expect(toNum(sim.state.resources.biomass)).toBe(0);
  });

  it('long-tail upgrades have no last level, and costs grow ×1.65 as big numbers', () => {
    const sim = makeSim();
    const def = UPGRADE_BY_ID.richSoil;
    expect(def.maxLevel).toBe(Infinity);
    sim.state.upgrades.richSoil = 300;
    const c = sim.upgrades.cost(def);
    expect(c.exponent).toBeGreaterThan(50); // 40 × 1.55^300 ≈ 1e58: no overflow, no NaN
    expect(Number.isFinite(sim.upgrades.soilMult)).toBe(true);
    sim.state.resources.biomass = c.mul(0.999); // (c − 1 is c at 15 significant digits)
    expect(sim.upgrades.purchase('richSoil')).toBe(false);
    sim.state.resources.biomass = c;
    expect(sim.upgrades.purchase('richSoil')).toBe(true);
    expect(sim.upgrades.level('richSoil')).toBe(301);
  });

  it('a stale per-machine button (machine gone or wrong type) changes nothing', () => {
    const sim = makeSim();
    rich(sim);
    const b0 = toNum(sim.state.resources.biomass);
    expect(sim.upgrades.purchase('solarArray', 'm-gone')).toBe(false);
    const core = sim.state.machines.find((m) => m.type === 'core')!;
    expect(sim.upgrades.purchase('solarArray', core.id)).toBe(false);
    expect(toNum(sim.state.resources.biomass)).toBe(b0);
  });
});

describe('Phase 5 E12: useful overflow (spec rule)', () => {
  it('charge follows the share of production wasted, capped per second', () => {
    const sim = new Sim(createInitialState(6));
    const s = sim.state;
    const O = TUNING.frenzy.overflow;
    const perSecond = () => sim.frenzy.overflowCharge(1); // from the tick just run
    // Only energy full: all of its steady income is wasted → perResource per second.
    s.resources.energy = big(s.caps.energy);
    s.resources.water = big(0);
    sim.tick();
    expect(perSecond()).toBeCloseTo(O.perResource, 6);
    // Both full: 0.1 + 0.1, capped.
    s.resources.energy = big(s.caps.energy);
    s.resources.water = big(s.caps.water);
    sim.tick();
    expect(perSecond()).toBeCloseTo(Math.min(O.maxPerSecond, 2 * O.perResource), 6);
    // Nothing full: nothing wasted, no charge.
    s.resources.energy = big(0);
    s.resources.water = big(0);
    sim.tick();
    expect(perSecond()).toBe(0);
  });

  it('Harvest on a full energy store gives no Frenzy charge (no tapping a maxed store)', () => {
    const sim = new Sim(createInitialState(6));
    const s = sim.state;
    s.resources.energy = big(s.caps.energy);
    const f = sim.frenzy as unknown as { lost: Record<string, number> };
    expect(sim.harvestSun()).toBe(true);
    expect(f.lost.energy).toBe(0);
    expect(toNum(sim.econ.lost.energy)).toBeGreaterThan(0); // still reported as lost, honestly
  });

  it('Frenzy keeps charging in a finished area through automation, and never while it runs', () => {
    const sim = new Sim(createInitialState(11));
    // Restore the whole park so no tile is left to restore: only growth remains.
    for (const t of sim.areas.tiles(PARK)) if (sim.restoration.isEligible(t)) sim.restoration.complete(t, 'pulse');
    const s = sim.state;
    s.frenzy = { charge: 0 };
    sim.advance(120); // the old drone nurtures tiles
    expect(s.frenzy.charge).toBeGreaterThan(0);
    s.frenzy.charge = 100;
    sim.frenzy.activate();
    sim.advance(5);
    expect(s.frenzy.charge).toBe(0);
  });
});

describe('Phase 5 E12: smaller goals and no specialty stall', () => {
  it('city areas pay rewarded steps at 25 / 50 / 75% of what their landmark needs, once each', () => {
    const sim = new Sim(createInitialState(7));
    sim.areas.clear(PARK, true);
    const id = sim.areas.revealed().find((a) => a !== PARK)!;
    const steps: number[] = [];
    sim.bus.on('area.step', ({ step }) => steps.push(step));
    const need = sim.areas.need(id);
    let done = 0;
    for (let pass = 0; pass < 200 && done < need; pass++)
      for (const t of sim.areas.entryTiles(id)) {
        if (done >= need) break;
        if (!sim.restoration.isEligible(t)) continue;
        sim.restoration.complete(t, 'pulse');
        done++;
      }
    expect(steps).toEqual([1, 2, 3]);
    sim.areas.checkSteps(id);
    expect(steps).toEqual([1, 2, 3]); // never twice
    expect(sim.state.areas[id].steps).toBe(3);
  });

  it('an area restored all the way never waits on its specialty', () => {
    const sim = new Sim(createInitialState(7));
    sim.areas.clear(PARK, true);
    const id = sim.areas.revealed().find((a) => a !== PARK && sim.milestones.specialty(a).kind === 'corridor') ?? sim.areas.revealed().find((a) => a !== PARK)!;
    for (let pass = 0; pass < 400; pass++) {
      const open = sim.areas.entryTiles(id).filter((t) => sim.restoration.isEligible(t));
      if (!open.length) break;
      for (const t of open) sim.restoration.complete(t, 'pulse');
    }
    const c = sim.areas.counts(id);
    expect(c.restored).toBe(c.restorable);
    expect(sim.milestones.specialty(id).met).toBe(true);
    expect(sim.areas.ready(id)).toBe(true);
    void GROUND;
  });
});

describe('Phase 5 E12: progression with uncapped biomass (scripted bot, not people)', () => {
  it('keeps something to buy for 30 minutes and never stalls', { timeout: 120_000 }, () => {
    let maxedAt = -1;
    const r = runBot({
      seed: 7,
      minutes: 30,
      onSecond: (sim) => {
        if (maxedAt < 0 && !sim.upgrades.all().some((u) => sim.upgrades.status(u).reason !== 'Maxed' && (!u.available || u.available(sim.state)))) maxedAt = sim.time;
      },
    });
    expect(maxedAt).toBe(-1); // there is always an upgrade left (Phase 4 ran out at ~5 min)
    expect(r.stuck).toBe(0);
    expect(r.fountain).toBeGreaterThan(0);
  });
});
