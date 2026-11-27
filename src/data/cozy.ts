import { LIGHTS } from './lights';
// E19 (#245): the cozy city. Plot options and when they unlock. All data, no rules: cosmetic only, so nothing
// here may ever feed production, chains, milestones, pacing or the biodiversity score. The one exception is E27.2's
// PLOT_WORK (end of file): Bloombot gathering from or pruning a plant plot, on the existing clipping economy.

import type { AreaType } from './city';

/**
 * What unlocks an option (never bought): from the start, once the park reaches a look stage (1–4, see
 * ProgressionSystem.parkStage), once this many city areas are cleared, or (E23.12.2, #529) a Lucky Cat find: a
 * cat-only decoration, one given per cat until bloombot has them all.
 */
export type CozyUnlock =
  | { start: true }
  | { parkStage: number }
  | { areas: number }
  /** E23.12.2 (#529): a cat-only decoration, given by a Lucky Cat find (data/crafting `{ cat }` recipes) */
  | { cat: true }
  /** E23.3.5: a cache opened (data/oldcity caches) */
  | { find: string }
  /** E23.3.5: a research project finished (E23.6.2, `sim.research.done`) */
  | { research: string };

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
  { id: 'parklet', name: 'Parklet', icon: '🪴', blurb: 'A bench in a ring of planters, where a car once parked.', types: ['street', 'rooftops', 'downtown'], solid: true, unlock: { start: true } },
  { id: 'bikes', name: 'Bike stand', icon: '🚲', blurb: 'A rack of hoops and two bikes.', types: ['street'], solid: true, unlock: { areas: 4 } },
  { id: 'splash', name: 'Splash pool', icon: '💦', blurb: 'A shallow round pool with a spout.', types: ['plaza'], solid: false, unlock: { start: true } },
  { id: 'bandstand', name: 'Music corner', icon: '🎻', blurb: 'A small round stage with bunting.', types: ['plaza'], solid: true, unlock: { areas: 3 } },
  { id: 'mooring', name: 'Mooring', icon: '🛶', blurb: 'A plank deck with a little boat tied up.', types: ['beach'], solid: false, nearWater: true, unlock: { start: true } },
  { id: 'stalls', name: 'Stall row', icon: '🧺', blurb: 'Two striped stalls of fruit and flowers.', types: ['market'], solid: true, unlock: { start: true } },
  { id: 'crates', name: 'Crate garden', icon: '📦', blurb: 'Old crates turned into planters.', types: ['market'], solid: false, unlock: { areas: 2 } },
  { id: 'reeds', name: 'Reed bed', icon: '🌾', blurb: 'Reeds and irises in shallow water.', types: ['reservoir'], solid: false, unlock: { start: true } },
  { id: 'dipping', name: 'Dipping pond', icon: '🐸', blurb: 'A small pond with a pier for looking in.', types: ['reservoir'], solid: false, unlock: { areas: 3 } },
  { id: 'picnic', name: 'Picnic glade', icon: '🧺', blurb: 'A blanket, a basket and two logs to sit on.', types: ['grove', 'beach'], solid: false, unlock: { start: true } },
  { id: 'hut', name: 'Forest hut', icon: '🛖', blurb: 'A tiny hut of branches and moss.', types: ['grove'], solid: true, unlock: { areas: 4 } },
  { id: 'greenhouse', name: 'Glasshouse', icon: '🪟', blurb: 'A small glasshouse full of seedlings.', types: ['rooftops', 'downtown'], solid: true, unlock: { areas: 2 } },
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
 * each unlocks once (milestones, a recipe made at the table, or a Lucky Cat find) and can then be placed as often as you like.
 */
export interface DecorOption {
  id: string;
  name: string;
  icon: string;
  /** one line for the tray and the backpack */
  blurb: string;
  solid: boolean;
  unlock: CozyUnlock;
  /**
   * #847: made for a room. Inside the house the tray leads with these, outside with the rest (garden pieces). It only
   * changes the tray's order: anything can go anywhere.
   */
  indoor?: boolean;
  /**
   * #849: the squares it covers, [across, deep], seen facing its front (rot 0). It turns with the piece, so a quarter
   * turn swaps the two. One square when unset.
   */
  size?: [number, number];
}

