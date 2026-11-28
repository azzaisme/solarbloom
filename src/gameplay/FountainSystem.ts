import { PARK } from '../core/Areas';
import type { MaterialId } from '../core/types';
import { REGIONS } from '../data/oldcity';
import { TIERS, type TierDef } from '../data/salvage';
import type { Sim } from './Sim';

/**
 * E21.6 (§5): the fountain's tiers. Each tier is a delivery (handed in a bit at a time; part deliveries are saved in
 * `salvage.delivered`) plus an "also needs" condition (park tiles restored, or landmarks awake). When both are done
 * the fountain advances: it grants the tier's ability, unlocks its recipes (BuildSystem reads the tier), raises the
 * stack limit (Inventory reads the tier) and emits `fountain.tier`. Tier 1 wakes the park (water returns): the
 * park clears and the ring-1 regions appear, still sealed behind their dead hedges.
 */
export class FountainSystem {
  constructor(private sim: Sim) {}


  get tier(): number {
    return this.sim.state.salvage?.tier ?? 0;
  }

  /** The next tier to deliver toward (undefined after the Great Bloom). */
  next(): TierDef | undefined {
    return TIERS[this.tier];
  }

  /** Units of a material handed in toward the next tier. */
  given(m: MaterialId): number {
    return this.sim.state.salvage?.delivered[m] ?? 0;
  }

  /** Units of a material still wanted for the next tier. */
  remaining(m: MaterialId): number {
    const t = this.next();
    return Math.max(0, ((t?.delivery[m] as number | undefined) ?? 0) - this.given(m));
  }

  /** Landmarks awake (Old City regions cleared). */
  landmarksAwake(): number {
    return REGIONS.filter((r) => this.sim.areas.fog(r.id) === 'cleared').length;
  }

  /** The "also needs" condition as a label with progress. */
  condition(t: TierDef = this.next()!): { label: string; have: number; need: number; done: boolean } {
    if (t.needs.parkTiles !== undefined) {
      const have = this.sim.areas.counts(PARK).restored;
      return { label: 'Green ground in the park', have, need: t.needs.parkTiles, done: have >= t.needs.parkTiles };
    }
    const have = this.landmarksAwake();
    const need = t.needs.landmarks ?? 0;
    return { label: 'Landmarks awake', have, need, done: have >= need };
  }

  /** Is the delivery for the next tier complete (materials and items)? */
  delivered(): boolean {
    const t = this.next();
    if (!t) return false;
    for (const [k, v] of Object.entries(t.delivery)) if (k !== 'biomass' && this.given(k as MaterialId) < (v ?? 0)) return false;
    const items = this.sim.state.salvage?.items ?? [];
    return (t.items ?? []).every((i) => items.includes(i));
  }

  canAdvance(): boolean {
    const t = this.next();
    return !!t && this.delivered() && this.condition(t).done;
  }

  /**
   * Hands in up to `n` of a material toward the next tier (never more than is still wanted), from the backpack
   * first, then the store (the fountain is a way into it). Returns how many went in.
   */
  deliver(m: MaterialId, n = Infinity): number {
    const s = this.sim;
    if (!this.next()) return 0;
    const k = Math.min(n, this.remaining(m), s.inventory.available(m));
    if (k <= 0) return 0;
    if (!s.inventory.pay({ [m]: k })) return 0;
    const d = s.state.salvage!.delivered;
    d[m] = (d[m] ?? 0) + k;
    s.bus.emit('fountain.delivered', { material: m, n: k });
    this.check();
    return k;
  }

  /** "Give all I have": every material still wanted. Returns the units handed in. */
  giveAll(): number {
    const t = this.next();
    if (!t) return 0;
    let n = 0;
    for (const k of Object.keys(t.delivery)) if (k !== 'biomass') n += this.deliver(k as MaterialId);
    return n;
  }

  /** Advances when it can (after a delivery, or once the condition is met later). */
  check(): boolean {
    if (!this.canAdvance()) return false;
    this.advance();
    return true;
  }

  /** Reaches the next tier: its ability, recipes and stacks; tier 1 wakes the park. */
  private advance() {
    const s = this.sim;
    const sv = s.state.salvage!;
    const t = this.next()!;
    sv.tier = t.tier;
    sv.delivered = {};
    if (t.ability && !sv.abilities.includes(t.ability)) sv.abilities.push(t.ability);
    if (t.tier === 1) {
      const p = s.state.progression;
      p.coreActivated = true;
      p.coreActivatedAt = s.time;
      s.areas.clear(PARK, true);
    }
    s.bus.emit('fountain.tier', { tier: t.tier });
  }

  /** Per tick: a tier whose delivery is in waits for its condition. Cheap: only checks a finished delivery. */
  tick() {
    if (this.next() && this.delivered() && this.condition().done) this.advance();
  }
}
