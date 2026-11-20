// Look 5.11 / E23.11: text contrast on the HUD's glass meets WCAG AA. The tokens are read from styles.css, the glass is
// composited over the brightest and darkest scenes it can sit on (white and black), and each text colour is
// checked against both: 4.5:1 for body text, 3:1 for large display text (WCAG 1.4.3).
import { describe, expect, it } from 'vitest';
import css from '../src/ui/styles.css?raw';

const root = /:root\s*\{([^}]*)\}/.exec(css)![1];
const contrastBlock = /body\.contrast\s*\{([^}]*)\}/.exec(css)![1];
function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const T = tokens(root);
const TC = { ...T, ...tokens(contrastBlock) };

type RGBA = [number, number, number, number];
function parse(v: string, t: Record<string, string>): RGBA {
  v = v.replace(/var\(--glass-rgb\)/, t['glass-rgb']);
  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  if (ref) return parse(t[ref[1]], t);
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgb) {
    const p = rgb[1].split(',').map((x) => Number(x.trim()));
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  throw new Error(`cannot read colour ${v}`);
}
const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGBA;
const lum = (c: RGBA) => {
  const f = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const ratio = (a: RGBA, b: RGBA) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const WHITE: RGBA = [255, 255, 255, 1];
const BLACK: RGBA = [0, 0, 0, 1];

/** Text tokens and the contrast each must reach (display text at 18.66 px bold+ counts as large). */
const TEXT: [string, number][] = [
  ['text', 4.5],
  ['text-strong', 4.5],
  ['text-soft', 4.5],
  ['gold', 4.5],
  ['gold-hi', 4.5],
  ['energy', 4.5],
  ['water', 4.5],
  ['biomass', 4.5],
  ['bad', 4.5],
  ['good', 4.5],
  ['cyan-hi', 4.5],
  ['text-dim', 3], // disabled buttons only (WCAG exempts inactive controls; still 3:1)
];

function audit(t: Record<string, string>, glasses: string[]) {
  const rows: string[] = [];
  for (const g of glasses) {
    for (const scene of [WHITE, BLACK]) {
      let bg = over(parse(t[g], t), scene);
      // Cards and tiles add a pale layer on the glass: check on that too.
      const card = over(parse(t['glass-hi-2'], t), bg);
      for (const [name, need] of TEXT) {
        const c = parse(t[name], t);
        for (const [where, b] of [[g, bg], [`${g}+card`, card]] as const) {
          const r = ratio(c, b);
          if (r < need) rows.push(`${name} on ${where} over ${scene === WHITE ? 'white' : 'black'}: ${r.toFixed(2)} < ${need}`);
        }
      }
    }
  }
  return rows;
}

describe('HUD text contrast on glass (Look 5.11)', () => {
  it('meets WCAG AA on every glass, over a white and a black scene', () => {
    expect(audit(T, ['glass', 'glass-strong', 'glass-solid'])).toEqual([]);
  });
  it('also in high contrast mode', () => {
    expect(audit(TC, ['glass', 'glass-strong'])).toEqual([]);
  });
  it('button labels are AA on their fills', () => {
    // E23.11 Sunlit Glass: dark ink on sun buttons, white on the deep leaf of the main button.
    const sun = [parse('#ffd65c', T), parse('#f3b22a', T)];
    const leaf = [parse('#2c8237', T), parse('#236b2c', T)];
    for (const c of sun) expect(ratio(parse(T['ink-dark'], T), c)).toBeGreaterThanOrEqual(4.5);
    for (const c of leaf) expect(ratio(parse(T['ink-green'], T), c)).toBeGreaterThanOrEqual(4.5);
    // The keycaps: dark letters on white; the careful (clay) choice in clay ink on its soft fill.
    expect(ratio(parse(T['key-ink'], T), parse(T['key-bg'], T))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(parse(T['clay-ink'], T), parse(T['clay-soft'], T))).toBeGreaterThanOrEqual(4.5);
    // Each colour's ink on its own soft fill (chips and badges).
    for (const k of ['leaf', 'sun', 'sky']) expect(ratio(parse(T[k + '-ink'], T), parse(T[k + '-soft'], T))).toBeGreaterThanOrEqual(4.5);
  });
  it('the gradients the buttons use are the ones checked above', () => {
    expect(T['btn-gold']).toBe('linear-gradient(180deg, #ffd65c, #f3b22a)');
    expect(T['btn-green']).toBe('linear-gradient(180deg, #2c8237, #236b2c)');
  });
  it('every ink reads on every paper it sits on (E23.11: cards, tiles, chips, the quiet labels)', () => {
    const rows: string[] = [];
    for (const ink of ['ink', 'ink-2', 'ink-3', 'text-dim', 'leaf-ink', 'sun-ink', 'sky-ink', 'clay-ink'])
      for (const bg of ['paper', 'paper-2', 'paper-3']) {
        const r = ratio(parse(T[ink], T), parse(T[bg], T));
        if (r < 4.5) rows.push(`${ink} on ${bg}: ${r.toFixed(2)}`);
      }
    for (const ink of ['ink', 'ink-2', 'ink-3'])
      for (const bg of ['leaf-soft', 'sun-soft', 'sky-soft', 'clay-soft']) {
        const r = ratio(parse(T[ink], T), parse(T[bg], T));
        if (r < 4.5) rows.push(`${ink} on ${bg}: ${r.toFixed(2)}`);
      }
    expect(rows).toEqual([]);
  });
  it('the title screen: the ink on its frosted strip and the white note on its pill, over any painting', () => {
    for (const scene of [WHITE, BLACK]) {
      expect(ratio(parse(T.ink, T), over(parse(T['veil-strip'], T), scene))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(parse(T.on, T), over(parse(T['note-bg'], T), scene))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