/** Tray order. Art: rendering/DecorArt.ts (existing prop models where one fits, primitives otherwise). */
export const DECOR_OPTIONS: DecorOption[] = [
  { id: 'bench', name: 'Bench', icon: '🪑', blurb: 'A slatted park bench.', solid: true, unlock: { start: true } },
  { id: 'pot', name: 'Flower pot', icon: '🪴', blurb: 'A terracotta pot of flowers.', solid: true, unlock: { start: true } },
  { id: 'flowerbed', name: 'Flower patch', icon: '🌷', blurb: 'A low ring of tulips. Walk right over it.', solid: false, unlock: { start: true } },
  { id: 'stones', name: 'Stepping stones', icon: '🪨', blurb: 'Three flat stones for a garden path.', solid: false, unlock: { parkStage: 1 } },
  { id: 'trough', name: 'Planter trough', icon: '🌿', blurb: 'A long stone trough of herbs.', solid: true, unlock: { parkStage: 1 } },
  { id: 'birdbath', name: 'Bird bath', icon: '🐦', blurb: 'A stone bowl of water on a pedestal.', solid: true, unlock: { parkStage: 2 } },
  { id: 'bunting', name: 'Bunting pole', icon: '🎏', blurb: 'A pole with a bright banner.', solid: true, unlock: { areas: 1 } },
  { id: 'cratestack', name: 'Stacked crates', icon: '📦', blurb: 'Two old crates, one on the other.', solid: true, unlock: { areas: 2 } },
  { id: 'barrel', name: 'Barrel planter', icon: '🛢️', blurb: 'A barrel cut down and filled with flowers.', solid: true, unlock: { areas: 2 } },
  { id: 'rug', name: 'Picnic rug', icon: '🧺', blurb: 'A checked rug and a basket.', solid: false, unlock: { areas: 3 } },
  { id: 'topiary', name: 'Topiary', icon: '🌳', blurb: 'A clipped round shrub in a square tub.', solid: true, unlock: { areas: 4 } },
  // E23.3.5: night lights (data/lights.ts), each a decoration that comes on at dusk
  ...LIGHTS.map((l) => ({ id: l.id, name: l.name, icon: l.icon, blurb: l.blurb, solid: l.solid, unlock: l.unlock })),
  // E23.12.2 (#529): cat-only decorations. Each Lucky Cat leaves the next one bloombot doesn't have (a Golden Cat its
  // lantern, a Rainbow Cat its bunting, when still missing), until all are found; then the table makes them too.
  { id: 'catstatue', name: 'Lucky Cat statue', icon: '🐱', blurb: 'A little stone cat with one paw raised.', solid: true, unlock: { cat: true } },
  { id: 'catbench', name: 'Cat bench', icon: '🪑', blurb: 'A bench with cat ears on its back, for two.', solid: true, unlock: { cat: true } },
  { id: 'pawstones', name: 'Paw-print stones', icon: '🐾', blurb: 'Stepping stones in the shape of a paw. Walk right over them.', solid: false, unlock: { cat: true } },
  { id: 'catfountain', name: 'Cat fountain', icon: '⛲', blurb: 'A stone bowl with a cat on top, spouting water.', solid: true, unlock: { cat: true } },
  { id: 'goldlantern', name: 'Golden lantern', icon: '🏮', blurb: 'A cat-eared lantern that glows gold all night.', solid: false, unlock: { cat: true } },
  { id: 'rainbowbunting', name: 'Rainbow bunting', icon: '🌈', blurb: 'A pole of bright flags, every colour of a Rainbow Cat.', solid: true, unlock: { cat: true } },
  // #850: furniture made for a room (#847: the tray leads with these inside the house). How each is earned: #852.
  { id: 'armchair', name: 'Armchair', icon: '🛋️', blurb: 'A deep, soft chair to sink into.', solid: true, unlock: { start: true }, indoor: true },
  { id: 'stool', name: 'Stool', icon: '🥁', blurb: 'A little round stool on three legs.', solid: true, unlock: { start: true }, indoor: true },
  { id: 'diningtable', name: 'Dining table', icon: '🍽️', blurb: 'A long table with room for friends. It takes two squares.', solid: true, unlock: { start: true }, indoor: true, size: [2, 1] },
  { id: 'sidetable', name: 'Side table', icon: '🫖', blurb: 'A small round table for a teapot or a book.', solid: true, unlock: { start: true }, indoor: true },
  { id: 'bookshelf', name: 'Bookshelf', icon: '📚', blurb: 'A tall shelf of well-read books.', solid: true, unlock: { start: true }, indoor: true },
  { id: 'coatstand', name: 'Coat stand', icon: '🧥', blurb: 'Somewhere by the door for a coat and a hat.', solid: true, unlock: { start: true }, indoor: true },
];

export const DECOR_OPTION: Record<string, DecorOption> = Object.fromEntries(DECOR_OPTIONS.map((o) => [o.id, o]));

