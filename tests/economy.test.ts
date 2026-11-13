import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { makeSim, setGround } from './helpers';

describe('economy & restoration', () => {
  it('pulse on polluted tile costs the right amount and restores once', () => {
    const sim = makeSim();
    const t = setGround(sim, 5, 5, 'polluted');
    const e0 = sim.state.resources.energy;
    const w0 = sim.state.resources.water;
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(sim.state.resources.energy).toBeCloseTo(e0 - TUNING.pulse.polluted.energy);
    expect(sim.state.resources.water).toBeCloseTo(w0 - 1);
    expect(t.ground).toBe('growing');
    sim.advance(1);
    expect(t.ground).toBe('restored');
    expect(sim.state.stats.tilesRestored).toBe(1);
    // Pulsing again nurtures (bloom level) but never re-grants the restoration.
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(t.bloom).toBe(2);
    sim.state.resources.energy = 50;
    sim.state.resources.water = 20;
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(t.bloom).toBe(3);
    const b = sim.state.resources.biomass;
    expect(sim.restoration.pulse(t.id)).toBe(false);
    expect(sim.state.stats.tilesRestored).toBe(1);
    expect(sim.state.resources.biomass).toBe(b);
  });

  it('never drives balances negative', () => {
    const sim = makeSim();
    sim.state.resources.energy = 3;
    const t = setGround(sim, 5, 5, 'polluted');
    expect(sim.restoration.pulse(t.id)).toBe(false);
    expect(sim.state.resources.energy).toBe(3);
    for (let i = 0; i < 200; i++) {
      for (const tile of sim.grid.roof('r1')!.tiles) sim.restoration.pulse(tile.id);
      sim.tick();
      for (const k of ['energy', 'water', 'biomass'] as const) {
        expect(sim.state.resources[k]).toBeGreaterThanOrEqual(0);
        expect(sim.state.resources[k]).toBeLessThanOrEqual(sim.state.caps[k] + 1e-9);
      }
    }
  });

  it('cannot softlock: energy and water always recover', () => {
    const sim = makeSim();
    sim.state.resources.energy = 0;
    sim.state.resources.water = 0;
    sim.advance(10);
    expect(sim.state.resources.energy).toBeGreaterThan(TUNING.pulse.polluted.energy);
    expect(sim.state.resources.water).toBeGreaterThanOrEqual(1);
    sim.state.resources.energy = 0;
    expect(sim.harvestSun()).toBe(true);
    expect(sim.state.resources.energy).toBe(TUNING.harvest.energy);
    expect(sim.harvestSun()).toBe(false); // cooldown
  });

  it('restoring seeps life into neighbours (polluted -> prepared)', () => {
    const sim = makeSim();
    const a = setGround(sim, 5, 5, 'polluted');
    const mid = setGround(sim, 5, 6, 'polluted');
    mid.pollution = TUNING.restore.seep * 2;
    const b = setGround(sim, 5, 7, 'polluted');
    sim.restoration.complete(a, 'pulse');
    expect(mid.ground).toBe('polluted');
    sim.restoration.complete(b, 'pulse');
    expect(mid.ground).toBe('prepared');
  });

  it('upgrades change costs and caps', () => {
    const sim = makeSim();
    sim.state.resources.biomass = 40;
    expect(sim.upgrades.purchase('efficientPulse')).toBe(true);
    expect(sim.restoration.pulseCost(setGround(sim, 6, 6, 'polluted')).energy).toBeCloseTo(TUNING.pulse.polluted.energy * 0.75);
    sim.state.resources.biomass = 40;
    expect(sim.upgrades.purchase('seedVault')).toBe(true);
    expect(sim.state.caps.biomass).toBe(TUNING.start.caps.biomass * 1.5);
    expect(sim.upgrades.purchase('droneSpeed')).toBe(false); // needs hub
  });

  it('broad pulse restores extra neighbours for free', () => {
    const sim = makeSim();
    sim.state.upgrades.broadPulse = 1;
    const t = setGround(sim, 5, 5, 'polluted');
    const e0 = sim.state.resources.energy;
    sim.restoration.pulse(t.id);
    sim.advance(1.5);
    expect(sim.state.stats.tilesRestored).toBe(2);
    expect(sim.state.resources.energy).toBeGreaterThan(e0 - TUNING.pulse.polluted.energy - 0.01);
  });
});
