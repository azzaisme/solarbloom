import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
import { CAT_SIGHT, catPixels, catSeen, sightClear } from '../src/core/CatSight';
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

const STR = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g;

/** The cat-word string literals in code (.ts, .css, a page's scripts and styles), comments aside, in order. */
function scanCode(text: string): string[] {
  const out: string[] = [];
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  for (const l of noBlock.split('\n')) {
    if (l.trim().startsWith('//')) continue;
    for (const m of l.replace(/(^|[^:'"`])\/\/ .*$/, '$1').matchAll(STR)) {
      const s = m[1] ?? m[2] ?? m[3];
      if (CAT_WORD.test(s)) out.push(s);
    }
  }
  return out;
}

/** The cat words in a page: its text, every attribute, its scripts and styles (comments aside). */
function scanHtml(text: string): string[] {
  const t = text.replace(/<!--[\s\S]*?-->/g, '');
  const out: string[] = [];
  for (const m of t.matchAll(/>([^<]+)</g)) if (CAT_WORD.test(m[1])) out.push(m[1].trim());
  for (const m of t.matchAll(/=\s*"([^"]*)"/g)) if (CAT_WORD.test(m[1])) out.push(m[1]);
  for (const m of t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|<script[^>]*>([\s\S]*?)<\/script>/g)) out.push(...scanCode(m[1] ?? m[2]));
  return out;
}

/** Every .ts, .css and .html file under a folder. */
function sourceFiles(d: string, out: string[] = []): string[] {
  for (const f of readdirSync(d)) {
    const p = join(d, f).replace(/\\/g, '/');
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|css|html)$/.test(p)) out.push(p);
  }
  return out;
}

