// #785: fruit trees you can actually harvest. A grown tree fruits once a game day through summer and autumn (#830's
// seasons: it flowers in spring and rests in winter); its fruit shows on the tree as it comes (bare, small green
// fruit, colouring up, ripe); holding Interact picks it into the backpack as that region's fruit (apples, pears,
// peaches, lemons), each its own snack item; the fruit's progress saves and carries on after a load; the tree is
// TreeGen's leafy style with its fruit on the twigs, its leaves following the seasons.
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { DAY_SECONDS } from '../src/data/time';
import { ORCHARD, type FruitPhase } from '../src/data/farmExtras';
import { DEFAULT_FRUIT, FRUIT_IDS, FRUITS, fruitOfArea, type FruitId } from '../src/data/fruit';
import { REGIONS, KEEPERS } from '../src/data/oldcity';
import type { Season } from '../src/data/seasons';
import { HOLD_ACTS, VERB_ACTS } from '../src/data/botActs';
import { fruitStep } from '../src/gameplay/FarmExtras';
import { Sim } from '../src/gameplay/Sim';
import { bannedIn } from '../src/ui/words';
import { fruitSay, fruitShort, fruitTip } from '../src/ui/FruitWords';
import { extraHtml } from '../src/ui/ExtrasPanel';
import { buildOrchardTree, LEAF_FLAG, ORCHARD_FRUIT, SEASON_FLAG, type OrchardLook } from '../src/rendering/TreeGen';
import { PALETTE } from '../src/rendering/Palette';
import { orchardScale } from '../src/rendering/CropVisuals';
import { MACHINES } from '../src/data/machines';
import { MATERIALS } from '../src/data/salvage';
import { CHARGE } from '../src/data/charge';
import { FARM_USES, isFarmItem } from '../src/data/farm';
import { COMPOST } from '../src/data/compost';
import { WORM_BIN } from '../src/data/farmExtras';

SaveService.clock = () => 0;

function farm(): Sim {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = 3;
  sim.state.salvage!.keepers.moss = { step: 'request1' };
  sim.bot = { roofId: GROUND, x: 8.5, z: 11.5 };
  return sim;
}

function plant(sim: Sim, x = 12, z = 16): MachineData {
  for (const [k, v] of Object.entries(sim.build.recipe('orchard')!)) sim.inventory.addToStore(k as 'scrap', v!);
  const t = sim.grid.get(GROUND, x, z)!;
  Object.assign(t, { blocked: false, feature: undefined, ground: 'restored', pollution: 0, bloom: 1 });
  sim.grid.touch(t);
  const m = sim.build.place('orchard', GROUND, x, z);
  expect(m).toBeDefined();
  return m!;
}

/**
 * The farm systems alone, for some seconds of play, in half-minute steps, held in one season (default summer, when
 * trees fruit every day; null lets the year turn as it will).
 */
function run(sim: Sim, seconds: number, season: Season | null = 'summer') {
  for (let left = seconds; left > 1e-9; left -= 30) {
    const dt = Math.min(30, left);
    sim.state.time += dt;
    if (season) sim.seasons.jumpTo(season);
    sim.farmExtras.tick(dt);
  }
}

/** A sim with no seasons at all: every day is its own little year (ORCHARD.daily). */
function noSeasons(sim: Sim): Sim {
  Object.defineProperty(sim, 'seasons', { value: undefined });
  return sim;
}

/** Every phase the tree passes through while `go` runs, in order (repeats dropped). */
function phases(sim: Sim, tree: MachineData, seconds: number, season: Season | null = 'summer'): FruitPhase[] {
  const seen: FruitPhase[] = [sim.farmExtras.fruitPhase(tree)];
  for (let t = 0; t < seconds; t += 30) {
    run(sim, 30, season);
    const p = sim.farmExtras.fruitPhase(tree);
    if (seen[seen.length - 1] !== p) seen.push(p);
  }
  return seen;
}

const held = (sim: Sim, f: FruitId = 'apple') => sim.inventory.count(f) + sim.inventory.stored(f);

