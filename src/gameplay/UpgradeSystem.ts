import { machinesStamp } from '../core/GameState';
import { isBuilt, tierOf } from '../data/machines';

const tier2 = (m: { tier?: number }) => tierOf(m) >= 2;
const tier3 = (m: { tier?: number }) => tierOf(m) >= 3;
/** Output relative to one tier-1 machine: 1, tier 2, tier 3 (TUNING.merge / TUNING.super.outputMult); 0 while a superstructure is being built. */
const tierOutput = (m: { tier?: number; project?: { stage: number } }, t2: number) =>
  !isBuilt(m) ? 0 : tier3(m) ? TUNING.super.outputMult : tier2(m) ? t2 : 1;
import { TUNING } from '../data/tuning';
import { DRONE_DASH, powerMult, UPGRADE_BY_ID, UPGRADES } from '../data/upgrades';
import { CAPPED } from '../core/Economy';
import { big } from '../core/Big';
import type { MachineData } from '../core/types';
import type { Sim } from './Sim';

/**
 * Upgrade effects. E23.1.5 removed the exponential upgrade drawer: nothing is bought here any more and no price
 * grows. Levels are granted by whatever unlocks them (research, E23.6.2, through `grant`; a fountain ability for
 * Hover) and every system reads its effect through the getters below. Global upgrades keep one level in
 * `state.upgrades`; per-machine ones keep a level on each machine (`m.upg`).
 */
export class UpgradeSystem {
  /** Bumped by every grant: systems that cache upgrade-dependent values (reach, networks) compare it. */
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

  /**
   * The one way a level is added (research, E23.6.2). Free: whoever calls it has already paid. A per-machine
   * upgrade goes to `machineId`, or to every machine of its type when none is given. Returns the new level
   * (the highest, for a per-machine grant), or 0 when nothing changed (unknown id, maxed, no such machine).
   */
  grant(id: string, machineId?: string): number {
    const def = UPGRADE_BY_ID[id];
    if (!def) return 0;
    let lvl = 0;
    if (def.machine) {
      const targets = machineId ? [this.sim.machine(machineId)].filter((m): m is MachineData => m?.type === def.machine) : this.sim.machinesOfType(def.machine);
      for (const m of targets) {
        if (this.levelOf(m, id) >= def.maxLevel) continue;
        m.upg ??= {};
        lvl = Math.max(lvl, (m.upg[id] = this.levelOf(m, id) + 1));
      }
    } else if (this.level(id) < def.maxLevel) lvl = this.sim.state.upgrades[id] = this.level(id) + 1;
    if (!lvl) return 0;
    this.version++;
    if (id === 'seedVault') this.applyCaps();
    this.sim.production.markDirty();
    this.sim.bus.emit('upgrade.granted', { id, level: lvl, machineId });
    return lvl;
  }

  applyCaps() {
    // Phase 4 E01.3 / Phase 5 E12: Seed Vault steps energy and water through storage tiers; cleared areas
    // multiply the tier. Biomass has no cap.
    const mult = 1 + (this.sim.areas?.storageBonus() ?? 0);
    for (const k of CAPPED) {
      const tiers = TUNING.storageTiers[k];
      const tier = tiers[Math.min(tiers.length - 1, this.level('seedVault'))];
      // E21.9: Cistern Basin doubles water storage, The Terraces energy storage
      const lm = this.sim.landmarks?.capMult(k) ?? 1;
      this.sim.state.caps[k] = big(this.sim.state.caps[k]).max(tier * mult * lm); // big(): tolerate a plain number from tooling
    }
  }

  /** The upgrades that exist. */
  all() {
    return UPGRADES;
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
    return DRONE_DASH[Math.min(DRONE_DASH.length - 1, this.levelOf(hub, 'droneSpeed'))] * (this.sim.landmarks?.helperSpeed() ?? 1); // E21.9: Clock Plaza
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
