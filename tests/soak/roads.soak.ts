// City 16.8: the road network at scale. Over 1,000+ areas and several seeds, by walking real road tiles:
// every area is connected to the park, no stubs dangle, gates match from both sides, and the result is the
// same whatever order areas are evaluated in. Runs with `npm run test:soak` (CI).
import { describe, expect, it } from 'vitest';
import { AreaMap, PARK } from '../../src/core/Areas';
import { CHUNK } from '../../src/core/Hash';
import { RoadPlan } from '../../src/core/RoadPlan';
import { gateCells, LANDMARK_KEEP } from '../../src/core/RoadRaster';
import { PARK_LAYOUT } from '../../src/data/city';

const SEEDS = [1, 2, 3, 42, 9001];
const R = 18; // chunks round the park: ~430 areas a seed

const fresh = (seed: number) => new RoadPlan(seed, new AreaMap(seed, 4));
const inside = (cx: number, cz: number, r: number) => Math.max(Math.abs(cx), Math.abs(cz)) <= r;

/** Areas whose every chunk lies within r chunks of the park (so their whole road network is inside the walk). */
function areasWithin(plan: RoadPlan, r: number): string[] {
  const ids = new Set<string>();
  for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) ids.add(plan.map.areaOfChunk(cx, cz));
  return [...ids].filter((id) => id !== PARK && plan.map.info(id).chunks.every(([cx, cz]) => inside(cx, cz, r))).sort();
}

describe('City 16.8: road network soak', () => {
  let areas = 0;

  for (const seed of SEEDS)
    it(`every area within ${R} chunks is reached from the park by walking road tiles (seed ${seed})`, () => {
      const plan = fresh(seed);
      const ids = areasWithin(plan, R);
      areas += ids.length;
      // Walk from the park's path cross over road tiles (4-neighbours), staying within R + 1 chunks.
      const lim = (R + 1) * CHUNK;
      const seen = new Set<string>();
      const stack: [number, number][] = [];
      for (let i = 0; i < CHUNK; i++)
        for (const c of PARK_LAYOUT.paths.cols) stack.push([c, i]), stack.push([i, c]);
      for (const [x, z] of stack) seen.add(`${x},${z}`);
      while (stack.length) {
        const [x, z] = stack.pop()!;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const nz = z + dz;
          const k = `${nx},${nz}`;
          if (seen.has(k) || Math.abs(nx) > lim || Math.abs(nz) > lim || !plan.roadAt(nx, nz)) continue;
          seen.add(k);
          stack.push([nx, nz]);
        }
      }
      const cut: string[] = [];
      for (const id of ids) {
        const cells = [...plan.cells(id).keys()];
        if (!cells.length || cells.some((k) => !seen.has(k))) cut.push(`${id} (${plan.map.info(id).type})`);
      }
      expect(cut).toEqual([]);
    });

  it('covers over 1,000 areas', () => {
    expect(areas).toBeGreaterThan(1000);
  });

  for (const seed of SEEDS)
    it(`no dangling stubs, and gates line up from both sides (seed ${seed})`, () => {
      const plan = fresh(seed);
      for (const id of areasWithin(plan, R)) {
        const a = plan.map.info(id);
        for (const k of plan.cells(id).keys()) {
          const [x, z] = k.split(',').map(Number);
          const p = plan.pieceAt(x, z)!;
          expect(p.mask, `isolated tile ${k}`).not.toBe(0);
          if (p.kind !== 'end') continue;
          const nearPark = x >= -3 && z >= -3 && x <= 18 && z <= 18;
          const nearPlaza = Math.max(Math.abs(x - a.landmark[0] - 0.5), Math.abs(z - a.landmark[1] - 0.5)) <= LANDMARK_KEEP + 4.5;
          const nearRoof = [-2, -1, 0, 1, 2].some((dx) => [-2, -1, 0, 1, 2].some((dz) => plan.map.underRoof(id, x + dx, z + dz)));
          expect(nearPark || nearPlaza || nearRoof, `stub at ${k} in ${id} (${a.type})`).toBe(true);
        }
        for (const l of plan.roads(id).links) {
          const back = plan.roads(l.to).links.find((m) => m.to === id);
          expect(back?.gate, `${id}↔${l.to}`).toEqual(l.gate);
          if (l.tier === 'arterial' || l.to === PARK) continue;
          for (const [x, z] of [...gateCells(l.gate, id, plan), ...gateCells(l.gate, l.to, plan)]) expect(plan.roadAt(x, z), `gate ${id}→${l.to} at ${x},${z}`).toBeDefined();
        }
      }
    });

  it('is identical in any evaluation order (shuffled, two seeds)', () => {
    for (const seed of [3, 42]) {
      const a = fresh(seed);
      const ids = areasWithin(a, 12);
      const want = new Map(ids.map((id) => [id, JSON.stringify([a.roads(id), [...a.cells(id)]])]));
      // A seeded shuffle, and chunks probed tile-first (roadAt) rather than area-first.
      const order = [...ids];
      let h = seed * 2654435761;
      for (let i = order.length - 1; i > 0; i--) {
        h = (Math.imul(h ^ (h >>> 15), 2246822519) + i) >>> 0;
        const j = h % (i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      const b = fresh(seed);
      for (const id of order.slice(0, 40)) {
        const [cx, cz] = b.map.info(id).chunks[0];
        b.roadAt(cx * CHUNK + 5, cz * CHUNK + 5);
      }
      for (const id of order) expect(JSON.stringify([b.roads(id), [...b.cells(id)]]), id).toBe(want.get(id));
    }
  });
});