describe('#785 fruit trees: timing', () => {
  it('in summer: grows up in a quarter of a day, then sets green fruit that ripens a game day after planting', () => {
    const sim = farm();
    const tree = plant(sim);
    const x = sim.farmExtras;
    expect(x.fruitPhase(tree)).toBe('young');
    expect(x.treeGrowth(tree)).toBe(0);
    let ripeAt = 0;
    const seen: FruitPhase[] = ['young'];
    for (let t = 0; t < 1.2 * DAY_SECONDS; t += 30) {
      run(sim, 30);
      const p = x.fruitPhase(tree);
      if (seen[seen.length - 1] !== p) seen.push(p);
      if (p === 'ripe' && !ripeAt) ripeAt = t + 30;
    }
    // grown, its branches are bare a little while, then the fruit sets (in summer there are no daily flowers)
    expect(seen).toEqual(['young', 'bare', 'green', 'nearly', 'ripe']);
    expect(x.treeGrowth(tree)).toBe(1);
    // ripe one game day (48 minutes of play) after planting: within a normal play session
    expect(ripeAt).toBeGreaterThan((ORCHARD.fruitDays - 0.01) * DAY_SECONDS);
    expect(ripeAt).toBeLessThanOrEqual((ORCHARD.fruitDays + 0.01) * DAY_SECONDS);
    expect(ORCHARD.fruitDays * DAY_SECONDS).toBe(48 * 60);
    expect(ORCHARD.grownDays * DAY_SECONDS).toBe(12 * 60);
    // ripe fruit waits on the tree
    run(sim, 2 * DAY_SECONDS);
    expect(x.fruitPhase(tree)).toBe('ripe');
    expect(x.st(tree).crops).toBe(1);
  });

  it('after picking in summer or autumn: bare, then green fruit, nearly ripe, and ripe again one game day later', () => {
    for (const season of ['summer', 'autumn'] as const) {
      const sim = farm();
      const tree = plant(sim);
      const x = sim.farmExtras;
      run(sim, ORCHARD.fruitDays * DAY_SECONDS + 30, season);
      expect(x.pick(tree)).toBe(ORCHARD.fruit);
      expect(x.fruitPhase(tree)).toBe('bare');
      expect(x.fruitShown(tree)).toBe(0);
      expect(phases(sim, tree, ORCHARD.fruitDays * DAY_SECONDS + 30, season)).toEqual(['bare', 'green', 'nearly', 'ripe']);
    }
  });

  it('with no seasons at all, each day flowers too: bare, blossom, green, nearly ripe, ripe', () => {
    const sim = noSeasons(farm());
    const tree = plant(sim);
    expect(phases(sim, tree, ORCHARD.fruitDays * DAY_SECONDS + 30, null)).toEqual(['young', 'blossom', 'green', 'nearly', 'ripe']);
    sim.farmExtras.pick(tree);
    expect(phases(sim, tree, ORCHARD.fruitDays * DAY_SECONDS + 30, null)).toEqual(['bare', 'blossom', 'green', 'nearly', 'ripe']);
  });

  it('#830 seasons: it flowers all spring, fruits daily through summer and autumn, and rests in winter', () => {
    const sim = farm();
    const tree = plant(sim);
    const x = sim.farmExtras;
    expect(ORCHARD.seasons).toMatchObject({ spring: { ripens: false, blossom: true }, summer: { ripens: true }, autumn: { ripens: true }, winter: { ripens: false, blossom: false } });
    // spring: once grown it is in flower, and no fruit ripens however long it waits
    expect(phases(sim, tree, 2 * DAY_SECONDS, 'spring')).toEqual(['young', 'blossom']);
    expect(x.fruitReady(tree)).toBe(false);
    expect(x.pickProblem(tree)).toBe('It’s flowering: fruit comes in summer');
    // summer: fruit sets and ripens within a day
    // summer: the flowers fall, fruit sets, and it is ripe within a day
    expect(phases(sim, tree, ORCHARD.fruitDays * DAY_SECONDS + 30, 'summer')).toEqual(['blossom', 'bare', 'green', 'nearly', 'ripe']);
    // ripe fruit waits on the tree, even into winter; once picked the tree rests bare all winter
    run(sim, DAY_SECONDS, 'winter');
    expect(x.fruitPhase(tree)).toBe('ripe');
    expect(x.pick(tree)).toBe(ORCHARD.fruit);
    expect(phases(sim, tree, 2 * DAY_SECONDS, 'winter')).toEqual(['bare']);
    expect(x.pickProblem(tree)).toBe('It’s resting until spring');
    // unripe fruit doesn't carry over a rest: a tree green in autumn starts afresh after winter
    run(sim, 0.5 * DAY_SECONDS, 'autumn');
    expect(x.fruitPhase(tree)).toBe('green');
    run(sim, 30, 'winter');
    expect(x.st(tree).growing ?? 0).toBe(0);
    expect(x.fruitPhase(tree)).toBe('bare');
  });

  it('the year turning on its own: planted in spring, it flowers, then fruits early in summer', () => {
    const sim = farm();
    sim.seasons.jumpTo('spring', 1);
    const tree = plant(sim);
    const seen = phases(sim, tree, 4.2 * DAY_SECONDS, null);
    expect(seen.slice(0, 2)).toEqual(['young', 'blossom']);
    expect(sim.seasons.season()).toBe('summer');
    expect(seen).toContain('ripe');
  });

  it('fertile soil ripens it sooner, and says how long is left', () => {
    const sim = farm();
    const tree = plant(sim);
    expect(sim.farmExtras.daysToRipe(tree)).toBeCloseTo(ORCHARD.fruitDays, 5);
    run(sim, DAY_SECONDS / 4);
    expect(sim.farmExtras.daysToRipe(tree)).toBeCloseTo(0.75, 2);
  });

  it('the look changes in steps that sit on the phases, so the words always match what the tree shows', () => {
    expect(fruitStep(0, 12)).toBe(0);
    expect(fruitStep(0.0833, 12)).toBe(0);
    expect(fruitStep(1 / 12, 12)).toBe(1);
    expect(fruitStep(0.999, 12)).toBe(11);
    expect(fruitStep(1, 12)).toBe(12);
    for (const k of [ORCHARD.bareUntil, ORCHARD.blossomUntil, ORCHARD.nearlyRipe, ORCHARD.seasonBloom]) expect(Math.abs(k * ORCHARD.looks - Math.round(k * ORCHARD.looks))).toBeLessThan(1e-9);
    const sim = farm();
    const tree = plant(sim);
    run(sim, ORCHARD.grownDays * DAY_SECONDS + 30);
    const looks = new Set<string>();
    for (let t = 0; t < DAY_SECONDS; t += 30) {
      run(sim, 30);
      looks.add(sim.farmExtras.fruitLook(tree));
    }
    // about a dozen looks a day (the renderer rebuilds only when it changes)
    expect(looks.size).toBeGreaterThanOrEqual(8);
    expect(looks.size).toBeLessThanOrEqual(ORCHARD.looks + 1);
    // a season turning changes the look too
    const summer = sim.farmExtras.fruitLook(tree);
    sim.farmExtras.pick(tree);
    run(sim, 30, 'spring');
    expect(sim.farmExtras.fruitLook(tree)).not.toBe(summer);
  });
});

