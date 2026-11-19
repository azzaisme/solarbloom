import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable, placeFixed } from '../src/core/GameState';
import { TUNING } from '../src/data/tuning';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { catSpots, visitorSlots } from '../src/rendering/FaunaPlan';
import { collection, itemCells, requestRows } from '../src/ui/BackpackModel';
import { componentRows, decorRows, machineRows } from '../src/ui/CraftTable';
import { oldCityHint } from '../src/ui/OldCityGuide';
import { TIPS } from '../src/ui/words';
import * as journal from '../src/data/journal';
import * as oldcity from '../src/data/oldcity';
import * as photo from '../src/data/photo';
import * as time from '../src/data/time';
import * as crops from '../src/data/crops';
import * as research from '../src/data/research';
import * as lights from '../src/data/lights';
import * as items from '../src/data/items';
import * as weather from '../src/data/weather';
import * as salvage from '../src/data/salvage';
import * as crafting from '../src/data/crafting';
import * as pulse from '../src/data/pulse';
import * as rest from '../src/data/rest';
import * as water from '../src/data/water';
import * as charge from '../src/data/charge';
import * as unlocks from '../src/data/unlocks';
import { CAT_DECOR, DECOR_OPTIONS, PLOT_OPTIONS } from '../src/data/cozy';
import { openNextGoal } from './helpers';

SaveService.clock = () => 0;

/**
 * E23.12.3 (#530, epic rule 8): the Lucky Cats stay hidden. Before bloombot finds its first cat, nothing the player
 * can see shows, names or hints at one: no paw prints, meows, tooltips, wildlife cats, stats, collection entries,
 * tips, Keeper lines, journal pages, photo-mode names or night finds. This file is the audit: it reads every
 * player-facing string E23 added and every system that could point at a cat, and it fails on a single hint.
 */

/** A word that names or hints at a cat. */
export const CAT_WORD = /\b(cats?|kitt(?:y|en|ens)|meows?|paws?|pawprints?|whiskers?|purr\w*)\b|🐱|🐈|🐾|😺/i;

/** Every string inside a value (objects and arrays, all the way down). */
function strings(v: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object' && !seen.has(v)) {
    seen.add(v);
    for (const x of Array.isArray(v) ? v : Object.values(v)) strings(x, out, seen);
  }
  return out;
}

/** The strings that hint at a cat. */
const hints = (list: string[]) => list.filter((s) => CAT_WORD.test(s));

/** The fountain is awake and two areas grown (the city has nooks), and a cat has hidden long past its paw prints. */
function hidingCat(seed: number): Sim {
  const sim = new Sim(createInitialState(seed));
  sim.state.progression.coreActivated = true;
  sim.state.salvage!.tier = 1;
  sim.areas.clear(PARK, true);
  for (let grown = 0; grown < 3; grown++) {
    const id = grown ? openNextGoal(sim)! : PARK;
    for (const t of sim.areas.tiles(id)) {
      if (!isRestorable(t, sim.state.machines) || t.ground === 'restored') continue;
      t.ground = 'restored';
      t.bloom = 1;
      t.pollution = 0;
      sim.grid.touch(t);
    }
    sim.areas.clear(id, true);
  }
  // where wildlife cats would come: a bench and a rug in the park, and finished machines on restored ground
  const cozy = new Cozy(sim);
  sim.state.salvage!.decorMade = ['bench', 'rug'];
  const open = sim.areas.tiles(PARK).filter((t) => !cozy.canDecorate('bench', GROUND, t.x, t.z));
  for (const [i, kind] of ['bench', 'rug', 'bench', 'rug'].entries()) expect(cozy.placeDecor(kind, 0, GROUND, open[i * 3].x, open[i * 3].z)).toBeUndefined();
  const ground = sim.areas.revealed().flatMap((id) => sim.areas.tiles(id)).filter((t) => t.ground === 'restored' && !t.blocked && !t.occupantId);
  const step = Math.max(1, Math.floor(ground.length / 24));
  for (let i = 0; i < 24 && i * step < ground.length; i++) {
    const t = ground[i * step];
    const m = placeFixed(sim.state, GROUND, 'solar', t.x, t.z, 1);
    t.occupantId = m.id;
  }
  expect(sim.cat.spawn()).toBe(true);
  sim.state.time += TUNING.cat.hintAfter * 4;
  return sim;
}

/** Every player-facing string a game in this state can show (the panels, the guide, the backpack, the table). */
function visible(sim: Sim): string[] {
  const cozy = new Cozy(sim);
  return [
    ...strings(collection(sim)),
    ...strings(itemCells(sim)),
    ...strings(requestRows(sim)),
    ...strings(componentRows(sim)),
    ...strings(machineRows(sim)),
    ...strings(decorRows(sim)),
    ...strings(cozy.decorChoices().filter((c) => !c.unlocked).map((c) => c.hint)),
    ...strings(cozy.decorChoices().filter((c) => c.unlocked).map((c) => [c.option.name, c.option.blurb])),
    oldCityHint(sim, 7, () => 'E').text,
    sim.advisor.suggest().text,
    sim.metrics.summary(),
  ];
}

