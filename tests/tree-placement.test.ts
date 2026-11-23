import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { zoneAt } from '../src/rendering/PlantingZones';
import { treeSpot, treeWorldOf, treeZone, TREES } from '../src/rendering/TreePlacement';
import { SPECIES, treeGeo } from '../src/rendering/TreeGen';
import { foliageShape } from '../src/core/Solids';

/** P7-E29 (#715): composed tree placement, by planting zone, round the start (Saltwind Beach and its canal). */
const sim = new Sim(createInitialState(7));
const X0 = -30, X1 = 45, Z0 = 10, Z1 = 47;
for (let z = Z0 - 6; z <= Z1 + 6; z++) for (let x = X0 - 6; x <= X1 + 6; x++) sim.grid.get(GROUND, x, z);
const W = treeWorldOf(sim);
const peek = (x: number, z: number) => sim.grid.peek(GROUND, x, z);
const areaType = (x: number, z: number) => sim.areas.info(sim.areas.map.areaOfCell(x, z)).type;
const zone = (x: number, z: number) => {
  const info = sim.areas.info(sim.areas.map.areaOfCell(x, z));
  return zoneAt(x, z, { peek, areaAt: (a, b) => sim.areas.map.areaOfCell(a, b), areaType: info.type, landmark: info.noLandmark ? undefined : info.landmark, ignoreOccupants: true });
};
const cells = () => {
  const out: { x: number; z: number }[] = [];
  for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) out.push({ x, z });
  return out;
};
const spot = (x: number, z: number) => treeSpot(peek(x, z)!, areaType(x, z), W);
const deck = (x: number, z: number) => {
  const t = peek(x, z);
  return !!t && !t.blocked && (t.feature === 'paving' || t.feature === 'road') && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => peek(x + dx, z + dz)?.feature === 'water');
};

describe('P7-E29 tree placement by zone', () => {
  it('Saltwind Beach, the start, grows trees on its sand (it grew none before)', () => {
    const beach = cells().filter(({ x, z }) => areaType(x, z) === 'beach' && peek(x, z)?.feature === 'sand');
    const trees = beach.filter(({ x, z }) => spot(x, z));
    expect(beach.length).toBeGreaterThan(300);
    expect(trees.length / beach.length).toBeGreaterThan(0.06);
    expect(trees.length / beach.length).toBeLessThan(0.25); // composed, with open lawn between
    // shade oaks and willows both show up, and a blossom accent
    const sp = new Set(trees.map(({ x, z }) => spot(x, z)!.species));
    for (const s of ['oak', 'willow', 'cherry'] as const) expect(sp.has(s), s).toBe(true);
  });

  it('nothing on path edges, in landmark or machine clearances, or round a jetty or bridge', () => {
    for (const { x, z } of cells()) {
      const t = peek(x, z)!;
      if (!spot(x, z) || t.feature === 'paving') continue;
      expect(['path_edge', 'landmark_clearance']).not.toContain(zone(x, z));
      // landmarks read from a distance: no crown within 2–3 cells of the 2×2 footprint
      const info = sim.areas.info(sim.areas.map.areaOfCell(x, z));
      if (!info.noLandmark && info.landmark) {
        const [lx, lz] = info.landmark;
        const d = Math.max(x < lx ? lx - x : x > lx + 1 ? x - lx - 1 : 0, z < lz ? lz - z : z > lz + 1 ? z - lz - 1 : 0);
        expect(d, `tree at ${x},${z} by the landmark`).toBeGreaterThan(2);
      }
      for (let dz = -TREES.deckClear; dz <= TREES.deckClear; dz++)
        for (let dx = -TREES.deckClear; dx <= TREES.deckClear; dx++) expect(deck(x + dx, z + dz), `tree at ${x},${z} by a deck`).toBe(false);
    }
  });

  it('groves: trees gather in clumps of overlapping crowns, with open ground between', () => {
    const trees = cells().filter(({ x, z }) => treeZone(x, z, areaType(x, z), W)?.role === 'grove');
    const set = new Set(trees.map(({ x, z }) => `${x},${z}`));
    // clumps: connected within two cells
    const seen = new Set<string>();
    const sizes: number[] = [];
    for (const { x, z } of trees) {
      if (seen.has(`${x},${z}`)) continue;
      let n = 0;
      const q = [[x, z]];
      seen.add(`${x},${z}`);
      while (q.length) {
        const [cx, cz] = q.pop()!;
        n++;
        for (let dz = -2; dz <= 2; dz++)
          for (let dx = -2; dx <= 2; dx++) {
            const k = `${cx + dx},${cz + dz}`;
            if (set.has(k) && !seen.has(k)) seen.add(k), q.push([cx + dx, cz + dz]);
          }
      }
      sizes.push(n);
    }
    const groves = sizes.filter((n) => n >= 3 && n <= 8);
    expect(groves.length).toBeGreaterThanOrEqual(4);
    // grove trees are big enough to shade: a crown well over a tile across
    for (const { x, z } of trees) expect(spot(x, z)!.scale).toBeGreaterThanOrEqual(TREES.scale.grove[0] * 0.88 - 1e-9);
  });

  it('willows stand on the shore', () => {
    const shore = cells().filter(({ x, z }) => treeZone(x, z, areaType(x, z), W)?.role === 'shore');
    expect(shore.length).toBeGreaterThan(5);
    expect(shore.filter(({ x, z }) => spot(x, z)!.species === 'willow').length / shore.length).toBeGreaterThan(0.6);
  });

  it('is deterministic: the same world gives the same trees every call', () => {
    const a = cells().map(({ x, z }) => JSON.stringify(spot(x, z) ?? null));
    const b = cells().map(({ x, z }) => JSON.stringify(spot(x, z) ?? null));
    expect(b).toEqual(a);
  });

  it('a pure function of seed and cell: chunk load order, restoration and machines built nearby change nothing', () => {
    const before = cells().map(({ x, z }) => JSON.stringify(spot(x, z) ?? null));
    // a second game of the same seed, its chunks loaded one cell at a time in a different order (neighbours of a
    // chunk edge may not be loaded yet when a cell is asked)
    const other = new Sim(createInitialState(7));
    const w2 = treeWorldOf(other);
    const order = cells().reverse();
    const got = new Map<string, string>();
    for (const { x, z } of order) {
      const t = other.grid.get(GROUND, x, z)!;
      got.set(`${x},${z}`, JSON.stringify(treeSpot(t, other.areas.info(other.areas.map.areaOfCell(x, z)).type, w2) ?? null));
    }
    expect(cells().map(({ x, z }) => got.get(`${x},${z}`))).toEqual(before);
    // restore everything, flood the canal's banks, and stand a machine next to every tree: still the same trees
    for (const { x, z } of cells()) {
      const t = other.grid.get(GROUND, x, z)!;
      if (t.blocked) continue;
      t.ground = 'restored';
      t.bloom = 3;
      if (t.feature !== 'water' && peek(x + 1, z)?.feature === 'water') t.feature = 'water';
      if (!spot(x, z) && spot(x + 1, z)) t.occupantId = 'm-test';
    }
    const after = cells().map(({ x, z }) => {
      const t = { ...other.grid.get(GROUND, x, z)!, blocked: peek(x, z)!.blocked };
      return JSON.stringify(treeSpot(t, areaType(x, z), w2) ?? null);
    });
    expect(after).toEqual(before);
  });
});

