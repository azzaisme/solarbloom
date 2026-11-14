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

  /** Boosts running right now, for the HUD. */
  list(): ActiveModifier[] {
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
    return out;
  }

  private strongest(stat: ActiveModifier['stat'], base = 1): number {
    let v = base;
    for (const m of this.list()) if (m.stat === stat) v = Math.max(v, m.value);
    return v;
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
