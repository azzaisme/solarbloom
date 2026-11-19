import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { levelY, rampAt } from '../src/core/Height';
import { OLD_CITY } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { PIPE_SIZE, pipeHeight, pipeSurface } from '../src/rendering/PipeVisuals';

/** Points along the middle of a ramp, from just before its foot to just past its top, every 1 cm. */
function along(x: number, z: number) {
  const { ramp } = rampAt(x, z)!;
  const alongZ = ramp.dir === 'n' || ramp.dir === 's';
  const len = alongZ ? ramp.d : ramp.w;
  const mid = alongZ ? ramp.x + ramp.w / 2 : ramp.z + ramp.d / 2;
  const start = alongZ ? ramp.z : ramp.x;
  const pts: [number, number][] = [];
  for (let s = 0.005; s < len; s += 0.01) {
    const c = start + s;
    pts.push(alongZ ? [mid, c] : [c, mid]);
  }
  return { ramp, pts };
}

describe('E23.4.2: a pipe down a stair runs as one straight slope', () => {
  const sim = new Sim(createInitialState(7));
  // the park's stairs down to the beach, and every other stair and ramp in the Old City that is ground here
  const flights: [number, number][] = [[7, 14]];

  it('clears every tread (its nosing too) by at least the flat gap, all the way down', () => {
    for (const [x, z] of flights) {
      const { pts } = along(x, z);
      expect(pts.length).toBeGreaterThan(50);
      for (const [px, pz] of pts) {
        const gap = pipeHeight(sim, px, pz) - PIPE_SIZE.r - pipeSurface(sim, px, pz);
        expect(gap, `${px.toFixed(2)},${pz.toFixed(2)}`).toBeGreaterThanOrEqual(PIPE_SIZE.clear - 1e-6);
      }
    }
  });

  it('has no steps of its own on the flight: it climbs smoothly, never faster than the stair, never back down', () => {
    for (const [x, z] of flights) {
      const { ramp, pts } = along(x, z);
      const alongZ = ramp.dir === 'n' || ramp.dir === 's';
      const len = alongZ ? ramp.d : ramp.w;
      const pitch = (Math.abs(levelY(ramp.to) - levelY(ramp.from)) / len) * 1.0001; // height per tile along the flight
      const ys = pts.map(([px, pz]) => pipeHeight(sim, px, pz));
      const rising = ys[ys.length - 1] > ys[0];
      for (let i = 1; i < ys.length; i++) {
        const dy = ys[i] - ys[i - 1];
        expect(Math.abs(dy), `step at ${i}`).toBeLessThanOrEqual(pitch * 0.01 + 1e-6); // no riser inside the flight
        expect(rising ? dy : -dy).toBeGreaterThanOrEqual(-1e-9); // one way only
      }
      // and the treads under it do step (this is a real stair, not a ramp drawn smooth)
      const ground = pts.map(([px, pz]) => pipeSurface(sim, px, pz));
      expect(ground.some((g, i) => i > 0 && Math.abs(g - ground[i - 1]) > 0.02)).toBe(true);
      expect(OLD_CITY.levelHeight).toBeGreaterThan(0);
    }
  });

  it('meets the ground at the top of the flight with no drop, and at the foot with one short one', () => {
    for (const [x, z] of flights) {
      const { ramp } = along(x, z);
      const alongZ = ramp.dir === 'n' || ramp.dir === 's';
      const mid = alongZ ? ramp.x + ramp.w / 2 : ramp.z + ramp.d / 2;
      // the cells just beyond each end of the flight
      const startEdge = alongZ ? ramp.z : ramp.x;
      const endEdge = startEdge + (alongZ ? ramp.d : ramp.w);
      const at = (c: number): [number, number] => (alongZ ? [mid, c] : [c, mid]);
      // the ground at both ends exists (as it does once its chunk loads in the game)
      for (const c of [startEdge - 0.01, endEdge + 0.01]) expect(sim.grid.get(GROUND, Math.floor(at(c)[0]), Math.floor(at(c)[1]))).toBeDefined();
      const fromSide = pipeHeight(sim, ...at(startEdge - 0.01));
      const fromEnd = pipeHeight(sim, ...at(startEdge + 0.01));
      const toEnd = pipeHeight(sim, ...at(endEdge - 0.01));
      const toSide = pipeHeight(sim, ...at(endEdge + 0.01));
      const [top, topRamp, foot, footRamp] = ramp.to > ramp.from ? [toSide, toEnd, fromSide, fromEnd] : [fromSide, fromEnd, toSide, toEnd];
      expect(Math.abs(topRamp - top)).toBeLessThan(1e-6); // levels off into the ground above: no drop at the top
      const drop = footRamp - foot;
      expect(drop).toBeGreaterThanOrEqual(0); // at the foot, just over the first tread…
      expect(drop).toBeLessThan(0.25); // …a short drop to the ground below, not a wall
    }
  });
});
