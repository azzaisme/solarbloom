// E21 (#312): materials, salvage yields, recipes and fountain tiers of the Old City. All data, no rules.
// The numbers are the epic's starting values (docs/E21_OLD_CITY.md §1–§5). Yields are tuned here; gates and
// recipes only change if the pacing bot (§19) fails.

import type { AbilityId, BuildableType, MaterialId } from '../core/types';

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
  /** E23.5.1: where it comes from, for items that never lie in piles (the backpack says this instead of regions) */
  from?: string;
}

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  scrap: { id: 'scrap', name: 'Scrap', icon: '🧱', models: ['rubble-pile', 'crate', 'stone-block'], home: ['park', 'backstreet', 'mastRow', 'oldMarket', 'saltwind', 'elderGrove', 'cistern', 'clockPlaza', 'terraces', 'glasshouse', 'observatory'], colour: '#9a8f84' },
  seeds: { id: 'seeds', name: 'Seeds', icon: '🌱', models: ['broken-pot', 'stump'], home: ['park', 'elderGrove'], colour: '#8fbf5a' },
  copper: { id: 'copper', name: 'Copper', icon: '🔧', models: ['salvage-copper'], home: ['mastRow'], colour: '#c87a4a' },
  timber: { id: 'timber', name: 'Timber', icon: '🛢️', models: ['salvage-driftwood'], home: ['saltwind'], colour: '#a8764a' },
  glass: { id: 'glass', name: 'Glass', icon: '🪟', models: ['salvage-glass'], home: ['oldMarket'], colour: '#8fd0d8' },
  clay: { id: 'clay', name: 'Clay', icon: '🏺', models: ['salvage-clay'], home: ['cistern'], colour: '#b97a5a' },
  gears: { id: 'gears', name: 'Gears', icon: '⚙️', models: ['salvage-gears'], home: ['clockPlaza'], colour: '#b8a26a' },
  sunstone: { id: 'sunstone', name: 'Sunstone', icon: '✨', models: ['salvage-sunstone'], home: ['terraces'], colour: '#f2c84a' },
  // E23.5.1: farm items (data/farm). Never lying in piles: gathered from restored ground, grown or composted.
  biomass: { id: 'biomass', name: 'Biomass', icon: '🌿', models: [], home: [], colour: '#94e46e', from: 'Gathered from restored ground' },
  food: { id: 'food', name: 'Food', icon: '🥕', models: [], home: [], colour: '#f0a04a', from: 'Grown in planters' },
  compost: { id: 'compost', name: 'Compost', icon: '🟫', models: [], home: [], colour: '#8a6a4a', from: 'Made in a compost bin' },
  fertiliser: { id: 'fertiliser', name: 'Fertiliser', icon: '🧪', models: [], home: [], colour: '#c9b06a', from: 'Compost left to mature in a compost bin' },
};

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];

/** A cost in materials. E23.5.1: biomass is a backpack item like any other, so a recipe's biomass is carried too. */
export type MaterialCost = Partial<Record<MaterialId, number>>;

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
  /** Reclaimer output, units a minute, and Mk 2 (blueprint) */
  reclaimerPerMinute: 6,
  reclaimerMk2PerMinute: 12,
  /** away: Reclaimers earn this share for at most this many hours */
  offlineShare: 0.5,
  offlineHours: 4,
  /** Elder Grove's reward: loose Seeds piles give this many times as much per take */
  seedsBonus: 2,
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

export interface Recipe {
  cost: MaterialCost;
  /** fountain tier that unlocks it */
  tier: number;
}

/** Old-city build recipes: fixed, no price growth. The Reclaimer and Storage Chest are old-city machines. */
export const RECIPES: Partial<Record<BuildableType | 'reclaimer' | 'chest', Recipe>> = {
  solar: { cost: { scrap: 10 }, tier: 1 },
  condenser: { cost: { scrap: 12, copper: 6 }, tier: 1 },
  chest: { cost: { timber: 8, scrap: 4 }, tier: 1 },
  pollinator: { cost: { seeds: 10, timber: 6, biomass: 20 }, tier: 2 },
  droneHub: { cost: { scrap: 20, copper: 15, glass: 10 }, tier: 2 },
  reclaimer: { cost: { scrap: 20, copper: 10, timber: 10 }, tier: 2 },
  reservoirGarden: { cost: { clay: 15, seeds: 10, biomass: 30 }, tier: 3 },
  motherTree: { cost: { seeds: 30, clay: 20, biomass: 100 }, tier: 3 },
  relay: { cost: { copper: 20, gears: 10, sunstone: 10 }, tier: 4 },
  cultivator: { cost: { scrap: 30, gears: 20, copper: 10 }, tier: 4 },
};

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
  { tier: 1, name: 'Water returns', needs: { parkTiles: 60 }, delivery: { scrap: 20, seeds: 6 }, ability: 'pry', gives: ['Pry', 'Build mode', 'Solar Panel', 'Water Condenser', 'Storage Chest', 'The house plot'], look: 'trickle' },
  { tier: 2, name: 'The pump turns', needs: { landmarks: 2 }, delivery: { copper: 30, timber: 30, glass: 20 }, ability: 'hover', gives: ['Hover', 'Pollinator Garden', 'Drone Hub', 'Reclaimer', 'Stacks of 60'], look: 'flowing' },
  { tier: 3, name: 'The garden climbs', needs: { landmarks: 4 }, delivery: { clay: 40, gears: 30, seeds: 40 }, ability: 'climb', gives: ['Climb', 'Reservoir Garden', 'Mother Tree', 'Stacks of 80'], look: 'lit' },
  { tier: 4, name: 'Light on the roofs', needs: { landmarks: 6 }, delivery: { sunstone: 40, copper: 60, gears: 40 }, ability: 'glide', gives: ['Glide', 'Bloom Relay', 'Cultivator', 'Stacks of 120'], look: 'lit' },
  { tier: 5, name: 'The Great Bloom', needs: { landmarks: 10 }, delivery: { sunstone: 80, glass: 80, seeds: 80 }, items: ['heartSeed', 'starLens'], gives: ['The Great Bloom'], look: 'bloom' },
];

export const ABILITIES: Record<AbilityId, { name: string; blurb: string }> = {
  pry: { name: 'Pry', blurb: 'Clears rubble barricades' },
  hover: { name: 'Hover', blurb: 'Crosses deep water' },
  climb: { name: 'Climb', blurb: 'Climbs ladders to the roofs' },
  glide: { name: 'Glide', blurb: 'Glides across gaps from roof edges' },
};

// ───────────── §10 workbench ─────────────

/** Workbench groups and the material each spends (level L costs 10 × L Scrap and 8 × L of it). */
export const WORKBENCH = {
  maxLevel: 3,
  scrapPerLevel: 10,
  materialPerLevel: 8,
  groups: { pulse: 'copper', machines: 'gears', drones: 'glass', storage: 'timber', networks: 'sunstone', fog: 'clay' } as Record<string, MaterialId>,
};

/** Lucky Cat rewards under old-city rules: units of the local material by variant. */
export const CAT_REWARD = { standard: 10, golden: 25, rainbow: 60 };

/** §3: Tally's trade once the Market Hall is awake. */
export const TRADE = { give: 3, get: 1 };
