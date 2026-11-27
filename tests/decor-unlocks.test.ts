import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { DECOR_OPTION, DECOR_OPTIONS, decorSet } from '../src/data/cozy';
import { DECOR_RECIPES, type DecorRecipe } from '../src/data/crafting';
import { HOUSE, HOUSE_GROWTH, HOUSE_INSIDE, KEEPERS } from '../src/data/oldcity';
import { houseStep } from '../src/gameplay/Crafting';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import { buildItems } from '../src/ui/BuildCatalog';
import { decorRows } from '../src/ui/CraftTable';
import { bannedIn, WORDS } from '../src/ui/words';

SaveService.clock = () => 0;

/** #852: how every piece made for a room is earned. */
const INDOOR = DECOR_OPTIONS.filter((o) => decorSet(o) === 'indoor').map((o) => o.id);
const recipe = (id: string) => DECOR_RECIPES.find((r) => r.id === id) as DecorRecipe;

/** The agreed table: a gift with each level of the house, three Keepers' gifts, the rest made at the workbench. */
const LEVEL_GIFTS = ['armchair', 'roundrug', 'floorlamp', 'bigrug'];
const KEEPER_GIFTS: Record<string, string> = { clock: 'tock', pottedtree: 'moss', patternrug: 'tally' };
const MADE: Record<string, [number, Record<string, number>]> = {
  stool: [1, { planks: 1 }],
  sidetable: [1, { planks: 2 }],
  cushions: [1, { seeds: 2 }],
  bookshelf: [2, { planks: 3 }],
  coatstand: [2, { planks: 1, scrap: 1 }],
  hallrunner: [2, { seeds: 3 }],
  diningtable: [3, { planks: 4 }],
  tablelamp: [3, { planks: 1, glassPane: 1, wire: 1 }],
  houseplant: [3, { clay: 2, seeds: 1 }],
};

/** A garden past the fountain's first step: the house can be mended. Bloombot by the door outside. */
function game(level = 0) {
  const sim = new Sim(createInitialState(7));
  sim.areas.clear(PARK, true);
  const sv = sim.state.salvage!;
  sv.tier = HOUSE_GROWTH.opensAtStep;
  for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone'] as const) sv.store[m] = 500;
  sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
  for (let i = 0; i < level; i++) sim.house.giveAll();
  return { sim, cozy: new Cozy(sim) };
}

const wake = (sim: Sim, keeper: string) => (sim.state.salvage!.keepers[keeper] = { step: 'request1' });
const indoorItems = (sim: Sim) => buildItems(sim, true).filter((i) => i.set === 'indoor');

