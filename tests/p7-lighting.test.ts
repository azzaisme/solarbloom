import { describe, expect, it } from 'vitest';
import { laidHedge } from '../src/rendering/HedgeGen';
import { LOOK } from '../src/data/look';
import { readFileSync } from 'node:fs';
import { DAY_LIGHT, HAZE, LIGHT_PRESETS, SKY } from '../src/data/sky';
import { daylightAt, sunHeightAt } from '../src/gameplay/Clock';
import { DAY } from '../src/data/time';

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

describe('P7-E27.4 grounding (#722)', () => {
  it('SSAO is a contact shadow, not a blanket: a tight radius (it was 0.6–2 tiles and darkened open lawn ~22%)', () => {
    const A = LOOK.ssao;
    expect(A.maxRadius).toBeLessThanOrEqual(0.8);
    expect(A.minRadius).toBeLessThanOrEqual(A.maxRadius);
    expect(A.intensity).toBeLessThanOrEqual(1);
    expect(LOOK.tiers.high.ssao).toBe(true);
  });
});

describe('#hedge-line: sealed and hidden ground is walled in by a dead laid hedge (owner, 27 Nov 2026)', () => {
  const H = LOOK.hedgeLine;
  it('walls in the revealed ground, in front of the fog curtain rather than buried in it', () => {
    expect(H.ring).toBe(true);
    expect(H.height).toBeGreaterThanOrEqual(0.8);
    expect(H.inset).toBeLessThanOrEqual(0.15);
  });

  it('is bare dead wood, twisting and never the same twice: no leaves, nothing round it has been revived', () => {
    const a = laidHedge(0);
    const b = laidHedge(5);
    expect(a.leafStarts).toBeUndefined();
    expect(a.tris).not.toBe(b.tris);
    // tall enough to read as a wall (the binding at about 1.3, dead whips above it)
    expect(a.height).toBeGreaterThan(1.2);
    expect(a.tris).toBeLessThan(2500); // a metre of it, many metres round an area
  });

  it('runs on across the entrance, a locked forcefield in front of it between two big dead trees, and withers back in a couple of seconds', () => {
    expect(H.gap).toBeGreaterThan(0);
    expect(H.field.front).toBeGreaterThan(0.2); // clear of the hedge's stems
    expect(H.field.height).toBeGreaterThan(1);
    expect(H.field.opacity).toBeGreaterThan(0);
    expect(H.tree.scale).toBeGreaterThan(0.3);
    expect(H.leave).toBeGreaterThan(1);
    expect(H.leave).toBeLessThan(5);
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
    // an authored look, not a filter: the key light is well into its warm colour and the sky's dusk band has begun
    const sm = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    expect(1 - sm(sunHeightAt(f) / DAY_LIGHT.warmBelow)).toBeGreaterThan(0.4);
    const edge = Math.min(Math.abs(f - DAY.dayShare), f, 1 - f);
    expect(1 - sm(edge / (DAY.twilight * DAY_LIGHT.duskSpan))).toBeGreaterThan(0.25);
    // Bright Day has neither
    expect(1 - sm(sunHeightAt(LIGHT_PRESETS.brightDay.f) / DAY_LIGHT.warmBelow)).toBe(0);
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
