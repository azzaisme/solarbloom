import { describe, expect, it } from 'vitest';
import { fill, makeSim, rich } from './helpers';

describe('placement', () => {
  it('rejects polluted ground, out of bounds, vents, overlap and the core', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    expect(sim.build.check('solar', 'r1', 5, 5).ok).toBe(true);
    expect(sim.build.check('droneHub', 'r1', 7, 7).reason).toMatch(/edge/);
    expect(sim.build.check('solar', 'r1', -1, 2).ok).toBe(false);
    expect(sim.build.check('solar', 'r1', 7, 0).reason).toMatch(/vent/);
    expect(sim.build.check('solar', 'r1', 0, 0).ok).toBe(false); // core
    expect(sim.build.place('droneHub', 'r1', 4, 4)).toBeTruthy();
    expect(sim.build.check('solar', 'r1', 5, 5).ok).toBe(false);
    expect(sim.build.check('droneHub', 'r1', 5, 5).ok).toBe(false);
    expect(sim.build.check('droneHub', 'r1', 6, 4).ok).toBe(true);
    const sim2 = makeSim();
    rich(sim2);
    expect(sim2.build.check('solar', 'r1', 6, 6).reason).toMatch(/pulse/);
  });

  it('insufficient resources is reported separately from a bad spot', () => {
    const sim = makeSim();
    fill(sim, 0, 0, 7, 7, 'restored');
    sim.state.resources.biomass = 0;
    const c = sim.build.check('solar', 'r1', 5, 5);
    expect(c.ok).toBe(false);
    expect(c.spotOk).toBe(true);
    expect(sim.build.place('solar', 'r1', 5, 5)).toBeUndefined();
    expect(sim.state.resources.biomass).toBe(0);
  });

  it('costs grow with each copy; the anchor centres 2x2 footprints on the cursor', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    const c0 = sim.build.cost('solar').biomass!;
    sim.build.place('solar', 'r1', 5, 5);
    expect(sim.build.cost('solar').biomass!).toBeGreaterThan(c0);
    expect(sim.build.anchorFor('droneHub', 4.6, 4.6)).toEqual({ x: 4, z: 4 });
    expect(sim.build.anchorFor('droneHub', 4.4, 4.4)).toEqual({ x: 3, z: 3 });
    expect(sim.build.anchorFor('solar', 4.4, 4.9)).toEqual({ x: 4, z: 4 });
  });
});
