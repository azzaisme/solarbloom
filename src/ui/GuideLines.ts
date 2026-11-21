import type { Action } from '../app/Bindings';
import type { MaterialId } from '../core/types';
import { PARK } from '../core/Areas';
import { REGIONS } from '../data/oldcity';
import { MATERIALS } from '../data/salvage';
import type { Sim } from '../gameplay/Sim';

/**
 * #607 (E24): the guide's lines, each shown once, when its idea first comes up. Show, don't tell: one line
 * introduces something new, then the world carries it. A line is never shown for something the player already
 * does (a returning save, or a step they found by themselves): it is marked as known without a word.
 *
 * Each idea has `comes` (it has come up: now is the moment to say it) and `known` (the player has done it, so it
 * never needs saying). Ideas come in the order a new game meets them; one is shown at a time.
 */
export type IdeaId = 'salvage' | 'pulse' | 'park' | 'fountain' | 'parkDone' | 'build' | 'pry' | 'keepers';

/** What the key function gives for an action on the mouse's left button: the line says "Click" instead. */
export const CLICK = 'Click';

export interface Idea {
  id: IdeaId;
  /**
   * the line (HTML), naming the player's own key or button: `key` gives its glyph, or CLICK for the mouse's left
   * button (and, for some, what the game holds now)
   */
  text: (key: (a: Action) => string, sim: Sim) => string;
  /** the idea has come up now */
  comes: (sim: Sim) => boolean;
  /** the player already knows it (has done it) */
  known: (sim: Sim) => boolean;
}

const sv = (sim: Sim) => sim.state.salvage;
const salvaged = (sim: Sim) => Object.keys(sv(sim)?.piles ?? {}).length > 0;
const handedIn = (sim: Sim) => Object.values(sv(sim)?.delivered ?? {}).some((n) => (n ?? 0) > 0) || (sv(sim)?.tier ?? 0) >= 1;
const pried = (sim: Sim) => REGIONS.some((r) => r.gate.needs.ability === 'pry' && sv(sim)?.opened.includes(r.gate.id));
const keeperAwake = (sim: Sim) => Object.values(sv(sim)?.keepers ?? {}).some((k) => (k?.step ?? 'asleep') !== 'asleep');
const built = (sim: Sim) => sim.state.machines.some((m) => !m.starter && m.type !== 'core');
const carriesForFountain = (sim: Sim) => {
  const t = sim.fountain.next();
  return !!t && (Object.keys(t.delivery) as string[]).some((k) => k !== 'biomass' && sim.inventory.count(k as MaterialId) > 0);
};

/** #608: what the fountain's step still wants that bloombot doesn't carry (by name). */
export function stillWanted(sim: Sim): string[] {
  const t = sim.fountain.next();
  if (!t) return [];
  return (Object.keys(t.delivery) as string[])
    .filter((k) => k !== 'biomass' && sim.fountain.remaining(k as MaterialId) > sim.inventory.available(k as MaterialId))
    .map((k) => MATERIALS[k as MaterialId].name);
}

const listWords = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);

export const IDEAS: readonly Idea[] = [
  {
    id: 'salvage',
    text: (k) => `Hold ${k('interact')} by a glinting pile to pick through it.`,
    comes: () => true,
    known: salvaged,
  },
  {
    id: 'pulse',
    text: (k) => (k('pulse') === CLICK ? 'Click the bare red ground to turn it green.' : `Press ${k('pulse')} by the bare red ground to turn it green.`),
    comes: salvaged,
    known: (sim) => (sim.state.stats.pulses ?? 0) > 0,
  },
  {
    id: 'park',
    text: () => 'Keep pulsing the ground around the fountain. Every green patch helps wake it.',
    // after the player's own first pulse (a drone's tile at the start is not the moment)
    comes: (sim) => (sim.state.stats.pulses ?? 0) > 0,
    known: (sim) => (sv(sim)?.tier ?? 0) >= 1 || sim.areas.counts(PARK).restored >= (sim.fountain.next()?.needs.parkTiles ?? Infinity),
  },
  {
    id: 'fountain',
    text: (k) => `Take what you find to the fountain in the middle. Press ${k('interact')} there to hand it in.`,
    comes: carriesForFountain,
    known: handedIn,
  },
  {
    // #608: the park's part of the first step is done: say so, and what is left (the piles glint)
    id: 'parkDone',
    text: (k, sim) => {
      const short = stillWanted(sim);
      return short.length
        ? `The fountain still needs ${listWords(short)}. Hold ${k('interact')} by the glinting piles to find them.`
        : `The fountain has all it needs. Walk up to it and press ${k('interact')} to wake it.`;
    },
    comes: (sim) => {
      const t = sim.fountain.next();
      return !!t && t.needs.parkTiles !== undefined && sim.fountain.condition(t).done;
    },
    known: (sim) => (sv(sim)?.tier ?? 0) >= 1,
  },
  {
    id: 'build',
    text: (k) => `You can build things now. Press ${k('buildMenu')} to see what you can put down.`,
    comes: (sim) => (sv(sim)?.tier ?? 0) >= 1,
    known: built,
  },
  {
    id: 'pry',
    text: (k) => `You can pry rubble open now. Hold ${k('interact')} at the rubble piled across a way out of the park.`,
    comes: (sim) => !!sv(sim)?.abilities.includes('pry'),
    known: pried,
  },
  {
    id: 'keepers',
    text: (k) => (k('pulse') === CLICK ? 'A robot sleeps past the rubble. Click it to pulse it, then talk to it.' : `A robot sleeps past the rubble. Press ${k('pulse')} by it to pulse it, then talk to it.`),
    comes: pried,
    known: keeperAwake,
  },
];

/**
 * Starts the list for a game. A new game starts empty. A save from before E24 has no list: everything that has
 * already come up in it counts as known (a returning player is never told what they've been doing).
 */
export function startIdeas(sim: Sim): void {
  const p = sim.state.progression;
  if (p.ideas) return;
  // the player's own progress (a drone restores a tile in a brand-new game, so restored tiles alone don't count)
  const played = p.tutorialStep > 0 || (sim.state.stats.pulses ?? 0) > 0 || salvaged(sim) || (sv(sim)?.tier ?? 0) > 0;
  p.ideas = played ? IDEAS.filter((i) => i.comes(sim) || i.known(sim)).map((i) => i.id) : [];
}

/** The ideas already shown or known (saved with the game). */
function seen(sim: Sim): string[] {
  const p = sim.state.progression;
  return (p.ideas ??= []);
}

/**
 * Marks as known, without a word, every idea the player has already done (a returning save, or something found
 * before its moment). Call it when a game starts and before each `due`.
 */
export function markKnown(sim: Sim): void {
  const s = seen(sim);
  for (const i of IDEAS) if (!s.includes(i.id) && i.known(sim)) s.push(i.id);
}

/** The next idea to say, if one has come up and hasn't been said (nothing is marked by asking). */
export function dueIdea(sim: Sim): Idea | undefined {
  markKnown(sim);
  const s = seen(sim);
  return IDEAS.find((i) => !s.includes(i.id) && i.comes(sim));
}

/** Records that an idea's line was shown (it never shows again). */
export function markShown(sim: Sim, id: IdeaId): void {
  const s = seen(sim);
  if (!s.includes(id)) s.push(id);
}