describe('#785 fruit trees: picking', () => {
  it('picking ripe fruit puts the tree’s own fruit in the backpack (the store takes what has no room)', () => {
    const sim = farm();
    const tree = plant(sim);
    const kind = sim.farmExtras.fruitOf(tree);
    expect(kind).toBe(fruitOfArea(sim.areas.areaOf(tree)));
    run(sim, ORCHARD.fruitDays * DAY_SECONDS + 30);
    const before = held(sim, kind);
    const harvested: unknown[] = [];
    sim.bus.on('farm.harvested', (e) => harvested.push(e));
    expect(sim.farmExtras.fruitYield(tree)).toBe(ORCHARD.fruit);
    expect(sim.farmExtras.pick(tree)).toBe(ORCHARD.fruit);
    expect(held(sim, kind) - before).toBe(ORCHARD.fruit);
    expect(sim.inventory.count(kind)).toBeGreaterThan(0);
    expect(harvested).toEqual([{ machineId: tree.id, item: kind, n: ORCHARD.fruit }]);
    // nothing more until it regrows
    expect(sim.farmExtras.pick(tree)).toBe(0);
    expect(held(sim, kind) - before).toBe(ORCHARD.fruit);
  });

  it('a tree with nothing ripe says why in plain words', () => {
    const sim = farm();
    const tree = plant(sim);
    const fails: string[] = [];
    sim.bus.on('action.failed', (e) => fails.push(e.reason));
    expect(sim.farmExtras.pickProblem(tree)).toBe('The tree is still growing');
    expect(sim.farmExtras.pick(tree)).toBe(0);
    run(sim, 0.5 * DAY_SECONDS);
    expect(sim.farmExtras.pickProblem(tree)).toBe('The fruit isn’t ripe yet');
    run(sim, 0.6 * DAY_SECONDS);
    expect(sim.farmExtras.pickProblem(tree)).toBeUndefined();
    expect(fails).toEqual(['The tree is still growing']);
    for (const w of fails) expect(bannedIn(w)).toEqual([]);
  });

  it('holding Interact to pick acts out a harvest (the hold pattern of prying and gathering)', () => {
    expect(HOLD_ACTS.pick).toBe('harvest');
    expect(VERB_ACTS.Pick).toBe('harvest');
    expect(ORCHARD.holdSeconds).toBeGreaterThan(0.3);
    expect(ORCHARD.holdSeconds).toBeLessThan(2);
  });

  it('pruning still gives timber, and an overgrown tree still fruits daily (a little less)', () => {
    const sim = farm();
    const tree = plant(sim);
    const got: number[] = [];
    for (let d = 0; d < 6; d++) {
      run(sim, ORCHARD.fruitDays * DAY_SECONDS + 30);
      got.push(sim.farmExtras.pick(tree));
    }
    expect(got.every((n) => n > 0)).toBe(true);
    expect(got[0]).toBe(ORCHARD.fruit);
    expect(got[got.length - 1]).toBe(Math.round(ORCHARD.fruit * ORCHARD.overgrownFruit));
    expect(sim.farmExtras.overgrown(tree)).toBe(true);
    expect(sim.farmExtras.prune(tree)).toBe(ORCHARD.timber);
    expect(sim.farmExtras.overgrown(tree)).toBe(false);
  });

  it('Cozy Mode: an unpruned tree only looks shaggy, and gives its full crop', () => {
    const sim = farm();
    sim.decay.setCozyMode(true);
    expect(sim.decay.cozyMode).toBe(true);
    const tree = plant(sim);
    const got: number[] = [];
    for (let d = 0; d < 6; d++) {
      run(sim, ORCHARD.fruitDays * DAY_SECONDS + 30);
      got.push(sim.farmExtras.pick(tree));
    }
    expect(sim.farmExtras.overgrown(tree)).toBe(true);
    expect(got).toEqual(got.map(() => ORCHARD.fruit));
    // the words don't threaten less fruit either
    expect(extraHtml(sim, tree)).toContain('It’s getting shaggy.');
    expect(extraHtml(sim, tree)).not.toMatch(/fruit less/);
    expect(fruitTip('apple', 'bare', true, true)).not.toMatch(/fruit less/);
    expect(fruitTip('apple', 'bare', true, false)).toMatch(/fruit less/);
  });
});

