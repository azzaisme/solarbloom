import type { MachineType } from '../core/types';
import { TUNING } from './tuning';

/**
 * What each upgrade does, and how many levels it has. E23.1.5: nothing here is bought any more (no prices, no
 * drawer): research (E23.6.2) grants levels through `UpgradeSystem.grant`, which every effect reads.
 */
export interface UpgradeDef {
  id: string;
  name: string;
  icon: string;
  /** Infinity = no last level. */
  maxLevel: number;
  /** A per-machine upgrade: its level lives on each machine of this type. Unset = global. */
  machine?: MachineType;
  describe: (nextLevel: number) => string;
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

export const UPGRADES: UpgradeDef[] = [
  {
    // Bloombot's sprint, one level: hold the sprint key to hover a little off the ground and move faster
    // (BOT.sprint instead of BOT.walk). Read by BotController. Fountain tier 2's Hover ability counts too (BotController).
    id: 'hover',
    name: 'Hover',
    icon: '🚀',
    maxLevel: 1,
    describe: () => 'Hold Shift (or the right trigger) to hover a little off the ground and move faster',
  },
  {
    id: 'solarArray', // saved id kept; shown as Solar Wings (Phase 5: "Array" becomes the merged T2 panel's name)
    machine: 'solar',
    name: 'Solar Wings',
    icon: '☀️',
    maxLevel: Infinity,
    describe: (n) => `This panel feeds the grid ×${fmtMult(powerMult(0.5, n))} (from ×${fmtMult(powerMult(0.5, n - 1))}); doubles every 10 levels`,
  },
  {
    id: 'broadPulse',
    name: 'Pulse Reach',
    icon: '💠',
    maxLevel: 4,
    describe: (n) => {
      const t = TUNING.pulseTiers[n];
      const tiles = [1, 9, 25, 69, 161][n];
      return `${t.name}: each pulse restores up to ${tiles} tiles around it for free`;
    },
  },
  {
    id: 'droneSpeed',
    machine: 'droneHub',
    name: 'Drone Dash',
    icon: '🛸',
    maxLevel: DRONE_DASH.length - 1,
    describe: (n) => `This hub's drones fly and recharge ${DRONE_DASH[n]} times as fast`,
  },
  {
    id: 'pollinatorReach',
    machine: 'pollinator',
    name: 'Pollinator Reach',
    icon: '🦋',
    maxLevel: 3,
    describe: (n) => `This garden's zone radius ${TUNING.pollinator.reach + n} (from ${TUNING.pollinator.reach + n - 1})`,
  },
  {
    id: 'waterBloom',
    machine: 'condenser',
    name: 'Water Bloom',
    icon: '🌧️',
    maxLevel: 4,
    describe: () => 'This condenser charges 25% faster, waters 1 more tile and also grows green tiles beside it',
  },
  {
    id: 'treeResonance',
    machine: 'motherTree',
    name: 'Mother Tree Resonance',
    icon: '🌳',
    maxLevel: 3,
    describe: () => 'This Mother Tree charges from, and pulses, 1 tile further',
  },
  {
    id: 'overcharge',
    name: 'Overcharge',
    icon: '🌟',
    maxLevel: 3,
    describe: (n) => `Every ${7 - n}th pulse is Overcharged: it restores everything within 2 tiles`,
  },
  {
    id: 'chainHops',
    name: 'Chain Hops',
    icon: '🔗',
    maxLevel: 5,
    describe: (n) => `Each Pollinator Garden passes a chain on up to ${TUNING.pollinator.triggersPerChain + 2 * n} times (from ${TUNING.pollinator.triggersPerChain + 2 * (n - 1)})`,
  },
  {
    id: 'droneRadius',
    machine: 'droneHub',
    name: 'Drone Work Radius',
    icon: '📡',
    maxLevel: 4,
    describe: (n) => `This hub's drones reach ${2 * n} tiles further`,
  },
  {
    id: 'chainIntel',
    machine: 'droneHub',
    name: 'Chain Intelligence',
    icon: '🧠',
    maxLevel: 1,
    describe: () => "This hub's drones pick tiles next to gardens, idle solar panels and charged Mother Trees first",
  },
  {
    id: 'secondDrone',
    machine: 'droneHub',
    name: 'Drone Squad',
    icon: '🛸',
    maxLevel: 4,
    describe: (n) => `This hub launches ${n + 1} drones`,
  },
  {
    id: 'droneSweep',
    machine: 'droneHub',
    name: 'Drone Sweep',
    icon: '🧹',
    maxLevel: 4,
    describe: (n) => `Each tile this hub's drones restore also restores up to ${2 * n} tiles around it for free`,
  },
  // ───────────── the endless city ─────────────
  {
    id: 'corridorReach',
    name: 'Green Corridors',
    icon: '🛤️',
    maxLevel: 2,
    describe: (n) => `Street gardens pass a chain to the next one up to ${6 + 2 * n} tiles away (from ${6 + 2 * (n - 1)})`,
  },
  {
    id: 'relayLens',
    machine: 'relay',
    name: 'Relay Lens',
    icon: '📡',
    maxLevel: 4,
    describe: (n) => `This relay links up to ${16 + 6 * n} tiles away (from ${16 + 6 * (n - 1)}) and blooms ${2 + n} tiles per pulse`,
  },
  {
    id: 'droneMesh',
    name: 'Drone Mesh',
    icon: '🕸️',
    maxLevel: 2,
    describe: (n) => `Drone Hubs up to ${12 + 4 * n} tiles apart share one network (from ${12 + 4 * (n - 1)}), so their drones roam all of it`,
  },
  {
    id: 'fogLantern',
    name: 'Fog Lanterns',
    icon: '🏮',
    maxLevel: 3,
    describe: (n) => `Landmarks wake with ${10 * n}% fewer tiles restored`,
  },
  // Look 6.8: the Cultivator's own upgrades (per machine). Width and speed are paid in energy (it runs on sun),
  // the seed mix, routing and a second tiller in biomass.
  {
    id: 'cultSpeed',
    machine: 'cultivator',
    name: 'Tiller Speed',
    icon: '⚙️',
    maxLevel: 3,
    describe: (n) => `This Cultivator works and drives ${Math.round(TUNING.cultivator.speedPerLevel * n * 100)}% faster`,
  },
  {
    id: 'cultWidth',
    machine: 'cultivator',
    name: 'Wide Tines',
    icon: '🔱',
    maxLevel: 2,
    describe: (n) => `Works ${n + 1} tiles side by side`,
  },
  {
    id: 'cultSeed',
    machine: 'cultivator',
    name: 'Seed Mix',
    icon: '🌱',
    maxLevel: 1,
    describe: () => `Tiles it restores start at bloom ${TUNING.cultivator.seedBloom}`,
  },
  {
    id: 'cultRoute',
    machine: 'cultivator',
    name: 'Fog Seeker',
    icon: '🧭',
    maxLevel: 1,
    describe: () => `Seeks out the fog's edge, up to ${TUNING.cultivator.routeRadius} tiles from the dock`,
  },
  {
    id: 'cultSecond',
    machine: 'cultivator',
    name: 'Second Tiller',
    icon: '🚜',
    maxLevel: 1,
    describe: () => 'A second tiller works from the same dock',
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
