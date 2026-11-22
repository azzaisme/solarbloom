// E28.W03 (#696): where the decks, piers and causeways meet the water.
import * as pc from 'playcanvas';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { SolidCollector } from '../src/core/Solids';
import { CHUNK } from '../src/core/Hash';
import { onJetty, seaCell } from '../src/core/OldCityLayout';
import type { TileData } from '../src/core/types';
import { LOOK } from '../src/data/look';
import { MOVE_LAND } from '../src/data/moveSpots';
import { LANDING } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { deckShade, JETTY_MODEL_POSTS, jettyDeck, jettyLandEnd, jettyPosts, plankPost, wetLine, type Post, type Rect } from '../src/rendering/Bridges';
import { ChunkRenderer } from '../src/rendering/ChunkRenderer';
import { oldCityModel } from '../src/rendering/Models';
import type { BankGeo } from '../src/rendering/Shore';

const B = LOOK.bridge;
const J = LANDING.jetty;

describe('#696: the bridge look values (LOOK.bridge)', () => {
  it('are named and in range', () => {
    expect(B.shade).toBeGreaterThan(0);
    expect(B.shade).toBeLessThan(0.8); // shaded, never black
    expect(B.soft).toBeGreaterThan(0);
    expect(B.soft).toBeLessThan(0.5);
    expect(B.sleeve.height).toBeGreaterThan(0);
    expect(B.sleeve.sink).toBeGreaterThan(0);
    expect(B.sleeve.grow).toBeGreaterThan(0);
    expect(B.sleeve.weedHeight).toBeLessThan(B.sleeve.height);
    expect(B.sill.stones).toBeGreaterThanOrEqual(1);
    expect(B.sill.colours.length).toBeGreaterThan(1);
    expect(B.stringer.apart).toBeLessThan(0.5);
    expect(B.wall.min).toBeGreaterThan(0);
    expect(B.wall.max).toBeGreaterThan(B.wall.min);
    expect(B.wall.max).toBeLessThan(0.3);
    expect(B.wall.pieces).toBeGreaterThanOrEqual(2);
    expect(B.wall.wet).toHaveLength(2);
    expect(B.wall.weed).toHaveLength(2);
    for (const hex of [B.sleeve.wet, B.sleeve.weed, ...B.sill.colours, ...B.wall.wet, ...B.wall.weed]) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('#696: the jetty', () => {
  for (const model of [true, false]) {
    it(`its posts (${model ? 'the model' : 'the planks'}) stand in the water under its deck, on its own tiles`, () => {
      const posts = jettyPosts(model);
      expect(posts.length).toBe(model ? JETTY_MODEL_POSTS.length : 2 * J.d);
      const deck = jettyDeck(model);
      for (const p of posts) {
        expect(onJetty(Math.floor(p.x), Math.floor(p.z))).toBe(true);
        // (the model's land-end post stands right at the end of its deck, a little past it)
        expect(p.x).toBeGreaterThan(deck.x0);
        expect(p.x).toBeLessThan(deck.x1);
        expect(p.z).toBeGreaterThan(deck.z0);
        expect(p.z).toBeLessThan(deck.z1);
        expect(p.r).toBeGreaterThan(0.02);
        expect(p.r).toBeLessThan(0.25);
      }
    });

    it(`its deck (${model ? 'the model' : 'the planks'}) runs the jetty's length out to sea and keeps to its tiles`, () => {
      const d = jettyDeck(model);
      expect(d.x0).toBeGreaterThanOrEqual(J.x - 1e-9);
      expect(d.x1).toBeLessThanOrEqual(J.x + J.w + 1e-9);
      expect(d.z0).toBeCloseTo(J.z, 9);
      expect(d.z1).toBeCloseTo(J.z + J.d, 9);
    });

    it(`its land end (${model ? 'the model' : 'the planks'}) faces the beach, not the sea`, () => {
      const e = jettyLandEnd(model);
      expect([e.nx, e.nz]).toEqual([0, -1]);
      expect(e.z0).toBeCloseTo(J.z, 9);
      const mx = Math.floor((e.x0 + e.x1) / 2);
      const land = Math.floor(e.z0 + e.nz * 0.5);
      expect(onJetty(mx, land)).toBe(false);
      expect(seaCell(mx, land)).toBe(false);
    });
  }
});

describe('#696: the shade under a deck', () => {
  const deck: Rect = { x0: 0, z0: 0, x1: 2, z1: 1 };
  it('is 1 in the open, 1 - shade under the deck, and fades smoothly across its edge', () => {
    expect(deckShade(5, 5, [deck])).toBe(1);
    expect(deckShade(1, 0.5, [deck])).toBeCloseTo(1 - B.shade, 12);
    expect(deckShade(2 + B.soft, 0.5, [deck])).toBe(1);
    let last = deckShade(2, 0.5, [deck]);
    for (let d = 0.01; d <= B.soft + 0.02; d += 0.01) {
      const k = deckShade(2 + d, 0.5, [deck]);
      expect(k).toBeGreaterThanOrEqual(last - 1e-12);
      expect(k - last).toBeLessThan(0.1); // no step
      last = k;
    }
    expect(deckShade(1, 0.5, [])).toBe(1);
    // two decks overlapping never shade twice
    expect(deckShade(1, 0.5, [deck, deck])).toBeCloseTo(1 - B.shade, 12);
  });
});

describe('#696: the wet line on a wall in the water', () => {
  it('stays between min and max, the same every time, and wanders along a long wall', () => {
    const all: number[] = [];
    for (let i = 0; i < 40; i++) {
      const a = wetLine(110 + i, 6, 1, 0);
      expect(a).toEqual(wetLine(110 + i, 6, 1, 0));
      expect(a).toHaveLength(B.wall.pieces);
      for (const v of a) {
        expect(v).toBeGreaterThanOrEqual(B.wall.min - 1e-12);
        expect(v).toBeLessThanOrEqual(B.wall.max + 1e-12);
      }
      all.push(...a);
    }
    expect(Math.max(...all) - Math.min(...all)).toBeGreaterThan((B.wall.max - B.wall.min) * 0.5);
  });
});

describe('#696: the decks, the pier and the walls in the real chunk builder', () => {
  const sim = new Sim(createInitialState(7));
  sim.areas.fog = () => 'cleared';
  sim.gates.open('g-saltwind', true); // the canal's plank bridge is down
  const pier = MOVE_LAND.find((m) => m.ground === 'pier')!;
  const spots: [number, number][] = [
    [J.x, J.z],
    [J.x, J.z + J.d - 1],
    [-3, 36],
    [pier.x, pier.z],
  ];
  const chunks = [...new Set(spots.map(([x, z]) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`))].map((k) => k.split(',').map(Number) as [number, number]);
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
    postSleeve(b: unknown, p: Post, surf: number): void;
    wallWet(b: unknown, wx: number, wz: number, dx: number, dz: number, ...rest: unknown[]): void;
    deckMeetsWater(b: unknown, t: TileData, h: number, posts: Post[], end: unknown, ...rest: unknown[]): void;
    plankBridge(b: unknown, t: TileData, h: number): void;
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
  /** every bank built, by its tile (so a second build can be compared) */
  const recordBanks = (r: R) => {
    const banks: BankGeo[] = [];
    const shore = r.shore.bind(r);
    r.shore = (b: unknown, ...rest: unknown[]) => {
      const mb = b as { patch: (g: BankGeo) => void };
      const patch = mb.patch.bind(mb);
      mb.patch = (g: BankGeo) => {
        banks.push({ pos: [...g.pos], nrm: [...g.nrm], col: [...g.col], idx: [...g.idx] });
        patch(g);
      };
      try {
        shore(b, ...rest);
      } finally {
        mb.patch = patch;
      }
    };
    return banks;
  };
  const r = make();
  const banks = recordBanks(r);
  const sleeves: Post[] = [];
  const walls: { wx: number; wz: number; dx: number; dz: number }[] = [];
  const ends: { t: TileData; end: unknown }[] = [];
  let depth = 0;
  const solid = { inside: 0, elsewhere: 0 };
  const wrap = <K extends 'postSleeve' | 'wallWet' | 'deckMeetsWater' | 'plankBridge'>(k: K, record: (...a: Parameters<R[K]>) => void) => {
    const f = (r[k] as (...a: unknown[]) => void).bind(r);
    (r as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => {
      record(...(a as Parameters<R[K]>));
      depth++;
      try {
        f(...a);
      } finally {
        depth--;
      }
    };
  };
  wrap('postSleeve', (_b, p) => sleeves.push(p));
  wrap('wallWet', (_b, wx, wz, dx, dz) => walls.push({ wx, wz, dx, dz }));
  wrap('deckMeetsWater', (_b, t, _h, _p, end) => ends.push({ t, end }));
  wrap('plankBridge', () => {});
  const seen = (['prim', 'geo', 'foliage', 'model', 'box'] as const).map((m) =>
    vi.spyOn(SolidCollector.prototype, m).mockImplementation(() => {
      if (depth) solid.inside++;
      else solid.elsewhere++;
    }),
  );
  build(r);
  afterAll(() => {
    for (const s of seen) s.mockRestore();
  });

  it('every post of the jetty and the canal bridge gets one wet sleeve, where it stands', () => {
    const want = [...jettyPosts(oldCityModel('jetty') === 'jetty'), ...[36, 37].flatMap((z) => [plankPost(-3, z), plankPost(-2, z)])];
    const key = (p: Post) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`;
    expect(sleeves.map(key).sort()).toEqual(want.map(key).sort());
  });

  it("the jetty's land end and both ends of the canal bridge get their stones", () => {
    const jettyEnd = ends.filter((e) => e.end && onJetty(e.t.x, e.t.z));
    expect(new Set(jettyEnd.map((e) => e.t.x)).size).toBe(J.w);
    const canal = ends.filter((e) => e.end && e.t.x >= -3 && e.t.x <= -2 && e.t.z >= 36 && e.t.z <= 37);
    // two ends (west, east) on each of its two rows
    expect(canal).toHaveLength(4);
    for (const e of canal) {
      const end = e.end as { x0: number; nx: number };
      expect(end.nx).toBe(end.x0 === -3 ? -1 : 1);
    }
  });

  it('the old pier stands in the sea with a wet line all round', () => {
    const mine = walls.filter((w) => w.wx >= pier.x - 0.01 && w.wx <= pier.x + pier.w + 0.01 && w.wz >= pier.z - 0.01 && w.wz <= pier.z + pier.d + 0.01);
    expect(mine).toHaveLength(2 * (pier.w + pier.d));
  });

  it('the bank under a deck lies in its shade, and nowhere else changes', () => {
    const save = B.shade;
    (B as { shade: number }).shade = 0;
    let plain: BankGeo[];
    try {
      const again = make();
      plain = recordBanks(again);
      build(again);
    } finally {
      (B as { shade: number }).shade = save;
    }
    expect(plain.length).toBe(banks.length);
    let shaded = 0;
    const decks = [jettyDeck(oldCityModel('jetty') === 'jetty'), ...[36, 37].flatMap((z) => [-3, -2].map((x) => ({ x0: x, z0: z + 0.01, x1: x + 1, z1: z + 0.99 })))];
    banks.forEach((g, i) => {
      expect(g.pos).toEqual(plain[i].pos);
      for (let v = 0; v < g.col.length; v += 3) {
        const k = deckShade(g.pos[v], g.pos[v + 2], decks);
        if (k < 1) shaded++;
        expect(g.col[v]).toBeCloseTo(plain[i].col[v] * k, 9);
      }
    });
    expect(shaded).toBeGreaterThan(20);
  });

  it('nothing the game plays on changes: the tiles (paths, collision, saves) and what the line of sight sees', () => {
    expect(JSON.stringify(tiles)).toBe(before);
    expect(solid.elsewhere).toBeGreaterThan(500);
    expect(solid.inside).toBe(0);
  });
});