/** #847: the two sets the tray shows, made for a room or for the garden (every piece without `indoor`). */
export type DecorSet = 'indoor' | 'garden';
export const decorSet = (o: DecorOption): DecorSet => (o.indoor ? 'indoor' : 'garden');

/** #849: the squares a decoration covers when turned `rot` quarter turns, [along x, along z]. */
export function decorSize(kind: string, rot: number): [number, number] {
  const s = DECOR_OPTION[kind]?.size;
  if (!s) return [1, 1];
  return rot & 1 ? [s[1], s[0]] : [s[0], s[1]];
}

/**
 * #849: the north-west square (the one its save key names) of a decoration aimed at square (x, z): the aimed square
 * is its middle one. On an even side there are two middles: the piece runs on away from `from` (where Bloombot
 * stands), so a long table aimed at the square in front is laid out ahead, not over Bloombot; without `from`, the
 * aimed square is the one just north-west of the middle.
 */
export function decorAnchor(kind: string, rot: number, x: number, z: number, from?: { x: number; z: number }): [number, number] {
  const [w, d] = decorSize(kind, rot);
  const side = (n: number, at: number, f: number | undefined) => {
    const back = Math.floor((n - 1) / 2);
    // even: the extra square goes on the far side from Bloombot (towards -x / -z when it stands beyond the square)
    return n % 2 === 0 && f !== undefined && f > at + 1 ? at - back - 1 : at - back;
  };
  return [side(w, x, from?.x), side(d, z, from?.z)];
}

/** #849: every square a decoration with its north-west square at (x, z) covers. */
export function decorCells(kind: string, rot: number, x: number, z: number): { x: number; z: number }[] {
  const [w, d] = decorSize(kind, rot);
  const out: { x: number; z: number }[] = [];
  for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) out.push({ x: x + i, z: z + j });
  return out;
}

/** E23.12.2 (#529): the cat-only decorations, in the order Lucky Cats leave them. */
export const CAT_DECOR: readonly string[] = DECOR_OPTIONS.filter((o) => 'cat' in o.unlock).map((o) => o.id);
/** A rarer cat leaves its own piece first, while bloombot doesn't have it (an ordinary cat leaves it last). */
export const CAT_DECOR_OF_VARIANT: Readonly<Record<string, string>> = { golden: 'goldlantern', rainbow: 'rainbowbunting' };

/**
 * #782: the first decoration, a gift the moment the fountain reaches its first step (and, once, for a save already
 * past it), so decorating round the house starts in the first session. It comes made: free to place, as often as
 * you like. The first one here bloombot hasn't made yet is the gift; the rest are only there for a save that made
 * the first already.
 */
export const FIRST_DECOR = {
  /** the fountain step that gives it */
  step: 1,
  gifts: ['pot', 'flowerbed', 'bench', 'stones', 'trough', 'bunting', 'barrel', 'cratestack', 'rug', 'birdbath', 'topiary'] as readonly string[],
};

export const DECOR_GEN = {
  /** how far from bloombot (tiles, centre to centre) a build may be aimed: Satisfactory-style reach */
  reach: 3.6,
  /** most decorations a city can hold (keeps the save inside its limit, #3) */
  max: 4000,
};

// ───────────── E27.2 (#680): plots Bloombot works on ─────────────

/**
 * What Bloombot does at a chosen plot with Interact: gather from what grows there, or prune what's overgrown. The
 * other options (the café, the playground, the pools…) are places, not plants, and have no work.
 *
 * This is the one way a plot reaches the economy, and it adds next to nothing: a plot gives what its own tiles would
 * give if they were clipped one by one (GatherSystem, E23.5.1), each tile counting as flowered ground at least, and it
 * regrows on the same clock. See PlotWork.
 */
export interface PlotWork {
  verb: 'gather' | 'prune';
  /** what is gathered or pruned, as the prompt says it ("Gather the greens") */
  what: string;
}

export const PLOT_WORK: Readonly<Record<string, PlotWork>> = {
  garden: { verb: 'gather', what: 'the greens' },
  meadow: { verb: 'gather', what: 'the long grass' },
  crates: { verb: 'gather', what: 'the herbs' },
  reeds: { verb: 'gather', what: 'the reeds' },
  greenhouse: { verb: 'gather', what: 'the seedlings' },
  orchard: { verb: 'prune', what: 'the fruit trees' },
  arbour: { verb: 'prune', what: 'the roses' },
  parklet: { verb: 'prune', what: 'the planters' },
};

export const PLOT_WORK_TUNING = {
  /** seconds Interact is held: gathering an armful, then a few snips round a plant */
  holdSeconds: { gather: 0.9, prune: 1.2 },
};
