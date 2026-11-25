import type { TileData, TileTransition } from '../../core/types';
import { onJetty, regionWater } from '../../core/OldCityLayout';

/**
 * Look 6 end-state hooks. Every transition animates toward *today's* stage visuals. The end state is whatever
 * the chunk renderer's builders draw for a tile: its slab colour (through `ChunkRenderer.slab()`) and its props
 * (through `ChunkRenderer.tile()`, which the framework calls via `ChunkHost.tile`). Look 3 (surfaces, foliage and
 * detail) replaces those builders and materials; as long as they draw through the same host interface (slab via
 * `slab()`, props via the sink passed in, trees/shrubs via the foliage sink), every transition animates toward the
 * new look with no change here. Look 2 (palette, dead-state colours) changes PALETTE, which the slab colours and the
 * transition shader's in-between colours (`TransitionRenderer.applyPalette`) both read.
 * This file only says which surface state a tile is in and what it came from.
 */

/** Surface state codes understood by the transition shader. */
export const STATE = { concrete: 0, moss: 1, soil: 2, grass: 3, hard: 4 } as const;
/** Surface transition kinds understood by the transition shader. */
export const KIND: Record<TileTransition['k'], number> = { soften: 1, moss: 2, restore: 3, bloom: 4, unblock: 5 };
/** Ground features as numbers (for the shader's per-feature looks). */
export const FEATURE: Record<string, number> = { lawn: 0, paving: 1, road: 2, water: 3, clay: 4, litter: 5, obstacle: 6, building: 7, sea: 8 };

/** Which surface look a tile has right now (its end state, the transition's target). */
export function surfaceState(t: TileData): number {
  if (t.blocked || t.occupantId) return STATE.hard;
  const f = t.feature ?? 'lawn';
  if (f === 'water') return STATE.hard;
  // E23.13: a deck over water (the jetty, a canal's bridge) is water underneath: never dead paving's grime and cracks
  if (t.level !== undefined && (onJetty(t.x, t.z) || (f === 'obstacle' && regionWater(t.x, t.z)))) return STATE.hard;
  switch (t.ground) {
    case 'polluted':
      return STATE.concrete;
    case 'prepared':
      return STATE.moss;
    case 'growing':
      return STATE.soil;
    default:
      return f === 'paving' ? STATE.hard : STATE.grass;
  }
}

/**
 * The tile as it looked when its transition started (for the outgoing props and the surface's starting colour).
 * `undefined` when the props don't change (softening only changes the surface).
 */
export function fromTile(t: TileData, tr: TileTransition): TileData | undefined {
  switch (tr.k) {
    case 'soften':
      return undefined;
    case 'moss':
      return { ...t, ground: 'polluted', pollution: tr.from ?? 25, bloom: 0, tr: undefined };
    case 'restore': {
      const p = tr.from ?? 0;
      return { ...t, ground: p > 0 ? 'polluted' : 'prepared', pollution: p, bloom: 0, tr: undefined, lushUntil: undefined };
    }
    case 'bloom':
      return { ...t, bloom: Math.max(1, Math.floor(tr.from ?? t.bloom - 1)), tr: undefined };
    case 'unblock':
      return { ...t, blocked: true, unblocked: undefined, tr: undefined };
  }
}
