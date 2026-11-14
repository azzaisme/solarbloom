import type { Cost, ResourceKind, Resources } from './types';

export const KINDS: ResourceKind[] = ['energy', 'water', 'biomass'];

/** Resource arithmetic with the invariant 0 <= value <= cap. */
export class Economy {
  /** Everything spent so far this session, per resource (the HUD shows spending per minute from it). */
  readonly spent: Resources = { energy: 0, water: 0, biomass: 0 };
  /** Phase 4 E00/E01: told about income lost to a full store (debug tracking; never a currency). */
  onOverflow?: (kind: ResourceKind, amount: number) => void;

  constructor(
    private res: Resources,
    private caps: Resources,
  ) {}

  get(kind: ResourceKind) {
    return this.res[kind];
  }
  cap(kind: ResourceKind) {
    return this.caps[kind];
  }

  canAfford(cost: Cost): boolean {
    return KINDS.every((k) => (cost[k] ?? 0) <= this.res[k] + 1e-9);
  }

  /** Returns the first resource that is short, or undefined. */
  shortfall(cost: Cost): ResourceKind | undefined {
    return KINDS.find((k) => (cost[k] ?? 0) > this.res[k] + 1e-9);
  }

  spend(cost: Cost): boolean {
    if (!this.canAfford(cost)) return false;
    for (const k of KINDS) {
      this.res[k] = Math.max(0, this.res[k] - (cost[k] ?? 0));
      this.spent[k] += cost[k] ?? 0;
    }
    return true;
  }

  /** Adds up to the cap. Returns the amount actually granted. */
  add(kind: ResourceKind, amount: number): number {
    if (!(amount > 0)) return 0;
    const before = this.res[kind];
    this.res[kind] = Math.min(this.caps[kind], before + amount);
    const got = this.res[kind] - before;
    if (got < amount - 1e-9) this.onOverflow?.(kind, amount - got);
    return got;
  }

  isFull(kind: ResourceKind) {
    return this.res[kind] >= this.caps[kind] - 1e-6;
  }
}

export function scaleCost(cost: Cost, mult: number): Cost {
  const out: Cost = {};
  for (const k of KINDS) if (cost[k]) out[k] = Math.ceil((cost[k] as number) * mult);
  return out;
}

export function formatCost(cost: Cost): string {
  const icons: Record<ResourceKind, string> = { energy: '⚡', water: '💧', biomass: '🌿' };
  const parts = KINDS.filter((k) => cost[k]).map((k) => `${Math.ceil(cost[k] as number)}${icons[k]}`);
  return parts.length ? parts.join(' ') : 'free';
}
