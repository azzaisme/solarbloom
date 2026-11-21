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

  it('bannedIn catches every banned word and the rate slash', async () => {
    const { bannedIn, BANNED } = await import('../src/ui/words');
    expect(bannedIn('Restore tiles 14/130 · reward at 20')).toEqual(['reward at']);
    expect(bannedIn('+71/min')).toContain('/min');
    expect(bannedIn('Bloom Frenzy ×3 combo')).toEqual(expect.arrayContaining(['Frenzy', 'combo', '×N']));
    expect(BANNED.length).toBe(23);
  });
});

/**
 * #606 (E24): when something is in the way, the game says what to do, in plain words. No "tier" anywhere a player
 * reads it: the fountain's steps go by their place, the way its panel counts them ("Step 2").
 */
describe('#606: plain words when something is blocked', () => {
  it('every gate says what is in the way and what to do, and its clouds say where it is', async () => {
    const { bannedIn } = await import('../src/ui/words');
    const { REGIONS, gateText } = await import('../src/data/oldcity');
    const { PARK } = await import('../src/core/Areas');
    const sim = new Sim(createInitialState(7));
    sim.areas.clear(PARK, true); // the regions beside the park are revealed, each behind its gate
    for (const r of REGIONS) {
      const text = gateText(r.gate);
      expect(text, r.id).toMatch(/^[A-Z][^.]*\.\s[A-Z].*\.$/); // what is there. What to do.
      expect(bannedIn(text), text).toEqual([]);
      expect(text, text).not.toMatch(/—|\(fountain/);
      const why = sim.gates.problem(r.gate);
      if (why) expect(bannedIn(why), why).toEqual([]);
      if (sim.areas.sealed(r.id)) {
        const seal = sim.areas.sealText(r.id);
        expect(seal).toBe(`${r.name} is behind the clouds. ${r.gate.how}`);
        expect(bannedIn(seal), seal).toEqual([]);
      }
    }
    expect(bannedIn(sim.areas.sealText('bs_2_-1'))).toEqual([]);
  });

  it('a pry barricade tells a new player how to get Pry', async () => {
    const { REGIONS } = await import('../src/data/oldcity');
    const sim = new Sim(createInitialState(7));
    const elder = REGIONS.find((r) => r.id === 'elderGrove')!;
    expect(sim.gates.problem(elder.gate)).toBe('Rubble blocks the way. Wake the fountain and Bloombot will learn to pry it open.');
  });

  it('a machine that waits on the fountain says which step, never "tier"', async () => {
    const { bannedIn } = await import('../src/ui/words');
    const { MACHINE_RECIPES } = await import('../src/data/crafting');
    const sim = new Sim(createInitialState(7));
    const labels = MACHINE_RECIPES.map((r) => sim.crafting.unlockLabel(r.unlock)).filter(Boolean);
    expect(labels).toContain('🔒 Fountain step 2');
    for (const l of labels) expect(bannedIn(l), l).toEqual([]);
    for (const r of MACHINE_RECIPES) {
      if (!r.builds) continue;
      const c = sim.build.check(r.builds, 'g', 8, 8);
      if (!c.ok) expect(bannedIn(c.reason ?? ''), `${r.builds}: ${c.reason}`).toEqual([]);
    }
  });

  it('no refusal a player can meet uses a banned word (pulse, build, salvage, gather, wake, craft)', () => {
    const files = ['src/gameplay/RestorationSystem.ts', 'src/gameplay/BuildSystem.ts', 'src/gameplay/SalvageSystem.ts', 'src/gameplay/GatherSystem.ts', 'src/gameplay/LandmarkSystem.ts', 'src/gameplay/NightFinds.ts', 'src/gameplay/Crafting.ts', 'src/gameplay/Research.ts', 'src/gameplay/GateSystem.ts', 'src/gameplay/AreaSystem.ts', 'src/gameplay/DroneRoles.ts', 'src/data/oldcity.ts', 'src/data/salvage.ts', 'src/app/OldCity.ts'];
    const bad: string[] = [];
    return import('../src/ui/words').then(({ bannedIn }) => {
      for (const f of files)
        for (const s of literals(stripComments(readFileSync(f, 'utf8')))) {
          // sentences only: code identifiers have no space and no capital
          if (!/[A-Z]/.test(s) || !/ /.test(s)) continue;
          const words = bannedIn(s.replace(/\$\{[^}]*\}/g, 'X'));
          if (words.length) bad.push(`${f}: ${s.slice(0, 90)} (${words.join(', ')})`);
        }
      expect(bad).toEqual([]);
    });
  });
});
