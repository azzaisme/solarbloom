import { describe, expect, it } from 'vitest';
import { polyDist } from '../src/core/Picking';

// Look 4.11 (#155): chunk streaming keeps chunks near the view's ground trapezoid, not its bounding box.
describe('polyDist (view footprint)', () => {
  // A trapezoid like a low perspective view: narrow near the camera, wide toward the horizon.
  const trap: [number, number][] = [
    [-40, 60],
    [40, 60],
    [8, 0],
    [-8, 0],
  ];
  it('is zero inside', () => {
    expect(polyDist(trap, 0, 30)).toBe(0);
    expect(polyDist(trap, 30, 55)).toBe(0);
  });
  it('measures to the nearest edge outside', () => {
    expect(polyDist(trap, 0, -5)).toBeCloseTo(5);
    expect(polyDist(trap, 0, 70)).toBeCloseTo(10);
  });
  it('excludes the bounding-box corners beside the narrow end', () => {
    // (−36, 4) is inside the bounding box but well outside the trapezoid.
    expect(polyDist(trap, -36, 4)).toBeGreaterThan(20);
  });
  it('works for either winding', () => {
    const rev = [...trap].reverse();
    expect(polyDist(rev, 0, 30)).toBe(0);
    expect(polyDist(rev, 0, -5)).toBeCloseTo(5);
  });
});
