import type { Cost, ResourceKind, Resources } from './types';

export const KINDS: ResourceKind[] = ['energy', 'water', 'biomass'];

/** Resource arithmetic with the invariant 0 <= value <= cap. */
export class Economy {
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
    for (const k of KINDS) this.res[k] = Math.max(0, this.res[k] - (cost[k] ?? 0));
    return true;
  }

  /** Adds up to the cap. Returns the amount actually granted. */
  add(kind: ResourceKind, amount: number): number {
    if (!(amount > 0)) return 0;
    const before = this.res[kind];
    this.res[kind] = Math.min(this.caps[kind], before + amount);
    return this.res[kind] - before;
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
