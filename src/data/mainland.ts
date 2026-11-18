// E23.8.3 (#401): the endless mainland, past the Long Causeway. Opened by the Great Bloom; built big after it.
// All numbers here are starting values for tuning. The mainland replaces E21.17's idle Outskirts: it runs on the same
// rules as the island (restore, gather, build), with no idle mechanics.

import type { MaterialId } from '../core/types';
import type { AreaType } from './city';
import type { PileSize } from './salvage';

export const MAINLAND = {
  /** every chunk with x ≥ this is mainland (the chunks between it and the island are sea), for ever east, north and south */
  minChunkX: 9,
  /** a mainland district (one area: one fog, one restoration) is this many chunks square */
  district: 2,
  /** the rocky shore: the mainland's westmost cells that are still sea */
  shoreBand: 3,
  /** the Long Causeway: two cells wide (z), from the backstreet avenue east of Clock Plaza to the mainland's shore */
  causeway: { z0: 7, z1: 8, x0: 104, x1: 146 },
  /** its broken middle: a low deck awash at sea level, flooded (impassable) until the Great Bloom raises it */
  broken: { x0: 120, x1: 129 },
  /** ramps down to the low middle from each side, this many cells long */
  rampLength: 3,
  /** the fountain tier that raises the causeway (the Great Bloom) */
  opensAtTier: 5,
  /** the district the causeway lands in, revealed by the Great Bloom; the rest is found by restoring outward */
  landing: [9, 0] as [number, number],
};

/** What a mainland district is, by weight. `downtown` is the industrial ruins (fallen girders, steel, E23.8.3.2). */
export const MAINLAND_TYPES: { type: AreaType; weight: number }[] = [
  { type: 'street', weight: 4 },
  { type: 'downtown', weight: 3 },
  { type: 'grove', weight: 2 },
  { type: 'park', weight: 2 },
  { type: 'market', weight: 1 },
  { type: 'plaza', weight: 1 },
  { type: 'reservoir', weight: 1 },
];

/**
 * Fresh water on the mainland, so pumps, planters and reservoirs work there as on the island. Cells are district-local
 * (a district is 32 × 32). Every chunk's avenues (chunk cells 7–8) cross the water on bridges, so a canal never cuts
 * the mainland in two. Sunk to sea level between walls, like the island's canals.
 */
export const MAINLAND_WATER = {
  /** a canal runs east–west through every district whose row (district z) is a multiple of this: every 2 × 2 of
   *  districts has one, and no district is more than one district from a canal */
  canalEvery: 2,
  /** the canal's rows inside its district (clear of the avenues at 7–8 and 23–24) */
  canalRows: [14, 15],
  /** a pond in the quiet band at the district's south end (rows 25–31, columns 9–22), by district type */
  ponds: {
    // a reservoir district is an open basin: a long rectangular pool
    reservoir: { chance: 1, rect: [10, 25, 21, 30] as [number, number, number, number] },
    plaza: { chance: 1, centre: [16, 28] as [number, number], radius: 2.6 },
    park: { chance: 0.6, centre: [16, 28] as [number, number], radius: 2.2 },
    grove: { chance: 0.3, centre: [15, 28] as [number, number], radius: 1.8 },
  } as Partial<Record<AreaType, { chance: number; rect?: [number, number, number, number]; centre?: [number, number]; radius?: number }>>,
};

/**
 * Salvage fields: the mainland's best salvage. In a district of a type below, each chunk holds a field (a cluster of
 * piles) with this chance. Fields are bigger and richer than the island's piles, and respawn quickly (E23.7.4 owns
 * respawning; `respawnDays` is the mainland's value for it).
 */
export const SALVAGE_FIELDS = {
  /** chance a chunk has a field */
  chance: 0.6,
  /** piles in a field */
  piles: [5, 9] as [number, number],
  /** how far piles scatter from the field's centre, in cells */
  spread: 3,
  /** game days for a mainland pile to refill (island piles are slower) */
  respawnDays: 0.5,
  /** what each district type's fields hold, by weight */
  materials: {
    street: { scrap: 3, copper: 2, glass: 1 },
    // the industrial ruins: the only place steel is found
    downtown: { steel: 4, scrap: 2, gears: 1, copper: 1 },
    grove: { seeds: 3, timber: 2 },
    park: { seeds: 2, timber: 2, clay: 1 },
    market: { glass: 2, scrap: 2, timber: 1 },
    plaza: { scrap: 2, sunstone: 1, glass: 1 },
    reservoir: { clay: 3, scrap: 1 },
  } as Partial<Record<AreaType, Partial<Record<MaterialId, number>>>>,
  sizes: { small: 1, medium: 2, large: 2 } as Record<PileSize, number>,
  /** a pile's model when its material has none */
  models: { small: 'rubble-pile', medium: 'crate', large: 'stone-block' } as Record<PileSize, string>,
};

/**
 * E23.8.3.2: the mainland-only machines, built from steel (recipes in data/salvage RECIPES). Starting values.
 * The grid battery joins the power grid (E23.3, `sim.power`) as storage; the long-range pump joins it as a consumer
 * (shed with the pumps) and the water network (E23.4, `sim.water`) as a pump with a long reach.
 */
export const MAINLAND_MACHINES = {
  gridBattery: {
    /** stored energy (power units × seconds): about ten island batteries */
    capacity: 4000,
    /** charge / discharge per second */
    rate: 60,
  },
  longPump: {
    /** power drawn while pumping */
    draw: 6,
    /** pipe steps it can feed along (the island's pump reaches without limit too: this one never reaches less) */
    reach: Infinity,
    /** water units per game day: twice the island pump's (E23.4.2 `WATER_NET.pump.perDay`, 1,200) */
    flow: 2400,
    /** it also stands on the sea's bank: its own filter makes the sea fresh, so the shore can feed the mainland */
    sea: true,
  },
};
