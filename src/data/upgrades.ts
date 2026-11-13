import type { GameState } from '../core/types';

export interface UpgradeDef {
  id: string;
  name: string;
  icon: string;
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
    name: 'Efficient Pulse',
    icon: '⚡',
    baseCost: 8,
    costMult: 2,
    maxLevel: 3,
    describe: () => 'Pulse energy cost −25%',
  },
  {
    id: 'solarArray',
    name: 'Solar Array',
    icon: '☀️',
    baseCost: 10,
    costMult: 2,
    maxLevel: 3,
    describe: () => 'All solar output +50%',
  },
  {
    id: 'broadPulse',
    name: 'Broad Pulse',
    icon: '💠',
    baseCost: 12,
    costMult: 2.2,
    maxLevel: 3,
    describe: (n) => `Each pulse also restores ${n} neighbouring tile${n > 1 ? 's' : ''} for free`,
  },
  {
    id: 'richSoil',
    name: 'Rich Soil',
    icon: '🌱',
    baseCost: 14,
    costMult: 2,
    maxLevel: 3,
    describe: () => 'Restored tile biomass +50%',
  },
  {
    id: 'seedVault',
    name: 'Seed Vault',
    icon: '🏺',
    baseCost: 18,
    costMult: 1.8,
    maxLevel: 4,
    describe: () => 'All storage caps +50%',
  },
  {
    id: 'droneSpeed',
    name: 'Drone Speed',
    icon: '🛸',
    baseCost: 20,
    costMult: 1.8,
    maxLevel: 3,
    describe: () => 'Drone cycle time −25%, flies faster',
    available: has('droneHub'),
    lockedReason: 'Build a Drone Hub first',
  },
  {
    id: 'pollinatorReach',
    name: 'Pollinator Reach',
    icon: '🦋',
    baseCost: 24,
    costMult: 2,
    maxLevel: 2,
    describe: () => 'Pollinator zone radius +1',
    available: has('pollinator'),
    lockedReason: 'Build a Pollinator Garden first',
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
