// E28 water waves: the water's surface is one continuous sheet across every chunk and tile border. Each chunk builds its
// own water mesh, so every point two chunks (or two tiles) share must carry the same distance to land, bank pull,
// clarity and restore window from both sides, near chunks and far ones alike, or the colour, waves and foam step there.
import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { CHUNK } from '../src/core/Hash';
import { Sim } from '../src/gameplay/Sim';
import { BANK_PULL_END, BANK_PULL_FULL, bankPullShare, ChunkRenderer, waterDistance, waterReach } from '../src/rendering/ChunkRenderer';
import { waterlineAt } from '../src/rendering/Shore';
import { WATER } from '../src/rendering/Water';

interface Geo {
  pos: number[];
  col: number[];
  tr: number[];
}
type R = {
  band: number;
  detail: string;
  farFrom: number;
  poolMesh(geo: Geo): unknown;
  buildGround(v: unknown): Generator<void>;
};

/** The real chunk builder over the start (the beach, the jetty, the islands and the open sea): every chunk's water. */
function buildWater(farOf: (cx: number, cz: number) => boolean) {
  const sim = new Sim(createInitialState(7));
  sim.areas.fog = () => 'cleared';
  const r = new ChunkRenderer(sim, new pc.Entity(), {} as pc.GraphicsDevice) as unknown as R;
  r.band = 2;
  r.detail = 'high';
  const out: { cx: number; cz: number; far: boolean; geo: Geo }[] = [];
  let at: { cx: number; cz: number; far: boolean } | undefined;
  r.poolMesh = (geo: Geo) => {
    if (at && geo.pos.length) out.push({ ...at, geo: { pos: [...geo.pos], col: [...geo.col], tr: [...geo.tr] } });
    return undefined;
  };
  for (let cx = -2; cx <= 1; cx++)
    for (let cz = 1; cz <= 4; cz++) {
      const far = farOf(cx, cz);
      // far chunks are those further than `farFrom` chunks from the focus (8, 8)
      r.farFrom = far ? -1 : Infinity;
      at = { cx, cz, far };
      const gen = r.buildGround({ key: `${GROUND}:${cx}:${cz}`, cx, cz, dirty: true, fogDirty: true });
      try {
        for (let k = 0; k < CHUNK * CHUNK * 4 && !gen.next().done; k++);
      } catch {
        /* the GPU upload */
      }
    }
  return out;
}

/** Every water vertex by position: what each chunk (and tile) that holds it says about it. */
function byPoint(chunks: ReturnType<typeof buildWater>) {
  const pts = new Map<string, { chunk: string; far: boolean; col: number[]; tr: number[]; x: number; z: number }[]>();
  for (const { cx, cz, far, geo } of chunks)
    for (let i = 0; i < geo.pos.length / 3; i++) {
      const x = geo.pos[i * 3];
      const z = geo.pos[i * 3 + 2];
      const k = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
      const list = pts.get(k) ?? [];
      list.push({ chunk: `${cx},${cz}`, far, col: geo.col.slice(i * 4, i * 4 + 4), tr: geo.tr.slice(i * 2, i * 2 + 2), x, z });
      pts.set(k, list);
    }
  return pts;
}

