import { createInitialState, SAVE_VERSION } from '../core/GameState';
import type { GameState } from '../core/types';

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

  deserialize(json: string): GameState | undefined {
    try {
      const s = JSON.parse(json) as GameState;
      if (!s || s.version !== SAVE_VERSION || !Array.isArray(s.rooftops)) return undefined;
      // Fill any fields added after this save was written.
      const base = createInitialState(s.seed);
      return { ...base, ...s, cat: { ...base.cat, ...s.cat }, progression: { ...base.progression, ...s.progression }, stats: { ...base.stats, ...s.stats } };
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
    try {
      const raw = this.storage?.getItem(SAVE_KEY);
      return raw ? this.deserialize(raw) : undefined;
    } catch {
      return undefined;
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
