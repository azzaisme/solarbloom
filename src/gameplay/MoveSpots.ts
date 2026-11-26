import type { AbilityId, ItemId } from '../core/types';
import { inRect, moveLandAt, setPieceAt } from '../core/OldCityLayout';
import { levelAt } from '../core/Height';
import { MOVE_TRIPS, STASHES, VAULTS, type MoveTripDef, type StashDef, type VaultDef } from '../data/moveSpots';
import { ABILITIES } from '../data/salvage';
import { itemDef } from '../data/items';
import type { ItemCost } from '../data/crafting';
import type { Sim } from './Sim';

/** A trip Bloombot can take from where it stands: one from MOVE_TRIPS, or up or down a roof's wall. */
export interface MoveTrip {
  id: string;
  move: AbilityId;
  verb: string;
  name: string;
  to: [number, number];
  back?: boolean;
}

/**
 * E25 (#626): the places the level II moves are for. Each move learned at the fountain gets a second level, worked
 * out at the crafting table (Research `moveLevel`), and places out in the city that need it:
 * - Pry II forces the sealed vaults (hold Interact, VAULTS) and takes what is inside;
 * - Hover II goes from the jetty's end out to the sandbar;
 * - Climb II climbs straight up a low wall onto the ruins' roofs (any roof in MOVE_LAND, from the cell beside it);
 * - Glide II glides from the east cliff out to the old pier, and from there down to the sandbar.
 * Every place a trip leads has a stash to open, once. The way back (`back`) needs nothing, so Bloombot is never
 * stranded. What was opened is saved in `salvage.caches`, beside the city's caches.
 */
export class MoveSpots {
  constructor(private sim: Sim) {}

  /** How far Bloombot has a move (0, 1 or 2). */
  level(a: AbilityId): number {
    return this.sim.research.moveLevel(a);
  }

  /** Has this vault or stash been opened? */
  opened(id: string): boolean {
    return !!this.sim.state.salvage?.caches.includes(id);
  }

  /** The vault on a cell, if there is one still shut. */
  vaultAt(x: number, z: number): VaultDef | undefined {
    const sp = setPieceAt(x, z);
    return sp?.kind === 'vault' && !this.opened(sp.vault.id) ? sp.vault : undefined;
  }

  /** The stash on a cell, if there is one still shut. */
  stashAt(x: number, z: number): StashDef | undefined {
    const sp = setPieceAt(x, z);
    return sp?.kind === 'stash' && !this.opened(sp.stash.id) ? sp.stash : undefined;
  }

  private outOfCharge(a: AbilityId): string | undefined {
    return this.sim.charge.canUse(a) ? undefined : 'Out of Charge: press {eat} for a snack, or sit on a bench to rest.';
  }

  /** Why a vault can't be forced now, or undefined. */
  vaultProblem(v: VaultDef): string | undefined {
    if (this.opened(v.id)) return 'Already open';
    const lv = this.level('pry');
    if (lv === 0) return 'A heavy iron door, shut tight. Bloombot has to learn to pry at the fountain first.';
    if (lv === 1) return 'This door is too heavy to pry open yet. The workbench beside the house can work out Pry II.';
    return this.outOfCharge('pry');
  }

  /** Forces a vault (after the hold): what is inside goes in the backpack. */
  openVault(id: string): ItemCost | undefined {
    const v = VAULTS.find((q) => q.id === id);
    if (!v || this.vaultProblem(v)) return undefined;
    this.sim.charge.use('pry');
    return this.take(v.id, v.x, v.z, v.gives);
  }

  /** Opens a stash: what is in it goes in the backpack. */
  openStash(id: string): ItemCost | undefined {
    const s = STASHES.find((q) => q.id === id);
    if (!s || this.opened(s.id)) return undefined;
    return this.take(s.id, s.x, s.z, s.gives);
  }

  /** Gives a vault's or stash's things (anything over a full stack goes to the store), once. */
  private take(id: string, x: number, z: number, gives: ItemCost): ItemCost {
    const inv = this.sim.inventory;
    this.sim.state.salvage!.caches.push(id);
    for (const [k, n] of Object.entries(gives) as [ItemId, number][]) if (n) inv.addToStore(k, inv.add(k, n));
    this.sim.bus.emit('cache.opened', { cacheId: id, x, z });
    return gives;
  }

  /**
   * The trip Bloombot can take from the cell it stands on (`at`), facing `front`. `walkable` says whether Bloombot
   * could stand on a cell (the game's Walker). Climbing: a roof one level up in front, or one level down off a roof.
   */
  tripFrom(at: [number, number], front: [number, number], walkable: (x: number, z: number) => boolean): MoveTrip | undefined {
    const [ax, az] = at;
    const [fx, fz] = front;
    const t = MOVE_TRIPS.find((q) => inRect(q.from, ax, az) && inRect(q.at, fx, fz));
    if (t) return t;
    if (!walkable(fx, fz)) return undefined;
    const here = levelAt(ax, az);
    const there = levelAt(fx, fz);
    const up = moveLandAt(fx, fz);
    if (up?.ground === 'roof' && there === here + 1) return { id: `climb:${up.id}`, move: 'climb', verb: 'Climb up onto', name: up.name, to: [fx, fz] };
    const on = moveLandAt(ax, az);
    if (on?.ground === 'roof' && there === here - 1 && moveLandAt(fx, fz) !== on) return { id: `down:${on.id}:${fx},${fz}`, move: 'climb', verb: 'Climb down', name: '', to: [fx, fz], back: true };
    return undefined;
  }

  /** Why a trip can't be taken now, or undefined. The way back always can. */
  tripProblem(t: MoveTrip | MoveTripDef): string | undefined {
    if (t.back) return undefined;
    const lv = this.level(t.move);
    const name = ABILITIES[t.move].name;
    const learn = `Bloombot has to learn ${name} at the fountain first.`;
    const workshop = `The workbench beside the house can work out ${name} II.`;
    if (t.move === 'hover') {
      if (lv === 0) return `Too far to wade. ${learn}`;
      if (lv === 1) return `Too far to hover yet. ${workshop}`;
    } else if (t.move === 'glide') {
      if (lv === 0) return `Too far to jump. ${learn}`;
      if (lv === 1) return `Too far to glide yet. ${workshop}`;
    } else if (t.move === 'climb') {
      if (lv === 0) return `Too high to reach. ${learn}`;
      if (lv === 1) return `There's no ladder here. ${workshop}`;
    }
    return this.outOfCharge(t.move);
  }

  /** Takes a trip's charge. False when it can't be taken (the game then moves nothing). */
  takeTrip(t: MoveTrip): boolean {
    if (this.tripProblem(t)) return false;
    if (!t.back) this.sim.charge.use(t.move);
    return true;
  }

  /** "24 Copper, 6 Wire and 1 Battery cell", for the line that says what was inside. */
  static words(gives: ItemCost): string {
    const xs = Object.entries(gives).filter(([, n]) => n).map(([k, n]) => `${n} ${itemDef(k as ItemId).name}`);
    return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? '');
  }
}
