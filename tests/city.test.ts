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
        const obstacles = tiles.filter((t) => t.blocked && t.feature !== 'building');
        expect(obstacles.length / tiles.length, `${a.type} obstacles`).toBeLessThan(def.obstacles * 2.5 + 0.01);
        for (const t of obstacles) {
          expect(t.feature).toBe('obstacle');
          expect(distToFootprint(t.x, t.z, a.landmark[0], a.landmark[1], 2)).toBeGreaterThan(CITY_GEN.landmarkClearance);
        }
        // Buildings keep clear of the landmark, roads and canals, and leave most of the area to restore.
        const buildings = tiles.filter((t) => t.feature === 'building');
        expect(buildings.length / tiles.length, `${a.type} buildings`).toBeLessThan(0.3);
        for (const t of buildings) {
          expect(t.blocked).toBe(true);
          expect(distToFootprint(t.x, t.z, a.landmark[0], a.landmark[1], 2)).toBeGreaterThan(CITY_GEN.landmarkClearance + 1);
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

describe('city generator: buildings (City 07.5)', () => {
  it('new games have buildings; saves from before generation 2 keep generating without them', () => {
    const seed = 3;
    const fresh = new Grid(seed, createInitialState(seed).layers.map((l) => ({ ...l, gen: 2 })));
    const oldLayers = createInitialState(seed).layers.map((l) => ({ ...l, gen: undefined }));
    const old = new Grid(seed, oldLayers);
    let built = 0;
    for (let cz = -6; cz <= 6; cz++)
      for (let cx = -6; cx <= 6; cx++) {
        const a = fresh.chunkAt(GROUND, cx, cz)!.tiles;
        const b = old.chunkAt(GROUND, cx, cz)!.tiles;
        a.forEach((t, i) => {
          if (t!.feature === 'building') built++;
          expect(b[i]!.feature).not.toBe('building');
          if (t!.feature !== 'building') expect(b[i]).toEqual(t); // everything else is identical
        });
      }
    expect(built).toBeGreaterThan(200);
  });

  it('buildings never sit on roads, water, the park or near a landmark', () => {
    for (const seed of [1, 5, 9]) {
      const g = new Grid(seed, createInitialState(seed).layers);
      const map = new AreaMap(seed, 3);
      for (let cz = -8; cz <= 8; cz++)
        for (let cx = -8; cx <= 8; cx++) {
          const id = map.areaOfChunk(cx, cz);
          for (const t of g.chunkAt(GROUND, cx, cz)!.tiles) {
            if (t!.feature !== 'building') continue;
            expect(id).not.toBe(PARK);
            const lx = t!.x - cx * 16;
            const lz = t!.z - cz * 16;
            expect([7, 8].includes(lz) && roadRow(seed, cz)).toBe(false);
            expect([7, 8].includes(lx) && roadCol(seed, cx)).toBe(false);
          }
        }
    }
  });
});

describe('park art stages (City 05.2)', () => {
  it('the park looks dilapidated at the start and cheers up at 25/50/75% of its goal, lush once the fountain wakes', async () => {
    const { createInitialState: create } = await import('../src/core/GameState');
    const { Sim: S } = await import('../src/gameplay/Sim');
    const { TUNING: T } = await import('../src/data/tuning');
    const sim = new S(create(5));
    expect(sim.progression.parkStage()).toBe(0);
    const goal = T.park.restoredTiles;
    const tiles = sim.areas.tiles('park').filter((t) => !t.blocked && !t.occupantId && t.ground !== 'restored');
    const seen: number[] = [];
    let n = sim.areas.counts('park').restored;
    for (const t of tiles) {
      t.ground = 'restored';
      t.bloom = 1;
      sim.grid.touch(t);
      n++;
      const st = sim.progression.parkStage();
      if (st !== seen[seen.length - 1]) seen.push(st);
      if (n === Math.ceil(goal * 0.25) - 1) expect(st).toBe(0);
      if (n === Math.ceil(goal * 0.25)) expect(st).toBe(1);
      if (n === Math.ceil(goal * 0.5)) expect(st).toBe(2);
      if (n === Math.ceil(goal * 0.75)) expect(st).toBe(3);
    }
    expect(seen).toEqual([0, 1, 2, 3]); // never jumps to "lush" before the fountain
    sim.state.progression.coreActivated = true;
    expect(sim.progression.parkStage()).toBe(4);
  });
});
