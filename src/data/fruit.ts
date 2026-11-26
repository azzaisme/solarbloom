// #785: the fruit a fruit tree bears, by where it grows. Each kind is its own backpack item: eaten for Charge (a
// sweet snack between Food and Honey), composted like Food, loved as a gift by the Keeper of the region it grows in.
// All data, no rules; starting values for tuning.

/** The kinds of fruit, each a backpack item. */
export const FRUIT_IDS = ['apple', 'pear', 'peach', 'lemon'] as const;
export type FruitId = (typeof FRUIT_IDS)[number];

export const isFruit = (m: string): m is FruitId => (FRUIT_IDS as readonly string[]).includes(m);

export interface FruitDef {
  id: FruitId;
  /** the item's name (one), and several, for words like "Pick the ripe apples" */
  name: string;
  plural: string;
  icon: string;
  /** its Charge, as a share of the way from Food's to Honey's (0 Food … 1 Honey), so it stays between them */
  sweet: number;
  /** where it grows: the areas (park and regions) whose fruit trees bear it; anywhere else bears the default */
  areas: string[];
  /** the shape of one fruit: width and height as a share of a round one's (a pear is tall, a lemon long) */
  shape: [number, number];
  /** a few words for the item in the backpack */
  blurb: string;
}

export const FRUITS: Record<FruitId, FruitDef> = {
  apple: {
    id: 'apple', name: 'Apple', plural: 'apples', icon: '🍎', sweet: 0.35, areas: ['park', 'elderGrove', 'mastRow', 'clockPlaza'], shape: [1, 0.92],
    blurb: 'Crisp and red, from fruit trees in the park and the old woods. A sweet snack: more Charge than Food.',
  },
  pear: {
    id: 'pear', name: 'Pear', plural: 'pears', icon: '🍐', sweet: 0.45, areas: ['oldMarket', 'cistern', 'spireHeights'], shape: [0.86, 1.22],
    blurb: 'Soft and golden, from fruit trees round the market and the old streets. A sweet snack: more Charge than Food.',
  },
  peach: {
    id: 'peach', name: 'Peach', plural: 'peaches', icon: '🍑', sweet: 0.6, areas: ['terraces', 'observatory'], shape: [1.04, 1],
    blurb: 'Warm and juicy, from fruit trees on the sunny terraces. A sweet snack: nearly as much Charge as Honey.',
  },
  lemon: {
    id: 'lemon', name: 'Lemon', plural: 'lemons', icon: '🍋', sweet: 0.3, areas: ['saltwind', 'glasshouse'], shape: [0.84, 1.18],
    blurb: 'Bright and sharp, from fruit trees by the sea and under glass. A sweet snack: more Charge than Food.',
  },
};

/** What a fruit tree bears where no kind is named for its area (the mainland, rooftops). */
export const DEFAULT_FRUIT: FruitId = 'apple';

/** The fruit a tree growing in this area bears. */
export function fruitOfArea(area: string | undefined): FruitId {
  return FRUIT_IDS.find((f) => area !== undefined && FRUITS[f].areas.includes(area)) ?? DEFAULT_FRUIT;
}
