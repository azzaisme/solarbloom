// #twilight: the afterglow after sunset (and before sunrise); #sky-blue / #sky-clouds: a deeper day sky; #painted-clouds: the cloud field.
import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { CLOUDS, SKY, SUN_MOON, TWILIGHT } from '../src/data/sky';
import { DAY } from '../src/data/time';
import { DayNight, twilightAt } from '../src/rendering/DayNight';

/** DayNight on stand-ins (as in sun-moon.test.ts), with the sky as a plain object that keeps what it is given. */
function rig() {
  const light = () => {
    const e = new pc.GraphNode();
    (e as unknown as { light: unknown }).light = { color: new pc.Color(), intensity: 0 };
    return e;
  };
  const env: number[][] = [];
  const scene = { sun: light(), fill: light(), setEnvNight: (n: number, t = 0) => env.push([n, t]) };
  const app = { scene: { exposure: 0, skyboxIntensity: 0 } };
  const sky = { night: 0, dusk: 0, overcast: 0 } as Record<string, unknown>;
  const dn = new DayNight(app as never, scene as never, sky as never);
  return { dn, sky, scene, app, env };
}

const hex = (h: string) => {
  const c = new pc.Color();
  c.fromString(h);
  return c;
};
/** a dome colour as it lands on screen (it is encoded once more on output, see SKY) */
const onScreen = (h: string) => {
  const c = hex(h);
  return [c.r, c.g, c.b].map((v) => v ** (1 / 2.2));
};

const SUNSET = DAY.dayShare;
const MIDNIGHT = DAY.dayShare + (1 - DAY.dayShare) / 2;

describe('#twilight: when the afterglow comes', () => {
  it('comes in as the sun reaches the horizon, is full just under it and gone well below', () => {
    expect(twilightAt(30)).toBe(0);
    expect(twilightAt(TWILIGHT.rise + 0.01)).toBe(0);
    expect(twilightAt(-3)).toBeCloseTo(1, 6);
    expect(twilightAt(TWILIGHT.end - 0.01)).toBe(0);
    expect(twilightAt(-3, 1)).toBeCloseTo(1 - TWILIGHT.cloud, 6);
  });

  it('follows the sun down after sunset, then leaves the moonlit night exactly as it was', () => {
    const { dn, sky } = rig();
    dn.apply({ f: SUNSET + 0.012 });
    expect(dn.twilight).toBeGreaterThan(0.95);
    expect(sky.twilight).toBe(dn.twilight);
    dn.apply({ f: MIDNIGHT });
    expect(dn.twilight).toBe(0);
    dn.apply({ f: 0.3 });
    expect(dn.twilight).toBe(0);
    // and it fades with no jump
    let prev = 1;
    for (let f = SUNSET + 0.012; f < SUNSET + 0.08; f += 0.001) {
      dn.apply({ f });
      expect(prev - dn.twilight).toBeLessThan(0.08);
      prev = dn.twilight;
    }
    expect(prev).toBe(0);
  });

  it('dims the land under a low pink light and turns the ambient and rim to the afterglow', () => {
    const { dn, scene, app, env } = rig();
    const at = (f: number) => {
      dn.apply({ f });
      const l = (scene.sun as unknown as { light: { color: pc.Color; intensity: number } }).light;
      return { i: l.intensity, c: l.color.clone(), sky: app.scene.skyboxIntensity, rim: dn.rim };
    };
    const tw = at(SUNSET + 0.012);
    expect(tw.c.r).toBeGreaterThan(tw.c.g * 1.3); // pink, not the moon's blue
    // the ambient is re-baked toward the afterglow's purple
    const before = env.length;
    dn.apply({ f: SUNSET + 0.012 });
    expect(env[before]).toEqual([1 - dn.daylight, dn.twilight]);
    const night = at(MIDNIGHT);
    expect(night.c.b).toBeGreaterThan(night.c.r);
    expect(tw.rim).toBeGreaterThan(night.rim);
  });
});

