import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { makeSim, setGround } from './helpers';

describe('economy & restoration', () => {
  it('pulse on polluted tile costs one pulse of charge and restores once', () => {
    const sim = makeSim();
    const t = setGround(sim, 5, 5, 'polluted');
    const c0 = sim.charge.value();
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(sim.charge.value()).toBeCloseTo(c0 - sim.charge.cost('pulse'));
    expect(t.ground).toBe('growing');
    sim.advance(1);
    expect(t.ground).toBe('restored');
    expect(sim.state.stats.tilesRestored).toBe(1);
    // Pulsing again nurtures (bloom level) but never re-grants the restoration.
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(t.bloom).toBe(2);
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(t.bloom).toBe(3);
    expect(sim.restoration.pulse(t.id)).toBe(true); // Phase 4 E05: Thriving → Radiant
    expect(t.bloom).toBe(4);
    const c = sim.charge.value();
    expect(sim.restoration.pulse(t.id)).toBe(false);
    expect(sim.state.stats.tilesRestored).toBe(1);
    expect(sim.charge.value()).toBe(c); // a refused pulse costs nothing
  });

  it('never drives the charge negative', () => {
    const sim = makeSim();
    sim.charge.drainForTest();
    const t = setGround(sim, 5, 5, 'polluted');
    expect(sim.restoration.pulse(t.id)).toBe(false);
    expect(sim.charge.value()).toBe(0);
    sim.charge.refillForTest();
    for (let i = 0; i < 200; i++) {
      for (const tile of sim.grid.tilesOf('r1')) sim.restoration.pulse(tile.id);
      sim.tick();
      expect(sim.charge.value()).toBeGreaterThanOrEqual(0);
      expect(sim.charge.value()).toBeLessThanOrEqual(sim.charge.max);
    }
  });

  it('cannot softlock: eating refills an empty charge and the pulse works again', () => {
    const sim = makeSim();
    sim.state.salvage.pack.biomass = 3;
    sim.charge.drainForTest();
    const t = setGround(sim, 5, 5, 'polluted');
    expect(sim.restoration.checkPulse(t).ok).toBe(false);
    expect(typeof sim.charge.eat('biomass')).toBe('object');
    sim.advance(10);
    expect(sim.charge.value()).toBeGreaterThan(0);
    expect(sim.restoration.pulse(t.id)).toBe(true);
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

  it('broad pulse restores extra neighbours for free', () => {
    const sim = makeSim();
    sim.state.upgrades.broadPulse = 1;
    const t = setGround(sim, 5, 5, 'polluted');
    const c0 = sim.charge.value();
    sim.restoration.pulse(t.id);
    sim.advance(1.5);
    expect(sim.state.stats.tilesRestored).toBe(9); // Pulse Reach I (Sprout): the 3×3 around the target
    expect(sim.charge.value()).toBeGreaterThan(c0 - sim.charge.cost('pulse') - 0.01); // one pulse's charge, no more
  });

  it('Overcharge: every Nth manual pulse restores everything within 2 tiles', () => {
    const sim = makeSim();
    sim.state.upgrades.overcharge = 1; // every 6th pulse
    const every = sim.upgrades.overchargeEvery;
    const fired: boolean[] = [];
    sim.bus.on('pulse.fired', (e) => fired.push(e.overcharged));
    const ids = ['r1:2:3', 'r1:6:2', 'r1:2:6', 'r1:6:6', 'r1:4:7', 'r1:4:4'];
    for (const id of ids.slice(0, every)) expect(sim.restoration.pulse(id)).toBe(true);
    expect(fired.filter(Boolean)).toHaveLength(1);
    expect(fired[every - 1]).toBe(true);
    sim.advance(2);
    // the overcharged pulse restored its whole radius-2 diamond (where eligible)
    const around = sim.grid.tilesOf('r1').filter((t) => Math.abs(t.x - 4) + Math.abs(t.z - 4) <= 2 && !t.blocked && !sim.isCoreTile(t));
    expect(around.every((t) => t.ground === 'restored')).toBe(true);
  });
});
