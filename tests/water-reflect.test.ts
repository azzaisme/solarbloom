import { describe, expect, it } from 'vitest';
import { POOL_REFLECT, poolMaterial, poolReflectOn, setPoolReflect } from '../src/rendering/Water';

/**
 * Owner (E23 polish): the ponds, canals, the Cistern and the reservoirs pick up a little of the sky and a sun or
 * moon glint, on the High graphics tier only. Medium, Low and the Steam Deck preset keep the water as it was.
 */
describe('water reflection', () => {
  it('is on at High only, and never on the Steam Deck preset', () => {
    expect(poolReflectOn('high', false)).toBe(true);
    expect(poolReflectOn('medium', false)).toBe(false);
    expect(poolReflectOn('low', false)).toBe(false);
    for (const t of ['high', 'medium', 'low'] as const) expect(poolReflectOn(t, true), t).toBe(false);
  });

  const day = { low: [0.9, 0.85, 0.7], high: [0.45, 0.65, 0.95], toLight: { x: 0.3, y: 0.8, z: 0.5 }, light: { r: 1, g: 0.9, b: 0.75 }, share: 1 } as const;
  const night = { low: [0.1, 0.14, 0.3], high: [0.05, 0.08, 0.22], toLight: { x: -0.4, y: 0.6, z: 0.7 }, light: { r: 0.43, g: 0.57, b: 1 }, share: 0.3 } as const;
  const param = (name: string) => (poolMaterial().getParameter(name) as { data?: unknown } | undefined)?.data as number | number[];

  it('switches live with the setting: the shader term is skipped (strength 0) whenever it is off', () => {
    const m = poolMaterial();
    expect(param('uPoolReflect')).toBe(0); // a fresh material starts plain
    setPoolReflect(true, day);
    expect(param('uPoolReflect')).toBe(POOL_REFLECT);
    expect(POOL_REFLECT).toBeGreaterThan(0);
    setPoolReflect(false);
    expect(param('uPoolReflect')).toBe(0);
    setPoolReflect(true, day);
    expect(param('uPoolReflect')).toBe(POOL_REFLECT);
    expect(poolMaterial()).toBe(m); // one shared material: every pond follows at once
  });

  it('reflects the sky it is given: bright by day, dark blue by night with a dimmer moon glint', () => {
    setPoolReflect(true, day);
    const dayLow = [...(param('uPoolSkyLow') as number[])];
    const dayGlint = [...(param('uPoolLight') as number[])];
    expect(param('uPoolToLight')).toEqual([0.3, 0.8, 0.5]);
    setPoolReflect(true, night);
    const nightLow = param('uPoolSkyLow') as number[];
    const nightGlint = param('uPoolLight') as number[];
    // colours go in linear
    expect(nightLow[2]).toBeCloseTo(Math.pow(0.3, 2.2), 6);
    expect(nightLow[0] + nightLow[1] + nightLow[2]).toBeLessThan(dayLow[0] + dayLow[1] + dayLow[2]);
    expect(nightLow[2]).toBeGreaterThan(nightLow[0]); // blue
    expect(nightGlint[2]).toBeGreaterThan(nightGlint[0]); // the moon's blue light
    expect(nightGlint[2]).toBeLessThan(dayGlint[0]);
    // a light under the horizon can't glint
    setPoolReflect(true, { ...day, toLight: { x: 0.9, y: -0.2, z: 0.3 } });
    expect(param('uPoolLight')).toEqual([0, 0, 0]);
  });
});
