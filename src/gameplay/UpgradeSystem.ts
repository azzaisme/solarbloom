import { machinesStamp } from '../core/GameState';
import { isBuilt, tierOf } from '../data/machines';

const tier2 = (m: { tier?: number }) => tierOf(m) >= 2;
const tier3 = (m: { tier?: number }) => tierOf(m) >= 3;
/** Output relative to one tier-1 machine: 1, tier 2, tier 3 (TUNING.merge / TUNING.super.outputMult); 0 while a superstructure is being built. */
const tierOutput = (m: { tier?: number; project?: { stage: number } }, t2: number) =>
  !isBuilt(m) ? 0 : tier3(m) ? TUNING.super.outputMult : tier2(m) ? t2 : 1;
import { TUNING } from '../data/tuning';
import { DRONE_DASH, powerMult, UPGRADE_BY_ID, UPGRADE_GROUPS, UPGRADES, type UpgradeDef, type UpgradeGroup } from '../data/upgrades';
import { CAPPED } from '../core/Economy';
import { big, Decimal, fmt, type Big } from '../core/Big';
import type { MachineData } from '../core/types';
import type { Sim } from './Sim';

export interface UpgradeStatus {
  ok: boolean;
  reason?: string;
  cost: Big;
  /** Per-machine upgrade without a machine ("Upgrade all"): the machine the next purchase goes to. */
  machine?: MachineData;
}

/**
 * Upgrades. Global ones (pulse, soil, storage, fog, networks) have one level; per-machine ones (Phase 5 E12)
 * keep a level on each machine and are bought for one machine at a time, or for all of a type cheapest-first.
 * Every purchase is one atomic transaction: check, pay once, apply once.
 */
export class UpgradeSystem {
  /** Bumped by every purchase: systems that cache upgrade-dependent values (reach, networks) compare it. */
  version = 0;

  constructor(private sim: Sim) {}

  /** A global upgrade's level (0 for per-machine upgrades: use levelOf). */
  level(id: string): number {
    return this.sim.state.upgrades[id] ?? 0;
  }

  /** A per-machine upgrade's level on one machine. */
  levelOf(m: MachineData | undefined, id: string): number {
    return m?.upg?.[id] ?? 0;
  }

  /** The highest level of a per-machine upgrade on any machine (visual and preview defaults). */
  maxLevelOf(id: string): number {
    const def = UPGRADE_BY_ID[id];
    if (!def?.machine) return this.level(id);
    let best = 0;
    for (const m of this.sim.machinesOfType(def.machine)) best = Math.max(best, this.levelOf(m, id));
    return best;
  }

  /** Machines a per-machine upgrade can be bought for (the starter panel counts: it's the player's first). */
  targets(def: UpgradeDef): MachineData[] {
    return def.machine ? this.sim.machinesOfType(def.machine) : [];
  }

  /** Next level's price: baseCost × costMult^level (per machine for per-machine upgrades). */
  cost(def: UpgradeDef, m?: MachineData): Big {
    const lvl = def.machine ? this.levelOf(m, def.id) : this.level(def.id);
    const c = big(def.baseCost).mul(Decimal.pow(def.costMult, lvl)).ceil();
    // Look 6.8: energy prices stay within reach of the store (never more than machineCostMaxShare of the cap).
    if (def.costKind === 'energy') {
      const cap = this.sim.econ.cap('energy');
      return cap ? c.min(cap.mul(TUNING.machineCostMaxShare).floor().max(1)) : c;
    }
    return c;
  }

