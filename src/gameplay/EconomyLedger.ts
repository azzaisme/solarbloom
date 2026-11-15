import { Decimal, ZERO, type Big } from '../core/Big';
import { KINDS } from '../core/Economy';
import type { Amounts, ResourceKind } from '../core/types';
import type { Sim } from './Sim';

interface Sample {
  t: number;
  earned: Amounts;
  spent: Amounts;
  lost: Amounts;
}

const copy = (a: Amounts): Amounts => ({ energy: a.energy, water: a.water, biomass: a.biomass });

/**
 * Phase 5 E12: what the economy actually did over the last ~20 s of sim time, per resource: income banked,
 * spending, and income lost to a full store (gross = banked + lost). The HUD shows net = banked − spent, so
 * production that can't be stored is never advertised as income; the advisor estimates time-to-afford from it.
 */
export class EconomyLedger {
  private samples: Sample[] = [];
  static readonly window = 20;

  constructor(private sim: Sim) {}

  /** Called every sim tick; samples once per sim second. */
  tick() {
    const s = this.sim;
    const last = this.samples[this.samples.length - 1];
    if (last && s.time - last.t < 1 - 1e-9) return;
    const e = s.econ;
    this.samples.push({ t: s.time, earned: copy(e.earned), spent: copy(e.spent), lost: copy(e.lost) });
    while (this.samples.length > EconomyLedger.window + 1) this.samples.shift();
  }

  private per(kind: ResourceKind, field: 'earned' | 'spent' | 'lost'): Big {
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    if (!a || !b || b.t - a.t < 0.5) return ZERO;
    return b[field][kind].sub(a[field][kind]).max(0).div(b.t - a.t);
  }

  /** Per second, averaged over the window. */
  banked(k: ResourceKind) {
    return this.per(k, 'earned');
  }
  spent(k: ResourceKind) {
    return this.per(k, 'spent');
  }
  wasted(k: ResourceKind) {
    return this.per(k, 'lost');
  }
  gross(k: ResourceKind) {
    return this.banked(k).add(this.wasted(k));
  }
  /** Banked minus spent; can be negative (e.g. drones spending energy faster than panels make it). */
  net(k: ResourceKind): Decimal {
    return this.banked(k).sub(this.spent(k));
  }
  /** Whether the window holds enough data to trust (a few seconds after load). */
  get warm(): boolean {
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    return !!a && !!b && b.t - a.t >= 3;
  }

  /**
   * Seconds until `need` more of `k` is banked at the current income (Infinity if none). Income, not net:
   * spending is the player's choice, so "how long if I save" is the useful answer.
   */
  eta(k: ResourceKind, need: Big): number {
    if (need.lte(0)) return 0;
    // Before the window warms up, fall back on the production rate.
    const rate = this.warm ? this.banked(k) : this.sim.production.rates()[k];
    if (rate.lte(1e-9)) return Infinity;
    return need.div(rate).toNumber();
  }

  static readonly KINDS = KINDS;
}

