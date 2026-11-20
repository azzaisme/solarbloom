/**
 * E22.2 (#339): one prompt, one obvious action. Interact acts on a single target, chosen by a fixed priority
 * (docs/E22_CONTROLS_UI.md, decision 3) and, within a kind, nearest first:
 *
 *   Lucky Cat → Keeper → salvage pile → cache or page → gate, ladder or perch → door → storage → bench (E23.2.3) → landmark or
 *   fountain → machine → decoration → plot → nothing.
 *
 * The game gathers what is within reach and in front of bloombot (`Candidate`s); `pickTarget` chooses. Pure, so
 * the priority can be tested pair by pair. E21's kinds (Keepers, salvage, caches, doors, storage) slot in by
 * adding candidates of their kind; nothing here changes.
 */
export const PRIORITY = ['cat', 'keeper', 'salvage', 'cache', 'gate', 'door', 'storage', 'bench', 'landmark', 'machine', 'decoration', 'plot'] as const;
export type TargetKind = (typeof PRIORITY)[number];

/** How long a hold takes, in seconds, for the actions that are holds (decision 4). */
export const HOLD_SECONDS = { salvage: 0.6, pry: 2 } as const;

export interface Candidate {
  kind: TargetKind;
  /** stable id (for change detection and the outline) */
  id: string;
  /** the verb on the prompt ("Salvage", "Talk to", "Wake") */
  verb: string;
  /** what it acts on ("Pylon", "the fountain"); may be empty */
  name: string;
  /** distance from bloombot, in tiles */
  distance: number;
  /** seconds to hold Interact (unless holds are switched to a single press) */
  hold?: number;
  /** why it can't be done now ("Backpack full"); the prompt says so and Interact does nothing */
  refused?: string;
}

/** The single thing Interact will act on: the highest-priority kind within reach, nearest first. */
export function pickTarget<T extends Candidate>(cands: readonly T[], reach = Infinity): T | undefined {
  let best: T | undefined;
  let bestRank = Infinity;
  for (const c of cands) {
    if (!(c.distance <= reach)) continue;
    const rank = PRIORITY.indexOf(c.kind);
    if (rank < 0) continue;
    if (rank < bestRank || (rank === bestRank && c.distance < best!.distance)) {
      best = c;
      bestRank = rank;
    }
  }
  return best;
}

/** The prompt's words for a target: "Talk to Pylon", "Wake the fountain", "Salvage". */
export function promptText(c: Pick<Candidate, 'verb' | 'name'>): string {
  return c.name ? `${c.verb} ${c.name}` : c.verb;
}

/** A hold's length in effect: none when the player turned holds into a single press (decision 4). */
export function holdFor(c: Pick<Candidate, 'hold'>, holdToAct: boolean): number {
  return holdToAct && c.hold ? c.hold : 0;
}
