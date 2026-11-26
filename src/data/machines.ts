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
  /** E23.8.3.2: only buildable on the mainland. */
  mainlandOnly?: boolean;
  /** Only grows in these Old City regions (data/oldcity RegionId): giant trees, in the woodland. */
  regions?: string[];
}

export const MACHINES: Record<MachineType, MachineDef> = {
  solar: {
    type: 'solar',
    name: 'Solar Panel',
    icon: '☀️',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Makes power in the sunshine for the machines on its power lines. When flowers open right beside it, it shines twice as bright for a few seconds.',
    hotkey: '3',
  },
  condenser: {
    type: 'condenser',
    name: 'Water Condenser',
    icon: '💧',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Its little meter fills, then it waters nearby plants and brings dry, mossy ground into flower.',
    hotkey: '4',
  },
  pollinator: {
    type: 'pollinator',
    name: 'Pollinator Garden',
    icon: '🌸',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Turn the ground beside it green and the flowers spread to the mossy ground around it.',
    hotkey: '5',
  },
  droneHub: {
    type: 'droneHub',
    name: 'Drone Hub',
    icon: '🛸',
    size: 2,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Sends out a little drone that turns the ground around it green. It needs a power line.',
    hotkey: '6',
  },
  motherTree: {
    type: 'motherTree',
    name: 'Mother Tree',
    icon: '🌳',
    size: 2,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Every patch that turns green nearby fills it up. When it is full, it lets out a Bloom Pulse that turns everything around it green and lush.',
    hotkey: '7',
    unlock: { needs: 'droneHub', label: 'Build a Drone Hub to unlock' },
  },
  reservoirGarden: {
    type: 'reservoirGarden',
    name: 'Reservoir Garden',
    icon: '⛲',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Water Condensers right beside it fill its pool. When the pool is full, the dry ground around it bursts into flower.',
    hotkey: '8',
    areaTypes: ['reservoir'],
  },
  relay: {
    type: 'relay',
    name: 'Bloom Relay',
    icon: '📡',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Joins up with the other Bloom Relays nearby. When flowers open right beside it, the ground by each of those relays flowers too, and then it rests for a moment.',
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
    blurb: 'A solar tiller: it trundles out from its home over the dead ground nearby and slowly breaks it into flower on its own. It needs a power line.',
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
    blurb: 'Walk up to it to put things away or take them out. Anything in one chest can be taken out of any chest.',
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
  // E23.5.3: biomass and food scraps rot down into compost, then fertiliser.
  compostBin: {
    type: 'compostBin',
    name: 'Compost Bin',
    icon: '🟫',
    size: 1,
    allowedGround: ['restored', 'prepared', 'polluted'],
    blurb: 'Fill it with Greens and food scraps: they rot down into compost, and compost left inside becomes fertiliser.',
  },
  // E23.5.3: biomass into grid power, day or night, while fed.
  bioDigester: {
    type: 'bioDigester',
    name: 'Bio Digester',
    icon: '⚡',
    size: 1,
    allowedGround: ['restored', 'prepared', 'polluted'],
    blurb: 'Feed it Greens and it powers the machines on its power lines, day or night. When the Greens run out it simply stops.',
  },
  // E23.5.4: beyond planters (wild creatures attracted, never kept)
  beehive: {
    type: 'beehive',
    name: 'Beehive',
    icon: '🐝',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Bees settle once flowers or herbs grow nearby: they make honey and speed up crops around them.',
  },
  fishPond: {
    type: 'fishPond',
    name: 'Fish Pond',
    icon: '🐟',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Kept filled from the water nearby. Its water feeds the planters it reaches, so they need no fertiliser.',
  },
  orchard: {
    type: 'orchard',
    name: 'Fruit Tree',
    icon: '🍎',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Planted once, it flowers in spring and fruits every day through summer and autumn: apples, pears, peaches or lemons, by where it grows. Prune it now and then for Timber.',
  },
  giantTree: {
    type: 'giantTree',
    name: 'Giant Tree',
    icon: '🌳',
    size: 2,
    allowedGround: ['restored', 'prepared'],
    regions: ['elderGrove'],
    blurb: 'Starts as a young tree and grows over many days into a giant you can walk under.',
  },
  mushroomLog: {
    type: 'mushroomLog',
    name: 'Mushroom Log',
    icon: '🍄',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Feed it compost and keep it shaded: mushrooms come up at night and in fog.',
  },
  wormBin: {
    type: 'wormBin',
    name: 'Worm Bin',
    icon: '🪱',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Feed the worms scraps and the compost bins beside it work twice as fast.',
  },
  birdBox: {
    type: 'birdBox',
    name: 'Bird Box',
    icon: '🐦',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Songbirds move in when there are trees or tall shrubs nearby.',
  },
  batBox: {
    type: 'batBox',
    name: 'Bat Box',
    icon: '🦇',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Bats move in near water, and fly at night.',
  },
  hedgehogHouse: {
    type: 'hedgehogHouse',
    name: 'Hedgehog House',
    icon: '🦔',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Hedgehogs move in among shrubs, away from machines.',
  },
  butterflyGarden: {
    type: 'butterflyGarden',
    name: 'Butterfly Garden',
    icon: '🦋',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Butterflies come when flowers or herbs grow nearby.',
  },
  // E23.3.2: the grid's storage and its weather power.
  battery: {
    type: 'battery',
    name: 'Battery',
    icon: '🔋',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Saves the power your machines don’t use and gives it back after dark.',
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
    blurb: 'A pad on a power line. Sit on it and Bloombot’s Charge fills up fast.',
  },
  // E23.8.3.2: the mainland's big machines (behaviour in gameplay/MainlandSystem, numbers in data/mainland)
  gridBattery: {
    type: 'gridBattery',
    name: 'Big Battery',
    icon: '🔋',
    size: 2,
    allowedGround: ['restored', 'prepared'],
    blurb: 'A huge battery: it saves the sun and wind from all your power lines for the night. Mainland only.',
    mainlandOnly: true,
  },
  // E23.4.2: the water network's storage and its pump (crafting-table recipes: data/crafting).
  reservoir: {
    type: 'reservoir',
    name: 'Reservoir',
    icon: '🛢',
    size: 2,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Stores water. Rain fills it, and so does a canal or pond on its bank, or a pipe from a pump. Up high, it feeds the pipes below on its own.',
  },
  desalination: {
    type: 'desalination',
    name: 'Desalination Plant',
    icon: '🌊',
    size: 2,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Built on the shore. Turns the sea into fresh water in any weather, into a pond or canal beside it or the pipes it touches. It needs a power line, and it uses a lot of power.',
  },
  pump: {
    type: 'pump',
    name: 'Pump',
    icon: '⛲',
    size: 1,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Stands on the bank of a pond or canal and pushes its water along the pipes it touches, uphill or far away. It needs a power line.',
  },
  // E23.6.4: a box with its own contents, for machines and couriers (old-city rules only)
  crate: {
    type: 'crate',
    name: 'Supply Crate',
    icon: '🧺',
    size: 1,
    allowedGround: ['restored', 'prepared', 'polluted'],
    blurb: 'A crate for things on the move. Courier drones carry things from crate to crate, and machines beside it take from it and put into it.',
  },
  // E23.6.5: crafts a component by itself, from the crate beside it into another (old-city rules only)
  assembler: {
    type: 'assembler',
    name: 'Assembler',
    icon: '🛠️',
    size: 2,
    allowedGround: ['restored', 'prepared'],
    blurb: 'Makes the part you choose all by itself, from one supply crate beside it into another (you pick which). It needs a power line.',
  },
  core: {
    type: 'core',
    name: 'Rooftop Core',
    icon: '✨',
    size: 2,
    allowedGround: ['polluted', 'prepared', 'restored'],
    blurb: 'An old flower engine. Wake it and the whole building turns green.',
  },
};

/** E21.3: what can be built (E23.1.1: one list, the Old City's; E23.7.4 dropped the Reclaimer; E23.3 adds the grid; E23.5.2 the Planter; E23.4 the water; E23.6.4 / E23.6.5 automation). */
export const BUILDABLE: BuildableType[] = ['solar', 'condenser', 'chest', 'planter', 'compostBin', 'bioDigester', 'beehive', 'fishPond', 'orchard', 'giantTree', 'mushroomLog', 'wormBin', 'birdBox', 'batBox', 'hedgehogHouse', 'butterflyGarden', 'battery', 'charger', 'pollinator', 'droneHub', 'windTurbine', 'reservoir', 'pump', 'desalination', 'reservoirGarden', 'motherTree', 'relay', 'cultivator', 'crate', 'assembler'];

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
  solar: { name: 'Solar Array', icon: '🔆', blurb: 'Three panels joined into one: much more power, and bigger bursts of flowers' },
  condenser: { name: 'Condenser Array', icon: '💠', blurb: 'Much more water, and each watering wets more of the ground around it' },
  pollinator: { name: 'Bloom Garden', icon: '💮', blurb: 'More Greens from the flowers around it, and it reaches a little further' },
  droneHub: { name: 'Fleet Hub', icon: '🚀', blurb: 'Three times as many drones, up to 12, and they work further out' },
};
/** Phase 5 E14: three tier-2 machines merge into a Superstructure Core, placed and built as a tier 3. */
export interface SuperDef extends TierDef {
  size: number;
  /** what its ability does, for previews */
  ability: string;
}
export const TIER3: Partial<Record<MachineType, SuperDef>> = {
  solar: { name: 'Solar Megaflower', icon: '🌻', size: 2, blurb: 'Much more power than any panel', ability: 'Solar Burst: every solar panel shines much brighter for a little while' },
  condenser: { name: 'Water Nexus', icon: '🌊', size: 2, blurb: 'Much more water than any condenser', ability: 'Irrigation Wave: the dry and growing ground joined to it bursts into flower' },
  pollinator: { name: 'Tree of Life', icon: '🌲', size: 3, blurb: 'Many more Greens from all the ground around it', ability: 'Evolution: the least-grown ground nearby grows up a little (it saves up to 3 goes)' },
  droneHub: { name: 'Drone Megahub', icon: '🛰️', size: 2, blurb: 'Fleet drones that work much further out', ability: 'Swarm: extra drones join in for a little while, each turning plenty of ground green' },
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
