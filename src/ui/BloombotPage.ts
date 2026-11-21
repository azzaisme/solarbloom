import type { AbilityId } from '../core/types';
import { UPGRADE_PART, type PartId } from '../data/botParts';
import { GROUND } from '../core/GameState';
import { PARK } from '../core/Areas';
import { PARK_GROWTH } from '../data/bloombot';
import { itemDef } from '../data/items';
import { PARK_SET } from '../data/oldcity';
import { PROJECTS, RESEARCH_UPGRADES, type ProjectDef } from '../data/research';
import { TIERS } from '../data/salvage';
import { MOVE_LEVEL_TWO, VAULTS } from '../data/moveSpots';
import type { ItemCost } from '../data/crafting';
import type { Sim } from '../gameplay/Sim';

/**
 * #620 (E24): Bloombot's page in the backpack. Everything it can grow into, in one place: the moves the fountain
 * teaches (Pry, Hover, Climb, Glide) and the five workshop upgrades with their levels, each with what it does, where
 * it stands and how to get the next one. Pure reads (tests check the words without a page); Backpack draws it.
 *
 * E25 (#626) adds each move's second level, from the workshop, with where it's used.
 * E25 (#629) grows this page: a turntable of Bloombot beside the list, the part each row changes lit up. Each row's
 * `part` names that part (BloombotVisuals' growth pieces) so the view can find it.
 */
export type BloombotRowKind = 'move' | 'move2' | 'park' | 'upgrade';
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
  /** #624: what it comes to now, with everything that stacks on it (the hold rows: how long digging takes) */
  now?: string;
  /** how to get it, or its next level, in plain words */
  how: string;
  /** where Show me where leads (a cell on the ground), when there is somewhere to go */
  where?: { roofId: string; x: number; z: number; name: string };
  /** the part of Bloombot it changes (#629's turntable lights it) */
  part: PartId;
}

const MOVES: Record<AbilityId, { name: string; does: string }> = {
  pry: { name: 'Pry', does: 'Pries open the rubble that blocks a way.' },
  hover: { name: 'Hover', does: 'Floats over water too deep to wade.' },
  climb: { name: 'Climb', does: 'Climbs up onto the roofs.' },
  glide: { name: 'Glide', does: 'Glides down from the edge of a roof.' },
};

/** What each upgrade's levels do for Bloombot, and why that helps (the workshop's own line is shorter). */
const UPGRADE_DOES: Record<string, string> = {
  chargeCells: 'Bloombot holds more charge, so it can keep going longer before it rests.',
  chargeEfficiency: 'Pulses and moves use less charge, so a full charge lasts longer.',
  sprint: 'Running uses less charge and goes a little faster.',
  pulseRadius: 'Each pulse brings back more ground at once.',
  backpack: 'Bloombot can carry 20 more of each thing.',
  // #624
  quickHands: 'Digging things out of piles and prying rubble open go quicker.',
  keenEye: 'Each pulse lights up piles and hidden things from further away. At level 3 they show on the map too.',
  sunSoak: 'Standing still in the sun slowly charges Bloombot, so it can top up anywhere by day.',
  lantern: 'Bloombot carries its own light at night, so dark streets are easier to see.',
  luckyPulse: 'Now and then a pulse on bare red ground turns up a few Seeds or Scrap.',
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
  const now = sim.state.salvage?.tier ?? 0;
  const times = ['', 'once more', 'twice more', 'three more times', 'four more times'];
  return steps.map((t) => {
    const a = t.ability!;
    const m = MOVES[a];
    const learned = have.includes(a);
    const isNext = !learned && t === next;
    // what the player does is bring the fountain what it asks for; the step's name isn't something they know
    const left = Math.max(1, t.tier - now);
    const how = learned
      ? 'Learned.'
      : left === 1
        ? 'Bring the fountain what it asks for and it teaches this. The goal card at the top left lists what that is.'
        : `The fountain teaches this once you've brought it what it asks for ${times[left] ?? `${left} more times`}.`;
    return { id: a, kind: 'move', name: m.name, does: m.does, state: learned ? 'have' : isNext ? 'next' : 'later', how, where: learned ? undefined : fountainSpot(sim), part: 'marks' };
  });
}

