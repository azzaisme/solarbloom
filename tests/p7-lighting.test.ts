import { describe, expect, it } from 'vitest';
import { LOOK } from '../src/data/look';
import { readFileSync } from 'node:fs';
import { DAY_LIGHT, HAZE, LIGHT_PRESETS, SKY } from '../src/data/sky';
import { daylightAt, sunHeightAt } from '../src/gameplay/Clock';

// P7-E27 (#713): the Bright Day calibration lives in data/look.ts and data/sky.ts. These pin the brief's targets
// (docs/VISUAL_DIRECTION.md) so a later retune can't quietly bring back the yellow-white veil.

const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const sat = (hex: string) => {
  const c = rgb(hex);
  const mx = Math.max(...c);
  return mx ? (mx - Math.min(...c)) / mx : 0;
};

describe('P7-E27 Bright Day calibration', () => {
  it('a warm ivory sun (#FFF0D6 family) and a cool sky-blue fill (#C8DDF2 family)', () => {
    const [r, g, b] = rgb(LOOK.sun.color);
    expect(r).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThan(b);
    expect(sat(LOOK.sun.color)).toBeLessThan(0.2); // ivory, not peach (#ffdcaa was 0.33)
    const [fr, fg, fb] = rgb(LOOK.fill.color);
    expect(fb).toBeGreaterThan(fg);
    expect(fg).toBeGreaterThan(fr);
  });

  it('the grade adds no saturation or vibrance (they turned grass lime and timber orange) and only a faint warm tint', () => {
    for (const g of [LOOK.grade.warm, LOOK.grade.dead]) {
      expect(g.saturation).toBeLessThanOrEqual(1);
      expect(g.vibrance).toBeLessThanOrEqual(0.05);
    }
    expect(sat(LOOK.grade.warm.tint)).toBeLessThan(0.06);
  });

  it('the haze is a cool pale blue in every state, never cream', () => {
    for (const h of [...SKY.haze, LOOK.haze.color]) {
      const [r, , b] = rgb(h);
      expect(b, h).toBeGreaterThan(r);
    }
  });

  it('the haze starts and completes past the playable foreground (it was 8/6 → 56/76)', () => {
    for (const i of [0, 1]) {
      expect(HAZE.start[i]).toBeGreaterThanOrEqual(10);
      expect(HAZE.end[i]).toBeGreaterThan(HAZE.start[i] + 40);
    }
  });

  it('motes and shafts stay a whisper on every tier (90 motes at glow 3 and 5 shafts were part of the veil)', () => {
    const A = LOOK.atmosphere;
    for (const t of ['low', 'medium', 'high'] as const) {
      expect(A.motes[t]).toBeLessThanOrEqual(30);
      expect(A.shafts[t]).toBeLessThanOrEqual(1);
    }
    expect(A.moteGlow).toBeLessThan(2);
    expect(A.shaftGlow).toBeLessThanOrEqual(0.15);
  });
});

describe('P7-E27 cloud ring (owner, 23 Nov 2026)', () => {
  const R = LOOK.cloudRing;
  it('rings the revealed ground in at least the gate walls\' two rows, bigger and so taller', () => {
    expect(R.on).toBe(true);
    expect(R.rows).toBeGreaterThanOrEqual(2);
    expect(R.size).toBeGreaterThanOrEqual(1);
  });

  it('the walls breathe: a few small wisps rise and melt away over a few seconds, one dynamic batch', () => {
    const W = R.wisps;
    expect(W.count).toBeGreaterThan(0);
    expect(W.count).toBeLessThanOrEqual(24);
    expect(W.parts).toBeGreaterThanOrEqual(1);
    expect(W.size).toBeLessThan(1); // smaller than the cloud they leave
    expect(W.rise).toBeGreaterThan(0);
    expect(W.life[0]).toBeGreaterThan(1);
    expect(W.life[1]).toBeGreaterThan(W.life[0]);
    expect(W.reach).toBeGreaterThan(0);
  });
});

describe('P7-E27.6 lighting presets (#724)', () => {
  const el = (f: number) => DAY_LIGHT.sunLow + (DAY_LIGHT.sunHigh - DAY_LIGHT.sunLow) * sunHeightAt(f);
  it('Bright Day: full daylight with the sun 35–50° up', () => {
    const f = LIGHT_PRESETS.brightDay.f;
    expect(daylightAt(f)).toBe(1);
    expect(el(f)).toBeGreaterThanOrEqual(35);
    expect(el(f)).toBeLessThanOrEqual(50);
  });
  it('Golden Hour: still daylight, with the sun low enough to turn warm', () => {
    const f = LIGHT_PRESETS.goldenHour.f;
    expect(daylightAt(f)).toBeGreaterThan(0.5);
    expect(sunHeightAt(f)).toBeLessThan(DAY_LIGHT.warmBelow);
  });
  it('Moonlit Garden: night', () => {
    expect(daylightAt(LIGHT_PRESETS.moonlitGarden.f)).toBeLessThan(0.05);
  });
  it('the fixed-camera shots use the same three moments', () => {
    const src = readFileSync('tests/e2e/lib/p7-scene.mjs', 'utf8');
    const m = /TIMES = \{ day: ([\d.]+), golden: ([\d.]+), night: ([\d.]+) \}/.exec(src)!;
    expect(m.slice(1).map(Number)).toEqual([LIGHT_PRESETS.brightDay.f, LIGHT_PRESETS.goldenHour.f, LIGHT_PRESETS.moonlitGarden.f]);
  });
});
