// E28.W02 (#695): where natural ground meets the water. A land edge that opens onto water slopes down under the surface
// as a bank, its lawn edge and its waterline wandering with the shore's noise, so the grid never shows as a square shore.
import * as pc from 'playcanvas';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { SolidCollector } from '../src/core/Solids';
import { CHUNK } from '../src/core/Hash';
import type { TileData } from '../src/core/types';
import { LOOK } from '../src/data/look';
import { OLD_CITY } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { ChunkRenderer, waterDistance } from '../src/rendering/ChunkRenderer';
import { FoliageBuilder } from '../src/rendering/Foliage';
import { bankDrop, bankStrip, bankU, grassLine, leanGeo, roomScale, shelfAt, shoreNoise, shoreRuns, taperScales, waterlineAt, waterlineReach, type BankColours, type BankGeo } from '../src/rendering/Shore';
import { encodeWater, WATER_SHORE_ENC, waterMaterial } from '../src/rendering/WaterSurface';
import type { TreeGeo } from '../src/rendering/TreeGen';
import { WATER } from '../src/rendering/Water';

const S = LOOK.shore;
const C: BankColours = { top: [0.2, 0.5, 0.1], bank: [0.3, 0.2, 0.1], wet: [0.2, 0.15, 0.1], under: [0.25, 0.25, 0.2] };
const TOP = 0.08;
const SURF = TOP - WATER.drop + 0.003;

