// #sunsets: a real sun and moon in the sky, and the sun going down over the sea off Saltwind Beach.
import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { DAY_LIGHT, SUN_MOON } from '../src/data/sky';
import { DAY } from '../src/data/time';
import { DayNight, sunSwing } from '../src/rendering/DayNight';
import { pathColour } from '../src/rendering/WaterSurface';

/** DayNight on stand-ins (as in moonlit-night.test.ts), with the sky as a plain object that keeps what it is given. */
function rig() {
  const light = () => {
    const e = new pc.GraphNode();
    (e as unknown as { light: unknown }).light = { color: new pc.Color(), intensity: 0 };
    return e;
  };
  const scene = { sun: light(), fill: light(), setEnvNight: () => {} };
  const app = { scene: { exposure: 0, skyboxIntensity: 0 } };
  const sky = { night: 0, dusk: 0, overcast: 0 } as Record<string, unknown>;
  const dn = new DayNight(app as never, scene as never, sky as never);
  return { dn, sky };
}

const SUNSET = DAY.dayShare;
const MIDNIGHT = DAY.dayShare + (1 - DAY.dayShare) / 2;
const NOON = DAY.dayShare / 2;

describe('#sunsets: the sun', () => {
  it('swings as before through the morning and noon, and on round in the afternoon to set over the bay', () => {
    expect(sunSwing(0.5)).toBeCloseTo(0, 9);
    expect(sunSwing(0)).toBeCloseTo(-DAY_LIGHT.swing, 9);
    expect(sunSwing(0.25)).toBeCloseTo(-DAY_LIGHT.swing / 2, 9);
    expect(sunSwing(1)).toBeCloseTo(DAY_LIGHT.setSwing, 9);
    // early afternoon barely moves from the old arc; it keeps turning the same way all afternoon
    expect(Math.abs(sunSwing(0.6) - 0.2 * DAY_LIGHT.swing)).toBeLessThan(3);
    for (let t = 0.02; t <= 1; t += 0.02) expect(sunSwing(t)).toBeGreaterThan(sunSwing(t - 0.02));
  });

  it('goes down into the open sea straight out from the jetty, between the headlands (RUINS keeps 345°–15° clear)', () => {
    const { dn } = rig();
    const bearing = () => ((((Math.atan2(dn.sunAt.x, dn.sunAt.z) * 180) / Math.PI) % 360) + 360) % 360;
    const open = (b: number) => b >= 345 || b <= 15;
    dn.apply({ f: SUNSET });
    expect(dn.sunEl).toBeCloseTo(0, 6);
    expect(open(bearing()), `${bearing()}`).toBe(true);
    // and it sinks rather than sliding: over its last 10° it stays inside the gap
    for (let f = SUNSET; f > 0; f -= 0.001) {
      dn.apply({ f });
      if (dn.sunEl > 10) break;
      expect(open(bearing()), `f ${f}: ${bearing()}`).toBe(true);
    }
  });

  it('is high at noon and under the horizon by night, with no jump at sunset', () => {
    const { dn } = rig();
    dn.apply({ f: NOON });
    expect(dn.sunEl).toBeCloseTo(DAY_LIGHT.sunHigh, 6);
    dn.apply({ f: MIDNIGHT });
    expect(dn.sunEl).toBeLessThan(-10);
    let prev = Infinity;
    for (let f = SUNSET - 0.02; f <= SUNSET + 0.02; f += 0.001) {
      dn.apply({ f });
      expect(dn.sunEl).toBeLessThan(prev);
      if (prev !== Infinity) expect(prev - dn.sunEl).toBeLessThan(0.3);
      prev = dn.sunEl;
    }
  });

  it('makes a sunset only when it is low and the sky is clear', () => {
    const { dn, sky } = rig();
    dn.apply({ f: NOON });
    expect(dn.sunset).toBe(0);
    dn.apply({ f: MIDNIGHT });
    expect(dn.sunset).toBe(0);
    dn.apply({ f: SUNSET - 0.01 });
    expect(dn.sunset).toBeGreaterThan(0.6);
    expect(sky.sunset).toBe(dn.sunset);
    dn.apply({ f: SUNSET - 0.01, overcast: 1 });
    expect(dn.sunset).toBe(0);
  });
});

describe('#sunsets: the moon', () => {
  it('is up all night, low over the horizon where the follow camera sees it, and gone by day', () => {
    const { dn } = rig();
    for (let f = SUNSET + 0.01; f < 1; f += 0.01) {
      dn.apply({ f });
      const el = (Math.asin(dn.moonAt.y) * 180) / Math.PI;
      expect(el).toBeGreaterThanOrEqual(SUN_MOON.moon.low - 1e-6);
      expect(el).toBeLessThanOrEqual(SUN_MOON.moon.high + 1e-6);
    }
    dn.apply({ f: MIDNIGHT });
    expect(dn.moonShow).toBeCloseTo(1, 6);
    dn.apply({ f: NOON });
    expect(dn.moonShow).toBe(0);
    expect(dn.moonAt.y).toBeLessThan(0);
  });

  it('shows on the moonlight’s heading, so its path on the sea lies under it', () => {
    const { dn } = rig();
    dn.apply({ f: MIDNIGHT });
    // the key light at midnight is the moon (a directional light shines down its −Y, so its +Y points at the moon)
    const toLight = (dn as unknown as { scene: { sun: pc.GraphNode } }).scene.sun.up;
    const h = (v: pc.Vec3) => Math.atan2(v.x, v.z);
    expect(Math.abs(h(toLight) - h(dn.moonAt))).toBeLessThan(0.01);
  });
});

describe('#sunsets: the path of light on the sea', () => {
  it('is golden under the setting sun and cool under the moon', () => {
    const { dn } = rig();
    const out = new pc.Vec3();
    dn.apply({ f: SUNSET - 0.005 });
    const dusk = dn.pathOnWater(out);
    expect(dusk.warm).toBeGreaterThan(0.95);
    expect(dusk.strength).toBeGreaterThan(0.5);
    expect(out.dot(dn.sunAt)).toBeGreaterThan(0.99);
    dn.apply({ f: MIDNIGHT });
    const night = dn.pathOnWater(out);
    expect(night.warm).toBe(0);
    expect(night.strength).toBeCloseTo(1, 6);
    expect(out.dot(dn.moonAt)).toBeGreaterThan(0.99);
    dn.apply({ f: NOON });
    expect(dn.pathOnWater(out).strength).toBe(0);
  });

  it('turns from the moon’s pale blue to warm gold', () => {
    const cool = pathColour(0);
    const warm = pathColour(1);
    expect(cool[2]).toBeGreaterThan(cool[0]);
    expect(warm[0]).toBeGreaterThan(warm[2] * 2);
  });
});
