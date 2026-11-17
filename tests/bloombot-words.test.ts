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
