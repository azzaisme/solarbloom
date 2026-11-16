import type { GameState, MachineType } from '../core/types';
import { TUNING } from './tuning';

/** Upgrade drawer sections, in order. Each groups what one system of the world does. */
export const UPGRADE_GROUPS = ['Pulse', 'Machines', 'Drones', 'Networks', 'Fog', 'Storage'] as const;
export type UpgradeGroup = (typeof UPGRADE_GROUPS)[number];

/** Whether this is the endless city (vs the rooftop campaign). */
const inCity = (s: GameState) => s.layers.some((l) => l.id === 'g' && l.unlocked && !l.preview);

export interface UpgradeDef {
  id: string;
  name: string;
  icon: string;
  group: UpgradeGroup;
  /** Only in this kind of game: the endless city, or the legacy rooftop campaign. Both when unset. */
  /** Only in the endless city (all upgrades are now). */
  mode?: 'city';
  baseCost: number; // biomass
  costMult: number;
  /** Infinity = no last level (Phase 5 E12: long-tail upgrades). */
  maxLevel: number;
  /**
   * Phase 5 E12: a per-machine upgrade, bought for one machine of this type at a time (tap it, or "Upgrade all"
   * in the drawer, which buys cheapest-first). Its level lives on the machine. Unset = global.
   */
  machine?: MachineType;
  /**
   * Look 6.8: what the price is paid in (unset = biomass). Energy prices never pass TUNING.machineCostMaxShare
   * of the energy store, like machine prices since E12 ("price it by what it does").
   */
  costKind?: 'energy';
  /**
   * E18.7: an energy or water part on top of the main price, priced by what the upgrade does (faster motors and
   * reach cost energy, a wider spray costs water). Per level: `base × mult^level`, never past
   * TUNING.machineCostMaxShare of that store's cap; past that only the main (biomass) part keeps growing.
   */
  extra?: Partial<Record<'energy' | 'water', { base: number; mult: number }>>;
  describe: (nextLevel: number) => string;
  available?: (s: GameState) => boolean;
  lockedReason?: string;
}

/** Drone Dash speed per level (Phase 5 E12: three more levels). */
export const DRONE_DASH = [1, 1.5, 2, 3, 4, 5, 6];

/**
 * Phase 5 E12: long-tail upgrade strength. +`step` per level, doubled at every 10th level, so each level is
 * felt and every tenth is a milestone: L=10 → ×12, L=20 → ×44 for step 0.5.
 */
export function powerMult(step: number, level: number): number {
  const l = Math.max(0, level);
  return (1 + step * l) * Math.pow(2, Math.floor(l / 10));
}

export const fmtMult = (x: number) => (x < 10 ? String(Math.round(x * 100) / 100) : x < 1e6 ? String(Math.round(x)) : x.toExponential(2));

