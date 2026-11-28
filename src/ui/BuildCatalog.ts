import type { BuildableType, ItemId, LaidKind } from '../core/types';
import { DECOR_OPTION, DECOR_OPTIONS, decorSet, type DecorSet } from '../data/cozy';
import type { Unlock } from '../data/crafting';
import { BUILDABLE, MACHINES } from '../data/machines';
import { KEEPERS } from '../data/oldcity';
import { WATER_NET } from '../data/water';
import { decorOpen } from '../gameplay/Cozy';
import { LAID_KINDS, LAID_NAME } from '../gameplay/LaidPaths';
import type { Sim } from '../gameplay/Sim';
import type { Tool } from './Hud';
import { ICONS, iconize, MACHINE_ICONS } from './Icons';
import type { IconName } from './Icons';

/**
 * E23.11 (#344): what can be built, as the build menu and the build dock show it: each piece's tab, its face (icon,
 * name, the short name a dock slot has room for), one plain line about it, its recipe as have-of-need, and, while
 * it is locked, who to wake for it. Read from the real data (machines, the crafting table's recipes, the
 * decorations), so a new machine appears with no change here beyond its tab and line.
 */
export type BuildTabId = 'machines' | 'power' | 'water' | 'farm' | 'storage' | 'paths' | 'decorations';

export const BUILD_TABS: readonly { id: BuildTabId; label: string; icon: IconName }[] = [
  { id: 'machines', label: 'Machines', icon: 'wrench' },
  { id: 'power', label: 'Power', icon: 'energy' },
  { id: 'water', label: 'Water', icon: 'water' },
  { id: 'farm', label: 'Farm', icon: 'sprout' },
  { id: 'storage', label: 'Storage', icon: 'parcel' },
  { id: 'paths', label: 'Ground', icon: 'road' },
  { id: 'decorations', label: 'Decorations', icon: 'flower' },
];

/** E23.11: the build bar's default buttons 1–9 (the build board's row; the build menu pins others). */
export const HOTBAR_DEFAULT: readonly string[] = ['solar', 'battery', 'relay', 'planter', 'compostBin', 'pump', 'pipe', 'footpath', ''];

/** Which tab each machine sits under (and the pipe, which is laid from the Water tab). */
export const BUILD_TAB: Record<BuildableType | 'pipe', BuildTabId> = {
  solar: 'power',
  battery: 'power',
  gridBattery: 'power',
  relay: 'power',
  windTurbine: 'power',
  charger: 'power',
  bioDigester: 'power',
  condenser: 'water',
  reservoir: 'water',
  pump: 'water',
  pipe: 'water',
  desalination: 'water',
  reservoirGarden: 'water',
  planter: 'farm',
  compostBin: 'farm',
  pollinator: 'farm',
  motherTree: 'farm',
  // E23.5.4: beyond planters
  beehive: 'farm',
  fishPond: 'farm',
  orchard: 'farm',
  giantTree: 'farm',
  mushroomLog: 'farm',
  wormBin: 'farm',
  butterflyGarden: 'farm',
  birdBox: 'farm',
  batBox: 'farm',
  hedgehogHouse: 'farm',
  cultivator: 'machines',
  droneHub: 'machines',
  chest: 'storage',
  crate: 'storage',
  assembler: 'machines',
};