describe('E23.12.3: the cats stay hidden until one is found (audit)', () => {
  it('the check itself catches a planted hint', () => {
    for (const planted of ['🐾 Paw prints lead north', 'A Lucky Cat is hiding', 'You hear a meow', 'whiskers in the hedge', 'Cats: 0']) expect(hints([planted]), planted).toEqual([planted]);
    for (const clean of ['Scatter seeds', 'Catch the light', 'A category of crops', 'Educate', 'Pawn shop']) expect(hints([clean]), clean).toEqual([]);
  });

  it("E23's words name no cat: tips, Keepers' lines, journal pages, photo mode, night finds, crops, research, lights, items", () => {
    const modules = { journal, oldcity, photo, time, crops, research, lights, items, weather, salvage, crafting, pulse, rest, water, charge, unlocks };
    for (const [name, mod] of Object.entries(modules)) expect(hints(strings(mod)), name).toEqual([]);
    expect(hints([...TIPS]), 'loading tips').toEqual([]);
    expect(hints(strings(PLOT_OPTIONS)), 'plot options').toEqual([]);
    // the decorations named for cats are the cat-only ones (shown only once a cat leaves them, E23.12.2)
    for (const o of DECOR_OPTIONS.filter((d) => !CAT_DECOR.includes(d.id))) expect(hints([o.name, o.blurb]), o.id).toEqual([]);
  });

  it('with a cat hiding long past its paw prints, nothing shown before the first find names or hints at one', () => {
    for (const seed of [3, 9]) {
      const sim = hidingCat(seed);
      const rect = { x0: -80, z0: -80, x1: 120, z1: 120 };
      const spot = sim.cat.spots()[0];
      expect(sim.cat.known).toBe(false);
      // no paw prints (the HUD chip, the feed line, the paw prints by the cat and the tile tooltip all read this)
      expect(sim.cat.hinted(spot)).toBe(false);
      expect(hints(visible(sim)), `seed ${seed}`).toEqual([]);
      expect(collection(sim).map((g) => g.title)).not.toContain('Lucky Cats');
      // the cat-only decorations: locked, and their rows never say what leaves them
      for (const id of CAT_DECOR) expect(sim.crafting.decorMade(id)).toBe(false);
      // wildlife: no sleeping or visiting cats anywhere in view
      expect(catSpots(sim, rect, 50)).toEqual([]);
      expect(visitorSlots(sim, rect).filter((v) => v.kind === 'cats')).toEqual([]);
      // the reveal ripple never lights a cat's spot, even pulsed right beside it
      const a = sim.cat.anchor(spot.anchorId)!;
      const ripple = sim.pulseLoad.ripple({ roofId: a.roofId, x: Math.floor(a.pos[0]), z: Math.floor(a.pos[2]) });
      expect(ripple.every((r) => !r.id.includes(spot.anchorId) && !(r.x === Math.floor(a.pos[0]) && r.z === Math.floor(a.pos[2])))).toBe(true);
      // drones: no job or flight leads to the cat
      for (let i = 0; i < 30; i++) sim.advance(1);
      for (const d of sim.state.drones) expect(JSON.stringify(d)).not.toContain(spot.anchorId);
    }
  });

  it('once a cat is found the hints open: paw prints, the collection, the stats, wildlife cats', () => {
    const sim = hidingCat(3);
    expect(sim.cat.claim()).toBeDefined();
    expect(sim.cat.known).toBe(true);
    expect(sim.cat.spawn()).toBe(true);
    sim.state.time += TUNING.cat.hintAfter * 2;
    expect(sim.cat.hinted(sim.cat.spots()[0])).toBe(true);
    expect(collection(sim).map((g) => g.title)).toContain('Lucky Cats');
    expect(sim.metrics.summary()).toContain('Lucky Cats found 1');
    // the wildlife cats come back: sleeping on machines and visiting the bench and the rug
    const rect = { x0: -80, z0: -80, x1: 120, z1: 120 };
    expect(catSpots(sim, rect, 50).length).toBeGreaterThan(0);
    expect(visitorSlots(sim, rect).filter((v) => v.kind === 'cats').length).toBeGreaterThan(0);
  });

  it('every string in src/ that names a cat is one only a found cat (or the cat itself) shows', { timeout: 60_000 }, () => {
    // file → how many such strings it holds, and why each is safe. A new one fails here until it is gated and listed.
    const ALLOWED: Record<string, { n: number; why: string }> = {
      'src/app/Game.ts': {
        n: 13,
        why:
          'an internal key (cat:id); the cat itself under the pointer or a click (the hover tip, "can\'t reach that cat"); paw-print lines read hinted() (never before the first find); found toasts and names on cat.found; a solar panel under a cat surge (after a find); overview icons from the find log; the debug readout (Settings › debug)',
      },
      'src/data/cozy.ts': { n: 12, why: 'the cat-only decorations: shown only once a cat has left them (E23.12.2)' },
      'src/gameplay/LuckyCatSystem.ts': { n: 2, why: 'reward names, shown when a cat is found' },
      'src/ui/BackpackModel.ts': { n: 4, why: 'the Lucky Cats group: only once a cat is found (sim.cat.known)' },
      'src/ui/Hud.ts': { n: 4, why: 'the Lucky Cat garden button (shown once one is found) and the paw-print chip (shown when hinted())' },
      'src/ui/Icons.ts': { n: 2, why: 'the icon set (used by the strings above)' },
      'src/ui/Panels.ts': { n: 2, why: 'the reward panel (cat.found) and the stats line (only when sim.cat.known)' },
    };
    const STR = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g;
    const found: Record<string, string[]> = {};
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) {
          readFileSync(p, 'utf8')
            .split('\n')
            .forEach((l) => {
              const t = l.trim();
              if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
              for (const m of l.replace(/\/\/ .*$/, '').matchAll(STR)) {
                const s = m[1] ?? m[2] ?? m[3];
                if (CAT_WORD.test(s) && !/^[\w.:-]+$/.test(s)) (found[p.replace(/\\/g, '/')] ??= []).push(s);
              }
            });
        }
      }
    };
    walk('src');
    const counts = Object.fromEntries(Object.entries(found).map(([f, l]) => [f, l.length]));
    expect(counts, JSON.stringify(found, null, 1)).toEqual(Object.fromEntries(Object.entries(ALLOWED).map(([f, a]) => [f, a.n])));
  });
});
