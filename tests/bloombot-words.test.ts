import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { FIRST_STEPS, oldCityHint } from '../src/ui/OldCityGuide';

/**
 * E20.2 (#285): the game speaks bloombot. Player-facing text never asks to tap or click a tile: bloombot walks up
 * and presses a key (or a pad button). Mouse words on HUD buttons and dev-only tools are not player instructions.
 */
const FILES = ['src/ui/Hud.ts', 'src/ui/AreaPanel.ts', 'src/gameplay/Advisor.ts', 'src/gameplay/ProgressionSystem.ts', 'src/gameplay/Milestones.ts', 'src/app/Game.ts', 'src/ui/OldCityGuide.ts', 'src/ui/OldCityPanel.ts', 'src/app/OldCity.ts', 'src/data/oldcity.ts', 'src/gameplay/KeeperSystem.ts', 'src/gameplay/LandmarkSystem.ts', 'src/gameplay/GateSystem.ts', 'src/gameplay/SalvageSystem.ts'];
/** E21.12: the first fifteen minutes never speak of rates or upgrades either. */
const OLD_CITY_WORD = /\b(tap|taps|click|clicks|rate|rates|upgrade|upgrades|per second|\/s)\b/i;
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
  it('the Old City\'s first-fifteen-minutes hints never say tap, click, rates or upgrades', () => {
    const sim = new Sim(createInitialState(7));
    for (let step = 0; step <= FIRST_STEPS; step++) {
      const line = oldCityHint(sim, step, (a) => (a === 'pulse' ? 'E' : 'Q')).text;
      expect(line, line).not.toMatch(OLD_CITY_WORD);
    }
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
 * E22.10 (#348): plain words and few numbers. Every string written for the game (src/ui/words.ts) and every
 * string on the new UI pieces is free of the words the epic keeps off the screen, and of "/" used as a rate.
 * Game text that passes through `plainWords` loses biomass, full bloom, rates and ×N.
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

  it("the new UI pieces (prompt, menu, settings) use none of them either (the objective card's old-city words are in words.ts)", async () => {
    const { bannedIn } = await import('../src/ui/words');
    const bad: string[] = [];
    for (const f of ['src/ui/Menu.ts', 'src/ui/SettingsRows.ts', 'src/ui/SettingsScreen.ts', 'src/ui/Prompt.ts', 'src/app/Interact.ts'])
      for (const s of literals(stripComments(readFileSync(f, 'utf8')))) {
        // code identifiers ('menu', '#prompt', CSS classes) aren't on screen; sentences with a capital or a space are
        if (!/[A-Z ]/.test(s) || /^[#.[]/.test(s)) continue;
        if (bannedIn(s).length) bad.push(`${f}: ${s.slice(0, 80)} (${bannedIn(s).join(', ')})`);
      }
    expect(bad).toEqual([]);
  });

  it('rewrites game text into plain words', async () => {
    const { plainWords, bannedIn } = await import('../src/ui/words');
    expect(plainWords('Spend biomass on machines')).toBe('Spend Greens on machines');
    expect(plainWords('Grow tiles to full bloom')).toBe('Grow tiles to in flower');
    expect(plainWords('Energy +71/min')).toBe('Energy');
    expect(plainWords('Biomass 23 · +4.5/min')).toBe('Greens 23');
    expect(plainWords('Chain ×12 restored')).toBe('Chain restored');
    for (const s of ['Spend biomass', 'Energy 3/s', 'Full bloom']) expect(bannedIn(plainWords(s))).toEqual([]);
  });

  it('#610: a lock waiting on the fountain names the fountain step, never a tier', async () => {
    const { bannedIn } = await import('../src/ui/words');
    const { fountainLock } = await import('../src/gameplay/Crafting');
    const { unlockText } = await import('../src/ui/BuildCatalog');
    expect(fountainLock(1)).toBe('🔒 Wake the fountain first');
    expect(fountainLock(2)).toBe('🔒 Reach fountain step 2: The pump turns');
    expect(unlockText({ tier: 1 })).toBe('Wake the fountain');
    expect(unlockText({ tier: 3 })).toBe('Reach fountain step 3');
    const sim = new Sim(createInitialState(7));
    for (let t = 1; t <= 5; t++)
      for (const s of [fountainLock(t), unlockText({ tier: t }), sim.crafting.unlockLabel({ tier: t })]) {
        expect(s, s).not.toMatch(/\btier\b/i);
        expect(bannedIn(s), s).toEqual([]);
      }
  });

  it('#610: refusals and statuses bloombot shows use none of the banned words', async () => {
    const { bannedIn } = await import('../src/ui/words');
    const bad: string[] = [];
    const files = ['src/gameplay/BuildSystem.ts', 'src/gameplay/Crafting.ts', 'src/gameplay/RestorationSystem.ts', 'src/gameplay/SalvageSystem.ts', 'src/gameplay/DroneRoles.ts', 'src/gameplay/LandmarkSystem.ts', 'src/gameplay/KeeperSystem.ts', 'src/gameplay/WaterPipes.ts', 'src/gameplay/Cozy.ts', 'src/gameplay/GatherSystem.ts', 'src/gameplay/NightFinds.ts', 'src/ui/BuildCatalog.ts', 'src/ui/AreaPanel.ts', 'src/ui/Hotbar.ts'];
    for (const f of files)
      for (const lit of literals(stripComments(readFileSync(f, 'utf8')))) {
        // the words, not the code between ${ and } (a `t.tier` there is never on screen)
        let s = lit;
        for (let i = 0; i < 4; i++) s = s.replace(/\$\{[^{}]*\}/g, '');
        if (!/[A-Z ]/.test(s) || /^[#.[]/.test(s)) continue;
        if (bannedIn(s).length) bad.push(`${f}: ${s.slice(0, 80)} (${bannedIn(s).join(', ')})`);
      }
    expect(bad).toEqual([]);
  });

  it('bannedIn catches every banned word and the rate slash', async () => {
    const { bannedIn, BANNED } = await import('../src/ui/words');
    expect(bannedIn('Restore tiles 14/130 · reward at 20')).toEqual(['reward at']);
    expect(bannedIn('+71/min')).toContain('/min');
    expect(bannedIn('Bloom Frenzy ×3 combo')).toEqual(expect.arrayContaining(['Frenzy', 'combo', '×N']));
    expect(BANNED.length).toBe(23);
  });
});