describe('#785 fruit trees: a fruit for each part of the city', () => {
  it('every region grows one kind (and anywhere else apples): apple, pear, peach, lemon', () => {
    expect([...FRUIT_IDS]).toEqual(['apple', 'pear', 'peach', 'lemon']);
    const all = FRUIT_IDS.flatMap((f) => FRUITS[f].areas);
    expect(new Set(all).size).toBe(all.length); // no area grows two kinds
    for (const r of REGIONS) expect(all, r.id).toContain(r.id);
    expect(all).toContain('park');
    expect(fruitOfArea('park')).toBe('apple');
    expect(fruitOfArea('oldMarket')).toBe('pear');
    expect(fruitOfArea('terraces')).toBe('peach');
    expect(fruitOfArea('saltwind')).toBe('lemon');
    expect(fruitOfArea('mainland-district-7')).toBe(DEFAULT_FRUIT);
    expect(fruitOfArea(undefined)).toBe(DEFAULT_FRUIT);
  });

  it('a tree bears its own region’s fruit, by where it stands', () => {
    const sim = farm();
    for (const k of KEEPERS) {
      const area = sim.areas.areaOf({ roofId: GROUND, x: k.x, z: k.z });
      if (area !== k.region) continue; // a Keeper standing just over a border
      const m = { roofId: GROUND, x: k.x, z: k.z } as MachineData;
      expect(sim.farmExtras.fruitOf(m), k.region).toBe(fruitOfArea(k.region));
    }
  });

  it('each is its own backpack item, with a name, an icon and a few plain words', () => {
    for (const f of FRUIT_IDS) {
      expect(MATERIALS[f]).toMatchObject({ id: f, name: FRUITS[f].name, icon: FRUITS[f].icon });
      expect(isFarmItem(f)).toBe(true);
      expect(bannedIn(FARM_USES[f].blurb)).toEqual([]);
      expect(bannedIn(MATERIALS[f].from ?? '')).toEqual([]);
    }
  });

  it('Bloombot eats any of them for charge: sweet snacks, more than Food, less than Honey (sweetest first)', () => {
    for (const f of FRUIT_IDS) {
      expect(FARM_USES[f].charge, f).toBeGreaterThan(FARM_USES.food.charge);
      expect(FARM_USES[f].charge, f).toBeLessThan(FARM_USES.honey.charge);
    }
    const ids = CHARGE.edibles.map((e) => e.id);
    expect(ids[0]).toBe('honey');
    expect(ids.slice(1, 5)).toEqual([...FRUIT_IDS].sort((a, b) => FARM_USES[b].charge - FARM_USES[a].charge));
    const sim = farm();
    sim.state.charge = { value: 10 };
    sim.bot = { roofId: GROUND, x: 30.5, z: 30.5 }; // away from home (no resting trickle)
    const pack = sim.state.salvage!.pack as Record<string, number>;
    for (const k of Object.keys(pack)) delete pack[k];
    pack.pear = 2;
    expect(sim.charge.eat()).toMatchObject({ id: 'pear' });
    sim.advance(4);
    expect(sim.charge.value()).toBeCloseTo(10 + FARM_USES.pear.charge * CHARGE.max, 1);
    expect(pack.pear).toBe(1);
  });

  it('works wherever Food does: the compost bin, the worm bin, and Keeper gifts', () => {
    const sim = farm();
    for (const [k, v] of Object.entries(sim.build.recipe('compostBin')!)) sim.inventory.add(k as 'scrap', v!);
    const t = sim.grid.get(GROUND, 14, 16)!;
    Object.assign(t, { blocked: false, feature: undefined, ground: 'restored', pollution: 0, bloom: 1 });
    const bin = sim.build.place('compostBin', GROUND, 14, 16);
    expect(bin).toBeDefined();
    sim.inventory.add('apple', 2);
    sim.inventory.add('lemon', 1);
    expect(sim.compost.fill(bin!, 'fruit')).toBe(3);
    expect(sim.compost.bin(bin!).feed).toBe(3 * COMPOST.foodWorth);
    expect(sim.inventory.count('apple') + sim.inventory.count('lemon')).toBe(0);
    // a region's Keeper loves its own fruit as a gift
    expect(sim.keepers.likes('moss')).toContain('apple');
    expect(sim.keepers.likes('tally')).toContain('pear');
    expect(sim.keepers.likes('gable')).toContain('peach');
    expect(sim.keepers.likes('tide')).toContain('lemon');
    // the worm bin eats fruit scraps when there's no Food
    sim.state.salvage!.recipes = ['wormBin'];
    for (const [k, v] of Object.entries(sim.build.recipe('wormBin')!)) sim.inventory.add(k as 'scrap', v!);
    const u = sim.grid.get(GROUND, 16, 16)!;
    Object.assign(u, { blocked: false, feature: undefined, ground: 'restored', pollution: 0, bloom: 1 });
    const worms = sim.build.place('wormBin', GROUND, 16, 16);
    expect(worms).toBeDefined();
    const pack = sim.state.salvage!.pack as Record<string, number>;
    delete pack.food;
    delete pack.biomass;
    sim.inventory.add('peach', WORM_BIN.feedCost);
    expect(sim.farmExtras.feedWorms(worms!)).toBe(true);
    expect(sim.inventory.count('peach')).toBe(0);
  });
});

