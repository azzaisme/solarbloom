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
  unlock?: { needs: MachineType; label: string };
  /** Only buildable on these rooftops (a roof's specialty piece). */
  roofs?: string[];
  /** In the city: only buildable in these area types. */
  areaTypes?: string[];
  /** Only in the endless city (not the rooftop campaign). */
  cityOnly?: boolean;
}

export const MACHINES: Record<MachineType, MachineDef> = {
  solar: {
    type: 'solar',
    name: 'Solar Panel',
    icon: '☀️',
    size: 1,
    cost: { biomass: 20 },
    allowedGround: ['restored', 'prepared'],
    blurb: '+1.2 energy/s. Blooms next to it double its output for 5 s.',
    hotkey: '3',
  },
  condenser: {
    type: 'condenser',
    name: 'Water Condenser',
    icon: '💧',
    size: 1,
    cost: { biomass: 35, energy: 12 },
    allowedGround: ['restored', 'prepared'],
    blurb: '+1 water/s. Its charge meter fills, then it waters the dry soil beside it into bloom, starting a chain.',
    hotkey: '4',
  },
  pollinator: {
    type: 'pollinator',
    name: 'Pollinator Garden',
    icon: '🌸',
    size: 1,
    cost: { biomass: 50, water: 12 },
    allowedGround: ['restored', 'prepared'],
    blurb: 'Doubles biomass nearby. Restorations inside its zone spread to mossy neighbours: Bloom Chains!',
    hotkey: '5',
  },
  droneHub: {
    type: 'droneHub',
    name: 'Drone Hub',
    icon: '🛸',
    size: 2,
    cost: { biomass: 110, energy: 35 },
    allowedGround: ['restored', 'prepared'],
    blurb: 'Launches a little drone that restores tiles within 3 tiles of the hub, paying the usual pulse cost.',
    hotkey: '6',
  },
  motherTree: {
    type: 'motherTree',
    name: 'Mother Tree',
    icon: '🌳',
    size: 2,
    cost: { biomass: 170, water: 40 },
    allowedGround: ['restored', 'prepared'],
    blurb: 'Every restoration within 2 tiles charges it. At full charge it releases a Bloom Pulse that restores and grows everything around it.',
    hotkey: '7',
    unlock: { needs: 'droneHub', label: 'Build a Drone Hub to unlock' },
  },
  reservoirGarden: {
    type: 'reservoirGarden',
    name: 'Reservoir Garden',
    icon: '⛲',
    size: 1,
    cost: { biomass: 60, water: 20 },
    allowedGround: ['restored', 'prepared'],
    blurb: 'Water Condensers within 2 tiles fill its basin. When full it Overflows: up to 3 dry tiles nearby burst into lush bloom (×2 🌿 for a while).',
    hotkey: '8',
    areaTypes: ['reservoir', 'canal'],
  },
  relay: {
    type: 'relay',
    name: 'Bloom Relay',
    icon: '📡',
    size: 1,
    cost: { biomass: 90, energy: 40 },
    allowedGround: ['restored', 'prepared'],
    blurb: 'Links with every other relay in range. A bloom right beside it sends a pulse to each linked relay, which blooms the ground there (once per link per chain, then it recharges).',
    hotkey: '9',
    unlock: { needs: 'droneHub', label: 'Build a Drone Hub to unlock' },
    cityOnly: true,
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

export const BUILDABLE: BuildableType[] = ['solar', 'condenser', 'pollinator', 'droneHub', 'motherTree', 'reservoirGarden', 'relay'];