  /**
   * Can the next level be bought? For a per-machine upgrade without `m`, answers for "Upgrade all": the cheapest
   * machine that isn't maxed.
   */
  status(def: UpgradeDef, m?: MachineData): UpgradeStatus {
    if (def.available && !def.available(this.sim.state)) return { ok: false, reason: def.lockedReason, cost: this.cost(def, m) };
    if (def.machine && !m) {
      // Cost depends only on level, so the cheapest machine is the lowest-level one (first built on ties).
      const all = this.targets(def);
      if (!all.length) return { ok: false, reason: def.lockedReason ?? 'Build one first', cost: this.cost(def) };
      let cheapest = all[0];
      for (const t of all) if (this.levelOf(t, def.id) < this.levelOf(cheapest, def.id)) cheapest = t;
      if (this.levelOf(cheapest, def.id) >= def.maxLevel) return { ok: false, reason: 'Maxed', cost: this.cost(def, cheapest) };
      return { ...this.status(def, cheapest), machine: cheapest };
    }
    const lvl = def.machine ? this.levelOf(m, def.id) : this.level(def.id);
    const cost = this.cost(def, m);
    if (lvl >= def.maxLevel) return { ok: false, reason: 'Maxed', cost };
    if (def.machine && m?.type !== def.machine) return { ok: false, reason: 'Not for this machine', cost };
    const kind = def.costKind ?? 'biomass';
    if (this.sim.econ.get(kind).lt(cost)) return { ok: false, reason: `Need ${fmt(cost)} ${kind === 'energy' ? '⚡' : '🌿'}`, cost };
    return { ok: true, cost, machine: m };
  }

  /**
   * Buys one level. `machineId` picks the machine for a per-machine upgrade; without it the cheapest one is
   * upgraded. Nothing changes unless the whole purchase goes through.
   */
  purchase(id: string, machineId?: string, bulk = false): boolean {
    const def = UPGRADE_BY_ID[id];
    if (!def || !this.all().includes(def)) return false;
    const m = def.machine ? (machineId ? this.sim.machine(machineId) : undefined) : undefined;
    if (def.machine && machineId && !m) return false; // stale button: the machine is gone
    const st = this.status(def, m);
    if (!st.ok) {
      this.sim.bus.emit('action.failed', { reason: st.reason ?? 'Unavailable' });
      return false;
    }
    if (!this.sim.econ.spend({ [def.costKind ?? 'biomass']: st.cost })) return false;
    let lvl: number;
    if (def.machine) {
      const target = st.machine!;
      target.upg ??= {};
      lvl = target.upg[id] = (target.upg[id] ?? 0) + 1;
    } else lvl = this.sim.state.upgrades[id] = this.level(id) + 1;
    this.version++;
    if (id === 'seedVault') this.applyCaps();
    this.sim.production.markDirty();
    this.sim.bus.emit('upgrade.purchased', { id, level: lvl, machineId: st.machine?.id, bulk });
    return true;
  }

  /** "Upgrade all": buys levels cheapest-first across every machine of the type while biomass lasts. */
  purchaseAll(id: string, limit = 500): number {
    const def = UPGRADE_BY_ID[id];
    if (!def?.machine) return this.purchase(id) ? 1 : 0;
    let n = 0;
    while (n < limit) {
      const st = this.status(def);
      if (!st.ok || !st.machine) break;
      if (!this.purchase(id, st.machine.id, true)) break;
      n++;
    }
    if (n === 0) this.sim.bus.emit('action.failed', { reason: this.status(def).reason ?? 'Unavailable' });
    else this.sim.bus.emit('upgrade.bulk', { id, count: n });
    return n;
  }

