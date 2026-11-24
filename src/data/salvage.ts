// E21 (#312): materials, salvage yields, recipes and fountain tiers of the Old City. All data, no rules.
// The numbers are the epic's starting values (docs/E21_OLD_CITY.md §1–§5). Yields are tuned here; gates and
// recipes only change if the pacing bot (§19) fails.

import type { AbilityId, ItemId, MaterialId } from '../core/types';
import { MACHINES } from './machines';
import { MAINLAND } from './mainland';

export interface MaterialDef {
  id: MaterialId;
  name: string;
  /** short icon for the HUD (text, not a key or button) */
  icon: string;
  /** the models its piles are drawn with (assets/raw/models/final), first is the usual one */
  models: string[];
  /** where it is found (region ids from data/oldcity; 'park' and 'backstreet' too) */
  home: string[];
  /** a tint for its fly-ups and panel row */
  colour: string;
  /** E23.8.3.2: found only on the mainland (and never traded for on the island) */
  mainlandOnly?: boolean;
  /** E23.5.1: where it comes from, for items that never lie in piles (the backpack says this instead of regions) */
  from?: string;
  /** E23.8.3.2: where it lies when that is not an Old City region, in world words ("Found in …", "Needs Steel — …") */
  place?: string;
}

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  scrap: { id: 'scrap', name: 'Scrap', icon: '🧱', models: ['rubble-pile', 'crate', 'stone-block'], home: ['park', 'backstreet', 'mastRow', 'oldMarket', 'saltwind', 'elderGrove', 'cistern', 'clockPlaza', 'terraces', 'glasshouse', 'observatory', 'spireHeights'], colour: '#9a8f84' },
  seeds: { id: 'seeds', name: 'Seeds', icon: '🌱', models: ['broken-pot', 'stump'], home: ['park', 'elderGrove', 'glasshouse'], colour: '#8fbf5a' },
  copper: { id: 'copper', name: 'Copper', icon: '🔧', models: ['salvage-copper'], home: ['mastRow', 'observatory'], colour: '#c87a4a' },
  timber: { id: 'timber', name: 'Timber', icon: '🛢️', models: ['salvage-driftwood'], home: ['saltwind'], colour: '#a8764a' },
  glass: { id: 'glass', name: 'Glass', icon: '🪟', models: ['salvage-glass'], home: ['oldMarket', 'glasshouse'], colour: '#8fd0d8' },
  clay: { id: 'clay', name: 'Clay', icon: '🏺', models: ['salvage-clay'], home: ['cistern', 'elderGrove'], colour: '#b97a5a' },
  gears: { id: 'gears', name: 'Gears', icon: '⚙️', models: ['salvage-gears'], home: ['clockPlaza', 'spireHeights'], colour: '#b8a26a' },
  sunstone: { id: 'sunstone', name: 'Sunstone', icon: '✨', models: ['salvage-sunstone'], home: ['terraces', 'observatory', 'saltwind'], colour: '#f2c84a' },
  // E23.8.3.2: steel, from the mainland's industrial ruins only
  steel: { id: 'steel', name: 'Steel', icon: '🔩', models: ['salvage-steel'], home: [], colour: '#8d9aa5', mainlandOnly: true, place: 'the industrial ruins past the causeway' },
  // E23.5.1: farm items (data/farm). Never lying in piles: gathered from restored ground, grown or composted.
  biomass: { id: 'biomass', name: 'Greens', icon: '🌿', models: [], home: [], colour: '#94e46e', from: 'Gathered from restored ground' },
  food: { id: 'food', name: 'Food', icon: '🥕', models: [], home: [], colour: '#f0a04a', from: 'Grown in planters' },
  compost: { id: 'compost', name: 'Compost', icon: '🟫', models: [], home: [], colour: '#8a6a4a', from: 'Made in a compost bin' },
  honey: { id: 'honey', name: 'Honey', icon: '🍯', models: [], home: [], colour: '#f2b632', from: 'From beehives settled near flowers' },
  fertiliser: { id: 'fertiliser', name: 'Fertiliser', icon: '🧪', models: [], home: [], colour: '#c9b06a', from: 'Compost left to mature in a compost bin' },
};

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];

