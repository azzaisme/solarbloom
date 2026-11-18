import type { GameState, MaterialId } from './types';
import { LEGACY_RECLAIMER } from '../data/salvage';

/**
 * E23.7.4 (#398): saves from before the Reclaimer was dropped. Every placed Reclaimer is taken down and its recipe
 * refunded to the store (nothing the player built is lost), its undelivered fractions go, and the Terraces' old
 * "Reclaimer Mk 2" blueprint becomes Salvage Lore, the blueprint that replaced it, so that reward isn't lost either.
 * Runs on every load; a save without any of these is left exactly as it was.
 */
export function migrateSave(state: GameState): GameState {
  const sv = state.salvage;
  const old = state.machines.filter((m) => (m.type as string) === 'reclaimer');
  if (old.length) {
    state.machines = state.machines.filter((m) => (m.type as string) !== 'reclaimer');
    if (sv)
      for (const [k, v] of Object.entries(LEGACY_RECLAIMER.refund) as [MaterialId, number][]) sv.store[k] = (sv.store[k] ?? 0) + v * old.length;
  }
  const raw = sv as unknown as { reclaim?: unknown } | undefined;
  if (raw && 'reclaim' in raw) delete raw.reclaim;
  if (sv?.blueprints.includes(LEGACY_RECLAIMER.blueprint)) {
    sv.blueprints = sv.blueprints.filter((b) => b !== LEGACY_RECLAIMER.blueprint);
    if (!sv.blueprints.includes(LEGACY_RECLAIMER.becomes)) sv.blueprints.push(LEGACY_RECLAIMER.becomes);
  }
  return state;
}
