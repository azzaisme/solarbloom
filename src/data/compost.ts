// E23.5.3 (#388): the compost bin and the Bio Digester. All data, no rules; starting values for tuning.
// The farm chain stops here: water → food → compost → fertiliser. Timers count in game days (data/farm).

/** The compost bin: biomass and food scraps in, compost out, and compost left in the bin matures to fertiliser. */
export const COMPOST = {
  /** units of biomass and food the bin holds waiting to rot down */
  feedCapacity: 30,
  /** units of feed one compost takes (food rots down richer: it counts as `foodWorth` units) */
  perCompost: 3,
  foodWorth: 1.5,
  /** game days to turn one batch of feed into one compost */
  compostDays: 0.25,
  /** game days compost left in the bin takes to mature into fertiliser */
  matureDays: 0.5,
  /** compost and fertiliser the bin holds before it simply waits for bloombot (nothing is lost) */
  outputCapacity: 10,
};

/**
 * The Bio Digester: biomass in, grid power out, day or night, while fed. An empty one just stops. It only burns
 * biomass while its grid wants power (something drawing, or a battery to fill), so a fed digester waits for you.
 * Sized against E23.3's numbers (data/power.ts on e23-power: a charger draws 6, a night is about 960 s of play).
 */
export const DIGESTER = {
  /** grid power while running (E23.3 watts) */
  output: 6,
  /** biomass the hopper holds */
  capacity: 40,
  /** biomass burned per game day of running (a night, about a third of a day, takes 4) */
  burnPerDay: 12,
};
