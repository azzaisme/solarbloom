import type { AbilityId } from '../core/types';
import { GROUND } from '../core/GameState';
import { PARK } from '../core/Areas';
import { itemDef } from '../data/items';
import { PARK_SET } from '../data/oldcity';
import { PROJECTS, RESEARCH_UPGRADES, type ProjectDef } from '../data/research';
import { TIERS } from '../data/salvage';
import type { ItemCost } from '../data/crafting';
import type { Sim } from '../gameplay/Sim';

/**
 * #620 (E24): Bloombot's page in the backpack. Everything it can grow into, in one place: the moves the fountain
 * teaches (Pry, Hover, Climb, Glide) and the five workshop upgrades with their levels, each with what it does, where
 * it stands and how to get the next one. Pure reads (tests check the words without a page); Backpack draws it.
 *
 * E25 (#629) grows this page: a turntable of Bloombot beside the list, the part each row changes lit up. Each row's
 * `part` names that part (BloombotVisuals' growth pieces) so the view can find it.
 */
export type BloombotRowKind = 'move' | 'upgrade';
/** have: learned or at its top level; next: the one to work on now; later: not yet. */
export type BloombotRowState = 'have' | 'next' | 'later';

export interface BloombotRow {
  id: string;
  kind: BloombotRowKind;
  name: string;
  /** what it does, one short line */
  does: string;
  state: BloombotRowState;
  /** upgrades: the level now and the most it goes to */
  level?: number;
  max?: number;
  /** what the next level adds (upgrades below their top level) */
  next?: string;
  /** how to get it, or its next level, in plain words */
  how: string;
  /** where Show me where leads (a cell on the ground), when there is somewhere to go */
  where?: { roofId: string; x: number; z: number; name: string };
  /** the part of Bloombot it changes (#629's turntable lights it) */
  part: 'leaves' | 'cells' | 'pockets' | 'pulse' | 'stride' | 'core';
}

const MOVES: Record<AbilityId, { name: string; does: string }> = {
  pry: { name: 'Pry', does: 'Pries open the rubble that blocks a way.' },
  hover: { name: 'Hover', does: 'Floats over water too deep to wade.' },
  climb: { name: 'Climb', does: 'Climbs up onto the roofs.' },
  glide: { name: 'Glide', does: 'Glides down from the edge of a roof.' },
};

/** The part each upgrade changes on Bloombot. */
const UPGRADE_PART: Record<string, BloombotRow['part']> = {
  chargeCells: 'cells',
  chargeEfficiency: 'core',
  sprint: 'stride',
  pulseRadius: 'pulse',
  backpack: 'pockets',
};

const listWords = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''));
const costWords = (cost: ItemCost) => listWords(Object.entries(cost).map(([id, n]) => `${n} ${itemDef(id as never)?.name ?? id}`));

/** The fountain, as somewhere to go (a cell just in front of it). */
function fountainSpot(sim: Sim) {
  const [x, z] = sim.areas.info(PARK).landmark;
  return { roofId: GROUND, x, z: z + 2, name: 'the fountain' };
}

/** The house, where the workshop is (its door). */
const houseSpot = () => ({ roofId: GROUND, x: PARK_SET.shed.door[0], z: PARK_SET.shed.door[1], name: 'the house' });

/** The four moves, in the order the fountain teaches them. */
export function moveRows(sim: Sim): BloombotRow[] {
  const have = sim.state.salvage?.abilities ?? [];
  const steps = TIERS.filter((t) => t.ability);
  const next = steps.find((t) => !have.includes(t.ability!));
  return steps.map((t) => {
    const a = t.ability!;
    const m = MOVES[a];
    const learned = have.includes(a);
    const isNext = !learned && t === next;
    const how = learned
      ? 'Learned.'
      : t.tier === 1
        ? `Wake the fountain and it teaches this.${isNext ? ' The goal card lists what it needs.' : ''}`
        : `The fountain teaches this at step ${t.tier}, ${t.name}.${isNext ? ' The goal card lists what that step needs.' : ''}`;
    return { id: a, kind: 'move', name: m.name, does: m.does, state: learned ? 'have' : isNext ? 'next' : 'later', how, where: learned ? undefined : fountainSpot(sim), part: 'leaves' };
  });
}

/** How to open an upgrade that research hasn't opened yet. */
function openHow(sim: Sim, p: ProjectDef | undefined): string {
  const r = sim.research;
  if (!p) return 'Research opens it in the workshop.';
  const name = `“${p.name}”`;
  if (!r.on) return `Research ${name} in the workshop in the house. The workshop starts research once you wake the first Keeper.`;
  if (r.running(p.id)) return `${name} is on the workshop bench now. It opens when that's done.`;
  if (r.isOpen(p)) return `Research ${name} in the workshop in the house.`;
  if ('project' in p.opens) {
    const before = r.project(p.opens.project);
    return `Research ${name} in the workshop. It comes after “${before?.name ?? p.opens.project}”.`;
  }
  return `Research ${name} in the workshop. It opens once you've looked closely at ${r.findName(p.opens)} there.`;
}

/** The five workshop upgrades for Bloombot, in data order. */
export function bloombotUpgradeRows(sim: Sim): BloombotRow[] {
  const r = sim.research;
  const open = r.upgrades();
  return RESEARCH_UPGRADES.filter((u) => u.branch === 'bloombot').map((u) => {
    const level = r.level(u.id);
    const max = u.levels.length;
    const project = PROJECTS.find((p) => 'upgrade' in p.gives && (p.gives as { upgrade: string }).upgrade === u.id);
    const isOpen = open.includes(u);
    const top = level >= max;
    const how = top
      ? 'As far as it goes.'
      : !isOpen
        ? openHow(sim, project)
        : `Make level ${level + 1} in the workshop's Upgrade tab, in the house. It takes ${costWords(u.levels[level].cost)}.`;
    return {
      id: u.id,
      kind: 'upgrade',
      name: u.name,
      does: u.each,
      state: top ? 'have' : isOpen ? 'next' : 'later',
      level,
      max,
      next: top ? undefined : u.each,
      how,
      where: top ? undefined : houseSpot(),
      part: UPGRADE_PART[u.id] ?? 'core',
    };
  });
}

/** The whole page: moves, then upgrades. */
export function bloombotRows(sim: Sim): BloombotRow[] {
  return [...moveRows(sim), ...bloombotUpgradeRows(sim)];
}

/** "Level 2 of 3" as pips (filled for each level). */
export const pips = (level: number, max: number) => '●'.repeat(Math.min(level, max)) + '○'.repeat(Math.max(0, max - level));

/** What a row's state reads as, for its chip. */
export function stateWords(r: BloombotRow): string {
  if (r.kind === 'move') return r.state === 'have' ? 'Learned' : r.state === 'next' ? 'Next' : 'Later';
  if (r.state === 'have') return 'Top level';
  return `Level ${r.level} of ${r.max}`;
}
