import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

export interface ActiveModifier {
  label: string;
  stat: 'biomass' | 'solar' | 'drones' | 'pulse';
  value: number;
  /** sim seconds left */
  left: number;
}

/**
 * Phase 4 E06.6: every temporary boost, composed in one place. Overlapping boosts on the same stat use the
 * strongest one, never the product (Frenzy biomass ×10 and another ×2 give ×10, not ×20). Everything is derived
 * from saved state each call, so a boost ends exactly when its timer does, also after pause or reload.
 */
export class Modifiers {
  constructor(private sim: Sim) {}

  /** Cached per sim time and boost state: solar output asks for every panel on every tick (E11 perf). */
  private cache?: { time: number; frenzy: number | undefined; buffs: unknown; nBuffs: number; list: ActiveModifier[]; best: Record<string, number> };

  private current() {
    const s = this.sim;
    const c = this.cache;
    // Valid for this sim instant while the boosts themselves are unchanged (no allocation on a hit).
    if (c && c.time === s.time && c.frenzy === s.state.frenzy?.until && c.buffs === s.state.buffs && c.nBuffs === s.state.buffs.length) return c;
    const list = this.build();
    const best: Record<string, number> = {};
    for (const m of list) best[m.stat] = Math.max(best[m.stat] ?? -Infinity, m.value);
    return (this.cache = { time: s.time, frenzy: s.state.frenzy?.until, buffs: s.state.buffs, nBuffs: s.state.buffs.length, list, best });
  }

  /** Boosts running right now, for the HUD. */
  list(): ActiveModifier[] {
    return this.current().list;
  }

  private build(): ActiveModifier[] {
    const s = this.sim;
    const out: ActiveModifier[] = [];
    const F = TUNING.frenzy;
    if (s.frenzy.active()) {
      const left = s.frenzy.remaining();
      out.push({ label: 'Bloom Frenzy', stat: 'biomass', value: F.biomassMult, left });
      out.push({ label: 'Bloom Frenzy', stat: 'drones', value: F.droneSpeedMult, left });
      out.push({ label: 'Bloom Frenzy', stat: 'pulse', value: F.pulseTierBonus, left });
    }
    const surge = s.state.buffs.find((b) => b.type === 'solarFrenzy');
    if (surge) out.push({ label: 'Solar Surge', stat: 'solar', value: TUNING.cat.frenzyMult, left: surge.until - s.time });
    // Phase 5 E14: the Solar Megaflower's burst (the strongest solar boost wins, never a product).
    const burst = s.state.buffs.find((b) => b.type === 'megaflower' && b.until > s.time);
    if (burst) out.push({ label: 'Solar Burst', stat: 'solar', value: TUNING.super.megaflower.mult, left: burst.until - s.time });
    return out;
  }

  private strongest(stat: ActiveModifier['stat'], base = 1): number {
    const b = this.current().best[stat];
    return b === undefined ? base : Math.max(base, b);
  }

  biomassMult(): number {
    return this.strongest('biomass');
  }

  solarMult(): number {
    return this.strongest('solar');
  }

  droneSpeedMult(): number {
    return this.strongest('drones');
  }

  /** Extra pulse reach tiers (added, then clamped to the last tier). */
  pulseTierBonus(): number {
    return this.strongest('pulse', 0);
  }
}
