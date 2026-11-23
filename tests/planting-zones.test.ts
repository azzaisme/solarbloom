import { describe, expect, it } from 'vitest';
import { PLANTING_ZONES, ZONE_DENSITY, zoneAt, type PlantingZone, type ZoneCtx } from '../src/rendering/PlantingZones';
import type { TileData } from '../src/core/types';
import { zonedPlanting, zoneOf, type DressCtx } from '../src/rendering/Surfaces';

type T = Pick<TileData, 'feature' | 'blocked' | 'occupantId'>;

/**
 * A representative restored park, 64×64 from (ox, oz): lawn with a winding paved path every ~11 rows and a cross
 * path, a canal along one side, a 2×2 landmark and two machines.
 */
function park(ox = 0, oz = 0, areaType = 'park') {
  const cells = new Map<string, T>();
  for (let z = oz - 4; z < oz + 68; z++)
    for (let x = ox - 4; x < ox + 68; x++) {
      const lx = x - ox, lz = z - oz;
      let feature: TileData['feature'] = 'lawn';
      if (lz % 11 === 5 + (Math.floor(lx / 9) % 2)) feature = 'paving';
      if (lx === 30) feature = 'paving';
      if (lx >= 60 && lx <= 62) feature = 'water';
      cells.set(`${x},${z}`, { feature, blocked: false });
    }
  for (const [mx, mz] of [[12, 22], [44, 40]]) cells.set(`${ox + mx},${oz + mz}`, { feature: 'lawn', blocked: false, occupantId: 'm' });
  const ctx: ZoneCtx = { peek: (x, z) => cells.get(`${x},${z}`), areaAt: () => 'a', areaType, landmark: [ox + 20, oz + 30] };
  return { cells, ctx };
}

function shares(ox: number, oz: number, areaType = 'park') {
  const { cells, ctx } = park(ox, oz, areaType);
  const n: Record<string, number> = {};
  let total = 0;
  for (let z = oz; z < oz + 64; z++)
    for (let x = ox; x < ox + 64; x++) {
      const t = cells.get(`${x},${z}`)!;
      if (t.feature !== 'lawn' || t.occupantId) continue;
      const zone = zoneAt(x, z, ctx);
      n[zone] = (n[zone] ?? 0) + 1;
      n[ZONE_DENSITY[zone]] = (n[ZONE_DENSITY[zone]] ?? 0) + 1;
      total++;
    }
  for (const k of Object.keys(n)) n[k] /= total;
  return n;
}

describe('P7-E28 planting zones', () => {
  it('is a pure function of the cell: the same answer every call, in any order', () => {
    const { ctx } = park();
    const a: PlantingZone[] = [], b: PlantingZone[] = [];
    for (let i = 0; i < 400; i++) a.push(zoneAt(i % 64, Math.floor(i / 64) * 7, ctx));
    for (let i = 399; i >= 0; i--) b.unshift(zoneAt(i % 64, Math.floor(i / 64) * 7, ctx));
    expect(a).toEqual(b);
  });

  it('roughly 50% calm, 30% moderate, 20% dense in a representative park (several places)', () => {
    for (const [ox, oz] of [[0, 0], [160, -96], [-320, 448], [1024, 64]]) {
      const s = shares(ox, oz);
      console.log('zone shares', ox, oz, JSON.stringify(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.round(v * 100)]))));
      expect(s.calm, 'calm').toBeGreaterThan(0.4);
      expect(s.calm, 'calm').toBeLessThan(0.62);
      expect(s.moderate, 'moderate').toBeGreaterThan(0.2);
      expect(s.moderate, 'moderate').toBeLessThan(0.4);
      expect(s.dense, 'dense').toBeGreaterThan(0.12);
      expect(s.dense, 'dense').toBeLessThan(0.28);
    }
  });

  it('keeps the landmark and machines clear, rings them with beds, and lines water and paths', () => {
    const { ctx } = park();
    expect(zoneAt(19, 30, ctx)).toBe('landmark_clearance');
    expect(zoneAt(22, 32, ctx)).toBe('landmark_clearance');
    expect(zoneAt(11, 23, ctx)).toBe('landmark_clearance');
    expect(zoneAt(18, 33, ctx)).toBe('flower_garden');
    expect(zoneAt(59, 3, ctx)).toBe('shoreline');
    expect(zoneAt(29, 2, ctx)).toBe('path_edge');
    expect(zoneAt(30, 2, ctx)).toBe('path_edge'); // the path itself
    expect(zoneAt(61, 2, ctx)).toBe('shoreline'); // the water itself
  });

  it('ignoreOccupants: a machine changes no zone (for trees), but the landmark and paths still count', () => {
    const { ctx } = park();
    const still = { ...ctx, ignoreOccupants: true };
    expect(zoneAt(11, 23, ctx)).toBe('landmark_clearance');
    expect(zoneAt(11, 23, still)).not.toBe('landmark_clearance');
    expect(zoneAt(12, 22, still)).not.toBe('landmark_clearance'); // the machine's own cell
    expect(zoneAt(19, 30, still)).toBe('landmark_clearance');
    expect(zoneAt(29, 2, still)).toBe('path_edge');
  });

  it('groves are woodland; every zone shows up somewhere', () => {
    const { ctx } = park(0, 0, 'grove');
    expect(zoneAt(40, 2, ctx)).toBe('woodland_understory');
    const seen = new Set<PlantingZone>();
    const p = park().ctx;
    for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) seen.add(zoneAt(x, z, p));
    for (const zn of PLANTING_ZONES) expect(seen.has(zn), zn).toBe(true);
  });
});

