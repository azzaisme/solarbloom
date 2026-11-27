/**
 * E19.2 (#252): player-placed decorations, as saved data. A decoration sits on one tile of a layer and occupies
 * it exactly as a machine does: its tile's `occupantId` is `d:<key>`, so building, drones, pulses and chains treat
 * the tile as they treat a machine's (tests/decor.test.ts). The record lives in `GameState.cozy.decor`, written by
 * the game only (gameplay/Cozy.ts); the sim only reads it to stamp that occupancy when a chunk loads.
 *
 * #849: a piece may cover more than one square (data/cozy `size`). It is still saved once, under its north-west
 * square, and every square it covers carries the same `d:<key>` occupant.
 *
 * Saved sparsely: `key → value`, the key `<layer>|<x>|<z>`, the value the decoration's id with `@<quarter turns>`
 * when it is turned (`bench`, `bench@1`). Keys are kept sorted, so save → load → save is byte-identical.
 */
import { CHUNK } from './Hash';
import { decorCells } from '../data/cozy';

export const DECOR_PREFIX = 'd:';

export interface DecorAt {
  roofId: string;
  x: number;
  z: number;
}

export interface Decoration extends DecorAt {
  key: string;
  /** decoration id (data/cozy.ts DECOR_OPTIONS) */
  kind: string;
  /** quarter turns clockwise seen from above, 0–3 */
  rot: number;
}

export const decorKey = (roofId: string, x: number, z: number) => `${roofId}|${x}|${z}`;

export function parseDecorKey(key: string): DecorAt | undefined {
  const m = /^([^|]+)\|(-?\d+)\|(-?\d+)$/.exec(key);
  return m ? { roofId: m[1], x: Number(m[2]), z: Number(m[3]) } : undefined;
}

export function decorValue(kind: string, rot: number): string {
  const r = ((rot % 4) + 4) % 4;
  return r ? `${kind}@${r}` : kind;
}

export function parseDecorValue(v: string): { kind: string; rot: number } {
  const i = v.indexOf('@');
  return i < 0 ? { kind: v, rot: 0 } : { kind: v.slice(0, i), rot: Number(v.slice(i + 1)) & 3 };
}

export function decoration(key: string, value: string): Decoration | undefined {
  const at = parseDecorKey(key);
  return at ? { ...at, key, ...parseDecorValue(value) } : undefined;
}

/** The occupant id a decoration stamps on its tile. */
export const decorOccupant = (key: string) => DECOR_PREFIX + key;

export const isDecorOccupant = (id: string | undefined): id is string => !!id && id.startsWith(DECOR_PREFIX);

/** The decoration key behind an occupant id (undefined for machines). */
export const decorKeyOf = (occupantId: string | undefined) => (isDecorOccupant(occupantId) ? occupantId.slice(DECOR_PREFIX.length) : undefined);

/** The chunk key (as core/Grid keys chunks) a decoration's tile is in. */
export function decorChunkKey(key: string): string | undefined {
  const at = parseDecorKey(key);
  return at ? `${at.roofId}|${Math.floor(at.x / CHUNK)}|${Math.floor(at.z / CHUNK)}` : undefined;
}

/** #849: every square a saved decoration covers (its key names the north-west one). */
export function decorCellsOf(key: string, value: string): DecorAt[] {
  const at = parseDecorKey(key);
  if (!at) return [];
  const { kind, rot } = parseDecorValue(value);
  return decorCells(kind, rot, at.x, at.z).map((c) => ({ roofId: at.roofId, x: c.x, z: c.z }));
}

/** #849: the chunk keys a saved decoration's squares fall in (its own chunk first). */
export function decorChunkKeys(key: string, value: string): string[] {
  const out: string[] = [];
  const own = decorChunkKey(key);
  if (own) out.push(own);
  for (const c of decorCellsOf(key, value)) {
    const ck = `${c.roofId}|${Math.floor(c.x / CHUNK)}|${Math.floor(c.z / CHUNK)}`;
    if (!out.includes(ck)) out.push(ck);
  }
  return out;
}
