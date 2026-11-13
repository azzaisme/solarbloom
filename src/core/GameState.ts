import { ROOFTOPS, type RooftopDef } from '../data/rooftops';
import { TUNING } from '../data/tuning';
import { tileId } from './Grid';
import { Rng } from './Rng';
import type { GameState, MachineData, RooftopData, TileData } from './types';

/** v1 Round 1 · v2 Round 2 · v3 Phase 3 (three rooftops, links, per-roof cores). */
export const SAVE_VERSION = 3;

/** Builds a rooftop's tiles from its authored definition (fresh, nothing restored). */
export function buildRoof(def: RooftopDef, rng: Rng): RooftopData {
  const tiles: TileData[] = [];
  const isIn = (list: [number, number][], x: number, z: number) => list.some(([a, b]) => a === x && b === z);
  for (let z = 0; z < def.depth; z++) {
    for (let x = 0; x < def.width; x++) {
      const prepared = isIn(def.prepared, x, z);
      tiles.push({
        id: tileId(def.id, x, z),
        roofId: def.id,
        x,
        z,
        ground: prepared ? 'prepared' : 'polluted',
        pollution: prepared ? 0 : Math.round(rng.range(TUNING.restore.pollutionMin, TUNING.restore.pollutionMax)),
        variant: rng.int(0, 9999),
        blocked: isIn(def.blocked, x, z),
        growthRemainingSec: 0,
        bloom: 0,
      });
    }
  }
  return {
    id: def.id,
    name: def.name,
    width: def.width,
    depth: def.depth,
    height: def.height,
    origin: [...def.origin] as [number, number, number],
    unlocked: def.unlocked,
    preview: def.preview,
    tiles,
  };
}

/** Places a fixed structure (Core, starter panel) during state creation or migration. */
export function placeFixed(state: Pick<GameState, 'rooftops' | 'machines' | 'nextId'>, roofId: string, type: MachineData['type'], x: number, z: number, size: number, starter = false): MachineData {
  const roof = state.rooftops.find((r) => r.id === roofId)!;
  const m: MachineData = { id: `m${state.nextId++}`, type, roofId, x, z, size, starter, boostUntil: 0, timer: 0, charge: 0 };
  state.machines.push(m);
  for (let dz = 0; dz < size; dz++)
    for (let dx = 0; dx < size; dx++) {
      const t = roof.tiles.find((t) => t.x === x + dx && t.z === z + dz)!;
      t.occupantId = m.id;
      if (type === 'solar') {
        t.ground = 'prepared';
        t.pollution = 0;
      }
    }
  return m;
}

/** The fixed structures a rooftop starts with. */
export function placeRoofFixtures(state: Pick<GameState, 'rooftops' | 'machines' | 'nextId'>, def: RooftopDef) {
  if (def.core) placeFixed(state, def.id, 'core', def.core[0], def.core[1], 2);
  if (def.starterSolar) placeFixed(state, def.id, 'solar', def.starterSolar[0], def.starterSolar[1], 1, true);
}

export function createInitialState(seed = (Math.random() * 2 ** 32) >>> 0): GameState {
  const rng = new Rng(seed);
  const holder = { rooftops: ROOFTOPS.map((def) => buildRoof(def, rng)), machines: [] as MachineData[], nextId: 1 };
  for (const def of ROOFTOPS) placeRoofFixtures(holder, def);

  return {
    version: SAVE_VERSION,
    seed,
    rngState: rng.state,
    time: 0,
    nextId: holder.nextId,
    resources: { ...TUNING.start.resources },
    caps: { ...TUNING.start.caps },
    rooftops: holder.rooftops,
    machines: holder.machines,
    drones: [],
    upgrades: {},
    buffs: [],
    harvestReadyAt: 0,
    links: {},
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

/** Tiles that count toward rooftop restoration (not vents, not the Core landmark). */
export function isRestorable(t: TileData, machines: MachineData[]): boolean {
  if (t.blocked) return false;
  if (!t.occupantId) return true;
  return machines.find((m) => m.id === t.occupantId)?.type !== 'core';
}