/** One plain line about each piece (the menu's detail pane): what it does for you, no numbers. */
const LINES: Record<BuildableType | 'pipe', string> = {
  solar: 'Makes power in daylight. Place a Charger beside it to keep Bloombot going while out in the park.',
  battery: 'Saves the power your panels have spare and gives it back after dark.',
  gridBattery: 'Saves lots of spare power, enough to keep every light on through a long night.',
  relay: 'Carries power along: build a row of them to reach a machine far from your panels.',
  windTurbine: 'Turns on windy days and in storms, and catches more wind up high.',
  charger: 'Place it beside a Solar Panel. Sit at the Charger in daylight to fill Bloombot’s Charge.',
  bioDigester: 'Feed it Greens and it powers the machines joined to it, day or night, until it runs empty.',
  condenser: 'Pulls water from the air, then waters the dry soil beside it into bloom.',
  reservoir: 'Holds water. Rain fills it, and so does a pond on its bank or a pipe from a pump.',
  pump: 'Stands on the bank of a pond or canal and pushes its water along the pipes it touches.',
  pipe: 'Lay it piece by piece to carry water from a pump or a high tank to where it is needed.',
  desalination: 'Built on the shore and given power, it turns the sea into fresh water in any weather.',
  reservoirGarden: 'Condensers nearby fill its basin. Once it is full, dry ground around it bursts into flower.',
  planter: 'A raised bed: plant seeds in it, keep it watered and pick the food.',
  compostBin: 'Fill it with Greens and food scraps: they rot down into compost, then fertiliser.',
  pollinator: 'Ground you restore near it spreads to the mossy ground next door.',
  motherTree: 'Every patch you turn green nearby feeds it, until it bursts everything around it into flower at once.',
  beehive: 'Bees settle once flowers or herbs grow nearby. They make honey and speed up the crops around it.',
  fishPond: 'Kept filled from water nearby or a pipe. Its water feeds the planters it reaches, so they need no fertiliser.',
  orchard: 'Planted once, it flowers in spring and fruits every day through summer and autumn: apples, pears, peaches or lemons, by where it grows. Prune it now and then for Timber.',
  giantTree: 'Starts as a young tree and grows over many days into a giant you can walk under. Only in Elder Grove.',
  mushroomLog: 'Feed it compost and keep it shaded: mushrooms come up at night and in fog.',
  wormBin: 'Feed the worms scraps and the compost bins beside it work twice as fast.',
  butterflyGarden: 'Butterflies come when flowers or herbs grow nearby.',
  birdBox: 'Songbirds move in when there are trees or tall shrubs nearby.',
  batBox: 'Bats move in near fresh water, and fly at night.',
  hedgehogHouse: 'Hedgehogs move in among shrubs, away from machines.',
  cultivator: 'A little sun-powered tiller that slowly turns the dead ground near its home green, all on its own.',
  droneHub: 'Sends out a little drone that turns the ground near it green, as long as it has power.',
  chest: 'A way into the city’s shared store: open it to put things away or take them out.',
  crate: 'Courier drones carry things from crate to crate, and machines beside it take from it. Open it to choose where it sends things.',
  assembler: 'Makes one thing over and over by itself, from what is in the crates beside it, even while Bloombot is away.',
};

/** Names a 74-pixel dock slot has room for (the menu and the prompt use the full name). */
const SHORT: Partial<Record<BuildableType, string>> = {
  solar: 'Solar',
  condenser: 'Condenser',
  pollinator: 'Pollinator',
  reservoirGarden: 'Basin',
  relay: 'Relay',
  windTurbine: 'Turbine',
  desalination: 'Sea water',
  bioDigester: 'Digester',
  compostBin: 'Compost',
  chest: 'Chest',
  crate: 'Crate',
  motherTree: 'Tree',
  mushroomLog: 'Mushrooms',
  butterflyGarden: 'Butterflies',
  hedgehogHouse: 'Hedgehog',
  orchard: 'Fruit tree',
  giantTree: 'Giant tree',
};

export interface BuildCost {
  id: ItemId;
  name: string;
  have: number;
  need: number;
}

export interface BuildItem {
  tool: Tool;
  tab: BuildTabId;
  name: string;
  /** the dock slot's name */
  short: string;
  /** icon markup */
  icon: string;
  /** a short kind line under the name ("Takes one tile") */
  kind: string;
  line: string;
  locked: boolean;
  /** who or what opens it, while locked ("Wake Sluice") */
  lockText?: string;
  /** have-of-need, the store within reach counted (empty: free) */
  cost: BuildCost[];
  affordable: boolean;
  /** #847: a decoration's set (made for a room, or for the garden) */
  set?: DecorSet;
}

/** #847: the heading over each set of decorations in the build menu. */
export const DECOR_SET_LABEL: Record<DecorSet, string> = { indoor: 'For the house', garden: 'For the garden' };

