import { GROUND } from '../core/GameState';
import { PARK } from '../core/Areas';
import { distToFootprint } from '../core/Grid';
import type { MaterialId, SalvageState } from '../core/types';
import { PARK_SET } from '../data/oldcity';
import { MATERIALS, MATERIAL_IDS, PACK, STORE, type MaterialCost } from '../data/salvage';
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
 * compost and fertiliser are items here like any material. Old-city rules only: under classic rules
 * there is no salvage state and every call here is inert.
 */
export class Inventory {
  constructor(private sim: Sim) {}

  /** Old-city rules (the inventory exists)? */
  get on(): boolean {
    return !!this.sim.state.salvage;
  }

  private get sv(): SalvageState {
    return this.sim.state.salvage!;
  }

  /** Units of a material in the backpack. */
  count(m: MaterialId): number {
    return this.sim.state.salvage?.pack[m] ?? 0;
  }

  /** Units of a material in the store. */
  stored(m: MaterialId): number {
    return this.sim.state.salvage?.store[m] ?? 0;
  }

  /** The stack limit: 40, then 60, 80 and 120 at fountain tiers 2, 3 and 4; the Pack Frame adds 40. */
  stackLimit(): number {
    if (!this.on) return 0;
    const tier = Math.min(PACK.stack.length - 1, this.sv.tier);
    return PACK.stack[tier] + (this.sv.blueprints.includes('packFrame') ? PACK.packFrame : 0);
  }

  /** Room left in a material's stack. */
  room(m: MaterialId): number {
    return Math.max(0, this.stackLimit() - this.count(m));
  }

  private set(bag: 'pack' | 'store', m: MaterialId, n: number) {
    if (n > 0) this.sv[bag][m] = n;
    else delete this.sv[bag][m];
  }

  /** Puts units in the backpack; returns how many did not fit (they stay where they were). */
  add(m: MaterialId, n: number): number {
    if (!this.on || n <= 0) return n;
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
  take(m: MaterialId, n: number): boolean {
    if (!this.on || n <= 0) return n <= 0;
    if (this.count(m) < n) return false;
    this.set('pack', m, this.count(m) - n);
    this.sim.bus.emit('pack.changed', { material: m, delta: -n });
    return true;
  }

  has(m: MaterialId, n: number): boolean {
    return this.count(m) >= n;
  }

  /** Puts units straight into the store (Reclaimers, overflow from refunds). */
  addToStore(m: MaterialId, n: number) {
    if (!this.on || n <= 0) return;
    this.set('store', m, this.stored(m) + Math.floor(n));
    this.sim.bus.emit('store.changed', { material: m, delta: Math.floor(n) });
  }

  /** Moves units from the backpack to the store (default: the whole stack). Returns how many moved. */
  deposit(m: MaterialId, n = this.count(m)): number {
    const k = Math.min(Math.floor(n), this.count(m));
    if (!this.on || k <= 0) return 0;
    this.set('pack', m, this.count(m) - k);
    this.set('store', m, this.stored(m) + k);
    this.sim.bus.emit('pack.changed', { material: m, delta: -k });
    this.sim.bus.emit('store.changed', { material: m, delta: k });
    return k;
  }

  /** Every material in the backpack into the store. */
  depositAll(): number {
    let n = 0;
    for (const m of MATERIAL_IDS) n += this.deposit(m);
    return n;
  }

  /** Moves units from the store to the backpack, as many as fit (default: a full stack). Returns how many moved. */
  withdraw(m: MaterialId, n = this.stackLimit()): number {
    const k = Math.min(Math.floor(n), this.stored(m), this.room(m));
    if (!this.on || k <= 0) return 0;
    this.set('store', m, this.stored(m) - k);
    this.set('pack', m, this.count(m) + k);
    this.sim.bus.emit('store.changed', { material: m, delta: -k });
    this.sim.bus.emit('pack.changed', { material: m, delta: k });
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
    if (this.on && this.sv.house >= 1) {
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

  /** What can go toward a cost of this material right now: the backpack, plus the store when near it. */
  available(m: MaterialId, at: BotAt | undefined = this.sim.bot): number {
    return this.count(m) + (this.nearStore(at) ? this.stored(m) : 0);
  }

  /** The first part of a cost that can't be paid here, if any. */
  shortfall(cost: MaterialCost, at: BotAt | undefined = this.sim.bot): MaterialId | undefined {
    const near = this.nearStore(at);
    for (const [k, v] of Object.entries(cost) as [MaterialId, number][]) {
      if (!v) continue;
      if (this.count(k) + (near ? this.stored(k) : 0) < v) return k;
    }
    return undefined;
  }

  canPay(cost: MaterialCost, at: BotAt | undefined = this.sim.bot): boolean {
    return this.on && !this.shortfall(cost, at);
  }

  /** Pays a cost: from the backpack first, then from the store (only near a way into it). All or nothing. */
  pay(cost: MaterialCost, at: BotAt | undefined = this.sim.bot): boolean {
    if (!this.canPay(cost, at)) return false;
    for (const [k, v] of Object.entries(cost) as [MaterialId, number][]) {
      if (!v) continue;
      const fromPack = Math.min(v, this.count(k));
      if (fromPack) this.take(k, fromPack);
      const rest = v - fromPack;
      if (rest > 0) {
        this.set('store', k, this.stored(k) - rest);
        this.sim.bus.emit('store.changed', { material: k, delta: -rest });
      }
    }
    return true;
  }

  /** Gives a cost back (removing a machine): to the backpack, anything over a stack to the store. */
  refund(cost: MaterialCost) {
    for (const [k, v] of Object.entries(cost) as [MaterialId, number][]) if (v) this.addToStore(k, this.add(k, v));
  }

  /** "Copper 12/20" style label for a cost, part by part (for panels and the build tray). */
  describe(cost: MaterialCost, at: BotAt | undefined = this.sim.bot): { id: MaterialId; name: string; icon: string; have: number; need: number }[] {
    return (Object.entries(cost) as [MaterialId, number][])
      .filter(([, v]) => v)
      .map(([k, v]) => ({ id: k, name: MATERIALS[k].name, icon: MATERIALS[k].icon, have: this.available(k, at), need: v }));
  }
}
