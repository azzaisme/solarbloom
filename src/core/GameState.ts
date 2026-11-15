import { PARK_LAYOUT } from '../data/city';
import { TUNING } from '../data/tuning';
import { Rng } from './Rng';
import { amounts, caps } from './Economy';
import type { GameState, LayerData, MachineData, TileData } from './types';

/**
 * v1 Round 1 · v2 Round 2 · v3 Phase 3 · v4 the endless city (chunked world, tile deltas) · v5 Phase 5: big-number
 * resources, uncapped biomass, per-machine upgrades. Older saves are scrapped with a notice (no players yet).
 */
export const SAVE_VERSION = 5;

/** Id of the endless ground layer (the city). */
export const GROUND = 'g';

/** The current ground generation version (new games). */
export const GROUND_GEN = 3;

export function groundLayer(playable = true): LayerData {
  return { id: GROUND, name: 'The City', kind: 'ground', width: 0, depth: 0, height: playable ? 0 : -40, origin: [0, 0, 0], unlocked: playable, preview: !playable, gen: GROUND_GEN };
}

/** Adds a fixed structure (Core, starter panel). Tile occupancy is derived from machines by the world. */
export function placeFixed(state: Pick<GameState, 'machines' | 'nextId'>, roofId: string, type: MachineData['type'], x: number, z: number, size: number, starter = false): MachineData {
  const m: MachineData = { id: `m${state.nextId++}`, type, roofId, x, z, size, starter, boostUntil: 0, timer: 0, charge: 0 };
  state.machines.push(m);
  return m;
}

export function createInitialState(seed = (Math.random() * 2 ** 32) >>> 0): GameState {
  const holder = { machines: [] as MachineData[], nextId: 1 };
  placeFixed(holder, GROUND, 'solar', PARK_LAYOUT.starterSolar[0], PARK_LAYOUT.starterSolar[1], 1, true);
  return {
    version: SAVE_VERSION,
    seed,
    rngState: new Rng(seed).state,
    time: 0,
    nextId: holder.nextId,
    resources: amounts(TUNING.start.resources),
    caps: caps(TUNING.start.caps),
    layers: [groundLayer(true)],
    machines: holder.machines,
    drones: [],
    upgrades: {},
    buffs: [],
    harvestReadyAt: 0,
    links: {},
    // The park is home: its fog thins as you restore it, with no edge rule.
    areas: { park: { fog: 'thinning', revealedAt: 0 } },
    relayBonus: 0,
    cat: { nextSpawnAt: -1, found: 0, stash: 0, firstSpawned: false, log: [] },
    progression: {
      coreActivated: false,
      coreActivatedAt: -1,
      tutorialStep: 0,
      hintsDismissed: false,
      introSeen: false,
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
