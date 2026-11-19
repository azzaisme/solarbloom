// E23.6.1 (#390): the crafting table. Components, machine and decoration recipes, and where each is unlocked.
// All data, no rules: the numbers are the epic's starting values (azzaisme/solarbloom#390). The chain stays two
// steps: material → component → machine. Machines are paid for where they are built (build mode), components are
// made at the table. A machine recipe may name a machine another sub-epic hasn't built yet (`builds` unset): it is
// listed and checked here, and becomes buildable once its machine type exists.

import type { BuildableType, ComponentId, ItemId } from '../core/types';
import type { RegionId } from './oldcity';
import { LIGHTS, type LightDef } from './lights';

/** A cost in items (biomass is a backpack item like any other, E23.5.1). */
export type ItemCost = Partial<Record<ItemId, number>>;

/**
 * Where a recipe is unlocked:
 * - `home`: known from the start (the table is in the house from the first day)
 * - `keeper`: handed over when that region's Keeper wakes (one region at a time)
 * - `research`: a finished research project (E23.6.2), by project id
 * - `find`: a cache opened, by cache id (data/oldcity caches)
 * - `tier`: a step of the fountain (E21.6), for the Old City's own machines
 */
export type Unlock = { home: true } | { keeper: RegionId } | { research: string } | { find: string } | { tier: number };

export interface ComponentDef {
  id: ComponentId;
  name: string;
  /** short icon for text (not a key or button) */
  icon: string;
  colour: string;
}

export const COMPONENTS: Record<ComponentId, ComponentDef> = {
  wire: { id: 'wire', name: 'Wire', icon: '➰', colour: '#c87a4a' },
  planks: { id: 'planks', name: 'Planks', icon: '🪵', colour: '#b98a5a' },
  glassPane: { id: 'glassPane', name: 'Glass pane', icon: '🔲', colour: '#9fd8e0' },
  pipe: { id: 'pipe', name: 'Pipe', icon: '🚰', colour: '#a07a62' },
  motor: { id: 'motor', name: 'Motor', icon: '🌀', colour: '#b8a26a' },
  batteryCell: { id: 'batteryCell', name: 'Battery cell', icon: '🔋', colour: '#7fae6a' },
  sunCell: { id: 'sunCell', name: 'Sun cell', icon: '🌞', colour: '#f2c84a' },
};

export const COMPONENT_IDS = Object.keys(COMPONENTS) as ComponentId[];

export interface ComponentRecipe {
  /** recipe id (the component it makes) */
  id: ComponentId;
  cost: ItemCost;
  /** how many one craft makes */
  makes: number;
  /** seconds at the table, per craft */
  seconds: number;
  unlock: Unlock;
}

/** §components: Wire (2 Copper → 2), Planks (1 Timber → 2), Glass pane (2 Glass), Pipe (1 Copper, 2 Clay → 4). */
export const COMPONENT_RECIPES: ComponentRecipe[] = [
  { id: 'wire', cost: { copper: 2 }, makes: 2, seconds: 2, unlock: { home: true } },
  { id: 'planks', cost: { timber: 1 }, makes: 2, seconds: 2, unlock: { home: true } },
  { id: 'glassPane', cost: { glass: 2 }, makes: 1, seconds: 3, unlock: { home: true } },
  { id: 'pipe', cost: { copper: 1, clay: 2 }, makes: 4, seconds: 3, unlock: { home: true } },
  { id: 'motor', cost: { gears: 2, wire: 1 }, makes: 1, seconds: 4, unlock: { home: true } },
  { id: 'batteryCell', cost: { scrap: 2, wire: 2 }, makes: 1, seconds: 4, unlock: { home: true } },
  { id: 'sunCell', cost: { sunstone: 1, glassPane: 1 }, makes: 1, seconds: 5, unlock: { home: true } },
];

export interface MachineRecipe {
  /** machine id (a MachineType once that machine exists) */
  id: string;
  name: string;
  cost: ItemCost;
  unlock: Unlock;
  /** the machine type it builds, once one exists in the game (unset: data only, waiting for its sub-epic) */
  builds?: BuildableType;
  /** the sub-epic that builds the machine (for the data test and the PR notes) */
  owner?: string;
}

