// #681 (E27.3): the far city skyline backdrop is gone (owner, 20 Nov 2026). The Old City is an island with real
// ruins around it; the backdrop towers floated at the horizon with nothing under them and stayed cream at night.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SKY } from '../src/data/sky';
import { ModelLibrary } from '../src/rendering/Models';

describe('no distant skyline (#681)', () => {
  it('the game builds no skyline and its code is gone', () => {
    expect(existsSync('src/rendering/Skyline.ts')).toBe(false);
    const game = readFileSync('src/app/Game.ts', 'utf8');
    expect(game).not.toMatch(/skyline/i);
    expect(Object.keys(SKY)).not.toContain('stone');
  });

  it('nothing in the sky layer writes depth, so the world always draws over it without a depth clear', () => {
    const sky = readFileSync('src/rendering/Sky.ts', 'utf8');
    expect(sky).toMatch(/m\.depthWrite = false;/);
    expect(sky).not.toMatch(/SkyDepthClear|CLEARFLAG_DEPTH/);
  });

  it('its models are kept in assets/raw/models/retired and never fetched at startup', () => {
    const retired = readdirSync('assets/raw/models/retired').filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4));
    expect(retired.sort()).toEqual(['skyline-bridge', 'skyline-cliff', 'skyline-dome', 'skyline-tower']);
    const startup = new Set(ModelLibrary.names());
    for (const n of retired) expect(startup.has(n), n).toBe(false);
  });
});
