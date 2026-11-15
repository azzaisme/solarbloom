import { describe, expect, it } from 'vitest';
import { big, BIG_MAX, Decimal, fmt, toNum } from '../src/core/Big';
import { Economy, formatCost } from '../src/core/Economy';
import { amounts, caps } from '../src/core/Economy';
import { SaveService } from '../src/app/SaveService';
import { createInitialState } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';

describe('Phase 5 E12: big numbers', () => {
  it('sanitises every entry: NaN, infinities, negatives and junk become 0; huge values clamp to the supported maximum', () => {
    expect(toNum(big(NaN))).toBe(0);
    expect(toNum(big(Infinity))).toBe(0);
    expect(toNum(big(-5))).toBe(0);
    expect(toNum(big('nope'))).toBe(0);
    expect(toNum(big(undefined))).toBe(0);
    expect(big('1e200000').eq(BIG_MAX)).toBe(true);
    expect(big('1e500').exponent).toBe(500); // far past doubles, still exact in the exponent
  });

  it('formats deterministically with K/M/B/T… suffixes, never rounding a balance up', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(7.9)).toBe('7');
    expect(fmt(7.95, 1)).toBe('7.9');
    expect(fmt(999.99)).toBe('999');
    expect(fmt(1000)).toBe('1K');
    expect(fmt(12345)).toBe('12.3K');
    expect(fmt(999_999)).toBe('999K');
    expect(fmt(4_560_000)).toBe('4.56M');
    expect(fmt(160_000_000)).toBe('160M'); // whole numbers keep their zeros
    expect(fmt(100_000)).toBe('100K');
    expect(fmt(2_000_000)).toBe('2M');
    expect(fmt(big('1e40'))).toBe('1e40');
    expect(fmt(1e9)).toBe('1B');
    expect(fmt(7.891e12)).toBe('7.89T');
    expect(fmt(1e15)).toBe('1Qa');
    expect(fmt(big('1.5e33'))).toBe('1.5Dc');
    expect(fmt(big('1.234e45'))).toBe('1.23e45');
    expect(fmt(big('9.99e1000'))).toBe('9.99e1000');
  });

  it('Economy: biomass is uncapped and exact far beyond safe integers; energy and water still cap', () => {
    const e = new Economy(amounts({ energy: 50, water: 10, biomass: 0 }), caps({ energy: 60, water: 40 }));
    expect(e.cap('biomass')).toBeUndefined();
    e.add('biomass', '1e18');
    e.add('biomass', 5000);
    expect(e.get('biomass').gt('1e18')).toBe(true);
    expect(fmt(e.get('biomass'))).toBe('1Qi');
    e.add('energy', 1000);
    expect(toNum(e.get('energy'))).toBe(60);
    expect(toNum(e.lost.energy)).toBeCloseTo(990, 6);
    // All-or-nothing spend, also with big prices.
    expect(e.spend({ biomass: '2e18' })).toBe(false);
    expect(e.get('biomass').gt('1e18')).toBe(true);
    expect(e.spend({ biomass: '1e18', energy: 10 })).toBe(true);
    expect(toNum(e.get('energy'))).toBe(50);
    expect(e.get('biomass').lt('1e18')).toBe(true);
    // Insufficient funds name what's short, without spending anything.
    expect(e.shortfall({ energy: 51 })).toBe('energy');
    expect(e.exceedsStorage({ energy: 61 })).toBe('energy');
    expect(e.exceedsStorage({ biomass: '1e300' })).toBeUndefined();
    expect(formatCost({ biomass: '1.5e9', energy: 4.2 })).toBe('5⚡ 1.5B🌿');
  });

  it('saves and loads big balances exactly (as strings), and keeps biomass uncapped', () => {
    const saver = new SaveService(undefined);
    const sim = new Sim(createInitialState(3));
    sim.state.resources.biomass = new Decimal('1.23456789e123');
    const json = saver.serialize(sim.state);
    expect(json).toContain('"biomass":"1.23456789e+123"');
    const copy = saver.deserialize(json)!;
    expect(copy.resources.biomass.eq(sim.state.resources.biomass)).toBe(true);
    expect((copy.caps as Record<string, unknown>).biomass).toBeUndefined();
    const sim2 = new Sim(copy);
    sim2.advance(5);
    expect(sim2.state.resources.biomass.gte(sim.state.resources.biomass)).toBe(true);
  });

  it('a pre-Phase-5 save (v4) is scrapped with a notice, as agreed (no players yet)', () => {
    const saver = new SaveService(undefined);
    const old = JSON.stringify({ ...createInitialState(1), version: 4 });
    expect(saver.parse(old)).toBe('scrapped');
  });
});
