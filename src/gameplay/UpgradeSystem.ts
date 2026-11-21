import { MOVE_LEVELS } from '../data/moveSpots';
import { machinesStamp } from '../core/GameState';
import { isBuilt, tierOf } from '../data/machines';

const tier2 = (m: { tier?: number }) => tierOf(m) >= 2;
const tier3 = (m: { tier?: number }) => tierOf(m) >= 3;
/** Output relative to one tier-1 machine: 1, tier 2, tier 3 (TUNING.merge / TUNING.super.outputMult); 0 while a superstructure is being built. */
const tierOutput = (m: { tier?: number; project?: { stage: number } }, t2: number) =>
  !isBuilt(m) ? 0 : tier3(m) ? TUNING.super.outputMult : tier2(m) ? t2 : 1;
import { TUNING } from '../data/tuning';
import { RESEARCH } from '../data/research';
import { RIPPLE } from '../data/pulse';
import { SALVAGE } from '../data/salvage';
import { DRONE_DASH, powerMult, UPGRADE_BY_ID, UPGRADES } from '../data/upgrades';
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
    this.sim.bus.emit('upgrade.granted', { id, level: lvl, machineId });
    return lvl;
  }

  /** The upgrades that exist. */
  all() {
    return UPGRADES;
  }

  // ───────────── global effects ─────────────
  get broadExtra() {
    // E23.6.2: the Wider pulse research upgrade: its first levels step the pulse up a tier each (#623: up to three)
    return this.level('broadPulse') + Math.min(RESEARCH.pulseTierLevels, this.sim.research?.level('pulseRadius') ?? 0);
  }
  /** #623: Wider pulse's late levels (4 and 5): a flat tile each on the pulse's radius */
  get broadTiles() {
    return Math.max(0, (this.sim.research?.level('pulseRadius') ?? 0) - RESEARCH.pulseTierLevels) * RESEARCH.pulseTilesPerLateLevel;
  }
  // ───────────── #624 (E25): Bloombot's research upgrades on systems that were already there ─────────────
  private eff(id: string): number {
    return this.sim.research?.effect(id) ?? 0;
  }
  /** Quick hands: what a pry hold (rubble, a vault door) takes, as a share of before (1 without it). Digging is Nimble hands'. */
  get holdFactor(): number {
    return 1 - this.eff('quickHands');
  }
  /**
   * The one place a hold's length is worked out (#624): seconds Interact is held to dig out a pile once. Nimble
   * hands from the park (#622) shortens it; Quick hands is for prying only (the owner's call, E25), so the two never
   * pile up on digging. It never drops below RESEARCH.minHold.
   */
  get salvageHold(): number {
    return Math.max(RESEARCH.minHold, SALVAGE.holdSeconds * (this.sim.parkGrowth?.holdShare ?? 1));
  }
  /** Seconds Interact is held to pry rubble open (Quick hands; never below RESEARCH.minHold either). */
  get pryHold(): number {
    return Math.max(RESEARCH.minHold, SALVAGE.pryHoldSeconds * this.holdFactor);
  }
  /** E25 (#626): seconds Interact is held to force a vault door with Pry II (Quick hands shortens it too). */
  get vaultHold(): number {
    return Math.max(RESEARCH.minHold, MOVE_LEVELS.vaultHoldSeconds * this.holdFactor);
  }
  /** Keen eye: how far a pulse's ripple reaches and lights up piles, caches, pages and buried things (tiles). */
  get rippleRadius(): number {
    return RIPPLE.radius + this.eff('keenEye');
  }
  /** Keen eye: tiles added to how far the piles the fountain still wants glint. */
  get glintExtra(): number {
    return this.eff('keenEye');
  }
  /** Keen eye at its last level: piles and unopened caches show on the minimap. */
  get findsOnMap(): boolean {
    return (this.sim.research?.level('keenEye') ?? 0) >= RESEARCH.keenEyeMapLevel;
  }
  /** Sun soak: charge a second, standing still in full sun (Charge scales it by the sun now). */
  get sunSoak(): number {
    return this.eff('sunSoak');
  }
  /** Lantern: how far Bloombot's own light reaches at night (0: no light of its own). */
  get lanternReach(): number {
    return this.eff('lantern');
  }
  /** Lucky pulse: the chance a pulse on bare ground turns up a few Seeds or Scrap (0 without it). */
  get luckyChance(): number {
    return this.eff('luckyPulse');
  }

  get overchargeEvery() {
    const l = this.level('overcharge');
    return l > 0 ? 7 - l : 0;
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

  // ───────────── per-machine effects (Phase 5 E12) ─────────────
  /** What a panel feeds the grid, relative to one plain panel: Solar Wings levels, times TUNING.merge.solarMult for a Solar Array (E13 tier 2). */
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
    // E23.6.2: Quicker wings (research) on top
    return DRONE_DASH[Math.min(DRONE_DASH.length - 1, this.levelOf(hub, 'droneSpeed'))] * (this.sim.landmarks?.helperSpeed() ?? 1) * (1 + (this.sim.research?.effect('droneSpeed') ?? 0)); // E21.9: Clock Plaza
  }
  droneRadius(hub: MachineData | undefined) {
    // E23.6.2: Further wings (research) adds tiles
    return TUNING.drone.hubRadius + (this.sim.research?.effect('droneRange') ?? 0) + 2 * this.levelOf(hub, 'droneRadius') + (hub && tier3(hub) ? TUNING.super.megahub.radiusBonus : hub && tier2(hub) ? TUNING.merge.fleetRadiusBonus : 0);
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
