import { ROOF_BY_ID } from '../data/rooftops';
import { TUNING } from '../data/tuning';
import type { GroundState, LayerData, TileData } from './types';

/** Stable tile key: layer id + layer-local integer cell. */
export const tileId = (layerId: string, x: number, z: number) => `${layerId}:${x}:${z}`;

/** Chunk size in tiles (square). */
export const CHUNK = 16;

/** 32-bit string hash (FNV-1a), for layer ids. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Order-independent per-tile randomness: a pure function of (seed, layer, x, z, salt). Generation never touches
 * the game's own RNG stream, so the world is identical however and whenever chunks are first visited.
 */
export function tileRandom(seed: number, layerHash: number, x: number, z: number, salt = 0): number {
  let h = (seed ^ Math.imul(layerHash, 0x9e3779b1) ^ Math.imul(x | 0, 0x85ebca6b) ^ Math.imul(z | 0, 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const inList = (list: readonly (readonly [number, number])[] | undefined, x: number, z: number) => !!list && list.some(([a, b]) => a === x && b === z);

/** The starting state of one tile, before any play. `undefined` outside a bounded layer. */
export function generateTile(seed: number, layer: LayerData, x: number, z: number): TileData | undefined {
  if (layer.kind === 'raised' && (x < 0 || z < 0 || x >= layer.width || z >= layer.depth)) return undefined;
  const lh = hashString(layer.id);
  const def = ROOF_BY_ID[layer.id];
  const prepared = inList(def?.prepared, x, z) || (!!def?.starterSolar && def.starterSolar[0] === x && def.starterSolar[1] === z);
  const blocked = inList(def?.blocked, x, z);
  const ground: GroundState = prepared ? 'prepared' : 'polluted';
  const { pollutionMin, pollutionMax } = TUNING.restore;
  return {
    id: tileId(layer.id, x, z),
    roofId: layer.id,
    x,
    z,
    ground,
    pollution: prepared ? 0 : Math.round(pollutionMin + (pollutionMax - pollutionMin) * tileRandom(seed, lh, x, z, 1)),
    variant: Math.floor(tileRandom(seed, lh, x, z, 2) * 10000),
    blocked,
    growthRemainingSec: 0,
    bloom: 0,
  };
}
