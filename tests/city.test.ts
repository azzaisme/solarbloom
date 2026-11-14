import { describe, expect, it } from 'vitest';
import { AreaMap, PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { distToFootprint, Grid } from '../src/core/Grid';
import { AREA_TYPE_LIST, AREA_TYPES, CITY_GEN } from '../src/data/city';
import { roadCol, roadRow } from '../src/core/Generation';

const areasAround = (map: AreaMap, r: number) => {
  const ids = new Set<string>();
  for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) ids.add(map.areaOfChunk(cx, cz));
  return [...ids];
};

describe('city generator: skeleton (City 04.1)', () => {
  it('roads and canals are a pure function of the seed and run along whole chunk rows/columns', () => {
    const g = new Grid(5, createInitialState(5).layers);
    for (let cz = -6; cz <= 6; cz++) {
      if (!roadRow(5, cz) || cz === 0) continue;
      for (let x = -40; x < 40; x += 3) {
        const cx = Math.floor(x / 16);
        if (cx === 0) continue; // the park keeps its own layout
        expect(g.get(GROUND, x, cz * 16 + 7)!.feature).toBe('road');
      }
    }
    expect(Array.from({ length: 40 }, (_, i) => roadCol(5, i))).toEqual(Array.from({ length: 40 }, (_, i) => roadCol(5, i)));
  });

  it('district themes are coarse regions', () => {
    const map = new AreaMap(8);
    const n = CITY_GEN.districtChunks;
    for (let cx = 0; cx < n; cx++) for (let cz = 0; cz < n; cz++) expect(map.theme(cx, cz)).toBe(map.theme(0, 0));
  });
});

describe('city generator: area types and layouts (City 04.3)', () => {
  it('each area type has its own ground, obstacles away from the landmark, and a sensible obstacle share', () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4]) {
      const map = new AreaMap(seed);
      const g = new Grid(seed, createInitialState(seed).layers);
      for (const id of areasAround(map, 10)) {
        const a = map.info(id);
        if (seen.has(a.type) && id !== PARK) continue;
        seen.add(a.type);
        const tiles = a.chunks.flatMap(([cx, cz]) => g.chunkAt(GROUND, cx, cz)!.tiles.filter((t) => !!t)) as NonNullable<ReturnType<Grid['get']>>[];
        const def = AREA_TYPES[a.type];
        const own = tiles.filter((t) => t.feature === def.ground).length / tiles.length;
        expect(own, `${a.type} ground share`).toBeGreaterThan(0.4);
        const obstacles = tiles.filter((t) => t.blocked);
        expect(obstacles.length / tiles.length, `${a.type} obstacles`).toBeLessThan(def.obstacles * 2.5 + 0.01);
        for (const t of obstacles) {
          expect(t.feature).toBe('obstacle');
          expect(distToFootprint(t.x, t.z, a.landmark[0], a.landmark[1], 2)).toBeGreaterThan(CITY_GEN.landmarkClearance);
        }
      }
    }
    expect([...seen].sort()).toEqual([...AREA_TYPE_LIST].sort());
  });
});

describe('city generator: landmarks (City 04.4)', () => {
  it('authored landmarks sit at their configured distances, for any seed', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const map = new AreaMap(seed);
      for (const band of CITY_GEN.authored) {
        const a = map.info(map.authoredArea(band.distance));
        expect(a.authored, `seed ${seed} band ${band.distance}`).toBe(true);
        expect(a.landmarkKind).toBe(band.kind);
        expect(Math.abs(a.distance - band.distance)).toBeLessThanOrEqual(3);
      }
    }
  });

  it('every other area has its type’s landmark', () => {
    const map = new AreaMap(3);
    for (const id of areasAround(map, 4)) {
      const a = map.info(id);
      if (!a.authored) expect(a.landmarkKind).toBe(AREA_TYPES[a.type].landmark.kind);
    }
    expect(map.info(PARK).landmarkKind).toBe('fountain');
  });
});

describe('city generator: difficulty and variety (City 04.5–04.6)', () => {
  it('difficulty and pollution grow with distance and are capped', () => {
    const map = new AreaMap(4);
    const all = areasAround(map, 30).map((id) => map.info(id));
    for (const a of all) {
      expect(a.difficulty).toBeGreaterThanOrEqual(1);
      expect(a.difficulty).toBeLessThanOrEqual(CITY_GEN.difficulty.max);
      expect(a.pollutionFloor).toBeLessThanOrEqual(CITY_GEN.difficulty.pollutionFloorMax);
    }
    const near = all.filter((a) => a.distance <= 3);
    const far = all.filter((a) => a.distance >= 20);
    const avg = (l: typeof all) => l.reduce((x, a) => x + a.difficulty, 0) / l.length;
    expect(avg(far)).toBeGreaterThan(avg(near));
  });

  it('soak: 500+ areas keep variety — few same-type neighbours, every type near the park', () => {
    for (const seed of [11, 12, 13]) {
      const map = new AreaMap(seed);
      const ids = areasAround(map, 22);
      expect(ids.length).toBeGreaterThan(500);
      let same = 0;
      let pairs = 0;
      for (const id of ids) {
        const a = map.info(id);
        for (const n of a.neighbours) {
          if (n < id) continue;
          pairs++;
          if (map.info(n).type === a.type) same++;
        }
      }
      expect(same / pairs).toBeLessThan(0.3);
      const near = new Set(areasAround(map, 12).map((id) => map.info(id).type));
      expect([...near].sort()).toEqual([...AREA_TYPE_LIST].sort());
    }
  });
});
