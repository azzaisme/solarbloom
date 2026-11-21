import { describe, expect, it } from 'vitest';
import { fill, makeSim, unlockAll, rich } from './helpers';

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
    expect(sim2.build.check('solar', 'r1', 6, 6).reason).toMatch(/pulse/i);
  });

  it('missing materials are reported separately from a bad spot (E23.1.1: the Old City recipe)', () => {
    const sim = makeSim();
    unlockAll(sim, 0); // every tier open, an empty backpack
    fill(sim, 0, 0, 7, 7, 'restored');
    const c = sim.build.check('solar', 'r1', 5, 5);
    expect(c.ok).toBe(false);
    expect(c.spotOk).toBe(true);
    expect(c.reason).toMatch(/Scrap|Missing|short/i);
    expect(sim.build.place('solar', 'r1', 5, 5)).toBeUndefined();
    expect(sim.state.machines.filter((m) => m.type === 'solar' && !m.starter)).toEqual([]);
  });

  it('every copy costs the same (E23.1.5); the anchor centres 2x2 footprints on the cursor', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    const scrap = () => sim.state.salvage.pack.scrap ?? 0;
    const s0 = scrap();
    expect(sim.build.place('solar', 'r1', 5, 5)).toBeTruthy();
    const first = s0 - scrap();
    expect(first).toBeGreaterThan(0);
    expect(sim.build.place('solar', 'r1', 6, 6)).toBeTruthy();
    expect(s0 - first - scrap()).toBe(first); // the second copy pays exactly what the first did
    expect(sim.build.anchorFor('droneHub', 4.6, 4.6)).toEqual({ x: 4, z: 4 });
    expect(sim.build.anchorFor('droneHub', 4.4, 4.4)).toEqual({ x: 3, z: 3 });
    expect(sim.build.anchorFor('solar', 4.4, 4.9)).toEqual({ x: 4, z: 4 });
  });
});
