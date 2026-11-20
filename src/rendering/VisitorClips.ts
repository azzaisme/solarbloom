import { ON_BOT, type Perch } from '../data/wildlife';

/**
 * E23.10 batch B4: which of a visitor's own clips plays when. The B4 animals (assets/raw/models/visitors/<id>.glb)
 * each have `idle`, `follow` (travelling: a walk, or a flight for the fliers), `sit` and `climb` (a one-shot hop up
 * onto a perch); other names are matched too, so a model from elsewhere still finds its walk or its flight.
 *
 * - on the way in or out: `follow`
 * - the last moment of the way in to a perch on bloombot (its head, shoulders, lap...): `climb`, once
 * - settled on bloombot, or beside it on the seat or the ground: `sit`
 * - settled anywhere else (sniffing in front, perched nearby): `idle`
 *
 * A clip a model lacks falls back (climb to follow, follow and sit to idle, idle to its first clip); a kind with no
 * model at all keeps its placeholder (Visitors.ts), which animates by hand.
 */
export type VisitorPhase = 'move' | 'climb' | 'sit' | 'idle';

/** The clip names each phase looks for, best first. */
export const PHASE_CLIPS: Record<VisitorPhase, readonly string[]> = {
  move: ['follow', 'fly', 'flying', 'flap', 'walk', 'walking', 'hop', 'run', 'move'],
  climb: ['climb', 'jump', 'land'],
  sit: ['sit', 'perch', 'rest'],
  idle: ['idle', 'breathe', 'stand', 'look'],
};

/** The perches where a visitor sits rather than stands about: all of those on bloombot, and beside it. */
export const SITTING: readonly Perch[] = [...ON_BOT, 'beside'];

/** The first of `want` among `names` (exact, then a `...|name` track path, then any name containing it). */
export function pickClip(names: readonly string[], want: readonly string[]): string | undefined {
  const low = names.map((n) => n.toLowerCase());
  for (const w of want) {
    const i = low.findIndex((n) => n === w || n.endsWith(`|${w}`));
    if (i >= 0) return names[i];
  }
  for (const w of want) {
    const i = low.findIndex((n) => n.includes(w));
    if (i >= 0) return names[i];
  }
  return undefined;
}

/** A model's clip for each phase, with the fallbacks; all undefined if it has no clips. */
export function clipsFor(names: readonly string[]): Record<VisitorPhase, string | undefined> {
  const idle = pickClip(names, PHASE_CLIPS.idle) ?? names[0];
  const move = pickClip(names, PHASE_CLIPS.move) ?? idle;
  return {
    idle,
    move,
    sit: pickClip(names, PHASE_CLIPS.sit) ?? idle,
    climb: pickClip(names, PHASE_CLIPS.climb) ?? move,
  };
}

/** Only the climb plays once (it ends on the perch); the rest loop. */
export function loops(clip: string, clips: Record<VisitorPhase, string | undefined>): boolean {
  return clip !== clips.climb || clips.climb === clips.move;
}

/**
 * What a visitor is doing now: `moving` on its way in or out (`leaving` on the way out), `toGo` seconds before it
 * arrives at `perch`, and `climbFor` seconds of climb it has (0 for none).
 */
export function visitorPhase(o: { moving: boolean; leaving: boolean; perch: Perch; toGo: number; climbFor: number }): VisitorPhase {
  if (o.moving) return !o.leaving && o.climbFor > 0 && ON_BOT.includes(o.perch) && o.toGo <= o.climbFor ? 'climb' : 'move';
  return SITTING.includes(o.perch) ? 'sit' : 'idle';
}
