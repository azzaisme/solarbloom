import { describe, expect, it } from 'vitest';
import { DRONE_TAP, droneTapRadius, pickDrone } from '../src/core/Picking';

// Regression (found by merge.e2e in E14): a drone hovering beside a machine took the machine's tap, because drone
// taps used one generous radius everywhere. Over a machine (or a placement footprint) the radius is the drone's body.
describe('drone tap picking', () => {
  const wpp = 0.02; // world units per pixel at a typical zoom
  const drone = { id: 'd1', x: 100, y: 100 };

  it('a tap beside a drone over a machine goes to the machine', () => {
    const tap = { x: 100 + 14, y: 100 + 12 }; // ~18 px away: inside the generous radius, outside the drone body
    expect(pickDrone([drone], tap.x, tap.y, droneTapRadius(wpp, false))).toBe('d1');
    expect(pickDrone([drone], tap.x, tap.y, droneTapRadius(wpp, true))).toBeUndefined();
  });

  it('a tap right on the drone still picks it, machine or not', () => {
    expect(pickDrone([drone], 103, 98, droneTapRadius(wpp, true))).toBe('d1');
    expect(pickDrone([drone], 103, 98, droneTapRadius(wpp, false))).toBe('d1');
  });

  it('radii: tight is smaller than generous at every zoom and never below its minimum', () => {
    for (const w of [0.002, 0.01, 0.02, 0.05, 0.2]) {
      const tight = droneTapRadius(w, true);
      const gen = droneTapRadius(w, false);
      expect(tight).toBeLessThan(gen);
      expect(tight).toBeGreaterThanOrEqual(DRONE_TAP.tight.minPx);
      expect(gen).toBeGreaterThanOrEqual(DRONE_TAP.generous.minPx);
    }
  });

  it('picks the nearest drone, not the first in the list', () => {
    const far = { id: 'far', x: 120, y: 100 };
    const near = { id: 'near', x: 104, y: 100 };
    expect(pickDrone([far, near], 100, 100, 30)).toBe('near');
    expect(pickDrone([], 100, 100, 30)).toBeUndefined();
  });
});