describe('#twilight: the colours (as the reference: violet overhead, magenta, an orange line)', () => {
  const S = TWILIGHT.sky;
  it('is violet overhead, magenta above the horizon and orange on it', () => {
    const top = hex(S.top);
    expect(top.b).toBeGreaterThan(top.r * 1.5);
    expect(top.r).toBeGreaterThan(top.g);
    const band = hex(S.band);
    expect(band.r).toBeGreaterThan(band.g * 2);
    expect(band.b).toBeGreaterThan(band.g);
    const hz = hex(S.horizon);
    expect(hz.r).toBeGreaterThan(hz.b * 2);
    expect(hz.g).toBeGreaterThan(hz.b);
    expect(S.bandAt).toBeLessThan(S.midAt);
    expect(S.midAt).toBeLessThan(S.topAt);
  });

  it('keeps the far side of the sky darker and bluer than the sun’s', () => {
    for (const [near, far] of [
      [S.horizon, S.horizonFar],
      [S.band, S.bandFar],
      [S.mid, S.midFar],
    ]) {
      const a = hex(near);
      const b = hex(far);
      expect(b.r + b.g).toBeLessThan(a.r + a.g);
      expect(b.b / b.r).toBeGreaterThan(a.b / a.r);
    }
  });

  it('lights the clouds from below: bright magenta undersides under dark crowns', () => {
    const under = hex(TWILIGHT.cloudUnder);
    const top = hex(TWILIGHT.cloudTop);
    expect(under.r).toBeGreaterThan(under.g * 2);
    expect(top.r + top.g + top.b).toBeLessThan((under.r + under.g + under.b) / 2);
  });
});

describe('#sky-clouds: lit from below at sunset', () => {
  it('glows gold-orange underneath toward the sun and rose further round, with dusky crowns', () => {
    const S = SUN_MOON.sunset;
    const under = hex(S.cloudUnder);
    const far = hex(S.cloudUnderFar);
    const top = hex(S.cloudTop);
    expect(under.r).toBeGreaterThan(under.b * 2);
    expect(under.g).toBeGreaterThan(under.b);
    expect(far.b / far.r).toBeGreaterThan(under.b / under.r);
    expect(top.r + top.g + top.b).toBeLessThan(under.r + under.g + under.b);
  });
});

describe('#sky-blue: a deep, clear day sky', () => {
  it('lands on screen a saturated cobalt overhead and azure lower down, not a pale wash', () => {
    const zen = onScreen(SKY.zenith[1]);
    const up = onScreen(SKY.upper[1]);
    expect(zen[2]).toBeGreaterThan(0.8);
    expect(zen[2]).toBeGreaterThan(zen[0] * 4);
    expect(up[2]).toBeGreaterThan(up[0] * 2.5);
    // still deeper overhead than low down
    expect(zen[0] + zen[1]).toBeLessThan(up[0] + up[1]);
  });
});

describe('#painted-clouds: broad, wispy, open sky between', () => {
  it('leave open blue sky between formations, with soft edges and slow drift', () => {
    // cover is the density threshold: well above zero keeps gaps of open sky
    expect(CLOUDS.cover).toBeGreaterThan(0.4);
    expect(CLOUDS.softness).toBeGreaterThan(0);
    expect(CLOUDS.softness).toBeLessThan(0.4);
    // overcast thickens them (a lower threshold)
    expect(CLOUDS.overcastCover).toBeLessThan(CLOUDS.cover);
    // very slow drift
    expect(Math.hypot(CLOUDS.drift[0], CLOUDS.drift[1])).toBeLessThan(0.02);
  });

  it('are broad horizontal formations that fade into the horizon haze, never fully opaque', () => {
    expect(CLOUDS.stretch).toBeGreaterThan(1.2);
    expect(CLOUDS.wisps).toBeGreaterThan(0);
    expect(CLOUDS.horizonHaze).toBeGreaterThan(0);
    expect(CLOUDS.opacity).toBeLessThan(1);
    // the zoomed-out sheet is lighter still, so it never hides the island
    expect(CLOUDS.layer.opacity).toBeLessThan(CLOUDS.opacity);
  });

  it('have ivory highlights over blue-grey bodies', () => {
    const lit = onScreen(SKY.cloudLit[1]);
    const shade = onScreen(SKY.cloudShade[1]);
    expect(shade[2]).toBeGreaterThan(shade[0]);
    expect(shade[0] + shade[1] + shade[2]).toBeLessThan(lit[0] + lit[1] + lit[2] - 0.3);
  });
});
