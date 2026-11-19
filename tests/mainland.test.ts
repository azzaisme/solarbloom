import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { areaMapFor } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { canStep, levelAt } from '../src/core/Height';
import { brokenCells, chunkPiles, isMainlandArea, landingArea, mainlandType } from '../src/core/Mainland';
import { pileById, seaCell, setPieceAt } from '../src/core/OldCityLayout';
import { MAINLAND } from '../src/data/mainland';
import { OLD_CITY } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';

/** E23.8.3.1 (#451): the endless mainland past the Long Causeway, generated deterministically and streamed in. */

SaveService.clock = () => 0;
const saver = new SaveService(undefined);

const sim = (seed = 7) => new Sim(createInitialState(seed));
const C = MAINLAND.causeway;

describe('E23.8.3.1: mainland layout', () => {
  it('every chunk from x = 9 east is mainland, in 2 × 2 districts; the chunks between are still sea', () => {
    const map = areaMapFor(7, 5);
    expect(map.areaOfChunk(9, 0)).toBe(landingArea());
    expect(isMainlandArea(map.areaOfChunk(9, 0))).toBe(true);
    expect(map.areaOfChunk(9, 0)).toBe(map.areaOfChunk(9, 1));
    expect(isMainlandArea(map.areaOfChunk(500, -900))).toBe(true);
    expect(map.areaOfChunk(8, 0)).toBe('out_8_0');
    expect(map.areaOfChunk(7, 0)).toBe('out_7_0');
    const info = map.info(map.areaOfChunk(40, 40));
    expect(info.chunks.length).toBe(4);
    expect(info.noLandmark).toBe(true);
  });

  it('district types vary but are the same in every game, and the landing is a street', () => {
    expect(mainlandType(landingArea())).toBe('street');
    const types = new Set<string>();
    for (let i = 5; i < 60; i++) types.add(mainlandType(`ml_${i}_${i % 7}`));
    expect(types.size).toBeGreaterThan(3);
    expect(types.has('downtown')).toBe(true); // the industrial ruins
    expect(areaMapFor(1, 5).info('ml_20_3').type).toBe(areaMapFor(99, 5).info('ml_20_3').type);
  });

  it('the causeway is road over the sea at the base level, the shore is sea, the mainland is land', () => {
    expect(seaCell(130, C.z0 - 1)).toBe(true);
    for (let x = C.x0; x <= C.x1; x++) {
      expect(seaCell(x, C.z0), `x ${x}`).toBe(false);
      const broken = x >= MAINLAND.broken.x0 && x <= MAINLAND.broken.x1;
      const ramp = (x >= MAINLAND.broken.x0 - MAINLAND.rampLength && x < MAINLAND.broken.x0) || (x > MAINLAND.broken.x1 && x <= MAINLAND.broken.x1 + MAINLAND.rampLength);
      if (broken) expect(levelAt(x, C.z1)).toBe(OLD_CITY.seaLevel);
      else if (!ramp) expect(levelAt(x, C.z1)).toBe(OLD_CITY.baseLevel);
    }
    // by height, bloombot can walk the whole causeway: island avenue, ramp down, the low middle, ramp up, the mainland
    for (let x = C.x0 - 3; x < C.x1 + 3; x++) for (const z of [C.z0, C.z1]) expect(canStep(x, z, x + 1, z), `step ${x} → ${x + 1} on row ${z}`).toBe(true);
    expect(canStep(130, C.z0, 130, C.z0 - 1)).toBe(false); // and never off its side into the sea
    expect(seaCell(MAINLAND.minChunkX * 16, 40)).toBe(true); // the rocky shore
    expect(seaCell(MAINLAND.minChunkX * 16 + 5, 40)).toBe(false);
    expect(levelAt(400, -300)).toBe(OLD_CITY.baseLevel);
  });

  it('salvage fields: deterministic piles, found by cell and by id, never on avenues, the causeway or the shore', () => {
    let fields = 0;
    for (let cx = 9; cx < 30; cx++)
      for (let cz = -10; cz < 10; cz++) {
        const ps = chunkPiles(cx, cz);
        if (ps.size) fields++;
        for (const p of ps.values()) {
          const lx = p.x - cx * 16;
          const lz = p.z - cz * 16;
          expect([7, 8]).not.toContain(lx);
          expect([7, 8]).not.toContain(lz);
          expect(seaCell(p.x, p.z)).toBe(false);
          const sp = setPieceAt(p.x, p.z);
          expect(sp?.kind === 'pile' && sp.pile.id).toBe(p.id);
          expect(pileById(p.id)).toEqual(p);
        }
      }
    expect(fields).toBeGreaterThan(50);
  });
});