/** How to open an upgrade that research hasn't opened yet. */
function openHow(sim: Sim, p: ProjectDef | undefined, move = false): string {
  const r = sim.research;
  if (!p) return 'Research opens it in the workshop.';
  const name = `“${p.name}”`;
  if (!r.on) return `The workshop table in the house can work out how to ${move ? 'do' : 'make'} this. It starts once you wake another robot out in the city.`;
  if (r.running(p.id)) return `The workshop table in the house is working out ${name} now. ${move ? 'Bloombot learns it' : 'You can make this'} once it's done.`;
  if (r.isOpen(p)) return `Go to the workshop table in the house and start ${name} in its Research tab. Then ${move ? 'Bloombot learns it' : 'you can make this'}.`;
  if ('project' in p.opens) {
    const before = r.project(p.opens.project);
    return `The workshop table in the house has to work out “${before?.name ?? p.opens.project}” first, then ${name}.`;
  }
  return `Take a close look at ${r.findName(p.opens)} at the workshop table in the house. That opens ${name} in its Research tab.`;
}

/** E25 (#626): where each second level is used, while something there is still shut (a cell to stand on). */
function moveTwoSpot(sim: Sim, a: AbilityId): BloombotRow['where'] {
  const shut = (id: string) => !sim.state.salvage?.caches.includes(id);
  const at = (x: number, z: number, name: string) => ({ roofId: GROUND, x, z, name });
  if (a === 'pry') {
    const v = VAULTS.find((q) => shut(q.id));
    return v ? at(v.x, v.z + 1, 'an old vault') : undefined;
  }
  if (a === 'hover') return shut('s-sandbar') ? at(8, 47, 'the end of the jetty') : undefined;
  if (a === 'glide') return shut('s-oldPier') ? at(22, 47, 'the cliff east of the beach') : undefined;
  if (shut('s-marketRoof')) return at(29, 21, 'an old roof in the Old Market');
  return shut('s-boathouseRoof') ? at(-8, 27, 'the boathouse roof in Saltwind') : undefined;
}

/**
 * E25 (#626): each move's second level, worked out at the workshop table once the move itself is learned (Glide II
 * after Climb II). Learned, it says where it's used.
 */
export function moveTwoRows(sim: Sim): BloombotRow[] {
  const r = sim.research;
  return TIERS.filter((t) => t.ability).map((t) => {
    const a = t.ability!;
    const two = MOVE_LEVEL_TWO[a];
    const p = r.moveProject(a);
    const level = r.moveLevel(a);
    const have = level >= 2;
    const ready = level === 1 && !!p && (r.running(p.id) || r.isOpen(p));
    // the move that opens it at the workshop: the next one the fountain teaches (Glide II: Glide, then Climb II)
    const gate = p && 'move' in p.opens ? p.opens.move : a;
    const how = have
      ? two.where
      : !r.moveLevel(gate)
        ? `Bloombot has to learn ${MOVES[gate].name} at the fountain first. Then the workshop table in the house can work out “${two.name}”.`
        : openHow(sim, p, true);
    const where = have ? moveTwoSpot(sim, a) : !r.moveLevel(gate) ? fountainSpot(sim) : houseSpot();
    return { id: `${a}2`, kind: 'move2', name: two.name, does: two.does, state: have ? 'have' : ready ? 'next' : 'later', how, where, part: 'leaves' };
  });
}

/** The workshop upgrades for Bloombot (#620 and #624), in data order. */
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
        : `Go to the workshop table in the house and make level ${level + 1} in its Upgrade tab. It takes ${costWords(u.levels[level].cost)}.`;
    return {
      id: u.id,
      kind: 'upgrade',
      name: u.name,
      does: UPGRADE_DOES[u.id] ?? u.each,
      state: top ? 'have' : isOpen ? 'next' : 'later',
      level,
      max,
      next: top ? undefined : u.each,
      now: u.id === 'quickHands' ? holdNow(sim) : undefined,
      how,
      where: top ? undefined : houseSpot(),
      part: UPGRADE_PART[u.id] ?? 'core',
    };
  });
}

