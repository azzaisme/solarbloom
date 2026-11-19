import { TUNING } from './tuning';
import type { BuildableType, GroundState, MachineType } from '../core/types';

export interface MachineDef {
  type: MachineType;
  name: string;
  icon: string;
  size: number;
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
    allowedGround: ['restored', 'prepared'],
    blurb: 'Feeds the grid in sunlight. A bloom beside it makes it shine twice as bright for a few seconds.',
    hotkey: '3',
  },
  condenser: {
    type: 'condenser',
    name: 'Water Condenser',
    icon: '💧',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Its charge meter fills, then it waters the dry soil beside it into bloom, starting a chain.',
    hotkey: '4',
  },
  pollinator: {
    type: 'pollinator',
    name: 'Pollinator Garden',
    icon: '🌸',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Restorations inside its zone spread to mossy neighbours: Bloom Chains!',
    hotkey: '5',
  },
  droneHub: {
    type: 'droneHub',
    name: 'Drone Hub',
    icon: '🛸',
    size: 2,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Launches a little drone that restores tiles within 3 tiles of the hub. It runs on the grid.',
    hotkey: '6',
  },
  motherTree: {
    type: 'motherTree',
    name: 'Mother Tree',
    icon: '🌳',
    size: 2,
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
    allowedGround: ['restored', 'prepared'],
    blurb: 'Water Condensers within 2 tiles fill its basin. When full it Overflows: up to 3 dry tiles nearby burst into lush bloom.',
    hotkey: '8',
    areaTypes: ['reservoir'],
  },
  relay: {
    type: 'relay',
    name: 'Bloom Relay',
    icon: '📡',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Links with every other relay in range. A bloom right beside it sends a pulse to each linked relay, which blooms the ground there (once per link per chain, then it recharges).',
    hotkey: '9',
    unlock: { needs: 'droneHub', label: 'Build a Drone Hub to unlock' },
    cityOnly: true,
  },
  cultivator: {
    type: 'cultivator',
    name: 'Cultivator',
    icon: '🚜',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: `A solar tiller: drives over dead ground within ${TUNING.cultivator.radius} tiles of its dock and slowly breaks it into bloom on its own, on power from the grid.`,
    hotkey: '0',
    unlock: { needs: 'droneHub', label: 'Build a Drone Hub to unlock' },
    cityOnly: true,
  },
  // E21.1: a way into the city's store (placed by the world, never in the build list).
  chest: {
    type: 'chest',
    name: 'Storage Chest',
    icon: '📦',
    size: 1,
    allowedGround: ['restored', 'prepared', 'polluted'],
    blurb: 'A way into the city’s shared store: open it to put things away or take them out.',
  },
  // E23.5.2: a planter box: crops grow in it over game days.
  planter: {
    type: 'planter',
    name: 'Planter',
    icon: '🟫',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'A raised bed: plant seeds in it, keep it watered and harvest food.',
  },
  // E23.3.2: the grid's storage and its weather power.
  battery: {
    type: 'battery',
    name: 'Battery',
    icon: '🔋',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Stores what the grid has spare and gives it back after dark.',
  },
  windTurbine: {
    type: 'windTurbine',
    name: 'Wind Turbine',
    icon: '🌬',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Turns on windy days and in storms. It catches more wind on high ground.',
  },
  // E23.3.3: bloombot sits on it to recharge from the grid.
  charger: {
    type: 'charger',
    name: 'Charger',
    icon: '🔌',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'A pad on the grid. Sit on it and bloombot fills up fast.',
  },
  core: {
    type: 'core',
    name: 'Rooftop Core',
    icon: '✨',
    size: 2,
    allowedGround: ['polluted', 'prepared', 'restored'],
    blurb: 'An ancient bloom engine. Awaken it to restore the whole building.',
  },
};

