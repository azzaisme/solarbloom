import { describe, expect, it } from 'vitest';
import { benchClip, benchMode, benchOffset, KEEPER_SIT_HIPS, SEAT_CLIPS } from '../src/rendering/KeeperSeat';
import { KEEPERS } from '../src/data/oldcity';
import { Skeleton } from './helpers/gltfPose';

/**
 * E23.2.3 + B5 (#468): a Keeper on a bench beside bloombot plays its own sitting clips when its model has them, and
 * falls back to SeatPose's legs bent by hand when it doesn't.
 */
describe('Keepers sitting on a bench', () => {
  const ALL = ['idle', 'wave', 'sleep', 'sit-down', 'sit', 'stand-up'];

  it('plays the clips when the model has all three, and bends the legs by hand when it does not', () => {
    expect(benchMode('fern', ALL)).toBe('clips');
    // the Keepers' models before B5 had only idle, wave and sleep
    expect(benchMode('fern', ['idle', 'wave', 'sleep'])).toBe('fold');
    // any one clip missing is enough to fall back
    for (const gone of Object.values(SEAT_CLIPS)) expect(benchMode('fern', ALL.filter((c) => c !== gone)), gone).toBe('fold');
    // a Keeper whose seated hips aren't measured falls back too (its body would be placed wrong)
    expect(benchMode('nobody', ALL)).toBe('fold');
  });

  it('sits down once, sits until bloombot rises, then stands up once and is done', () => {
    const len = { down: 4.7, up: 6.2 };
    expect(benchClip(true, 0, len)).toEqual({ clip: 'sit-down', phase: 'down' });
    expect(benchClip(true, 4.6, len)).toEqual({ clip: 'sit-down', phase: 'down' });
    expect(benchClip(true, 4.7, len)).toEqual({ clip: 'sit', phase: 'sit' });
    expect(benchClip(true, 600, len)).toEqual({ clip: 'sit', phase: 'sit' });
    expect(benchClip(false, 0, len)).toEqual({ clip: 'stand-up', phase: 'up' });
    expect(benchClip(false, 6.1, len).phase).toBe('up');
    expect(benchClip(false, 6.2, len).phase).toBe('done');
  });

  it('places the body so the seated hips land on the seat, where the hand-bent legs put them', () => {
    const scale = 0.95, seat = 0.45, seatHips = 0.06;
    for (const [id, h] of Object.entries(KEEPER_SIT_HIPS)) {
      const at = benchOffset(id, seat, scale, seatHips);
      // hips height above the root = body lift + seated hips
      expect(at.y + h.y * scale, id).toBeCloseTo(seat + seatHips, 9);
      // the clip carries the hips back; the body comes forward by that, less SeatPose's own 0.08 nudge back
      expect(at.z - h.back * scale, id).toBeCloseTo(-0.08, 9);
    }
  });

  it('every Keeper is in the table, and the table matches its model halfway through `sit` (near and far)', () => {
    expect(Object.keys(KEEPER_SIT_HIPS).sort()).toEqual(KEEPERS.map((k) => k.id).sort());
    for (const [id, h] of Object.entries(KEEPER_SIT_HIPS)) {
      for (const f of [`assets/raw/models/final/keeper-${id}.glb`, `assets/raw/models/final/keeper-${id}.lod1.glb`]) {
        const s = new Skeleton(f);
        expect(benchMode(id, s.clips()), f).toBe('clips');
        const rest = s.pose();
        const p = s.pose('sit', s.clipLength('sit') / 2);
        expect(p.Hips[1], `${f} seated hips height`).toBeCloseTo(h.y, 2);
        expect(rest.Hips[2] - p.Hips[2], `${f} hips back`).toBeCloseTo(h.back, 2);
        // the feet stay where they stand at rest through all three clips, so lifting the body by a constant is right
        const toe = (q: Record<string, number[]>) => Math.min(q.LeftToeBase[1], q.RightToeBase[1]);
        for (const c of Object.values(SEAT_CLIPS))
          for (const u of [0, 0.25, 0.5, 0.75, 1]) expect(Math.abs(toe(s.pose(c, s.clipLength(c) * u)) - toe(rest)), `${f} ${c} feet at ${u}`).toBeLessThan(0.005);
      }
    }
  });
});