describe('P7-E29 pacing: the simulation counts tree tiles (songbirds, species, biodiversity)', () => {
  it('each area type keeps about as many tree tiles as before zones; only the beach (which had none) gains', () => {
    // seed 7, x −60…60, z −20…80, open ground: tree tiles before P7-E29 (the flat per-tile share)
    const BEFORE: Record<string, number> = { grove: 536, street: 143, plaza: 41, PARK: 24, market: 30, beach: 0, reservoir: 130 };
    const s2 = new Sim(createInitialState(7));
    const w = treeWorldOf(s2);
    const n: Record<string, number> = {};
    for (let z = -20; z <= 80; z++)
      for (let x = -60; x <= 60; x++) {
        const t = s2.grid.get(GROUND, x, z)!;
        if (t.blocked || t.occupantId || t.feature === 'water') continue;
        const a = s2.areas.map.areaOfCell(x, z);
        const ty = a === PARK ? 'PARK' : s2.areas.info(a).type;
        if (treeSpot(t, s2.areas.info(a).type, w)) n[ty] = (n[ty] ?? 0) + 1;
      }
    for (const [ty, was] of Object.entries(BEFORE)) {
      if (!was) continue;
      expect(n[ty] ?? 0, ty).toBeGreaterThanOrEqual(Math.floor(was * 0.85));
      expect(n[ty] ?? 0, ty).toBeLessThanOrEqual(Math.ceil(was * 1.1));
    }
    // songbirds stay reachable in the starting park alone (E16: 20 thriving tree tiles)
    expect(n.PARK).toBeGreaterThanOrEqual(20);
    expect(n.beach).toBeGreaterThan(60);
  });
});

describe('P7-E29 tree shapes', () => {
  it('no lollipops: every grown crown is several masses, raised on a trunk Bloombot can walk under', () => {
    for (const sp of SPECIES)
      for (const st of [3, 4] as const) {
        const g = treeGeo(sp, st, 0, 1);
        const f = foliageShape(g.pos, 4);
        // the crown is wider than a lone ball on a stick: at least as wide as half its height
        expect(f.crown.r * 2, `${sp} ${st} crown width`).toBeGreaterThan((f.crown.y1 - f.crown.y0) * 0.5);
        if (sp !== 'pine' && sp !== 'willow') {
          // a broadleaf at grove scale lifts its crown above Bloombot (about half a tile)
          expect(f.crown.y0 * TREES.scale.grove[0], `${sp} clearance`).toBeGreaterThan(0.5);
        }
      }
  });

  it('every detail level keeps the same silhouette (no popping between levels)', () => {
    for (const sp of SPECIES) {
      const near = foliageShape(treeGeo(sp, 3, 2, 1).pos, 4);
      const far = foliageShape(treeGeo(sp, 3, 2, 0).pos, 4);
      expect(Math.abs(far.crown.r - near.crown.r) / near.crown.r, `${sp} width`).toBeLessThan(0.2);
      expect(Math.abs(far.crown.y1 - near.crown.y1) / near.crown.y1, `${sp} height`).toBeLessThan(0.15);
    }
  });
});