/**
 * A cost in materials. E23.5.1: biomass is a backpack item like any other, so a recipe's biomass is carried too.
 * E23.6.1: components (data/crafting) can be part of one too.
 */
export type MaterialCost = Partial<Record<ItemId, number>>;

// ───────────── §1 backpack ─────────────

export const PACK = {
  /** stack limit per material, by fountain tier (index = tier; tiers 0 and 1 share 40) */
  stack: [40, 40, 60, 80, 120, 120],
  /** the Pack Frame blueprint adds this to every stack */
  packFrame: 40,
};

// ───────────── §2 storage ─────────────

export const STORE = {
  /** a recipe or delivery may take from the store within this many tiles of a way into it */
  reach: 12,
  /** at most this many Storage Chests */
  maxChests: 40,
};

// ───────────── §3 salvage ─────────────

export type PileSize = 'small' | 'medium' | 'large';

export const SALVAGE = {
  /** units in a pile of each size */
  units: { small: 6, medium: 12, large: 24 } as Record<PileSize, number>,
  /** units one salvage takes */
  perTake: 3,
  /** seconds Interact is held to salvage once */
  holdSeconds: 0.6,
  /** seconds Interact is held at a barricade to Pry it */
  pryHoldSeconds: 2,
  /** E23.7.4: game days of play for an emptied pile to fill again (one unit at a time); storms fill them at once */
  refillDays: 3,
  /** E23.7.4: how often (sim seconds) piles are checked for a returning unit */
  refillCheckSeconds: 5,
  /** E23.7.4: the Terraces' Salvage Lore blueprint: piles refill this many times as fast */
  loreRefill: 2,
  /** Elder Grove's reward: loose Seeds piles give this many times as much per take */
  seedsBonus: 2,
};

/**
 * E23.7.4: what an old save's Reclaimer is worth when it is taken down on load (its E21 recipe, refunded to the
 * store), and the blueprint that replaced Reclaimer Mk 2.
 */
export const LEGACY_RECLAIMER = {
  refund: { scrap: 20, copper: 10, timber: 10 } as Partial<Record<'scrap' | 'copper' | 'timber', number>>,
  blueprint: 'reclaimerMk2',
  becomes: 'salvageLore',
};

/**
 * §3 loose yield of each region's own material (the target the piles in data/oldcity add up to) and Scrap.
 * Piles come in sizes of 6, so 80 Scrap is laid as 78. The park holds 18 Seeds, not 12: in the Milestone A slice
 * Elder Grove is not laid out yet, and the Pylon's first request (8 Seeds) must be payable after tier 1 (6 Seeds).
 */
export const LOOSE_YIELD = {
  ring: { 1: 120, 2: 160, 3: 200 } as Record<number, number>,
  scrap: { park: 60, region: 80, backstreet: 20 },
  parkSeeds: 18,
};

// ───────────── §4 recipes ─────────────

// Old-city build recipes are on the crafting table (data/crafting MACHINE_RECIPES, E23.6.1): one way to build.

// ───────────── §5 fountain tiers ─────────────

export interface TierDef {
  tier: number;
  name: string;
  /** "also needs": park tiles restored, or landmarks awake */
  needs: { parkTiles?: number; landmarks?: number };
  delivery: MaterialCost;
  /** one-off items the delivery also needs (tier 5) */
  items?: string[];
  ability?: AbilityId;
  /** what it unlocks, for the delivery panel */
  gives: string[];
  /** the fountain's look after it */
  look: 'dry' | 'trickle' | 'flowing' | 'lit' | 'bloom';
}

