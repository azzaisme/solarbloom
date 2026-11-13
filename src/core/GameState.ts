import { ROOFTOPS } from '../data/rooftops';
import { TUNING } from '../data/tuning';
import { tileId } from './Grid';
import { Rng } from './Rng';
import type { GameState, MachineData, RooftopData, TileData } from './types';

export const SAVE_VERSION = 1;

export function createInitialState(seed = (Math.random() * 2 ** 32) >>> 0): GameState {
  const rng = new Rng(seed);
  const machines: MachineData[] = [];
  const rooftops: RooftopData[] = ROOFTOPS.map((def) => {
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
  });

  let nextId = 1;
  const place = (roofId: string, type: MachineData['type'], x: number, z: number, size: number, starter = false) => {
    const roof = rooftops.find((r) => r.id === roofId)!;
    const m: MachineData = { id: `m${nextId++}`, type, roofId, x, z, size, starter, boostUntil: 0, timer: 0 };
    machines.push(m);
    for (let dz = 0; dz < size; dz++)
      for (let dx = 0; dx < size; dx++) {
        const t = roof.tiles.find((t) => t.x === x + dx && t.z === z + dz)!;
        t.occupantId = m.id;
        if (type === 'solar') {
          t.ground = 'prepared';
          t.pollution = 0;
        }
      }
  };
  for (const def of ROOFTOPS) {
    if (def.core) place(def.id, 'core', def.core[0], def.core[1], 2);
    if (def.starterSolar) place(def.id, 'solar', def.starterSolar[0], def.starterSolar[1], 1, true);
  }

  return {
    version: SAVE_VERSION,
    seed,
    rngState: rng.state,
    time: 0,
    nextId,
    resources: { ...TUNING.start.resources },
    caps: { ...TUNING.start.caps },
    rooftops,
    machines,
    drones: [],
    upgrades: {},
    buffs: [],
    harvestReadyAt: 0,
    cat: { nextSpawnAt: -1, found: 0, firstSpawned: false, log: [] },
    progression: { coreActivated: false, coreActivatedAt: -1, tutorialStep: 0, hintsDismissed: false },
    stats: { tilesRestored: 0, maxCombo: 0, chains: 0, catsFound: 0, droneJobs: 0 },
  };
}

/** Tiles that count toward rooftop restoration (not vents, not the Core landmark). */
export function isRestorable(t: TileData, machines: MachineData[]): boolean {
  if (t.blocked) return false;
  if (!t.occupantId) return true;
  return machines.find((m) => m.id === t.occupantId)?.type !== 'core';
}
