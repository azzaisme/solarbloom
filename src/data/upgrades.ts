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
    describe: () => 'This panel makes more power, and a lot more every tenth time',
  },
  {
    id: 'broadPulse',
    name: 'Pulse Reach',
    icon: '💠',
    maxLevel: 4,
    describe: (n) => {
      const t = TUNING.pulseTiers[n];
      return `${t.name}: each pulse turns more of the ground around it green, for no extra Charge`;
    },
  },
  {
    id: 'droneSpeed',
    machine: 'droneHub',
    name: 'Drone Dash',
    icon: '🛸',
    maxLevel: DRONE_DASH.length - 1,
    describe: () => "This hub's drones fly faster and rest for less time",
  },
  {
    id: 'pollinatorReach',
    machine: 'pollinator',
    name: 'Wider Garden',
    icon: '🦋',
    maxLevel: 3,
    describe: () => "This garden's flowers spread a little further around it",
  },
  {
    id: 'waterBloom',
    machine: 'condenser',
    name: 'Water Bloom',
    icon: '🌧️',
    maxLevel: 4,
    describe: () => 'This condenser fills faster, waters a little more ground, and helps the green ground beside it grow',
  },
  {
    id: 'treeResonance',
    machine: 'motherTree',
    name: 'Mother Tree Resonance',
    icon: '🌳',
    maxLevel: 3,
    describe: () => 'This Mother Tree fills up from, and sends its pulse over, a little more of the ground around it',
  },
  {
    id: 'overcharge',
    name: 'Overcharge',
    icon: '🌟',
    maxLevel: 3,
    describe: (n) => `Every ${7 - n}th pulse is extra strong: all the ground right around it turns green`,
  },
  {
    id: 'chainHops',
    name: 'Flowers Travel',
    icon: '🔗',
    maxLevel: 5,
    describe: () => 'The flowers spread on from each Pollinator Garden a few more times',
  },
  {
    id: 'droneRadius',
    machine: 'droneHub',
    name: 'Drones Work Further',
    icon: '📡',
    maxLevel: 4,
    describe: () => "This hub's drones work further from home",
  },
  {
    id: 'chainIntel',
    machine: 'droneHub',
    name: 'Smarter Drones',
    icon: '🧠',
    maxLevel: 1,
    describe: () => "This hub's drones go first to the ground beside gardens, resting solar panels and full Mother Trees",
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
    describe: () => "Each patch this hub's drones turn green brings a little of the ground around it back too",
  },
  // ───────────── the endless city ─────────────
  {
    id: 'corridorReach',
    name: 'Green Corridors',
    icon: '🛤️',
    maxLevel: 2,
    describe: () => 'The flowers spread from one street garden to the next, even further apart',
  },
  {
    id: 'relayLens',
    machine: 'relay',
    name: 'Relay Lens',
    icon: '📡',
    maxLevel: 4,
    describe: () => 'This relay joins up with relays further away, and brings more ground into flower each time',
  },
  {
    id: 'droneMesh',
    name: 'Drone Mesh',
    icon: '🕸️',
    maxLevel: 2,
    describe: () => 'Drone Hubs further apart work together, so their drones roam the ground around all of them',
  },
  {
    id: 'fogLantern',
    name: 'Fog Lanterns',
    icon: '🏮',
    maxLevel: 3,
    describe: () => 'Landmarks wake sooner, with less green ground around them',
  },
  // Look 6.8: the Cultivator's own upgrades (per machine). Width and speed are paid in energy (it runs on sun),
  // the seed mix, routing and a second tiller in biomass.
  {
    id: 'cultSpeed',
    machine: 'cultivator',
    name: 'Tiller Speed',
    icon: '⚙️',
    maxLevel: 3,
    describe: () => 'This Cultivator works and drives faster',
  },
  {
    id: 'cultWidth',
    machine: 'cultivator',
    name: 'Wide Tines',
    icon: '🔱',
    maxLevel: 2,
    describe: (n) => `Works ${n + 1} rows of ground side by side`,
  },
  {
    id: 'cultSeed',
    machine: 'cultivator',
    name: 'Seed Mix',
    icon: '🌱',
    maxLevel: 1,
    describe: () => 'The ground it clears comes back already in leaf',
  },
  {
    id: 'cultRoute',
    machine: 'cultivator',
    name: 'Fog Seeker',
    icon: '🧭',
    maxLevel: 1,
    describe: () => 'Heads for the edge of the fog nearby all by itself',
  },
  {
    id: 'cultSecond',
    machine: 'cultivator',
    name: 'Second Tiller',
    icon: '🚜',
    maxLevel: 1,
    describe: () => 'A second tiller works from the same home',
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
