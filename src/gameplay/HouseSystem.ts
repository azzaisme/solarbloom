import type { MaterialId } from '../core/types';
import { HOUSE, HOUSE_GROWTH, type HouseLevel } from '../data/oldcity';
import type { Sim } from './Sim';

/**
 * #782 (E21 §11): Bloombot's house grows from the ruined shed (level 0) through the Shed, the Cottage and the House to
 * the Home (level 4). Each level is a delivery handed in at the house a bit at a time, like the fountain's steps: part
 * deliveries are saved in `salvage.houseDelivered`, and once all of it is in the house grows (`salvage.house`) and
 * emits `house.level`. It opens at the fountain's first step. A save from before this keeps level 0 and nothing
 * handed in, so it loads exactly as it was.
 */
export class HouseSystem {
  constructor(private sim: Sim) {}

  /** 0 = the ruined shed, 1 Shed … 4 Home. */
  get level(): number {
    return this.sim.state.salvage?.house ?? 0;
  }

  /** The level reached (undefined for the ruined shed). */
  current(): HouseLevel | undefined {
    return HOUSE[this.level - 1];
  }

  /** The next level to grow toward (undefined once it is the Home). */
  next(): HouseLevel | undefined {
    return HOUSE[this.level];
  }

  /** Can the house be mended yet (the fountain's first step reached)? */
  open(): boolean {
    return (this.sim.state.salvage?.tier ?? 0) >= HOUSE_GROWTH.opensAtStep;
  }

  /** Has the house an inside to go into (mended at least once)? */
  hasInside(): boolean {
    return this.level >= 1;
  }

  /** The inside, tiles a side (0 before the house is mended). */
  room(): number {
    return this.current()?.room ?? 0;
  }

  /** How many decorations the inside holds at this level. */
  decorMax(): number {
    return this.current()?.decor ?? 0;
  }

  /** Units of a material handed in toward the next level. */
  given(m: MaterialId): number {
    return this.sim.state.salvage?.houseDelivered?.[m] ?? 0;
  }

  /** Units still wanted toward the next level. */
  remaining(m: MaterialId): number {
    const n = this.next();
    return Math.max(0, ((n?.delivery[m] as number | undefined) ?? 0) - this.given(m));
  }

  /** What the next level wants, as have-handed-in of need, in the data's order. */
  wants(): { id: MaterialId; given: number; need: number }[] {
    const n = this.next();
    if (!n) return [];
    return (Object.entries(n.delivery) as [MaterialId, number][]).map(([id, need]) => ({ id, given: Math.min(need, this.given(id)), need }));
  }

  /** Is everything for the next level in? */
  delivered(): boolean {
    const n = this.next();
    return !!n && this.wants().every((w) => w.given >= w.need);
  }

  /** Why nothing can be handed in now, or undefined. */
  problem(): string | undefined {
    if (!this.next()) return 'The house is a home now: it has grown all it can';
    if (!this.open()) return 'The house can be mended once the fountain flows again';
    if (!this.wants().some((w) => w.given < w.need && this.sim.inventory.available(w.id) > 0)) return 'Bring what the house needs first';
    return undefined;
  }

  /**
   * Hands in up to `n` of a material toward the next level (never more than is still wanted), from the backpack
   * first, then your chests. Returns how many went in. The house grows as soon as the last of it is in.
   */
  deliver(m: MaterialId, n = Infinity): number {
    const s = this.sim;
    const sv = s.state.salvage;
    if (!sv || !this.next() || !this.open()) return 0;
    const k = Math.min(n, this.remaining(m), s.inventory.available(m));
    if (k <= 0) return 0;
    if (!s.inventory.pay({ [m]: k })) return 0;
    const d = (sv.houseDelivered ??= {});
    d[m] = (d[m] ?? 0) + k;
    s.bus.emit('house.delivered', { material: m, n: k });
    this.check();
    return k;
  }

  /** "Give all I have": every material still wanted. Returns the units handed in. */
  giveAll(): number {
    let n = 0;
    for (const w of this.wants()) n += this.deliver(w.id);
    return n;
  }

  /** Grows the house when everything is in. True when it grew. */
  check(): boolean {
    const sv = this.sim.state.salvage;
    if (!sv || !this.open() || !this.delivered()) return false;
    sv.house = this.level + 1;
    delete sv.houseDelivered;
    this.sim.bus.emit('house.level', { level: sv.house });
    return true;
  }
}
