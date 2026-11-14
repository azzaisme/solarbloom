/** Shared low-level helpers for deterministic, order-independent generation. */

/** Chunk size in tiles (square). */
export const CHUNK = 16;

/** Stable tile key: layer id + layer-local integer cell. */
export const tileId = (layerId: string, x: number, z: number) => `${layerId}:${x}:${z}`;

/** 32-bit string hash (FNV-1a), for layer ids and salts. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Order-independent randomness: a pure function of (seed, layer, x, z, salt). Generation never touches
 * the game's own RNG stream, so the world is identical however and whenever chunks are first visited.
 */
export function tileRandom(seed: number, layerHash: number, x: number, z: number, salt = 0): number {
  let h = (seed ^ Math.imul(layerHash, 0x9e3779b1) ^ Math.imul(x | 0, 0x85ebca6b) ^ Math.imul(z | 0, 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
