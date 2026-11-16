import { describe, expect, it } from 'vitest';
import { AreaMap, PARK } from '../src/core/Areas';
import { arterialAcross, arterialsInChunk, RoadPlan } from '../src/core/RoadPlan';
import { gateCells, LANDMARK_KEEP, landmarkKept } from '../src/core/RoadRaster';
import { CITY_GEN } from '../src/data/city';

const SEEDS = [1, 42, 9001];
const RADIUS = 30;

/** Every area with a chunk within RADIUS chunks of the park. */
function areasNear(map: AreaMap, r = RADIUS): string[] {
  const ids = new Set<string>();
  for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) if (cx * cx + cz * cz <= r * r) ids.add(map.areaOfChunk(cx, cz));
  return [...ids].sort();
}

const fresh = (seed: number) => new RoadPlan(seed, new AreaMap(seed, 4));

describe('City 16.2: road plan on the area graph', () => {
  for (const seed of SEEDS) {
    it(`every area within ${RADIUS} chunks reaches the park by road (seed ${seed})`, () => {
      const plan = fresh(seed);
      const ids = areasNear(plan.map);
      expect(ids.length).toBeGreaterThan(400);
      // Follow parent links: strictly closer each step, so it must arrive.
      for (const id of ids) {
        let at = id;
        for (let steps = 0; at !== PARK; steps++) {
          expect(steps).toBeLessThan(200);
          const r = plan.roads(at);
          expect(r.links.some((l) => l.to === r.parent), `${at} links its parent ${r.parent}`).toBe(true);
          at = r.parent!;
        }
      }
    });

    it(`links and gates are symmetric (seed ${seed})`, () => {
      const plan = fresh(seed);
      for (const id of areasNear(plan.map, 20)) {
        const map = plan.map;
        for (const l of plan.roads(id).links) {
          const back = plan.roads(l.to).links.find((m) => m.to === id);
          expect(back, `${l.to} links back to ${id}`).toBeDefined();
          expect(back!.tier).toBe(l.tier);
          expect(back!.gate).toEqual(l.gate);
          // The gate's edge really separates the two areas.
          const { cx, cz, dir } = l.gate.edge;
          const [bx, bz] = dir === 'e' ? [cx + 1, cz] : [cx, cz + 1];
          expect(new Set([map.areaOfChunk(cx, cz), map.areaOfChunk(bx, bz)])).toEqual(new Set([id, l.to]));
        }
      }
    });
  }

  it('is identical whatever order areas are evaluated in', () => {
    const seed = 42;
    const a = fresh(seed);
    const ids = areasNear(a.map, 16);
    const want = new Map(ids.map((id) => [id, JSON.stringify(a.roads(id))]));
    const b = fresh(seed);
    const shuffled = [...ids].sort((x, y) => ((x.length * 31 + x.charCodeAt(x.length - 1)) % 7) - ((y.length * 31 + y.charCodeAt(y.length - 1)) % 7) || (x < y ? 1 : -1));
    for (const id of shuffled) expect(JSON.stringify(b.roads(id))).toBe(want.get(id));
  });

  it('no area takes extra links beyond the maximum', () => {
    for (const seed of SEEDS) {
      const plan = fresh(seed);
      for (const id of areasNear(plan.map, 20)) {
        const links = plan.roads(id).links;
        const extras = links.filter((l) => l.kind === 'extra').length;
        if (extras > 0) expect(links.length).toBeLessThanOrEqual(CITY_GEN.roads.maxLinks);
      }
    }
  });
});

