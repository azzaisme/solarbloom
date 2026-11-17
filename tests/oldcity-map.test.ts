import { describe, expect, it } from 'vitest';
import { areaMapFor, PARK, SEA } from '../src/core/Areas';
import { createInitialState, GROUND, OLD_CITY_GEN } from '../src/core/GameState';
import { CHUNK } from '../src/core/Generation';
import { KEEPERS, REGIONS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';

const oldSim = (seed = 7) => new Sim(createInitialState(seed, 'oldcity'));

describe('E21.4: the Old City map', () => {
  it('a new Old City game uses generation 5', () => {
    expect(oldSim().grid.layer(GROUND)!.gen).toBe(OLD_CITY_GEN);
  });

  it('the nine regions sit on the chunks in the epic\'s table, each one connected piece', () => {
    const map = areaMapFor(7, OLD_CITY_GEN);
    for (const r of REGIONS) {
      const info = map.info(r.id);
      expect(info.chunks.length, r.id).toBe((r.chunks.x1 - r.chunks.x0 + 1) * (r.chunks.z1 - r.chunks.z0 + 1));
      for (const [cx, cz] of info.chunks) expect(map.areaOfChunk(cx, cz)).toBe(r.id);
      // connected: a flood fill over its chunks reaches them all
      const set = new Set(info.chunks.map(([x, z]) => `${x},${z}`));
      const seen = new Set([[...set][0]]);
      const stack = [[...set][0]];
      while (stack.length) {
        const [x, z] = stack.pop()!.split(',').map(Number);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${x + dx},${z + dz}`;
          if (set.has(k) && !seen.has(k)) seen.add(k), stack.push(k);
        }
      }
      expect(seen.size, r.id).toBe(set.size);
      expect(info.type).toBe(r.type);
      expect(info.landmark).toEqual([r.landmark.x, r.landmark.z]);
    }
    // the pinwheel: the four ring-1 regions touch the park
    expect(map.info(PARK).neighbours.sort()).toEqual(['elderGrove', 'mastRow', 'oldMarket', 'saltwind']);
    expect(map.areaOfChunk(0, 3)).toBe(SEA);
    expect(map.areaOfChunk(2, 5)).toBe('bs_2_5');
    expect(map.areaOfChunk(7, 0)).toBe('out_7_0');
  });

  it('the layout is identical for every seed', () => {
    const a = areaMapFor(1, OLD_CITY_GEN);
    const b = areaMapFor(987654, OLD_CITY_GEN);
    for (let cz = -7; cz <= 7; cz++) for (let cx = -7; cx <= 7; cx++) expect(a.areaOfChunk(cx, cz)).toBe(b.areaOfChunk(cx, cz));
    const s1 = oldSim(1);
    const s2 = oldSim(2);
    for (const r of REGIONS.slice(0, 1))
      for (let z = r.chunks.z0 * CHUNK; z < (r.chunks.z1 + 1) * CHUNK; z += 3)
        for (let x = r.chunks.x0 * CHUNK; x < (r.chunks.x1 + 1) * CHUNK; x += 3) {
          const t1 = s1.grid.get(GROUND, x, z)!;
          const t2 = s2.grid.get(GROUND, x, z)!;
          expect([t1.feature, t1.blocked, t1.prop]).toEqual([t2.feature, t2.blocked, t2.prop]);
        }
  });

  it('the shoreline is within 40 tiles of the fountain', () => {
    const sim = oldSim();
    let best = Infinity;
    for (let z = 16; z < 64; z++)
      for (let x = -16; x < 32; x++) {
        const t = sim.grid.get(GROUND, x, z)!;
        if (t.feature === 'water' && sim.areas.map.areaOfCell(x, z) !== PARK) best = Math.min(best, Math.hypot(x - 8, z - 8));
      }
    expect(best).toBeLessThanOrEqual(40);
  });

  it('the sea is open water nothing crosses, the beach is sand with shallow surf', () => {
    const sim = oldSim();
    const sea = sim.grid.get(GROUND, 0, 50)!;
    expect(sea.feature).toBe('water');
    expect(sea.blocked).toBe(true);
    expect(sim.areas.fog(SEA)).toBe('cleared');
    const surf = sim.grid.get(GROUND, 3, 46)!;
    expect(surf.feature).toBe('water');
    expect(surf.blocked).toBe(false);
    expect(sim.grid.get(GROUND, 3, 30)!.feature === 'sand' || sim.grid.get(GROUND, 3, 30)!.blocked).toBe(true);
  });

  it('Mast Row: its street, tram stop, Keeper and seam are clear; its piles hold 120 Copper', () => {
    const sim = oldSim();
    const r = REGIONS[0];
    for (let z = r.patch.z; z < r.patch.z + r.patch.d; z++) for (let x = r.patch.x; x < r.patch.x + r.patch.w; x++) expect(sim.grid.get(GROUND, x, z)!.blocked, `${x},${z}`).toBe(false);
    for (let z = -32; z < 0; z++) expect(sim.grid.get(GROUND, 7, z)!.feature === 'road' || sim.grid.get(GROUND, 7, z)!.prop?.startsWith('gate:')).toBe(true);
    const pylon = KEEPERS.find((k) => k.id === 'pylon')!;
    expect(sim.grid.get(GROUND, pylon.x, pylon.z)!.prop).toBe('keeper:pylon');
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) expect(sim.grid.get(GROUND, r.seam.x + dx, r.seam.z + dz)!.blocked).toBe(false);
    expect(sim.salvage.looseLeft('copper', 'mastRow')).toBe(120);
    expect(sim.grid.get(GROUND, 7, -1)!.prop).toBe('gate:g-mastRow');
  });

  it('the pulse costs more in further rings', () => {
    const sim = oldSim();
    expect(sim.areas.info('mastRow').difficulty).toBe(1);
    expect(sim.areas.info('cistern').difficulty).toBe(1.2);
    expect(sim.areas.info('observatory').difficulty).toBe(1.4);
  });
});
