import { amounts, caps } from '../core/Economy';
import type { BigLike } from '../core/Big';
import { createInitialState, SAVE_VERSION } from '../core/GameState';
import type { Grid } from '../core/Grid';
import { packChunk } from '../core/TilePack';
import type { GameState } from '../core/types';
import { TIERS } from '../data/salvage';

/** The single save from before E22.12; it moves to slot 1 the first time the game starts. */
export const SAVE_KEY = 'solarbloom.save';
/** E22.12: three save slots. */
export const SLOT_COUNT = 3;
export type Slot = 1 | 2 | 3;
/** A slot's save (`solarbloom.save.1`…`.3`; three files on the Deck). */
export const slotKey = (slot: Slot) => `${SAVE_KEY}.${slot}`;
/** The small header stored beside a slot's save, so the title screen never parses whole saves. */
export const headerKey = (slot: Slot) => `${SAVE_KEY}.${slot}.head`;

/** E22.12: what the title screen shows for a slot. */
export interface SlotHeader {
  name: string;
  /** E21's day number, when its clock exists */
  day?: number;
  /** seconds played */
  played: number;
  /** the fountain's step, in words */
  step: string;
  /** the region bloombot was last in */
  region: string;
  rules: 'classic' | 'oldcity';
  savedAt: number;
}
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

/**
 * Steam Deck (#243): saves as files. `files` reads and writes the user data folder (the desktop wrapper's
 * preload provides it); `local` is browser storage. The first read of a key the files don't have yet takes it
 * from browser storage and writes it to a file (a one-time import), so an earlier browser-storage save carries
 * over. Everything after that goes to files only.
 */
export function fileBackedStorage(files: StorageLike, local?: StorageLike): StorageLike {
  return {
    getItem(k) {
      const v = files.getItem(k);
      if (v !== null) return v;
      let old: string | null = null;
      try {
        old = local?.getItem(k) ?? null;
      } catch {
        /* browser storage blocked */
      }
      if (old !== null) files.setItem(k, old);
      return old;
    },
    setItem: (k, v) => files.setItem(k, v),
    removeItem(k) {
      files.removeItem(k);
      try {
        local?.removeItem(k); // or the import would bring a cleared save back
      } catch {
        /* browser storage blocked */
      }
    },
  };
}

