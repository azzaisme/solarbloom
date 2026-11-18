// E23.8.2 (#400): what each region unlocks. Systems arrive one region at a time, handed over by each Keeper when it
// wakes (Home's arrive with the start of the game). All data: ids are the E23 build/item ids, and several belong to
// sessions still landing (power, water, farm, crafting), so code asks `isUnlocked(id)` rather than hard-coding a region.

import type { RegionId } from './oldcity';

export type UnlockSource = 'home' | RegionId;

export type UnlockKind = 'system' | 'tool' | 'machine' | 'drone' | 'crop';

export interface UnlockDef {
  id: string;
  name: string;
  kind: UnlockKind;
  /**
   * Hard needs: unlocks that must already be held for this one to be any use (a pump needs pipes). The reachability
   * test proves each is held in every order of play. Because Tally trades any material for any other, few regions
   * are certain to come before another, so most links between regions are soft (`uses`), never hard.
   */
  needs?: string[];
  /** Soft: unlocks it works better with, but it does something without them (a lamp on the grid or a panel). */
  uses?: string[];
}

const U = (id: string, name: string, kind: UnlockKind, needs?: string[], uses?: string[]): UnlockDef => ({ id, name, kind, ...(needs ? { needs } : {}), ...(uses ? { uses } : {}) });

export const REGION_UNLOCKS: Record<UnlockSource, UnlockDef[]> = {
  home: [
    U('charge', 'Charge', 'system'),
    U('eating', 'Eating', 'system'),
    U('planter', 'Planter boxes', 'machine'),
    U('wateringCan', 'Watering can', 'tool'),
    U('compostBin', 'Compost bin', 'machine'),
    U('craftingTable', 'Crafting table', 'machine'),
  ],
  // ── ring 1: none of these depend on another ring 1 region's ──
  mastRow: [
    U('powerPole', 'Power poles', 'machine', ['wire']),
    U('charger', 'Chargers', 'machine', ['charge'], ['powerPole']),
    U('wire', 'Wire', 'tool'),
  ],
  oldMarket: [
    U('solar', 'Solar panels', 'machine', undefined, ['powerPole', 'battery']),
    U('lamp', 'Lamps', 'machine', undefined, ['solar', 'powerPole']),
    U('trade', 'Trading', 'system'),
  ],
  saltwind: [
    U('windTurbine', 'Wind turbines', 'machine', undefined, ['powerPole', 'battery']),
    U('storageChest', 'Storage chests', 'machine'),
  ],
  elderGrove: [
    U('moreSeeds', 'More crop seeds', 'crop', ['planter']),
    U('beehive', 'Beehives', 'machine', undefined, ['orchard', 'planter']),
    U('orchard', 'Orchards', 'machine', undefined, ['wateringCan']),
  ],
  // ── ring 2 ──
  cistern: [
    U('reservoir', 'Reservoirs', 'machine', undefined, ['pipe']),
    U('pump', 'Pumps', 'machine', ['pipe'], ['powerPole', 'solar', 'windTurbine']),
    U('pipe', 'Pipes', 'tool'),
    U('desalinationPlant', 'Desalination plants', 'machine', ['pipe'], ['powerPole', 'windTurbine']),
    U('floodedBed', 'Flooded beds', 'machine', ['planter', 'pipe']),
    U('gravityFeed', 'Gravity feeds', 'machine', ['pipe', 'reservoir']),
  ],
  clockPlaza: [
    U('motor', 'Motors', 'machine', undefined, ['powerPole']),
    U('battery', 'Batteries', 'machine', undefined, ['powerPole', 'solar', 'windTurbine']),
    U('bioDigester', 'The Bio Digester', 'machine', ['compostBin'], ['powerPole']),
    U('mulcher', 'Mulcher', 'machine', ['motor']),
    U('courierDrone', 'Courier drones', 'drone', ['battery'], ['storageChest']),
  ],
  terraces: [
    U('hopperComposter', 'Hopper composter', 'machine', ['compostBin']),
    U('feedTank', 'Feed tank', 'machine', undefined, ['pipe']),
    U('sprinkler', 'Sprinklers', 'machine', undefined, ['pipe', 'pump', 'reservoir']),
    U('roofGarden', 'Roof gardens', 'machine', ['planter'], ['sprinkler']),
  ],
  // ── ring 3 ──
  glasshouse: [
    U('greenhouse', 'Greenhouses', 'machine', ['planter']),
    U('mushroomLog', 'Mushroom logs', 'crop'),
    U('harvesterDrone', 'Harvester drones', 'drone', ['craftingTable'], ['battery', 'motor', 'storageChest']),
    U('seedDrill', 'Seed drills', 'machine', ['planter'], ['motor', 'moreSeeds']),
  ],
  observatory: [
    U('autoFeeder', 'Auto-feeder', 'machine', ['eating', 'feedTank']),
    U('largeSolar', 'Large solar arrays', 'machine', undefined, ['solar', 'powerPole']),
    U('bigBattery', 'Big batteries', 'machine', undefined, ['battery', 'powerPole']),
  ],
  spireHeights: [
    U('assembler', 'The Assembler', 'machine', ['craftingTable'], ['motor']),
    U('largeReservoir', 'Large reservoirs', 'machine', undefined, ['reservoir', 'pipe']),
    U('turbineField', 'Turbine fields', 'machine', undefined, ['windTurbine', 'powerPole']),
  ],
};

/** Every unlock with where it comes from. */
export function allUnlocks(): (UnlockDef & { from: UnlockSource })[] {
  return (Object.keys(REGION_UNLOCKS) as UnlockSource[]).flatMap((from) => REGION_UNLOCKS[from].map((u) => ({ ...u, from })));
}

/** The region (or home) that hands over an unlock. */
export function unlockSource(id: string): UnlockSource | undefined {
  for (const from of Object.keys(REGION_UNLOCKS) as UnlockSource[]) if (REGION_UNLOCKS[from].some((u) => u.id === id)) return from;
  return undefined;
}
