// E23.5.4 (#389, #429–#434): beyond planters. Each thing to tend plugs into a system that already exists, and every
// creature is wild and attracted, never kept. All data, no rules; starting values for tuning.

import type { CropId } from './crops';

/** E23.5.4.1 (#429): beehives. */
export const BEEHIVE = {
  /** flowers and herbs counted within this many tiles (flowering restored ground, flower and herb planters) */
  reach: 3,
  /** a hive needs at least this many flowering things in reach before the bees settle */
  minFlowers: 3,
  /** game days to fill a comb, and combs a hive holds (honey waits in the hive, never lost) */
  honeyDays: 1,
  honeyCapacity: 4,
  /** crops in planters within `reach` grow this much faster while the hive is settled */
  cropBoost: 1.25,
};

/** E23.5.4.2 (#430): fish ponds. */
export const FISH_POND = {
  /** a pond needs water from the network within this many tiles to stay filled (E23.4) */
  waterReach: 3,
  /** water a filled pond draws a game day (E23.4 units; a water tile holds 20) */
  waterPerDay: 6,
  /** planters this pond's water reaches (by E23.4 pipe, or within this many tiles until pipes land) count as fertilised */
  feedReach: 2,
};

/** E23.5.4.3 (#431): orchards. Fruit trees planted once. */
export const ORCHARD = {
  /** game days from planting to the first fruit, then between crops */
  firstFruitDays: 3,
  fruitDays: 2,
  /** food one picking gives */
  fruit: 4,
  /** game days until a tree wants pruning again; pruning gives timber, and an unpruned tree just fruits a little less */
  pruneDays: 4,
  timber: 3,
  /** an overgrown tree's crop, times this (never zero) */
  overgrownFruit: 0.5,
};

/** E23.5.4.4 (#432): mushroom logs and worm bins. */
export const MUSHROOM_LOG = {
  /** compost one inoculation takes; a log fruits until it has given `flushes` crops, then wants compost again */
  compost: 1,
  flushes: 3,
  /** game days of growth per flush; it grows only at night or in fog, and only when shaded */
  flushDays: 0.5,
  /** food one flush gives */
  food: 2,
};

export const WORM_BIN = {
  /** compost bins within this many tiles of a fed worm bin work this much faster */
  reach: 1,
  speed: 2,
  /** food scraps or biomass one feeding takes; a feeding keeps the worms busy this many game days */
  feedCost: 2,
  feedDays: 1,
  /** most game days of feeding the bin can hold */
  maxDays: 4,
};

/** E23.5.4.5 (#433): wildlife homes. Each wants its own habitat and brings its own creature. */
export type HomeKind = 'birdBox' | 'batBox' | 'hedgehogHouse' | 'butterflyGarden';
export type Habitat = 'trees' | 'water' | 'night' | 'shrubs' | 'flowers' | 'quiet';

export interface HomeDef {
  kind: HomeKind;
  name: string;
  creature: string;
  /** what the home needs around it (within `reach` tiles), every one */
  needs: Habitat[];
  /** a short line for its panel: what it wants, in words */
  wants: string;
}

export const HOMES: Record<HomeKind, HomeDef> = {
  birdBox: { kind: 'birdBox', name: 'Bird Box', creature: 'Songbirds', needs: ['trees'], wants: 'trees or tall shrubs nearby' },
  batBox: { kind: 'batBox', name: 'Bat Box', creature: 'Bats', needs: ['night', 'water'], wants: 'water nearby, and the night to fly in' },
  hedgehogHouse: { kind: 'hedgehogHouse', name: 'Hedgehog House', creature: 'Hedgehogs', needs: ['shrubs', 'quiet'], wants: 'shrubs nearby and no machines right beside it' },
  butterflyGarden: { kind: 'butterflyGarden', name: 'Butterfly Garden', creature: 'Butterflies', needs: ['flowers'], wants: 'flowers or herbs nearby' },
};

export const HOME = {
  /** habitat is looked for within this many tiles */
  reach: 3,
  /** this many flowering or shrubby tiles count as "flowers" / "shrubs" */
  plants: 3,
  /** a creature moves in this many game days after its habitat is right (it moves out gently if it goes wrong) */
  settleDays: 0.25,
};

/** E23.5.4: what each settled thing adds to its area's diversity (E23.2.4 reads `sim.farmExtras.diversityIn`). */
export const DIVERSITY = {
  /** each kind of tended thing in an area counts once */
  perKind: 1,
  /** each kind of creature living in an area's homes counts this much */
  perCreature: 2,
};

/** E23.5.4.6 (#434): Keeper gardens. A planter within `reach` of a woken Keeper is that Keeper's garden. */
export const KEEPER_GARDEN = { reach: 4 };

export type GardenReward = { kind: 'decor'; id: string; name: string } | { kind: 'seeds'; crop: CropId } | { kind: 'recipe'; machine: string; name: string };

export interface GardenRequest {
  /** the crop the Keeper asks you to grow in its garden */
  crop: CropId;
  /** what the Keeper says when asking (one short line) */
  ask: string;
  reward: GardenReward;
}

/** At least one garden request per Keeper, asked in order (the next once the last is grown). */
export const GARDEN_REQUESTS: Record<string, GardenRequest[]> = {
  pylon: [{ crop: 'radish', ask: 'Grow me a radish? I like how fast they come up.', reward: { kind: 'decor', id: 'birdbath', name: 'Bird bath' } }],
  tally: [
    { crop: 'tomato', ask: 'A tomato, please. Everyone wants tomatoes.', reward: { kind: 'seeds', crop: 'sunflower' } },
    { crop: 'potato', ask: 'Potatoes keep. Grow some in my bed?', reward: { kind: 'decor', id: 'cratestack', name: 'Crate stack' } },
  ],
  tide: [{ crop: 'seaKale', ask: 'Sea kale, from the beach. It reminds me of the old harbour.', reward: { kind: 'seeds', crop: 'watercress' } }],
  moss: [
    { crop: 'beans', ask: 'Beans, climbing up a trellis. They feed the soil.', reward: { kind: 'recipe', machine: 'wormBin', name: 'Worm Bin' } },
    { crop: 'herbs', ask: 'Lavender and mint for the bees.', reward: { kind: 'seeds', crop: 'pumpkin' } },
  ],
  sluice: [{ crop: 'watercress', ask: 'Watercress needs running water. Will you?', reward: { kind: 'recipe', machine: 'fishPond', name: 'Fish Pond' } }],
  tock: [{ crop: 'pumpkin', ask: 'A pumpkin, a big one. They take their time, like clocks.', reward: { kind: 'decor', id: 'topiary', name: 'Topiary' } }],
  gable: [{ crop: 'rice', ask: 'Rice, in a flooded bed. The terraces were made for it.', reward: { kind: 'seeds', crop: 'moonflower' } }],
  fern: [{ crop: 'flowers', ask: 'Flowers. Just flowers. For looking at.', reward: { kind: 'recipe', machine: 'butterflyGarden', name: 'Butterfly Garden' } }],
  vega: [{ crop: 'moonflower', ask: 'A moonflower. I watch them open at night.', reward: { kind: 'recipe', machine: 'batBox', name: 'Bat Box' } }],
  atlas: [{ crop: 'sunflower', ask: 'Sunflowers, facing the sun like I do.', reward: { kind: 'seeds', crop: 'rice' } }],
};
