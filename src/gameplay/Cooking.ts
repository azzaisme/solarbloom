import { COOKING, MEAL_IDS, RECIPES, type MealId, type PackNeed } from '../data/cooking';
import { CROPS, type CropId } from '../data/crops';
import { FARM_USES } from '../data/farm';
import { FRUIT_IDS, FRUITS, type FruitId } from '../data/fruit';
import { MATERIALS } from '../data/salvage';
import type { Sim } from './Sim';

/** One thing a recipe takes, and how many Bloombot has of it. */
export interface CookNeed {
  /** a basket crop, or a backpack item (for `fruit`, the kind it would use) */
  from: 'basket' | 'pack';
  id: string;
  name: string;
  icon: string;
  need: number;
  have: number;
}

/** Why a meal can't be cooked now (undefined: it can). */
export type CookProblem = { kind: 'noStove' } | { kind: 'short'; need: CookNeed } | { kind: 'full' };

/**
 * The Charge of what goes into a recipe: each basket crop as one Food (COOKING.cropAs), each backpack item its own
 * Charge, `fruit` as the least sweet fruit (the smallest it could be). The cap a meal is held to (data/cooking).
 */
export function rawCharge(id: MealId): number {
  const r = RECIPES[id];
  const per = (k: PackNeed) => (k === 'fruit' ? Math.min(...FRUIT_IDS.map((f) => FARM_USES[f].charge)) : FARM_USES[k].charge) * 100;
  let sum = 0;
  for (const n of Object.values(r.crops)) sum += (n ?? 0) * FARM_USES[COOKING.cropAs].charge * 100;
  for (const [k, n] of Object.entries(r.pack) as [PackNeed, number][]) sum += n * per(k);
  return sum;
}

/**
 * #874 (epic #845): cooking at the kitchen's stove. A recipe takes crops kept in the basket and Food, fruit or Honey
 * from the backpack, and puts one meal in the backpack. The stove's prompt opens it (OldCity's cooking panel).
 */
export class Cooking {
  constructor(private sim: Sim) {}

  /** Is there a stove in the house (the House level on)? */
  hasStove(): boolean {
    return this.sim.house.furniture().some((f) => f.id === 'stove');
  }

  private basket(crop: string): number {
    return this.sim.state.salvage?.basket?.[crop] ?? 0;
  }

  /** The fruit a recipe's `fruit` would use: the least sweet kind carried (the sweet ones are kept for snacks). */
  fruitToUse(): FruitId | undefined {
    return [...FRUIT_IDS].filter((f) => this.sim.inventory.count(f) > 0).sort((a, b) => FRUITS[a].sweet - FRUITS[b].sweet)[0];
  }

  /** What a recipe takes, each with how many Bloombot has. */
  needs(id: MealId): CookNeed[] {
    const r = RECIPES[id];
    const inv = this.sim.inventory;
    const out: CookNeed[] = [];
    for (const [crop, n] of Object.entries(r.crops) as [CropId, number][]) out.push({ from: 'basket', id: crop, name: CROPS[crop].name, icon: CROPS[crop].icon, need: n, have: this.basket(crop) });
    for (const [k, n] of Object.entries(r.pack) as [PackNeed, number][]) {
      if (k === 'fruit') {
        const f = this.fruitToUse();
        out.push({ from: 'pack', id: f ?? 'fruit', name: 'Any fruit', icon: f ? FRUITS[f].icon : '🍎', need: n, have: FRUIT_IDS.reduce((s, x) => s + inv.count(x), 0) });
      } else out.push({ from: 'pack', id: k, name: MATERIALS[k].name, icon: MATERIALS[k].icon, need: n, have: inv.count(k) });
    }
    return out;
  }

  /** Why a meal can't be cooked now, or undefined when it can. */
  problem(id: MealId): CookProblem | undefined {
    if (!this.hasStove()) return { kind: 'noStove' };
    const short = this.needs(id).find((n) => n.have < n.need);
    if (short) return { kind: 'short', need: short };
    if (this.sim.inventory.room(id) < 1) return { kind: 'full' };
    return undefined;
  }

  /** The recipes, in the stove's order. */
  recipes(): MealId[] {
    return [...MEAL_IDS];
  }

  /** Cooks one meal: takes what it needs and puts the meal in the backpack. True when it did. */
  cook(id: MealId): boolean {
    if (this.problem(id)) return false;
    const r = RECIPES[id];
    const inv = this.sim.inventory;
    const b = this.sim.state.salvage!.basket!;
    for (const [crop, n] of Object.entries(r.crops) as [CropId, number][]) {
      b[crop] -= n;
      if (b[crop] <= 0) delete b[crop];
    }
    for (const [k, n] of Object.entries(r.pack) as [PackNeed, number][]) {
      if (k === 'fruit') for (let i = 0; i < n; i++) inv.take(this.fruitToUse()!, 1);
      else inv.take(k, n);
    }
    inv.add(id, 1);
    this.sim.bus.emit('meal.cooked', { meal: id });
    return true;
  }
}
