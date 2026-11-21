// #635: in fog the skyline fades into the fog colour, and the world always draws over it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SKYLINE_FOG } from '../src/data/sky';
import { WEATHER } from '../src/data/weather';
import { skylineVeil, veiled } from '../src/rendering/Skyline';

describe('the skyline in fog (#635)', () => {
  it('clear weather leaves the skyline as it is', () => {
    for (const k of ['sunny', 'cloudy', 'wind'] as const) expect(skylineVeil(WEATHER[k].view)).toBe(0);
  });

  it('fog veils it most, leaving a faint outline; rain and storms veil it part way', () => {
    const fog = skylineVeil(WEATHER.fog.view);
    expect(fog).toBeCloseTo(SKYLINE_FOG.max);
    expect(fog).toBeGreaterThan(0.8);
    expect(fog).toBeLessThan(1);
    const rain = skylineVeil(WEATHER.rain.view);
    const storm = skylineVeil(WEATHER.storm.view);
    expect(rain).toBeGreaterThan(0);
    expect(rain).toBeLessThan(storm);
    expect(storm).toBeLessThan(fog);
    // never past the max, however short the view
    expect(skylineVeil(0)).toBeCloseTo(SKYLINE_FOG.max);
  });

  it('veiling mixes a colour toward the fog colour', () => {
    const c = [0.2, 0.4, 0.6];
    const fog = [0.8, 0.8, 0.8];
    expect(veiled(c, fog, 0)).toEqual(c);
    expect(veiled(c, fog, 1)).toEqual(fog);
    const half = veiled(c, fog, 0.5);
    [0.5, 0.6, 0.7].forEach((v, i) => expect(half[i]).toBeCloseTo(v));
  });

  it('the depth clear after the sky is done by hand, since CameraFrame ignores a later layer\'s clear flags', () => {
    const src = readFileSync('src/rendering/Sky.ts', 'utf8');
    expect(src).toMatch(/'prerender:layer'/);
    expect(src).toMatch(/CLEARFLAG_DEPTH/);
    const game = readFileSync('src/app/Game.ts', 'utf8');
    expect(game).toMatch(/skyline\.veil = skylineVeil\(/);
  });
});