const has = (type: string) => (s: GameState) => s.machines.some((m) => m.type === type);

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'efficientPulse',
    group: 'Pulse',
    name: 'Efficient Pulse',
    icon: '⚡',
    baseCost: 10,
    costMult: 2,
    maxLevel: 3,
    describe: () => 'Pulse energy cost −25%',
  },
  {
    id: 'solarArray', // saved id kept; shown as Solar Wings (Phase 5: "Array" becomes the merged T2 panel's name)
    group: 'Machines',
    machine: 'solar',
    name: 'Solar Wings',
    icon: '☀️',
    baseCost: 14,
    costMult: 1.65,
    maxLevel: Infinity,
    describe: (n) => `This panel's output ×${fmtMult(powerMult(0.5, n))} (from ×${fmtMult(powerMult(0.5, n - 1))}); doubles every 10 levels`,
  },
  {
    id: 'broadPulse',
    group: 'Pulse',
    name: 'Pulse Reach',
    icon: '💠',
    baseCost: 22,
    costMult: 4.4,
    maxLevel: 4,
    describe: (n) => {
      const t = TUNING.pulseTiers[n];
      const tiles = [1, 9, 25, 69, 161][n];
      return `${t.name}: each pulse restores up to ${tiles} tiles around it for free`;
    },
  },
  {
    id: 'richSoil',
    group: 'Machines',
    name: 'Rich Soil',
    icon: '🌱',
    baseCost: 40,
    costMult: 1.55, // Phase 5 E12: clearly faster than its ×1.2 effect, so a windfall (Frenzy ×10) buys only ~5 levels
    maxLevel: Infinity, // the long-tail biomass multiplier
    describe: (n) => `Every restored tile's biomass ×${fmtMult(TUNING.upgradeCurve.soilStep ** n)} (from ×${fmtMult(TUNING.upgradeCurve.soilStep ** (n - 1))})`,
  },
  {
    id: 'seedVault',
    group: 'Storage',
    name: 'Seed Vault',
    icon: '🏺',
    baseCost: 20,
    costMult: 2.5,
    maxLevel: 4,
    describe: (n) => {
      const t = TUNING.storageTiers;
      return `Storage ⚡ ${t.energy[n - 1]}→${t.energy[n]} · 💧 ${t.water[n - 1]}→${t.water[n]} (biomass has no limit)`;
    },
  },
  {
    id: 'droneSpeed',
    group: 'Drones',
    machine: 'droneHub',
    name: 'Drone Dash',
    icon: '🛸',
    baseCost: 25, // E18.7: was 35; the rest of the price is in `extra`
    extra: { energy: { base: 10, mult: 1.4 } },
    costMult: 1.65,
    maxLevel: DRONE_DASH.length - 1,
    describe: (n) => `This hub's drones work ×${DRONE_DASH[n]} as fast (flight and rest)`,
    available: has('droneHub'),
    lockedReason: 'Build a Drone Hub first',
  },
  {
    id: 'pollinatorReach',
    group: 'Machines',
    machine: 'pollinator',
    name: 'Pollinator Reach',
    icon: '🦋',
    baseCost: 28,
    costMult: 1.65,
    maxLevel: 3,
    describe: (n) => `This garden's zone radius ${TUNING.pollinator.reach + n} (from ${TUNING.pollinator.reach + n - 1})`,
    available: has('pollinator'),
    lockedReason: 'Build a Pollinator Garden first',
  },
  {
    id: 'waterBloom',
    group: 'Machines',
    machine: 'condenser',
    name: 'Water Bloom',
    icon: '🌧️',
    baseCost: 30,
    costMult: 1.65,
    maxLevel: 4,
    describe: () => 'This condenser charges 25% faster, waters 1 more tile and also grows green tiles beside it',
    available: has('condenser'),
    lockedReason: 'Build a Water Condenser first',
  },
  {
    id: 'treeResonance',
    group: 'Machines',
    machine: 'motherTree',
    name: 'Mother Tree Resonance',
    icon: '🌳',
    baseCost: 60,
    costMult: 1.65,
    maxLevel: 3,
    describe: () => 'This Mother Tree charges from, and pulses, 1 tile further',
    available: has('motherTree'),
    lockedReason: 'Plant a Mother Tree first',
  },
  {
    id: 'overcharge',
    group: 'Pulse',
    name: 'Overcharge',
    icon: '🌟',
    baseCost: 26,
    costMult: 2,
    maxLevel: 3,
    describe: (n) => `Every ${7 - n}th pulse is Overcharged: it restores everything within 2 tiles`,
  },
  {
    id: 'harvestBurst',
    group: 'Pulse',
    name: 'Harvest Burst',
    icon: '🌾',
    baseCost: 60,
    costMult: 2.4,
    maxLevel: 5,
    describe: (n) => `Harvest Sunlight also gathers ${TUNING.harvest.burstSeconds * n} s of your steady biomass income`,
  },
  {
    id: 'chainHops',
    group: 'Pulse',
    name: 'Chain Hops',
    icon: '🔗',
    baseCost: 90,
    costMult: 2.2,
    maxLevel: 5,
    describe: (n) => `Each Pollinator Garden passes a chain on up to ${TUNING.pollinator.triggersPerChain + 2 * n} times (from ${TUNING.pollinator.triggersPerChain + 2 * (n - 1)})`,
  },
  {
    id: 'droneRadius',
    group: 'Drones',
    machine: 'droneHub',
    name: 'Drone Work Radius',
    icon: '📡',
    baseCost: 28, // E18.7: was 40; the rest of the price is in `extra`
    extra: { energy: { base: 10, mult: 1.4 } },
    costMult: 1.65,
    maxLevel: 4,
    describe: (n) => `This hub's drones reach ${2 * n} tiles further`,
    available: has('droneHub'),
    lockedReason: 'Build a Drone Hub first',
  },
  {
    id: 'chainIntel',
    group: 'Drones',
    machine: 'droneHub',
    name: 'Chain Intelligence',
    icon: '🧠',
    baseCost: 30, // E18.7: was 45; the rest of the price is in `extra`
    extra: { energy: { base: 15, mult: 1 } },
    costMult: 1,
    maxLevel: 1,
    describe: () => "This hub's drones pick tiles next to gardens, idle solar panels and charged Mother Trees first",
    available: has('droneHub'),
    lockedReason: 'Build a Drone Hub first',
  },
  {
    id: 'secondDrone',
    group: 'Drones',
    machine: 'droneHub',
    name: 'Drone Squad',
    icon: '🛸',
    baseCost: 70,
    costMult: 2.5,
    maxLevel: 4,
    describe: (n) => `This hub launches ${n + 1} drones`,
    available: has('droneHub'),
    lockedReason: 'Build a Drone Hub first',
  },
  {
    id: 'droneSweep',
    group: 'Drones',
    machine: 'droneHub',
    name: 'Drone Sweep',
    icon: '🧹',
    baseCost: 85, // E18.7: was 120; the rest of the price is in `extra`
    // E18.7: energy, not the doc's water: drones are short of water, never energy (docs/E18_AUDIT.md).
    extra: { energy: { base: 8, mult: 1.4 } },
    costMult: 2,
    maxLevel: 4,
    describe: (n) => `Each tile this hub's drones restore also restores up to ${2 * n} tiles around it for free`,
    available: has('droneHub'),
    lockedReason: 'Build a Drone Hub first',
  },
  // ───────────── the endless city ─────────────
  {
    id: 'corridorReach',
    group: 'Networks',
    mode: 'city',
    name: 'Green Corridors',
    icon: '🛤️',
    baseCost: 180,
    costMult: 2,
    maxLevel: 2,
    describe: (n) => `Street gardens pass a chain to the next one up to ${6 + 2 * n} tiles away (from ${6 + 2 * (n - 1)})`,
    available: (s) => inCity(s) && s.machines.some((m) => m.type === 'pollinator' && m.roofId === 'g'),
    lockedReason: 'Plant a Pollinator Garden in the city first',
  },
  {
    id: 'relayLens',
    group: 'Networks',
    mode: 'city',
    machine: 'relay',
    name: 'Relay Lens',
    icon: '📡',
    baseCost: 180,
    costMult: 1.65,
    maxLevel: 4,
    describe: (n) => `This relay links up to ${16 + 6 * n} tiles away (from ${16 + 6 * (n - 1)}) and blooms ${2 + n} tiles per pulse`,
    available: (s) => s.machines.some((m) => m.type === 'relay'),
    lockedReason: 'Build a Bloom Relay first',
  },
  {
    id: 'droneMesh',
    group: 'Networks',
    mode: 'city',
    name: 'Drone Mesh',
    icon: '🕸️',
    baseCost: 140, // E18.7: was 200; the rest of the price is in `extra`
    extra: { energy: { base: 25, mult: 1.5 } },
    costMult: 2,
    maxLevel: 2,
    describe: (n) => `Drone Hubs up to ${12 + 4 * n} tiles apart share one network (from ${12 + 4 * (n - 1)}), so their drones roam all of it`,
    available: (s) => s.machines.filter((m) => m.type === 'droneHub').length >= 2,
    lockedReason: 'Build two Drone Hubs first',
  },
  {
    id: 'fogLantern',
    group: 'Fog',
    mode: 'city',
    name: 'Fog Lanterns',
    icon: '🏮',
    baseCost: 150,
    costMult: 2.5,
    maxLevel: 3,
    describe: (n) => `Landmarks wake with ${10 * n}% fewer tiles restored`,
    available: (s) => s.progression.coreActivated,
    lockedReason: 'Wake the fountain first',
  },
  {
    id: 'landmarkLights',
    group: 'Fog',
    mode: 'city',
    name: 'Lit Landmarks',
    icon: '🗼',
    baseCost: 220,
    costMult: 1.65,
    maxLevel: Infinity, // Phase 5 E12: grows with the city
    describe: (n) => `Every cleared area's bonus +${25 * n}% (from +${25 * (n - 1)}%)`,
    available: (s) => Object.entries(s.areas ?? {}).some(([id, a]) => id !== 'park' && a.fog === 'cleared'),
    lockedReason: 'Wake a landmark beyond the park first',
  },
  // Look 6.8: the Cultivator's own upgrades (per machine). Width and speed are paid in energy (it runs on sun),
  // the seed mix, routing and a second tiller in biomass.
  {
    id: 'cultSpeed',
    group: 'Machines',
    machine: 'cultivator',
    costKind: 'energy',
    name: 'Tiller Speed',
    icon: '⚙️',
    baseCost: 25,
    costMult: 1.8,
    maxLevel: 3,
    describe: (n) => `This Cultivator works and drives ${Math.round(TUNING.cultivator.speedPerLevel * n * 100)}% faster`,
    available: has('cultivator'),
    lockedReason: 'Build a Cultivator first',
  },
  {
    id: 'cultWidth',
    group: 'Machines',
    machine: 'cultivator',
    costKind: 'energy',
    name: 'Wide Tines',
    icon: '🔱',
    baseCost: 35,
    costMult: 1.9,
    maxLevel: 2,
    describe: (n) => `Works ${n + 1} tiles side by side`,
    available: has('cultivator'),
    lockedReason: 'Build a Cultivator first',
  },
  {
    id: 'cultSeed',
    group: 'Machines',
    machine: 'cultivator',
    name: 'Seed Mix',
    icon: '🌱',
    baseCost: 160,
    costMult: 2,
    maxLevel: 1,
    describe: () => `Tiles it restores start at bloom ${TUNING.cultivator.seedBloom}`,
    available: has('cultivator'),
    lockedReason: 'Build a Cultivator first',
  },
  {
    id: 'cultRoute',
    group: 'Machines',
    machine: 'cultivator',
    name: 'Fog Seeker',
    icon: '🧭',
    baseCost: 120,
    costMult: 2,
    maxLevel: 1,
    describe: () => `Seeks out the fog's edge, up to ${TUNING.cultivator.routeRadius} tiles from the dock`,
    available: has('cultivator'),
    lockedReason: 'Build a Cultivator first',
  },
  {
    id: 'cultSecond',
    group: 'Machines',
    machine: 'cultivator',
    name: 'Second Tiller',
    icon: '🚜',
    baseCost: 300,
    costMult: 2,
    maxLevel: 1,
    describe: () => 'A second tiller works from the same dock',
    available: has('cultivator'),
    lockedReason: 'Build a Cultivator first',
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
