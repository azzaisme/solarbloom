import { GROUND } from '../core/GameState';
import { PARK } from '../core/Areas';
import { distToFootprint } from '../core/Grid';
import type { ItemId, SalvageState } from '../core/types';
import { PARK_SET } from '../data/oldcity';
import { PACK, STORE, type MaterialCost } from '../data/salvage';
import { ITEM_IDS, itemDef } from '../data/items';
import type { Sim } from './Sim';

/** Where bloombot stands (layer cell units). */
export interface BotAt {
  roofId: string;
  x: number;
  z: number;
}

/**
 * E21.1 (§1, §2): what bloombot carries and the city's shared store. Whole numbers; the backpack has a stack
 * limit per material (from the fountain tier and the Pack Frame), the store none. E23.5.1: biomass, food,
 * compost and fertiliser are items here like any material.
 */
export class Inventory {
  constructor(private sim: Sim) {}


  private get sv(): SalvageState {
    return this.sim.state.salvage!;
  }

  /** Units of a material in the backpack. */
  count(m: ItemId): number {
    return this.sim.state.salvage?.pack[m] ?? 0;
  }

  /** Units of a material in the store. */
  stored(m: ItemId): number {
    return this.sim.state.salvage?.store[m] ?? 0;
  }

  /** The stack limit: 40, then 60, 80 and 120 at fountain tiers 2, 3 and 4; the Pack Frame adds 40. */
  stackLimit(): number {
    const tier = Math.min(PACK.stack.length - 1, this.sv.tier);
    return PACK.stack[tier] + (this.sv.blueprints.includes('packFrame') ? PACK.packFrame : 0) + (this.sim.research?.effect('backpack') ?? 0);
  }

  /** Room left in a material's stack. */
  room(m: ItemId): number {
    return Math.max(0, this.stackLimit() - this.count(m));
  }

  private set(bag: 'pack' | 'store', m: ItemId, n: number) {
    if (n > 0) this.sv[bag][m] = n;
    else delete this.sv[bag][m];
  }

  /** Puts units in the backpack; returns how many did not fit (they stay where they were). */
  add(m: ItemId, n: number): number {
    if (n <= 0) return n;
    const fit = Math.min(Math.floor(n), this.room(m));
    if (fit > 0) {
      this.set('pack', m, this.count(m) + fit);
      this.sim.bus.emit('pack.changed', { material: m, delta: fit });
    }
    const left = n - fit;
    if (left > 0) this.sim.bus.emit('pack.full', { material: m, left });
    return left;
  }

  /** Takes units out of the backpack (all or nothing). */
  take(m: ItemId, n: number): boolean {
    if (n <= 0) return n <= 0;
    if (this.count(m) < n) return false;
    this.set('pack', m, this.count(m) - n);
    this.sim.bus.emit('pack.changed', { material: m, delta: -n });
    return true;
  }

  has(m: ItemId, n: number): boolean {
    return this.count(m) >= n;
  }

  /** Puts units straight into the store (overflow from refunds). */
  addToStore(m: ItemId, n: number) {
    if (n <= 0) return;
    this.set('store', m, this.stored(m) + Math.floor(n));
    this.sim.bus.emit('store.changed', { material: m, delta: Math.floor(n) });
  }

  /** Moves units from the backpack to the store (default: the whole stack). Returns how many moved. */
  deposit(m: ItemId, n = this.count(m), hand = true): number {
    const k = Math.min(Math.floor(n), this.count(m));
    if (k <= 0) return 0;
    this.set('pack', m, this.count(m) - k);
    this.set('store', m, this.stored(m) + k);
    this.sim.bus.emit('pack.changed', { material: m, delta: -k });
    this.sim.bus.emit('store.changed', { material: m, delta: k });
    if (hand) this.sim.bus.emit('store.moved', { material: m, n: k }); // E23.6.4: carried by hand
    return k;
  }

  /** Every material in the backpack into the store (one trip by hand, however many kinds). */
  depositAll(): number {
    let n = 0;
    let first: ItemId | undefined;
    for (const m of ITEM_IDS) {
      const k = this.deposit(m, this.count(m), false);
      if (k && !first) first = m;
      n += k;
    }
    if (first) this.sim.bus.emit('store.moved', { material: first, n }); // E23.6.4: one job by hand
    return n;
  }

