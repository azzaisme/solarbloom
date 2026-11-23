import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
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
import { CAT_SIGHT, countIds, screenBox, seenEnough, toScreenPixels } from '../src/core/CatSight';
import { openNextGoal } from './helpers';

SaveService.clock = () => 0;

/**
 * E23.12.3 (#530, epic rule 8): the Lucky Cats stay hidden. Before bloombot finds its first cat, nothing the player
 * can see shows, names or hints at one: no paw prints, meows, tooltips, wildlife cats, stats, collection entries,
 * tips, Keeper lines, journal pages, photo-mode names or night finds. This file is the audit: it reads every
 * player-facing string E23 added and every system that could point at a cat, and it fails on a single hint.
 */

/** A word or phrase that names or hints at a cat (the old loading tip's "something small is hiding" among them). */
export const CAT_WORD =
  /\b(cats?|kitt(?:y|en|ens)|kitties|meows?|mews?|paws?|pawprints?|whiskers?|purr\w*|felines?|tabby|something (?:small|little)|hiding (?:nearby|close by|close|here))\b|🐱|🐈|🐾|😺|😸/i;

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

/**
 * The cat-word strings in TypeScript, from its syntax tree (the compiler's own scanner): every string literal, every
 * template's text (head, middles and tail, however the template is nested or split over lines) and JSX text.
 * Comments are never strings, so they never count.
 */
function scanCode(text: string, file = 'x.ts'): string[] {
  const out: string[] = [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n: ts.Node) => {
    let t: string | undefined;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) t = n.text;
    else if (ts.isJsxText(n)) t = n.text.trim();
    if (t !== undefined && CAT_WORD.test(t)) out.push(t);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The cat-word strings in a stylesheet (its quoted values: `content: '…'`, attribute selectors), comments aside. */
function scanCss(text: string): string[] {
  const out: string[] = [];
  for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g)) {
    const t = m[1] ?? m[2];
    if (CAT_WORD.test(t)) out.push(t);
  }
  return out;
}

/** The cat words in a page: its text, every attribute, its scripts and styles (comments aside). */
function scanHtml(text: string): string[] {
  const t = text.replace(/<!--[\s\S]*?-->/g, '');
  const out: string[] = [];
  for (const m of t.matchAll(/>([^<]+)</g)) if (CAT_WORD.test(m[1])) out.push(m[1].trim());
  for (const m of t.matchAll(/=\s*"([^"]*)"/g)) if (CAT_WORD.test(m[1])) out.push(m[1]);
  for (const m of t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) out.push(...scanCss(m[1]));
  for (const m of t.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) out.push(...scanCode(m[1]));
  return out;
}

/** Every .ts, .css and .html file under a folder. */
function sourceFiles(d: string, out: string[] = []): string[] {
  for (const f of readdirSync(d)) {
    const p = join(d, f).replace(/\\/g, '/');
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(tsx?|css|html)$/.test(p)) out.push(p);
  }
  return out;
}

