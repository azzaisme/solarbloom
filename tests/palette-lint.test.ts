// Look 2.1: every colour in src/rendering comes from PALETTE (src/rendering/Palette.ts, docs/art/palette.md).
// A hex literal anywhere else in the renderers fails this test: add a named swatch to the palette instead.
import { describe, expect, it } from 'vitest';
import { PALETTE, flowerAt, grassTone } from '../src/rendering/Palette';

declare global {
  interface ImportMeta {
    glob(pattern: string, opts: { query: string; import: string; eager: true }): Record<string, string>;
  }
}
const SOURCES = import.meta.glob('../src/rendering/*.ts', { query: '?raw', import: 'default', eager: true });
const HEX = /['"`]#[0-9a-fA-F]{3,8}['"`]/g;

describe('palette lint', () => {
  it('has no hex colour literals in src/rendering outside Palette.ts', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(SOURCES)) {
      const f = path.split('/').pop()!;
      if (f === 'Palette.ts') continue;
      src.split('\n').forEach((line, i) => {
        for (const m of line.match(HEX) ?? []) offenders.push(`${f}:${i + 1} ${m}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('holds only valid hex colours', () => {
    const bad: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'string') {
        if (v !== '' && !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) bad.push(`${path}=${v}`);
      } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(PALETTE, 'PALETTE');
    expect(bad).toEqual([]);
  });
});

describe('palette helpers (Look 2.2, 2.4)', () => {
  it('flower beds follow the weighted mix with pink leading', () => {
    const n: Record<string, number> = {};
    let total = 0;
    for (let x = 0; x < 96; x++)
      for (let z = 0; z < 96; z++)
        for (let c = 0; c < 2; c++) {
          const k = flowerAt(x, z, c);
          n[k] = (n[k] ?? 0) + 1;
          total++;
        }
    const f = PALETTE.flowers;
    const share = (...cs: string[]) => cs.reduce((a, c) => a + (n[c] ?? 0), 0) / total;
    expect(share(f.pink, f.magenta)).toBeGreaterThan(0.32);
    expect(share(f.pink, f.magenta)).toBeLessThan(0.48);
    expect(share(f.white)).toBeGreaterThan(0.12);
    expect(share(f.lavender, f.purple)).toBeGreaterThan(0.12);
    expect(share(f.yellow)).toBeGreaterThan(0.08);
    expect(share(f.orange)).toBeLessThan(0.1);
    for (const k of Object.keys(n)) if (k !== f.pink && k !== f.magenta) expect(share(f.pink, f.magenta)).toBeGreaterThan(share(k));
  });

  it('flower colours come in drifts: neighbouring tiles usually match', () => {
    let same = 0;
    let pairs = 0;
    for (let x = 0; x < 64; x++)
      for (let z = 0; z < 64; z++) {
        same += flowerAt(x, z) === flowerAt(x + 1, z) ? 1 : 0;
        pairs++;
      }
    // Random picks from the mix would match about 20% of the time.
    expect(same / pairs).toBeGreaterThan(0.45);
  });

  it('grass tones vary without a repeating pattern and stay green', () => {
    const tones = new Set<string>();
    let rowRepeats = 0;
    for (let x = 0; x < 32; x++)
      for (let z = 0; z < 32; z++) {
        const c = grassTone(2, x, z);
        tones.add(c);
        if (c === grassTone(2, x + 3, z) && c === grassTone(2, x + 6, z)) rowRepeats++;
        const v = parseInt(c.slice(1), 16);
        const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
        expect(g).toBeGreaterThan(r);
        expect(g).toBeGreaterThan(b);
      }
    expect(tones.size).toBeGreaterThan(20);
    expect(rowRepeats).toBeLessThan(40);
  });
});