describe('#785 fruit trees: saves', () => {
  const saver = () => new SaveService(undefined);

  it('the fruit’s progress saves, and after a load it ripens on exactly as if never saved', () => {
    const a = farm();
    const tree = plant(a);
    run(a, 0.55 * DAY_SECONDS);
    const json = saver().serialize(a.state);
    const b = new Sim(saver().deserialize(json)!);
    expect(b.farmExtras.st(tree.id)).toEqual(a.farmExtras.st(tree));
    expect(b.farmExtras.fruitPhase(b.machine(tree.id)!)).toBe(a.farmExtras.fruitPhase(tree));
    for (let t = 0; t < 0.6 * DAY_SECONDS; t += 30) {
      run(a, 30);
      run(b, 30);
      expect(b.farmExtras.fruitLook(b.machine(tree.id)!)).toBe(a.farmExtras.fruitLook(tree));
    }
    expect(b.farmExtras.fruitReady(b.machine(tree.id)!)).toBe(true);
    // a picked tree saves bare, and loads bare
    a.farmExtras.pick(tree);
    const c = new Sim(saver().deserialize(saver().serialize(a.state))!);
    c.seasons.jumpTo('summer');
    expect(c.farmExtras.fruitPhase(c.machine(tree.id)!)).toBe('bare');
    // fruit in the backpack saves too
    const kind = a.farmExtras.fruitOf(tree);
    expect(c.inventory.count(kind) + c.inventory.stored(kind)).toBe(held(a, kind));
    expect(held(a, kind)).toBeGreaterThan(0);
  });

  it('a tree from an older save (the old slow orchard) loads and fruits within a day', () => {
    const sim = farm();
    const tree = plant(sim);
    // the old rules: three days to the first fruit, its progress counted only after that
    sim.state.salvage!.extras = { [tree.id]: { age: 1.5, sincePrune: 1.5 } };
    const json = saver().serialize(sim.state);
    const back = new Sim(saver().deserialize(json)!);
    const m = back.machine(tree.id)!;
    back.seasons.jumpTo('summer');
    expect(back.farmExtras.fruitPhase(m)).toBe('bare');
    run(back, ORCHARD.fruitDays * DAY_SECONDS + 30);
    expect(back.farmExtras.fruitReady(m)).toBe(true);
    // an old tree part way to its next crop (two days between crops then) is ripe at once if it had a day of it
    back.state.salvage!.extras![tree.id] = { age: 6, sincePrune: 1, crops: 2, growing: 1.4 };
    run(back, 30);
    expect(back.farmExtras.fruitReady(m)).toBe(true);
    // and old ripe fruit is still there to pick
    back.state.salvage!.extras![tree.id] = { age: 6, sincePrune: 1, crops: 2, ready: 1 };
    expect(back.farmExtras.pick(m)).toBe(ORCHARD.fruit);
  });
});

