import type { ItemId, MaterialId } from '../core/types';
import { giftLabel } from '../gameplay/KeeperSystem';
import { COMPONENT_IDS, COMPONENTS } from '../data/crafting';
import { PARK } from '../core/Areas';
import { KEEPER_STORIES } from '../data/keepers';
import { BLUEPRINTS, ITEMS, KEEPERS, KEEPSAKES, PAGES, REGIONS } from '../data/oldcity';
import { DECOR_OPTIONS, PLOT_OPTIONS } from '../data/cozy';
import { MACHINES } from '../data/machines';
import { MATERIAL_IDS, MATERIALS } from '../data/salvage';
import { itemDef } from '../data/items';
import { MAINLAND } from '../data/mainland';

/** The backpack's materials: the mainland's own (Steel) only once the mainland is open (island release). */
export const visibleMaterials = (): MaterialId[] => MATERIAL_IDS.filter((m) => MAINLAND.open || !MATERIALS[m].mainlandOnly);
import type { Sim } from '../gameplay/Sim';

/**
 * E22.6 (#343): what the backpack screen shows, read from the game (E21's materials, store, requests, pages,
 * blueprints, keepsakes; the cats, wildlife, landmarks, plots and decorations found). Pure reads, so tests check
 * the words and the screen-reader labels without a page. The one thing the screen writes is the pin (`pinRequest`),
 * which is a presentation choice kept in the save's `seen` list.
 */