/** §machines, in the order they are unlocked. */
export const MACHINE_RECIPES: MachineRecipe[] = [
  { id: 'planterBox', name: 'Planter box', cost: { planks: 3 }, unlock: { home: true }, owner: 'E23.5' },
  { id: 'compostBin', name: 'Compost bin', cost: { planks: 4, scrap: 2 }, unlock: { home: true }, owner: 'E23.5' },
  // E23.3 (#422): Bloom Relays are the grid's poles, so the power pole builds one
  { id: 'powerPole', name: 'Power pole', cost: { planks: 1, wire: 1 }, unlock: { keeper: 'mastRow' }, builds: 'relay' },
  { id: 'charger', name: 'Charger', cost: { scrap: 4, wire: 2 }, unlock: { keeper: 'mastRow' }, builds: 'charger' },
  { id: 'solar', name: 'Solar panel', cost: { scrap: 4, glassPane: 2, wire: 1 }, unlock: { keeper: 'oldMarket' }, builds: 'solar' },
  { id: 'windTurbine', name: 'Wind turbine', cost: { planks: 6, scrap: 4, wire: 2 }, unlock: { keeper: 'saltwind' }, builds: 'windTurbine' },
  { id: 'chest', name: 'Storage chest', cost: { planks: 4, scrap: 2 }, unlock: { keeper: 'saltwind' }, builds: 'chest' },
  { id: 'beehive', name: 'Beehive', cost: { planks: 4, seeds: 2 }, unlock: { keeper: 'elderGrove' }, owner: 'E23.5' },
  { id: 'reservoir', name: 'Reservoir', cost: { clay: 10, scrap: 4 }, unlock: { keeper: 'cistern' }, builds: 'reservoir', owner: 'E23.4' },
  { id: 'pump', name: 'Pump', cost: { scrap: 6, wire: 2, clay: 2 }, unlock: { keeper: 'cistern' }, builds: 'pump', owner: 'E23.4' },
  { id: 'desalination', name: 'Desalination plant', cost: { scrap: 10, pipe: 4, glassPane: 4, wire: 2 }, unlock: { keeper: 'cistern' }, owner: 'E23.4' },
  { id: 'battery', name: 'Battery', cost: { batteryCell: 4 }, unlock: { keeper: 'clockPlaza' }, builds: 'battery' },
  { id: 'bioDigester', name: 'Bio Digester', cost: { scrap: 10, motor: 2, clay: 4 }, unlock: { keeper: 'clockPlaza' }, owner: 'E23.5' },
  { id: 'drone', name: 'Drone', cost: { motor: 1, wire: 2, glassPane: 1 }, unlock: { keeper: 'clockPlaza' }, owner: 'E23.6.3' },
  { id: 'largeSolar', name: 'Large solar array', cost: { sunCell: 4, scrap: 6, wire: 2 }, unlock: { keeper: 'observatory' }, owner: 'unassigned: no sub-epic builds it yet (raised with the coordinator)' },
  { id: 'assembler', name: 'Assembler', cost: { motor: 4, gears: 10, glassPane: 6 }, unlock: { keeper: 'spireHeights' }, owner: 'E23.6.5' },
  // The Old City's own machines (E21.3), on the table too: one way to build everything. They keep the fountain step
  // that opened them, and their recipes move onto components where one fits.
  // no Pipe: Pipe needs Clay (tier 2), and the condenser opens at tier 1, so it is buildable the day it opens
  { id: 'condenser', name: 'Water Condenser', cost: { scrap: 12, copper: 6, wire: 2 }, unlock: { tier: 1 }, builds: 'condenser' },
  { id: 'pollinator', name: 'Pollinator Garden', cost: { seeds: 10, planks: 3, biomass: 20 }, unlock: { tier: 2 }, builds: 'pollinator' },
  { id: 'droneHub', name: 'Drone Hub', cost: { scrap: 12, motor: 1, wire: 4, glassPane: 2 }, unlock: { tier: 2 }, builds: 'droneHub' },
  { id: 'reservoirGarden', name: 'Reservoir Garden', cost: { clay: 15, seeds: 10, biomass: 30 }, unlock: { tier: 3 }, builds: 'reservoirGarden' },
  { id: 'motherTree', name: 'Mother Tree', cost: { seeds: 30, clay: 20, biomass: 100 }, unlock: { tier: 3 }, builds: 'motherTree' },
  { id: 'cultivator', name: 'Cultivator', cost: { scrap: 20, motor: 2, gears: 10, planks: 4 }, unlock: { tier: 4 }, builds: 'cultivator' },
];

export interface DecorRecipe {
  /** decoration id (data/cozy DECOR_OPTIONS) */
  id: string;
  cost: ItemCost;
  unlock: Unlock;
}

/**
 * Decorations are made once at the crafting table: its recipe paid once, the decoration is bloombot's for good and
 * every copy placed after that is free (decorating stays a sandbox; exploring finds new ones). The everyday ones
 * are known from the start, the rest found in caches round the city (old things, mended) or researched.
 */
export const DECOR_RECIPES: DecorRecipe[] = [
  { id: 'bench', cost: { planks: 2 }, unlock: { home: true } },
  { id: 'pot', cost: { clay: 2 }, unlock: { home: true } },
  { id: 'flowerbed', cost: { seeds: 2 }, unlock: { home: true } },
  { id: 'stones', cost: { scrap: 3 }, unlock: { home: true } },
  { id: 'trough', cost: { clay: 3, seeds: 1 }, unlock: { find: 'c-elderGrove-1' } },
  { id: 'birdbath', cost: { clay: 4 }, unlock: { find: 'c-cistern-1' } },
  { id: 'bunting', cost: { planks: 1, seeds: 1 }, unlock: { find: 'c-oldMarket-1' } },
  { id: 'cratestack', cost: { planks: 3 }, unlock: { find: 'c-saltwind-1' } },
  { id: 'barrel', cost: { planks: 2, seeds: 1 }, unlock: { find: 'c-saltwind-2' } },
  { id: 'rug', cost: { seeds: 2 }, unlock: { find: 'c-oldMarket-2' } },
  { id: 'topiary', cost: { seeds: 3, clay: 1 }, unlock: { find: 'c-glasshouse-1' } },
  // E23.3.5: every night light (data/lights) is made here too, at its own cost, known where its data says
  ...LIGHTS.map((l) => ({ id: l.id, cost: l.cost, unlock: lightUnlock(l) })),
];

/** Where a light's recipe is known: the starting set from home, a cache find, or Decor research. */
function lightUnlock(l: LightDef): Unlock {
  const u = l.unlock;
  if ('start' in u) return { home: true };
  if ('find' in u) return { find: u.find };
  if ('research' in u) return { research: u.research };
  throw new Error(`light ${l.id}: a light is known from the start, a find or research`);
}

export const CRAFT = {
  /** the most crafts the table queues at once */
  queue: 20,
};
