import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TUTORIAL } from '../src/gameplay/ProgressionSystem';

/**
 * E20.2 (#285): the game speaks bloombot. Player-facing text never asks to tap or click a tile: bloombot walks up
 * and presses a key (or a pad button). Mouse words on HUD buttons and dev-only tools are not player instructions.
 */
const FILES = ['src/ui/Hud.ts', 'src/ui/AreaPanel.ts', 'src/gameplay/Advisor.ts', 'src/gameplay/ProgressionSystem.ts', 'src/gameplay/Milestones.ts', 'src/app/Game.ts'];
const WORD = /\b(tap|taps|tapped|tapping|click|clicks|clicked|clicking)\b/i;
/** Code, not text: event names and DOM calls. */
const CODE = /^(click|pointerdown|tap)$|addEventListener|\.click\(/;

function literals(src: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('E20.2: bloombot wording', () => {
  it('the tutorial lines never say tap or click', () => {
    for (const line of TUTORIAL) expect(line, line).not.toMatch(WORD);
  });

  it('player-facing strings in the HUD, advisor, objectives and game never say tap or click', () => {
    const bad: string[] = [];
    for (const f of FILES) {
      let src: string;
      try {
        src = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      for (const s of literals(stripComments(src))) if (WORD.test(s) && !CODE.test(s.trim())) bad.push(`${f}: ${s.slice(0, 90)}`);
    }
    expect(bad).toEqual([]);
  });
});

/**
 * E22.10 (#348): plain words and few numbers. Every string written for old-city rules (src/ui/words.ts) and every
 * string on the new UI pieces is free of the words the epic keeps off the screen, and of "/" used as a rate.
 * Game text that passes through `plainWords` under old-city rules loses biomass, full bloom, rates and ×N.
 */
describe('E22.10: plain words', () => {
  const strings = (v: unknown, out: string[] = []): string[] => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') out.push(String((v as (...a: unknown[]) => unknown)('Pylon', 'Pipeworks')), String((v as (...a: unknown[]) => unknown)(12, 20)));
    else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
    return out;
  };

  it('words.ts holds no banned word and no rate', async () => {
    const { WORDS, TIPS, RATE_SLASH, bannedIn } = await import('../src/ui/words');
    const all = [...strings(WORDS), ...TIPS];
    expect(TIPS.length).toBe(20);
    const bad = all.filter((s) => bannedIn(s).length || RATE_SLASH.test(s)).map((s) => `${s} (${bannedIn(s).join(', ')})`);
    expect(bad).toEqual([]);
  });

  it('the new UI pieces (prompt, menu, settings, objective) use none of them either', async () => {
    const { bannedIn } = await import('../src/ui/words');
    const bad: string[] = [];
    for (const f of ['src/ui/Menu.ts', 'src/ui/SettingsRows.ts', 'src/ui/SettingsScreen.ts', 'src/ui/Prompt.ts', 'src/ui/ObjectiveCard.ts', 'src/app/Interact.ts'])
      for (const s of literals(stripComments(readFileSync(f, 'utf8')))) {
        // code identifiers ('menu', '#prompt', CSS classes) aren't on screen; sentences with a capital or a space are
        if (!/[A-Z ]/.test(s) || /^[#.[]/.test(s)) continue;
        if (bannedIn(s).length) bad.push(`${f}: ${s.slice(0, 80)} (${bannedIn(s).join(', ')})`);
      }
    expect(bad).toEqual([]);
  });

  it('rewrites game text into plain words under old-city rules', async () => {
    const { plainWords, bannedIn } = await import('../src/ui/words');
    expect(plainWords('Spend biomass on machines')).toBe('Spend Greens on machines');
    expect(plainWords('Grow tiles to full bloom')).toBe('Grow tiles to in flower');
    expect(plainWords('Energy +71/min')).toBe('Energy');
    expect(plainWords('Biomass 23 · +4.5/min')).toBe('Greens 23');
    expect(plainWords('Chain ×12 restored')).toBe('Chain restored');
    for (const s of ['Spend biomass', 'Energy 3/s', 'Full bloom']) expect(bannedIn(plainWords(s))).toEqual([]);
  });

  it('bannedIn catches every banned word and the rate slash', async () => {
    const { bannedIn, BANNED } = await import('../src/ui/words');
    expect(bannedIn('Restore tiles 14/130 · reward at 20')).toEqual(['reward at']);
    expect(bannedIn('+71/min')).toContain('/min');
    expect(bannedIn('Bloom Frenzy ×3 combo')).toEqual(expect.arrayContaining(['Frenzy', 'combo', '×N']));
    expect(BANNED.length).toBe(23);
  });
});
