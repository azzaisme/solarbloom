import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';

// Saves stamp the wall clock (Phase 4 offline progress); fix it so saves compare byte for byte.
SaveService.clock = () => 0;
import { CHUNK } from '../src/core/Generation';
import { GROUND } from '../src/core/GameState';
import { packChunk } from '../src/core/TilePack';
import { Sim } from '../src/gameplay/Sim';
import { fill, ground, makeSim, rich } from './helpers';

const saver = new SaveService(undefined);
const tilesOfSave = (json: string) => (JSON.parse(json) as { tiles: Record<string, string> }).tiles;

describe('save v4: tile deltas (City 02.2)', () => {
  it('an untouched world saves no tiles at all', () => {
    const sim = makeSim(3);
    for (let x = -50; x < 50; x += 5) sim.grid.get(GROUND, x, -x); // generated, never changed
    expect(tilesOfSave(saver.serialize(sim.state))).toEqual({});
  });

  it('a fully restored chunk stays within its byte budget', () => {
    const sim = makeSim(3);
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    const packed = Object.values(tilesOfSave(saver.serialize(sim.state)));
    expect(packed).toHaveLength(1);
    expect(packed[0].length).toBeLessThanOrEqual(CHUNK * CHUNK * 4 + 64);
  });

  it('only chunks touched since the last save are re-packed, with the same result as a full re-pack', () => {
    const sim = makeSim(6);
    rich(sim);
    for (let i = 0; i < 300; i++) {
      if (i % 5 === 0) {
        const t = sim.grid.playableTiles().find((x) => sim.restoration.checkPulse(x).ok);
        if (t) sim.restoration.pulse(t.id);
      }
      sim.tick();
    }
    const incremental = saver.serialize(sim.state);
    for (const c of sim.grid.loadedChunks()) c.dirty = true;
    expect(saver.serialize(sim.state)).toBe(incremental);
    for (const c of sim.grid.loadedChunks()) expect(c.packed).toBe(packChunk(c, sim.grid.seed, sim.grid.layer(c.layer)!));
  });
});

describe('save v4: round trips (City 02.3)', () => {
  it('save → load → save is byte-identical, mid-growth, mid-chain, with lush tiles and drones', () => {
    const sim = makeSim(11);
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'prepared');
    ground(sim, 'r1', 5, 5, 'restored');
    sim.build.place('pollinator', 'r1', 5, 5);
    ground(sim, 'r1', 1, 3, 'restored');
    ground(sim, 'r1', 2, 3, 'restored');
    ground(sim, 'r1', 1, 4, 'restored');
    ground(sim, 'r1', 2, 4, 'restored');
    sim.build.place('droneHub', 'r1', 1, 3);
    sim.restoration.complete(sim.grid.get('r1', 6, 2)!, 'overflow'); // lush
    sim.restoration.pulse('r1:5:4'); // growing
    sim.advance(0.3);
    const a = saver.serialize(sim.state);
    const copy = new Sim(saver.deserialize(a)!);
    const b = saver.serialize(copy.state);
    expect(b).toBe(a);
    // the copy really has the same tiles and occupancy
    for (const l of sim.grid.rooftops)
      for (const t of sim.grid.tilesOf(l.id)) {
        const u = copy.grid.get(l.id, t.x, t.z)!;
        expect([u.ground, u.bloom, u.pollution, u.occupantId, u.lushUntil, u.growSource]).toEqual([t.ground, t.bloom, t.pollution, t.occupantId, t.lushUntil, t.growSource]);
        expect(u.growthRemainingSec).toBeCloseTo(t.growthRemainingSec, 3);
      }
    // and keeps playing the same way: the growing tile finishes
    copy.advance(2);
    expect(copy.grid.get('r1', 5, 4)!.ground).toBe('restored');
  });

  it('ground-layer changes far from the origin survive a reload', () => {
    const sim = makeSim(12);
    const t = sim.grid.get(GROUND, -333, 410)!;
    t.ground = 'restored';
    t.bloom = 3;
    t.pollution = 0;
    sim.grid.touch(t);
    const first = saver.serialize(sim.state);
    const copy = new Sim(saver.deserialize(first)!);
    expect(copy.grid.loadedChunks(GROUND)).toHaveLength(0); // loads lazily…
    expect(saver.serialize(copy.state)).toBe(first); // …and an untouched pending chunk is saved unchanged
    expect(copy.grid.get(GROUND, -333, 410)).toMatchObject({ ground: 'restored', bloom: 3, pollution: 0 });
    expect(copy.grid.get(GROUND, -332, 410)!.ground).toBe(sim.grid.get(GROUND, -332, 410)!.ground);
  });
});

describe('save v4: compression (City 02.4)', () => {
  it('compressed saves decode to the same game, and are smaller', async () => {
    const sim = makeSim(13);
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    const plain = saver.serialize(sim.state);
    const z = await saver.serializeCompressed(sim.state);
    expect(z.startsWith('SB4z:')).toBe(true);
    expect(z.length).toBeLessThan(plain.length);
    expect(await SaveService.decode(z)).toBe(plain);
  });

  it('a storage that refuses writes reports failure instead of throwing', async () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    const s = new SaveService(full);
    const sim = makeSim(14);
    expect(s.save(sim.state)).toBe(false);
    expect(await s.saveCompressed(sim.state)).toBe(false);
  });

  it('loads a compressed save through the async loader', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const s = new SaveService(storage);
    const sim = makeSim(15);
    rich(sim);
    fill(sim, 1, 1, 6, 6, 'restored');
    expect(await s.saveCompressed(sim.state)).toBe(true);
    const r = await s.loadResultAsync();
    expect(r.state).toBeDefined();
    expect(new Sim(r.state!).progression.restoredCount('r1')).toBe(sim.progression.restoredCount('r1'));
  });
});

describe('save v4: lazy city chunks keep producing', () => {
  it('income right after loading matches before saving (estimated until chunks load, then exact)', async () => {
    const { createInitialState, GROUND: G } = await import('../src/core/GameState');
    const sim = new Sim(createInitialState(21));
    for (let cx = 2; cx < 6; cx++) {
      const c = sim.grid.chunkAt(G, cx, 3)!;
      for (const t of c.tiles) {
        if (!t || t.blocked) continue;
        t.ground = 'restored';
        t.bloom = 1 + (t.variant % 3);
        t.pollution = 0;
        sim.grid.touch(t);
      }
    }
    sim.production.markDirty();
    const before = sim.production.rates().biomass;
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.grid.loadedChunks(G).length).toBeLessThan(sim.grid.loadedChunks(G).length); // lazy
    const est = copy.production.rates().biomass;
    expect(est).toBeGreaterThan(before * 0.9);
    expect(est).toBeLessThan(before * 1.1);
    for (let cx = 2; cx < 6; cx++) copy.grid.chunkAt(G, cx, 3);
    expect(copy.production.rates().biomass).toBeCloseTo(before, 6);
  });
});
