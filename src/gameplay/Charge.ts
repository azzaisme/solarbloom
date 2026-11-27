import { CHARGE, type EdibleDef } from '../data/charge';
import type { ChargeState } from '../core/types';
import { PARK } from '../core/Areas';
import { distToFootprint } from '../core/Grid';
import { GROUND } from '../core/GameState';
import { PARK_SET } from '../data/oldcity';
import type { Sim } from './Sim';

/** What costs charge. */
export type ChargeUse = 'pulse' | 'sprint' | 'pry' | 'hover' | 'climb' | 'glide';
/** Where charge comes back from (E23.3's chargers call `recharge(amount, 'charger')`). */
export type ChargeSource = 'eat' | 'charger' | 'fire' | 'bench' | 'home' | 'sleep' | 'cat' | 'sun' | 'other';

/**
 * E23.2.1 (#371): bloombot's charge, the only meter on screen.
 *
 * Cozy wins every tie: walking never costs charge, and at zero bloombot walks on (a little slower) but can't
 * pulse or use abilities. Nothing is lost and bloombot is never stranded. A pulse with a little charge left
 * always fires (the meter just bottoms out at zero).
 *
 * Refill: eat biomass or food anywhere (slow, uses an item), rest at home (stand still by the fountain or the
 * house: a trickle, always there), meditate at a charger (E23.3.3 calls `recharge`), sit on a bench (a trickle,
 * E23.2.3) or sleep in the house (`sleep`, full, E23.7.1.3).
 */
export class ChargeSystem {
  /** the meal in progress (never saved: closing the game mid-bite only loses the rest of that bite) */
  private meal?: { item: EdibleDef; left: number; perSecond: number };
  /** where bloombot stood last tick, and how long it has stood still (for resting at home) */
  private lastAt?: { x: number; z: number };
  private still = 0;
  /** #784: the last source that gave charge, and how long it still counts as charging (never saved) */
  private flow?: { source: ChargeSource; left: number };

  constructor(private sim: Sim) {}

  private get st(): ChargeState {
    const s = this.sim.state;
    return (s.charge ??= { value: this.max });
  }

  /** A full charge (research's battery cells make it bigger). */
  get max(): number {
    return CHARGE.max + CHARGE.cellCapacity * (this.sim.state.charge?.cells ?? 0);
  }

  /** The charge now, 0 to `max`. Full when off. */
  value(): number {
    return Math.max(0, Math.min(this.max, this.st.value));
  }

  /** The charge as a share of full, 0 to 1. */
  get share(): number {
    return this.value() / this.max;
  }

  /** Out of charge: the low-power walk, no pulses or abilities. */
  get empty(): boolean {
    return this.value() <= 1e-6;
  }

  /** Running low (the meter shows it). */
  get low(): boolean {
    return this.share <= CHARGE.lowShare;
  }

  /** The cost of one use (pulse, an ability) or of one second of sprinting, after research's efficiency. */
  cost(use: ChargeUse): number {
    const base = use === 'pulse' ? CHARGE.pulse : use === 'sprint' ? CHARGE.sprintPerSecond : (CHARGE.ability[use] ?? 0);
    const eff = this.sim.state.charge?.efficiency ?? 0;
    // E23.6.2: "Longer stride" research takes a share off sprinting's charge
    const stride = use === 'sprint' ? 1 - (this.sim.research?.effect('sprint') ?? 0) : 1;
    // #622: Steady charge, from greening the park, takes a little off everything
    const park = this.sim.parkGrowth?.chargeFactor ?? 1;
    // #625: Float along (Sluice) for running, Starlight (Vega) at night
    const knack = this.sim.knacks?.chargeFactor(use) ?? 1;
    return base * Math.pow(1 - CHARGE.efficiencyStep, eff) * stride * park * knack;
  }

  /** May bloombot do this now? Anything is allowed with charge left, however little (it bottoms out at zero). */
  canUse(use: ChargeUse): boolean {
    return this.cost(use) <= 0 || !this.empty;
  }

  /** Pays for one use (or `seconds` of sprinting). False, and nothing paid, when out of charge. */
  use(use: ChargeUse, seconds = 1): boolean {
    const c = this.cost(use) * (use === 'sprint' ? seconds : 1);
    if (c <= 0) return true;
    if (this.empty) return false;
    this.set(this.value() - c);
    return true;
  }

