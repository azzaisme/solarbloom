import { createInitialState, SAVE_VERSION } from '../core/GameState';
import type { GameState } from '../core/types';
import { migrate } from './migrations';

export const SAVE_KEY = 'solarbloom.save';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function safeStorage(): StorageLike | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Versioned JSON save. Chain queues are transient and intentionally not saved. */
export class SaveService {
  constructor(private storage: StorageLike | undefined = safeStorage()) {}

  serialize(state: GameState): string {
    return JSON.stringify(state);
  }

  /**
   * Parses a save, migrating older versions forward. Returns undefined for anything unreadable
   * or from a newer game version (the caller backs those up rather than overwriting them).
   */
  deserialize(json: string): GameState | undefined {
    try {
      const s = JSON.parse(json) as GameState;
      if (!s || typeof s.version !== 'number' || !Array.isArray(s.rooftops)) return undefined;
      if (s.version > SAVE_VERSION) return undefined;
      migrate(s);
      // Fill any fields added after this save was written.
      const base = createInitialState(s.seed);
      return { ...base, ...s, cat: { ...base.cat, ...s.cat }, progression: { ...base.progression, ...s.progression }, stats: { ...base.stats, ...s.stats, firsts: { ...(s.stats?.firsts ?? {}) } } };
    } catch {
      return undefined;
    }
  }

  save(state: GameState): boolean {
    try {
      this.storage?.setItem(SAVE_KEY, this.serialize(state));
      return !!this.storage;
    } catch {
      return false;
    }
  }

  load(): GameState | undefined {
    return this.loadResult().state;
  }

  /** Loads the save. An unreadable/incompatible save is copied to a backup key first, never silently lost. */
  loadResult(): { state?: GameState; backedUpAs?: string } {
    try {
      const raw = this.storage?.getItem(SAVE_KEY);
      if (!raw) return {};
      const state = this.deserialize(raw);
      if (state) return { state };
      const key = `${SAVE_KEY}.backup.${Date.now()}`;
      this.storage?.setItem(key, raw);
      return { backedUpAs: key };
    } catch {
      return {};
    }
  }

  clear() {
    try {
      this.storage?.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }
}
