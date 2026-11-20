import type { BuildableType, ItemId } from '../core/types';
import { DECOR_OPTION, DECOR_OPTIONS } from '../data/cozy';
import type { Unlock } from '../data/crafting';
import { BUILDABLE, MACHINES } from '../data/machines';
import { KEEPERS } from '../data/oldcity';
import { WATER_NET } from '../data/water';
import { decorOpen } from '../gameplay/Cozy';
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
export type BuildTabId = 'machines' | 'power' | 'water' | 'farm' | 'storage' | 'decorations';

export const BUILD_TABS: readonly { id: BuildTabId; label: string; icon: IconName }[] = [
  { id: 'machines', label: 'Machines', icon: 'wrench' },
  { id: 'power', label: 'Power', icon: 'energy' },
  { id: 'water', label: 'Water', icon: 'water' },
  { id: 'farm', label: 'Farm', icon: 'sprout' },
  { id: 'storage', label: 'Storage', icon: 'parcel' },
  { id: 'decorations', label: 'Decorations', icon: 'flower' },
];

/** E23.11: the build hotbar's default slots 1–9 (the build board's row; the build menu pins others). */
export const HOTBAR_DEFAULT: readonly string[] = ['solar', 'battery', 'relay', 'planter', 'compostBin', 'pump', 'pipe', '', ''];

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
  cultivator: 'machines',
  droneHub: 'machines',
  chest: 'storage',
};

/** One plain line about each piece (the menu's detail pane): what it does for you, no numbers. */
const LINES: Record<BuildableType | 'pipe', string> = {
  solar: 'Feeds the grid it stands on while the sun is up. Link it to a battery to keep the lights on after dark.',
  battery: 'Keeps what the grid has spare and gives it back after dark.',
  gridBattery: 'A big store for a whole grid: it keeps the lights on through a long night.',
  relay: 'Carries power along: a line of them reaches a machine far from the panels.',
  windTurbine: 'Turns on windy days and in storms, and catches more wind up high.',
  charger: 'A pad on the grid. Sit on it and bloombot fills up fast.',
  bioDigester: 'Feed it Greens and it powers its grid, day or night, until it runs empty.',
  condenser: 'Pulls water from the air, then waters the dry soil beside it into bloom.',
  reservoir: 'Holds water. Rain fills it, and so does a pond on its bank or a pipe from a pump.',
  pump: 'Stands on the bank of a pond or canal and pushes its water along the pipes it touches.',
  pipe: 'Laid tile by tile, it carries water from a pump or a high tank to where it is needed.',
  desalination: 'Built on the shore, it turns the sea into fresh water on grid power, in any weather.',
  reservoirGarden: 'Condensers nearby fill its basin. Once it is full, dry ground around it bursts into flower.',
  planter: 'A raised bed: plant seeds in it, keep it watered and pick the food.',
  compostBin: 'Fill it with Greens and food scraps: they rot down into compost, then fertiliser.',
  pollinator: 'Ground you restore near it spreads to the mossy ground next door.',
  motherTree: 'Every restoration nearby feeds it, until it blooms everything around it at once.',
  cultivator: 'A solar tiller that slowly breaks the dead ground near its dock into bloom on its own.',
  droneHub: 'Sends out a little drone that restores the ground near the hub, on power from the grid.',
  chest: 'A way into the city’s shared store: open it to put things away or take them out.',
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
  motherTree: 'Tree',
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
}

/** "Wake Sluice": who to wake (or what to do) for a locked recipe. Never names a Lucky Cat. */
export function unlockText(u: Unlock): string {
  if ('keeper' in u) {
    const k = KEEPERS.find((x) => x.region === u.keeper);
    return k ? `Wake ${k.name}` : 'Wake its Keeper';
  }
  if ('tier' in u) return 'Grow the fountain';
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
    kind: def.size > 1 ? `Takes ${def.size} by ${def.size} tiles` : 'Takes one tile',
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
    kind: 'Laid one tile at a time',
    line: LINES.pipe,
    locked,
    lockText: locked ? `Wake ${k?.name ?? 'the Keeper'}` : undefined,
    cost,
    affordable: !locked && sim.inventory.canPay(WATER_NET.pipe.cost as never),
  };
}

/** A decoration: open ones are free to place; one the table can make shows as locked with that; finds stay hidden. */
function decorItem(sim: Sim, id: string): BuildItem | undefined {
  const o = DECOR_OPTION[id];
  if (!o) return undefined;
  const open = decorOpen(sim, o);
  if (!open) {
    const r = sim.crafting.decor(id);
    if (!r || 'cat' in r.unlock || !sim.crafting.unlocked(r.unlock)) return undefined;
  }
  return {
    tool: `decor:${id}`,
    tab: 'decorations',
    name: o.name,
    short: o.name,
    icon: iconize(o.icon),
    kind: o.solid ? 'Free to place · stands in the way' : 'Free to place · walk right over it',
    line: o.blurb,
    locked: !open,
    lockText: open ? undefined : 'Make it at the table',
    cost: [],
    affordable: open,
  };
}

/** Every piece the build menu lists, in tab order then data order. */
export function buildItems(sim: Sim): BuildItem[] {
  const out: BuildItem[] = [];
  for (const t of BUILDABLE) {
    const it = machineItem(sim, t);
    if (it) out.push(it);
    if (t === 'pump') out.push(pipeItem(sim)); // the pipe sits after the pump
  }
  for (const o of DECOR_OPTIONS) {
    const it = decorItem(sim, o.id);
    if (it) out.push(it);
  }
  const order = BUILD_TABS.map((t) => t.id);
  return out.sort((a, b) => order.indexOf(a.tab) - order.indexOf(b.tab));
}

/** One piece by its tool (undefined: not buildable now, or not a build tool). */
export function buildItem(sim: Sim, tool: Tool | string): BuildItem | undefined {
  if (!tool) return undefined;
  if (tool === 'pipe') return pipeItem(sim);
  if (tool.startsWith('decor:')) return decorItem(sim, tool.slice(6));
  if (tool in MACHINES && tool !== 'core') return machineItem(sim, tool as BuildableType);
  return undefined;
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
