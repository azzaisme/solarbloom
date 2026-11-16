// Look 5.2: no emoji reach the screen. Game strings may still use emoji as placeholders, but every one of them
// must map to a drawn icon, and the HUD's iconize() must leave no emoji behind (text or attributes).
import { describe, expect, it } from 'vitest';
import { formatCost } from '../src/core/Economy';
import indexHtml from '../index.html?raw';
import { EMOJI_ICONS, EMOJI_RE, FAVICON_SVG, ICONS, PAINTED, ROLE_ICONS, hasEmoji, iconize, plain } from '../src/ui/Icons';

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
    expect(out.match(/<svg|<img/g)!.length).toBe(Object.keys(EMOJI_ICONS).length + 2);
    // Variation selectors are part of the emoji (☀️, ⚙️, 🌫️).
    expect(hasEmoji(iconize('☀️ ⚙️ 🌫️ 🏗️'))).toBe(false);
    expect(plain('🌸  Bloom chain ×3')).toBe('Bloom chain ×3');
  });

  it('the main icons are painted PNGs (1× and 2×); the rest are small SVGs on the 24-unit grid', () => {
    for (const n of ['energy', 'water', 'biomass', 'pulse', 'inspect', 'build', 'harvest', 'upgrades', 'home', 'garden', 'cat', 'frenzy']) expect(PAINTED, n).toContain(n);
    for (const [name, s] of Object.entries(ICONS)) {
      if ((PAINTED as string[]).includes(name)) {
        expect(s, name).toMatch(/^<img class="icon painted" src="[^"]+@1x\.png" srcset="[^"]+\.png 2x" alt="" aria-hidden="true"/);
        continue;
      }
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
    expect(html.match(/<img/g)!.length).toBe(3);
    expect(html.replace(/<img[^>]*>/g, '·')).toBe('10· 5· 25·');
  });

  it('the favicon is the logo mark (Look 5.3)', () => {
    const href = /<link rel="icon" href="data:image\/svg\+xml,([^"]*)"/.exec(indexHtml)![1];
    expect(decodeURIComponent(href).replace(/'/g, '"')).toBe(FAVICON_SVG);
  });
});