export const TABS = [
  { id: 'items', label: 'Items' },
  { id: 'requests', label: 'Requests' },
  { id: 'journal', label: 'Journal' },
  { id: 'collection', label: 'Collection' },
  { id: 'blueprints', label: 'Blueprints' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

const regionName = (id: string) => (id === 'park' ? 'the park' : id === 'backstreet' ? 'the backstreets' : (REGIONS.find((r) => r.id === id)?.name ?? id));
const list = (parts: string[]) => (parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

export interface ItemCell {
  id: ItemId;
  name: string;
  /** found yet? (an unseen material keeps its name and where it comes from to itself) */
  seen: boolean;
  count: number;
  limit: number;
  stored: number;
  /** "Copper, 32 of 40 in backpack, 110 in store" */
  label: string;
  /** where it comes from (once seen) */
  from: string;
  /** what needs it next */
  next: string;
}

/** A material is known once held, stored, or its region seen (as E21's storage panel decides). */
export function materialSeen(sim: Sim, m: MaterialId): boolean {
  const inv = sim.inventory;
  return m === 'scrap' || m === 'seeds' || inv.count(m) > 0 || inv.stored(m) > 0 || !!sim.state.salvage?.seen?.includes(`mat:${m}`);
}

/** What needs a material next: the pinned request, the fountain's next step, then the first recipe open to build. */
export function neededNext(sim: Sim, m: MaterialId): string {
  const pin = pinnedRequest(sim);
  const want = pin ? sim.keepers.wants(pin.id)?.[m] : undefined;
  if (pin && want) return `${sim.keepers.def(pin.id).name} asks for ${want}`;
  const t = sim.fountain.next();
  if (t && t.delivery[m] && sim.fountain.remaining(m) > 0) return `The fountain still needs ${sim.fountain.remaining(m)}`;
  // E23.6.1: the first known machine or component recipe that takes it
  for (const r of sim.crafting.machines()) if (r.builds && r.cost[m]) return `A ${MACHINES[r.builds].name} takes ${r.cost[m]}`;
  for (const r of sim.crafting.components()) if (r.cost[m]) return `${itemDef(r.id).name} takes ${r.cost[m]}`;
  return 'Nothing needs it yet';
}

export function itemCells(sim: Sim): ItemCell[] {
  const inv = sim.inventory;
  const limit = inv.stackLimit();
  return visibleMaterials().map((id): ItemCell => {
    const seen = materialSeen(sim, id);
    const count = inv.count(id);
    const stored = inv.stored(id);
    const name = seen ? MATERIALS[id].name : 'Not found yet';
    return {
      id,
      name,
      seen,
      count,
      limit,
      stored,
      label: seen ? `${name}, ${count} of ${limit} in backpack, ${stored} in store` : 'A material not found yet',
      from: !seen ? 'Somewhere in the city' : MATERIALS[id].from ?? (MATERIALS[id].place ? `Found in ${MATERIALS[id].place}` : undefined) ?? `Found in ${list(MATERIALS[id].home.slice(0, 3).map(regionName))}${MATERIALS[id].home.length > 3 ? ' and across the city' : ''}`,
      next: seen ? neededNext(sim, id) : '',
    };
  }).concat(componentCells(sim, limit));
}

/** E23.6.1: components carried or stored, after the materials (made at the crafting table). */
function componentCells(sim: Sim, limit: number): ItemCell[] {
  const inv = sim.inventory;
  return COMPONENT_IDS.filter((id) => inv.count(id) > 0 || inv.stored(id) > 0).map((id) => {
    const name = COMPONENTS[id].name;
    const count = inv.count(id);
    const stored = inv.stored(id);
    const uses = sim.crafting.machines().find((r) => r.builds && r.cost[id]);
    return {
      id,
      name,
      seen: true,
      count,
      limit,
      stored,
      label: `${name}, ${count} of ${limit} in backpack, ${stored} in store`,
      from: 'Made at the crafting table',
      next: uses ? `A ${uses.name} takes ${uses.cost[id]}` : 'Nothing needs it yet',
    };
  });
}

/** One-off items carried (the Heart Seed, the Star Lens), and the crops kept for the Keepers (E23.9.2). */
export function oneOffItems(sim: Sim): { id: string; name: string; from: string }[] {
  const items = (sim.state.salvage?.items ?? []).map((id) => ({ id, name: ITEMS[id]?.name ?? id, from: `From ${regionName(ITEMS[id]?.from ?? '')}` }));
  const basket = Object.entries(sim.state.salvage?.basket ?? {})
    .filter(([, n]) => n > 0)
    .map(([crop, n]) => ({ id: `basket:${crop}`, name: `${giftLabel(crop).name}${n > 1 ? ` ×${n}` : ''}`, from: 'Kept for a friend' }));
  return [...items, ...basket];
}

export interface RequestRow {
  id: string;
  keeper: string;
  region: string;
  text: string;
  pinned: boolean;
}

const PIN = 'pin:';

/** The pinned request: the player's choice while that Keeper still asks for something, else the first open one. */
export function pinnedRequest(sim: Sim): { id: string; text: string } | undefined {
  const open = sim.keepers.requests();
  const chosen = sim.state.salvage?.seen?.find((s) => s.startsWith(PIN))?.slice(PIN.length);
  return open.find((r) => r.id === chosen) ?? open[0];
}

/** Pins a Keeper's request (the objective card shows it). Presentation only: kept in the save's `seen` list. */
export function pinRequest(sim: Sim, keeperId: string) {
  const sv = sim.state.salvage;
  if (!sv) return;
  sv.seen = [...(sv.seen ?? []).filter((s) => !s.startsWith(PIN)), `${PIN}${keeperId}`];
}

/** Pins the request after the pinned one (the "Pin next request" button). Returns the newly pinned one. */
export function pinNext(sim: Sim): RequestRow | undefined {
  const rows = requestRows(sim);
  if (!rows.length) return undefined;
  const i = rows.findIndex((r) => r.pinned);
  const next = rows[(i + 1) % rows.length];
  pinRequest(sim, next.id);
  return { ...next, pinned: true };
}

export function requestRows(sim: Sim): RequestRow[] {
  const pin = pinnedRequest(sim);
  return sim.keepers.requests().map((r) => ({ id: r.id, keeper: sim.keepers.def(r.id).name, region: sim.keepers.region(r.id).name, text: r.text, pinned: r.id === pin?.id }));
}

export interface PageRow {
  id: string;
  n: number;
  found: boolean;
  title: string;
  text: string;
}

/** The journal: every page in book order, the ones not found yet as gaps. */
export function journalPages(sim: Sim): PageRow[] {
  const found = new Set(sim.state.salvage?.pages ?? []);
  return Object.entries(PAGES).map(([id, p], i) => ({ id, n: i + 1, found: found.has(id), title: found.has(id) ? p.title : 'A missing page', text: found.has(id) ? p.text : 'Not found yet.' }));
}

export interface BlueprintRow {
  id: string;
  found: boolean;
  name: string;
  where: string;
}

export function blueprintRows(sim: Sim): BlueprintRow[] {
  const found = new Set(sim.state.salvage?.blueprints ?? []);
  return BLUEPRINTS.map((b) => ({ id: b.id, found: found.has(b.id), name: found.has(b.id) ? b.name : 'Not found yet', where: found.has(b.id) ? `Found in ${regionName(b.region)}` : 'A blueprint waits in a cache somewhere' }));
}

export interface CollectionGroup {
  title: string;
  /** "3 of 10" */
  count: string;
  rows: { name: string; detail: string; found: boolean }[];
  empty: string;
}

/** The collection: cats, keepsakes, wildlife, landmarks, plots and decorations. No reward names, no multipliers. */
/**
 * E23.2.4.3 (#416): the visitor log, every kind of animal that has come to sit with bloombot: how often and where.
 * Kinds not met yet keep their names to themselves; the rare ones say they are rare.
 */
function visitors(sim: Sim): CollectionGroup {
  const rows = sim.wildlife.logRows();
  const met = rows.filter((r) => r.seen);
  const areaName = (id: string) => {
    const info = sim.areas.info(id);
    return info.region ? regionName(info.region) : id === PARK ? 'the park' : info.landmarkName;
  };
  return {
    title: 'Visitors',
    count: `${met.length} of ${rows.length}`,
    rows: rows.map(({ def, seen }) =>
      seen
        ? { name: `${def.icon} ${def.name}`, detail: `${seen.count === 1 ? 'Sat with you once' : `Sat with you ${seen.count} times`}, in ${list([...new Set(seen.where.map(areaName))])}${def.rare ? ' · rare' : ''}`, found: true }
        : { name: 'Not met yet', detail: def.rare ? 'A rare visitor' : 'Still out there', found: false },
    ),
    empty: '',
  };
}

export function collection(sim: Sim): CollectionGroup[] {
  const st = sim.state;
  const cz = st.cozy;
  // cats: how many, and where (a region or area by name)
  const where = new Map<string, number>();
  for (const e of st.cat.log ?? []) {
    const a = sim.cat.anchor(e.anchorId);
    const cell = a?.needsFreeTile ?? (a ? [Math.floor(a.pos[0]), Math.floor(a.pos[2])] : undefined);
    const id = cell ? sim.areas.areaOf({ roofId: a!.roofId, x: cell[0], z: cell[1] }) : undefined;
    const info = id ? sim.areas.info(id) : undefined;
    const name = info?.region ? regionName(info.region) : id === PARK || !id ? 'the park' : info!.landmarkName;
    where.set(name, (where.get(name) ?? 0) + 1);
  }
  const cats: CollectionGroup = {
    title: 'Lucky Cats',
    count: `${st.cat.found} found`,
    rows: [...where].map(([name, n]) => ({ name: `In ${name}`, detail: n === 1 ? 'One cat found' : `${n} cats found`, found: true })),
    empty: '',
  };
  // keepsakes: the ones Lucky Cats leave, and one per region
  const unlocked = new Set([...(cz?.decorUnlocked ?? []), ...(st.salvage?.items ?? []), ...(st.salvage?.caches ?? [])]);
  // E23.12.2: a cat-only decoration is the Lucky Cat's gift: found once a cat has left it (it comes made)
  const catKeeps = DECOR_OPTIONS.filter((o) => 'cat' in o.unlock).map((o) => {
    const found = unlocked.has(o.id) || sim.crafting.decorMade(o.id);
    return { name: found ? o.name : 'Not found yet', detail: found ? o.blurb : 'Still out there somewhere', found };
  });
  const regionKeeps = KEEPSAKES.map((k) => ({ name: unlocked.has(k.id) ? k.name : 'Not found yet', detail: unlocked.has(k.id) ? `From ${regionName(k.region)}` : 'One day, a friend will give you this', found: unlocked.has(k.id) }));
  const keeps = [...catKeeps, ...regionKeeps];
  const fauna = Object.keys(st.fauna ?? {});
  const woken = sim.areas.revealed().filter((id) => sim.areas.fog(id) === 'cleared').map((id) => sim.areas.info(id));
  const plots = PLOT_OPTIONS.filter((o) => 'start' in o.unlock || cz?.unlocked?.includes(o.id));
  const decor = DECOR_OPTIONS.filter((o) => 'start' in o.unlock || cz?.decorUnlocked?.includes(o.id));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  // E23.9.2: the Keepers bloombot has woken, with what each is like and how close a friend it is
  const awake = KEEPERS.filter((k) => sim.keepers.step(k.id) !== 'asleep');
  const friends: CollectionGroup = {
    title: 'Friends',
    count: `${awake.filter((k) => sim.keepers.isFriend(k.id)).length} of ${KEEPERS.length}`,
    rows: awake.map((k) => ({
      name: sim.keepers.isFriend(k.id) ? `${k.name}, a friend` : k.name,
      detail: KEEPER_STORIES[k.id]?.personality ?? regionName(k.region),
      found: true,
    })),
    empty: 'The other robots are asleep. Pulse one to wake it.',
  };
  return [
    // E23.12.3 (epic rule 8): the Lucky Cats group appears with the first find (before that it would give them away)
    ...(sim.cat.known ? [cats] : []),
    friends,
    { title: 'Keepsakes', count: `${keeps.filter((k) => k.found).length} of ${keeps.length}`, rows: keeps, empty: '' },
    { title: 'Wildlife', count: `${fauna.length} kinds`, rows: fauna.map((f) => ({ name: cap(f), detail: 'Lives in your gardens', found: true })), empty: 'Wildlife arrives as gardens grow.' },
    visitors(sim),
    { title: 'Landmarks', count: `${woken.length} awake`, rows: woken.map((a) => ({ name: a.region ? (REGIONS.find((r) => r.id === a.region)?.landmark.name ?? a.landmarkName) : a.landmarkName, detail: a.region ? `In ${regionName(a.region)}` : 'Awake', found: true })), empty: 'Bring a place back to life to wake its landmark.' },
    { title: 'Plots', count: `${plots.length} of ${PLOT_OPTIONS.length}`, rows: plots.map((o) => ({ name: o.name, detail: o.blurb, found: true })), empty: '' },
    { title: 'Decorations', count: `${decor.length} of ${DECOR_OPTIONS.length}`, rows: decor.map((o) => ({ name: o.name, detail: o.blurb, found: true })), empty: '' },
  ];
}
