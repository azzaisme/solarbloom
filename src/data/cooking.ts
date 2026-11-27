// #874 (epic #845): cooking at the kitchen's stove. All data, no rules: the owner's picks of 28 Nov 2026.
//
// A meal is cooked from crops kept in the basket (one of each harvest is kept there, data/keepers FRIENDSHIP) and
// food carried in the backpack (Food, fruit, Honey). It goes into the backpack. Eaten, it tops up Charge (data/charge
// lists the meals last, so a snack eats the raw food first); handed to a Keeper, it is a gift every Keeper loves.
//
// Cooking can't be used to skip the Charge system: a meal never gives more than COOKING.capShare times the Charge of
// what went into it (each basket crop counted as one Food), and never more than COOKING.maxCharge. tests/cooking.test.ts
// holds every recipe to that.

import type { CropId } from './crops';
import type { FruitId } from './fruit';

export const MEAL_IDS = ['soup', 'salad', 'cornBake', 'pie'] as const;
export type MealId = (typeof MEAL_IDS)[number];
export const isMeal = (id: string): id is MealId => (MEAL_IDS as readonly string[]).includes(id);

/** What a recipe takes from the backpack: Food, Honey, a fruit of a kind, or `fruit` (any kind: the least sweet carried). */
export type PackNeed = 'food' | 'honey' | FruitId | 'fruit';

export interface RecipeDef {
  id: MealId;
  name: string;
  icon: string;
  /** crops from the basket */
  crops: Partial<Record<CropId, number>>;
  /** food from the backpack */
  pack: Partial<Record<PackNeed, number>>;
  /** the Charge one meal gives when eaten */
  charge: number;
  /** a line for the backpack and the stove */
  blurb: string;
}

export const COOKING = {
  /** a meal gives at most this many times the Charge of what went into it */
  capShare: 1.25,
  /** and never more than this */
  maxCharge: 60,
  /** what a basket crop counts as toward a recipe's raw Charge (it is a harvest's crop: one Food's worth) */
  cropAs: 'food' as const,
  /** seconds to eat a meal (the Charge arrives over this time, like a snack) */
  eatSeconds: 4,
};

export const RECIPES: Record<MealId, RecipeDef> = {
  soup: { id: 'soup', name: 'Vegetable soup', icon: '🍲', crops: { potato: 2, radish: 1 }, pack: { food: 1 }, charge: 40, blurb: 'Potatoes and a radish, simmered slowly.' },
  salad: { id: 'salad', name: 'Tomato salad', icon: '🥗', crops: { tomato: 2, lettuce: 1 }, pack: {}, charge: 35, blurb: 'Sun-warm tomatoes on crisp lettuce.' },
  cornBake: { id: 'cornBake', name: 'Corn bake', icon: '🫓', crops: { sweetcorn: 2 }, pack: { food: 1 }, charge: 35, blurb: 'Sweetcorn baked golden in the oven.' },
  pie: { id: 'pie', name: 'Pumpkin pie', icon: '🥧', crops: { pumpkin: 1 }, pack: { fruit: 1, honey: 1 }, charge: 60, blurb: 'Pumpkin, fruit and a spoon of Honey, in pastry.' },
};