describe('#852: every piece made for a room has a way to be earned', () => {
  it('each of the 16 has a recipe: a level of the house, a Keeper or the workbench, every one reachable', () => {
    expect(INDOOR).toHaveLength(16);
    for (const id of INDOOR) {
      const r = recipe(id);
      expect(r, id).toBeDefined();
      const u = r.unlock;
      if ('house' in u) expect(u.house >= 1 && u.house <= HOUSE.length, id).toBe(true);
      else if ('keeper' in u) expect(KEEPERS.some((k) => k.region === u.keeper), id).toBe(true);
      else throw new Error(`${id}: earned through the house or a Keeper`);
    }
    // the agreed split: one gift per level, three Keepers' gifts, nine made at the workbench
    expect(LEVEL_GIFTS.map((id) => [recipe(id).gift, recipe(id).unlock])).toEqual([1, 2, 3, 4].map((house) => [true, { house }]));
    for (const [id, keeper] of Object.entries(KEEPER_GIFTS)) {
      const k = KEEPERS.find((x) => x.id === keeper)!;
      expect(recipe(id), id).toEqual({ id, cost: {}, unlock: { keeper: k.region }, gift: true });
    }
    for (const [id, [house, cost]] of Object.entries(MADE)) expect(recipe(id), id).toEqual({ id, cost, unlock: { house } });
    expect(new Set([...LEVEL_GIFTS, ...Object.keys(KEEPER_GIFTS), ...Object.keys(MADE)])).toEqual(new Set(INDOOR));
  });

  it('workbench costs stay small: one or two everyday things, four of any one at most', () => {
    for (const id of Object.keys(MADE)) {
      const cost = recipe(id).cost;
      expect(Object.keys(cost).length, id).toBeLessThanOrEqual(3);
      for (const [k, n] of Object.entries(cost)) {
        expect(['planks', 'clay', 'seeds', 'scrap', 'wire', 'glassPane'], `${id}: ${k}`).toContain(k);
        expect(n, `${id}: ${k}`).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('#852: the house brings a piece with each level', () => {
  it('nothing for the room before the shed is mended; mending it gives the armchair, once', () => {
    const { sim, cozy } = game();
    expect(cozy.giveEarnedDecor()).toEqual([]);
    for (const id of INDOOR) expect(cozy.isDecorUnlocked(DECOR_OPTION[id]), id).toBe(false);
    sim.house.giveAll();
    expect(sim.house.level).toBe(1);
    const got = cozy.giveEarnedDecor();
    expect(got.map((g) => [g.option.id, g.level, g.keeper])).toEqual([['armchair', 1, undefined]]);
    expect(cozy.isDecorUnlocked(DECOR_OPTION.armchair)).toBe(true);
    expect(cozy.giveEarnedDecor()).toEqual([]);
    // it counts as announced (its own toast is the only one)
    expect(cozy.checkDecorUnlocks().map((o) => o.id)).not.toContain('armchair');
    // it is free to place inside straight away
    expect(cozy.canDecorate('armchair', HOUSE_INSIDE.layer, 2, 2)).toBeUndefined();
  });

  it('each level after gives its own: the round rug, the floor lamp, the big rug', () => {
    const { sim, cozy } = game(1);
    cozy.giveEarnedDecor();
    for (const [i, id] of ['roundrug', 'floorlamp', 'bigrug'].entries()) {
      sim.house.giveAll();
      expect(sim.house.level).toBe(i + 2);
      expect(cozy.giveEarnedDecor().map((g) => [g.option.id, g.level])).toEqual([[id, i + 2]]);
    }
    for (const id of LEVEL_GIFTS) expect(sim.crafting.decorMade(id), id).toBe(true);
  });

  it('the workbench learns each level’s recipes as the house grows, and a gift is never on its list', () => {
    const { sim } = game();
    const known = () => decorRows(sim).map((r) => r.id).filter((id) => INDOOR.includes(id)).sort();
    const want = (lv: number) => Object.entries(MADE).filter(([, [h]]) => h <= lv).map(([id]) => id).sort();
    expect(known()).toEqual([]);
    for (let lv = 1; lv <= 4; lv++) {
      sim.house.giveAll();
      expect(known(), `level ${lv}`).toEqual(want(lv));
    }
    for (const id of [...LEVEL_GIFTS, ...Object.keys(KEEPER_GIFTS)]) expect(sim.crafting.decorProblem(id), id).toMatch(/^🔒 A gift when you /);
  });

  it('a recipe is made once at its price, then placed free as often as you like', () => {
    const { sim, cozy } = game(2);
    const inv = sim.inventory;
    inv.add('planks', 3);
    expect(sim.crafting.makeDecor('bookshelf')).toBe(true);
    expect(inv.count('planks')).toBe(0);
    expect(sim.crafting.makeDecor('bookshelf')).toBe(false);
    const id = HOUSE_INSIDE.layer;
    expect(cozy.placeDecor('bookshelf', 0, id, 1, 1)).toBeUndefined();
    expect(cozy.placeDecor('bookshelf', 0, id, 2, 1)).toBeUndefined();
    // a recipe from a bigger house isn't made before then
    inv.add('planks', 4);
    expect(sim.crafting.makeDecor('diningtable')).toBe(false);
    expect(sim.crafting.decorProblem('diningtable')).toBe('🔒 Grow the cottage into a house');
  });
});

describe('#852: three Keepers hand over a piece as they wake', () => {
  it('Tock the clock, Moss the little potted tree, Tally the patterned rug: each once, with who it is from', () => {
    const { sim, cozy } = game(1);
    cozy.giveEarnedDecor();
    for (const [id, keeper] of Object.entries(KEEPER_GIFTS)) {
      expect(cozy.isDecorUnlocked(DECOR_OPTION[id])).toBe(false);
      wake(sim, keeper);
      const name = KEEPERS.find((k) => k.id === keeper)!.name;
      expect(cozy.giveEarnedDecor().map((g) => [g.option.id, g.keeper, g.level])).toEqual([[id, name, undefined]]);
      expect(cozy.giveEarnedDecor()).toEqual([]);
    }
  });

  it('a Keeper woken before the house is mended still gives its piece (Keepers don’t wait for the house)', () => {
    const { sim, cozy } = game();
    wake(sim, 'tock');
    expect(cozy.giveEarnedDecor().map((g) => g.option.id)).toEqual(['clock']);
  });
});

describe('#852: a save from before this', () => {
  it('loads unchanged, then gets what it has earned once: every level reached and every Keeper awake', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const { sim } = game(3);
    wake(sim, 'moss');
    const json = saver.serialize(sim.state);
    const copy = new Sim(saver.deserialize(json)!);
    expect(saver.serialize(copy.state)).toBe(json);
    const cozy = new Cozy(copy);
    expect(cozy.giveEarnedDecor().map((g) => g.option.id)).toEqual(['armchair', 'roundrug', 'floorlamp', 'pottedtree']);
    expect(cozy.giveEarnedDecor()).toEqual([]);
    // saved: a reload gives nothing again
    const again = new Cozy(new Sim(saver.deserialize(saver.serialize(copy.state))!));
    expect(again.giveEarnedDecor()).toEqual([]);
  });

  it('pieces already placed in the room load where they were (the earlier pieces stay as they stood)', () => {
    const saver = new SaveService(undefined);
    saver.now = () => 1;
    const { sim, cozy } = game(2);
    cozy.giveEarnedDecor();
    const id = HOUSE_INSIDE.layer;
    expect(cozy.placeDecor('armchair', 1, id, 1, 1)).toBeUndefined();
    expect(cozy.placeDecor('roundrug', 0, id, 3, 3)).toBeUndefined();
    const json = saver.serialize(sim.state);
    const c2 = new Cozy(new Sim(saver.deserialize(json)!));
    expect(c2.decorations().map((d) => `${d.kind}@${d.rot} ${d.x},${d.z}`)).toEqual(['armchair@1 1,1', 'roundrug@0 3,3']);
  });
});

describe('#852: the tray says how to get a piece still locked', () => {
  it('before the shed is mended every piece for a room is listed, locked, with how it comes', () => {
    const { sim } = game();
    const items = indoorItems(sim);
    expect(items.map((i) => i.tool.slice(6)).sort()).toEqual([...INDOOR].sort());
    const say = Object.fromEntries(items.map((i) => [i.tool.slice(6), i.lockText]));
    for (const i of items) expect(i.locked, i.tool).toBe(true);
    expect(say.armchair).toBe('A gift when you mend the old shed');
    expect(say.roundrug).toBe('A gift when you grow the shed into a cottage');
    expect(say.floorlamp).toBe('A gift when you grow the cottage into a house');
    expect(say.bigrug).toBe('A gift when you grow the house into a home');
    expect(say.clock).toBe('A gift when you wake Tock in Clock Plaza');
    expect(say.pottedtree).toBe('A gift when you wake Moss in Elder Grove');
    expect(say.patternrug).toBe('A gift when you wake Tally in Old Market');
    expect(say.stool).toBe('Mend the old shed');
    expect(say.bookshelf).toBe('Grow the shed into a cottage');
    expect(say.diningtable).toBe('Grow the cottage into a house');
    for (const t of Object.values(say)) expect(bannedIn(t!), t).toEqual([]);
  });

  it('once the house is big enough a recipe says to make it at the workbench; once made it is open', () => {
    const { sim, cozy } = game(1);
    cozy.giveEarnedDecor();
    const item = (id: string) => indoorItems(sim).find((i) => i.tool === `decor:${id}`)!;
    expect(item('armchair').locked).toBe(false);
    expect(item('stool').lockText).toBe('Make it at the workbench');
    sim.inventory.add('planks', 1);
    expect(sim.crafting.makeDecor('stool')).toBe(true);
    expect(item('stool').locked).toBe(false);
    expect(item('bookshelf').lockText).toBe('Grow the shed into a cottage');
  });

  it('the garden pieces keep their old rule: a locked one stays off the list until its recipe is known', () => {
    const { sim } = game();
    const garden = buildItems(sim, false).filter((i) => i.set === 'garden').map((i) => i.tool);
    expect(garden).not.toContain('decor:trough');
    expect(garden).toContain('decor:bench');
  });

  it('the words: a step for each level, and gift toasts in plain words', () => {
    expect([1, 2, 3, 4].map(houseStep)).toEqual(['mend the old shed', 'grow the shed into a cottage', 'grow the cottage into a house', 'grow the house into a home']);
    const lines = [
      WORDS.decor.houseGift('🛋️', 'Armchair', 'shed'),
      WORDS.decor.keeperGift('🕰️', 'Clock', 'Tock'),
      WORDS.decor.gifts(['Armchair', 'Round rug', 'Floor lamp']),
      WORDS.decor.gifts(['Clock']),
    ];
    expect(lines[0]).toMatch(/^🛋️ Something for the shed: Armchair<small>/);
    expect(lines[1]).toMatch(/^🕰️ Tock gave you a clock<small>/);
    expect(lines[2]).toMatch(/^🏡 New things for the house: Armchair, Round rug and Floor lamp<small>/);
    expect(lines[3]).toMatch(/^🏡 New things for the house: Clock<small>/);
    for (const l of lines) expect(bannedIn(l.replace(/<[^>]+>/g, ' ')), l).toEqual([]);
  });
});

describe('#852: each level’s decoration limit still holds', () => {
  it('12, 40, 80 and 140, and a full room refuses one more piece for the room', () => {
    expect(HOUSE.map((h) => h.decor)).toEqual([12, 40, 80, 140]);
    const { sim, cozy } = game(1);
    cozy.giveEarnedDecor();
    const id = HOUSE_INSIDE.layer;
    let placed = 0;
    for (const t of sim.grid.tilesOf(id)) if (placed < HOUSE[0].decor && !cozy.placeDecor('armchair', 0, id, t.x, t.z)) placed++;
    expect(cozy.insideCount()).toBe(12);
    const free = sim.grid.tilesOf(id).find((t) => !t.occupantId && !t.blocked);
    if (free) expect(cozy.canDecorate('armchair', id, free.x, free.z)).toMatch(/^The shed holds 12 decorations/);
    sim.house.giveAll();
    expect(sim.house.decorMax()).toBe(40);
  });
});