  /** Moves units from the store to the backpack, as many as fit (default: a full stack). Returns how many moved. */
  withdraw(m: ItemId, n = this.stackLimit()): number {
    const k = Math.min(Math.floor(n), this.stored(m), this.room(m));
    if (k <= 0) return 0;
    this.set('store', m, this.stored(m) - k);
    this.set('pack', m, this.count(m) + k);
    this.sim.bus.emit('store.changed', { material: m, delta: -k });
    this.sim.bus.emit('pack.changed', { material: m, delta: k });
    this.sim.bus.emit('store.moved', { material: m, n: k }); // E23.6.4: carried by hand
    return k;
  }

  // ───────────── ways into the store ─────────────

  /**
   * Every way into the store, as footprints on the ground: the fountain, every woken landmark, the house's chest
   * (once the house is built) and every Storage Chest.
   */
  accessPoints(): { roofId: string; x: number; z: number; size: number }[] {
    const s = this.sim;
    const out: { roofId: string; x: number; z: number; size: number }[] = [];
    for (const m of s.machinesOfType('core')) {
      const id = s.areas?.areaOf(m);
      if (id === PARK || (id && s.areas.fog(id) === 'cleared')) out.push(m);
    }
    for (const m of s.machinesOfType('chest')) out.push(m);
    if (this.sv.house >= 1) {
      const sh = PARK_SET.shed;
      out.push({ roofId: GROUND, x: sh.x, z: sh.z, size: sh.size });
    }
    return out;
  }

  /** Is this spot within reach of the store (12 tiles of a way into it)? */
  nearStore(at: BotAt | undefined = this.sim.bot): boolean {
    if (!at) return false;
    const x = Math.floor(at.x);
    const z = Math.floor(at.z);
    return this.accessPoints().some((p) => p.roofId === at.roofId && distToFootprint(x, z, p.x, p.z, p.size) <= STORE.reach);
  }

  /** E23.6.4: supply crates within reach of a spot (nearest first): building takes from them after the backpack. */
  private crates(at: BotAt | undefined): string[] {
    return at ? (this.sim.automation?.cratesNear(at) ?? []).map((c) => c.id) : [];
  }

  private inCrates(m: ItemId, crates: string[]): number {
    let n = 0;
    for (const id of crates) n += this.sim.automation.count(id, m);
    return n;
  }

  /** What can go toward a cost of this material right now: the backpack, supply crates near by, and the store when near it. */
  available(m: ItemId, at: BotAt | undefined = this.sim.bot): number {
    return this.count(m) + this.inCrates(m, this.crates(at)) + (this.nearStore(at) ? this.stored(m) : 0);
  }

  /** The first part of a cost that can't be paid here, if any. */
  shortfall(cost: MaterialCost, at: BotAt | undefined = this.sim.bot): ItemId | undefined {
    const near = this.nearStore(at);
    const crates = this.crates(at);
    for (const [k, v] of Object.entries(cost) as [ItemId, number][]) {
      if (!v) continue;
      if (this.count(k) + this.inCrates(k, crates) + (near ? this.stored(k) : 0) < v) return k;
    }
    return undefined;
  }

  canPay(cost: MaterialCost, at: BotAt | undefined = this.sim.bot): boolean {
    return !this.shortfall(cost, at);
  }

  /**
   * Pays a cost: from the backpack first, then from supply crates near by (E23.6.4: a site couriers keep supplied
   * builds by itself), then from the store (only near a way into it). All or nothing.
   */
  pay(cost: MaterialCost, at: BotAt | undefined = this.sim.bot): boolean {
    if (!this.canPay(cost, at)) return false;
    const crates = this.crates(at);
    for (const [k, v] of Object.entries(cost) as [ItemId, number][]) {
      if (!v) continue;
      const fromPack = Math.min(v, this.count(k));
      if (fromPack) this.take(k, fromPack);
      let rest = v - fromPack;
      for (const id of crates) if (rest > 0) rest -= this.sim.automation.take(id, k, rest);
      if (rest > 0) {
        this.set('store', k, this.stored(k) - rest);
        this.sim.bus.emit('store.changed', { material: k, delta: -rest });
      }
    }
    return true;
  }

  /** Gives a cost back (removing a machine): to the backpack, anything over a stack to the store. */
  refund(cost: MaterialCost) {
    for (const [k, v] of Object.entries(cost) as [ItemId, number][]) if (v) this.addToStore(k, this.add(k, v));
  }

  /** "Copper 12/20" style label for a cost, part by part (for panels and the build tray). */
  describe(cost: MaterialCost, at: BotAt | undefined = this.sim.bot): { id: ItemId; name: string; icon: string; have: number; need: number }[] {
    return (Object.entries(cost) as [ItemId, number][])
      .filter(([, v]) => v)
      .map(([k, v]) => ({ id: k, name: itemDef(k).name, icon: itemDef(k).icon, have: this.available(k, at), need: v }));
  }
}