  /** Adds charge (chargers, benches, meals). Returns what was actually added (it stops at full). */
  recharge(amount: number, source: ChargeSource = 'other'): number {
    if (amount <= 0) return 0;
    const before = this.value();
    this.set(before + amount);
    const got = this.value() - before;
    // #784: the player sees it charging (sleep fills at once, behind the night's fade: nothing to show)
    if (got > 0 && source !== 'sleep') this.flow = { source, left: CHARGE.feedback.holdSeconds };
    if (got > 0 && this.value() >= this.max - 1e-6 && before < this.max - 1e-6) this.sim.bus.emit('charge.full', { source });
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

  /** Units of an edible bloombot carries in its backpack (E23.5.1's farm items). */
  carried(id: EdibleDef['id']): number {
    const pack = this.sim.state.salvage?.pack as Record<string, number | undefined> | undefined;
    return pack?.[id] ?? 0;
  }

  private takeOne(id: EdibleDef['id']): boolean {
    const pack = this.sim.state.salvage?.pack as Record<string, number | undefined> | undefined;
    if (pack && (pack[id] ?? 0) > 0) {
      pack[id]! -= 1;
      if (!pack[id]) delete pack[id];
      this.sim.bus.emit('pack.changed', {});
      return true;
    }
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
  eat(id?: EdibleDef['id']): EdibleDef | 'full' | 'none' | 'busy' {
    if (this.meal) return 'busy';
    if (this.value() >= this.max - 1e-6) return 'full';
    const item = CHARGE.edibles.find((e) => (id ? e.id === id : true) && this.carried(e.id) > 0);
    if (!item || !this.takeOne(item.id)) return 'none';
    this.meal = { item, left: item.charge, perSecond: item.charge / item.seconds };
    this.sim.bus.emit('charge.eat', { item: item.id });
    return item;
  }

  /** Is bloombot standing at home (by the park's fountain or the house) right now? */
  atHome(at = this.sim.bot): boolean {
    if (at && this.sim.house?.isInside(at.roofId)) return true; // #782: inside the house is home too
    if (!at || at.roofId !== GROUND) return false;
    const R = CHARGE.home.radius;
    const x = Math.floor(at.x);
    const z = Math.floor(at.z);
    const shed = PARK_SET.shed;
    if (distToFootprint(x, z, shed.x, shed.z, shed.size) <= R) return true;
    const f = this.sim.state.machines.find((m) => m.type === 'core' && this.sim.areas.areaOf(m) === PARK);
    return !!f && distToFootprint(x, z, f.x, f.z, f.size) <= R;
  }

  /**
   * Resting at home: standing still there (not just passing through) for a moment. #784: not while sitting on a bench
   * or at a Charger by it: the seat charges Bloombot then, at its own speed, and the trickle never piles on top.
   */
  get resting(): boolean {
    return !this.sim.rest?.sitting && this.still >= CHARGE.home.stillSeconds && this.atHome();
  }

  /**
   * #784: where charge is coming from right now (a bench, the fountain, a Charger, a snack, the sun...), or
   * undefined when nothing is charging Bloombot. The game shows it: the meter glows, sparkles rise from Bloombot.
   */
  get chargingFrom(): ChargeSource | undefined {
    return this.flow?.source;
  }

  tick(dt: number) {
    if (this.flow && (this.flow.left -= dt) <= 0) this.flow = undefined;
    const m = this.meal;
    if (m) {
      const bite = Math.min(m.left, m.perSecond * dt);
      // what truly arrived (the charge is kept to 3 decimals): the meal gives all of its charge, never a hair less
      const got = this.recharge(bite, 'eat');
      m.left -= got;
      if (m.left <= 5e-4 || this.value() >= this.max - 1e-6) this.meal = undefined;
    }
    // home: a trickle back while bloombot stands still by the fountain or the house
    const at = this.sim.bot;
    const moved = !at || !this.lastAt || Math.hypot(at.x - this.lastAt.x, at.z - this.lastAt.z) > 0.02;
    this.still = moved ? 0 : this.still + dt;
    this.lastAt = at ? { x: at.x, z: at.z } : undefined;
    if (this.resting) this.recharge(CHARGE.home.perSecond * dt * (this.sim.knacks?.rest ?? 1), 'home'); // #625 Easy rest (Gable)
    else if (this.soaking) this.recharge(this.sunSoakRate() * dt, 'sun');
  }

  /** #624 Sun soak: charge a second it takes in now, standing still (the research level times the sun's strength). */
  sunSoakRate(): number {
    const per = this.sim.upgrades?.sunSoak ?? 0;
    return per > 0 ? per * (this.sim.clock?.solarFactor() ?? 0) : 0;
  }

  /** #624 Sun soak: standing still in the sun, charging (never at home, whose rest is quicker already, nor sitting: the seat charges then). */
  get soaking(): boolean {
    return !!this.sim.bot && !this.sim.rest?.sitting && this.still >= CHARGE.home.stillSeconds && !this.resting && this.sunSoakRate() > 1e-6 && this.value() < this.max - 1e-6;
  }

  /** Bloombot can always walk (at zero, the low-power walk). For the gentle-failure suite (E23.10). */
  canWalk(): boolean {
    return true;
  }

  /** Test hooks for the gentle-failure suite (E23.10): run the charge out, or fill it. */
  drainForTest() {
    this.set(0);
  }
  refillForTest() {
    this.set(this.max);
  }
}
