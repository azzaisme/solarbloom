// E28 water waves: things standing in the water (rocks, the jetty's posts, a bridge's supports) that ripples ring round,
// and decks built low over it that the swell lies flat under. Any part of the game feeds them by a source key of its own.
import { beforeEach, describe, expect, it } from 'vitest';
import { jettyDeck, jettyPosts } from '../src/rendering/Bridges';
import {
  clearWaterCovers,
  clearWaterDisturbers,
  coverDistance,
  nearestWaterCovers,
  nearestWaterDisturbers,
  resetWaterDisturbers,
  setWaterCovers,
  setWaterDisturbers,
  waterCovers,
  waterDisturberCount,
  waterDisturberVersion,
} from '../src/rendering/WaterDisturbance';

beforeEach(() => resetWaterDisturbers());

describe('water disturbers', () => {
  it('each source replaces only its own list; an empty list or a clear takes it away', () => {
    setWaterDisturbers('rocks:a', [
      { x: 1, z: 1, r: 0.1 },
      { x: 2, z: 1, r: 0.1 },
    ]);
    setWaterDisturbers('bridge', [{ x: 5, z: 5, r: 0.3 }]);
    expect(waterDisturberCount()).toBe(3);
    setWaterDisturbers('rocks:a', [{ x: 1, z: 1, r: 0.1 }]);
    expect(waterDisturberCount()).toBe(2);
    setWaterDisturbers('rocks:a', []);
    expect(waterDisturberCount()).toBe(1);
    clearWaterDisturbers('bridge');
    expect(waterDisturberCount()).toBe(0);
  });

  it('bumps the version on every change (and not on clearing a source that has nothing)', () => {
    const v0 = waterDisturberVersion();
    setWaterDisturbers('jetty', jettyPosts(true));
    const v1 = waterDisturberVersion();
    expect(v1).toBeGreaterThan(v0);
    clearWaterDisturbers('nothing here');
    expect(waterDisturberVersion()).toBe(v1);
    setWaterCovers('jetty', [jettyDeck(true)]);
    expect(waterDisturberVersion()).toBeGreaterThan(v1);
  });

  it('packs the nearest first, four floats each, strength defaulting to 1 and clamped to 0 … 2', () => {
    setWaterDisturbers('a', [
      { x: 10, z: 0, r: 0.2 },
      { x: 1, z: 0, r: 0.1, strength: 5 },
      { x: 3, z: 0, r: -1, strength: -2 },
    ]);
    const out = new Float32Array(8);
    expect(nearestWaterDisturbers(0, 0, 4, out)).toBe(2); // only room for two
    expect(Array.from(out)).toEqual([1, 0, expect.closeTo(0.1, 6), 2, 3, 0, 0, 0]);
    const all = new Float32Array(16);
    expect(nearestWaterDisturbers(0, 0, 16, all)).toBe(3);
    expect(all[11]).toBe(1);
  });
});

describe('water covers', () => {
  it('measure distance from the rectangle, zero on or under it', () => {
    const c = { x0: 0, z0: 0, x1: 2, z1: 3 };
    expect(coverDistance(c, 1, 1)).toBe(0);
    expect(coverDistance(c, 2, 3)).toBe(0);
    expect(coverDistance(c, 4, 1)).toBe(2);
    expect(coverDistance(c, 5, 7)).toBeCloseTo(5, 9);
  });

  it('normalise their corners, and pack the nearest first', () => {
    setWaterCovers('bridge', [{ x0: 20, z0: 9, x1: 18, z1: 5 }]);
    setWaterCovers('jetty', [jettyDeck(true)]);
    expect(waterCovers()).toContainEqual({ x0: 18, z0: 5, x1: 20, z1: 9 });
    const out = new Float32Array(8);
    expect(nearestWaterCovers(19, 6, 4, out)).toBe(2);
    expect(Array.from(out.slice(0, 4))).toEqual([18, 5, 20, 9]);
    clearWaterCovers('bridge');
    expect(waterCovers()).toEqual([jettyDeck(true)]);
  });
});