describe('#695: the shore look values (LOOK.shore)', () => {
  it('are named, in range, and keep every bank inside the water tile it opens onto', () => {
    expect(S.reach.min).toBeGreaterThanOrEqual(0);
    expect(S.reach.max).toBeGreaterThan(S.reach.min);
    expect(S.beach).toBeGreaterThanOrEqual(1);
    expect(S.shelf.min).toBeGreaterThanOrEqual(0);
    expect(S.shelf.max).toBeGreaterThanOrEqual(S.shelf.min);
    // the widest waterline (a beach's, at the widest shelf) stays inside the water tile it opens onto, and in a
    // narrow channel each bank keeps to less than half the open water, so the two never meet
    expect(S.shelf.max + S.reach.max * S.beach).toBeLessThanOrEqual(0.95);
    expect(S.room).toBeGreaterThan(0);
    expect(S.room).toBeLessThan(0.5);
    expect(S.under).toBeGreaterThan(0);
    expect(S.crown).toBeGreaterThan(0);
    expect(S.crown).toBeLessThan(WATER.drop / 4);
    expect(S.shoulder).toBeGreaterThanOrEqual(0);
    expect(S.shoulder).toBeLessThanOrEqual(1);
    expect(S.segments).toBeGreaterThanOrEqual(4);
    expect(S.rows).toBeGreaterThanOrEqual(3);
    expect(S.grassLine.min).toBeGreaterThanOrEqual(0);
    expect(S.grassLine.max).toBeLessThanOrEqual(1);
    expect(S.ao).toBeGreaterThan(0);
    expect(S.ao).toBeLessThan(0.6);
    for (const k of ['earth', 'wet', 'bed', 'wetSand'] as const) expect(S[k]).toMatch(/^#[0-9a-f]{6}$/);
    for (const k of [S.rock, S.reeds, S.flowers, S.overhang.chance]) {
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThanOrEqual(1);
    }
    expect(S.overhang.inset).toBeGreaterThan(0);
    expect(S.overhang.lean).toBeGreaterThan(0);
    expect(S.overhang.lean).toBeLessThan(45);
    expect(S.taper).toBeGreaterThan(0);
    expect(S.taper).toBeLessThanOrEqual(1);
    expect(S.waterPull).toBeGreaterThanOrEqual(0);
    expect(S.waterPull).toBeLessThanOrEqual(1);
  });
});

describe('#695: banks in narrow water and beside built edges', () => {
  it('a bank keeps to its share of the open water in front of it, so a narrow channel stays open', () => {
    for (let i = 0; i < 300; i++) {
      const x = i * 0.23;
      const z = i * 0.41;
      for (const room of [0.5, 1, 2, 3]) {
        expect(waterlineAt(x, z, false, room)).toBeLessThanOrEqual(room * S.room + 1e-9);
        expect(waterlineAt(x, z, true, room)).toBeLessThanOrEqual(room * S.room + 1e-9);
      }
      // open water: no limit
      expect(waterlineAt(x, z, false)).toBeCloseTo(shelfAt(x, z) + waterlineReach(x, z, false), 9);
      expect(roomScale(x, z, false, 1e9)).toBe(1);
    }
    // a one-tile channel with banks on both sides keeps more than half its width open
    expect(1 - 2 * S.room).toBeGreaterThan(0.5);
  });

  it('a bank eases down to nothing toward an end that meets a built edge, and is untouched elsewhere', () => {
    const run = shoreRuns(0, 0, [false, false, true, false], [0, 0, 0, 0])[0];
    const none = taperScales(run, [false, false]);
    expect(none.every((k) => k === 1)).toBe(true);
    const both = taperScales(run, [true, true]);
    expect(both[0]).toBe(0);
    expect(both[both.length - 1]).toBe(0);
    expect(Math.max(...both)).toBe(1); // the middle of a tile's edge keeps its full width (taper is half a tile)
    const one = taperScales(run, [false, true]);
    expect(one[0]).toBe(1);
    expect(one[one.length - 1]).toBe(0);
    for (let i = 1; i < one.length; i++) expect(one[i]).toBeLessThanOrEqual(one[i - 1] + 1e-12);
    // and a tapered bank collapses onto the tile's edge at that end
    const g: BankGeo = { pos: [], nrm: [], col: [], idx: [] };
    bankStrip(g, run, TOP, SURF, false, C, undefined, undefined, [false, true]);
    const end = run[run.length - 1];
    for (let i = 0; i < g.pos.length; i += 3) if (Math.abs(g.pos[i] - end.x) < 1e-9) expect(g.pos[i + 2]).toBeCloseTo(end.z, 9);
  });
});

describe('#695: the water knows how far a bank pulled its edge out', () => {
  it('rides in the alpha channel (none: 255, as before), up to WATER_SHORE_ENC', () => {
    expect(encodeWater(0.4, 1)[3]).toBe(255);
    expect(encodeWater(0.4, 1, 1, 0)[3]).toBe(255);
    expect(encodeWater(0.4, 1, 1, WATER_SHORE_ENC)[3]).toBe(0);
    expect(encodeWater(0.4, 1, 1, 0.5)[3]).toBe(255 - Math.round(0.5 * 255));
    expect(encodeWater(0.4, 1, 1, 9)[3]).toBe(0);
    expect(encodeWater(0.4, 1, 1, -1)[3]).toBe(255);
  });

  it('the foam edge goes by the waterline, the rest by the share LOOK names', () => {
    const k = (waterMaterial().getParameter('uWaterShore') as { data?: number } | undefined)?.data;
    expect(k).toBeCloseTo(1 - S.waterPull, 9);
  });
});

describe('#695: the shore noise', () => {
  it('is the same every time, in 0..1, and smooth (no steps between neighbouring points)', () => {
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < 2000; i++) {
      const x = (i * 0.137) % 40;
      const z = (i * 0.291) % 40;
      const n = shoreNoise(x, z);
      expect(shoreNoise(x, z)).toBe(n);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
      expect(Math.abs(shoreNoise(x + 0.01, z) - n)).toBeLessThan(0.03);
      lo = Math.min(lo, n);
      hi = Math.max(hi, n);
    }
    // and it really varies
    expect(hi - lo).toBeGreaterThan(0.6);
  });

  it('the waterline, the shelf and the grass line stay within their ranges', () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 0.31;
      const z = -i * 0.17;
      const r = waterlineReach(x, z, false);
      expect(r).toBeGreaterThanOrEqual(S.reach.min - 1e-9);
      expect(r).toBeLessThanOrEqual(S.reach.max + 1e-9);
      expect(waterlineReach(x, z, true)).toBeCloseTo(r * S.beach, 9);
      const sh = shelfAt(x, z);
      expect(sh).toBeGreaterThanOrEqual(S.shelf.min - 1e-9);
      expect(sh).toBeLessThanOrEqual(S.shelf.max + 1e-9);
      expect(waterlineAt(x, z, false)).toBeCloseTo(sh + r, 9);
      const g = grassLine(x, z);
      expect(g).toBeGreaterThanOrEqual(S.grassLine.min - 1e-9);
      expect(g).toBeLessThanOrEqual(S.grassLine.max + 1e-9);
    }
  });

  it('a long straight shore is never ruled: its waterline wanders by a good part of a tile', () => {
    const at = Array.from({ length: 200 }, (_, i) => waterlineAt(i * 0.1, 30, false));
    expect(Math.max(...at) - Math.min(...at)).toBeGreaterThan(0.25);
  });
});

