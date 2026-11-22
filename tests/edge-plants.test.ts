// #687 (E27.4): flowers, tufts, shrubs and stones at the edge of a grass island stuck out past its rounded edge and
// hung over the water. Every scattered piece now keeps its footprint on the tile's drawn top.
import * as pc from 'playcanvas';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { CHUNK } from '../src/core/Hash';
import type { TileData } from '../src/core/types';
import { OLD_CITY } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { ChunkRenderer, MeshBuilder } from '../src/rendering/ChunkRenderer';
import { FoliageBuilder } from '../src/rendering/Foliage';
import { fitOnGround, geoRadius, onGround, type GroundFit } from '../src/rendering/GroundFit';
import type { TreeGeo } from '../src/rendering/TreeGen';
import { WATER } from '../src/rendering/Water';

describe('#687: fitting a piece onto a tile', () => {
  const R = WATER.fillet;
  const island: GroundFit = { x0: 4, z0: 9, open: [true, true, true, true], cut: [R, R, R, R] };
  const bank: GroundFit = { x0: 4, z0: 9, open: [true, false, false, false], cut: [0, 0, 0, 0] };
  const seeded = (n: number) => {
    let s = n;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  };

  it('a fitted footprint is always on the drawn top, on a round island tile and on a straight bank', () => {
    const rnd = seeded(7);
    for (const f of [island, bank])
      for (let i = 0; i < 4000; i++) {
        const r = rnd() * 0.36;
        const [x, z] = fitOnGround(f, f.x0 - 0.2 + rnd() * 1.4, f.z0 - 0.2 + rnd() * 1.4, r);
        expect(onGround(f, x, z, r), `${f === island ? 'island' : 'bank'} r ${r.toFixed(3)} at ${x.toFixed(3)}, ${z.toFixed(3)}`).toBe(true);
      }
  });

  it('a piece already on the ground stays where it is; only the overhang moves it', () => {
    expect(fitOnGround(island, 4.5, 9.5, 0.2)).toEqual([4.5, 9.5]);
    // a tuft right on the +x lip moves in by its radius and a hair
    const [x] = fitOnGround(bank, 4.97, 9.5, 0.15);
    expect(x).toBeCloseTo(5 - 0.15 - 0.02);
    // on the closed sides it may spread over the seam onto the neighbour's ground
    expect(fitOnGround(bank, 3.98, 9.5, 0.15)).toEqual([3.98, 9.5]);
  });

  it('it is never dropped: a piece too big for the room is centred', () => {
    const [x, z] = fitOnGround(island, 4.9, 9.9, 0.6);
    expect(x).toBeCloseTo(4.5);
    expect(z).toBeCloseTo(9.5);
  });
});

/**
 * The real chunk builder over the Old City's shores: every land tile in a band of chunks along the sea, the Saltwind
 * canal and the terrace cliffs restored to Radiant, every scattered foliage piece and stone recorded where it lands.
 */
describe('#687: nothing scattered hangs over the edge of the ground', () => {
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
  const r = new ChunkRenderer(sim, new pc.Entity(), {} as pc.GraphicsDevice) as unknown as {
    band: number;
    detail: string;
    fitNow?: GroundFit;
    scatter: { add: (g: TreeGeo, x: number, y: number, z: number, rot: number, s: number) => void };
    groundFit(t: TileData): GroundFit | undefined;
    buildGround(v: unknown): Generator<void>;
  };
  r.band = 2;
  r.detail = 'high';
  const bad: string[] = [];
  let checked = 0;
  let edge = 0;
  let inScatter = false;
  const scatterAdd = r.scatter.add;
  r.scatter.add = (...a) => {
    inScatter = true;
    try {
      scatterAdd(...a);
    } finally {
      inScatter = false;
    }
  };
  const where = (f: GroundFit) => `tile ${f.x0},${f.z0} open ${f.open.map(Number).join('')} cut ${f.cut.map((k) => (k ? 1 : 0)).join('')}`;
  const look = (what: string, x: number, z: number, rad: number) => {
    const f = r.fitNow!;
    checked++;
    if (f.open.some((o) => o)) edge++;
    if (!onGround(f, x, z, rad, 1e-4)) bad.push(`${what} r ${rad.toFixed(3)} at ${x.toFixed(3)}, ${z.toFixed(3)} on ${where(f)}`);
  };
  const fbAdd = vi.spyOn(FoliageBuilder.prototype, 'add').mockImplementation(function (this: FoliageBuilder, g, x, _y, z, _rot, s) {
    if (inScatter && r.fitNow) look('foliage', x, z, geoRadius(g) * s);
  });
  const mbAdd = vi.spyOn(MeshBuilder.prototype, 'add').mockImplementation(function (this: MeshBuilder, type, _hex, p, s) {
    if (!r.fitNow || (type !== 'sphere' && type !== 'cone')) return;
    const sc = typeof s === 'number' ? [s, s, s] : s;
    // ground scatter only: small pieces lying on the ground (a prop's spheres stand higher, or are bigger)
    if (Math.max(sc[0], sc[2]) <= 0.4) look(type, p[0], p[2], Math.max(sc[0], sc[2]) / 2);
  });
  afterAll(() => {
    fbAdd.mockRestore();
    mbAdd.mockRestore();
  });
  for (const [cx, cz] of chunks) {
    const v = { key: `${GROUND}:${cx}:${cz}`, cx, cz, dirty: true, fogDirty: true };
    const gen = r.buildGround(v);
    try {
      // the tiles are drawn first; the mesh upload at the end needs a real device, so stop when it fails
      for (let k = 0; k < CHUNK * CHUNK * 4 && !gen.next().done; k++);
    } catch {
      /* the GPU upload */
    }
  }

  it('the shores have rounded island tips and open edges to check', () => {
    const fits = tiles.map((t) => r.groundFit(t)).filter((f): f is GroundFit => !!f);
    expect(fits.filter((f) => f.cut.some((k) => k)).length, 'rounded tips').toBeGreaterThan(3);
    expect(fits.filter((f) => f.open.some((o) => o)).length, 'tiles with an open edge').toBeGreaterThan(40);
    expect(checked).toBeGreaterThan(1000);
    expect(edge).toBeGreaterThan(200);
  });

  it('every scattered piece keeps its footprint on the ground it stands on', () => {
    expect(bad.slice(0, 12), `${bad.length} of ${checked} pieces hang over`).toEqual([]);
  });
});
