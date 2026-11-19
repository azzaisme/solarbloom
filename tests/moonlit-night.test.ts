// E23.7.5 (#531): night is a blue moonlit look built from light and colour, not from a lower exposure.
import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { LOOK } from '../src/data/look';
import { DAY_LIGHT, NIGHT_SKY, NIGHT_SKY_LIGHTS } from '../src/data/sky';
import { DAY } from '../src/data/time';
import { DayNight } from '../src/rendering/DayNight';

const rgb = (hex: string) => new pc.Color().fromString(hex);
const lum = (c: pc.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** DayNight on stand-ins for the app, the scene's two lights and the sky: only what `apply` touches. */
function rig() {
  const light = () => {
    const e = new pc.GraphNode();
    (e as unknown as { light: unknown }).light = { color: new pc.Color(), intensity: 0 };
    return e;
  };
  const env: number[] = [];
  const scene = { sun: light(), fill: light(), setEnvNight: (n: number) => env.push(n) };
  const sky = { night: 0, dusk: 0, overcast: 0 };
  const app = { scene: { exposure: 0, skyboxIntensity: 0 } };
  const dn = new DayNight(app as never, scene as never, sky as never);
  const at = (f: number, overcast = 0) => {
    dn.apply({ f, overcast });
    const sun = (scene.sun as unknown as { light: unknown }).light as { color: pc.Color; intensity: number };
    const fill = (scene.fill as unknown as { light: unknown }).light as { color: pc.Color; intensity: number };
    return { exposure: app.scene.exposure, env: app.scene.skyboxIntensity, sun, fill, sky: { ...sky }, envNight: env[env.length - 1] };
  };
  return { dn, at };
}

const NOON = DAY.dayShare / 2;
const MIDNIGHT = DAY.dayShare + (1 - DAY.dayShare) / 2;

describe('E23.7.5 moonlit nights', () => {
  it('night keeps the day’s exposure, in clear weather and in rain', () => {
    const { at } = rig();
    expect(at(MIDNIGHT).exposure).toBeCloseTo(at(NOON).exposure, 6);
    expect(at(MIDNIGHT, 0.7).exposure).toBeCloseTo(at(NOON, 0.7).exposure, 6);
    expect(at(NOON).exposure).toBeCloseTo(LOOK.exposure, 6);
  });

  it('at midnight the key light is a blue moon, strong enough to read by', () => {
    const { at } = rig();
    const noon = at(NOON).sun.intensity;
    const night = at(MIDNIGHT);
    expect(night.sun.color.b).toBeGreaterThan(night.sun.color.r * 1.5);
    expect(night.sun.color.b).toBeGreaterThan(night.sun.color.g);
    expect(night.sun.intensity / noon).toBeGreaterThanOrEqual(0.3);
    expect(night.sun.intensity).toBeLessThan(noon); // still night: the moon never matches the sun
  });

  it('the fill and the ambient environment turn cool and stay up, so faces the moon misses are readable', () => {
    const { at } = rig();
    const noon = at(NOON);
    const noonFill = noon.fill.intensity;
    const noonEnv = noon.env;
    const night = at(MIDNIGHT);
    expect(night.fill.color.b).toBeGreaterThan(night.fill.color.r * 1.5);
    expect(night.fill.intensity / noonFill).toBeGreaterThanOrEqual(0.5);
    expect(night.env / noonEnv).toBeGreaterThanOrEqual(0.5);
    expect(night.envNight).toBe(1);
    expect(at(NOON).envNight).toBe(0);
    for (const hex of Object.values(DAY_LIGHT.envNightColours)) {
      const c = rgb(hex);
      expect(c.b, hex).toBeGreaterThan(c.r * 1.5);
    }
  });

  it('dusk and dawn pass through a warm low sun on the way', () => {
    const { at } = rig();
    for (const f of [DAY.dayShare - DAY.twilight * 0.75, DAY.twilight * 0.75]) {
      const m = at(f);
      expect(m.sun.color.r, `f ${f}`).toBeGreaterThan(m.sun.color.b);
      expect(m.sky.dusk, `f ${f}`).toBeGreaterThan(0.2);
    }
    // and the light never jumps: small steps in time give small steps in the key light all the way round
    let prev = at(0);
    for (let i = 1; i <= 400; i++) {
      const m = at(i / 400);
      const sun = { i: m.sun.intensity, c: m.sun.color.clone() };
      expect(Math.abs(sun.i - prev.sun.intensity), `step ${i}`).toBeLessThan(LOOK.sun.intensity * 0.12);
      prev = { ...m, sun: { intensity: sun.i, color: sun.c } };
    }
  });

  it('the night sky is a deep blue with a pale moon and stars above the horizon haze', () => {
    for (const [band, hex] of Object.entries(NIGHT_SKY.night)) {
      const c = rgb(hex);
      expect(c.b, band).toBeGreaterThan(c.r * 1.5);
      expect(c.b, band).toBeGreaterThan(c.g);
    }
    // never black: the horizon haze (the scene fog's colour at night) keeps some light
    expect(lum(rgb(NIGHT_SKY.night.haze))).toBeGreaterThan(0.2);
    expect(lum(rgb(NIGHT_SKY.night.zenith))).toBeLessThan(lum(rgb(NIGHT_SKY.night.haze)));
    expect(lum(rgb(NIGHT_SKY_LIGHTS.moon))).toBeGreaterThan(0.9);
    expect(NIGHT_SKY_LIGHTS.stars.count).toBeGreaterThan(100);
    expect(NIGHT_SKY_LIGHTS.stars.above).toBeGreaterThanOrEqual(15);
  });
});
