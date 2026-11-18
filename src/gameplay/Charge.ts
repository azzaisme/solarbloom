import { CHARGE, type EdibleDef } from '../data/charge';
import type { ChargeState } from '../core/types';
import type { Sim } from './Sim';

/** What costs charge. */
export type ChargeUse = 'pulse' | 'sprint' | 'pry' | 'hover' | 'climb' | 'glide';
/** Where charge comes back from (E23.3's chargers call `recharge(amount, 'charger')`). */
export type ChargeSource = 'eat' | 'charger' | 'bench' | 'sleep' | 'other';

/**
 * E23.2.1 (#371): bloombot's charge, the only meter on screen. Old-city rules only: under classic rules it is
 * off, every cost is free and nothing here changes the game (so classic runs stay byte-identical).
 *
 * Cozy wins every tie: walking never costs charge, and at zero bloombot walks on (a little slower) but can't
 * pulse or use abilities. Nothing is lost and bloombot is never stranded. A pulse with a little charge left
 * always fires (the meter just bottoms out at zero).
 *
 * Refill: eat biomass or food anywhere (slow, uses an item), meditate at a charger (E23.3.3 calls
 * `recharge`), sit on a bench (a trickle, E23.2.3) or sleep in the house (`sleep`, full).
 */
export class ChargeSystem {
  /** the meal in progress (never saved: closing the game mid-bite only loses the rest of that bite) */
  private meal?: { item: EdibleDef; left: number; perSecond: number };

  constructor(private sim: Sim) {}

  /** Is there a charge at all (old-city rules)? */
  get on(): boolean {
    return this.sim.oldCity;
  }

  private get st(): ChargeState {
    const s = this.sim.state;
    return (s.charge ??= { value: this.max });
  }

  /** A full charge (research's battery cells make it bigger). */
  get max(): number {
    return CHARGE.max + CHARGE.cellCapacity * (this.sim.state.charge?.cells ?? 0);
  }

  /** The charge now, 0 to `max`. Full when off. */
  get value(): number {
    if (!this.on) return this.max;
    return Math.max(0, Math.min(this.max, this.st.value));
  }

  /** The charge as a share of full, 0 to 1. */
  get share(): number {
    return this.value / this.max;
  }

  /** Out of charge: the low-power walk, no pulses or abilities. */
  get empty(): boolean {
    return this.on && this.value <= 1e-6;
  }

  /** Running low (the meter shows it). */
  get low(): boolean {
    return this.on && this.share <= CHARGE.lowShare;
  }

  /** The cost of one use (pulse, an ability) or of one second of sprinting, after research's efficiency. */
  cost(use: ChargeUse): number {
    const base = use === 'pulse' ? CHARGE.pulse : use === 'sprint' ? CHARGE.sprintPerSecond : (CHARGE.ability[use] ?? 0);
    const eff = this.sim.state.charge?.efficiency ?? 0;
    return base * Math.pow(1 - CHARGE.efficiencyStep, eff);
  }

  /** May bloombot do this now? Anything is allowed with charge left, however little (it bottoms out at zero). */
  canUse(use: ChargeUse): boolean {
    return !this.on || this.cost(use) <= 0 || !this.empty;
  }

  /** Pays for one use (or `seconds` of sprinting). False, and nothing paid, when out of charge. */
  use(use: ChargeUse, seconds = 1): boolean {
    if (!this.on) return true;
    const c = this.cost(use) * (use === 'sprint' ? seconds : 1);
    if (c <= 0) return true;
    if (this.empty) return false;
    this.set(this.value - c);
    return true;
  }

  /** Adds charge (chargers, benches, meals). Returns what was actually added (it stops at full). */
  recharge(amount: number, source: ChargeSource = 'other'): number {
    if (!this.on || amount <= 0) return 0;
    const before = this.value;
    this.set(before + amount);
    const got = this.value - before;
    if (got > 0 && this.value >= this.max - 1e-6 && before < this.max - 1e-6) this.sim.bus.emit('charge.full', { source });
    return got;
  }

  /** Sleeping in the house: a full charge (E23.7 skips the night around it). */
  sleep(): void {
    this.recharge(this.max, 'sleep');
  }

  private set(v: number) {
    const was = this.st.value;
    this.st.value = Math.max(0, Math.min(this.max, Math.round(v * 1000) / 1000));
    if (was > 1e-6 && this.st.value <= 1e-6) this.sim.bus.emit('charge.empty', {});
  }

  // ───────── eating ─────────

  /** Units of an edible bloombot carries (biomass falls back to the old resource until E23.5 makes it an item). */
  carried(id: EdibleDef['id']): number {
    const pack = this.sim.state.salvage?.pack as Record<string, number | undefined> | undefined;
    const n = pack?.[id] ?? 0;
    if (n > 0 || id !== 'biomass') return n;
    return Math.floor(this.sim.econ.get('biomass').toNumber());
  }

  private takeOne(id: EdibleDef['id']): boolean {
    const pack = this.sim.state.salvage?.pack as Record<string, number | undefined> | undefined;
    if (pack && (pack[id] ?? 0) > 0) {
      pack[id]! -= 1;
      if (!pack[id]) delete pack[id];
      this.sim.bus.emit('pack.changed', {});
      return true;
    }
    if (id === 'biomass' && this.carried('biomass') >= 1) return this.sim.econ.spend({ biomass: 1 });
    return false;
  }

  /** Eating right now? */
  get eating(): EdibleDef | undefined {
    return this.meal?.item;
  }

  /**
   * Eats one unit: the best edible carried, or the one asked for. The charge arrives over the item's eating time.
   * 'full' when there's no room, 'none' when there's nothing to eat, 'busy' mid-bite.
   */
  eat(id?: EdibleDef['id']): EdibleDef | 'full' | 'none' | 'busy' | 'off' {
    if (!this.on) return 'off';
    if (this.meal) return 'busy';
    if (this.value >= this.max - 1e-6) return 'full';
    const item = CHARGE.edibles.find((e) => (id ? e.id === id : true) && this.carried(e.id) > 0);
    if (!item || !this.takeOne(item.id)) return 'none';
    this.meal = { item, left: item.charge, perSecond: item.charge / item.seconds };
    this.sim.bus.emit('charge.eat', { item: item.id });
    return item;
  }

  tick(dt: number) {
    const m = this.meal;
    if (!m || !this.on) return;
    const bite = Math.min(m.left, m.perSecond * dt);
    m.left -= bite;
    this.recharge(bite, 'eat');
    if (m.left <= 1e-6) this.meal = undefined;
  }
}
