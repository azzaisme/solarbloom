// #785: fruit trees you can actually harvest. A grown tree fruits once a game day; its fruit shows on the tree as it
// comes (bare, flowers, small green fruit, colouring up, ripe); holding Interact picks it into the backpack; the
// fruit's progress saves and carries on after a load; the tree is TreeGen's leafy style with its fruit on the twigs.
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { DAY_SECONDS } from '../src/data/time';
import { ORCHARD, ORCHARD_ITEM, type FruitPhase } from '../src/data/farmExtras';
import { HOLD_ACTS, VERB_ACTS } from '../src/data/botActs';
import { fruitStep } from '../src/gameplay/FarmExtras';
import { Sim } from '../src/gameplay/Sim';
import { bannedIn } from '../src/ui/words';
import { FRUIT_SAY, FRUIT_SHORT, fruitTip } from '../src/ui/FruitWords';
import { extraHtml } from '../src/ui/ExtrasPanel';
import { buildOrchardTree, ORCHARD_FRUIT, type OrchardLook } from '../src/rendering/TreeGen';
import { PALETTE } from '../src/rendering/Palette';
import { orchardScale } from '../src/rendering/CropVisuals';
import { MACHINES } from '../src/data/machines';
import { MATERIALS } from '../src/data/salvage';
import { CHARGE } from '../src/data/charge';
import { FARM_USES, isFarmItem } from '../src/data/farm';
import { COMPOST } from '../src/data/compost';

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

/** The farm systems alone, for some seconds of play, in half-minute steps. */
function run(sim: Sim, seconds: number) {
  for (let left = seconds; left > 1e-9; left -= 30) {
    const dt = Math.min(30, left);
    sim.state.time += dt;
    sim.farmExtras.tick(dt);
  }
}

const held = (sim: Sim) => sim.inventory.count(ORCHARD_ITEM) + sim.inventory.stored(ORCHARD_ITEM);

describe('#785 fruit trees: timing', () => {
  it('grows up in a quarter of a day, then flowers, sets green fruit and ripens a game day after planting', () => {
    const sim = farm();
    const tree = plant(sim);
    const x = sim.farmExtras;
    expect(x.fruitPhase(tree)).toBe('young');
    expect(x.treeGrowth(tree)).toBe(0);
    const seen: FruitPhase[] = [];
    let ripeAt = 0;
    for (let t = 0; t < 1.2 * DAY_SECONDS; t += 30) {
      run(sim, 30);
      const p = x.fruitPhase(tree);
      if (seen[seen.length - 1] !== p) seen.push(p);
      if (p === 'ripe' && !ripeAt) ripeAt = t + 30;
    }
    // the tree grows up while its first fruit comes, so it flowers straight away once grown
    expect(seen).toEqual(['young', 'blossom', 'green', 'nearly', 'ripe']);
    expect(x.treeGrowth(tree)).toBe(1);
    // ripe one game day (48 minutes of play) after planting: within a normal play session
    expect(ripeAt).toBeGreaterThan((ORCHARD.fruitDays - 0.01) * DAY_SECONDS);
    expect(ripeAt).toBeLessThanOrEqual((ORCHARD.fruitDays + 0.01) * DAY_SECONDS);
    expect(ORCHARD.fruitDays * DAY_SECONDS).toBe(48 * 60);
    // ripe fruit waits on the tree
    run(sim, 2 * DAY_SECONDS);
    expect(x.fruitPhase(tree)).toBe('ripe');
    expect(x.st(tree).crops).toBe(1);
  });

  it('after picking: bare, then flowers, green fruit, nearly ripe and ripe again one game day later', () => {
    const sim = farm();
    const tree = plant(sim);
    const x = sim.farmExtras;
    run(sim, ORCHARD.fruitDays * DAY_SECONDS + 30);
    expect(x.pick(tree)).toBe(ORCHARD.fruit);
    expect(x.fruitPhase(tree)).toBe('bare');
    expect(x.fruitShown(tree)).toBe(0);
    const seen: FruitPhase[] = ['bare'];
    let t = 0;
    for (; t < 2 * DAY_SECONDS && x.fruitPhase(tree) !== 'ripe'; t += 30) {
      run(sim, 30);
      const p = x.fruitPhase(tree);
      if (seen[seen.length - 1] !== p) seen.push(p);
    }
    expect(seen).toEqual(['bare', 'blossom', 'green', 'nearly', 'ripe']);
    expect(Math.abs(t - ORCHARD.fruitDays * DAY_SECONDS)).toBeLessThanOrEqual(30);
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
    for (const k of [ORCHARD.bareUntil, ORCHARD.blossomUntil, ORCHARD.nearlyRipe]) expect(Math.abs(k * ORCHARD.looks - Math.round(k * ORCHARD.looks))).toBeLessThan(1e-9);
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
  });
});

