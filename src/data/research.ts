// E23.6.2 (#391): the research station. Projects, the finds that open them, the six branches, and the upgrades
// research opens at the crafting table. All data, no rules: the numbers are starting values for tuning.
// Research replaces E21.10's fixed Workbench list and the exponential upgrade drawer (removed in E23.1.5).

import type { MaterialId } from '../core/types';
import type { ItemCost } from './crafting';
import type { RegionId } from './oldcity';
import { DAY_SECONDS } from './time';

export type Branch = 'bloombot' | 'power' | 'water' | 'farm' | 'drones' | 'decor';

export const BRANCHES: { id: Branch; name: string }[] = [
  { id: 'bloombot', name: 'Bloombot' },
  { id: 'power', name: 'Power' },
  { id: 'water', name: 'Water' },
  { id: 'farm', name: 'Farm' },
  { id: 'drones', name: 'Drones' },
  { id: 'decor', name: 'Decor' },
];

/**
 * Something found that, once analysed at the station, opens projects:
 * - `material`: a material held or stored for the first time
 * - `crop`: a crop's seeds found (E23.5.2 `salvage.crops`)
 * - `creature`: wildlife that has come to the island (the ecosystem's fauna: butterflies, birds, koi)
 * - `keeper`: a Keeper met (woken)
 * - `tech`: old tech in a cache (by cache id)
 * - `project`: a finished project (the next step on a branch)
 */
export type Find =
  | { material: MaterialId }
  | { crop: string }
  | { creature: 'butterflies' | 'birds' | 'koi' }
  | { keeper: RegionId }
  | { tech: string }
  | { project: string };

/**
 * The system an upgrade works through. An upgrade is offered only once its system is in the game and reads it:
 * research never sells a level that does nothing.
 */
export type UpgradeSystemId = 'always' | 'charge' | 'power' | 'batteries' | 'water' | 'farm' | 'drones' | 'couriers';

/** What a finished project gives. */
export type Gift =
  /** a crafting-table recipe (component, machine or decoration id, data/crafting) */
  | { recipe: string }
  /** an upgrade at the crafting table's Upgrade tab (levels bought there, for materials) */
  | { upgrade: string }
  /** a second station: two projects run at once */
  | { station: 2 };

export interface ProjectDef {
  id: string;
  branch: Branch;
  name: string;
  /** one plain sentence: what it is about */
  about: string;
  /** what it takes (paid when it starts) */
  cost: ItemCost;
  /** game days it runs, on grid power */
  days: number;
  opens: Find;
  gives: Gift;
}

export interface UpgradeLevelDef {
  cost: ItemCost;
}

export interface ResearchUpgradeDef {
  id: string;
  branch: Branch;
  name: string;
  /** what one level does, in plain words */
  each: string;
  /** what one level does, as a number the system reads (a share, a count of tiles, a stack size …) */
  per: number;
  /** the system it works through (offered only once that system reads it) */
  needs: UpgradeSystemId;
  /** at most three levels, each paid for in materials */
  levels: UpgradeLevelDef[];
}

export const RESEARCH = {
  /** a game day in sim seconds (48 minutes of play), from E23.7's clock (data/time) */
  daySeconds: DAY_SECONDS,
  /** stations at the start; research adds a second */
  stations: 1,
  maxStations: 2,
  /** the station's draw on the house's grid (E23.3 registers the house as a consumer) */
  draw: 2,
};