describe('#695: the bank cross-section', () => {
  it('drops from 0 at the top to all of it at the toe, never rising', () => {
    expect(bankDrop(0)).toBe(0);
    expect(bankDrop(1)).toBeCloseTo(1, 9);
    let last = -1;
    for (let u = 0; u <= 1.0001; u += 0.01) {
      const d = bankDrop(u);
      expect(d).toBeGreaterThanOrEqual(last);
      last = d;
    }
    for (const q of [0.1, 0.4, 0.65, 0.9]) expect(bankDrop(bankU(q))).toBeCloseTo(q, 6);
  });

  it('meets the water where the waterline says, and its toe lies under the surface', () => {
    const run = shoreRuns(0, 0, [false, false, true, false], [0, 0, 0, 0])[0];
    const g: BankGeo = { pos: [], nrm: [], col: [], idx: [] };
    bankStrip(g, run, TOP, SURF, false, C);
    let topMost = -Infinity;
    let low = Infinity;
    for (let i = 0; i < g.pos.length; i += 3) {
      topMost = Math.max(topMost, g.pos[i + 1]);
      low = Math.min(low, g.pos[i + 1]);
    }
    expect(topMost).toBeCloseTo(TOP, 9);
    expect(low).toBeCloseTo(SURF - S.under, 6);
    // the waterline: along the run, the bank crosses the surface at the edge's z + the shelf + the reach
    for (const p of run) {
      const want = p.z + waterlineAt(p.x, p.z, false);
      // the vertices out along this point's normal (it opens toward +z), and where they cross the surface
      const col = [];
      for (let i = 0; i < g.pos.length; i += 3) if (Math.abs(g.pos[i] - p.x) < 1e-9 && g.pos[i + 2] >= p.z - 1e-9 && g.nrm[i + 1] > 0) col.push([g.pos[i + 2], g.pos[i + 1]]);
      col.sort((a, b) => a[0] - b[0]);
      const k = col.findIndex(([, y]) => y <= SURF + 1e-9);
      const [z1, y1] = col[k - 1];
      const [z2, y2] = col[k];
      const cross = z1 + ((z2 - z1) * (y1 - SURF)) / (y1 - y2);
      expect(cross).toBeCloseTo(want, 2);
    }
    // normals face up and out (toward +z), never down
    for (let i = 0; i < g.nrm.length; i += 3) {
      if (Math.abs(g.nrm[i + 1]) < 1e-9) continue; // the end caps' sides
      expect(g.nrm[i + 1]).toBeGreaterThan(0);
      expect(g.nrm[i + 2]).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('two tiles side by side build the same bank where they meet, so the shore runs on without a seam', () => {
    const a = shoreRuns(0, 0, [false, false, true, false], [0, 0, 0, 0])[0];
    const b = shoreRuns(1, 0, [false, false, true, false], [0, 0, 0, 0])[0];
    const ends = [a[0], a[a.length - 1]];
    const shared = ends.find((p) => p.x === 1);
    const start = [b[0], b[b.length - 1]].find((p) => p.x === 1);
    expect(shared).toBeDefined();
    expect(start).toEqual(shared);
    const ga: BankGeo = { pos: [], nrm: [], col: [], idx: [] };
    const gb: BankGeo = { pos: [], nrm: [], col: [], idx: [] };
    bankStrip(ga, a, TOP, SURF, false, C);
    bankStrip(gb, b, TOP, SURF, false, C);
    const at = (g: BankGeo) => {
      const out: string[] = [];
      for (let i = 0; i < g.pos.length; i += 3) if (Math.abs(g.pos[i] - 1) < 1e-9) out.push(`${g.pos[i + 2].toFixed(6)},${g.pos[i + 1].toFixed(6)}`);
      return new Set(out);
    };
    const sa = at(ga);
    const sb = at(gb);
    expect(sa.size).toBeGreaterThan(4);
    for (const k of sa) expect(sb.has(k), k).toBe(true);
  });
});

describe('#695: the runs of a tile that open onto water', () => {
  it('no open side: no bank', () => {
    expect(shoreRuns(3, 3, [false, false, false, false], [0, 0, 0, 0])).toEqual([]);
  });

  it('one open side: one run along it, corner to corner, facing out', () => {
    const runs = shoreRuns(3, 3, [true, false, false, false], [0, 0, 0, 0]);
    expect(runs).toHaveLength(1);
    const r = runs[0];
    for (const p of r) {
      expect(p.x).toBe(4);
      expect([p.nx, p.nz]).toEqual([1, 0]);
    }
    expect(Math.min(...r.map((p) => p.z))).toBe(3);
    expect(Math.max(...r.map((p) => p.z))).toBe(4);
  });

  it('two open sides meeting at a square corner: one run that fans round the corner', () => {
    const runs = shoreRuns(0, 0, [true, false, true, false], [0, 0, 0, 0]);
    expect(runs).toHaveLength(1);
    const atCorner = runs[0].filter((p) => p.x === 1 && p.z === 1);
    expect(atCorner.length).toBeGreaterThanOrEqual(3);
    // the fan turns from one side's direction to the other's
    const dirs = atCorner.map((p) => Math.atan2(p.nz, p.nx));
    expect(Math.max(...dirs) - Math.min(...dirs)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('a rounded tip of land: the run follows the arc, every point on it facing out from its centre', () => {
    const R = WATER.fillet;
    const runs = shoreRuns(0, 0, [true, false, true, true], [R, 0, 0, R]);
    expect(runs).toHaveLength(1);
    const arc = runs[0].filter((p) => p.x > 1 - R + 1e-6 && p.z > 1 - R + 1e-6);
    expect(arc.length).toBeGreaterThan(3);
    for (const p of arc) {
      const ox = 1 - R;
      const oz = 1 - R;
      expect(Math.hypot(p.x - ox, p.z - oz)).toBeCloseTo(R, 9);
      expect(p.nx).toBeCloseTo((p.x - ox) / R, 9);
      expect(p.nz).toBeCloseTo((p.z - oz) / R, 9);
    }
  });

  it('an islet open all round is one closed run', () => {
    const R = WATER.fillet;
    const runs = shoreRuns(0, 0, [true, true, true, true], [R, R, R, R]);
    expect(runs).toHaveLength(1);
    const r = runs[0];
    expect(r[r.length - 1]).toEqual(r[0]);
  });
});

describe('#695: the water starts where the bank meets it', () => {
  it('next to natural ground the water distance is pulled out by the shelf and the slope (never below 0)', () => {
    const land = [{ x: 0, z: 0 }];
    const banked = [{ x: 0, z: 0, shore: 'bank' as const }];
    for (const [px, pz] of [
      [1.3, 0.5],
      [1.05, 0.2],
      [0.5, 1.8],
      [2.4, 2.4],
    ]) {
      const d = waterDistance(px, pz, land);
      const e = waterDistance(px, pz, banked);
      const near = waterlineAt(Math.min(1, Math.max(0, px)), Math.min(1, Math.max(0, pz)), false);
      expect(e).toBeCloseTo(Math.max(0, d - near), 9);
      expect(e).toBeGreaterThanOrEqual(0);
    }
    // a built edge (no shore) keeps its distance
    expect(waterDistance(1.3, 0.5, land)).toBeCloseTo(0.3, 9);
  });
});

describe('#695: plants that lean out over the water', () => {
  it('keep their foot exactly where they stand; only what grows above leans out', () => {
    const g: TreeGeo = {
      pos: new Float32Array([0.1, 0, 0.05, 0, -0.1, 0, 0, 0, 0, 0.5, 0, 1, 0.05, 1, -0.05, 1]),
      nrm: new Float32Array(12),
      col: new Uint8Array(16),
      idx: new Uint32Array([0, 1, 2, 1, 3, 2]),
      height: 1,
      tris: 2,
    };
    const lean = (25 * Math.PI) / 180;
    const l = leanGeo(g, lean);
    expect(leanGeo(g, lean)).toBe(l); // cached
    expect([...l.pos.slice(0, 8)]).toEqual([...g.pos.slice(0, 8)]);
    expect(l.pos[8]).toBeCloseTo(0 + 0.5 * Math.tan(lean), 6);
    expect(l.pos[12]).toBeCloseTo(0.05 + Math.tan(lean), 6);
    expect(l.pos[13]).toBe(1);
    expect(g.pos[12]).toBeCloseTo(0.05, 6); // the original is untouched
  });
});

/**
 * The real chunk builder over the Old City's shores (the band of chunks along the sea that #687's test uses), every
 * land tile restored to Radiant: the banks, their dressing, and that nothing the game plays on changes.
 */
describe('#695: the shore in the real chunk builder', () => {
  const sim = new Sim(createInitialState(7));
  sim.areas.fog = () => 'cleared';
  const sea = OLD_CITY.seaMinZ;
  const chunks: [number, number][] = [];
  for (let cx = -2; cx <= 1; cx++) for (const cz of [sea - 2, sea - 1, sea]) chunks.push([cx, cz]);
  const tiles: TileData[] = [];
  for (const [cx, cz] of chunks) for (const t of sim.grid.chunkAt(GROUND, cx, cz)?.tiles ?? []) if (t) tiles.push(t);
  for (const t of tiles) {
    if (t.feature === 'water' || t.blocked || t.occupantId || t.ramp) continue;
    t.ground = 'restored';
    t.bloom = 4;
    t.pollution = 0;
  }
  const before = JSON.stringify(tiles);
  type R = {
    band: number;
    detail: string;
    shore(...a: unknown[]): void;
    buildGround(v: unknown): Generator<void>;
  };
  const make = () => {
    const r = new ChunkRenderer(sim, new pc.Entity(), {} as pc.GraphicsDevice) as unknown as R;
    r.band = 2;
    r.detail = 'high';
    return r;
  };
  const build = (r: R) => {
    for (const [cx, cz] of chunks) {
      const v = { key: `${GROUND}:${cx}:${cz}`, cx, cz, dirty: true, fogDirty: true };
      const gen = r.buildGround(v);
      try {
        for (let k = 0; k < CHUNK * CHUNK * 4 && !gen.next().done; k++);
      } catch {
        /* the GPU upload */
      }
    }
  };
  // with the shore, recording every bank and every plant it stands up
  const r = make();
  const banks: { t: TileData; th: number; geo: BankGeo }[] = [];
  const plants: { t: TileData; th: number; x: number; y: number; z: number; g: TreeGeo; rot: number; s: number }[] = [];
  let current: { t: TileData; th: number } | undefined;
  const shore = r.shore.bind(r);
  r.shore = (b: unknown, fb: unknown, t: unknown, th: unknown, far: unknown) => {
    current = { t: t as TileData, th: th as number };
    const mb = b as { patch: (g: BankGeo) => void };
    const patch = mb.patch.bind(mb);
    mb.patch = (g: BankGeo) => {
      banks.push({ ...current!, geo: { pos: [...g.pos], nrm: [...g.nrm], col: [...g.col], idx: [...g.idx] } });
      patch(g);
    };
    try {
      shore(b, fb, t, th, far);
    } finally {
      mb.patch = patch;
      current = undefined;
    }
  };
  const fbAdd = vi.spyOn(FoliageBuilder.prototype, 'add').mockImplementation(function (this: FoliageBuilder, g, x, y, z, rot, s) {
    if (current) plants.push({ ...current, g, x, y, z, rot, s });
  });
  // what the line of sight is told is solid (the cat's hiding, the camera's fades): counted inside and outside the shore
  const solid = { inShore: 0, elsewhere: 0 };
  const seen = (['prim', 'geo', 'foliage', 'model', 'box'] as const).map((m) =>
    vi.spyOn(SolidCollector.prototype, m).mockImplementation(() => {
      if (current) solid.inShore++;
      else solid.elsewhere++;
    }),
  );
  build(r);
  afterAll(() => {
    fbAdd.mockRestore();
    for (const s of seen) s.mockRestore();
  });

  it('every shore tile gets its bank', () => {
    expect(banks.length).toBeGreaterThan(40);
    for (const b of banks) {
      expect(b.geo.idx.length % 3).toBe(0);
      expect(Math.max(...b.geo.idx)).toBeLessThan(b.geo.pos.length / 3);
      expect(b.geo.col.length).toBe(b.geo.pos.length);
    }
  });

  it('no bank rises above its tile or reaches past the water tile it opens onto', () => {
    for (const { t, th, geo } of banks) {
      const top = th + 0.08;
      for (let i = 0; i < geo.pos.length; i += 3) {
        expect(geo.pos[i + 1]).toBeLessThanOrEqual(top + 1e-6);
        expect(geo.pos[i + 1]).toBeGreaterThan(top - WATER.drop - S.under - 0.01);
        expect(geo.pos[i]).toBeGreaterThan(t.x - 1.6);
        expect(geo.pos[i]).toBeLessThan(t.x + 2.6);
        expect(geo.pos[i + 2]).toBeGreaterThan(t.z - 1.6);
        expect(geo.pos[i + 2]).toBeLessThan(t.z + 2.6);
      }
    }
  });

  it('restored banks get reeds, grass, flowers and plants leaning out over the water', () => {
    expect(plants.length).toBeGreaterThan(100);
    const leaning = plants.filter((p) => p.g.pos.length && p.y === p.th + 0.08 && plantLeans(p.g));
    expect(leaning.length).toBeGreaterThan(3);
  });

  it('every plant on the shore stands on ground: on its tile, or on the bank (nothing floats)', () => {
    const bad: string[] = [];
    for (const p of plants) {
      const top = p.th + 0.08;
      const onTile = p.x >= p.t.x - 1e-6 && p.x <= p.t.x + 1 + 1e-6 && p.z >= p.t.z - 1e-6 && p.z <= p.t.z + 1 + 1e-6;
      if (onTile && Math.abs(p.y - top) < 1e-6) continue; // on the tile's top (the overhanging plants, the lip's fringe)
      // otherwise on the bank: at the bank's height where it stands
      const h = bankHeightAt(p.x, p.z, banks.filter((b) => b.t === p.t));
      if (h === undefined || Math.abs(h - p.y) > 1e-4) bad.push(`${p.x.toFixed(3)},${p.z.toFixed(3)} y ${p.y.toFixed(3)} bank ${h?.toFixed(3)} (tile ${p.t.x},${p.t.z})`);
    }
    expect(bad.slice(0, 10), `${bad.length} of ${plants.length}`).toEqual([]);
  });

  it('nothing the game plays on changes: the tiles (so paths, collision and saves), and what the line of sight sees', () => {
    expect(JSON.stringify(tiles)).toBe(before);
    expect(solid.elsewhere).toBeGreaterThan(1000);
    expect(solid.inShore).toBe(0);
  });

  it('builds the same shore every time (seeded by position)', () => {
    const again = make();
    const banks2: BankGeo[] = [];
    const shore2 = again.shore.bind(again);
    again.shore = (b: unknown, ...rest: unknown[]) => {
      const mb = b as { patch: (g: BankGeo) => void };
      const patch = mb.patch.bind(mb);
      mb.patch = (g: BankGeo) => {
        banks2.push({ pos: [...g.pos], nrm: [...g.nrm], col: [...g.col], idx: [...g.idx] });
        patch(g);
      };
      try {
        shore2(b, ...rest);
      } finally {
        mb.patch = patch;
      }
    };
    build(again);
    expect(banks2.length).toBe(banks.length);
    banks2.forEach((g, i) => expect(g.pos).toEqual(banks[i].geo.pos));
  });
});

/** Does a plant lean (its top sits off to one side of its foot)? */
function plantLeans(g: TreeGeo): boolean {
  let top = -Infinity;
  let tx = 0;
  for (let i = 0; i < g.pos.length; i += 4)
    if (g.pos[i + 1] > top) {
      top = g.pos[i + 1];
      tx = g.pos[i];
    }
  return tx > top * 0.2;
}

/** The bank's height at (x, z) under the given banks' triangles (undefined if none covers it). */
function bankHeightAt(x: number, z: number, banks: { geo: BankGeo }[]): number | undefined {
  let best: number | undefined;
  for (const { geo } of banks)
    for (let i = 0; i < geo.idx.length; i += 3) {
      const [a, b, c] = [geo.idx[i], geo.idx[i + 1], geo.idx[i + 2]].map((k) => [geo.pos[k * 3], geo.pos[k * 3 + 1], geo.pos[k * 3 + 2]]);
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-12) continue;
      const w1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
      const w2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
      const w3 = 1 - w1 - w2;
      if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
      const y = w1 * a[1] + w2 * b[1] + w3 * c[1];
      if (best === undefined || y > best) best = y;
    }
  return best;
}