describe('#785 fruit trees: picking', () => {
  it('picking ripe fruit puts it in the backpack, and the store takes what the backpack has no room for', () => {
    const sim = farm();
    const tree = plant(sim);
    run(sim, ORCHARD.fruitDays * DAY_SECONDS + 30);
    const before = held(sim);
    const harvested: unknown[] = [];
    sim.bus.on('farm.harvested', (e) => harvested.push(e));
    expect(sim.farmExtras.fruitYield(tree)).toBe(ORCHARD.fruit);
    expect(sim.farmExtras.pick(tree)).toBe(ORCHARD.fruit);
    expect(held(sim) - before).toBe(ORCHARD.fruit);
    expect(sim.inventory.count(ORCHARD_ITEM)).toBeGreaterThan(0);
    expect(harvested).toEqual([{ machineId: tree.id, item: ORCHARD_ITEM, n: ORCHARD.fruit }]);
    // nothing more until it regrows
    expect(sim.farmExtras.pick(tree)).toBe(0);
    expect(held(sim) - before).toBe(ORCHARD.fruit);
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
});

describe('#785 fruit trees: Fruit, a real item', () => {
  it('picking gives Fruit, a backpack item with its own name, icon and words', () => {
    expect(ORCHARD_ITEM).toBe('fruit');
    expect(MATERIALS.fruit).toMatchObject({ id: 'fruit', name: 'Fruit', icon: '🍎' });
    expect(isFarmItem('fruit')).toBe(true);
    expect(bannedIn(FARM_USES.fruit.blurb)).toEqual([]);
  });

  it('Bloombot eats it for charge: a sweet snack, more than Food, less than Honey', () => {
    const sim = farm();
    expect(FARM_USES.fruit.charge).toBeGreaterThan(FARM_USES.food.charge);
    expect(FARM_USES.fruit.charge).toBeLessThan(FARM_USES.honey.charge);
    sim.state.charge = { value: 10 };
    sim.bot = { roofId: GROUND, x: 30.5, z: 30.5 }; // away from home (no resting trickle)
    const pack = sim.state.salvage!.pack as Record<string, number>;
    for (const k of Object.keys(pack)) delete pack[k];
    pack.fruit = 2;
    expect(sim.charge.eat()).toMatchObject({ id: 'fruit' });
    sim.advance(4);
    expect(sim.charge.value()).toBeCloseTo(10 + FARM_USES.fruit.charge * CHARGE.max, 1);
    expect(pack.fruit).toBe(1);
  });

  it('it rots down in a compost bin as richly as Food, and Moss (who hands over fruit trees) loves it as a gift', () => {
    const sim = farm();
    for (const [k, v] of Object.entries(sim.build.recipe('compostBin')!)) sim.inventory.add(k as 'scrap', v!);
    const t = sim.grid.get(GROUND, 14, 16)!;
    Object.assign(t, { blocked: false, feature: undefined, ground: 'restored', pollution: 0, bloom: 1 });
    const bin = sim.build.place('compostBin', GROUND, 14, 16);
    expect(bin).toBeDefined();
    sim.inventory.add('fruit', 2);
    expect(sim.compost.fill(bin!, 'fruit')).toBe(2);
    expect(sim.compost.bin(bin!).feed).toBe(2 * COMPOST.foodWorth);
    expect(sim.keepers.likes('moss')).toContain('fruit');
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
    expect(c.farmExtras.fruitPhase(c.machine(tree.id)!)).toBe('bare');
  });

  it('a tree from an older save (the old slow orchard) loads and fruits within a day', () => {
    const sim = farm();
    const tree = plant(sim);
    // the old rules: three days to the first fruit, its progress counted only after that
    sim.state.salvage!.extras = { [tree.id]: { age: 1.5, sincePrune: 1.5 } };
    const json = saver().serialize(sim.state);
    const back = new Sim(saver().deserialize(json)!);
    const m = back.machine(tree.id)!;
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
  it('every line is plain and warm, and names no system words', () => {
    const lines = [...Object.values(FRUIT_SAY), ...Object.values(FRUIT_SHORT), fruitTip('ripe', true), fruitTip('green', false), MACHINES.orchard.blurb];
    for (const l of lines) expect(bannedIn(l), l).toEqual([]);
    // the ripe tip names the key as a placeholder the HUD fills in
    expect(fruitTip('ripe', false)).toMatch(/Hold \{interact\} to pick it/);
    expect(fruitTip('blossom', false)).not.toMatch(/\{/);
  });

  it('the panel says how the fruit is coming along, and offers the picking only when ripe', () => {
    const sim = farm();
    const tree = plant(sim);
    let html = extraHtml(sim, tree);
    expect(html).toContain(FRUIT_SAY.young);
    expect(html).toMatch(/data-act="pick" disabled/);
    run(sim, (ORCHARD.fruitDays + 0.01) * DAY_SECONDS);
    html = extraHtml(sim, tree);
    expect(html).toContain(FRUIT_SAY.ripe);
    expect(html).toMatch(/data-act="pick" >🍎 Pick the fruit · 4/);
    sim.farmExtras.pick(tree);
    expect(extraHtml(sim, tree)).toContain(FRUIT_SAY.bare);
  });
});

describe('#785 fruit trees: the model', () => {
  const look = (fruit: number | undefined, overgrown = false, variant = 0): OrchardLook => ({ variant, fruit, overgrown, bareUntil: ORCHARD.bareUntil, blossomUntil: ORCHARD.blossomUntil });
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

  it('the canopy stays the same all day: only flowers and fruit are added to it', () => {
    const bare = buildOrchardTree(look(0));
    for (const f of [2 / 12, 5 / 12, 9 / 12, 1]) {
      const g = buildOrchardTree(look(f));
      expect(g.pos.length).toBeGreaterThan(bare.pos.length);
      expect(Array.from(g.pos.subarray(0, bare.pos.length))).toEqual(Array.from(bare.pos));
    }
    // a tree still growing up shows no flowers or fruit
    expect(buildOrchardTree(look(undefined)).pos.length).toBe(bare.pos.length);
  });

  it('flowers, then small green fruit that swell and colour up: ripe fruit is big and far from the leaves', () => {
    const ripeHex = PALETTE.orchard.ripe[0];
    const bare = buildOrchardTree(look(0));
    const flower = buildOrchardTree(look(2 / 12));
    const green = buildOrchardTree(look(4 / 12));
    const ripe = buildOrchardTree(look(1));
    expect(near(flower, lin(PALETTE.orchard.blossom[1]), 60)).toBeGreaterThan(near(bare, lin(PALETTE.orchard.blossom[1]), 60) + 50);
    // ripe-red vertices only on a ripe tree
    expect(near(green, lin(ripeHex), 60)).toBe(0);
    expect(near(ripe, lin(ripeHex), 90)).toBeGreaterThan(ORCHARD_FRUIT.count * 10);
    // fruit swells: the extra geometry is the same count, but the ripe fruit spans more
    const extent = (g: typeof ripe) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = bare.pos.length; i < g.pos.length; i += 4) {
        lo = Math.min(lo, g.pos[i + 1]);
        hi = Math.max(hi, g.pos[i + 1]);
      }
      return { lo, n: (g.pos.length - bare.pos.length) / 4 };
    };
    expect(extent(green).n).toBe(extent(ripe).n);
    expect(ORCHARD_FRUIT.ripeR).toBeGreaterThan(ORCHARD_FRUIT.setR * 2.5);
    // each variant has its own ripe colour, and every ripe colour is far from green leaves
    for (const h of PALETTE.orchard.ripe) {
      const [r, g] = lin(h);
      expect(r).toBeGreaterThan(g * 1.6);
    }
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
