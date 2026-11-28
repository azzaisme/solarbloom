import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREDITS } from '../src/data/credits';
import { creditsHtml, settingsRows } from '../src/ui/SettingsRows';

describe('credits', () => {
  const doc = readFileSync('docs/art/CREDITS.md', 'utf8');

  it('the game credits every work docs/art/CREDITS.md lists, and nothing it does not', () => {
    const rows = doc.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Work') && !l.startsWith('|---'));
    expect(rows.length).toBe(CREDITS.length);
    for (const c of CREDITS) {
      const row = rows.find((r) => r.includes(c.title));
      expect(row, c.title).toBeDefined();
      for (const part of [c.author, c.source, c.licence]) expect(row, `${c.title}: ${part}`).toContain(part);
    }
  });

  it('shows each credit as the licence asks: title, author, source and licence', () => {
    const html = creditsHtml();
    for (const c of CREDITS) for (const part of [c.title, c.author, c.source, c.licence, c.licenceUrl]) expect(html).toContain(part);
  });

  it('on the Game tab, on the title screen and in game', () => {
    for (const inGame of [false, true]) {
      const rows = settingsRows('game', { inGame, debug: false, stats: '<p>stats</p>' });
      expect(rows.some((r) => r.kind === 'heading' && r.label === 'Credits')).toBe(true);
      expect(rows.some((r) => r.kind === 'html' && r.html === creditsHtml())).toBe(true);
    }
  });
});