describe('the water surface across chunk and tile borders', () => {
  // a checkerboard of near and far chunks: every border is a near-far border somewhere
  const chunks = buildWater((cx, cz) => (cx + cz) % 2 !== 0);
  const pts = byPoint(chunks);

  it('builds water on both near and far chunks, on the same grid (a far chunk has every point a near one has)', () => {
    expect(chunks.some((c) => c.far)).toBe(true);
    expect(chunks.some((c) => !c.far)).toBe(true);
    // (a far chunk's land keeps square corners, so it leaves out the near chunk's fills round rounded ones; every
    // point of its own water matches the near build's exactly)
    const near = byPoint(buildWater(() => false));
    let checked = 0;
    for (const c of chunks.filter((q) => q.far))
      for (let i = 0; i < c.geo.pos.length / 3; i++) {
        const n = near.get(`${Math.round(c.geo.pos[i * 3] * 1000)},${Math.round(c.geo.pos[i * 3 + 2] * 1000)}`);
        expect(n).toBeDefined();
        expect(n![0].col).toEqual(c.geo.col.slice(i * 4, i * 4 + 4));
        checked++;
      }
    expect(checked).toBeGreaterThan(5000);
  });

  it('every point shared by two chunks or two tiles carries the same values from each', () => {
    let shared = 0;
    let acrossChunks = 0;
    let nearFar = 0;
    for (const list of pts.values()) {
      if (list.length < 2) continue;
      shared++;
      if (new Set(list.map((l) => l.chunk)).size > 1) acrossChunks++;
      if (new Set(list.map((l) => l.far)).size > 1) nearFar++;
      for (const l of list.slice(1)) {
        expect(l.col, `water at ${l.x}, ${l.z} (chunks ${list.map((q) => q.chunk).join(' / ')})`).toEqual(list[0].col);
        expect(l.tr[0]).toBeCloseTo(list[0].tr[0], 6);
        expect(l.tr[1]).toBeCloseTo(list[0].tr[1], 6);
      }
    }
    expect(acrossChunks).toBeGreaterThan(50);
    expect(nearFar).toBeGreaterThan(50);
    expect(shared).toBeGreaterThan(acrossChunks);
  });

  it('the distance to land never steps between neighbouring points (no seam round a bank or where a search stops)', () => {
    const step = 1 / WATER.grid;
    let pairs = 0;
    let worst = 0;
    for (const [k, list] of pts) {
      const [x, z] = k.split(',').map(Number);
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ]) {
        const n = pts.get(`${x + dx * step * 1000},${z + dz * step * 1000}`);
        if (!n) continue;
        pairs++;
        // red carries the distance (in 255ths of WATER_ENC); alpha the bank pull
        const d = (Math.abs(n[0].col[0] - list[0].col[0]) / 255) * 8;
        worst = Math.max(worst, d);
        // the pulled distance grows at most 1.75 tiles a tile (a bank's pull easing off), plus a byte of rounding
        expect(d).toBeLessThanOrEqual(step * 1.75 + 8 / 255 + 1e-9);
        // the pull (alpha) is the gap between the plain and the banked distance: at most the sum of their changes
        expect(Math.abs(n[0].col[3] - list[0].col[3]) / 255).toBeLessThanOrEqual(step * 2.75 + 2 / 255 + 1e-9);
      }
    }
    expect(pairs).toBeGreaterThan(1000);
    expect(worst).toBeGreaterThan(0);
  });

  it('no point reads past the search reach (where only some tiles would still see land)', () => {
    const cap = Math.round((waterReach() / 8) * 255);
    for (const list of pts.values()) expect(list[0].col[0]).toBeLessThanOrEqual(cap);
  });
});

describe("a bank's pull eases off instead of stopping", () => {
  it('pulls fully near the bank and not at all from BANK_PULL_END out, smoothly between', () => {
    expect(bankPullShare(0)).toBe(1);
    expect(bankPullShare(BANK_PULL_FULL)).toBe(1);
    expect(bankPullShare(BANK_PULL_END)).toBe(0);
    expect(bankPullShare(5)).toBe(0);
    let last = 1;
    for (let e = BANK_PULL_FULL; e <= BANK_PULL_END; e += 0.05) {
      const s = bankPullShare(e);
      expect(s).toBeLessThanOrEqual(last + 1e-12);
      last = s;
    }
  });

  it('the banked distance is continuous and only grows moving away from land', () => {
    const banked = [{ x: 0, z: 0, shore: 'beach' as const }];
    let last = -1;
    for (let x = 1; x <= 5; x += 0.01) {
      const d = waterDistance(x, 0.5, banked);
      expect(d).toBeGreaterThanOrEqual(last - 1e-9);
      if (last >= 0) expect(d - last).toBeLessThan(0.02);
      last = d;
    }
    // past the ease the bank no longer pulls at all
    expect(waterDistance(1 + BANK_PULL_END + 0.5, 0.5, banked)).toBeCloseTo(BANK_PULL_END + 0.5, 9);
    // right by the bank it pulls by its full waterline
    expect(waterDistance(1.5, 0.5, banked)).toBeCloseTo(Math.max(0, 0.5 - waterlineAt(1, 0.5, true)), 9);
  });
});
