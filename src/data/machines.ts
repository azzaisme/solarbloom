import { TUNING } from './tuning';
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
    cost: { biomass: 80, energy: 30 }, // Phase 4 E01.1: fits the starting store (was 110 🌿 / 35 ⚡)
    allowedGround: ['restored', 'prepared'],
    blurb: 'Launches a little drone that restores tiles within 3 tiles of the hub, paying the usual pulse cost.',
    hotkey: '6',
  },
  motherTree: {
    type: 'motherTree',
    name: 'Mother Tree',
    icon: '🌳',
    size: 2,
    cost: { biomass: 90, water: 30 }, // Phase 4 E01.1: fits the starting store (was 170 🌿 / 40 💧)
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
  cultivator: {
    type: 'cultivator',
    name: 'Cultivator',
    icon: '🚜',
    size: 1,
    cost: { biomass: 140, energy: 30 },
    allowedGround: ['restored', 'prepared'],
    blurb: `A solar tiller: drives over dead ground within ${TUNING.cultivator.radius} tiles of its dock and slowly breaks it into bloom on its own, for energy instead of pulses.`,
    hotkey: '0',
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

export const BUILDABLE: BuildableType[] = ['solar', 'condenser', 'pollinator', 'droneHub', 'motherTree', 'reservoirGarden', 'relay', 'cultivator'];

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
