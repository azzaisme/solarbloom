import { KINDS } from '../core/Economy';
import type { Cost, Resources } from '../core/types';
import { TUNING } from '../data/tuning';
import type { Sim } from './Sim';

/** What an absence earned (Phase 4 E01). */
export interface OfflineReport {
  /** seconds of absence credited (after the cap) */
  seconds: number;
  /** seconds actually away */
  away: number;
  /** resources banked */
  credited: Resources;
  /** income that didn't fit in storage */
  lost: Resources;
  droneJobs: number;
  restored: number;
  grown: number;
}

/**
 * Progress while the game is closed, or a tab was hidden for longer than the live catch-up covers.
 *
 * Only steady things happen, at TUNING.offline.rate of their sustained pace and for at most
 * TUNING.offline.maxSeconds: production (no temporary boosts) and drone jobs, paid from the same stores. Drone
 * work offline restores and nurtures tiles through the normal transaction path but sets off no chains.
 * Landmarks, cats, Frenzy, milestones and other one-time rewards never happen while away, and the sim clock
 * doesn't move, so nothing timed (cat spawns, buffs, cooldowns) advances either. Nothing is lost by staying
 * away longer; it just stops adding up after the cap.
 */
export class OfflineSystem {
  constructor(private sim: Sim) {}

  apply(awaySeconds: number): OfflineReport | undefined {
    const O = TUNING.offline;
    if (!Number.isFinite(awaySeconds) || awaySeconds < O.minSeconds) return undefined;
    const s = this.sim;
    const seconds = Math.min(awaySeconds, O.maxSeconds);
    const eff = seconds * O.rate;
    const credited: Resources = { energy: 0, water: 0, biomass: 0 };
    const lost: Resources = { energy: 0, water: 0, biomass: 0 };
    s.frenzy.suspended = true; // time away never charges Bloom Frenzy
    const rates = s.production.rates(true);
    for (const k of KINDS) {
      const amount = rates[k] * eff;
      if (!(amount > 0)) continue;
      const got = s.econ.add(k, amount);
      credited[k] += got;
      lost[k] += amount - got;
    }
    const report: OfflineReport = { seconds, away: awaySeconds, credited, lost, droneJobs: 0, restored: 0, grown: 0 };
    this.droneWork(eff, report);
    s.frenzy.suspended = false;
    s.production.markDirty();
    return report;
  }

  /** Drone jobs offline: each permanent drone does what it would have done, at the reduced pace. */
  private droneWork(eff: number, report: OfflineReport) {
    const s = this.sim;
    const D = TUNING.drone;
    const drones = s.state.drones.filter((d) => d.expiresAt === undefined);
    const budget = new Map<string, number>();
    let total = 0;
    for (const d of drones) {
      // One job: the cooldown, the work, and about two tiles of flight each way.
      const per = d.old ? D.old.cycleSeconds + D.old.workSeconds + 4 / D.old.flySpeed : D.cycleSeconds * s.upgrades.droneCycleMult + D.workSeconds + 4 / (s.drones.speedOf(d) / s.mods.droneSpeedMult()); // sustained pace, no boosts
      const n = Math.floor(eff / per);
      budget.set(d.id, n);
      total += n;
    }
    let left = Math.min(total, TUNING.offline.maxDroneJobs);
    let active = drones.filter((d) => (budget.get(d.id) ?? 0) > 0);
    while (left > 0 && active.length) {
      for (const d of active) {
        if (left <= 0) break;
        const job = s.drones.findJob(d);
        if (!job) {
          budget.set(d.id, 0);
          continue;
        }
        const cost: Cost = d.old ? {} : s.restoration.pulseCost(job);
        if (!s.drones.payJob(cost)) {
          budget.set(d.id, 0);
          continue;
        }
        if (s.restoration.isEligible(job)) {
          s.restoration.complete(job, 'drone', undefined, true);
          report.restored++;
        } else {
          s.restoration.grow(job, undefined, 'auto', true);
          report.grown++;
        }
        d.jobs++;
        s.state.stats.droneJobs++;
        report.droneJobs++;
        left--;
        budget.set(d.id, (budget.get(d.id) ?? 0) - 1);
      }
      active = active.filter((d) => (budget.get(d.id) ?? 0) > 0);
    }
  }
}