describe('City 16.3: arterials', () => {
  it('runs are continuous across chunk borders', () => {
    for (const seed of SEEDS)
      for (let cz = -20; cz <= 20; cz++)
        for (let cx = -20; cx <= 20; cx++)
          for (const run of arterialsInChunk(seed, cx, cz)) {
            // Along the run, the next chunk has the same run unless the run ends inside this chunk.
            const end = run.axis === 'x' ? (cx + 1) * 16 - 1 : (cz + 1) * 16 - 1;
            if (run.to <= end) continue;
            const [nx, nz] = run.axis === 'x' ? [cx + 1, cz] : [cx, cz + 1];
            if (nx === 0 && nz === 0) continue; // runs stop at the park
            const next = arterialsInChunk(seed, nx, nz).find((r) => r.axis === run.axis && r.at === run.at && r.lane === run.lane && r.kind === run.kind);
            expect(next, `seed ${seed} ${run.kind} ${run.axis}@${run.at} from ${cx},${cz}`).toBeDefined();
          }
  });

  it('avenues leave the park on all four sides', () => {
    for (const seed of SEEDS) {
      expect(arterialAcross(seed, { cx: 0, cz: 0, dir: 'e' })).toBeDefined();
      expect(arterialAcross(seed, { cx: -1, cz: 0, dir: 'e' })).toBeDefined();
      expect(arterialAcross(seed, { cx: 0, cz: 0, dir: 's' })).toBeDefined();
      expect(arterialAcross(seed, { cx: 0, cz: -1, dir: 's' })).toBeDefined();
    }
  });
});

describe.each(SEEDS)('City 16.4: road tiles inside areas (seed %i)', { timeout: 30000 }, (seed) => {
  const plan = fresh(seed);
  const ids = areasNear(plan.map, 10).filter((id) => id !== PARK);

  it('never puts road on a landmark or under a rooftop', () => {
    for (const id of ids) {
      const a = plan.map.info(id);
      for (const k of plan.cells(id).keys()) {
        const [x, z] = k.split(',').map(Number);
        expect(landmarkKept(x, z, a.landmark[0], a.landmark[1]), `${id} ${k}`).toBe(false);
        expect(plan.map.underRoof(id, x, z)).toBe(false);
        expect(plan.map.areaOfCell(x, z)).toBe(id);
      }
    }
  });

  it('every gate lines up with the matching gate in the neighbouring area', () => {
    for (const id of ids)
      for (const l of plan.roads(id).links) {
        if (l.tier === 'arterial' || l.to === PARK) continue;
        for (const [x, z] of [...gateCells(l.gate, id, plan), ...gateCells(l.gate, l.to, plan)]) expect(plan.roadAt(x, z), `${id}→${l.to} at ${x},${z}`).toBeDefined();
      }
  });

  it('has no isolated tiles, and dead ends only at a landmark plaza', () => {
    for (const id of ids) {
      const a = plan.map.info(id);
      for (const k of plan.cells(id).keys()) {
        const [x, z] = k.split(',').map(Number);
        const p = plan.pieceAt(x, z)!;
        expect(p.mask, `${id} ${k}`).not.toBe(0);
        if (p.kind === 'end') {
          const atPark = x >= -3 && z >= -3 && x <= 18 && z <= 18; // the avenue's spare lane beside the park's 2-wide path
          const nearPlaza = atPark || Math.max(Math.abs(x - a.landmark[0] - 0.5), Math.abs(z - a.landmark[1] - 0.5)) <= LANDMARK_KEEP + 4.5 || [-2, -1, 0, 1, 2].some((dx) => [-2, -1, 0, 1, 2].some((dz) => plan.map.underRoof(id, x + dx, z + dz)));
          expect(nearPlaza, `dead end at ${k} in ${id} (${a.type})`).toBe(true);
        }
      }
    }
  });

  it("each area's roads are one connected network", () => {
    for (const id of ids) {
      const cells = plan.cells(id);
      const start = cells.keys().next().value!;
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length) {
        const [x, z] = stack.pop()!.split(',').map(Number);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${x + dx},${z + dz}`;
          if (cells.has(k) && !seen.has(k)) seen.add(k), stack.push(k);
        }
      }
      expect(seen.size, `${id} (${plan.map.info(id).type}) has ${cells.size} road tiles`).toBe(cells.size);
    }
  });
});
