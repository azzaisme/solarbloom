// Look 2.1: every colour in src/rendering comes from PALETTE (src/rendering/Palette.ts, docs/art/palette.md).
// A hex literal anywhere else in the renderers fails this test: add a named swatch to the palette instead.
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../src/rendering/Palette';

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
