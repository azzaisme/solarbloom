import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/** Which output a boost multiplies (`pulse` adds reach tiers instead). */
export type ModStat = 'biomass' | 'solar' | 'water' | 'drones' | 'pulse';
/**
 * Phase 5 E15: where a boost comes from. Same category: the strongest wins. Different categories: multiplied,
 * capped at TUNING.modifiers.maxProduct.
 */
export type ModCategory = 'frenzy' | 'boost' | 'event';

export interface ActiveModifier {
  label: string;
  stat: ModStat;
  value: number;
  /** sim seconds left */
  left: number;
  category: ModCategory;
}

/**
 * Phase 4 E06.6 / Phase 5 E15: every temporary boost, composed in one place with one stacking policy:
 *
 * - **same category → the strongest** (Solar Surge ×3 and the Megaflower's Solar Burst ×3 give ×3, not ×9);
 * - **across categories → the product, capped** at TUNING.modifiers.maxProduct (Solar Supernova ×10 with a
 *   Solar Surge ×3 gives ×20, not ×30);
 * - **applied once, to the baseline** rate (ProductionSystem multiplies its sustained totals by the result; a
 *   boosted rate is never boosted again, and rewards priced "in seconds of income" use the sustained rate).
 *
 * Pulse reach is additive (extra tiers): the strongest bonus wins. Everything is derived from saved state each
 * call, so a boost ends exactly when its timer does, also after pause or reload.
 */
export class Modifiers {
  constructor(private sim: Sim) {}

  /** Cached per sim time and boost state: solar output asks for every panel on every tick (E11 perf). */
  private cache?: { time: number; frenzy: number | undefined; buffs: unknown; nBuffs: number; event: unknown; list: ActiveModifier[]; total: Record<string, number> };

  private current() {
    const s = this.sim;
    const c = this.cache;
    const ev = s.state.events?.active;
    // Valid for this sim instant while the boosts themselves are unchanged (no allocation on a hit).
    if (c && c.time === s.time && c.frenzy === s.state.frenzy?.until && c.buffs === s.state.buffs && c.nBuffs === s.state.buffs.length && c.event === ev) return c;
    const list = this.build();
    return (this.cache = { time: s.time, frenzy: s.state.frenzy?.until, buffs: s.state.buffs, nBuffs: s.state.buffs.length, event: ev, list, total: Modifiers.compose(list) });
  }

  /** The stacking policy, pure (tests call it directly): per stat, strongest per category, product across, capped. */
  static compose(list: readonly Pick<ActiveModifier, 'stat' | 'value' | 'category'>[]): Record<string, number> {
    const best = new Map<string, number>();
    for (const m of list) {
      const k = `${m.stat}|${m.category}`;
      best.set(k, Math.max(best.get(k) ?? -Infinity, m.value));
    }
    const total: Record<string, number> = {};
    for (const [k, v] of best) {
      const stat = k.split('|')[0];
      if (stat === 'pulse') total.pulse = Math.max(total.pulse ?? 0, v);
      else total[stat] = Math.min(TUNING.modifiers.maxProduct, (total[stat] ?? 1) * Math.max(1, v));
    }
    return total;
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
      out.push({ label: 'Bloom Frenzy', stat: 'biomass', value: F.biomassMult, left, category: 'frenzy' });
      out.push({ label: 'Bloom Frenzy', stat: 'drones', value: F.droneSpeedMult, left, category: 'frenzy' });
      out.push({ label: 'Bloom Frenzy', stat: 'pulse', value: F.pulseTierBonus, left, category: 'frenzy' });
    }
    const surge = s.state.buffs.find((b) => b.type === 'solarFrenzy');
    if (surge) out.push({ label: 'Solar Surge', stat: 'solar', value: TUNING.cat.frenzyMult, left: surge.until - s.time, category: 'boost' });
    // Phase 5 E14: the Solar Megaflower's burst (same category as Solar Surge: the strongest wins, never a product).
    const burst = s.state.buffs.find((b) => b.type === 'megaflower' && b.until > s.time);
    if (burst) out.push({ label: 'Solar Burst', stat: 'solar', value: TUNING.super.megaflower.mult, left: burst.until - s.time, category: 'boost' });
    // Phase 5 E15: world events.
    for (const m of s.events.modifiers()) out.push(m);
    return out;
  }

  private total(stat: ModStat): number {
    return this.current().total[stat] ?? (stat === 'pulse' ? 0 : 1);
  }

  biomassMult(): number {
    return this.total('biomass');
  }

  solarMult(): number {
    return this.total('solar');
  }

  /** Phase 5 E15: Super Rain. */
  waterMult(): number {
    return this.total('water');
  }

  droneSpeedMult(): number {
    return this.total('drones');
  }

  /** Extra pulse reach tiers (added, then clamped to the last tier). */
  pulseTierBonus(): number {
    return this.total('pulse');
  }
}
