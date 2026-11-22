// E28.W04 (#697): living water. Lily pads, fish, floating leaves, drifting flecks, plants and an outlet, placed by
// how restored the shore is and drawn round the camera (WaterLife). Gameplay, saves and the grid never see any of it.
import * as pc from 'playcanvas';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { CHUNK } from '../src/core/Hash';
import { seaCell, surfCell } from '../src/core/OldCityLayout';
import { LOOK } from '../src/data/look';
import { Sim } from '../src/gameplay/Sim';
import { ChunkRenderer } from '../src/rendering/ChunkRenderer';
import {
  clearWaterLife,
  fishAt,
  fishRise,
  fleckAt,
  leafAt,
  LIFE_KINDS,
  type LifeSpot,
  type LifeTile,
  lifeForTile,
  lilyPatch,
  nearestLife,
  outletSpots,
  placeMatrix,
  resetWaterLife,
  setWaterLife,
  waterLifeCount,
} from '../src/rendering/WaterLife';

const L = LOOK.waterLife;

/** A tile of a wide pond whose banks are at x = 0 and x = 20 (z runs on): distance to land is to the nearer bank. */
function pondTile(x: number, z: number, over: Partial<LifeTile> = {}): LifeTile {
  return { x, z, y: 0.2, fresh: true, living: true, bloom: 4, covered: true, dist: (px) => Math.max(0, Math.min(px, 20 - px)), t0: -1e9, d: 1, ...over };
}

/** Life over a strip of tiles across the pond, `rows` deep. */
function strip(rows: number, over: Partial<LifeTile> = {}) {
  const out: LifeSpot[] = [];
  for (let z = 0; z < rows; z++) for (let x = 0; x < 20; x++) out.push(...lifeForTile(pondTile(x, z, over)));
  return out;
}

const big = { pad: 1e4, flower: 1e4, leaf: 1e4, fish: 1e4, fleck: 1e4, plant: 1e4, fall: 1e4, foam: 1e4, outlet: 1e4 };

