import type { BuildableType, Cost, GroundState, MachineType } from '../core/types';

export interface MachineDef {
  type: MachineType;
  name: string;
  icon: string;
  size: number;
  cost: Cost;
  allowedGround: GroundState[];
  blurb: string;
  hotkey?: string;
}

export const MACHINES: Record<MachineType, MachineDef> = {
  solar: {
    type: 'solar',
    name: 'Solar Panel',
    icon: '☀️',
    size: 1,
    cost: { biomass: 10 },
    allowedGround: ['restored', 'prepared'],
    blurb: '+2 energy/s. Blooms next to it double its output for 5 s.',
    hotkey: '3',
  },
  condenser: {
    type: 'condenser',
    name: 'Water Condenser',
    icon: '💧',
    size: 1,
    cost: { biomass: 12, energy: 8 },
    allowedGround: ['restored', 'prepared'],
    blurb: '+1 water/s. Every 5 s it irrigates a mossy tile beside it into bloom.',
    hotkey: '4',
  },
  pollinator: {
    type: 'pollinator',
    name: 'Pollinator Garden',
    icon: '🌸',
    size: 1,
    cost: { biomass: 16, water: 6 },
    allowedGround: ['restored', 'prepared'],
    blurb: 'Doubles biomass nearby. Restorations inside its zone spread to mossy neighbours: Bloom Chains!',
    hotkey: '5',
  },
  droneHub: {
    type: 'droneHub',
    name: 'Drone Hub',
    icon: '🛸',
    size: 2,
    cost: { biomass: 30, energy: 20 },
    allowedGround: ['restored', 'prepared'],
    blurb: 'Launches a little drone that restores tiles within 3 tiles of the hub, paying the usual pulse cost.',
    hotkey: '6',
  },
  core: {
    type: 'core',
    name: 'Rooftop Core',
    icon: '✨',
    size: 2,
    cost: {},
    allowedGround: ['polluted', 'prepared', 'restored'],
    blurb: 'An ancient bloom engine. Awaken it to restore the whole building.',
  },
};

export const BUILDABLE: BuildableType[] = ['solar', 'condenser', 'pollinator', 'droneHub'];
