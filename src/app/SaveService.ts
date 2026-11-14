import { createInitialState, SAVE_VERSION } from '../core/GameState';
import type { Grid } from '../core/Grid';
import { packChunk } from '../core/TilePack';
import type { GameState } from '../core/types';

export const SAVE_KEY = 'solarbloom.save';
/** Prefix of a gzip-compressed, base64 save. Anything else is plain JSON. */
const Z = 'SB4z:';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface LoadResult {
  state?: GameState;
  /** An unreadable or newer save was copied here instead of being overwritten. */
  backedUpAs?: string;
  /** An older (pre-city, v1–v3) save was discarded: the game starts fresh. */
  scrapped?: boolean;
}

function safeStorage(): StorageLike | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** The world the Sim attached to its state (non-enumerable, so plain JSON never includes it). */
function worldOf(state: GameState): Grid | undefined {
  return (state as unknown as { world?: Grid }).world;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * Save format v4 (the endless city). Tiles are saved per chunk as deltas from generation (TilePack): untouched
 * chunks cost nothing. Saves older than v4 are discarded (the rooftop-era game is gone); newer or unreadable
 * saves are backed up, never overwritten. Chain queues are transient and intentionally not saved.
 */
export class SaveService {
  constructor(private storage: StorageLike | undefined = safeStorage()) {}

  /** Packs changed chunks (re-packing only chunks touched since the last save). */
  packTiles(state: GameState): Record<string, string> {
    const world = worldOf(state);
    if (!world) return state.tiles ?? {};
    const out: Record<string, string> = { ...world.pending };
    for (const c of world.loadedChunks()) {
      if (c.dirty || c.packed === undefined) {
        c.packed = packChunk(c, world.seed, world.layer(c.layer)!);
        c.dirty = false;
      }
      if (c.packed) out[c.key] = c.packed;
    }
    // Stable key order, so a save is byte-identical whether its chunks were loaded or still pending.
    const sorted: Record<string, string> = {};
    for (const k of Object.keys(out).sort()) sorted[k] = out[k];
    return sorted;
  }

  /**
   * The save as JSON. The tiles object is spliced in from per-chunk fragments: packed strings only use
   * characters JSON never escapes, so a big city's 2 MB of tiles costs a join, not a full re-stringify.
   */
  serialize(state: GameState): string {
    const tiles = this.packTiles(state);
    const base = JSON.stringify({ ...state, tiles: undefined });
    const frag = Object.keys(tiles)
      .map((k) => `"${k}":"${tiles[k]}"`)
      .join(',');
    return `${base.slice(0, -1)}${base.length > 2 ? ',' : ''}"tiles":{${frag}}}`;
  }

  /** gzip + base64 when the platform has CompressionStream; plain JSON otherwise. */
  async serializeCompressed(state: GameState): Promise<string> {
    let t = performance.now();
    const json = this.serialize(state);
    this.timings.serialize = performance.now() - t;
    if (typeof CompressionStream === 'undefined') return json;
    const gz = await pipe(new TextEncoder().encode(json), new CompressionStream('gzip')); // off the main thread
    t = performance.now();
    const out = Z + toBase64(gz);
    this.timings.encode = performance.now() - t;
    return out;
  }

  /** Main-thread cost of the last autosave's steps, ms (the perf harness checks each stays under a frame). */
  readonly timings = { serialize: 0, encode: 0, write: 0 };

  static async decode(raw: string): Promise<string> {
    if (!raw.startsWith(Z)) return raw;
    return new TextDecoder().decode(await pipe(fromBase64(raw.slice(Z.length)), new DecompressionStream('gzip')));
  }

  /** Parses a plain-JSON save. Returns 'scrapped' for pre-city saves, undefined for unreadable/newer ones. */
  parse(json: string): GameState | 'scrapped' | undefined {
    try {
      const s = JSON.parse(json) as GameState;
      if (!s || typeof s.version !== 'number') return undefined;
      if (s.version < SAVE_VERSION) return 'scrapped';
      if (s.version > SAVE_VERSION || !Array.isArray(s.layers)) return undefined;
      // Fill any fields added after this save was written.
      const base = createInitialState(s.seed);
      return {
        ...base,
        ...s,
        cat: { ...base.cat, ...s.cat },
        progression: { ...base.progression, ...s.progression },
        stats: { ...base.stats, ...s.stats, firsts: { ...(s.stats?.firsts ?? {}) } },
      };
    } catch {
      return undefined;
    }
  }

  /** Plain-JSON round trip (tests, tools). Pre-city saves come back undefined. */
  deserialize(json: string): GameState | undefined {
    const r = this.parse(json);
    return r === 'scrapped' ? undefined : r;
  }

  /** Synchronous, uncompressed save: for page unload, when there is no time to compress. */
  save(state: GameState): boolean {
    try {
      this.storage?.setItem(SAVE_KEY, this.serialize(state));
      return !!this.storage;
    } catch {
      return false;
    }
  }

  /** Writes an already-serialized save. False if storage refused it (full, private mode). */
  write(data: string): boolean {
    const t = performance.now();
    try {
      this.storage?.setItem(SAVE_KEY, data);
      this.timings.write = performance.now() - t;
      return !!this.storage;
    } catch {
      return false;
    }
  }

  /** Compressed save (autosave). Resolves false if storage refused it (full, private mode). */
  async saveCompressed(state: GameState): Promise<boolean> {
    try {
      const data = await this.serializeCompressed(state);
      this.storage?.setItem(SAVE_KEY, data);
      return !!this.storage;
    } catch {
      return false;
    }
  }

  private handle(raw: string, json: string | undefined): LoadResult {
    const parsed = json === undefined ? undefined : this.parse(json);
    if (parsed === 'scrapped') {
      this.clear();
      return { scrapped: true };
    }
    if (parsed) return { state: parsed };
    const key = `${SAVE_KEY}.backup.${Date.now()}`;
    try {
      this.storage?.setItem(key, raw);
    } catch {
      /* storage full: nothing more we can do */
    }
    return { backedUpAs: key };
  }

  /** Loads a plain-JSON save synchronously (a compressed save needs loadResultAsync). */
  loadResult(): LoadResult {
    try {
      const raw = this.storage?.getItem(SAVE_KEY);
      if (!raw) return {};
      return this.handle(raw, raw.startsWith(Z) ? undefined : raw);
    } catch {
      return {};
    }
  }

  async loadResultAsync(): Promise<LoadResult> {
    let raw: string | null | undefined;
    try {
      raw = this.storage?.getItem(SAVE_KEY);
    } catch {
      return {};
    }
    if (!raw) return {};
    let json: string | undefined;
    try {
      json = await SaveService.decode(raw);
    } catch {
      json = undefined;
    }
    return this.handle(raw, json);
  }

  load(): GameState | undefined {
    return this.loadResult().state;
  }

  clear() {
    try {
      this.storage?.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }
}