/** Research-opened upgrades. Who reads each level: the sub-epic named beside it, through `sim.research.level(id)`. */
export const RESEARCH_UPGRADES: ResearchUpgradeDef[] = [
  // Bloombot (E23.2 reads charge, efficiency, sprint and pulse; the backpack is ours)
  { id: 'chargeCells', branch: 'bloombot', name: 'Bigger charge', each: 'A battery cell more in bloombot', per: 1, needs: 'charge', levels: [{ cost: { batteryCell: 2 } }, { cost: { batteryCell: 3, gears: 4 } }, { cost: { batteryCell: 4, sunstone: 4 } }] },
  { id: 'chargeEfficiency', branch: 'bloombot', name: 'Gentler on charge', each: 'Pulses and abilities use a little less charge', per: 1, needs: 'charge', levels: [{ cost: { wire: 4, copper: 6 } }, { cost: { wire: 6, gears: 6 } }, { cost: { motor: 2, sunstone: 6 } }] },
  { id: 'sprint', branch: 'bloombot', name: 'Longer stride', each: 'Sprinting costs less and goes a little faster', per: 1, needs: 'charge', levels: [{ cost: { gears: 4, wire: 2 } }, { cost: { motor: 1, gears: 6 } }, { cost: { motor: 2, sunstone: 4 } }] },
  { id: 'pulseRadius', branch: 'bloombot', name: 'Wider pulse', each: 'The pulse reaches a tile further', per: 1, needs: 'always', levels: [{ cost: { seeds: 10, copper: 6 } }, { cost: { seeds: 16, glassPane: 4 } }, { cost: { seeds: 24, sunCell: 2 } }] },
  { id: 'backpack', branch: 'bloombot', name: 'Roomier backpack', each: '20 more in every stack', per: 20, needs: 'always', levels: [{ cost: { planks: 6, scrap: 10 } }, { cost: { planks: 10, clay: 10 } }, { cost: { planks: 14, gears: 10 } }] },
  // Power (E23.3 reads these)
  { id: 'poleReach', branch: 'power', name: 'Longer lines', each: 'Power poles reach further', per: 0.15, needs: 'power', levels: [{ cost: { wire: 6 } }, { cost: { wire: 10, copper: 10 } }, { cost: { wire: 14, gears: 6 } }] },
  { id: 'solarYield', branch: 'power', name: 'Clearer panels', each: 'Solar panels make a little more', per: 0.1, needs: 'power', levels: [{ cost: { glassPane: 4 } }, { cost: { glassPane: 6, sunstone: 4 } }, { cost: { sunCell: 2, glassPane: 6 } }] },
  { id: 'batteryStore', branch: 'power', name: 'Deeper batteries', each: 'Batteries hold more', per: 0.25, needs: 'batteries', levels: [{ cost: { batteryCell: 2 } }, { cost: { batteryCell: 4 } }, { cost: { batteryCell: 6, gears: 6 } }] },
  // Water (E23.4 reads these)
  { id: 'pumpRate', branch: 'water', name: 'Stronger pumps', each: 'Pumps move more water', per: 0.2, needs: 'water', levels: [{ cost: { pipe: 4, wire: 2 } }, { cost: { pipe: 8, motor: 1 } }, { cost: { pipe: 12, motor: 2 } }] },
  { id: 'reservoirSize', branch: 'water', name: 'Bigger reservoirs', each: 'Reservoirs hold more', per: 0.25, needs: 'water', levels: [{ cost: { clay: 12 } }, { cost: { clay: 20, scrap: 10 } }, { cost: { clay: 30, gears: 6 } }] },
  { id: 'evaporation', branch: 'water', name: 'Shaded water', each: 'Ponds and reservoirs lose less to the sun', per: 0.2, needs: 'water', levels: [{ cost: { glassPane: 2, planks: 4 } }, { cost: { glassPane: 4, planks: 6 } }, { cost: { glassPane: 6, clay: 10 } }] },
  // Farm (E23.5 reads these)
  { id: 'compostSpeed', branch: 'farm', name: 'Busy worms', each: 'Compost and fertiliser come sooner', per: 0.2, needs: 'farm', levels: [{ cost: { planks: 6, seeds: 6 } }, { cost: { planks: 10, clay: 6 } }, { cost: { planks: 14, seeds: 16 } }] },
  { id: 'cropGrowth', branch: 'farm', name: 'Kind soil', each: 'Crops grow a little faster', per: 0.1, needs: 'farm', levels: [{ cost: { seeds: 10, clay: 6 } }, { cost: { seeds: 16, glassPane: 2 } }, { cost: { seeds: 24, sunstone: 4 } }] },
  { id: 'crossbreed', branch: 'farm', name: 'Crossbreeds', each: 'Neighbouring crops sometimes cross into a new kind', per: 1, needs: 'farm', levels: [{ cost: { seeds: 20, glassPane: 2 } }] },
  // Drones (E23.6.3 and E18's roles read these)
  { id: 'droneRange', branch: 'drones', name: 'Further wings', each: 'Drones work further from their hub', per: 2, needs: 'drones', levels: [{ cost: { glassPane: 2, wire: 2 } }, { cost: { glassPane: 4, motor: 1 } }, { cost: { sunCell: 1, motor: 2 } }] },
  { id: 'droneSpeed', branch: 'drones', name: 'Quicker wings', each: 'Drones fly a little faster', per: 0.15, needs: 'drones', levels: [{ cost: { motor: 1 } }, { cost: { motor: 2, gears: 4 } }, { cost: { motor: 3, sunstone: 4 } }] },
  { id: 'droneCarry', branch: 'drones', name: 'Bigger baskets', each: 'Couriers carry more at a time', per: 1, needs: 'couriers', levels: [{ cost: { planks: 6 } }, { cost: { planks: 10, wire: 4 } }, { cost: { planks: 14, motor: 1 } }] },
  { id: 'droneThrift', branch: 'drones', name: 'Lighter drones', each: 'Drones draw less from their hub', per: 0.15, needs: 'drones', levels: [{ cost: { batteryCell: 1, wire: 4 } }, { cost: { batteryCell: 2, glassPane: 4 } }, { cost: { batteryCell: 3, sunCell: 1 } }] },
];

