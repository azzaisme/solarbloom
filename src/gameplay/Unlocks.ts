// E23.8.2 (#400): is a system unlocked yet? Home's unlocks are held from the start; a region's arrive when its Keeper
// wakes (leaves 'asleep'). Machines and panels from other sessions ask here instead of naming a region.

import type { GameState } from '../core/types';
import { KEEPERS } from '../data/oldcity';
import { REGION_UNLOCKS, unlockSource, type UnlockSource } from '../data/unlocks';

/** Has this source (home or a region's Keeper) handed its unlocks over? */
export function sourceOpen(state: GameState, from: UnlockSource): boolean {
  if (from === 'home' || !state.salvage) return true;
  const k = KEEPERS.find((q) => q.region === from);
  const step = k ? state.salvage.keepers[k.id]?.step : undefined;
  return !!step && step !== 'asleep';
}

/** Is an unlock held? An id no region hands over (a classic machine, a typo) is treated as held, never as a lock. */
export function isUnlocked(state: GameState, id: string): boolean {
  const from = unlockSource(id);
  return !from || sourceOpen(state, from);
}

/** Is an unlock held and are its hard needs held too? */
export function isUsable(state: GameState, id: string): boolean {
  if (!isUnlocked(state, id)) return false;
  const from = unlockSource(id);
  const def = from ? REGION_UNLOCKS[from].find((u) => u.id === id) : undefined;
  return (def?.needs ?? []).every((n) => isUnlocked(state, n));
}

/** Every unlock held right now, in table order. */
export function heldUnlocks(state: GameState): string[] {
  return (Object.keys(REGION_UNLOCKS) as UnlockSource[]).filter((f) => sourceOpen(state, f)).flatMap((f) => REGION_UNLOCKS[f].map((u) => u.id));
}
