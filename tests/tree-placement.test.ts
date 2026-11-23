import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { LANDING } from '../src/data/oldcity';
import { TERRAIN } from '../src/data/terrain';
import { createInitialState, GROUND } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { zoneAt } from '../src/rendering/PlantingZones';
import { treeSpot, treeWorldOf, treeZone, TREES } from '../src/rendering/TreePlacement';
import { FORM_SPECIES, TREE_VARIANTS, treeGeo, type Form } from '../src/rendering/TreeGen';
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
    // a few specimens and small groves with open lawn between (owner: about half the first pass's woodland)
    expect(trees.length / beach.length).toBeGreaterThan(0.025);
    expect(trees.length / beach.length).toBeLessThan(0.1);
    // shade oaks and willows both show up, and a blossom accent
    const sp = new Set(trees.map(({ x, z }) => spot(x, z)!.species));
    for (const s of ['oak', 'willow', 'cherry'] as const) expect(sp.has(s), s).toBe(true);
    // a broadleaf coast: pines are a rare accent at most
    expect(trees.filter(({ x, z }) => spot(x, z)!.species === 'pine').length).toBe(0); // no pines on the coast
  });

  it('the sandy beach by the sea stays open: P7-E28 beach cells grow no trees', () => {
    const beach = cells().filter(({ x, z }) => zone(x, z) === 'beach');
    expect(beach.length).toBeGreaterThan(20);
    for (const { x, z } of beach) expect(spot(x, z), `tree on the beach at ${x},${z}`).toBeUndefined();
  });

  it('the view off a jetty or bridge is framed, not blocked: only small trees near a deck', () => {
    for (const { x, z } of cells()) {
      const sp = spot(x, z);
      if (!sp || sp.planter) continue;
      let near = false;
      for (let dz = -TREES.deckSmall; dz <= TREES.deckSmall && !near; dz++)
        for (let dx = -TREES.deckSmall; dx <= TREES.deckSmall && !near; dx++) near = deck(x + dx, z + dz);
      if (near) expect(sp.scale, `tree at ${x},${z} near a deck`).toBeLessThanOrEqual(TREES.deckScale);
    }
  });

  it('nothing on path edges, in landmark or machine clearances, or round a jetty or bridge', () => {
    for (const { x, z } of cells()) {
      const t = peek(x, z)!;
      if (!spot(x, z) || t.feature === 'paving') continue;
      expect(['path_edge', 'landmark_clearance', 'beach']).not.toContain(zone(x, z));
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
    expect(groves.length).toBeGreaterThanOrEqual(2); // fewer since the sea-side sand became an open beach (P7-E28)
    // grove trees come in size classes, the smallest still a real tree (not a shrub)
    for (const { x, z } of trees) expect(spot(x, z)!.scale).toBeGreaterThanOrEqual(TREES.groveSmall[1][0] * 0.88 - 1e-9);
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
    expect(n.beach).toBeGreaterThan(25);
    expect(n.beach).toBeLessThan(60);
  });
});

describe('P7-E29 tree variation (the original leafy trees, varied)', () => {
  it('variants differ in proportions and greens; sizes come in classes', () => {
    const dims = Array.from({ length: TREE_VARIANTS }, (_, v) => {
      const f = foliageShape(treeGeo('oak', 3, v, 1).pos, 4);
      return { w: f.crown.r, h: f.crown.y1 };
    });
    const ws = dims.map((d) => d.w), hs = dims.map((d) => d.h);
    expect(Math.max(...ws) / Math.min(...ws)).toBeGreaterThan(1.25);
    expect(Math.max(...hs) / Math.min(...hs)).toBeGreaterThan(1.2);
    // greens: the average leaf colour differs between variants
    const green = (v: number) => {
      const g = treeGeo('oak', 3, v, 1);
      let r = 0, gg = 0, n = 0;
      for (let i = 0; i < g.col.length; i += 4) if (g.col[i + 1] > g.col[i] && g.col[i + 1] > g.col[i + 2]) (r += g.col[i]), (gg += g.col[i + 1]), n++;
      return r / gg;
    };
    const hues = Array.from({ length: TREE_VARIANTS }, (_, v) => green(v));
    expect(Math.max(...hues) - Math.min(...hues)).toBeGreaterThan(0.08);
    // sizes round the start: small, mid and large trees, and a hero or two
    const scales = cells().map(({ x, z }) => spot(x, z)?.scale).filter((v): v is number => v !== undefined);
    expect(scales.filter((v) => v < 1.25).length).toBeGreaterThan(3);
    expect(scales.filter((v) => v >= 1.3 && v < 1.65).length).toBeGreaterThan(3);
    expect(scales.filter((v) => v >= 1.65).length).toBeGreaterThan(3);
  });
});

