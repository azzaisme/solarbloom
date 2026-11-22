// E27.1 (#679): a bright sunlit look that isn't washed out. The light is checked by sum, before tone mapping: a pale
// sunlit surface lands under white and under the bloom threshold, shadows keep a real gap from the sun, the shade is
// a soft blue, the grade and the rim don't push the greens fluorescent, and night keeps its own light.
import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { LOOK } from '../src/data/look';
import { DAY_LIGHT, SKY, SKY_BANDS, SKY_BANDS_NIGHT } from '../src/data/sky';
import { DAY } from '../src/data/time';
import { DayNight } from '../src/rendering/DayNight';
import { PALETTE } from '../src/rendering/Palette';
import { GRADING_GLSL, fogMatchingSky, gradeFloor, horizonHaze } from '../src/rendering/LookShaders';
import { SEA_LIFT, seaTintAt } from '../src/rendering/Water';
import { Sky } from '../src/rendering/Sky';

const lin = (hex: string) => new pc.Color().fromString(hex).linear();
const lum = (c: pc.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** Light falling on flat ground at noon, per channel, before exposure: the sun, the sky above and the fill. */
function noonLight() {
  const sun = lin(LOOK.sun.color);
  const fill = lin(LOOK.fill.color);
  const E = LOOK.env;
  // the environment's light on an upward face: mostly the sky overhead, some of the horizon
  const sky = (k: 'r' | 'g' | 'b') => LOOK.env.intensity * (0.6 * lin(E.zenith)[k] + 0.4 * lin(E.horizon)[k]);
  const up = Math.sin((DAY_LIGHT.sunHigh * Math.PI) / 180);
  // the fill comes from above at about 53° (DayNight aims it down 0.75 against 1 across)
  const fillUp = 0.6;
  const shade = (k: 'r' | 'g' | 'b') => sky(k) + LOOK.fill.intensity * fill[k] * fillUp;
  const lit = (k: 'r' | 'g' | 'b') => LOOK.sun.intensity * sun[k] * up + shade(k);
  return { lit, shade };
}

/** DayNight on stand-ins (as in moonlit-night.test.ts): what apply() sets on the lights and the scene. */
function rig() {
  const light = () => {
    const e = new pc.GraphNode();
    (e as unknown as { light: unknown }).light = { color: new pc.Color(), intensity: 0 };
    return e;
  };
  const scene = { sun: light(), fill: light(), setEnvNight: () => {} };
  const app = { scene: { exposure: 0, skyboxIntensity: 0 } };
  const dn = new DayNight(app as never, scene as never, { night: 0, dusk: 0, overcast: 0 } as never);
  const of = (n: pc.GraphNode) => (n as unknown as { light: { color: pc.Color; intensity: number } }).light;
  return (f: number) => {
    dn.apply({ f });
    return { sun: of(scene.sun).intensity, fill: of(scene.fill).intensity, env: app.scene.skyboxIntensity, rim: dn.rim * LOOK.rim.intensity };
  };
}

const MIDNIGHT = DAY.dayShare + (1 - DAY.dayShare) / 2;

describe('E27.1 sunlit, not washed out', () => {
  it('pale sunlit ground lands under white and under the bloom threshold', () => {
    const { lit } = noonLight();
    // the palest ground in the game: the beach's sand and the old city's worn paving
    for (const hex of [...PALETTE.ground.painted.sand, ...PALETTE.ground.painted['dead-paving']]) {
      const c = lin(hex);
      const peak = Math.max(c.r * lit('r'), c.g * lit('g'), c.b * lit('b'));
      // before tone mapping: not bloomed, and after exposure not so far past 1 that Neutral flattens its detail
      expect(peak, hex).toBeLessThan(LOOK.bloom.threshold);
      expect(peak * LOOK.exposure, hex).toBeLessThan(2);
      // and still bright: a sunlit pale surface reads near white, not grey
      expect(peak * LOOK.exposure, hex).toBeGreaterThan(1);
    }
  });

  it('glows still bloom: the threshold sits under every authored glow', () => {
    expect(LOOK.bloom.threshold).toBeLessThan(LOOK.emissive.particles);
    expect(LOOK.bloom.threshold).toBeLessThan(LOOK.emissive.preview);
    expect(LOOK.bloom.threshold).toBeLessThan(LOOK.emissive.gain);
  });

  it('shadows keep a real gap from the sun, and the shade is never black', () => {
    const { lit, shade } = noonLight();
    const sunlit = 0.2126 * lit('r') + 0.7152 * lit('g') + 0.0722 * lit('b');
    const shaded = 0.2126 * shade('r') + 0.7152 * shade('g') + 0.0722 * shade('b');
    expect(sunlit / shaded).toBeGreaterThanOrEqual(3);
    expect(shaded).toBeGreaterThan(0.35);
  });

  it('the shade is a soft blue fill, the sun warm', () => {
    const fill = lin(LOOK.fill.color);
    const zenith = lin(LOOK.env.zenith);
    const sun = lin(LOOK.sun.color);
    expect(fill.b).toBeGreaterThan(fill.r);
    expect(zenith.b).toBeGreaterThan(zenith.r * 1.5);
    expect(sun.r).toBeGreaterThan(sun.b * 1.3);
    // a soft fill: well under the sun
    expect(LOOK.fill.intensity).toBeLessThan(LOOK.sun.intensity * 0.3);
  });

  it('the grade and the rim keep the greens natural', () => {
    const W = LOOK.grade.warm;
    expect(W.saturation).toBeLessThanOrEqual(1.15);
    expect(W.vibrance).toBeLessThanOrEqual(0.2);
    expect(W.shadows).toBeLessThanOrEqual(0); // lifting the shadows flattens the depth back out
    expect(W.highlights).toBeLessThan(0);
    // the rim on a mid-tone edge facing the sun (LookShaders: albedo × 0.55 + 0.16) is an edge, not a wash of gold
    const R = LOOK.rim;
    expect(R.intensity * lum(lin(R.color)) * (0.5 * 0.55 + 0.16)).toBeLessThan(0.45);
    expect(R.power).toBeGreaterThanOrEqual(2);
  });

  it('night keeps its own light when the day is retuned', () => {
    const at = rig();
    const night = at(MIDNIGHT);
    expect(night.sun).toBeCloseTo(DAY_LIGHT.moonIntensity, 6);
    expect(night.fill).toBeCloseTo(DAY_LIGHT.fillNight, 6);
    expect(night.env).toBeCloseTo(DAY_LIGHT.envNight, 6);
    expect(night.rim).toBeCloseTo(DAY_LIGHT.rimNight, 6);
    const was = { sun: LOOK.sun.intensity, fill: LOOK.fill.intensity, env: LOOK.env.intensity, rim: LOOK.rim.intensity };
    try {
      LOOK.sun.intensity *= 0.5;
      LOOK.fill.intensity *= 0.5;
      LOOK.env.intensity *= 0.5;
      LOOK.rim.intensity *= 0.5;
      const after = at(MIDNIGHT);
      for (const k of ['sun', 'fill', 'env', 'rim'] as const) expect(after[k], k).toBeCloseTo(night[k], 6);
    } finally {
      Object.assign(LOOK.sun, { intensity: was.sun });
      Object.assign(LOOK.fill, { intensity: was.fill });
      Object.assign(LOOK.env, { intensity: was.env });
      Object.assign(LOOK.rim, { intensity: was.rim });
    }
  });
});

describe('E27.1 the horizon, with the skyline gone (#683)', () => {
  const H = LOOK.horizon;
  const enc = (c: number) => Math.pow(c, 1 / 2.2);
  // the fog colour lands on screen as given; the sky dome's colour lands encoded (it is treated as linear)
  const seenSky = (c: number[]) => c.map(enc);

  it('far surfaces just under the horizon fade into the haze; near ones and steep ones are untouched', () => {
    const near = 10;
    const far = 30;
    expect(horizonHaze(1, 60, H.band, near, far, H.strength)).toBeGreaterThan(0.8); // the far sea's edge
    expect(horizonHaze(1, 5, H.band, near, far, H.strength)).toBe(0); // a post right by the camera, level with it
    expect(horizonHaze(-10, 5, H.band, near, far, H.strength)).toBe(0); // above eye level but close: Bloombot's head
    expect(horizonHaze(H.band + 1, 60, H.band, near, far, H.strength)).toBe(0); // the ground well below the horizon
    // softly: the haze falls off over the band, never in one step
    let prev = 1;
    for (let d = 0; d <= H.band; d += 0.5) {
      const h = horizonHaze(d, 60, H.band, near, far, H.strength);
      expect(prev - h).toBeLessThan(0.2);
      prev = h;
    }
  });

  it('the fogged distance and the sky meet in one colour at night and by day', () => {
    // night (#683's hard line): the dome shows the haze encoded, so the fog is encoded to match
    const nightHaze = [51 / 255, 72 / 255, 124 / 255];
    const nightSky = Sky.prototype.horizonSeen.call({ night: 1 } as never, nightHaze as never);
    const nightFog = fogMatchingSky(nightHaze[0], nightHaze[1], nightHaze[2], 1);
    seenSky(nightSky).forEach((c, i) => expect(nightFog[i]).toBeCloseTo(c, 3));
    // day: the fog keeps the clear haze (no paling of the distance) and the sky's horizon is given it as the fog shows it
    const dayHaze = [200 / 255, 204 / 255, 202 / 255];
    const daySky = Sky.prototype.horizonSeen.call({ night: 0 } as never, dayHaze as never);
    const dayFog = fogMatchingSky(dayHaze[0], dayHaze[1], dayHaze[2], 0);
    dayFog.forEach((c, i) => expect(c).toBeCloseTo(dayHaze[i], 6));
    seenSky(daySky).forEach((c, i) => expect(dayFog[i]).toBeCloseTo(c, 3));
    // and through dusk they stay close (within a few levels of 255)
    for (const d of [0.25, 0.5, 0.75]) {
      const sky = Sky.prototype.horizonSeen.call({ night: d } as never, nightHaze as never);
      const fog = fogMatchingSky(nightHaze[0], nightHaze[1], nightHaze[2], d);
      seenSky(sky).forEach((c, i) => expect(Math.abs(fog[i] - c) * 255, `dark ${d}`).toBeLessThan(12));
    }
  });
});

describe('E27.1 the sea: clear aqua by day, the approved moonlit sea by night', () => {
  // the colours the approved night (and the old over-bright day) were tuned with
  const OLD = { sea: ['#2f6f8a', '#2b6880', '#337693'], shallows: ['#4f8592', '#4a7f8b', '#568b98'] };
  const linOf = (hex: string) => {
    const c = lin(hex);
    return [c.r, c.g, c.b];
  };

  it('the sea and the shallows are the old colours lifted by SEA_LIFT', () => {
    for (const k of ['sea', 'shallows'] as const)
      PALETTE.ground[k].forEach((hex, i) => {
        const now = linOf(hex);
        const was = linOf(OLD[k][i]);
        // within a step of 255 after rounding to hex
        now.forEach((c, j) => expect(Math.abs(c - was[j] * SEA_LIFT[j]), `${k} ${i}`).toBeLessThan(0.012));
      });
  });

  it('a clear aqua by day: blue and green well above red, and bright', () => {
    for (const hex of PALETTE.ground.sea) {
      const [r, g, b] = linOf(hex);
      expect(b).toBeGreaterThan(r * 3);
      expect(g).toBeGreaterThan(r * 2.5);
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThan(0.25);
    }
  });

  it('by night the lift comes back out, so the moonlit sea keeps its approved colour', () => {
    expect(seaTintAt(0)).toEqual([1, 1, 1]);
    for (const k of ['sea', 'shallows'] as const)
      PALETTE.ground[k].forEach((hex, i) => {
        const night = linOf(hex).map((c, j) => c * seaTintAt(1)[j]);
        const was = linOf(OLD[k][i]);
        night.forEach((c, j) => expect(c, `${k} ${i}`).toBeCloseTo(was[j], 2));
      });
    // and through dusk it fades smoothly
    for (let n = 0; n < 1; n += 0.1) seaTintAt(n + 0.1).forEach((c, j) => expect(c).toBeLessThan(seaTintAt(n)[j]));
  });
});

describe('E27.1 a sunny sky, not an overcast one', () => {
  it('the follow camera (about 15° of sky) sees the blue, with the warm haze hugging the horizon', () => {
    expect(SKY_BANDS.glow).toBeLessThanOrEqual(4);
    expect(SKY_BANDS.upper).toBeLessThanOrEqual(12);
    expect(SKY_BANDS.zenith).toBeGreaterThan(SKY_BANDS.upper);
    // the approved moonlit night keeps the bands it was tuned with
    expect(SKY_BANDS_NIGHT).toEqual({ glow: 4, upper: 25, zenith: 90 });
  });

  it('blue overhead and warm low down, even in a new game under the fog (and clearer once restored)', () => {
    for (const i of [0, 1]) {
      const up = lin(SKY.upper[i]);
      const zen = lin(SKY.zenith[i]);
      const glow = lin(SKY.glow[i]);
      expect(up.b, `upper ${i}`).toBeGreaterThan(up.r * 1.3);
      expect(zen.b, `zenith ${i}`).toBeGreaterThan(zen.r * 1.6);
      expect(glow.r, `glow ${i}`).toBeGreaterThanOrEqual(glow.b);
    }
    // restoring the city still clears the sky toward a deeper blue
    expect(lin(SKY.zenith[1]).b / lin(SKY.zenith[1]).r).toBeGreaterThan(lin(SKY.zenith[0]).b / lin(SKY.zenith[0]).r);
  });
});

describe('E28.W06 (#699): the grade bends dark channels to black instead of clipping them', () => {
  const toe = LOOK.grade.toe;
  const W = LOOK.grade.warm;
  // the engine's grade on one channel (no tint): contrast pivots on 0.5 in linear light
  const graded = (c: number) => 0.5 + W.contrast * (c - 0.5);

  it('a small toe, in LOOK', () => {
    expect(toe).toBeGreaterThan(0);
    expect(toe).toBeLessThanOrEqual(0.01);
  });

  it('the night sea that used to clip now bends smoothly: no kink where a channel runs out', () => {
    // the old grade: max(0, g). Its slope jumps from 1.06 to 0 where g crosses zero (the night overview's straight
    // line). The floor's slope changes gradually: sampled across that crossing, no two neighbours differ by much
    const h = 1e-4;
    let worst = 0;
    for (let c = 0; c < 0.06; c += h) {
      const s0 = (gradeFloor(graded(c + h), toe) - gradeFloor(graded(c), toe)) / h;
      const s1 = (gradeFloor(graded(c + 2 * h), toe) - gradeFloor(graded(c + h), toe)) / h;
      worst = Math.max(worst, Math.abs(s1 - s0));
    }
    expect(worst).toBeLessThan(0.05);
    // and the clipped grade fails the same check
    let clipped = 0;
    for (let c = 0; c < 0.06; c += h) clipped = Math.max(clipped, Math.abs((Math.max(0, graded(c + 2 * h)) - Math.max(0, graded(c + h))) / h - (Math.max(0, graded(c + h)) - Math.max(0, graded(c))) / h));
    expect(clipped).toBeGreaterThan(0.5);
  });

  it("leaves everything but the darkest channels as the engine grades them, and black stays black", () => {
    for (const g of [5 * toe, 0.05, 0.18, 1, 4]) expect(Math.abs(gradeFloor(g, toe) - g)).toBeLessThan(1e-4);
    expect(gradeFloor(graded(0), toe)).toBeLessThan(1e-3);
    for (let g = -0.05; g < 0.05; g += 0.001) expect(gradeFloor(g, toe)).toBeGreaterThan(0);
  });

  it('the compose shader carries the engine grade with the floor in place of the clip', () => {
    for (const k of ['color *= tint;', 'mix(vec3(grey), color, sat)', 'mix(vec3(0.5), color, con)', 'uniform float look_gradeToe;', 'log(1.0 + exp(-abs(g) / s))']) expect(GRADING_GLSL).toContain(k);
  });
});
