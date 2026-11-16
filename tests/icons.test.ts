// Look 5.2: no emoji reach the screen. Game strings may still use emoji as placeholders, but every one of them
// must map to a drawn icon, and the HUD's iconize() must leave no emoji behind (text or attributes).
import { describe, expect, it } from 'vitest';
import { formatCost } from '../src/core/Economy';
import { EMOJI_ICONS, EMOJI_RE, ICONS, ROLE_ICONS, hasEmoji, iconize, plain } from '../src/ui/Icons';

/** Every source file's text (Vite glob import). */
const SOURCES = import.meta.glob(['../src/**/*.ts', '../src/**/*.css'], { query: '?raw', import: 'default', eager: true });
const base = (e: string) => e.replace(/️/g, '').split('‍')[0];

describe('Look 5.2 icon set', () => {
  const sources = Object.entries(SOURCES).filter(([p]) => !p.endsWith('Icons.ts'));

  it('every emoji used in game and HUD strings has an illustrated icon', () => {
    const missing = new Map<string, string>();
    for (const [p, text] of sources) for (const m of text.matchAll(EMOJI_RE)) if (!EMOJI_ICONS[base(m[0])]) missing.set(base(m[0]), p);
    expect([...missing].map(([e, p]) => `${e} (${p})`)).toEqual([]);
  });

  it('the stylesheet draws no emoji itself', () => {
    expect(hasEmoji(SOURCES['../src/ui/styles.css'])).toBe(false);
  });

  it('iconize leaves no emoji in text or attributes', () => {
    const all = Object.keys(EMOJI_ICONS).join(' ');
    const out = iconize(`<b title="🌸 chain">${all}</b><small>+12🌿 ⚡</small>`);
    expect(hasEmoji(out)).toBe(false);
    expect(out).toContain('title=" chain"');
    expect(out.match(/<svg/g)!.length).toBe(Object.keys(EMOJI_ICONS).length + 2);
    // Variation selectors are part of the emoji (☀️, ⚙️, 🌫️).
    expect(hasEmoji(iconize('☀️ ⚙️ 🌫️ 🏗️'))).toBe(false);
    expect(plain('🌸  Bloom chain ×3')).toBe('Bloom chain ×3');
  });

  it('every icon is a small, self-contained SVG on the 24-unit grid', () => {
    for (const [name, s] of Object.entries(ICONS)) {
      expect(s, name).toMatch(/^<svg class="icon" viewBox="0 0 24 24"[^>]*>.+<\/svg>$/);
      expect(s, name).not.toMatch(/NaN|undefined/);
      expect(s.length, name).toBeLessThan(3200);
    }
  });

  it('E18 role icons are in the set', () => {
    for (const r of ['restorer', 'gardener', 'scout', 'courier', 'spark', 'harvester']) expect(ICONS[ROLE_ICONS[r]], r).toBeTruthy();
  });

  it('a three-resource price renders as three icons side by side', () => {
    const html = iconize(formatCost({ biomass: 25, energy: 10, water: 5 }));
    expect(hasEmoji(html)).toBe(false);
    expect(html.match(/<svg/g)!.length).toBe(3);
    expect(html.replace(/<svg.*?<\/svg>/g, '·')).toBe('10· 5· 25·');
  });
});