describe('P7-E29 tree forms (umbrella, columnar, fruit, coastal), in the leafy style', () => {
  it('each form keeps the original per-tree budget at every detail level', () => {
    for (const [form, sp] of Object.entries(FORM_SPECIES) as [Form, typeof FORM_SPECIES.umbrella][])
      for (const st of [2, 3] as const)
        for (let v = 0; v < TREE_VARIANTS; v++) {
          expect(treeGeo(sp, st, v, 0, form).tris, `${form} far`).toBeLessThanOrEqual(260);
          expect(treeGeo(sp, st, v, 1, form).tris, `${form} normal`).toBeLessThanOrEqual(4500);
          expect(treeGeo(sp, st, v, 2, form).tris, `${form} near`).toBeLessThanOrEqual(8500);
        }
  });

  it('round the start every form shows up, none dominates, and each stands where it belongs', () => {
    const W2 = treeWorldOf(sim);
    const all = cells().map(({ x, z }) => ({ x, z, s: spot(x, z) })).filter((c) => c.s && !c.s.planter);
    const by = (f: Form) => all.filter((c) => c.s!.form === f);
    for (const f of ['umbrella', 'columnar', 'fruit', 'coastal'] as const) expect(by(f).length, f).toBeGreaterThan(0);
    for (const f of ['umbrella', 'columnar', 'fruit', 'coastal'] as const) expect(by(f).length / all.length, f).toBeLessThan(0.25);
    // the species stays what the simulation counts
    for (const c of all) if (c.s!.form !== 'standard') expect(c.s!.species).toBe(FORM_SPECIES[c.s!.form as Exclude<Form, 'standard'>]);
    // columnar trees stand two cells off a path, a road or a canal
    const route = (x: number, z: number) => {
      const t = W2.peek(x, z);
      return !!t && (t.feature === 'water' || (!t.blocked && (t.feature === 'paving' || t.feature === 'road')));
    };
    for (const c of by('columnar')) {
      let near = false;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) near ||= route(c.x + dx, c.z + dz);
      expect(near, `columnar at ${c.x},${c.z}`).toBe(true);
    }
    // coastal trees lean away from the water: their +x (the lean) points away from the nearest water
    for (const c of by('coastal')) {
      let wx = 0, wz = 0;
      for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) if (W2.peek(c.x + dx, c.z + dz)?.feature === 'water') (wx += dx / (dx * dx + dz * dz)), (wz += dz / (dx * dx + dz * dz));
      expect(Math.cos(c.s!.rot) * wx + Math.sin(c.s!.rot) * wz, `coastal at ${c.x},${c.z}`).toBeLessThan(0);
    }
  });
});

describe('P7-E29 polish: views kept open', () => {
  const all = () => cells().map(({ x, z }) => ({ x, z, s: spot(x, z) })).filter((c) => c.s && !c.s.planter);
  it('the waterfall shows from the jetty landing: only small trees on the line between', () => {
    const [ax, az] = LANDING.spawn, [bx, bz] = [TERRAIN.fall.x + 0.5, TERRAIN.fall.lip];
    for (const c of all()) {
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((c.x + 0.5 - ax) * dx + (c.z + 0.5 - az) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(c.x + 0.5 - ax - t * dx, c.z + 0.5 - az - t * dz) <= TREES.viewHalf) expect(c.s!.scale, `${c.x},${c.z}`).toBeLessThanOrEqual(TREES.deckScale);
    }
  });
  it('the overlook is a lookout: nothing on top, only small trees at its seaward and beachward edges', () => {
    const o = TERRAIN.overlook;
    for (const c of all()) {
      expect(c.x >= o.x && c.x < o.x + o.w && c.z >= o.z && c.z < o.z + o.d, `${c.x},${c.z} on the overlook`).toBe(false);
      if (c.x >= o.x - 1 && c.x < o.x + o.w + TREES.overlookEdge && c.z >= o.z - 1 && c.z < o.z + o.d + TREES.overlookEdge) expect(c.s!.scale).toBeLessThanOrEqual(TREES.overlookScale);
    }
  });
  it('no columnar row or big tree stands near a landmark (the Sea Lock from the canal)', () => {
    const marks = new Set<string>();
    for (const { x, z } of cells()) {
      const i = sim.areas.info(sim.areas.map.areaOfCell(x, z));
      if (!i.noLandmark && i.landmark) marks.add(i.landmark.join(','));
    }
    expect(marks.has('-6,40')).toBe(true);
    for (const c of all())
      for (const m of marks) {
        const [lx, lz] = m.split(',').map(Number);
        const d = Math.max(c.x < lx ? lx - c.x : c.x > lx + 1 ? c.x - lx - 1 : 0, c.z < lz ? lz - c.z : c.z > lz + 1 ? c.z - lz - 1 : 0);
        if (d > TREES.landmarkView) continue;
        expect(c.s!.form, `${c.x},${c.z} by ${m}`).not.toBe('columnar');
        expect(c.s!.scale).toBeLessThanOrEqual(TREES.deckScale);
      }
  });
});