export const TIERS: TierDef[] = [
  { tier: 1, name: 'Water returns', needs: { parkTiles: 60 }, delivery: { scrap: 20, seeds: 6 }, ability: 'pry', gives: ['Pry', 'Building machines', 'Water Condenser', 'The house plot'], look: 'trickle' },
  { tier: 2, name: 'The pump turns', needs: { landmarks: 2 }, delivery: { copper: 30, timber: 30, glass: 20 }, ability: 'hover', gives: ['Hover', 'Pollinator Garden', 'Drone Hub', 'Carry 60 of each thing'], look: 'flowing' },
  { tier: 3, name: 'The garden climbs', needs: { landmarks: 4 }, delivery: { clay: 40, gears: 30, seeds: 40 }, ability: 'climb', gives: ['Climb', 'Reservoir Garden', 'Mother Tree', 'Carry 80 of each thing'], look: 'lit' },
  { tier: 4, name: 'Light on the roofs', needs: { landmarks: 6 }, delivery: { sunstone: 40, copper: 60, gears: 40 }, ability: 'glide', gives: ['Glide', 'Cultivator', 'Carry 120 of each thing'], look: 'lit' },
  { tier: 5, name: 'The Great Bloom', needs: { landmarks: 10 }, delivery: { sunstone: 80, glass: 80, seeds: 80 }, items: ['heartSeed', 'starLens'], gives: ['The Great Bloom', 'Big Battery'], look: 'bloom' },
];

export const ABILITIES: Record<AbilityId, { name: string; blurb: string }> = {
  pry: { name: 'Pry', blurb: 'Pries rubble out of the way' },
  hover: { name: 'Hover', blurb: 'Crosses deep water' },
  climb: { name: 'Climb', blurb: 'Climbs ladders to the roofs' },
  glide: { name: 'Glide', blurb: 'Glides across gaps from the edge of a roof' },
};

// ───────────── §10 workbench ─────────────

/** Workbench groups and the material each spends (level L costs 10 × L Scrap and 8 × L of it). */
export const WORKBENCH = {
  maxLevel: 3,
  scrapPerLevel: 10,
  materialPerLevel: 8,
  groups: { pulse: 'copper', machines: 'gears', drones: 'glass', storage: 'timber', networks: 'sunstone', fog: 'clay' } as Record<string, MaterialId>,
};

/** Lucky Cat rewards: units of the local material by variant. */
export const CAT_REWARD = { standard: 10, golden: 25, rainbow: 60 };

/**
 * #610: a fountain step's toast, in sentences rather than a list of names: what's new to build, and how much the
 * backpack holds. (The move it teaches has its own toast, #620's "Bloombot can hover over deep water now".)
 */
export function fountainStepNews(t: TierDef): string {
  const gives = tierGives(t);
  const built = gives.filter((g) => Object.values(MACHINES).some((m) => m.name === g));
  const stack = gives.map((g) => /^Carry (\d+) of each thing$/.exec(g)?.[1]).find(Boolean);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  const out = t.ability ? [] : ['The whole city is in flower.'];
  if (built.length) out.push(`New to build: ${list(built)}.`);
  if (stack) out.push(`Your backpack holds ${stack} of each thing.`);
  return out.join(' ');
}

/** §3: Tally's trade once the Market Hall is awake. */
export const TRADE = { give: 3, get: 1 };

/**
 * Island release: what a fountain tier brings, as the player reads it. A mainland-only machine (the Grid Battery)
 * is left out until the mainland opens (data/mainland `MAINLAND.open`).
 */
export function tierGives(t: TierDef): string[] {
  if (MAINLAND.open) return t.gives;
  return t.gives.filter((g) => !Object.values(MACHINES).some((m) => m.mainlandOnly && m.name === g));
}

/** Island release: the materials the player sees (backpack, trade): the mainland's own (Steel) only once the mainland is open. */
export const visibleMaterials = (): MaterialId[] => MATERIAL_IDS.filter((m) => MAINLAND.open || !MATERIALS[m].mainlandOnly);
