import { describe, expect, it } from 'vitest';
import { RUINS } from '../src/data/ruins';
import { RuinPlanner } from '../src/rendering/Ruins';

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
});