  applyCaps() {
    // Phase 4 E01.3 / Phase 5 E12: Seed Vault steps energy and water through storage tiers; cleared areas
    // multiply the tier. Biomass has no cap.
    const mult = 1 + (this.sim.areas?.storageBonus() ?? 0);
    for (const k of CAPPED) {
      const tiers = TUNING.storageTiers[k];
      const tier = tiers[Math.min(tiers.length - 1, this.level('seedVault'))];
      this.sim.state.caps[k] = big(this.sim.state.caps[k]).max(tier * mult); // big(): tolerate a plain number from tooling
    }
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

  // ───────────── global effects ─────────────
  get pulseEnergyMult() {
    return Math.pow(0.75, this.level('efficientPulse'));
  }
  get broadExtra() {
    return this.level('broadPulse');
  }
  /** Phase 5 E12: the long-tail biomass engine: ×soilStep per level, against costs ×1.6, so every level takes
   *  about the same time and income grows exponentially (with a slight drag, so it can't run away). */
  get soilMult() {
    return Math.pow(TUNING.upgradeCurve.soilStep, this.level('richSoil'));
  }
  get overchargeEvery() {
    const l = this.level('overcharge');
    return l > 0 ? 7 - l : 0;
  }
  /** Phase 5 E12: seconds of steady biomass income each Harvest also pays. */
  get harvestBurstSeconds() {
    return TUNING.harvest.burstSeconds * this.level('harvestBurst');
  }
  /** Phase 5 E12: how many times one Pollinator Garden passes a chain on. */
  get pollinatorTriggers() {
    return TUNING.pollinator.triggersPerChain + 2 * this.level('chainHops');
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

  // ───────────── per-machine effects (Phase 5 E12) ─────────────
  /** Solar Wings levels, times TUNING.merge.solarMult for a Solar Array (E13 tier 2). */
  solarMult(m: MachineData) {
    return powerMult(0.5, this.levelOf(m, 'solarArray')) * tierOutput(m, TUNING.merge.solarMult);
  }
  /** Water a condenser makes, relative to one tier-1 condenser (E13: a Condenser Array makes TUNING.merge.waterMult). */
  waterMult(m: MachineData) {
    return tierOutput(m, TUNING.merge.waterMult);
  }
  /** Extra tiles a condenser's watering burst reaches beyond the base (E13: a Condenser Array +2). */
  condenserTierTargets(m: MachineData) {
    return tier2(m) ? TUNING.merge.condenserExtraTargets : 0;
  }
  /** Biomass multiplier inside a garden's zone (E13: a Bloom Garden ×2, a Pollinator Garden ×1.5). */
  gardenMult(m: MachineData) {
    if (!isBuilt(m)) return 1;
    return tier3(m) ? TUNING.super.treeOfLife.gardenMult : tier2(m) ? TUNING.merge.gardenBiomassMult : TUNING.pollinator.biomassMult;
  }
  waterBloom(m: MachineData) {
    return this.levelOf(m, 'waterBloom');
  }
  pollinatorReach(m: MachineData) {
    return TUNING.pollinator.reach + this.levelOf(m, 'pollinatorReach') + (tier3(m) ? TUNING.super.treeOfLife.gardenReachBonus : tier2(m) ? TUNING.merge.gardenReachBonus : 0);
  }
  /** The widest garden zone anywhere (a search radius; filter each garden by its own reach). */
  get maxPollinatorReach() {
    if (this.reachCache?.v !== this.version || this.reachCache.n !== machinesStamp(this.sim.state.machines)) {
      this.reachCache = { v: this.version, n: machinesStamp(this.sim.state.machines), r: TUNING.pollinator.reach + this.maxLevelOf('pollinatorReach') + (this.sim.machinesOfType('pollinator').some(tier3) ? TUNING.super.treeOfLife.gardenReachBonus : this.sim.machinesOfType('pollinator').some(tier2) ? TUNING.merge.gardenReachBonus : 0) };
    }
    return this.reachCache.r;
  }
  private reachCache?: { v: number; n: number; r: number };
  treeRadius(m: MachineData) {
    return TUNING.motherTree.radius + this.levelOf(m, 'treeResonance');
  }
  /** Drone Dash: ×1.5, ×2, ×3 … ×6 as fast overall (flight and rest), per hub. */
  droneSpeed(hub: MachineData | undefined) {
    return DRONE_DASH[Math.min(DRONE_DASH.length - 1, this.levelOf(hub, 'droneSpeed'))];
  }
  droneRadius(hub: MachineData | undefined) {
    return TUNING.drone.hubRadius + 2 * this.levelOf(hub, 'droneRadius') + (hub && tier3(hub) ? TUNING.super.megahub.radiusBonus : hub && tier2(hub) ? TUNING.merge.fleetRadiusBonus : 0);
  }
  /** Extra free tiles a drone restores around each tile it restores (Drone Sweep). */
  droneSweep(hub: MachineData | undefined) {
    return 2 * this.levelOf(hub, 'droneSweep');
  }
  /** Drones a hub launches (Drone Squad). */
  squad(hub: MachineData | undefined) {
    if (hub && !isBuilt(hub)) return 0;
    const n = 1 + this.levelOf(hub, 'secondDrone');
    return hub && tier2(hub) ? Math.min(TUNING.merge.fleetDroneCap, n * TUNING.merge.fleetDroneMult) : n;
  }
  chainIntel(hub: MachineData | undefined) {
    return this.levelOf(hub, 'chainIntel') > 0;
  }
  relayLens(relay: MachineData | undefined) {
    return this.levelOf(relay, 'relayLens');
  }
}