describe('#785 fruit trees: words', () => {
  const PHASES: FruitPhase[] = ['young', 'bare', 'blossom', 'green', 'nearly', 'ripe'];
  const RULES = [ORCHARD.daily, ...Object.values(ORCHARD.seasons)];

  it('every line names the tree’s own fruit, is plain and warm, and names no system words', () => {
    for (const f of FRUIT_IDS)
      for (const p of PHASES)
        for (const r of RULES) {
          const lines = [fruitSay(f, p, r), fruitShort(f, p, r), fruitTip(f, p, true, false, r), fruitTip(f, p, false, true, r)];
          for (const l of lines) expect(bannedIn(l), l).toEqual([]);
        }
    expect(fruitSay('pear', 'ripe')).toBe('Ripe pears hang from the branches, ready to pick.');
    expect(fruitSay('lemon', 'green')).toMatch(/green lemons/);
    expect(fruitSay('peach', 'blossom', ORCHARD.seasons.spring)).toBe('In flower for the spring. Peaches come in summer.');
    expect(fruitSay('apple', 'bare', ORCHARD.seasons.winter)).toMatch(/Resting for the winter/);
    expect(fruitShort('apple', 'green')).toBe('green apples');
    expect(bannedIn(MACHINES.orchard.blurb)).toEqual([]);
    // the ripe tip names the key as a placeholder the HUD fills in
    expect(fruitTip('apple', 'ripe', false, false)).toMatch(/Hold \{interact\} to pick them/);
    expect(fruitTip('apple', 'blossom', false, false)).not.toMatch(/\{/);
  });

  it('the panel says how the fruit is coming along, and offers the picking only when ripe', () => {
    const sim = farm();
    const tree = plant(sim);
    const kind = sim.farmExtras.fruitOf(tree);
    let html = extraHtml(sim, tree);
    expect(html).toContain(fruitSay(kind, 'young'));
    expect(html).toMatch(/data-act="pick" disabled/);
    run(sim, (ORCHARD.fruitDays + 0.01) * DAY_SECONDS);
    html = extraHtml(sim, tree);
    expect(html).toContain(fruitSay(kind, 'ripe'));
    expect(html).toContain(`data-act="pick" >${FRUITS[kind].icon} Pick the ${FRUITS[kind].plural} · 4`);
    sim.farmExtras.pick(tree);
    expect(extraHtml(sim, tree)).toContain(fruitSay(kind, 'bare', ORCHARD.seasons.summer));
  });
});

describe('#785 fruit trees: the model', () => {
  const look = (fruit: number | undefined, overgrown = false, variant = 0, kind: FruitId = 'apple', blossom = true): OrchardLook => ({ variant, kind, blossom, fruit, overgrown, bareUntil: ORCHARD.bareUntil, blossomUntil: ORCHARD.blossomUntil });
  const lin = (hex: string) => [1, 3, 5].map((i) => Math.round(Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2) * 255));
  /** vertices whose colour is near `rgb` (linear bytes) */
  const near = (g: ReturnType<typeof buildOrchardTree>, rgb: number[], tol = 40) => {
    let n = 0;
    for (let i = 0; i < g.col.length; i += 4) if (Math.abs(g.col[i] - rgb[0]) + Math.abs(g.col[i + 1] - rgb[1]) + Math.abs(g.col[i + 2] - rgb[2]) < tol) n++;
    return n;
  };

  it('a trunk, branches and a full crown: taller than a tile, about a tile across, a few thousand triangles', () => {
    const g = buildOrchardTree(look(0));
    expect(g.height).toBeGreaterThan(0.9);
    expect(g.height).toBeLessThan(1.6);
    let w = 0;
    for (let i = 0; i < g.pos.length; i += 4) w = Math.max(w, Math.abs(g.pos[i]), Math.abs(g.pos[i + 2]));
    expect(w).toBeGreaterThan(0.4);
    expect(w).toBeLessThan(0.85);
    expect(g.tris).toBeGreaterThan(1500);
    expect(g.tris).toBeLessThan(20000);
    // leaves carry the foliage flag (the leaf shader and wind), the trunk's foot doesn't sway
    expect(g.leafStarts!.length).toBeGreaterThan(200);
    let rootFlex = Infinity;
    for (let i = 0; i < g.pos.length; i += 4) if (g.pos[i + 1] < 0.02) rootFlex = Math.min(rootFlex, g.pos[i + 3]);
    expect(rootFlex).toBeLessThan(0.05);
  });

  it('#830: its leaves follow the seasons, its fruit and flowers never do (fruit doesn’t fall bare in winter)', () => {
    const ripe = buildOrchardTree(look(1));
    const bare = buildOrchardTree(look(0));
    let leaves = 0;
    for (const s of ripe.leafStarts!) if (ripe.pos[s * 4 + 3] >= SEASON_FLAG) leaves++;
    expect(leaves).toBe(ripe.leafStarts!.length);
    // everything added for the fruit (after the bare tree's vertices) is unflagged
    for (let i = bare.pos.length; i < ripe.pos.length; i += 4) expect(ripe.pos[i + 3]).toBeLessThan(LEAF_FLAG);
    const flower = buildOrchardTree(look(2 / 12));
    for (let i = bare.pos.length; i < flower.pos.length; i += 4) expect(flower.pos[i + 3]).toBeLessThan(LEAF_FLAG);
  });

  it('the canopy stays the same all day: only flowers and fruit are added to it', () => {
    const bare = buildOrchardTree(look(0));
    for (const f of [2 / 12, 5 / 12, 9 / 12, 1]) {
      const g = buildOrchardTree(look(f));
      expect(g.pos.length).toBeGreaterThan(bare.pos.length);
      expect(Array.from(g.pos.subarray(0, bare.pos.length))).toEqual(Array.from(bare.pos));
    }
    // a tree still growing up shows no flowers or fruit
    expect(buildOrchardTree(look(undefined)).pos.length).toBe(bare.pos.length);
    // in summer and autumn the bare part of the day has no flowers
    expect(buildOrchardTree(look(2 / 12, false, 0, 'apple', false)).pos.length).toBe(bare.pos.length);
  });

  it('flowers, then small green fruit that swell and colour up: ripe fruit is big and far from the leaves', () => {
    const ripeHex = PALETTE.orchard.ripe.apple;
    const bare = buildOrchardTree(look(0));
    const flower = buildOrchardTree(look(2 / 12));
    const green = buildOrchardTree(look(4 / 12));
    const ripe = buildOrchardTree(look(1));
    expect(near(flower, lin(PALETTE.orchard.blossom[1]), 60)).toBeGreaterThan(near(bare, lin(PALETTE.orchard.blossom[1]), 60) + 50);
    // ripe-red vertices only on a ripe tree
    expect(near(green, lin(ripeHex), 60)).toBe(0);
    expect(near(ripe, lin(ripeHex), 90)).toBeGreaterThan(ORCHARD_FRUIT.count * 10);
    // fruit swells: the same fruit, bigger when ripe
    expect((green.pos.length - bare.pos.length)).toBe(ripe.pos.length - bare.pos.length);
    expect(ORCHARD_FRUIT.ripeR).toBeGreaterThan(ORCHARD_FRUIT.setR * 2.5);
    // every kind's ripe colour is warm and bright, far from the green leaves and the green unripe fruit
    const unripe = parseInt(PALETTE.orchard.unripe.slice(1, 3), 16);
    for (const f of FRUIT_IDS) {
      const r = parseInt(PALETTE.orchard.ripe[f].slice(1, 3), 16);
      expect(r, f).toBeGreaterThan(0xc8);
      expect(r - unripe, f).toBeGreaterThan(0x40);
    }
  });

  it('each kind looks its own: its ripe colour, and its shape (a pear tall with a neck, a lemon long)', () => {
    const bare = buildOrchardTree(look(0));
    const fruitOf = (kind: FruitId) => {
      const g = buildOrchardTree(look(1, false, 0, kind));
      return { g, n: (g.pos.length - bare.pos.length) / 4 };
    };
    for (const f of FRUIT_IDS) expect(near(fruitOf(f).g, lin(PALETTE.orchard.ripe[f]), 90), f).toBeGreaterThan(ORCHARD_FRUIT.count * 6);
    // a pear has a neck: more to it than an apple
    expect(fruitOf('pear').n).toBeGreaterThan(fruitOf('apple').n);
    expect(FRUITS.pear.shape[1]).toBeGreaterThan(FRUITS.pear.shape[0]);
    expect(FRUITS.lemon.shape[1]).toBeGreaterThan(FRUITS.lemon.shape[0]);
    // an apple tree's ripe colour never shows on a lemon tree
    expect(near(buildOrchardTree(look(1, false, 0, 'lemon')), lin(PALETTE.orchard.ripe.apple), 40)).toBe(0);
  });

  it('an overgrown tree is shaggier and taller than a pruned one', () => {
    const tidy = buildOrchardTree(look(0.5));
    const shaggy = buildOrchardTree(look(0.5, true));
    expect(shaggy.tris).toBeGreaterThan(tidy.tris * 1.2);
    expect(shaggy.height).toBeGreaterThan(tidy.height + 0.05);
  });

  it('a young tree is drawn small and grows to full size', () => {
    expect(orchardScale(0)).toBeLessThan(0.4);
    expect(orchardScale(0.5)).toBeGreaterThan(orchardScale(0));
    expect(orchardScale(1)).toBe(1);
    expect(orchardScale(2)).toBe(1);
  });
});