/**
 * #622: what greening the park grows Bloombot into, in the order it comes. The count is the goal card's Park count
 * (the park's ground brought back to life), so the player can see it climb.
 */
export function parkRows(sim: Sim): BloombotRow[] {
  const g = sim.parkGrowth;
  const n = g.tiles();
  const next = g.next();
  return PARK_GROWTH.map((d) => {
    const have = g.step >= d.step;
    const isNext = d === next;
    const how = have
      ? 'Grown with the park.'
      : isNext
        ? `Keep bringing the park back to life around the fountain. This grows at ${d.tiles} on the goal card's Park count, and it's at ${Math.min(n, d.tiles)} now.`
        : `Keep bringing the park back to life. This grows at ${d.tiles} on the goal card's Park count.`;
    return { id: d.id, kind: 'park', name: d.name, does: d.does, state: have ? 'have' : isNext ? 'next' : 'later', level: Math.min(n, d.tiles), max: d.tiles, now: d.id === 'quick' ? holdNow(sim) : undefined, how, where: have ? undefined : fountainSpot(sim), part: d.part };
  });
}

/** The whole page: moves, their second levels, what the park grew, then upgrades. */
export function bloombotRows(sim: Sim): BloombotRow[] {
  return [...moveRows(sim), ...moveTwoRows(sim), ...parkRows(sim), ...bloombotUpgradeRows(sim)];
}

/** The page's groups, in order, each with the count beside its title. */
export const BLOOMBOT_GROUPS: readonly { kind: BloombotRowKind; title: string; note: (rows: BloombotRow[]) => string }[] = [
  { kind: 'move', title: 'Moves', note: (rs) => `${rs.filter((r) => r.state === 'have').length} of ${rs.length} learned` },
  { kind: 'move2', title: 'Moves, level II', note: (rs) => `${rs.filter((r) => r.state === 'have').length} of ${rs.length} learned` },
  { kind: 'park', title: 'Grown with the park', note: (rs) => `${rs.filter((r) => r.state === 'have').length} of ${rs.length}` },
  {
    kind: 'upgrade',
    title: 'Upgrades',
    note: (rs) => `${rs.reduce((a, r) => a + (r.level ?? 0), 0)} of ${rs.reduce((a, r) => a + (r.max ?? 0), 0)} levels`,
  },
];

/** The heading over a row's "how" in the detail. */
export function howHeading(r: BloombotRow): string {
  if (r.kind === 'move2' && r.state === 'have') return 'Where to use it';
  if (r.kind === 'move' || r.kind === 'move2') return r.state === 'have' ? 'Learned' : 'How to learn it';
  if (r.kind === 'park') return r.state === 'have' ? 'Grown' : 'How it grows';
  return r.state === 'have' ? 'At its top level' : r.level ? 'The next level' : 'How to get it';
}

/** "Level 2 of 3" as pips (filled for each level). */
export const pips = (level: number, max: number) => '●'.repeat(Math.min(level, max)) + '○'.repeat(Math.max(0, max - level));

/** What a row's state reads as, for its chip. */
export function stateWords(r: BloombotRow): string {
  if (r.kind === 'move' || r.kind === 'move2') return r.state === 'have' ? 'Learned' : r.state === 'next' ? 'Next' : 'Later';
  if (r.kind === 'park') return r.state === 'have' ? 'Grown' : r.state === 'next' ? `${r.level} of ${r.max}` : 'Later';
  if (r.state === 'have') return 'Top level';
  return `Level ${r.level} of ${r.max}`;
}

/** Seconds, as the page says them: "0.42 seconds", "1.4 seconds", "2 seconds". */
const secs = (n: number) => `${+n.toFixed(2)} second${n === 1 ? '' : 's'}`;

/**
 * #624: how long digging and prying take now, with Nimble hands and Quick hands together (and the floor), for the
 * two rows that change it.
 */
export function holdNow(sim: Sim): string {
  return `Right now digging out a pile takes ${secs(sim.upgrades.salvageHold)}, and prying rubble open ${secs(sim.upgrades.pryHold)}.`;
}