/** "Wake Sluice": who to wake (or what to do) for a locked recipe. Never names a Lucky Cat. */
export function unlockText(u: Unlock): string {
  if ('keeper' in u) {
    const k = KEEPERS.find((x) => x.region === u.keeper);
    return k ? `Wake ${k.name}` : 'Wake its Keeper';
  }
  if ('tier' in u) return u.tier <= 1 ? 'Wake the fountain' : `Reach fountain step ${u.tier}`;
  if ('research' in u) return 'Research it first';
  if ('find' in u) return 'Not found yet';
  return 'Not known yet';
}

const machineIcon = (t: BuildableType) => ICONS[MACHINE_ICONS[t]] ?? iconize(MACHINES[t].icon);

function costOf(sim: Sim, cost: Partial<Record<ItemId, number>> | undefined): BuildCost[] {
  if (!cost) return [];
  return sim.inventory.describe(cost as never).map((p) => ({ id: p.id, name: p.name.replace(/\bbiomass\b/gi, 'Greens'), have: p.have, need: p.need }));
}

function machineItem(sim: Sim, t: BuildableType): BuildItem | undefined {
  const def = MACHINES[t];
  const cr = sim.crafting.machineRecipe(t);
  const locked = !sim.build.isUnlocked(t);
  // A rooftop's own piece shows once that rooftop is reachable (as the old tray did).
  if (def.roofs && locked) return undefined;
  const cost = costOf(sim, cr?.cost);
  return {
    tool: t,
    tab: BUILD_TAB[t],
    name: def.name,
    short: SHORT[t] ?? def.name,
    icon: machineIcon(t),
    kind: def.size > 1 ? `Takes a patch of ground ${def.size} squares across` : 'Takes one square of ground',
    line: LINES[t],
    locked,
    lockText: locked ? (cr ? unlockText(cr.unlock) : 'Not known yet') : undefined,
    cost,
    affordable: !locked && sim.build.affordable(t),
  };
}

function pipeItem(sim: Sim): BuildItem {
  const locked = !sim.water.unlocked('pipe');
  const k = KEEPERS.find((q) => q.region === 'cistern');
  const cost = costOf(sim, WATER_NET.pipe.cost);
  return {
    tool: 'pipe',
    tab: 'water',
    name: 'Pipe',
    short: 'Pipe',
    icon: ICONS.pipe,
    kind: 'Laid one square at a time',
    line: LINES.pipe,
    locked,
    lockText: locked ? `Wake ${k?.name ?? 'the Keeper'}` : undefined,
    cost,
    affordable: !locked && sim.inventory.canPay(WATER_NET.pipe.cost as never),
  };
}

const LAID_LINE: Record<LaidKind, string> = {
  footpath: 'Paving stones for a garden walk. Hold and drag to lay a whole run at once, or turn Fill on to pave a patch.',
  road: 'A smooth road across open ground. Hold and drag to lay a whole run at once, or turn Fill on to pave a patch.',
  grass: 'Turn paving and bare ground into lawn: a market floor, a plaza, a walk. Hold and drag for a strip, or turn Fill on to green a whole patch. Then pulse it to bring it to life.',
};

/** A footpath, a road or grass: the ground itself, free to lay and to lift, there from the first time Bloombot builds. */
function laidItem(kind: LaidKind): BuildItem {
  return {
    tool: kind,
    tab: 'paths',
    name: LAID_NAME[kind],
    short: kind === 'footpath' ? 'Path' : LAID_NAME[kind],
    icon: kind === 'footpath' ? ICONS.footpath : kind === 'grass' ? ICONS.sprout : ICONS.road,
    kind: 'Free to lay · hold and drag for a run',
    line: LAID_LINE[kind],
    locked: false,
    cost: [],
    affordable: true,
  };
}

