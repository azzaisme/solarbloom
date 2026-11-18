import { describe, expect, it } from 'vitest';
import { hasStrength, machineStrengthAt, strengthAt, strengthOf, strengthsOfMachine } from '../src/core/RegionStrengths';
import { REGION_STRENGTHS, REGIONS, STRENGTH_BONUS, STRENGTH_MACHINES, type RegionId, type StrengthKind } from '../src/data/oldcity';

/** E23.8.1 (#399): each region has a natural strength, and a matching machine gives about 1.5× there. */

/** A cell in the middle of a region. */
function mid(id: RegionId): [number, number] {
  const c = REGIONS.find((r) => r.id === id)!.chunks;
  return [((c.x0 + c.x1 + 1) / 2) * 16, ((c.z0 + c.z1 + 1) / 2) * 16];
}

const PARK: [number, number] = [8, 8];

describe('E23.8.1: region strengths', () => {
  it('every region has at least one strength, all above 1, with a description', () => {
    for (const r of REGIONS) {
      const s = REGION_STRENGTHS[r.id];
      expect(s, r.id).toBeDefined();
      expect(Object.keys(s.strengths).length, r.id).toBeGreaterThan(0);
      for (const v of Object.values(s.strengths)) expect(v).toBeGreaterThan(1);
      expect(s.text.length).toBeGreaterThan(0);
    }
  });

  it('matches the table in the issue', () => {
    const want: Record<RegionId, StrengthKind[]> = {
      mastRow: ['wind'],
      oldMarket: ['trade'],
      saltwind: ['wind', 'tide'],
      elderGrove: ['soil'],
      cistern: ['water'],
      clockPlaza: ['machinery'],
      terraces: ['sun'],
      glasshouse: ['shelter'],
      observatory: ['sun', 'wind'],
      spireHeights: ['salvage'],
    };
    for (const [id, kinds] of Object.entries(want) as [RegionId, StrengthKind[]][]) expect(Object.keys(REGION_STRENGTHS[id].strengths).sort()).toEqual([...kinds].sort());
  });

  it('Saltwind has the strongest wind', () => {
    const winds = REGIONS.map((r) => strengthOf(r.id, 'wind'));
    expect(strengthOf('saltwind', 'wind')).toBe(Math.max(...winds));
    expect(strengthOf('saltwind', 'wind')).toBeGreaterThan(strengthOf('mastRow', 'wind'));
  });

  it('a solar panel gives 1.5× on The Terraces and 1× in the park', () => {
    expect(STRENGTH_BONUS).toBe(1.5);
    expect(machineStrengthAt('solar', ...mid('terraces'))).toBe(1.5);
    expect(machineStrengthAt('solar', ...mid('observatory'))).toBe(1.5);
    expect(machineStrengthAt('solar', ...PARK)).toBe(1);
    expect(machineStrengthAt('solar', ...mid('mastRow'))).toBe(1);
  });

  it('a wind turbine is strongest on the beach, boosted on Mast Row, plain in the grove', () => {
    expect(machineStrengthAt('windTurbine', ...mid('saltwind'))).toBe(1.75);
    expect(machineStrengthAt('windTurbine', ...mid('mastRow'))).toBe(1.5);
    expect(machineStrengthAt('windTurbine', ...mid('elderGrove'))).toBe(1);
  });

  it('shelter and water read as yes/no', () => {
    expect(hasStrength(...mid('glasshouse'), 'shelter')).toBe(true);
    expect(hasStrength(...mid('cistern'), 'water')).toBe(true);
    expect(hasStrength(...PARK, 'shelter')).toBe(false);
    expect(hasStrength(...mid('saltwind'), 'water')).toBe(false);
  });

  it('the sea and the park have no strength; fractional positions use their cell', () => {
    for (const k of Object.keys(STRENGTH_MACHINES) as StrengthKind[]) {
      expect(strengthAt(...PARK, k)).toBe(1);
      expect(strengthAt(5000, 5000, k)).toBe(1);
    }
    const [x, z] = mid('terraces');
    expect(strengthAt(x + 0.7, z + 0.3, 'sun')).toBe(1.5);
  });

  it('every strength boosts at least one machine, and an unknown machine gets nothing', () => {
    for (const [k, ms] of Object.entries(STRENGTH_MACHINES)) expect(ms.length, k).toBeGreaterThan(0);
    expect(strengthsOfMachine('solar')).toEqual(['sun']);
    expect(machineStrengthAt('mystery', ...mid('terraces'))).toBe(1);
  });
});
