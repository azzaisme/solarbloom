// E19 (#245): the cozy city. Plot options and when they unlock. All data, no rules: cosmetic only, so nothing
// here may ever feed production, chains, milestones, pacing or the biodiversity score.

import type { AreaType } from './city';

/**
 * What unlocks an option (never bought): from the start, once the park reaches a look stage (1–4, see
 * ProgressionSystem.parkStage), once this many city areas are cleared, or (E19.2, for #288) a Lucky Cat
 * keepsake: a decoration that only a cat find unlocks.
 */
export type CozyUnlock = { start: true } | { parkStage: number } | { areas: number } | { keepsake: Keepsake };

/**
 * E19.2 × #288: the cat finds that unlock keepsake decorations. Only the first find exists so far; #288 adds the
 * first golden and rainbow cats and a find in each area type.
 */
export type Keepsake = 'firstFind' | 'finds5' | 'golden' | 'rainbow';
/** E20.5 (#288): what each keepsake waits for, for the tray and backpack. */
export const KEEPSAKE_HINTS: Record<Keepsake, string> = {
  firstFind: 'you find your first Lucky Cat',
  finds5: 'you have found five Lucky Cats',
  golden: 'you find a Golden Cat',
  rainbow: 'you find a Rainbow Cat',
};

export interface PlotOption {
  id: string;
  name: string;
  icon: string;
  /** one line for the picker */
  blurb: string;
  /** area types that offer it; undefined = every type (the shared set) */
  types?: AreaType[];
  /** E19 × bloombot (#235): flat options can be walked over, solid ones block like a machine */
  solid: boolean;
  /** offered only on a spot with water right beside it */
  nearWater?: boolean;
  unlock: CozyUnlock;
}

/** The shared set first, then the options particular to an area type. Order is the picker's order. */
export const PLOT_OPTIONS: PlotOption[] = [
  { id: 'garden', name: 'Kitchen garden', icon: '🥕', blurb: 'Raised beds of greens and marigolds.', solid: false, unlock: { start: true } },
  { id: 'orchard', name: 'Little orchard', icon: '🍎', blurb: 'Four fruit trees in a square.', solid: true, unlock: { start: true } },
  { id: 'cafe', name: 'Café terrace', icon: '☕', blurb: 'Tables, parasols and a planter of herbs.', solid: true, unlock: { parkStage: 3 } },
  { id: 'playground', name: 'Playground', icon: '🛝', blurb: 'A slide, a swing and a sandpit.', solid: true, unlock: { areas: 2 } },
  // Particular to an area type.
  { id: 'arbour', name: 'Rose arbour', icon: '🌹', blurb: 'An arch of climbing roses over a seat.', types: ['park'], solid: true, unlock: { parkStage: 2 } },
  { id: 'meadow', name: 'Wildflower meadow', icon: '🌼', blurb: 'Long grass and poppies, left to grow.', types: ['park', 'grove'], solid: false, unlock: { start: true } },
  { id: 'parklet', name: 'Parklet', icon: '🪴', blurb: 'A bench in a ring of planters, where a car once parked.', types: ['street', 'rooftops'], solid: true, unlock: { start: true } },
  { id: 'bikes', name: 'Bike stand', icon: '🚲', blurb: 'A rack of hoops and two bikes.', types: ['street'], solid: true, unlock: { areas: 4 } },
  { id: 'splash', name: 'Splash pool', icon: '💦', blurb: 'A shallow round pool with a spout.', types: ['plaza'], solid: false, unlock: { start: true } },
  { id: 'bandstand', name: 'Music corner', icon: '🎻', blurb: 'A small round stage with bunting.', types: ['plaza'], solid: true, unlock: { areas: 3 } },
  { id: 'mooring', name: 'Mooring', icon: '🛶', blurb: 'A plank deck with a little boat tied up.', types: ['canal'], solid: false, nearWater: true, unlock: { start: true } },
  { id: 'boathouse', name: 'Boat rack', icon: '🚣', blurb: 'Canoes stacked on a rack.', types: ['canal'], solid: true, unlock: { areas: 3 } },
  { id: 'stalls', name: 'Stall row', icon: '🧺', blurb: 'Two striped stalls of fruit and flowers.', types: ['market'], solid: true, unlock: { start: true } },
  { id: 'crates', name: 'Crate garden', icon: '📦', blurb: 'Old crates turned into planters.', types: ['market'], solid: false, unlock: { areas: 2 } },
  { id: 'reeds', name: 'Reed bed', icon: '🌾', blurb: 'Reeds and irises in shallow water.', types: ['reservoir'], solid: false, unlock: { start: true } },
  { id: 'dipping', name: 'Dipping pond', icon: '🐸', blurb: 'A small pond with a pier for looking in.', types: ['reservoir'], solid: false, unlock: { areas: 3 } },
  { id: 'picnic', name: 'Picnic glade', icon: '🧺', blurb: 'A blanket, a basket and two logs to sit on.', types: ['grove'], solid: false, unlock: { start: true } },
  { id: 'hut', name: 'Forest hut', icon: '🛖', blurb: 'A tiny hut of branches and moss.', types: ['grove'], solid: true, unlock: { areas: 4 } },
  { id: 'greenhouse', name: 'Glasshouse', icon: '🪟', blurb: 'A small glasshouse full of seedlings.', types: ['rooftops'], solid: true, unlock: { areas: 2 } },
];

