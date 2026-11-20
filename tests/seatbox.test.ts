// E23.2.4: a bench's own frame at any turn (src/rendering/SeatBox.ts): the seat and backrest boxes bloombot settles
// onto and keeps out of, and the world boxes the animals keep out of, line up with where Resting seats bloombot
// (ahead of the bench is (sin f, cos f), across it (cos f, -sin f)), at every facing, not only +z.
import { describe, expect, it } from 'vitest';
import { REST } from '../src/data/rest';
import { benchBoxes, benchFrame, inBox, toWorld, worldBounds } from '../src/rendering/SeatBox';

const FACINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2, Math.PI / 4, 2.2];
const bench = (facing: number) => ({ x: 10, z: 6, facing });

describe('a bench turned any way', () => {
  it('ahead of it is the way bloombot faces when it sits there (Resting)', () => {
    for (const f of FACINGS) {
      const [x, z] = toWorld(benchFrame(bench(f)), 0, 1);
      expect(x - 10.5).toBeCloseTo(Math.sin(f), 9);
      expect(z - 6.5).toBeCloseTo(Math.cos(f), 9);
      const [ax, az] = toWorld(benchFrame(bench(f)), 1, 0);
      expect(ax - 10.5).toBeCloseTo(Math.cos(f), 9);
      expect(az - 6.5).toBeCloseTo(-Math.sin(f), 9);
    }
  });

  it('a point turned into the world comes back as the same distance ahead, inside the box', () => {
    for (const f of FACINGS) {
      const { seat } = benchBoxes(bench(f), 0);
      for (const [u, w] of [
        [0, 0],
        [0.3, 0.1],
        [-0.38, -0.11],
        [0.2, 0.14],
      ]) {
        const [x, z] = toWorld(seat, u, w);
        expect(inBox(seat, x, z)).toBeCloseTo(w, 9);
      }
    }
  });

  it('a point just past each side of the seat is outside it', () => {
    for (const f of FACINGS) {
      const { seat } = benchBoxes(bench(f), 0);
      const [s] = REST.benchSolids;
      for (const [u, w] of [
        [s.x[1] + 0.01, 0],
        [s.x[0] - 0.01, 0],
        [0, s.z[1] + 0.01],
        [0, s.z[0] - 0.01],
      ]) {
        const [x, z] = toWorld(seat, u, w);
        expect(inBox(seat, x, z)).toBeUndefined();
      }
    }
  });

  it('the backrest is behind the seat, whichever way the bench faces', () => {
    for (const f of FACINGS) {
      const { seat, back } = benchBoxes(bench(f), 0);
      // a point in the middle of the backrest, in the world: in the backrest's box, not the seat's
      const [x, z] = toWorld(back, 0, (back.z[0] + back.z[1]) / 2);
      expect(inBox(back, x, z)).toBeDefined();
      expect(inBox(seat, x, z)).toBeUndefined();
      // and bloombot moving ahead (its forward) leaves it
      const [fx, fz] = toWorld(back, 0, back.z[1] + 0.01);
      expect(inBox(back, fx, fz)).toBeUndefined();
    }
  });

  it('the world boxes hold every corner of the part, turned', () => {
    for (const f of FACINGS) {
      const boxes = benchBoxes(bench(f), 2);
      REST.benchSolids.forEach((p, i) => {
        const b = boxes.solids[i];
        expect(b.y0).toBeCloseTo(2 + p.y[0], 9);
        expect(b.y1).toBeCloseTo(2 + p.y[1], 9);
        for (const u of p.x)
          for (const w of p.z) {
            const [x, z] = toWorld(benchFrame(bench(f)), u, w);
            expect(x).toBeGreaterThanOrEqual(b.x0 - 1e-9);
            expect(x).toBeLessThanOrEqual(b.x1 + 1e-9);
            expect(z).toBeGreaterThanOrEqual(b.z0 - 1e-9);
            expect(z).toBeLessThanOrEqual(b.z1 + 1e-9);
          }
      });
    }
  });

  it('a quarter turn swaps across and ahead', () => {
    const f = benchFrame(bench(Math.PI / 2));
    const b = worldBounds(f, [-0.4, 0.4], [-0.1, 0.2]);
    // facing +x: ahead is +x, across is -z
    expect(b.x0).toBeCloseTo(10.4, 9);
    expect(b.x1).toBeCloseTo(10.7, 9);
    expect(b.z0).toBeCloseTo(6.1, 9);
    expect(b.z1).toBeCloseTo(6.9, 9);
  });
});
