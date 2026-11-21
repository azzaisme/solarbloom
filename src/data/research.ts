// E23.6.2 (#391): the research station. Projects, the finds that open them, the six branches, and the upgrades
// research opens at the crafting table. All data, no rules: the numbers are starting values for tuning.
// Research replaces E21.10's fixed Workbench list and the exponential upgrade drawer (removed in E23.1.5).

import type { AbilityId, MaterialId } from '../core/types';
import type { ItemCost } from './crafting';
import type { RegionId } from './oldcity';

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
 * - `move`: a move Bloombot has learned at the fountain (E25 #626: its second level follows on, like a project)
 */
export type Find =
  | { material: MaterialId }
  | { crop: string }
  | { creature: 'butterflies' | 'birds' | 'koi' }
  | { keeper: RegionId }
  | { tech: string }
  | { project: string }
  | { move: AbilityId };

/**
 * The system an upgrade works through. An upgrade is offered only once its system is in the game and reads it:
 * research never sells a level that does nothing.
 */
export type UpgradeSystemId = 'always' | 'charge' | 'power' | 'batteries' | 'water' | 'farm' | 'compost' | 'drones' | 'couriers';

/** What a finished project gives. */
export type Gift =
  /** crafting-table recipes (component, machine or decoration ids, data/crafting); usually one */
  | { recipes: string[] }
  /** an upgrade at the crafting table's Upgrade tab (levels bought there, for materials) */
  | { upgrade: string }
  /** a second station: two projects run at once */
  | { station: 2 }
  /** E25 (#626): a move's second level (MoveSpots reads it) */
  | { move: AbilityId };

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
  /** one to five levels, each paid for in materials (#623: the first five Bloombot ones go to five, levels 4 and 5 in late materials; #624's have two or three) */
  levels: UpgradeLevelDef[];
}

export const RESEARCH = {
  /** stations at the start; research adds a second */
  stations: 1,
  maxStations: 2,
  /** the station's draw on the house's grid (E23.3 registers the house as a consumer) */
  draw: 2,
  /** "Longer stride": each level makes sprinting this share faster (its `per` is the share off sprint's charge) */
  sprintSpeedPerLevel: 0.05,
  /**
   * #623: "Wider pulse" levels 1 to 3 each step the pulse up a tier (data/tuning pulseTiers); levels 4 and 5 each add
   * this many tiles to the radius instead (a tier further would leap to Radiant at 4 and do nothing at 5)
   */
  pulseTierLevels: 3,
  pulseTilesPerLateLevel: 1,
  /** #623: the widest a pulse ever reaches, every bonus counted (Radiant's 7.1 and a tile) */
  pulseMaxRadius: 8.1,
  /** #624: the shortest a salvage or pry hold ever gets (seconds), however Nimble hands and Quick hands stack */
  minHold: 0.33,
  /** #624 "Keen eye": at this level the piles and caches show on the minimap too */
  keenEyeMapLevel: 3,
  /** #624 "Lucky pulse": what a lucky pulse turns up, and how many (picked evenly from min to max) */
  lucky: { finds: ['seeds', 'scrap'] as MaterialId[], min: 2, max: 3 },
  /** #624 "Lantern": how bright Bloombot's own light is at full night (lamp posts are LIGHTING.cast.intensity 0.5) */
  lanternIntensity: 0.55,
};