export const PLOT_OPTION: Record<string, PlotOption> = Object.fromEntries(PLOT_OPTIONS.map((o) => [o.id, o]));

/** Options an area type offers (every unlock state), in picker order. */
export function plotOptionsFor(type: AreaType): PlotOption[] {
  return PLOT_OPTIONS.filter((o) => !o.types || o.types.includes(type));
}

export const PLOT_GEN = {
  /** every plot is this many tiles square */
  size: 2,
  /** plots per area: 2, plus one per this many chunks, up to `max` */
  chunksPerExtra: 3,
  min: 2,
  max: 4,
  /** placement attempts per area */
  tries: 64,
};

// ───────────── E19.2: decorations ─────────────

/**
 * E19.2.2 (#254): a decoration the player places by hand on one restored tile. It occupies the tile as a machine
 * does (#252); `solid` ones also block bloombot, flat ones can be walked over. Cosmetic only and never bought:
 * each unlocks once (milestones, or a Lucky Cat keepsake) and can then be placed as often as you like.
 */
export interface DecorOption {
  id: string;
  name: string;
  icon: string;
  /** one line for the tray and the backpack */
  blurb: string;
  solid: boolean;
  unlock: CozyUnlock;
}

/** Tray order. Art: rendering/DecorArt.ts (existing prop models where one fits, primitives otherwise). */
export const DECOR_OPTIONS: DecorOption[] = [
  { id: 'bench', name: 'Bench', icon: '🪑', blurb: 'A slatted park bench.', solid: true, unlock: { start: true } },
  { id: 'lantern', name: 'Lantern', icon: '🏮', blurb: 'A little lantern on the ground, lit at dusk.', solid: false, unlock: { start: true } },
  { id: 'pot', name: 'Flower pot', icon: '🪴', blurb: 'A terracotta pot of flowers.', solid: true, unlock: { start: true } },
  { id: 'flowerbed', name: 'Flower patch', icon: '🌷', blurb: 'A low ring of tulips. Walk right over it.', solid: false, unlock: { start: true } },
  { id: 'stones', name: 'Stepping stones', icon: '🪨', blurb: 'Three flat stones for a garden path.', solid: false, unlock: { parkStage: 1 } },
  { id: 'trough', name: 'Planter trough', icon: '🌿', blurb: 'A long stone trough of herbs.', solid: true, unlock: { parkStage: 1 } },
  { id: 'birdbath', name: 'Bird bath', icon: '🐦', blurb: 'A stone bowl of water on a pedestal.', solid: true, unlock: { parkStage: 2 } },
  { id: 'lamppost', name: 'Lamp post', icon: '💡', blurb: 'An old iron street lamp.', solid: true, unlock: { parkStage: 3 } },
  { id: 'bunting', name: 'Bunting pole', icon: '🎏', blurb: 'A pole with a bright banner.', solid: true, unlock: { areas: 1 } },
  { id: 'cratestack', name: 'Crate stack', icon: '📦', blurb: 'Two old crates, one on the other.', solid: true, unlock: { areas: 2 } },
  { id: 'barrel', name: 'Barrel planter', icon: '🛢️', blurb: 'A barrel cut down and filled with flowers.', solid: true, unlock: { areas: 2 } },
  { id: 'rug', name: 'Picnic rug', icon: '🧺', blurb: 'A checked rug and a basket.', solid: false, unlock: { areas: 3 } },
  { id: 'topiary', name: 'Topiary', icon: '🌳', blurb: 'A clipped round shrub in a square tub.', solid: true, unlock: { areas: 4 } },
  // Keepsakes (#288): only Lucky Cat finds unlock these.
  { id: 'catstatue', name: 'Lucky Cat statue', icon: '🐱', blurb: 'A keepsake from your first Lucky Cat.', solid: true, unlock: { keepsake: 'firstFind' } },
  { id: 'pawstones', name: 'Paw-print stones', icon: '🐾', blurb: 'Stepping stones in the shape of a paw. Walk right over them.', solid: false, unlock: { keepsake: 'finds5' } },
  { id: 'goldlantern', name: 'Golden lantern', icon: '🏮', blurb: 'A keepsake from a Golden Cat: it glows all night.', solid: false, unlock: { keepsake: 'golden' } },
  { id: 'rainbowbunting', name: 'Rainbow bunting', icon: '🌈', blurb: 'A keepsake from a Rainbow Cat: a pole of bright flags.', solid: true, unlock: { keepsake: 'rainbow' } },
];

export const DECOR_OPTION: Record<string, DecorOption> = Object.fromEntries(DECOR_OPTIONS.map((o) => [o.id, o]));

export const DECOR_GEN = {
  /** how far from bloombot (tiles, centre to centre) a build may be aimed: Satisfactory-style reach */
  reach: 3.6,
  /** most decorations a city can hold (keeps the save inside its limit, #3) */
  max: 4000,
};
