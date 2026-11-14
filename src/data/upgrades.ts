import type { GameState } from '../core/types';

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
  maxLevel: number;
  describe: (nextLevel: number) => string;
  available?: (s: GameState) => boolean;
  lockedReason?: string;
}

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
    id: 'solarArray',
    group: 'Machines',
    name: 'Solar Array',
    icon: '☀️',
    baseCost: 14,
    costMult: 2,
    maxLevel: 3,
    describe: () => 'All solar output +50%',
  },
  {
    id: 'broadPulse',
    group: 'Pulse',
    name: 'Wide Pulse',
    icon: '💠',
    baseCost: 22,
    costMult: 2.2,
    maxLevel: 3,
    describe: (n) => (n === 1 ? 'Each pulse also restores 2 neighbouring tiles for free' : n === 2 ? 'Each pulse restores all 4 neighbours for free' : 'Each pulse restores everything within 2 tiles for free'),
  },
  {
    id: 'richSoil',
    group: 'Machines',
    name: 'Rich Soil',
    icon: '🌱',
    baseCost: 25,
    costMult: 2,
    maxLevel: 3,
    describe: () => 'Restored tile biomass +30%',
  },
  {
    id: 'seedVault',
    group: 'Storage',
    name: 'Seed Vault',
    icon: '🏺',
    baseCost: 20,
    costMult: 1.8,
    maxLevel: 4,
    describe: () => 'All storage caps +50%',
  },
  {
    id: 'droneSpeed',
    group: 'Drones',
    name: 'Drone Dash',
    icon: '🛸',
    baseCost: 35,
    costMult: 1.8,
    maxLevel: 3,
    describe: () => 'Drones fly 30% faster and wait 25% less between jobs',
    available: has('droneHub'),
    lockedReason: 'Build a Drone Hub first',
  },
  {
    id: 'pollinatorReach',
    group: 'Machines',
    name: 'Pollinator Reach',
    icon: '🦋',
    baseCost: 28,
    costMult: 2,
    maxLevel: 2,
    describe: () => 'Pollinator zone radius +1',
    available: has('pollinator'),
    lockedReason: 'Build a Pollinator Garden first',
  },
  {
    id: 'waterBloom',
    group: 'Machines',
    name: 'Water Bloom',
    icon: '🌧️',
    baseCost: 30,
    costMult: 2,
    maxLevel: 2,
    describe: () => 'Condensers charge 25% faster, water 1 more tile and also grow green tiles beside them',
    available: has('condenser'),
    lockedReason: 'Build a Water Condenser first',
  },
  {
    id: 'treeResonance',
    group: 'Machines',
    name: 'Mother Tree Resonance',
    icon: '🌳',
    baseCost: 60,
    costMult: 2,
    maxLevel: 2,
    describe: () => 'Mother Tree charges from, and pulses, 1 tile further',
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
    id: 'droneRadius',
    group: 'Drones',
    name: 'Drone Work Radius',
    icon: '📡',
    baseCost: 40,
    costMult: 2,
    maxLevel: 2,
    describe: () => 'Drones reach 1 tile further from their hub',
    available: has('droneHub'),
    lockedReason: 'Build a Drone Hub first',
  },
  {
    id: 'chainIntel',
    group: 'Drones',
    name: 'Chain Intelligence',
    icon: '🧠',
    baseCost: 45,
    costMult: 1,
    maxLevel: 1,
    describe: () => 'Drones pick tiles next to gardens, idle solar panels and charged Mother Trees first',
    available: has('droneHub'),
    lockedReason: 'Build a Drone Hub first',
  },
  {
    id: 'secondDrone',
    group: 'Drones',
    name: 'Second Drone',
    icon: '🛸',
    baseCost: 70,
    costMult: 1,
    maxLevel: 1,
    describe: () => 'Your first hub launches a second drone',
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
    name: 'Relay Lens',
    icon: '📡',
    baseCost: 180,
    costMult: 2,
    maxLevel: 2,
    describe: (n) => `Bloom Relays link up to ${16 + 6 * n} tiles apart (from ${16 + 6 * (n - 1)}) and bloom ${2 + n} tiles per pulse`,
    available: (s) => s.machines.some((m) => m.type === 'relay'),
    lockedReason: 'Build a Bloom Relay first',
  },
  {
    id: 'droneMesh',
    group: 'Networks',
    mode: 'city',
    name: 'Drone Mesh',
    icon: '🕸️',
    baseCost: 200,
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
    costMult: 2.2,
    maxLevel: 3,
    describe: (n) => `Every cleared area's bonus +${25 * n}%`,
    available: (s) => Object.entries(s.areas ?? {}).some(([id, a]) => id !== 'park' && a.fog === 'cleared'),
    lockedReason: 'Wake a landmark beyond the park first',
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
