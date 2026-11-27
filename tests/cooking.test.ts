import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { CHARGE } from '../src/data/charge';
import { COOKING, MEAL_IDS, RECIPES } from '../src/data/cooking';
import { CROP_HOMES, CROPS, type CropId } from '../src/data/crops';
import { FARM_USES } from '../src/data/farm';
import { FRUIT_IDS } from '../src/data/fruit';
import { FRIENDSHIP, KEEPER_STORIES } from '../src/data/keepers';
import { HOUSE_GROWTH, KEEPERS } from '../src/data/oldcity';
import { MATERIALS } from '../src/data/salvage';
import { rawCharge } from '../src/gameplay/Cooking';
import { Sim } from '../src/gameplay/Sim';
import { itemCells } from '../src/ui/BackpackModel';
import { cookingHtml } from '../src/ui/CookingPanel';
import { EMOJI_ICONS, EMOJI_RE } from '../src/ui/Icons';
import { MATERIAL_ICON_IDS } from '../src/ui/MaterialIcons';
import { bannedIn } from '../src/ui/words';

SaveService.clock = () => 0;

/** A game with the house grown to `level` (the House, level 3, brings the stove). */
function scene(level = 3) {
  const sim = new Sim(createInitialState(7));
  sim.areas.clear(PARK, true);
  const sv = sim.state.salvage!;
  sv.tier = HOUSE_GROWTH.opensAtStep;
  for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone'] as const) sv.store[m] = 500;
  sim.bot = { roofId: GROUND, x: 4.5, z: 6.5 };
  while (sim.house.level < level) sim.house.giveAll();
  return sim;
}

/** Everything every recipe needs, twice over: in the basket and the backpack. */
function stock(sim: Sim) {
  const sv = sim.state.salvage!;
  sv.basket = {};
  for (const r of Object.values(RECIPES)) for (const [c, n] of Object.entries(r.crops)) sv.basket[c] = (sv.basket[c] ?? 0) + 2 * n!;
  sim.inventory.add('food', 10);
  sim.inventory.add('honey', 4);
  sim.inventory.add('apple', 2);
  sim.inventory.add('peach', 2);
}

/** Empties Charge, with Bloombot away from home (so no trickle comes back while it eats). */
const drain = (sim: Sim) => {
  sim.bot = { roofId: GROUND, x: 40.5, z: 40.5 };
  sim.charge.drainForTest();
};

/** Ticks Charge until a meal is eaten through. */
function digest(sim: Sim) {
  for (let i = 0; i < 400 && sim.charge.eating; i++) sim.charge.tick(0.05);
}

