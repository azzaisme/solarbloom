import { describe, expect, it } from 'vitest';
import { treeGeo, SPECIES, type TreeGeo } from '../src/rendering/TreeGen';
import { bannerGeo, flowerGeo, FLOWER_SPECIES, grassGeo, turfGeo, vineGeo } from '../src/rendering/Flora';
import { clutterGeo, pavingGeo, railGeo, PAVING_LAYOUTS } from '../src/rendering/Props';
import { flowerDrifts, grassTufts, paving, thrivingExtras, type DressCtx } from '../src/rendering/Surfaces';
import type { TileData } from '../src/core/types';


/**
 * Look 3.17 (#144): triangle budgets for the new detail, checked without a browser. Each template is pure
 * geometry, so its cost is exact; a tile's cost is what the surface builders stamp for it. The chunk budget in
 * test:perf:browser (heaviest chunk ≤ 200k) is roughly 256 tiles × these per-tile numbers plus trees.
 */
const tile = (x: number, z: number, bloom: number, feature = 'lawn'): TileData =>
  ({ id: `0:${x}:${z}`, roofId: '0', x, z, ground: 'restored', bloom, variant: x * 31 + z * 17, blocked: false, pollution: 0, feature }) as unknown as TileData;

function dress(lod: 0 | 1 | 2, dens: number) {
  let tris = 0;
  const geo = (g: TreeGeo) => (tris += g.tris);
  const c: DressCtx = {
    b: { grey: 0, add: () => (tris += 12), addGeo: geo, quad: () => (tris += 2) },
    fb: { add: geo },
    dens,
    lod,
    area: 'park',
    areaType: 'park',
    level: 4,
    // neighbours: paving to the east, so one edge carries a drift
    peek: (x, z) => tile(x, z, 3, x % 3 === 0 ? 'paving' : 'lawn'),
    areaAt: () => 'park',
  };
  return { c, count: () => tris };
}

describe('Look 3 detail budget', () => {
  it('trees: one blob far, cheap clumps at normal zoom, clusters close up, leaves super close', () => {
    for (const sp of SPECIES) {
      const far = treeGeo(sp, 3, 1, 0).tris;
      const normal = treeGeo(sp, 3, 1, 1).tris;
      const near = treeGeo(sp, 3, 1, 2).tris;
      const close = treeGeo(sp, 3, 1, 3).tris;
      expect(far, `${sp} far`).toBeLessThanOrEqual(260);
      expect(normal, `${sp} normal`).toBeLessThanOrEqual(3200);
      expect(near, `${sp} near`).toBeLessThanOrEqual(5000);
      expect(close, `${sp} super close`).toBeLessThanOrEqual(8000);
    }
  });

  it('small templates stay small', () => {
    for (const sp of FLOWER_SPECIES) expect(flowerGeo(sp, 0, true, 0, 1).tris, sp).toBeLessThanOrEqual(420);
    expect(grassGeo(3, 0, 2).tris).toBeLessThanOrEqual(40);
    expect(turfGeo(3, 0, 2).tris).toBeLessThanOrEqual(200);
    expect(turfGeo(3, 0, 1).tris).toBeLessThanOrEqual(110);
    expect(vineGeo(4, 1.5, 0, 1).tris).toBeLessThanOrEqual(700);
    expect(bannerGeo('pole', true, 0, 1).tris).toBeLessThanOrEqual(280);
    for (let l = 0; l < PAVING_LAYOUTS; l++) {
      expect(pavingGeo(l, 0, false, ['#999999'], 1).tris).toBeLessThanOrEqual(420);
      expect(pavingGeo(l, 0, false, ['#999999'], 0).tris).toBeLessThanOrEqual(60);
    }
    expect(railGeo('balustrade', true, 0, false, 1).tris).toBeLessThanOrEqual(600);
    expect(clutterGeo('ac', true, 0, 1).tris).toBeLessThanOrEqual(700);
  });

  it('a lush lawn tile (no tree) stays within budget at near and mid zoom, High tier', () => {
    const run = (lod: 0 | 1 | 2, dens: number) => {
      const { c, count } = dress(lod, dens);
      let worst = 0;
      let sum = 0;
      for (let i = 0; i < 40; i++) {
        const before = count();
        const t = tile(i * 7 + 1, i * 3 + 2, 3);
        grassTufts(c, t, 3, t.x + 0.5, t.z + 0.5, 0.08);
        flowerDrifts(c, t, 3, t.x + 0.5, t.z + 0.5, 0.08);
        thrivingExtras(c, t, t.x + 0.5, t.z + 0.5, 0.08);
        worst = Math.max(worst, count() - before);
        sum += count() - before;
      }
      return { worst, mean: sum / 40 };
    };
    const near = run(2, 1);
    const mid = run(1, 0.6);
    console.log('lush lawn tile triangles', JSON.stringify({ near, mid }));
    // near zoom shows only a few chunks; flower clumps on leafy mounds (owner review, Look 3.5) raised these
    expect(near.worst, 'near worst').toBeLessThanOrEqual(3000);
    expect(near.mean, 'near mean').toBeLessThanOrEqual(1950);
    expect(mid.worst, 'mid worst').toBeLessThanOrEqual(900);
    expect(mid.mean, 'mid mean').toBeLessThanOrEqual(650);
  });

  it('paving tiles at negative city coordinates build (variants from world coordinates go negative)', () => {
    const { c, count } = dress(2, 1);
    paving(c, tile(-37, -5, 3, 'paving'), true, -36.5, -4.5, 0);
    // dead paving too, every variant (palette lists differ in length since Look 2 took them over)
    const seen: string[] = [];
    const probe: DressCtx = { ...c, lod: 0, b: { ...c.b, add: (_t, hex) => void seen.push(hex) } };
    for (let v = -7; v < 7; v++) paving(probe, { ...tile(-3, v, 0, 'paving'), ground: 'polluted', variant: v } as TileData, false, -2.5, v + 0.5, 0);
    expect(seen.every((h) => typeof h === 'string')).toBe(true);
    expect(count()).toBeGreaterThan(0);
    expect(bannerGeo('pole', true, -41, 1).tris).toBeGreaterThan(0);
    expect(railGeo('pipe', false, -3, true, 1).tris).toBeGreaterThan(0);
    expect(vineGeo(0, 0.3, -7, 1).tris).toBeGreaterThan(0);
  });
});