/** Research-opened upgrades. Who reads each level: the sub-epic named beside it, through `sim.research.level(id)`. */
export const RESEARCH_UPGRADES: ResearchUpgradeDef[] = [
  // Bloombot (E23.2 reads charge, efficiency, sprint and pulse; the backpack is ours)
  { id: 'chargeCells', branch: 'bloombot', name: 'Bigger charge', each: 'One more battery cell in Bloombot', per: 1, needs: 'charge', levels: [{ cost: { batteryCell: 2 } }, { cost: { batteryCell: 3, gears: 4 } }, { cost: { batteryCell: 4, sunstone: 4 } }, { cost: { batteryCell: 4, sunCell: 3 } }, { cost: { sunCell: 6, sunstone: 14 } }] },
  { id: 'chargeEfficiency', branch: 'bloombot', name: 'Gentler on charge', each: 'Pulses and moves use a little less charge', per: 1, needs: 'charge', levels: [{ cost: { wire: 4, copper: 6 } }, { cost: { wire: 6, gears: 6 } }, { cost: { motor: 2, sunstone: 6 } }, { cost: { motor: 3, sunCell: 2 } }, { cost: { motor: 4, sunCell: 4 } }] },
  { id: 'sprint', branch: 'bloombot', name: 'Longer stride', each: 'Running uses less charge and goes a little faster', per: 0.1, needs: 'charge', levels: [{ cost: { gears: 4, wire: 2 } }, { cost: { motor: 1, gears: 6 } }, { cost: { motor: 2, sunstone: 4 } }, { cost: { motor: 4, sunstone: 8 } }, { cost: { motor: 6, sunCell: 3 } }] },
  { id: 'pulseRadius', branch: 'bloombot', name: 'Wider pulse', each: 'Each pulse brings back a little more ground', per: 1, needs: 'always', levels: [{ cost: { seeds: 10, copper: 6 } }, { cost: { seeds: 16, glassPane: 4 } }, { cost: { seeds: 24, sunCell: 2 } }, { cost: { sunCell: 3, sunstone: 10 } }, { cost: { sunCell: 5, sunstone: 16 } }] },
  { id: 'backpack', branch: 'bloombot', name: 'Roomier backpack', each: 'Bloombot carries 20 more of each thing', per: 20, needs: 'always', levels: [{ cost: { planks: 6, scrap: 10 } }, { cost: { planks: 10, clay: 10 } }, { cost: { planks: 14, gears: 10 } }, { cost: { motor: 2, sunstone: 8 } }, { cost: { motor: 3, sunCell: 3 } }] },
  // #624 (E25): five more for Bloombot, each on a system that was already there
  /** a share off how long Interact is held to dig out a pile or pry rubble (UpgradeSystem.salvageHold / pryHold) */
  { id: 'quickHands', branch: 'bloombot', name: 'Quick hands', each: 'Digging out a pile and prying rubble take less time', per: 0.1, needs: 'always', levels: [{ cost: { gears: 4, scrap: 8 } }, { cost: { gears: 6, wire: 4 } }, { cost: { motor: 1, copper: 10 } }] },
  /** tiles added to the pulse's ripple (what it lights up) and to how far the piles the fountain wants glint */
  { id: 'keenEye', branch: 'bloombot', name: 'Keen eye', each: 'Each pulse lights up piles and hidden things from further away. At level 3 they show on the map too', per: 4, needs: 'always', levels: [{ cost: { glassPane: 2, copper: 4 } }, { cost: { glassPane: 4, wire: 4 } }, { cost: { glassPane: 6, sunstone: 4 } }] },
  /** charge a second back in full sun, standing still (times the sun's strength now) */
  { id: 'sunSoak', branch: 'bloombot', name: 'Sun soak', each: 'Bloombot slowly charges standing still in the sun', per: 0.12, needs: 'charge', levels: [{ cost: { glassPane: 2, sunstone: 2 } }, { cost: { sunstone: 6, wire: 4 } }, { cost: { sunCell: 2, sunstone: 6 } }] },
  /** how far Bloombot's own light reaches at night (tiles) */
  { id: 'lantern', branch: 'bloombot', name: 'Lantern', each: "Bloombot's own light reaches further at night", per: 3, needs: 'always', levels: [{ cost: { glassPane: 2, wire: 2 } }, { cost: { batteryCell: 1, glassPane: 4 } }] },
  /** the chance a pulse on bare ground turns up a few Seeds or Scrap */
  { id: 'luckyPulse', branch: 'bloombot', name: 'Lucky pulse', each: 'Now and then a pulse on bare red ground turns up a few Seeds or Scrap', per: 0.04, needs: 'always', levels: [{ cost: { seeds: 12, scrap: 12 } }, { cost: { seeds: 20, copper: 8 } }, { cost: { seeds: 30, sunstone: 4 } }] },
  // Power (E23.3 reads these)
  { id: 'poleReach', branch: 'power', name: 'Longer lines', each: 'Power poles reach further', per: 0.15, needs: 'power', levels: [{ cost: { wire: 6 } }, { cost: { wire: 10, copper: 10 } }, { cost: { wire: 14, gears: 6 } }] },
  { id: 'solarYield', branch: 'power', name: 'Clearer panels', each: 'Solar panels make a little more', per: 0.1, needs: 'power', levels: [{ cost: { glassPane: 4 } }, { cost: { glassPane: 6, sunstone: 4 } }, { cost: { sunCell: 2, glassPane: 6 } }] },
  { id: 'batteryStore', branch: 'power', name: 'Deeper batteries', each: 'Batteries hold more', per: 0.25, needs: 'batteries', levels: [{ cost: { batteryCell: 2 } }, { cost: { batteryCell: 4 } }, { cost: { batteryCell: 6, gears: 6 } }] },
  // Water (E23.4 reads these)
  { id: 'pumpRate', branch: 'water', name: 'Stronger pumps', each: 'Pumps move more water', per: 0.2, needs: 'water', levels: [{ cost: { pipe: 4, wire: 2 } }, { cost: { pipe: 8, motor: 1 } }, { cost: { pipe: 12, motor: 2 } }] },
  { id: 'reservoirSize', branch: 'water', name: 'Bigger reservoirs', each: 'Reservoirs hold more', per: 0.25, needs: 'water', levels: [{ cost: { clay: 12 } }, { cost: { clay: 20, scrap: 10 } }, { cost: { clay: 30, gears: 6 } }] },
  { id: 'evaporation', branch: 'water', name: 'Shaded water', each: 'Ponds and reservoirs lose less to the sun', per: 0.2, needs: 'water', levels: [{ cost: { glassPane: 2, planks: 4 } }, { cost: { glassPane: 4, planks: 6 } }, { cost: { glassPane: 6, clay: 10 } }] },
  // Farm (E23.5 reads these)
  { id: 'compostSpeed', branch: 'farm', name: 'Busy worms', each: 'Compost and fertiliser come sooner', per: 0.2, needs: 'compost', levels: [{ cost: { planks: 6, seeds: 6 } }, { cost: { planks: 10, clay: 6 } }, { cost: { planks: 14, seeds: 16 } }] },
  { id: 'cropGrowth', branch: 'farm', name: 'Kind soil', each: 'Crops grow a little faster', per: 0.1, needs: 'farm', levels: [{ cost: { seeds: 10, clay: 6 } }, { cost: { seeds: 16, glassPane: 2 } }, { cost: { seeds: 24, sunstone: 4 } }] },
  { id: 'crossbreed', branch: 'farm', name: 'Crossbreeds', each: 'A crop harvested beside a different one gives a cross of the two', per: 1, needs: 'farm', levels: [{ cost: { seeds: 20, glassPane: 2 } }] },
  // Drones (E23.6.3 and E18's roles read these)
  { id: 'droneRange', branch: 'drones', name: 'Further wings', each: 'Drones work further from their hub', per: 2, needs: 'drones', levels: [{ cost: { glassPane: 2, wire: 2 } }, { cost: { glassPane: 4, motor: 1 } }, { cost: { sunCell: 1, motor: 2 } }] },
  { id: 'droneSpeed', branch: 'drones', name: 'Quicker wings', each: 'Drones fly a little faster', per: 0.15, needs: 'drones', levels: [{ cost: { motor: 1 } }, { cost: { motor: 2, gears: 4 } }, { cost: { motor: 3, sunstone: 4 } }] },
  { id: 'droneCarry', branch: 'drones', name: 'Bigger baskets', each: 'Couriers carry 5 more on each trip', per: 5, needs: 'couriers', levels: [{ cost: { planks: 6 } }, { cost: { planks: 10, wire: 4 } }, { cost: { planks: 14, motor: 1 } }] },
  { id: 'droneThrift', branch: 'drones', name: 'Lighter drones', each: 'Drones draw less from their hub', per: 0.15, needs: 'drones', levels: [{ cost: { batteryCell: 1, wire: 4 } }, { cost: { batteryCell: 2, glassPane: 4 } }, { cost: { batteryCell: 3, sunCell: 1 } }] },
];