describe('E23.8.3.1: mainland generation and the Great Bloom', () => {
  // E23.1.5: nothing is ever bought; the mainland is never sealed either

  it('the same tiles whatever order the chunks stream in', () => {
    const cells: [number, number][] = [];
    for (let i = 0; i < 400; i++) cells.push([140 + ((i * 37) % 300), -150 + ((i * 53) % 300)]);
    const a = sim();
    const b = sim();
    const fromA = cells.map(([x, z]) => a.grid.get(GROUND, x, z));
    const fromB = [...cells].reverse().map(([x, z]) => b.grid.get(GROUND, x, z)).reverse();
    for (let i = 0; i < cells.length; i++) {
      const [p, q] = [fromA[i]!, fromB[i]!];
      expect([q.feature, q.blocked, q.prop, q.pollution, q.level]).toEqual([p.feature, p.blocked, p.prop, p.pollution, p.level]);
    }
  });

  it('mainland ground is restorable dead ground with roads, buildings and piles, not sea', () => {
    const s = sim();
    const feats = new Map<string, number>();
    for (let z = -64; z < 64; z++)
      for (let x = 150; x < 260; x++) {
        const t = s.grid.get(GROUND, x, z)!;
        feats.set(t.feature ?? '-', (feats.get(t.feature ?? '-') ?? 0) + 1);
      }
    expect(feats.get('water') ?? 0).toBe(0);
    expect(feats.get('road') ?? 0).toBeGreaterThan(500);
    expect(feats.get('building') ?? 0).toBeGreaterThan(50);
    expect((feats.get('obstacle') ?? 0)).toBeGreaterThan(20);
  });

  it('the causeway is broken and the mainland hidden until the Great Bloom raises it', () => {
    const s = sim();
    for (const [x, z] of brokenCells()) expect(s.grid.get(GROUND, x, z)!.blocked).toBe(true);
    expect(s.grid.get(GROUND, C.x0 + 2, C.z0)!.blocked).toBe(false);
    expect(s.areas.fog(landingArea())).toBe('hidden');
    s.state.salvage!.tier = MAINLAND.opensAtTier;
    s.bus.emit('fountain.tier', { tier: MAINLAND.opensAtTier });
    for (const [x, z] of brokenCells()) expect(s.grid.get(GROUND, x, z)!.blocked).toBe(false);
    expect(s.mainland.opened).toBe(true);
    expect(s.areas.fog(landingArea())).toBe('frontier');
    expect(s.areas.sealed(landingArea())).toBe(false);
    expect(s.areas.fog('ml_8_0')).toBe('hidden'); // the rest is found by restoring outward
  });

  it('a raised causeway survives a save and load', () => {
    const s = sim();
    s.state.salvage!.tier = MAINLAND.opensAtTier;
    s.mainland.open();
    const back = new Sim(saver.deserialize(saver.serialize(s.state))!);
    for (const [x, z] of brokenCells()) expect(back.grid.get(GROUND, x, z)!.blocked).toBe(false);
    expect(back.areas.fog(landingArea())).toBe('frontier');
  });

  it('restoring a mainland district reveals its neighbours, unsealed', () => {
    const s = sim();
    s.state.salvage!.tier = MAINLAND.opensAtTier;
    s.mainland.open();
    expect(s.areas.clear(landingArea(), true)).toBe(true);
    const nbs = s.areas.info(landingArea()).neighbours.filter(isMainlandArea);
    expect(nbs.length).toBeGreaterThan(1);
    for (const nb of nbs) {
      expect(s.areas.fog(nb)).toBe('frontier');
      expect(s.areas.sealed(nb)).toBe(false);
    }
  });
});
