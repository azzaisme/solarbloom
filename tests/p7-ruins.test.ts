import { describe, expect, it } from 'vitest';
import { RUINS } from '../src/data/ruins';
import { readFileSync } from 'node:fs';
import { RuinPlanner } from '../src/rendering/Ruins';
import { parseRuinGlb, RUIN_MODEL_NAMES, type RuinModel, type RuinModelName } from '../src/rendering/RuinModels';

// P7-E32 (#756, #762): the distant ruined city is generated once, deterministically, in a few meshes, and stays out
// of the playable island and the open sea south of the start.

const plan = () => {
  const p = new RuinPlanner();
  const built = p.build();
  return { built, reach: p.reach };
};
const bearing = (x: number, z: number) => ((Math.atan2(x - RUINS.centre[0], z - RUINS.centre[1]) * 180) / Math.PI + 360) % 360;

describe('P7-E32 ruined skyline', () => {
  it('is the same every time (a pure function of the seed)', () => {
    const a = plan().built;
    const b = plan().built;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].geo.pos).toEqual(b[i].geo.pos);
      expect(a[i].geo.idx).toEqual(b[i].geo.idx);
    }
  });

  it('builds three bands, far first, each fading further toward the horizon the further out it stands', () => {
    expect(RUINS.layers.map((l) => l.name)).toEqual(['far', 'mid', 'near']);
    for (let i = 1; i < RUINS.layers.length; i++) {
      expect(RUINS.layers[i].radius[1]).toBeLessThan(RUINS.layers[i - 1].radius[0]);
      expect(RUINS.layers[i].fade).toBeLessThan(RUINS.layers[i - 1].fade);
    }
    const { built } = plan();
    const order = built.map((b) => b.layer);
    expect([...order].sort((x, y) => x - y)).toEqual(order); // the manual draw order is far → near
  });

  it('stands well beyond the playable island, never in the open sea due south of the start', () => {
    const { built } = plan();
    let verts = 0;
    for (const b of built) {
      const p = b.geo.pos;
      for (let i = 0; i < p.length; i += 3) {
        const d = Math.hypot(p[i] - RUINS.centre[0], p[i + 2] - RUINS.centre[1]);
        expect(d).toBeGreaterThan(190); // the Old City island reaches ~145 from its centre at the corners
        verts++;
        // the near and mid bands leave the sea past the jetty open, 345°–15° (only the far band has a faint shore there)
        if (b.layer > 0) {
          const br = bearing(p[i], p[i + 2]);
          expect(br > 15 && br < 345).toBe(true);
        }
      }
    }
    expect(verts).toBeGreaterThan(2000);
  });

  it('is cheap: a few meshes (one per band and slice) and a modest vertex count', () => {
    const { built, reach } = plan();
    const meshes = built.filter((b) => b.geo.idx.length);
    expect(meshes.length).toBeLessThanOrEqual(RUINS.layers.length * RUINS.sectors);
    const verts = built.reduce((s, b) => s + b.geo.pos.length / 3, 0);
    expect(verts).toBeLessThan(60000);
    expect(reach).toBeGreaterThan(RUINS.layers[0].radius[1]);
  });

  it('has only a handful of night lights, on the near and mid bands', () => {
    const { built } = plan();
    let lamps = 0;
    for (const b of built) {
      const lit = b.geo.lamp.filter((v) => v > 0).length;
      if (lit) expect(b.layer).toBeGreaterThan(0);
      lamps += lit;
    }
    // each light is one small box (6 faces × 4 corners)
    expect(lamps / 24).toBeLessThanOrEqual(RUINS.lamps.count);
    expect(lamps).toBeGreaterThan(0);
  });

  it('fades blue, not milky: no band is mixed all the way into the haze, and night keeps silhouettes', () => {
    for (const l of RUINS.layers) expect(l.fade).toBeLessThan(0.75);
    expect(RUINS.nightFade).toBeLessThan(1);
  });

  describe('with the authored models', () => {
    const models = Object.fromEntries(
      RUIN_MODEL_NAMES.map((n) => {
        const b = readFileSync(`assets/raw/models/ruins/ruin-${n}.glb`);
        return [n, parseRuinGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))];
      }),
    ) as Record<RuinModelName, RuinModel>;

    it('parses each: ~1,500 triangles, base at y 0, the README heights, vertex colours in 0–1', () => {
      const heights: Record<RuinModelName, number> = { aqueduct: 12, tower: 30, dome: 14, solarframe: 18, cliff: 22 };
      for (const n of RUIN_MODEL_NAMES) {
        const m = models[n];
        expect(m.idx.length / 3, n).toBeGreaterThan(1200);
        expect(m.idx.length / 3, n).toBeLessThan(1800);
        expect(m.box[1], n).toBeCloseTo(0, 1);
        expect(m.box[4], n).toBeCloseTo(heights[n], 0);
        for (const c of m.col) expect(c >= 0 && c <= 1).toBe(true);
      }
    });

    it('stands them on cliff mesas, deterministically, still clear of the island and the open sea due south', () => {
      const a = new RuinPlanner(models).build();
      const b = new RuinPlanner(models).build();
      expect(a.map((x) => x.geo.pos.length)).toEqual(b.map((x) => x.geo.pos.length));
      let tris = 0;
      let minD = Infinity;
      let south = 0;
      for (const x of a) {
        tris += x.geo.idx.length / 3;
        const p = x.geo.pos;
        for (let i = 0; i < p.length; i += 3) {
          minD = Math.min(minD, Math.hypot(p[i] - RUINS.centre[0], p[i + 2] - RUINS.centre[1]));
          if (x.layer > 0) {
            const br = bearing(p[i], p[i + 2]);
            if (!(br > 15 && br < 345)) south++;
          }
        }
      }
      expect(minD).toBeGreaterThan(190);
      expect(south).toBe(0);
      console.log(`ruins with models: ${tris} triangles`);
      // the near band is built from the models: far more triangles than its procedural boxes, still a modest total
      const near = a.filter((x) => x.layer === 2).reduce((s2, x) => s2 + x.geo.idx.length / 3, 0);
      expect(near).toBeGreaterThan(models.cliff.idx.length / 3 * 4);
      expect(tris).toBeLessThan(250000);
      expect(a.filter((x) => x.geo.idx.length).length).toBeLessThanOrEqual(RUINS.layers.length * RUINS.sectors);
    });
  });
});

describe('P7-E32 polish: inland slices', () => {
  it('from the jetty, inland (north, the island) counts as inland and the open sea south does not', async () => {
    const { inlandToward } = await import('../src/rendering/Ruins');
    expect(inlandToward(0, 40, 8, -400)).toBe(true); // north across the island
    expect(inlandToward(-3.75, 30.5, -3.75, 500)).toBe(false); // due south over the sea
    expect(inlandToward(-3.75, 30.5, 400, 0)).toBe(true); // east: the island, then the mainland
  });
});