describe('LOOK.waterLife', () => {
  it('keeps every kind small, sparse and soft', () => {
    for (const k of ['pad', 'flower', 'leaf', 'fish', 'fleck', 'plant', 'fall', 'foam', 'outlet'] as const) expect(L.max[k]).toBeGreaterThan(0);
    expect(L.radius).toBeGreaterThan(8);
    expect(L.pads.size[0]).toBeLessThan(L.pads.size[1]);
    expect(L.pads.size[1]).toBeLessThan(0.5);
    expect(L.pads.patches).toBeGreaterThan(0);
    expect(L.pads.patches).toBeLessThan(1);
    for (const c of [L.fish, L.leaves, L.flecks, L.plants]) {
      expect(c.chance).toBeGreaterThan(0);
      // even at full bloom no kind is on more than a third of the tiles
      expect(c.chance + c.perBloom * 4).toBeLessThan(0.34);
    }
    expect(L.fish.opacity).toBeLessThan(0.5);
    // no neon: fish and flecks fade at night rather than glow
    expect(L.fish.nightOpacity).toBeLessThan(L.fish.opacity);
    expect(L.flecks.nightOpacity).toBeLessThan(L.flecks.opacity);
    expect(L.falls.opacity).toBeLessThan(1);
    // the falls darken by night: their night colour is well under their day colour, and bluer than it is red
    const lum = (hex: string) => [1, 3, 5].reduce((a, i) => a + parseInt(hex.slice(i, i + 2), 16), 0) / 3;
    expect(lum(L.falls.night)).toBeLessThan(lum(L.falls.colour) * 0.5);
    expect(parseInt(L.falls.night.slice(5, 7), 16)).toBeGreaterThan(parseInt(L.falls.night.slice(1, 3), 16));
    expect(L.fish.minDepth).toBeGreaterThan(0.2 + 0.12);
    for (const hex of [...L.pads.colours, L.pads.vein, L.pads.flower, L.pads.flowerCore, L.fish.colour, ...L.leaves.colours, L.flecks.colour, L.plants.stalk, L.plants.leaf, L.falls.colour, L.falls.night, L.falls.stone, L.falls.mouth])
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('the life on a tile', () => {
  it('none on water that is not living, or whose bed is bared', () => {
    for (let x = 0; x < 20; x++) {
      expect(lifeForTile(pondTile(x, 3, { living: false }))).toEqual([]);
      expect(lifeForTile(pondTile(x, 3, { covered: false }))).toEqual([]);
    }
  });

  it('is the same every build', () => {
    expect(lifeForTile(pondTile(4, 7))).toEqual(lifeForTile(pondTile(4, 7)));
  });

  it('lily pads only on fresh water, in patches near a bank, never on the land; their flowers on pads', () => {
    const life = strip(40);
    const pads = life.filter((s) => s.kind === 'pad0' || s.kind === 'pad1');
    expect(pads.length).toBeGreaterThan(20);
    for (const p of pads) {
      const d = Math.min(p.x, 20 - p.x);
      expect(d).toBeGreaterThanOrEqual(p.size * 0.5 - 1e-9);
      expect(d).toBeLessThanOrEqual(L.pads.reach + 1e-9);
      expect(lilyPatch(Math.floor(p.x) + 0.5, Math.floor(p.z) + 0.5)).toBeGreaterThan(1 - L.pads.patches);
    }
    // patches: some stretches of bank have none
    const rowsWith = new Set(pads.map((p) => Math.floor(p.z)));
    expect(rowsWith.size).toBeLessThan(40);
    for (const f of life.filter((s) => s.kind === 'flower')) expect(pads.some((p) => p.x === f.x && p.z === f.z)).toBe(true);
    // the sea grows none
    const sea = strip(40, { fresh: false });
    expect(sea.some((s) => s.kind === 'pad0' || s.kind === 'pad1' || s.kind === 'flower' || s.kind === 'plant')).toBe(false);
    expect(sea.some((s) => s.kind === 'fish')).toBe(true);
  });

  it('more of it as the shore blooms', () => {
    const count = (bloom: number) => strip(60, { bloom }).length;
    expect(count(4)).toBeGreaterThan(count(0) * 1.3);
    expect(strip(60, { bloom: 0 }).some((s) => s.kind === 'flower')).toBe(false);
  });

  it("a fish's loop (shoal-mates too) never reaches the land; leaves and flecks keep off it as well", () => {
    const life = strip(40);
    const fish = life.filter((s) => s.kind === 'fish');
    expect(fish.length).toBeGreaterThan(5);
    const bank = (x: number) => Math.min(x, 20 - x);
    for (const s of fish)
      for (let t = 0; t < 120; t += 0.7) {
        const p = fishAt(s, t);
        expect(bank(p.x)).toBeGreaterThan(0.05);
      }
    for (const s of life.filter((q) => q.kind === 'leaf0' || q.kind === 'leaf1'))
      for (let t = 0; t < 120; t += 1.3) {
        const p = leafAt(s, t);
        expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeLessThanOrEqual(s.range + 1e-9);
        expect(bank(p.x)).toBeGreaterThan(0.05);
      }
    for (const s of life.filter((q) => q.kind === 'fleck'))
      for (let t = 0; t < 120; t += 0.9) {
        const p = fleckAt(s, t);
        expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeLessThanOrEqual(s.range + 1e-9);
        expect(p.k).toBeGreaterThanOrEqual(0);
        expect(p.k).toBeLessThanOrEqual(1);
        expect(bank(p.x)).toBeGreaterThan(0.05);
      }
  });

  it('finds fish in a narrow canal too (its open water runs along a tile edge)', () => {
    // a canal two tiles wide, x 0 … 2, its banks pulled in a little
    let fish = 0;
    for (let z = 0; z < 80; z++)
      for (const x of [0, 1]) fish += lifeForTile(pondTile(x, z, { dist: (px) => Math.max(0, Math.min(px, 2 - px) - 0.4) })).filter((s) => s.kind === 'fish').length;
    expect(fish).toBeGreaterThan(0);
  });

  it('a fish rises now and then, for one ring', () => {
    const [s] = strip(40).filter((q) => q.kind === 'fish');
    const ring = 1 / LOOK.water.disturb.rate;
    let rising = 0;
    for (let t = 0; t < 200; t += 0.25) {
      const r = fishRise(s, t);
      if (r === undefined) continue;
      rising++;
      expect(r).toBeLessThanOrEqual(t);
      expect(t - r).toBeLessThan(ring);
    }
    expect(rising).toBeGreaterThan(0);
    // most of the time it is not
    expect(rising).toBeLessThan(800 * 0.5);
  });
});

describe('an outlet', () => {
  it('none where the ground above is barely higher', () => {
    expect(outletSpots(0, 0, 0, 0, 0.2, 0, 1)).toEqual([]);
  });

  it('a culvert and its stream in the wall, the foam out on the water the way it lies', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const s = outletSpots(5, 5, 0.3, yaw, 1.2, 0, 1);
      expect(s.map((q) => q.kind).sort()).toEqual(['fall', 'foam', 'outlet']);
      const foam = s.find((q) => q.kind === 'foam')!;
      expect(foam.x - 5).toBeCloseTo(Math.cos(yaw) * L.falls.lip);
      expect(foam.z - 5).toBeCloseTo(-Math.sin(yaw) * L.falls.lip);
      for (const q of s.filter((k) => k.kind !== 'foam')) {
        expect(q.x).toBe(5);
        expect(q.range).toBeLessThanOrEqual(L.falls.outlet);
      }
    }
  });
});

describe('the sources and what is drawn', () => {
  beforeEach(() => resetWaterLife());

  it('each chunk replaces only its own life; nearest first, at most the cap of each kind', () => {
    const a = strip(4);
    setWaterLife('life:a', a);
    setWaterLife('life:b', strip(2).map((s) => ({ ...s, z: s.z + 100 })));
    expect(waterLifeCount()).toBe(a.length + strip(2).length);
    clearWaterLife('life:b');
    expect(waterLifeCount()).toBe(a.length);
    const all = nearestLife(10, 2, 50, big);
    expect([...all.keys()]).toEqual([...LIFE_KINDS]);
    const capped = nearestLife(10, 2, 50, { ...big, pad: 3 });
    for (const k of ['pad0', 'pad1'] as const) {
      const got = capped.get(k)!;
      expect(got.length).toBe(Math.min(3, all.get(k)!.length));
      const d = (s: LifeSpot) => Math.hypot(s.x - 10, s.z - 2);
      const rest = all.get(k)!.filter((s) => !got.includes(s));
      for (const s of rest) expect(d(s)).toBeGreaterThanOrEqual(Math.max(...got.map(d)) - 1e-9);
    }
    expect(nearestLife(500, 500, 5, big).get('fish')).toEqual([]);
  });

  it('places an instance: turned about y, scaled, then moved', () => {
    const m = new Float32Array(32);
    placeMatrix(m, 16, 1, 2, 3, Math.PI / 2, 2, 3, 4);
    const mat = new pc.Mat4();
    mat.set(Array.from(m.subarray(16)));
    const p = mat.transformPoint(new pc.Vec3(1, 1, 0));
    // x scales by 2 then turns a quarter: (2, 3, 0) → (0, 3, -2), then moves
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(5);
    expect(p.z).toBeCloseTo(1);
  });
});

describe('the chunks feed it from the real world', () => {
  type R = { band: number; detail: string; farFrom: number; life: LifeSpot[]; buildGround(v: unknown): Generator<void> };

  function build(restore: boolean) {
    resetWaterLife();
    const sim = new Sim(createInitialState(7));
    sim.areas.fog = () => 'cleared';
    if (restore)
      for (let z = 4; z < 44; z++)
        for (let x = -12; x < 10; x++) {
          const t = sim.grid.get(GROUND, x, z);
          if (!t || t.feature === 'water' || t.blocked || t.occupantId || t.ramp) continue;
          t.ground = 'restored';
          t.bloom = 4;
          t.pollution = 0;
        }
    const r = new ChunkRenderer(sim, new pc.Entity(), {} as pc.GraphicsDevice) as unknown as R;
    r.band = 2;
    r.detail = 'high';
    r.farFrom = Infinity;
    // each chunk's life, read off the builder (a test has no GPU, so the build stops at its upload before handing it on)
    const all: LifeSpot[] = [];
    for (let cx = -1; cx <= 0; cx++)
      for (let cz = 0; cz <= 2; cz++) {
        const gen = r.buildGround({ key: `${GROUND}:${cx}:${cz}`, cx, cz, dirty: true, fogDirty: true });
        try {
          for (let k = 0; k < CHUNK * CHUNK * 4 && !gen.next().done; k++);
        } catch {
          /* the GPU upload */
        }
        all.push(...r.life);
      }
    setWaterLife('test', all);
    return nearestLife(-2, 26, 40, big);
  }

  afterAll(() => resetWaterLife());

  it('the canal under a dead shore has none', () => {
    const life = build(false);
    const near = [...life.values()].flat().filter((s) => s.x > -4 && s.x < -1 && s.z > 14 && s.z < 36);
    expect(near).toEqual([]);
  });

  it("restored, the canal lives: pads and fish, none on the sea; an outlet only at the canal's head", () => {
    const life = build(true);
    const canal = (s: LifeSpot) => s.x > -4 && s.x < -1 && s.z > 14 && s.z < 36;
    const pads = [...life.get('pad0')!, ...life.get('pad1')!];
    expect(pads.filter(canal).length).toBeGreaterThan(5);
    for (const p of pads) expect(seaCell(Math.floor(p.x), Math.floor(p.z)) || surfCell(Math.floor(p.x), Math.floor(p.z))).toBe(false);
    expect(life.get('fish')!.filter(canal).length).toBeGreaterThan(0);
    const outlets = life.get('outlet')!;
    expect(outlets.length).toBeGreaterThan(0);
    for (const o of outlets) {
      expect(o.x).toBeGreaterThan(-3.01);
      expect(o.x).toBeLessThan(-0.99);
      expect(Math.abs(o.z - 16)).toBeLessThan(0.01);
    }
    expect(life.get('fall')!.length).toBe(outlets.length);
    expect(life.get('foam')!.length).toBe(outlets.length);
  });
});