/** File → its cat-word strings (each once, sorted), for src/ and the game's page. */
function catStrings(d: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const files = [...sourceFiles(d), ...(existsSync('index.html') ? ['index.html'] : [])];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const list = f.endsWith('.html') ? scanHtml(text) : f.endsWith('.css') ? scanCss(text) : scanCode(text, f);
    if (list.length) out[f] = [...new Set(list)].sort();
  }
  return out;
}

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
    const planted = ['🐾 Paw prints lead north', 'A Lucky Cat is hiding', 'You hear a meow', 'whiskers in the hedge', 'Cats: 0', 'Cats', 'Paw', 'Something small is hiding nearby.', 'Something little is hiding', 'A soft purr from the hedge', 'Purring', 'A tabby', 'Kitties!'];
    for (const s of planted) expect(hints([s]), s).toEqual([s]);
    for (const clean of ['Scatter seeds', 'Catch the light', 'A category of crops', 'Educate', 'Pawn shop', 'A small lamp', 'Hiding the cables']) expect(hints([clean]), clean).toEqual([]);
  });

  it('before the first find, only a cat the player can see counts: its own pixels on the frame (core/CatSight)', () => {
    // the pick buffer: RGBA per pixel, the mesh id in ARGB order (as PlayCanvas's Picker writes it); white = nothing
    const px = (ids: number[]) => {
      const out = new Uint8Array(ids.length * 4);
      ids.forEach((id, i) => {
        out[i * 4] = (id >>> 16) & 255;
        out[i * 4 + 1] = (id >>> 8) & 255;
        out[i * 4 + 2] = id & 255;
        out[i * 4 + 3] = (id >>> 24) & 255;
      });
      return out;
    };
    const cat = new Set([7, 8]); // the cat's meshes (body, collar)
    const NONE = 0xffffffff;
    // in the open: all of its box that is cat counts; a building (id 300) in front hides what it covers
    expect(countIds(px([7, 7, 8, NONE, 7, 8]), cat)).toBe(5);
    expect(countIds(px([300, 300, 300, 300, 7, 300]), cat)).toBe(1);
    expect(countIds(px([300, 300, 300, 300]), cat)).toBe(0);
    // a big id (many meshes in the city) decodes whole
    expect(countIds(px([0x01020304]), new Set([0x01020304]))).toBe(1);
    // the pass runs at half resolution: each pick pixel stands for four on screen
    expect(toScreenPixels(30, 0.5)).toBe(120);
    // enough to make out: 100 screen pixels (about 10 × 10)
    expect(seenEnough(CAT_SIGHT.minPixels)).toBe(true);
    expect(seenEnough(CAT_SIGHT.minPixels - 1)).toBe(false);
    expect(seenEnough(toScreenPixels(4))).toBe(false); // a cat 4 px tall in the overview: a few pick pixels
    expect(seenEnough(0)).toBe(false); // fully behind a building or a tree
    // the box read from the buffer: the cat's projected bounds, clipped to the screen, whole pixels
    expect(screenBox([{ x: 10.4, y: 20.6 }, { x: 30.2, y: 40.1 }], 1280, 760)).toEqual({ x: 10, y: 20, w: 21, h: 21 });
    expect(screenBox([{ x: -50, y: 700 }, { x: 20, y: 800 }], 1280, 760)).toEqual({ x: 0, y: 700, w: 20, h: 60 });
    expect(screenBox([{ x: -50, y: -40 }, { x: -10, y: -5 }], 1280, 760)).toBeUndefined();
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

  it('cat timing runs on game time: the next cat waits through a pause, and hours away bring no catch-up', () => {
    const saver = new SaveService(undefined);
    const sim = hidingCat(5);
    sim.cat.claim();
    const wait = sim.state.cat.nextSpawnAt - sim.time;
    expect(wait).toBeGreaterThanOrEqual(TUNING.cat.laterMin);
    // a paused game doesn't step the sim: the wall clock moving changes nothing
    const before = JSON.stringify(sim.state.cat);
    SaveService.clock = () => 10 * 3600 * 1000;
    sim.cat.tick();
    expect(JSON.stringify(sim.state.cat)).toBe(before);
    // saved, then loaded ten hours later: the same game time, the same wait, no cat waiting from the time away
    SaveService.clock = () => 0;
    const json = saver.serialize(sim.state);
    SaveService.clock = () => 10 * 3600 * 1000;
    const back = new Sim(saver.deserialize(json)!);
    expect(back.time).toBe(sim.time);
    expect(back.state.cat.nextSpawnAt - back.time).toBe(wait);
    back.advance(1);
    expect(back.state.cat.active).toBeUndefined();
    // a cat hiding across that reload has hidden for game time only (its reward's hidden-time bonus too)
    expect(back.cat.spawn()).toBe(true);
    const spot = back.state.cat.active!;
    const json2 = saver.serialize(back.state);
    SaveService.clock = () => 30 * 3600 * 1000;
    const later = new Sim(saver.deserialize(json2)!);
    expect(later.time - later.state.cat.active!.spawnedAt).toBe(back.time - spot.spawnedAt);
    // played on: the next cat comes once the game time has passed, not before
    later.state.cat.active = undefined;
    later.state.cat.nextSpawnAt = later.time + 30;
    for (let i = 0; i < 29; i++) later.advance(1);
    expect(later.state.cat.active).toBeUndefined();
    for (let i = 0; i < 12 && !later.state.cat.active; i++) later.advance(1);
    expect(later.state.cat.active).toBeDefined();
    SaveService.clock = () => 0;
  });

  it('every string in src/ (.ts, .css, .html) that names a cat is listed, exactly, with why only a found cat shows it', { timeout: 60_000 }, () => {
    // Every such string, word for word, by file. One-word strings are checked too: each is an internal key here, and
    // a new one (a 'Cats' label, say) fails until it is gated and listed. A listed string that's gone fails as well.
    const KEY = 'an internal key (a type, event, model, icon or fauna id), never shown';
    const FOUND = 'shown only once a cat has been found (cat.found / sim.cat.known)';
    const ALLOWED: Record<string, Record<string, string>> = {
      // Phase 8: sound family and asset ids (the hint meow plays only once a cat is known, E23.12.3)
      'src/audio/AudioMath.ts': { cat: KEY },
      'src/audio/Sfx.ts': { cat: KEY, meow: KEY, 'sfx/events/meow': KEY },
      'src/app/EventBus.ts': { 'cat.spawned': KEY, 'cat.found': KEY, 'cat.moved': KEY, 'cat.goldenRelay': KEY },
      'src/app/Game.ts': {
        cat: KEY,
        'cat:': KEY,
        'cat.spawned': KEY,
        'cat.found': KEY,
        'cat.moved': KEY,
        'cat.goldenRelay': KEY,
        "Bloombot can't reach that cat from here": 'a click on the cat itself, and before the first find only on one the player can really see (catVisible, core/CatSight)',
        '<b>🐱 …is that a cat?</b>Go and say hello!': 'the pointer on the cat itself, and before the first find only on one the player can really see (catVisible, core/CatSight)',
        '<br><span class="ok">🐾 Faint paw prints… a cat is hiding very close.</span>': 'pawHint: only when hinted(), never before the first find',
        ' · the Lucky Cat’s sunshine': 'a solar panel inside a Solar Surge, which only a found cat gives',
        '🌈 You found a Rainbow Cat!': 'the found toast',
        '👑 You found a Golden Cat!': 'the found toast',
        '🐱 You found a Lucky Cat!': 'the found toast',
        'Rainbow Cat: ': 'the reward panel title, on a find',
        'Golden Cat: ': 'the reward panel title, on a find',
        ' 🐱': 'overview area labels: from the find log (catAreas)',
        'cat ': 'the debug readout (Settings › debug only)',
      },
      'src/app/Interact.ts': { cat: KEY },
      'src/core/TilePack.ts': { cat: KEY },
      'src/core/types.ts': { cat: KEY },
      'src/data/cozy.ts': {
        cat: KEY,
        '🐱': 'a cat-only decoration (E23.12.2): only once a cat has left it',
        '🐾': 'a cat-only decoration (E23.12.2): only once a cat has left it',
        'Lucky Cat statue': 'a cat-only decoration (E23.12.2): only once a cat has left it',
        'A little stone cat with one paw raised.': 'a cat-only decoration (E23.12.2): only once a cat has left it',
        'Cat bench': 'a cat-only decoration (E23.12.2): only once a cat has left it',
        'A bench with cat ears on its back, for two.': 'a cat-only decoration (E23.12.2): only once a cat has left it',
        'Paw-print stones': 'a cat-only decoration (E23.12.2): only once a cat has left it',
        'Stepping stones in the shape of a paw. Walk right over them.': 'a cat-only decoration (E23.12.2): only once a cat has left it',
        'Cat fountain': 'a cat-only decoration (E23.12.2): only once a cat has left it',
        'A stone bowl with a cat on top, spouting water.': 'a cat-only decoration (E23.12.2): only once a cat has left it',
        'A cat-eared lantern that glows gold all night.': 'a cat-only decoration (E23.12.2): only once a cat has left it',
        'A pole of bright flags, every colour of a Rainbow Cat.': 'a cat-only decoration (E23.12.2): only once a cat has left it',
      },
      'src/data/tuning.ts': { cats: KEY },
      'src/gameplay/BloomChainSystem.ts': { cat: KEY },
      'src/gameplay/Charge.ts': { cat: KEY },
      'src/gameplay/Cozy.ts': { cat: KEY },
      'src/gameplay/Crafting.ts': { cat: KEY },
      'src/gameplay/DebugLog.ts': { 'cat.found': KEY, 'cat.spawned': KEY },
      'src/gameplay/LuckyCatSystem.ts': {
        cat: KEY,
        'lucky-cat': KEY,
        'cat.spawned': KEY,
        'cat.moved': KEY,
        'cat.found': KEY,
        'cat.goldenRelay': KEY,
        "Cat's Garden": 'a reward name, shown on a find',
        'Fog Whisker': 'a reward name, shown on a find',
      },
      'src/gameplay/Metrics.ts': { cat: KEY, 'cat.found': KEY, 'Lucky Cats found ': `the playtest timings: ${FOUND}` },
      'src/gameplay/Transitions.ts': { cat: KEY },
      'src/rendering/CatVisuals.ts': { 'lucky-cat': KEY, paw: KEY },
      'src/rendering/DecorArt.ts': { 'lucky-cat': KEY },
      'src/rendering/DroneVisuals.ts': { 'cat.found': KEY },
      'src/rendering/Fauna.ts': { cats: KEY },
      'src/rendering/FaunaPlan.ts': { cats: KEY },
      'src/ui/BuildCatalog.ts': { cat: KEY },
      'src/ui/BackpackModel.ts': { cat: KEY, 'Lucky Cats': `the collection group: ${FOUND}`, ' cats found': `the collection group: ${FOUND}`, 'One cat found': `the collection group: ${FOUND}` },
      'src/ui/Hud.ts': { cat: KEY },
      'src/ui/Icons.ts': { cat: KEY, paw: KEY, '🐱': 'the icon set: drawn only where a string above uses it', '🐾': 'the icon set: drawn only where a string above uses it' },
      'src/ui/Panels.ts': { ' · Lucky Cats: <b>': 'Settings › Game: only when sim.cat.known' },
      'src/ui/Toasts.ts': { cat: KEY },
    };
    const found = catStrings('src');
    const listed = Object.fromEntries(Object.entries(ALLOWED).map(([f, m]) => [f, Object.keys(m).sort()]));
    expect(found, 'a string naming a cat that is not listed (gate it, then list it), or a listed one that is gone').toEqual(listed);
    // the scan reads the stylesheets and pages too
    expect(sourceFiles('src').filter((f) => f.endsWith('.css')).length).toBeGreaterThan(0);
    expect(existsSync('index.html')).toBe(true);
  });

  it('the scan finds a cat word wherever it is: a one-word label, a stylesheet, a page', () => {
    expect(scanCode("label('Cats')\nconst k = 'cat'")).toEqual(['Cats', 'cat']);
    // a template over several lines, one nested in another's expression, and JSX text
    expect(scanCode('const a = `Biggest chain\n  ${x ? `Lucky Cats found ${n}` : \'\'} done`;')).toEqual(['Lucky Cats found ']);
    expect(scanCode('h(`<p>${known ? ` · Lucky Cats: <b>${n}</b>` : \'\'}</p>`)')).toEqual([' · Lucky Cats: <b>']);
    expect(scanCode('const v = <div>A purr in the hedge</div>;', 'x.tsx')).toEqual(['A purr in the hedge']);
    // comments are not strings
    expect(scanCode("// 'cat' here is a comment\n/* and 'paw' here */ const k = 1;")).toEqual([]);
    expect(scanCss(".chip::after { content: '🐾'; }\n/* 'paw' in a comment is fine */")).toEqual(['🐾']);
    expect(scanHtml('<div id="x" title="Purring nearby">Something small is hiding here</div><!-- a meow -->')).toEqual(['Something small is hiding here', 'Purring nearby']);
  });
});
