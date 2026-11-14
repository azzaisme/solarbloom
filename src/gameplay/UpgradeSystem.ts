import { TUNING } from '../data/tuning';
import { UPGRADE_BY_ID, UPGRADE_GROUPS, UPGRADES, type UpgradeDef, type UpgradeGroup } from '../data/upgrades';
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
    if (!def || !this.all().includes(def)) return false; // e.g. a rooftop-only upgrade in the city
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
    const mult = 1 + 0.5 * this.level('seedVault') + (this.sim.areas?.storageBonus() ?? 0);
    for (const k of KINDS) this.sim.state.caps[k] = Math.max(this.sim.state.caps[k], TUNING.start.caps[k] * mult);
  }

  /** The upgrades that exist in this game. */
  all() {
    return UPGRADES;
  }

  /** Upgrades in drawer order: grouped by system, then as listed. */
  grouped(): { group: UpgradeGroup; upgrades: UpgradeDef[] }[] {
    const list = this.all();
    return UPGRADE_GROUPS.map((group) => ({ group, upgrades: list.filter((d) => d.group === group) })).filter((g) => g.upgrades.length);
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
    return 1 + 0.3 * this.level('richSoil');
  }
  get droneCycleMult() {
    return Math.pow(0.75, this.level('droneSpeed'));
  }
  get droneFlyMult() {
    return 1 + 0.3 * this.level('droneSpeed');
  }
  get droneRadius() {
    return TUNING.drone.hubRadius + this.level('droneRadius');
  }
  get overchargeEvery() {
    const l = this.level('overcharge');
    return l > 0 ? 7 - l : 0;
  }
  get waterBloom() {
    return this.level('waterBloom');
  }
  get treeRadius() {
    return TUNING.motherTree.radius + this.level('treeResonance');
  }
  get corridorRange() {
    return TUNING.chain.corridorRange + 2 * this.level('corridorReach');
  }
  get networkRange() {
    return TUNING.drone.networkRange + 4 * this.level('droneMesh');
  }
  /** Multiplier on the tiles a landmark needs restored before it can wake. */
  get wakeNeedMult() {
    return 1 - 0.1 * this.level('fogLantern');
  }
  /** Lit Landmarks: multiplier on every cleared area's bonus income. */
  get landmarkBonusMult() {
    return 1 + 0.25 * this.level('landmarkLights');
  }
  get pollinatorReach() {
    return TUNING.pollinator.reach + this.level('pollinatorReach');
  }
}