/** E21.3: what can be built (E23.1.1: one list, the Old City's; E23.7.4 dropped the Reclaimer; E23.3 adds the grid; E23.5.2 the Planter). */
export const BUILDABLE: BuildableType[] = ['solar', 'condenser', 'chest', 'planter', 'battery', 'charger', 'pollinator', 'droneHub', 'windTurbine', 'reservoirGarden', 'motherTree', 'relay', 'cultivator'];

/**
 * Phase 5 E13: machines that merge. Three edge-connected tier-1 machines of one type become one tier 2 on the
 * anchor's footprint. Tier 3 (superstructures) arrives with E14; until then tier 2 is the top.
 */
export interface TierDef {
  name: string;
  icon: string;
  /** what tier 2 does, for previews */
  blurb: string;
}
export const TIER2: Partial<Record<MachineType, TierDef>> = {
  solar: { name: 'Solar Array', icon: '🔆', blurb: `×${TUNING.merge.solarMult} energy (and ×${TUNING.merge.solarMult} bloom bursts)` },
  condenser: { name: 'Condenser Array', icon: '💠', blurb: `×${TUNING.merge.waterMult} water, and each watering wets ${TUNING.merge.condenserExtraTargets} more tiles` },
  pollinator: { name: 'Bloom Garden', icon: '💮', blurb: `Biomass bonus ×${TUNING.merge.gardenBiomassMult} (was ×${TUNING.pollinator.biomassMult}) and zone radius +${TUNING.merge.gardenReachBonus}` },
  droneHub: { name: 'Fleet Hub', icon: '🚀', blurb: '×3 drones (up to 12) and work radius +2' },
};
/** Phase 5 E14: three tier-2 machines merge into a Superstructure Core, placed and built as a tier 3. */
export interface SuperDef extends TierDef {
  size: number;
  /** what its ability does, for previews */
  ability: string;
}
export const TIER3: Partial<Record<MachineType, SuperDef>> = {
  solar: { name: 'Solar Megaflower', icon: '🌻', size: 2, blurb: `×${TUNING.super.outputMult} a panel’s energy`, ability: 'Solar Burst: every panel’s energy ×3 for 15 s' },
  condenser: { name: 'Water Nexus', icon: '🌊', size: 2, blurb: `×${TUNING.super.outputMult} a condenser’s water`, ability: 'Irrigation Wave: up to 24 connected dry or growing tiles bloom' },
  pollinator: { name: 'Tree of Life', icon: '🌲', size: 3, blurb: `Biomass ×${TUNING.super.treeOfLife.gardenMult} within ${TUNING.pollinator.reach + TUNING.super.treeOfLife.gardenReachBonus} tiles`, ability: 'Evolution: the 12 least-grown tiles nearby grow a stage (stores up to 3)' },
  droneHub: { name: 'Drone Megahub', icon: '🛰️', size: 2, blurb: 'Fleet drones, work radius +4', ability: 'Swarm: 6 extra drones for 30 s, each restoring several tiles per job' },
};
/** The highest tier a machine can merge from (three tier 2s make a core). */
export const MAX_MERGE_TIER = 2;
export const MAX_TIER = 3;

export function isMergeable(type: MachineType): boolean {
  return !!TIER2[type];
}
export function tierOf(m: { tier?: number }): number {
  return m.tier ?? 1;
}
/** A machine's display name for its tier. */
export function machineName(m: { type: MachineType; tier?: number }): string {
  const t = tierOf(m);
  return t >= 3 && TIER3[m.type] ? TIER3[m.type]!.name : t >= 2 && TIER2[m.type] ? TIER2[m.type]!.name : MACHINES[m.type].name;
}
export function machineIcon(m: { type: MachineType; tier?: number }): string {
  const t = tierOf(m);
  return t >= 3 && TIER3[m.type] ? TIER3[m.type]!.icon : t >= 2 && TIER2[m.type] ? TIER2[m.type]!.icon : MACHINES[m.type].icon;
}

/** Phase 5 E14: false while a superstructure is still under construction (it does nothing until built). */
export function isBuilt(m: { project?: { stage: number } }): boolean {
  return !m.project || m.project.stage >= 3;
}
