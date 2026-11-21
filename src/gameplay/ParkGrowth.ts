import { PARK } from '../core/Areas';
import { PARK_GROWTH, PARK_GROWTH_TUNING as T, type ParkGrowthDef } from '../data/bloombot';
import type { Sim } from './Sim';

/**
 * #622 (E25): greening the park grows Bloombot. Three milestones (20, 40 and 60 park tiles alive) each give a small
 * first growth before the fountain's first step: a pulse that spills onto one more tile, charge that goes a tenth
 * further, quicker salvage. Each is kept once earned (`progression.parkGrowth`, the steps reached), even if the park
 * later loses ground. Charge, salvage and the pulse read the getters here.
 */
export class ParkGrowth {
  private since = 0;

  constructor(private readonly sim: Sim) {}

  /** How many milestones Bloombot has reached (0 to 3). */
  get step(): number {
    return Math.min(PARK_GROWTH.length, this.sim.state.progression.parkGrowth ?? 0);
  }

  has(id: ParkGrowthDef['id']): boolean {
    const d = PARK_GROWTH.find((g) => g.id === id);
    return !!d && this.step >= d.step;
  }

  /** The next milestone, if any is left. */
  next(): ParkGrowthDef | undefined {
    return PARK_GROWTH[this.step];
  }

  /** Park tiles alive now (what the milestones count). */
  tiles(): number {
    return this.sim.areas.counts(PARK).restored;
  }

  /** Spreading pulse: how many tiles beside a pulsed dry tile wake with it. */
  get spill(): number {
    return this.has('spill') ? T.spill : 0;
  }

  /** Steady charge: what charge costs, as a share (1 before it). */
  get chargeFactor(): number {
    return this.has('thrift') ? T.chargeFactor : 1;
  }

  /**
   * Nimble hands: what a salvage hold takes, as a share of before (1 before it). The hold itself is worked out in
   * one place, `UpgradeSystem.salvageHold`, with Quick hands (#624) and a floor.
   */
  get holdShare(): number {
    return this.has('quick') ? T.holdFactor : 1;
  }

  tick(dt: number) {
    this.since += dt;
    if (this.since < T.checkEvery) return;
    this.since = 0;
    this.check();
  }

  /**
   * Counts the park and grants any milestone it has reached (one event each, in order). A save from before E25 is
   * caught up quietly the first time: what its park already earned is simply there, with no burst of moments.
   */
  check() {
    const n = this.tiles();
    const p = this.sim.state.progression;
    if (p.parkGrowth === undefined) {
      p.parkGrowth = PARK_GROWTH.filter((d) => n >= d.tiles).length;
      return;
    }
    for (let d = this.next(); d && n >= d.tiles; d = this.next()) {
      p.parkGrowth = d.step;
      this.sim.bus.emit('bloombot.parkGrew', { step: d.step, id: d.id });
    }
  }
}