/** Every project, by branch. A branch's first project opens from a find; the rest follow on. */
export const PROJECTS: ProjectDef[] = [
  // Bloombot
  { id: 'rb-cells', branch: 'bloombot', name: 'Spare cells', about: 'Room in bloombot for a battery cell more.', cost: { scrap: 10, copper: 6 }, days: 0.1, opens: { material: 'copper' }, gives: { upgrade: 'chargeCells' } },
  { id: 'rb-efficiency', branch: 'bloombot', name: 'A gentler pulse', about: 'The same pulse for less charge.', cost: { copper: 10, seeds: 10 }, days: 0.15, opens: { project: 'rb-cells' }, gives: { upgrade: 'chargeEfficiency' } },
  { id: 'rb-sprint', branch: 'bloombot', name: 'Light feet', about: 'Easier running on old legs.', cost: { gears: 8, scrap: 10 }, days: 0.15, opens: { material: 'gears' }, gives: { upgrade: 'sprint' } },
  { id: 'rb-pulse', branch: 'bloombot', name: 'Ripples', about: 'A pulse that carries a little further.', cost: { seeds: 16, glass: 6 }, days: 0.2, opens: { project: 'rb-efficiency' }, gives: { upgrade: 'pulseRadius' } },
  { id: 'rb-backpack', branch: 'bloombot', name: 'Stitched pockets', about: 'More room in every pocket of the backpack.', cost: { timber: 10, scrap: 10 }, days: 0.1, opens: { material: 'timber' }, gives: { upgrade: 'backpack' } },
  // Power
  { id: 'pw-lines', branch: 'power', name: 'Long lines', about: 'Copper drawn thinner reaches further.', cost: { copper: 12 }, days: 0.1, opens: { keeper: 'mastRow' }, gives: { upgrade: 'poleReach' } },
  { id: 'pw-solar', branch: 'power', name: 'Clear glass', about: 'Panels that drink more of the sun.', cost: { glass: 12, sunstone: 2 }, days: 0.15, opens: { material: 'glass' }, gives: { upgrade: 'solarYield' } },
  { id: 'pw-battery', branch: 'power', name: 'Deep cells', about: 'Batteries that keep the night going.', cost: { scrap: 16, copper: 10 }, days: 0.2, opens: { project: 'pw-lines' }, gives: { upgrade: 'batteryStore' } },
  { id: 'pw-station', branch: 'power', name: 'A second bench', about: 'Room in the house to work on two things at once.', cost: { timber: 16, glass: 10, gears: 6 }, days: 0.3, opens: { project: 'pw-battery' }, gives: { station: 2 } },
  // Water
  { id: 'wt-pump', branch: 'water', name: 'Old pump drawings', about: 'How the old city lifted water, kindly.', cost: { clay: 10, copper: 6 }, days: 0.15, opens: { keeper: 'cistern' }, gives: { upgrade: 'pumpRate' } },
  { id: 'wt-reservoir', branch: 'water', name: 'Fired clay', about: 'Tighter walls for bigger reservoirs.', cost: { clay: 16 }, days: 0.15, opens: { material: 'clay' }, gives: { upgrade: 'reservoirSize' } },
  { id: 'wt-shade', branch: 'water', name: 'Shaded water', about: 'Keeping the sun off what we store.', cost: { glass: 10, clay: 10 }, days: 0.25, opens: { creature: 'koi' }, gives: { upgrade: 'evaporation' } },
  // Farm
  { id: 'fm-compost', branch: 'farm', name: 'Worm notes', about: 'What makes a compost bin hum.', cost: { seeds: 8, timber: 4 }, days: 0.1, opens: { material: 'seeds' }, gives: { upgrade: 'compostSpeed' } },
  { id: 'fm-growth', branch: 'farm', name: 'Kind soil', about: 'What the butterflies know about flowers, for crops.', cost: { seeds: 12, clay: 6 }, days: 0.15, opens: { creature: 'butterflies' }, gives: { upgrade: 'cropGrowth' } },
  { id: 'fm-crossbreed', branch: 'farm', name: 'Crossbreeds', about: 'Two crops side by side sometimes make a third.', cost: { seeds: 16, glass: 4 }, days: 0.25, opens: { crop: 'radish' }, gives: { upgrade: 'crossbreed' } },
  // Drones
  { id: 'dr-range', branch: 'drones', name: 'Wing notes', about: 'Drones that fly further from home.', cost: { glass: 6, copper: 6 }, days: 0.1, opens: { keeper: 'clockPlaza' }, gives: { upgrade: 'droneRange' } },
  { id: 'dr-speed', branch: 'drones', name: 'Oiled gears', about: 'Drones that hurry, a little.', cost: { gears: 10 }, days: 0.15, opens: { project: 'dr-range' }, gives: { upgrade: 'droneSpeed' } },
  { id: 'dr-carry', branch: 'drones', name: 'Baskets', about: 'Couriers that carry more.', cost: { timber: 10, copper: 4 }, days: 0.15, opens: { project: 'dr-range' }, gives: { upgrade: 'droneCarry' } },
  { id: 'dr-thrift', branch: 'drones', name: 'Light frames', about: 'Drones that take less from their hub.', cost: { glass: 8, gears: 6 }, days: 0.2, opens: { project: 'dr-speed' }, gives: { upgrade: 'droneThrift' } },
  // Decor
  { id: 'dc-topiary', branch: 'decor', name: 'Clipped shapes', about: 'Shrubs grown into shapes.', cost: { seeds: 8 }, days: 0.05, opens: { tech: 'c-glasshouse-1' }, gives: { recipe: 'topiary' } },
  { id: 'dc-lamppost', branch: 'decor', name: 'Old lamps', about: 'Mending the lamps along the old streets.', cost: { copper: 4, glass: 4 }, days: 0.1, opens: { tech: 'c-mastRow-1' }, gives: { recipe: 'lamppost' } },
  { id: 'dc-clematis', branch: 'decor', name: 'Clematis', about: 'A climber with star flowers, for poles and walls.', cost: { seeds: 10 }, days: 0.05, opens: { material: 'seeds' }, gives: { recipe: 'clematis' } },
  { id: 'dc-morningGlory', branch: 'decor', name: 'Morning glory', about: 'Blue trumpets that open with the sun.', cost: { seeds: 12 }, days: 0.08, opens: { project: 'dc-clematis' }, gives: { recipe: 'morningGlory' } },
  { id: 'dc-wisteria', branch: 'decor', name: 'Wisteria', about: 'Long purple trails to hang from the lines.', cost: { seeds: 16, timber: 4 }, days: 0.12, opens: { project: 'dc-morningGlory' }, gives: { recipe: 'wisteria' } },
  { id: 'dc-boardwalk', branch: 'decor', name: 'Boardwalks', about: 'Planks laid over wet ground and shallow water.', cost: { timber: 10 }, days: 0.1, opens: { keeper: 'saltwind' }, gives: { recipe: 'boardwalk' } },
  { id: 'dc-cobbles', branch: 'decor', name: 'Mossy cobbles', about: 'Old cobbles, with moss let into the cracks.', cost: { scrap: 10, seeds: 6 }, days: 0.1, opens: { project: 'dc-boardwalk' }, gives: { recipe: 'mossyCobbles' } },
  { id: 'dc-birdbath', branch: 'decor', name: 'A bowl of water', about: 'Somewhere for the birds to bathe.', cost: { clay: 6 }, days: 0.05, opens: { creature: 'birds' }, gives: { recipe: 'birdbath' } },
];
