import { PARK } from '../core/Areas';
import { AREA_TYPES } from '../data/city';
import type { ChainEvent } from '../gameplay/BloomChainSystem';
import type { Sim } from '../gameplay/Sim';

const BLOOMS = new Set(['RESTORE', 'GROW', 'LUSH']);

export interface ChainTrack {
  chainId: number;
  /** blooms per area, in the order the wave reached them */
  perArea: Map<string, number>;
  total: number;
  /** smoothed position of the wave front (world tiles) */
  fx: number;
  fz: number;
  /** area the front is in now */
  current?: string;
  updatedAt: number;
}

/**
 * City 10.6: readable huge chains. Follows every running chain from its events: blooms per area (for
 * "Canal ×37" summaries and a running total) and a smoothed wave front position. Pure bookkeeping, no
 * rendering, so it is tested headless.
 */
export class ChainSummary {
  readonly tracks = new Map<number, ChainTrack>();

  constructor(private sim: Sim) {
    sim.bus.on('chain.event', ({ event }) => this.onEvent(event));
    sim.bus.on('chain.ended', ({ chainId }) => this.tracks.delete(chainId));
  }

  private onEvent(ev: ChainEvent) {
    if (!BLOOMS.has(ev.type)) return;
    const t = this.sim.grid.byTileId(ev.target);
    if (!t) return;
    let tr = this.tracks.get(ev.chainId);
    if (!tr) {
      tr = { chainId: ev.chainId, perArea: new Map(), total: 0, fx: t.x + 0.5, fz: t.z + 0.5, updatedAt: this.sim.time };
      this.tracks.set(ev.chainId, tr);
    }
    const area = this.sim.areas.areaOf(t) ?? t.roofId;
    tr.perArea.set(area, (tr.perArea.get(area) ?? 0) + 1);
    tr.total++;
    // The front leans toward each new bloom (an exponential average), so it glides rather than jumps.
    tr.fx += (t.x + 0.5 - tr.fx) * 0.25;
    tr.fz += (t.z + 0.5 - tr.fz) * 0.25;
    tr.current = area;
    tr.updatedAt = this.sim.time;
  }

  /** The biggest chain running now. */
  biggest(): ChainTrack | undefined {
    let best: ChainTrack | undefined;
    for (const t of this.tracks.values()) if (!best || t.total > best.total) best = t;
    return best;
  }

  /** "🛶 Canal ×37" for one area. */
  areaLabel(area: string, n: number): string {
    if (area === PARK) return `🌳 The Park ×${n}`;
    const info = this.sim.grid.isPlayable('g') && /^a-?\d+_-?\d+_\d$/.test(area) ? this.sim.areas.info(area) : undefined;
    if (!info) return `🏙️ ${this.sim.grid.roof(area)?.name ?? area} ×${n}`;
    const def = AREA_TYPES[info.type];
    return `${def.icon} ${def.name} ×${n}`;
  }

  /**
   * The lines shown under the combo: the area the wave is in now first, then the biggest others, at most
   * `max`, and a running total when it spans more than one area.
   */
  lines(tr: ChainTrack, max = 3): string[] {
    const entries = [...tr.perArea.entries()];
    const cur = tr.current ? entries.find(([a]) => a === tr.current) : undefined;
    const rest = entries.filter(([a]) => a !== tr.current).sort((a, b) => b[1] - a[1]);
    const shown = (cur ? [cur, ...rest] : rest).slice(0, max).map(([a, n]) => this.areaLabel(a, n));
    if (entries.length > 1) shown.push(`${tr.total} blooms across ${entries.length} areas`);
    return shown;
  }
}

/**
 * Chain audio that changes instead of stacking: at most one bloom voice per `gap` seconds; pitch climbs with the
 * combo, and the texture shifts (sine → triangle → a brighter octave shimmer) as the chain grows.
 */
export function bloomVoice(combo: number, now: number, last: number): { step: number; type: OscillatorType; vol: number; octave: boolean } | undefined {
  const gap = combo < 20 ? 0.06 : combo < 100 ? 0.11 : 0.18;
  if (now - last < gap) return undefined;
  const step = combo < 20 ? combo : 20 + Math.floor(Math.log2(combo / 20) * 4);
  return {
    step: Math.min(step, 32),
    type: combo < 20 ? 'sine' : combo < 100 ? 'triangle' : 'sine',
    vol: combo < 20 ? 0.16 : 0.11,
    octave: combo >= 100,
  };
}

/** Per-frame VFX budget for chain events: the first few each frame get arcs, the rest only tile flashes. */
export class VfxBudget {
  private frame = -1;
  private used = 0;
  constructor(readonly perFrame = 18) {}
  take(frame: number): boolean {
    if (frame !== this.frame) {
      this.frame = frame;
      this.used = 0;
    }
    if (this.used >= this.perFrame) return false;
    this.used++;
    return true;
  }
}