/** A decoration: open ones are free to place; one the table can make shows as locked with that; finds stay hidden. */
function decorItem(sim: Sim, id: string): BuildItem | undefined {
  const o = DECOR_OPTION[id];
  if (!o) return undefined;
  const open = decorOpen(sim, o);
  const r = sim.crafting.decor(id);
  const known = !!r && sim.crafting.unlocked(r.unlock);
  // A locked garden piece stays off the list until its recipe is known; #852: a piece for a room shows from the start,
  // saying how to get it (a level of the house, a Keeper's gift, or the workbench).
  if (!open && (!r || 'cat' in r.unlock || (!known && !o.indoor))) return undefined;
  return {
    tool: `decor:${id}`,
    tab: 'decorations',
    name: o.name,
    short: o.name,
    icon: iconize(o.icon),
    kind: o.solid ? 'Free to place · stands in the way' : 'Free to place · walk right over it',
    line: o.blurb,
    locked: !open,
    lockText: open ? undefined : known && !r!.gift ? 'Make it at the workbench' : sim.crafting.decorLock(id).replace('🔒 ', ''),
    cost: [],
    affordable: open,
    set: decorSet(o),
  };
}

/**
 * Every piece the build menu lists, in tab order then data order. #847: decorations lead with the set that suits where
 * Bloombot is (`inside` the house: the pieces made for a room; outside: the garden pieces), the other set after it.
 * Either set can be placed anywhere; this is only the order.
 */
export function buildItems(sim: Sim, inside = false): BuildItem[] {
  const out: BuildItem[] = [];
  for (const t of BUILDABLE) {
    const it = machineItem(sim, t);
    if (it) out.push(it);
    if (t === 'pump') out.push(pipeItem(sim)); // the pipe sits after the pump
  }
  for (const k of LAID_KINDS) out.push(laidItem(k));
  for (const o of DECOR_OPTIONS) {
    const it = decorItem(sim, o.id);
    if (it) out.push(it);
  }
  const order = BUILD_TABS.map((t) => t.id);
  const lead: DecorSet = inside ? 'indoor' : 'garden';
  const setRank = (i: BuildItem) => (i.set && i.set !== lead ? 1 : 0);
  return out.sort((a, b) => order.indexOf(a.tab) - order.indexOf(b.tab) || setRank(a) - setRank(b)); // stable: data order within a set
}

/** One piece by its tool (undefined: not buildable now, or not a build tool). */
export function buildItem(sim: Sim, tool: Tool | string): BuildItem | undefined {
  if (!tool) return undefined;
  if (tool === 'pipe') return pipeItem(sim);
  if (tool === 'footpath' || tool === 'road' || tool === 'grass') return laidItem(tool);
  if (tool.startsWith('decor:')) return decorItem(sim, tool.slice(6));
  if (tool in MACHINES && tool !== 'core') return machineItem(sim, tool as BuildableType);
  return undefined;
}

/**
 * #847: the set heading to put before each piece of one tab's list (undefined: none). With both sets of decorations
 * listed, each set opens with its heading, so the second set starts a row of its own; with one set, no headings.
 */
export function setHeads(items: readonly BuildItem[]): (DecorSet | undefined)[] {
  const both = new Set(items.map((i) => i.set).filter(Boolean)).size > 1;
  return items.map((i, n) => (both && i.set && i.set !== items[n - 1]?.set ? i.set : undefined));
}

/** The tabs that have something in them now. */
export function buildTabs(items: readonly BuildItem[]): (typeof BUILD_TABS)[number][] {
  return BUILD_TABS.filter((t) => items.some((i) => i.tab === t.id));
}

/** "1 of 2 Copper" */
export const costWords = (c: BuildCost) => `${Math.min(c.have, c.need)} of ${c.need} ${c.name}`;

/** What a short recipe still lacks, in a plain sentence ("One more Copper.", "2 more Wire and 1 more Scrap."). */
export function shortWords(cost: readonly BuildCost[]): string {
  const miss = cost.filter((c) => c.have < c.need).map((c) => (c.need - c.have === 1 ? `One more ${c.name}` : `${c.need - c.have} more ${c.name}`));
  if (!miss.length) return '';
  const s = miss.length === 1 ? miss[0] : `${miss.slice(0, -1).join(', ')} and ${miss[miss.length - 1].replace(/^One/, 'one')}`;
  return `${s}.`;
}
