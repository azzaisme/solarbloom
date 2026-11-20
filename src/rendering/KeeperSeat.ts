/**
 * E23.2.3 + B5 (#468): how a Keeper sits on a bench beside bloombot.
 *
 * A Keeper whose model has the sitting clips (bloombot's `sit-down`, `sit` and `stand-up`, retargeted onto each
 * Keeper's rig by assets/tools/retarget_keeper_clips.mjs) plays them: `sit-down` once, then `sit` until bloombot
 * gets up, then `stand-up` once before it walks off. A model without them (the stand-in, or a Keeper not in the
 * table below) falls back to SeatPose's legs bent by hand (`foldLegs`), as before.
 *
 * Pure (no engine), so the choice is unit-tested.
 */

/** The three clips, in the order they play. */
export const SEAT_CLIPS = { down: 'sit-down', sit: 'sit', up: 'stand-up' } as const;

/**
 * Each Keeper's hips halfway through `sit`, in model metres (before KeeperVisuals' MODEL_SCALE): `y` above its feet
 * (the clips keep the feet on the ground on every frame) and `back`, how far behind where they stand. Measured from
 * the retargeted GLBs; tests/keeper-seat.test.ts poses each file and holds this table to it.
 */
export const KEEPER_SIT_HIPS: Readonly<Record<string, { y: number; back: number }>> = {
  atlas: { y: 0.275, back: 0.108 },
  fern: { y: 0.291, back: 0.136 },
  gable: { y: 0.217, back: 0.091 },
  moss: { y: 0.232, back: 0.092 },
  pylon: { y: 0.312, back: 0.139 },
  sluice: { y: 0.266, back: 0.117 },
  tally: { y: 0.234, back: 0.099 },
  tide: { y: 0.238, back: 0.094 },
  tock: { y: 0.249, back: 0.099 },
  vega: { y: 0.218, back: 0.088 },
};

export type BenchMode = 'clips' | 'fold';

/** 'clips' when the Keeper's model has all three sitting clips and its hips are measured; else 'fold' (SeatPose). */
export function benchMode(id: string, clips: Iterable<string>): BenchMode {
  const have = new Set(clips);
  const all = Object.values(SEAT_CLIPS).every((c) => have.has(c));
  return all && KEEPER_SIT_HIPS[id] ? 'clips' : 'fold';
}

export type BenchPhase = 'down' | 'sit' | 'up' | 'done';

/**
 * Which clip plays: `sitting` while it is beside bloombot (`elapsed` since it sat), else getting up (`elapsed` since
 * bloombot rose). `len`: the two one-shot clips' lengths in seconds. 'done' once `stand-up` has played through.
 */
export function benchClip(sitting: boolean, elapsed: number, len: { down: number; up: number }): { clip: string; phase: BenchPhase } {
  if (sitting) return elapsed < len.down ? { clip: SEAT_CLIPS.down, phase: 'down' } : { clip: SEAT_CLIPS.sit, phase: 'sit' };
  return { clip: SEAT_CLIPS.up, phase: elapsed < len.up ? 'up' : 'done' };
}

/**
 * Where the Keeper's body goes (local to its root, which stands at the bench spot) so its seated hips land where
 * SeatPose put them: `seatHips` above the `seat`, and `fold` back of the spot (SeatPose's own nudge onto the seat).
 * The clip already carries the hips `back` (+z is the way a Keeper faces), so the body comes forward by that much.
 */
export function benchOffset(id: string, seat: number, scale: number, seatHips: number, fold = 0.08): { y: number; z: number } {
  const h = KEEPER_SIT_HIPS[id];
  return { y: seat + seatHips - h.y * scale, z: -fold + h.back * scale };
}
