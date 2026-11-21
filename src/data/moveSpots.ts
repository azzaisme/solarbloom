// E25 (#626): each move Bloombot learns at the fountain gets a second level, worked out later at the workshop table
// (research.ts, the rb-*2 projects), and places out in the world that need it. All data: where the new ground is,
// where each trip starts and lands, what the vaults and stashes hold. MoveSpots (gameplay) reads it.

import type { AbilityId } from '../core/types';
import type { ItemCost } from './crafting';
import type { CellRect } from './oldcity';

/**
 * New ground the level II moves reach, laid over what the city had there: a sandbar and an old pier's head off the beach,
 * the flat roofs of two old ruins. `level` is its terrace level (core/Height); nothing ramps up to it.
 * `ground`: sand lies low in the sea; a pier is old stonework standing out of it; a roof is a ruin's flat top. Both
 * of those are walled all round.
 */
export interface MoveLandDef extends CellRect {
  id: string;
  name: string;
  level: number;
  ground: 'sand' | 'pier' | 'roof';
}

export const MOVE_LAND: MoveLandDef[] = [
  // Hover II: a sandbar five tiles out from the jetty's end
  { id: 'sandbar', name: 'the sandbar', x: 6, z: 54, w: 5, d: 3, level: 0, ground: 'sand' },
  // Glide II: what is left of an old pier off the east cliff, as high as the cliff, with the sandbar ten tiles west
  { id: 'oldPier', name: 'the old pier', x: 21, z: 53, w: 3, d: 3, level: 1, ground: 'pier' },
  // Climb II: a ruin's roof in the Old Market, with a higher one beside it
  { id: 'marketRoof', name: 'the old roof', x: 30, z: 20, w: 3, d: 3, level: 2, ground: 'roof' },
  { id: 'marketRoofTop', name: 'the top roof', x: 33, z: 20, w: 2, d: 2, level: 3, ground: 'roof' },
  // Climb II: a boathouse roof in Saltwind
  { id: 'boathouseRoof', name: 'the boathouse roof', x: -7, z: 26, w: 3, d: 3, level: 1, ground: 'roof' },
];

/**
 * A trip across open water or a gap: Bloombot stands on `from`, faces a cell of `at`, and goes to `to`.
 * Climbing up or down a roof's wall needs no entry: any roof in MOVE_LAND can be climbed from the cell beside it.
 * `back`: the way home from somewhere a trip took Bloombot. It needs nothing (no level, no charge), so Bloombot is
 * never stranded out at sea.
 */
export interface MoveTripDef {
  id: string;
  move: AbilityId;
  from: CellRect;
  at: CellRect;
  to: [number, number];
  /** the prompt: "Hover over to" + "the sandbar" */
  verb: string;
  name: string;
  back?: boolean;
}

export const MOVE_TRIPS: MoveTripDef[] = [
  { id: 'jetty-sandbar', move: 'hover', from: { x: 7, z: 48, w: 3, d: 1 }, at: { x: 6, z: 49, w: 5, d: 1 }, to: [8, 54], verb: 'Hover over to', name: 'the sandbar' },
  { id: 'sandbar-jetty', move: 'hover', from: { x: 6, z: 54, w: 5, d: 1 }, at: { x: 6, z: 53, w: 5, d: 1 }, to: [8, 48], verb: 'Hover back to', name: 'the jetty', back: true },
  { id: 'cliff-pier', move: 'glide', from: { x: 20, z: 47, w: 5, d: 1 }, at: { x: 20, z: 48, w: 5, d: 1 }, to: [22, 53], verb: 'Glide over to', name: 'the old pier' },
  { id: 'pier-sandbar', move: 'glide', from: { x: 21, z: 53, w: 1, d: 3 }, at: { x: 20, z: 53, w: 1, d: 3 }, to: [10, 55], verb: 'Glide down to', name: 'the sandbar', back: true },
];

/** A heavy door sealed shut: Pry II holds Interact this long to force it, and it gives what is inside, once. */
export interface VaultDef {
  id: string;
  x: number;
  z: number;
  gives: ItemCost;
}

export const VAULTS: VaultDef[] = [
  { id: 'v-mastRow', x: 24, z: -11, gives: { copper: 24, wire: 6, batteryCell: 1 } },
  { id: 'v-oldMarket', x: 40, z: 26, gives: { timber: 20, gears: 12, motor: 1 } },
  { id: 'v-saltwind', x: 11, z: 31, gives: { glass: 20, clay: 12, pipe: 4 } },
];

/** A stash left where only a level II move reaches: Open gives what is in it, once. */
export interface StashDef {
  id: string;
  x: number;
  z: number;
  gives: ItemCost;
}

export const STASHES: StashDef[] = [
  { id: 's-sandbar', x: 9, z: 56, gives: { glass: 16, sunstone: 6, batteryCell: 1 } },
  { id: 's-oldPier', x: 22, z: 55, gives: { sunstone: 12, motor: 2 } },
  { id: 's-marketRoof', x: 34, z: 20, gives: { gears: 16, glassPane: 3, sunCell: 1 } },
  { id: 's-boathouseRoof', x: -5, z: 28, gives: { timber: 16, pipe: 3, wire: 4 } },
];

export const MOVE_LEVELS = {
  /** seconds to hold Interact to force a vault door (a barricade takes SALVAGE.pryHoldSeconds) */
  vaultHoldSeconds: 3,
  /** a trip's length in seconds: a base and a little more for each tile it covers */
  tripSeconds: 0.6,
  tripSecondsPerTile: 0.12,
  /** how high a trip rises over its straight line, in tiles: a hover skims, a climb and a glide lift */
  tripArc: { hover: 0.25, climb: 0.5, glide: 0.9 } as Record<'hover' | 'climb' | 'glide', number>,
};

/** What each move's second level does, for the Bloombot page. */
export const MOVE_LEVEL_TWO: Record<AbilityId, { name: string; does: string; where: string }> = {
  pry: { name: 'Pry II', does: 'Forces open the heavy iron doors of old vaults.', where: 'There are old vaults to open in Mast Row, the Old Market and Saltwind.' },
  hover: { name: 'Hover II', does: 'Hovers much further over the sea.', where: 'From the end of the jetty, Bloombot can hover out to the sandbar.' },
  climb: { name: 'Climb II', does: 'Climbs straight up a low wall, with no ladder.', where: 'There are old roofs to climb in the Old Market and in Saltwind.' },
  glide: { name: 'Glide II', does: 'Glides a lot further from a high edge.', where: 'From the cliff east of the beach, Bloombot can glide out to the old pier.' },
};