/** File → its cat-word strings (each once, sorted), for src/ and the game's page. */
function catStrings(d: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const files = [...sourceFiles(d), ...(existsSync('index.html') ? ['index.html'] : [])];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const list = f.endsWith('.html') ? scanHtml(text) : scanCode(text);
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

  it('before the first find, the pointer only finds a cat the player can see: big enough, nothing in the way (core/CatSight)', () => {
    const flat = () => 0;
    const eye = { x: 0, y: 6, z: 12 };
    const cat = { x: 0, y: 0.1, z: 0 };
    // size on screen: a far overview makes it a few pixels; up close it is plain
    expect(catPixels(0.1, 1)).toBeCloseTo(CAT_SIGHT.catHeight / 0.1);
    expect(catPixels(0.08, 1)).toBeLessThan(CAT_SIGHT.minPixels);
    expect(catPixels(0.01, 1)).toBeGreaterThan(CAT_SIGHT.minPixels);
    // open ground: clear; a building (3 storeys) halfway along the line: blocked; one off to the side: clear
    expect(sightClear(eye, cat, flat)).toBe(true);
    const tower = (x0: number, z0: number) => (x: number, z: number) => (Math.abs(x - x0) < 1 && Math.abs(z - z0) < 1 ? 3 * 0.42 + 1 : 0);
    expect(sightClear(eye, cat, tower(0, 3))).toBe(false);
    expect(sightClear(eye, cat, tower(4, 3))).toBe(true);
    // a building behind the cat (further from the camera) never hides it
    expect(sightClear(eye, cat, tower(0, -3))).toBe(true);
    // the cat's own nook beside it doesn't count
    expect(sightClear(eye, cat, (x, z) => (Math.hypot(x, z) < CAT_SIGHT.skipNear - 0.05 ? 5 : 0))).toBe(true);
    // seen = both
    expect(catSeen(eye, cat, 30, flat)).toBe(true);
    expect(catSeen(eye, cat, 6, flat)).toBe(false);
    expect(catSeen(eye, cat, 30, tower(0, 3))).toBe(false);
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
      'src/app/EventBus.ts': { 'cat.spawned': KEY, 'cat.found': KEY, 'cat.moved': KEY, 'cat.goldenRelay': KEY },
      'src/app/Game.ts': {
        cat: KEY,
        'cat:${id}': KEY,
        'cat.spawned': KEY,
        'cat.found': KEY,
        'cat.moved': KEY,
        'cat.goldenRelay': KEY,
        "Bloombot can't reach that cat from here": 'a click on the cat itself, and before the first find only on one the player can really see (catVisible, core/CatSight)',
        '<b>🐱 …is that a cat?</b>Go and say hello!': 'the pointer on the cat itself, and before the first find only on one the player can really see (catVisible, core/CatSight)',
        '🐾 Paw prints lead ${compass(p.x - fx, p.z - fz)}, ${a.hint}…': 'the paw chip: only when hinted(), never before the first find',
        '<br><span class="ok">🐾 Faint paw prints… a cat is hiding very close.</span>': 'pawHint: only when hinted(), never before the first find',
        "<p class=\"stat\">${shining ? 'Shining into the grid' : 'Resting until the sun is up'}${boosted ? ' · a bloom beside it makes it shine brighter' : ''}${inSurge(s, m) ? ' · the Lucky Cat’s sunshine' : ''}</p><p>Restore tiles right next to it and it shines brighter for a few seconds.</p>":
          'a solar panel inside a Solar Surge, which only a found cat gives',
        '🌈 RAINBOW CAT FOUND!': 'the found toast',
        '👑 GOLDEN CAT FOUND!': 'the found toast',
        '🐱 LUCKY CAT FOUND!': 'the found toast',
        'Rainbow Cat: ': 'the reward panel title, on a find',
        'Golden Cat: ': 'the reward panel title, on a find',
        "${chaining.has(id) ? ' 🔗' : ''}${catAreas.has(id) ? ' 🐱' : ''}": 'overview area labels: catAreas comes from the find log',
        'cat ${st.cat.active ? st.cat.active.anchorId : ': 'the debug readout (Settings › debug only)',
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
      'src/gameplay/Metrics.ts': { cat: KEY, 'cat.found': KEY },
      'src/gameplay/Transitions.ts': { cat: KEY },
      'src/rendering/CatVisuals.ts': { 'lucky-cat': KEY, paw: KEY },
      'src/rendering/DecorArt.ts': { 'lucky-cat': KEY },
      'src/rendering/DroneVisuals.ts': { 'cat.found': KEY },
      'src/rendering/Fauna.ts': { cats: KEY },
      'src/rendering/FaunaPlan.ts': { cats: KEY },
      'src/ui/BackpackModel.ts': { cat: KEY, 'Lucky Cats': `the collection group: ${FOUND}`, '${st.cat.found} found': `the collection group: ${FOUND}`, 'One cat found': `the collection group: ${FOUND}`, '${n} cats found': `the collection group: ${FOUND}` },
      'src/ui/EcoBadge.ts': { cat: KEY },
      'src/ui/Hud.ts': {
        cat: KEY,
        'Lucky Cat garden': `the garden button: ${FOUND}`,
        'Paw prints: which way a hiding cat went': 'the paw chip: only when hinted()',
        'Paw prints: a Lucky Cat is hiding. Which way do they lead?': 'the paw chip: only when hinted()',
      },
      'src/ui/Icons.ts': { cat: KEY, paw: KEY, '🐱': 'the icon set: drawn only where a string above uses it', '🐾': 'the icon set: drawn only where a string above uses it' },
      'src/ui/Panels.ts': {
        '<b>${ICONS.cat} ${iconize(esc(title))}</b><span>${iconize(esc(detail))}</span>': 'the reward panel, on a find',
        '<p class="set-stats">Tiles restored: <b>${s.tilesRestored}</b> · Bloom chains: <b>${s.chains}</b> · Best: <b>×${s.maxCombo}</b> · Average: <b>${avg}</b><br>Drone jobs: <b>${s.droneJobs}</b>${this.sim.cat.known ? ':
          'Settings › Game: the Lucky Cats line only when sim.cat.known',
      },
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
    expect(scanCode(".chip::after { content: '🐾'; }\n/* 'paw' in a comment is fine */")).toEqual(['🐾']);
    expect(scanHtml('<div id="x" title="Purring nearby">Something small is hiding here</div><!-- a meow -->')).toEqual(['Something small is hiding here', 'Purring nearby']);
  });
});