/** Every project, by branch. A branch's first project opens from a find; the rest follow on. */
export const PROJECTS: ProjectDef[] = [
  // Bloombot
  { id: 'rb-cells', branch: 'bloombot', name: 'Spare cells', about: 'Room in bloombot for one more battery cell.', cost: { scrap: 10, copper: 6 }, days: 0.1, opens: { material: 'copper' }, gives: { upgrade: 'chargeCells' } },
  { id: 'rb-efficiency', branch: 'bloombot', name: 'A gentler pulse', about: 'The same pulse for less charge.', cost: { copper: 10, seeds: 10 }, days: 0.15, opens: { project: 'rb-cells' }, gives: { upgrade: 'chargeEfficiency' } },
  { id: 'rb-sprint', branch: 'bloombot', name: 'Light feet', about: 'Easier running on old legs.', cost: { gears: 8, scrap: 10 }, days: 0.15, opens: { material: 'gears' }, gives: { upgrade: 'sprint' } },
  { id: 'rb-pulse', branch: 'bloombot', name: 'Ripples', about: 'A pulse that carries a little further.', cost: { seeds: 16, glass: 6 }, days: 0.2, opens: { project: 'rb-efficiency' }, gives: { upgrade: 'pulseRadius' } },
  { id: 'rb-backpack', branch: 'bloombot', name: 'Stitched pockets', about: 'More room in every pocket of the backpack.', cost: { timber: 10, scrap: 10 }, days: 0.1, opens: { material: 'timber' }, gives: { upgrade: 'backpack' } },
  // #624 (E25)
  { id: 'rb-hands', branch: 'bloombot', name: 'Oiled fingers', about: 'Hands that dig and pry without a fuss.', cost: { gears: 6, scrap: 8 }, days: 0.1, opens: { project: 'rb-sprint' }, gives: { upgrade: 'quickHands' } },
  { id: 'rb-eye', branch: 'bloombot', name: 'Polished lenses', about: 'Eyes that catch a glint from further off.', cost: { glass: 8, copper: 4 }, days: 0.15, opens: { material: 'glass' }, gives: { upgrade: 'keenEye' } },
  { id: 'rb-soak', branch: 'bloombot', name: 'Sun skin', about: 'A shell that drinks a little sunlight.', cost: { sunstone: 4, glass: 6 }, days: 0.2, opens: { material: 'sunstone' }, gives: { upgrade: 'sunSoak' } },
  { id: 'rb-lantern', branch: 'bloombot', name: 'A little lamp', about: 'A light of its own for dark streets.', cost: { glass: 6, copper: 6 }, days: 0.15, opens: { project: 'rb-eye' }, gives: { upgrade: 'lantern' } },
  { id: 'rb-lucky', branch: 'bloombot', name: 'Lucky dirt', about: 'What turns up when old ground wakes.', cost: { seeds: 12, scrap: 10 }, days: 0.15, opens: { project: 'rb-pulse' }, gives: { upgrade: 'luckyPulse' } },
  // E25 (#626): each move's second level, one fountain step after the move itself (Glide II after Climb II)
  { id: 'rb-pry2', branch: 'bloombot', name: 'Pry II', about: 'A longer bar and firmer feet, for the heavy iron doors of old vaults.', cost: { copper: 20, gears: 12, scrap: 10 }, days: 0.2, opens: { move: 'hover' }, gives: { move: 'pry' } },
  { id: 'rb-hover2', branch: 'bloombot', name: 'Hover II', about: 'A steadier hover that goes much further over the sea.', cost: { glass: 20, copper: 16, sunstone: 6 }, days: 0.25, opens: { move: 'climb' }, gives: { move: 'hover' } },
  { id: 'rb-climb2', branch: 'bloombot', name: 'Climb II', about: 'A surer grip, to climb straight up a low wall with no ladder.', cost: { gears: 20, clay: 16, timber: 10 }, days: 0.25, opens: { move: 'glide' }, gives: { move: 'climb' } },
  { id: 'rb-glide2', branch: 'bloombot', name: 'Glide II', about: 'Wider wings that carry a lot further from a high edge.', cost: { sunstone: 16, glass: 16, gears: 10 }, days: 0.3, opens: { project: 'rb-climb2' }, gives: { move: 'glide' } },
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
  { id: 'dc-topiary', branch: 'decor', name: 'Clipped shapes', about: 'Shrubs grown into shapes.', cost: { seeds: 8 }, days: 0.05, opens: { tech: 'c-glasshouse-1' }, gives: { recipes: ['topiary'] } },
  // E23.3.5: the lights that wait for research (data/lights `research: 'dc-lights'`): fairy lights, uplights, table lamps
  { id: 'dc-lights', branch: 'decor', name: 'Old lamps', about: 'Mending the little lamps from the old streets and houses.', cost: { copper: 4, glass: 4 }, days: 0.1, opens: { tech: 'c-mastRow-1' }, gives: { recipes: ['fairylights', 'uplight', 'tablelight'] } },
  { id: 'dc-birdbath', branch: 'decor', name: 'A bowl of water', about: 'Somewhere for the birds to bathe.', cost: { clay: 6 }, days: 0.05, opens: { creature: 'birds' }, gives: { recipes: ['birdbath'] } },
];