describe('#874: cooking at the stove', () => {
  it('four recipes, each from crops the player can grow and food they can carry, as the owner picked them', () => {
    expect(MEAL_IDS.length).toBeGreaterThanOrEqual(4);
    const grown = new Set(Object.values(CROP_HOMES).flat());
    for (const id of MEAL_IDS) {
      const r = RECIPES[id];
      expect(Object.keys(r.crops).length, id).toBeGreaterThan(0);
      for (const c of Object.keys(r.crops)) {
        expect(c in CROPS, `${id}: ${c}`).toBe(true);
        expect(grown.has(c as CropId), `${id}: ${c}'s seeds are found somewhere`).toBe(true);
      }
    }
    expect(RECIPES.soup).toMatchObject({ crops: { potato: 2, radish: 1 }, pack: { food: 1 }, charge: 40 });
    expect(RECIPES.salad).toMatchObject({ crops: { tomato: 2, lettuce: 1 }, pack: {}, charge: 35 });
    expect(RECIPES.cornBake).toMatchObject({ crops: { sweetcorn: 2 }, pack: { food: 1 }, charge: 35 });
    expect(RECIPES.pie).toMatchObject({ crops: { pumpkin: 1 }, pack: { fruit: 1, honey: 1 }, charge: 60 });
  });

  it('cooking can’t skip the Charge system: every meal gives 35–60, never more than 1.25× what went into it', () => {
    for (const id of MEAL_IDS) {
      const r = RECIPES[id];
      expect(r.charge, id).toBeGreaterThanOrEqual(35);
      expect(r.charge, id).toBeLessThanOrEqual(COOKING.maxCharge);
      expect(r.charge, `${id}: ${r.charge} against ${rawCharge(id)} raw`).toBeLessThanOrEqual(COOKING.capShare * rawCharge(id) + 1e-9);
    }
    expect(COOKING.capShare).toBe(1.25);
    expect(COOKING.maxCharge).toBe(60);
    // the raw sums, by hand: a basket crop is one Food (25), fruit the least sweet (an apple), Honey 40
    const apple = Math.min(...FRUIT_IDS.map((f) => FARM_USES[f].charge * 100));
    expect(rawCharge('soup')).toBeCloseTo(4 * 25);
    expect(rawCharge('salad')).toBeCloseTo(3 * 25);
    expect(rawCharge('cornBake')).toBeCloseTo(3 * 25);
    expect(rawCharge('pie')).toBeCloseTo(25 + apple + 40);
    // a meal is never better than the best thing Bloombot can eat raw by more than the cap allows, and the stack of a
    // full basket's meals can't refill more than the crops would
    for (const id of MEAL_IDS) expect(CHARGE.edibles.find((e) => e.id === id)!.charge).toBe(RECIPES[id].charge);
  });

  it('meals are backpack items, never traded and never a waking gift; a snack eats raw food before any meal', () => {
    for (const id of MEAL_IDS) {
      expect(MATERIALS[id].meal, id).toBe(true);
      expect(MATERIAL_ICON_IDS, id).toContain(id);
      for (const e of RECIPES[id].icon.match(EMOJI_RE) ?? []) expect(EMOJI_ICONS[e.replace(/️/g, '')], `${id}'s ${e}`).toBeDefined();
    }
    const ids = CHARGE.edibles.map((e) => e.id);
    for (const m of MEAL_IDS) for (const raw of ['honey', 'food', 'biomass', ...FRUIT_IDS]) expect(ids.indexOf(m), `${m} after ${raw}`).toBeGreaterThan(ids.indexOf(raw as never));
    const sim = scene();
    for (const m of MEAL_IDS) sim.inventory.add(m, 6);
    expect(sim.landmarks.tradeTargets().some((m) => MATERIALS[m].meal)).toBe(false);
    expect(sim.landmarks.tradable().some((m) => MATERIALS[m].meal)).toBe(false);
    expect(sim.keepers.giftMaterial()).not.toMatch(/soup|salad|cornBake|pie/);
    // with Food and a meal carried, the snack key eats the Food
    sim.inventory.add('food', 1);
    drain(sim);
    const r = sim.charge.eat();
    expect(typeof r === 'object' && r.id).toBe('food');
  });

  it('cooks each recipe: takes its crops and food, puts the meal in the backpack, and the meal tops up Charge by its amount', () => {
    const sim = scene();
    stock(sim);
    const sv = sim.state.salvage!;
    for (const id of MEAL_IDS) {
      const basket = { ...sv.basket };
      const food = sim.inventory.count('food');
      const honey = sim.inventory.count('honey');
      expect(sim.cooking.problem(id), id).toBeUndefined();
      expect(sim.cooking.cook(id), id).toBe(true);
      expect(sim.inventory.count(id), id).toBe(1);
      for (const [c, n] of Object.entries(RECIPES[id].crops)) expect(sv.basket![c] ?? 0, `${id}: ${c}`).toBe(basket[c]! - n!);
      expect(sim.inventory.count('food'), id).toBe(food - (RECIPES[id].pack.food ?? 0));
      expect(sim.inventory.count('honey'), id).toBe(honey - (RECIPES[id].pack.honey ?? 0));
      // eaten on purpose (the backpack's Eat one): exactly its Charge
      drain(sim);
      const ate = sim.charge.eat(id);
      expect(typeof ate === 'object' && ate.id, id).toBe(id);
      digest(sim);
      expect(sim.charge.value(), id).toBeCloseTo(RECIPES[id].charge, 2);
      expect(sim.inventory.count(id), id).toBe(0);
    }
  });

  it('the pie takes the least sweet fruit carried, and keeps the sweeter ones', () => {
    const sim = scene();
    stock(sim);
    expect(sim.cooking.fruitToUse()).toBe('apple');
    sim.cooking.cook('pie');
    expect(sim.inventory.count('apple')).toBe(1);
    expect(sim.inventory.count('peach')).toBe(2);
  });

  it('says why a meal can’t be cooked: no stove before the House, something short, or a full backpack', () => {
    const cottage = scene(2);
    stock(cottage);
    expect(cottage.cooking.hasStove()).toBe(false);
    expect(cottage.cooking.problem('soup')).toEqual({ kind: 'noStove' });
    expect(cottage.cooking.cook('soup')).toBe(false);

    const sim = scene();
    expect(sim.cooking.hasStove()).toBe(true);
    sim.state.salvage!.basket = { potato: 2 };
    const p = sim.cooking.problem('soup');
    expect(p?.kind === 'short' && p.need.id).toBe('radish');
    expect(sim.cooking.cook('soup')).toBe(false);
    expect(sim.state.salvage!.basket).toEqual({ potato: 2 }); // nothing taken
    stock(sim);
    sim.inventory.add('salad', sim.inventory.room('salad'));
    expect(sim.cooking.problem('salad')).toEqual({ kind: 'full' });
  });

  it('every Keeper loves a meal as a gift (still one gift a day), and thanks you for it in its own words', () => {
    for (const k of KEEPERS) {
      const st = KEEPER_STORIES[k.id];
      expect(st.mealThanks.length, k.id).toBeGreaterThan(10);
      expect(st.mealThanks.length, k.id).toBeLessThan(140);
      expect(st.mealThanks, k.id).not.toBe(st.thanks);
      expect(bannedIn(st.mealThanks), k.id).toEqual([]);
    }
    const sim = scene();
    sim.state.salvage!.basket = {};
    sim.gates.open('g-mastRow', true); // Pylon's region, in sight
    sim.state.salvage!.keepers.pylon = { step: 'settled' };
    sim.inventory.add('soup', 2);
    expect(sim.keepers.likes('pylon')).toEqual(expect.arrayContaining([...MEAL_IDS]));
    expect(sim.keepers.giftFor('pylon')).toBe('soup');
    const said: string[][] = [];
    sim.bus.on('keeper.said', (e) => said.push(e.lines));
    expect(sim.keepers.interact('pylon')).toBe('gave');
    expect(sim.inventory.count('soup')).toBe(1);
    expect(said.at(-1)).toEqual([KEEPER_STORIES.pylon.mealThanks]);
    // one gift a day: the second soup waits for tomorrow
    expect(sim.keepers.giftFor('pylon')).toBeUndefined();
    sim.state.time += FRIENDSHIP.giftEverySeconds;
    expect(sim.keepers.giftFor('pylon')).toBe('soup');
    // what it loves of its own comes before a meal
    sim.inventory.add('copper', 1);
    expect(sim.keepers.giftFor('pylon')).toBe('copper');
    // the hint names what it loves, not the meals
    expect(sim.keepers.hint('pylon')).not.toMatch(/soup|pie|salad|bake/i);
  });

  it('in the backpack a meal says where it comes from and what it is for', () => {
    const sim = scene();
    sim.inventory.add('soup', 1);
    const cell = itemCells(sim).find((c) => c.id === 'soup')!;
    expect(cell.from).toBe('Cooked at the stove in your kitchen');
    expect(cell.next).toMatch(/Eat it for Charge, or give it to a Keeper/);
    expect(bannedIn(cell.next)).toEqual([]);
  });

  it('meals keep through a save', () => {
    const sim = scene();
    stock(sim);
    sim.cooking.cook('pie');
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.inventory.count('pie')).toBe(1);
  });

  it('the stove’s panel: every recipe, what it takes against what you have, plain words', () => {
    const sim = scene();
    let html = cookingHtml(sim);
    for (const id of MEAL_IDS) {
      expect(html).toContain(RECIPES[id].name);
      expect(html).toContain(`data-arg="${id}"`);
    }
    expect(html.match(/data-act="cook"[^>]*disabled/g)?.length).toBe(4); // nothing to cook with yet
    expect(html).toMatch(/you keep one from each harvest/);
    expect(bannedIn(html)).toEqual([]);
    for (const e of html.match(EMOJI_RE) ?? []) expect(EMOJI_ICONS[e.replace(/️/g, '')], e).toBeDefined();
    stock(sim);
    html = cookingHtml(sim);
    expect(html.match(/data-act="cook"[^>]*disabled/g)).toBeNull();
  });
});