function safeStorage(): StorageLike | undefined {
  let local: StorageLike | undefined;
  try {
    local = typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    local = undefined;
  }
  const files = (globalThis as { solarbloomDesktop?: { saves?: StorageLike } }).solarbloomDesktop?.saves;
  return files ? fileBackedStorage(files, local) : local;
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
  /** where this service reads and writes: a slot's key */
  readonly key: string;

  constructor(
    private storage: StorageLike | undefined = safeStorage(),
    readonly slot: Slot = 1,
  ) {
    this.key = slotKey(slot);
  }

  /** E22.12: the game fills in what a header needs that the state doesn't say (the region, from bloombot). */
  headerExtra?: () => Partial<SlotHeader>;

  /**
   * E22.12: the save from before slots (`solarbloom.save`) becomes slot 1, once. It is copied first and removed
   * only after the copy is written, so a full or blocked storage keeps it where it was.
   */
  migrateLegacy(): boolean {
    try {
      const st = this.storage;
      if (!st) return false;
      const old = st.getItem(SAVE_KEY);
      if (old === null || st.getItem(slotKey(1)) !== null) return false;
      st.setItem(slotKey(1), old);
      st.removeItem(SAVE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  /** E22.12: a slot's header as the title screen shows it, without reading the save. */
  readHeader(slot: Slot = this.slot): SlotHeader | undefined {
    try {
      const raw = this.storage?.getItem(headerKey(slot));
      return raw ? (JSON.parse(raw) as SlotHeader) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Is there a save in a slot? */
  hasSave(slot: Slot = this.slot): boolean {
    try {
      return !!this.storage?.getItem(slotKey(slot));
    } catch {
      return false;
    }
  }

  /** The header for a state (its name kept from the slot's header when there is one). */
  headerFor(state: GameState): SlotHeader {
    const prev = this.readHeader();
    const st = state as unknown as { clock?: { day?: number }; day?: number };
    const cleared = Object.values(state.areas ?? {}).filter((a) => a.fog === 'cleared').length;
    // E21.6: an Old City save shows the fountain's step by its name; a classic one whether the fountain is awake
    const tier = state.salvage?.tier ?? 0;
    const step =
      state.rules === 'oldcity'
        ? tier > 0
          ? `Fountain: ${TIERS[tier - 1].name}`
          : 'The fountain is dry'
        : state.progression.coreActivated
          ? cleared > 1
            ? `The fountain is awake, ${cleared - 1} more places woken`
            : 'The fountain is awake'
          : 'The fountain is asleep';
    return {
      name: prev?.name ?? `Garden ${this.slot}`,
      day: st.clock?.day ?? st.day,
      played: Math.round(state.time ?? 0),
      step,
      region: prev?.region ?? 'The park',
      rules: state.rules === 'oldcity' ? 'oldcity' : 'classic',
      ...this.headerExtra?.(),
      savedAt: this.now(),
    };
  }

  writeHeader(state: GameState) {
    try {
      this.storage?.setItem(headerKey(this.slot), JSON.stringify(this.headerFor(state)));
    } catch {
      /* storage full: the save itself matters more */
    }
  }

  /** E22.12: renames a slot (its header only). */
  rename(name: string, slot: Slot = this.slot) {
    const h = this.readHeader(slot);
    if (!h) return false;
    try {
      this.storage?.setItem(headerKey(slot), JSON.stringify({ ...h, name: name.trim().slice(0, 40) || h.name }));
      return true;
    } catch {
      return false;
    }
  }

  /** E22.12: deletes a slot's save and header (its backups stay). */
  deleteSlot(slot: Slot = this.slot) {
    try {
      this.storage?.removeItem(slotKey(slot));
      this.storage?.removeItem(headerKey(slot));
    } catch {
      /* ignore */
    }
  }

  /** E22.12: every slot's header (undefined for an empty slot). A save without a header gets one (one parse). */
  async slots(): Promise<(SlotHeader | undefined)[]> {
    this.migrateLegacy();
    const out: (SlotHeader | undefined)[] = [];
    for (let i = 1; i <= SLOT_COUNT; i++) {
      const slot = i as Slot;
      if (!this.hasSave(slot)) {
        out.push(undefined);
        continue;
      }
      let h = this.readHeader(slot);
      if (!h) {
        const svc = new SaveService(this.storage, slot);
        svc.now = this.now;
        const r = await svc.loadResultAsync();
        if (r.state) {
          svc.writeHeader(r.state);
          h = svc.readHeader(slot);
        }
      }
      out.push(h);
    }
    return out;
  }

  /** Wall clock for `savedAt`, shared by every SaveService (tests fix it to compare saves byte for byte). */
  static clock: () => number = () => Date.now();
  /** This service's clock (defaults to the shared one). */
  now: () => number = () => SaveService.clock();

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
    const base = JSON.stringify({ ...state, savedAt: this.now(), tiles: undefined });
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
      // E21: a save without `rules` is classic (and has no salvage state).
      const base = createInitialState(s.seed, s.rules ?? 'classic');
      // Phase 5 E12: resource quantities are saved as Decimal strings.
      const raw = s as unknown as { resources?: Record<string, BigLike>; caps?: Record<string, BigLike> };
      return {
        ...base,
        ...s,
        resources: amounts(raw.resources ?? {}),
        caps: caps(raw.caps ?? {}),
        cat: { ...base.cat, ...s.cat },
        events: { ...base.events!, ...s.events },
        progression: { ...base.progression, ...s.progression },
        stats: { ...base.stats, ...s.stats, firsts: { ...(s.stats?.firsts ?? {}) } },
        salvage: base.salvage ? { ...base.salvage, ...s.salvage } : undefined,
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
      this.storage?.setItem(this.key, this.serialize(state));
      this.writeHeader(state);
      return !!this.storage;
    } catch {
      return false;
    }
  }

  /** Writes an already-serialized save. False if storage refused it (full, private mode). */
  write(data: string): boolean {
    const t = performance.now();
    try {
      this.storage?.setItem(this.key, data);
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
      this.storage?.setItem(this.key, data);
      this.writeHeader(state);
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
    const key = `${this.key}.backup.${Date.now()}`;
    try {
      this.storage?.setItem(key, raw);
    } catch {
      /* storage full: nothing more we can do */
    }
    return { backedUpAs: key };
  }

  /** Loads a plain-JSON save synchronously (a compressed save needs loadResultAsync). */
  loadResult(): LoadResult {
    if (this.slot === 1) this.migrateLegacy();
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return {};
      return this.handle(raw, raw.startsWith(Z) ? undefined : raw);
    } catch {
      return {};
    }
  }

  async loadResultAsync(): Promise<LoadResult> {
    if (this.slot === 1) this.migrateLegacy();
    let raw: string | null | undefined;
    try {
      raw = this.storage?.getItem(this.key);
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
      this.storage?.removeItem(this.key);
      this.storage?.removeItem(headerKey(this.slot));
    } catch {
      /* ignore */
    }
  }
}
