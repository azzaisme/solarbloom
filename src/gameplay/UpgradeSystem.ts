import { TUNING } from '../data/tuning';
import { UPGRADE_BY_ID, UPGRADES, type UpgradeDef } from '../data/upgrades';
import { KINDS } from '../core/Economy';
import type { Sim } from './Sim';

export class UpgradeSystem {
  constructor(private sim: Sim) {}

  level(id: string): number {
    return this.sim.state.upgrades[id] ?? 0;
  }

  cost(def: UpgradeDef): number {
    return Math.round(def.baseCost * Math.pow(def.costMult, this.level(def.id)));
  }

  status(def: UpgradeDef): { ok: boolean; reason?: string; cost: number } {
    const cost = this.cost(def);
    if (this.level(def.id) >= def.maxLevel) return { ok: false, reason: 'Maxed', cost };
    if (def.available && !def.available(this.sim.state)) return { ok: false, reason: def.lockedReason, cost };
    if (cost > this.sim.econ.cap('biomass')) return { ok: false, reason: 'Needs more storage — try Seed Vault', cost };
    if (this.sim.econ.get('biomass') < cost) return { ok: false, reason: `Need ${cost} 🌿`, cost };
    return { ok: true, cost };
  }

  purchase(id: string): boolean {
    const def = UPGRADE_BY_ID[id];
    if (!def) return false;
    const st = this.status(def);
    if (!st.ok) {
      this.sim.bus.emit('action.failed', { reason: st.reason ?? 'Unavailable' });
      return false;
    }
    this.sim.econ.spend({ biomass: st.cost });
    const lvl = this.level(id) + 1;
    this.sim.state.upgrades[id] = lvl;
    if (id === 'seedVault') this.applyCaps();
    this.sim.production.markDirty();
    this.sim.bus.emit('upgrade.purchased', { id, level: lvl });
    return true;
  }

  applyCaps() {
    const mult = 1 + 0.5 * this.level('seedVault');
    for (const k of KINDS) this.sim.state.caps[k] = Math.max(this.sim.state.caps[k], TUNING.start.caps[k] * mult);
  }

  all() {
    return UPGRADES;
  }

  // Effects
  get pulseEnergyMult() {
    return Math.pow(0.75, this.level('efficientPulse'));
  }
  get broadExtra() {
    return this.level('broadPulse');
  }
  get solarMult() {
    return 1 + 0.5 * this.level('solarArray');
  }
  get soilMult() {
    return 1 + 0.5 * this.level('richSoil');
  }
  get droneCycleMult() {
    return Math.pow(0.75, this.level('droneSpeed'));
  }
  get droneFlyMult() {
    return 1 + 0.3 * this.level('droneSpeed');
  }
  get pollinatorReach() {
    return TUNING.pollinator.reach + this.level('pollinatorReach');
  }
}
