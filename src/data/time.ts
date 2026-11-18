/**
 * E23.7.1 (#395): the game day. Starting values for tuning (E23 rule 9: numbers live in data).
 *
 * A game day is 48 minutes of play: 32 of day, then 16 of night. Every timer in the game counts in these game
 * days (sim seconds, through `gameDays`), in both clock modes. In "follow my clock" mode only the sky, the light
 * and solar follow the real clock; the real day is split the same way (16 hours of light from 06:00, 8 of dark).
 */
export const DAY = {
  /** minutes of play in one game day */
  minutes: 48,
  /** share of the day that is daylight (32 of 48 minutes) */
  dayShare: 32 / 48,
  /** the clock hour at the start of the day (fraction 0): dawn */
  dawnHour: 6,
  /** where a new game's first day starts (a fresh morning, not first light) */
  startFraction: 0.06,
  /** where sleeping wakes bloombot: just after dawn */
  wakeFraction: 0.02,
  /** fade in and out of light at either end of the day, as a share of the day (the sun rises and sets) */
  twilight: 0.04,
};

/** Seconds of play in one game day (2880). */
export const DAY_SECONDS = DAY.minutes * 60;

/** A span of game days in sim seconds. Every timer is written with this, never in raw seconds or real days. */
export function gameDays(n: number): number {
  return n * DAY_SECONDS;
}

/** A span of game hours (1/24 of a game day, two minutes of play) in sim seconds. */
export function gameHours(n: number): number {
  return gameDays(n / 24);
}

/**
 * E23.7.1.3: night-only finds. Each appears at dusk and goes at dawn; one taken tonight is back the next night.
 * Fireflies are the third night find: they only fly at night (rendering/Fauna), and they are ambience, not items.
 * `glowplant`: a glowing plant to gather (Seeds); `salvage`: something glinting that only shows by night (Scrap).
 * Positions are open ground cells in the park and on its edges.
 */
export type NightFindKind = 'glowplant' | 'salvage' | 'dewcap' | 'driftglass';
export interface NightFindDef {
  id: string;
  kind: NightFindKind;
  /** when it's out: at night (default), or in fog (E23.7.2: fog-only finds, day or night) */
  when?: 'night' | 'fog';
  x: number;
  z: number;
}
export const NIGHT_FIND_GIVES: Record<NightFindKind, { material: 'seeds' | 'scrap' | 'glass'; n: number; verb: string; name: string }> = {
  dewcap: { material: 'seeds', n: 4, verb: 'Gather', name: 'dewcap spores' },
  driftglass: { material: 'glass', n: 3, verb: 'Pick up', name: 'misted glass' },
  glowplant: { material: 'seeds', n: 3, verb: 'Gather', name: 'glowing seeds' },
  salvage: { material: 'scrap', n: 4, verb: 'Pick up', name: 'something glinting' },
};
export const NIGHT_FINDS: NightFindDef[] = [
  { id: 'n-glow-1', kind: 'glowplant', x: 2, z: 10 },
  { id: 'n-glow-2', kind: 'glowplant', x: 15, z: 7 },
  { id: 'n-salv-1', kind: 'salvage', x: 10, z: 3 },
  { id: 'n-salv-2', kind: 'salvage', x: 6, z: 12 },
  // E23.7.2: fog-only finds (out whenever it's foggy)
  { id: 'f-dew-1', kind: 'dewcap', when: 'fog', x: 12, z: 8 },
  { id: 'f-dew-2', kind: 'dewcap', when: 'fog', x: 1, z: 13 },
  { id: 'f-glass-1', kind: 'driftglass', when: 'fog', x: 9, z: 15 },
];
