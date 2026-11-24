import { PARK_LAYOUT } from '../data/city';
import { Rng } from './Rng';
import type { GameState, LayerData, MachineData, SalvageState, TileData } from './types';

/**
 * v1 Round 1 · v2 Round 2 · v3 Phase 3 · v4 the endless city (chunked world, tile deltas) · v5 Phase 5: big-number
 * resources, uncapped biomass, per-machine upgrades · v6 Phase 5: E13/E14 machine tiers, merges, cores and superstructure projects, E15 world events, cat ids and rarities. Older saves
 * are scrapped with a notice (no players yet, so no migration, as agreed) · v7 Look 6: tile transitions in the
 * chunk extras (a new column layout), the Cultivator · v8 E23.1.1: one rule set (the Old City) and no idle layer.
 * Every older save starts fresh with a calm note, no conversion (the owner is the only player).
 */
export const SAVE_VERSION = 8;

/** Id of the endless ground layer (the city). */
export const GROUND = 'g';

/** The current ground generation version (new games). */
export const GROUND_GEN = 4;

/** E21: the Old City's ground generation (laid over GROUND_GEN's city ground). */
export const OLD_CITY_GEN = 5;

export function groundLayer(playable = true, gen = GROUND_GEN): LayerData {
  return { id: GROUND, name: 'The City', kind: 'ground', width: 0, depth: 0, height: playable ? 0 : -40, origin: [0, 0, 0], unlocked: playable, preview: !playable, gen };
}

/** E21: a new Old City's salvage state (nothing carried, nothing found). */
export function newSalvage(): SalvageState {
  return { pack: {}, store: {}, piles: {}, opened: [], tier: 0, delivered: {}, abilities: [], keepers: {}, caches: [], pages: [], blueprints: [], house: 0, clockOffset: 0 };
}

/** Adds a fixed structure (Core, starter panel). Tile occupancy is derived from machines by the world. */
export function placeFixed(state: Pick<GameState, 'machines' | 'nextId'>, roofId: string, type: MachineData['type'], x: number, z: number, size: number, starter = false): MachineData {
  const m: MachineData = { id: `m${state.nextId++}`, type, roofId, x, z, size, starter, boostUntil: 0, timer: 0, charge: 0 };
  state.machines.push(m);
  return m;
}

/** A new game: the Old City (E23.1.1: the one rule set). */
export function createInitialState(seed = (Math.random() * 2 ** 32) >>> 0): GameState {
  const holder = { machines: [] as MachineData[], nextId: 1 };
  placeFixed(holder, GROUND, 'solar', PARK_LAYOUT.starterSolar[0], PARK_LAYOUT.starterSolar[1], 1, true);
  return {
    version: SAVE_VERSION,
    salvage: newSalvage(),
    seed,
    rngState: new Rng(seed).state,
    time: 0,
    nextId: holder.nextId,
    layers: [groundLayer(true, OLD_CITY_GEN)],
    machines: holder.machines,
    drones: [],
    oldDroneAwake: false, // the old drone sleeps on its lamp until the player wakes it
    upgrades: {},
    buffs: [],
    links: {},
    // The park is home: its fog thins as you restore it. E21.26: the boat lands on Saltwind Beach, so the beach is
    // open from the start too.
    areas: { park: { fog: 'thinning', revealedAt: 0 }, saltwind: { fog: 'thinning', revealedAt: 0 } },
    cat: { nextSpawnAt: -1, found: 0, stash: 0, firstSpawned: false, log: [], invasion: [], seq: 0, claimed: [] },
    progression: {
      coreActivated: false,
      coreActivatedAt: -1,
      tutorialStep: 0,
      hintsDismissed: false,
      introSeen: false,
      parkGrowth: 0, // #622: a new game has grown nothing from the park yet
      pulseCharge: 0,
      overflows: 0,
      canopyBursts: 0,
    },
    stats: { tilesRestored: 0, maxCombo: 0, chains: 0, catsFound: 0, droneJobs: 0, firsts: {}, chainEffects: 0, stuckSeconds: 0 },
  };
}

/** Tiles that count toward restoration (not vents, not a Core landmark). */
export function isRestorable(t: TileData, machines: MachineData[]): boolean {
  if (t.blocked) return false;
  if (!t.occupantId) return true;
  return coreIds(machines).has(t.occupantId) === false;
}

/**
 * Phase 5 E13: machines can now be removed (merging). Caches keyed on the machine list stamp it with this:
 * additions change the length, removals bump the revision, so a removal followed by an addition never
 * leaves a cache that looks current.
 */
let machineRev = 0;
export function machinesRemoved() {
  machineRev++;
}
export function machinesStamp(machines: readonly unknown[]): number {
  return machineRev * 1e7 + machines.length;
}

/** Ids of Core machines (cached per machine list stamp). */
let coreCache: { list?: MachineData[]; n: number; ids: Set<string> } = { n: -1, ids: new Set() };
function coreIds(machines: MachineData[]): Set<string> {
  if (coreCache.list !== machines || coreCache.n !== machinesStamp(machines)) coreCache = { list: machines, n: machinesStamp(machines), ids: new Set(machines.filter((m) => m.type === 'core').map((m) => m.id)) };
  return coreCache.ids;
}
