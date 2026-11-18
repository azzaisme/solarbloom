import { big, ceilBig, Decimal, fmt, ZERO, type BigLike } from './Big';
import type { Amounts, CappedKind, Caps, Cost, ResourceKind } from './types';

export const KINDS: ResourceKind[] = ['energy', 'water', 'biomass'];
/** Phase 5 E12: only energy and water have storage. Biomass is uncapped. */
export const CAPPED: CappedKind[] = ['energy', 'water'];

export const isCapped = (k: ResourceKind): k is CappedKind => k !== 'biomass';

/**
 * Resource arithmetic. Invariants: every balance is a finite, non-negative Decimal; energy and water never
 * exceed their cap; biomass has no cap. `spend` is all-or-nothing.
 */
export class Economy {
  /** Everything spent so far this session, per resource (the HUD shows spending per minute from it). */
  readonly spent: Amounts = { energy: new Decimal(0), water: new Decimal(0), biomass: new Decimal(0) };
  /** Phase 5 E12: everything banked, and everything lost to a full store, this session (the HUD's breakdown). */
  readonly earned: Amounts = { energy: new Decimal(0), water: new Decimal(0), biomass: new Decimal(0) };
  readonly lost: Amounts = { energy: new Decimal(0), water: new Decimal(0), biomass: new Decimal(0) };
  /** Told about income lost to a full store. */
  onOverflow?: (kind: CappedKind, amount: Decimal) => void;
  /** E23.5.1: counters that earn nothing (old-city biomass is a gathered backpack item, not a counter). */
  noIncome?: ReadonlySet<ResourceKind>;

  constructor(
    private res: Amounts,
    private caps: Caps,
  ) {}

  get(kind: ResourceKind): Decimal {
    return this.res[kind];
  }

  /** Storage cap, or undefined for biomass (uncapped). */
  cap(kind: ResourceKind): Decimal | undefined {
    return isCapped(kind) ? this.caps[kind] : undefined;
  }

  /** Free space in a store (undefined = unlimited). */
  room(kind: ResourceKind): Decimal | undefined {
    const c = this.cap(kind);
    return c ? c.sub(this.res[kind]).max(ZERO) : undefined;
  }

  /** The cost of one resource (pulse energy can be fractional: Efficient Pulse). */
  static part(cost: Cost, k: ResourceKind): Decimal {
    const v = cost[k];
    return v === undefined ? ZERO : big(v);
  }

  /** `cost ≤ balance`, with a hair of tolerance for fractional per-tick income. */
  private covers(k: ResourceKind, p: Decimal): boolean {
    return p.lte(this.res[k].add(1e-9));
  }

  canAfford(cost: Cost): boolean {
    return KINDS.every((k) => this.covers(k, Economy.part(cost, k)));
  }

  /** Returns the first resource that is short, or undefined. */
  shortfall(cost: Cost): ResourceKind | undefined {
    return KINDS.find((k) => !this.covers(k, Economy.part(cost, k)));
  }

  /** A cost that storage can never hold right now (a capped store smaller than the price). */
  exceedsStorage(cost: Cost): ResourceKind | undefined {
    return KINDS.find((k) => {
      const c = this.cap(k);
      return !!c && Economy.part(cost, k).gt(c);
    });
  }

  spend(cost: Cost): boolean {
    if (!this.canAfford(cost)) return false;
    for (const k of KINDS) {
      const p = Economy.part(cost, k);
      if (p.lte(0)) continue;
      this.res[k] = this.res[k].sub(p).max(ZERO);
      this.spent[k] = this.spent[k].add(p);
    }
    return true;
  }

  /** Adds income; energy and water stop at their cap. Returns the amount actually banked. */
  add(kind: ResourceKind, amount: BigLike): Decimal {
    const a = big(amount);
    if (a.lte(0) || this.noIncome?.has(kind)) return ZERO;
    const before = this.res[kind];
    const cap = this.cap(kind);
    if (!cap) {
      this.res[kind] = before.add(a);
      this.earned[kind] = this.earned[kind].add(a);
      return a;
    }
    const after = before.add(a).min(cap);
    this.res[kind] = after;
    const got = after.sub(before).max(ZERO);
    const lost = a.sub(got);
    this.earned[kind] = this.earned[kind].add(got);
    if (lost.gt(1e-9)) {
      this.lost[kind] = this.lost[kind].add(lost);
      this.onOverflow?.(kind as CappedKind, lost);
    }
    return got;
  }

  isFull(kind: ResourceKind): boolean {
    const c = this.cap(kind);
    return !!c && this.res[kind].gte(c.sub(1e-6));
  }
}

export function scaleCost(cost: Cost, mult: BigLike): Cost {
  const out: Cost = {};
  for (const k of KINDS) if (cost[k] !== undefined && big(cost[k]).gt(0)) out[k] = ceilBig(big(cost[k]).mul(big(mult)));
  return out;
}

export const RES_ICON: Record<ResourceKind, string> = { energy: '⚡', water: '💧', biomass: '🌿' };

/**
 * E18.7: a price for a buy button, every part shown; the part the player is short of (from `econ.shortfall`) is
 * wrapped in `<span class="short">` so it reads without colour too (underlined).
 */
export function formatPriceHtml(cost: Cost, short?: ResourceKind): string {
  const parts = KINDS.filter((k) => Economy.part(cost, k).gt(0)).map((k) => {
    const t = `${fmt(ceilBig(Economy.part(cost, k)))}${RES_ICON[k]}`;
    return k === short ? `<span class="short">${t}</span>` : t;
  });
  return parts.length ? parts.join(' ') : 'free';
}

export function formatCost(cost: Cost): string {
  const parts = KINDS.filter((k) => Economy.part(cost, k).gt(0)).map((k) => `${fmt(ceilBig(Economy.part(cost, k)))}${RES_ICON[k]}`);
  return parts.length ? parts.join(' ') : 'free';
}

/** Fresh Decimal amounts from plain numbers or saved strings (new games, saves, presets). */
export function amounts(src: Partial<Record<ResourceKind, BigLike>>): Amounts {
  return { energy: big(src.energy ?? 0), water: big(src.water ?? 0), biomass: big(src.biomass ?? 0) };
}

export function caps(src: Partial<Record<CappedKind, BigLike>>): Caps {
  return { energy: big(src.energy ?? 0), water: big(src.water ?? 0) };
}
