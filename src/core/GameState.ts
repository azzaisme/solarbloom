import { PARK_LAYOUT } from '../data/city';
import { ROOFTOPS, type RooftopDef } from '../data/rooftops';
import { TUNING } from '../data/tuning';
import { Rng } from './Rng';
import type { GameState, LayerData, MachineData, TileData } from './types';

/** v1 Round 1 · v2 Round 2 · v3 Phase 3 · v4 the endless city (chunked world, tile deltas; older saves are scrapped). */
export const SAVE_VERSION = 4;

/** Id of the endless ground layer (the city). Not playable until the park arrives (City 05). */
export const GROUND = 'g';

export function layerFromDef(def: RooftopDef): LayerData {
  return {
    id: def.id,
    name: def.name,
    kind: 'raised',
    width: def.width,
    depth: def.depth,
    height: def.height,
    origin: [...def.origin] as [number, number, number],
    unlocked: def.unlocked,
    preview: def.preview,
  };
}

/** The endless city ground. Playable from the start in the city; locked in the legacy rooftop layout. */
/** The current ground generation version (new games). */
export const GROUND_GEN = 3;

export function groundLayer(playable = true): LayerData {
  return { id: GROUND, name: 'The City', kind: 'ground', width: 0, depth: 0, height: playable ? 0 : -40, origin: [0, 0, 0], unlocked: playable, preview: !playable, gen: GROUND_GEN };
}

export interface NewGameOptions {
  /**
   * Legacy layout: the Seed, Reservoir and Canopy rooftops (Phase 3), with the city ground locked. The game
   * starts in the city park; mechanics tests use this small, bounded layout until rooftops return as city
   * areas (City 12).
   */
  rooftops?: boolean;
}

/** Adds a fixed structure (Core, starter panel). Tile occupancy is derived from machines by the world. */
export function placeFixed(state: Pick<GameState, 'machines' | 'nextId'>, roofId: string, type: MachineData['type'], x: number, z: number, size: number, starter = false): MachineData {
  const m: MachineData = { id: `m${state.nextId++}`, type, roofId, x, z, size, starter, boostUntil: 0, timer: 0, charge: 0 };
  state.machines.push(m);
  return m;
}

/** The fixed structures a rooftop starts with. */
export function placeRoofFixtures(state: Pick<GameState, 'machines' | 'nextId'>, def: RooftopDef) {
  if (def.core) placeFixed(state, def.id, 'core', def.core[0], def.core[1], 2);
  if (def.starterSolar) placeFixed(state, def.id, 'solar', def.starterSolar[0], def.starterSolar[1], 1, true);
}

export function createInitialState(seed = (Math.random() * 2 ** 32) >>> 0, opts: NewGameOptions = {}): GameState {
  const holder = { machines: [] as MachineData[], nextId: 1 };
  if (opts.rooftops) for (const def of ROOFTOPS) placeRoofFixtures(holder, def);
  else placeFixed(holder, GROUND, 'solar', PARK_LAYOUT.starterSolar[0], PARK_LAYOUT.starterSolar[1], 1, true);
  return {
    version: SAVE_VERSION,
    seed,
    rngState: new Rng(seed).state,
    time: 0,
    nextId: holder.nextId,
    resources: { ...TUNING.start.resources },
    caps: { ...TUNING.start.caps },
    layers: opts.rooftops ? [...ROOFTOPS.map(layerFromDef), groundLayer(false)] : [groundLayer(true)],
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
      cores: {},
      overflows: 0,
      canopyBursts: 0,
      neighbourhoodBloomAt: -1,
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

/** Ids of Core machines (cached per machine list length: machines are only ever added). */
let coreCache: { list?: MachineData[]; n: number; ids: Set<string> } = { n: -1, ids: new Set() };
function coreIds(machines: MachineData[]): Set<string> {
  if (coreCache.list !== machines || coreCache.n !== machines.length) coreCache = { list: machines, n: machines.length, ids: new Set(machines.filter((m) => m.type === 'core').map((m) => m.id)) };
  return coreCache.ids;
}