describe('P7-E28 zoned planting', () => {
  // a recording dressing context over the sample park: every piece placed, in order
  const record = (stage: number) => {
    const { cells, ctx } = park();
    const log: string[] = [];
    let flowers = 0;
    const r = (v: number) => v.toFixed(4);
    const c: DressCtx = {
      b: { grey: 0, add: (type, hex, p) => log.push(`b ${type} ${hex} ${p.map(r)}`), addGeo: () => log.push('geo'), quad: () => log.push('quad') },
      fb: {
        add: (g, x, y, z, rot, s) => {
          log.push(`f ${g.tris} ${r(x)} ${r(y)} ${r(z)} ${r(rot)} ${r(s)}`);
          if (g.tris > 60) flowers++;
        },
      },
      dens: 1,
      lod: 2,
      area: 'a',
      areaType: 'park',
      level: 4,
      landmark: ctx.landmark,
      peek: (x, z) => ({ ...(cells.get(`${x},${z}`) ?? { feature: 'lawn', blocked: false }), x, z, ground: 'restored', bloom: stage, variant: x * 31 + z * 17, pollution: 0, id: '', roofId: '0', growthRemainingSec: 0 }) as TileData,
      areaAt: () => 'a',
    };
    const perZone: Record<string, number[]> = {};
    for (let z = 0; z < 64; z++)
      for (let x = 0; x < 64; x++) {
        const t = c.peek(x, z)!;
        if (t.feature !== 'lawn' || t.occupantId) continue;
        const zone = zoneOf(c, x, z);
        const before = flowers;
        zonedPlanting(c, t, stage, x + 0.5, z + 0.5, 0.08, zone);
        (perZone[zone] ??= []).push(flowers - before);
      }
    return { log, perZone };
  };

  it('a rebuild draws exactly the same plants (deterministic, nothing saved)', () => {
    expect(record(3).log).toEqual(record(3).log);
    expect(record(1).log).toEqual(record(1).log);
  });

  it('stages 1–2 are mostly grass; gardens fill in by Thriving while open lawn stays calm', () => {
    const avg = (a: number[] = []) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    const s1 = record(1).perZone, s3 = record(3).perZone;
    const all1 = Object.values(s1).flat();
    expect(avg(all1)).toBeLessThan(0.6);
    expect(avg(s3.flower_garden)).toBeGreaterThan(4);
    expect(avg(s3.open_lawn)).toBeLessThan(0.8);
    expect(avg(s3.landmark_clearance)).toBeLessThan(0.8);
    expect(avg(s3.meadow)).toBeGreaterThan(avg(s3.open_lawn));
    expect(avg(s3.flower_garden)).toBeGreaterThan(avg(s3.meadow));
  });
});
