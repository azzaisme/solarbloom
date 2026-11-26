import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { SaveService } from '../src/app/SaveService';
import type { GameState } from '../src/core/types';
import { PARK_SET } from '../src/data/oldcity';
import { BENCH_OCCUPANT, CraftBench } from '../src/gameplay/CraftBench';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';
import { bannedIn } from '../src/ui/words';
import { bloombotUpgradeRows as upgradeRows, moveTwoRows } from '../src/ui/BloombotPage';

/** A save as an older version left it: no workbench in it yet (and its world as JSON, as the save keeps it). */
function olderSave(edit?: (s: Sim) => void): GameState {
  const sim = new Sim(createInitialState(7));
  edit?.(sim);
  const st = JSON.parse(new SaveService().serialize(sim.state)) as GameState;
  delete st.salvage!.bench;
  return st;
}

const sh = PARK_SET.shed;
/** squares the house's walls touch (one square out), corners included */
const besideHouse = (x: number, z: number) => x >= sh.x - 1 && x <= sh.x + sh.size && z >= sh.z - 1 && z <= sh.z + sh.size && !(x >= sh.x && x < sh.x + sh.size && z >= sh.z && z < sh.z + sh.size);

describe('#783: the workbench stands beside the house', () => {
  it('a new garden has it from the start, outside against the house, on its own square', () => {
    const sim = new Sim(createInitialState(7));
    expect(sim.state.salvage!.bench).toEqual(PARK_SET.bench);
    const { x, z } = sim.bench.at!;
    expect(besideHouse(x, z)).toBe(true);
    // not in the house: the house's squares are not the bench
    for (let dz = 0; dz < sh.size; dz++) for (let dx = 0; dx < sh.size; dx++) expect(sim.bench.isAt(GROUND, sh.x + dx, sh.z + dz)).toBe(false);
    expect(sim.grid.get(GROUND, x, z)!.occupantId).toBe(BENCH_OCCUPANT);
  });

  it('is solid: Bloombot walks round it and nothing can be built on it', () => {
    const sim = new Sim(createInitialState(7));
    const { x, z } = sim.bench.at!;
    expect(new Walker(sim).walkable(GROUND, x, z)).toBe(false);
    expect(sim.build.check('solar', GROUND, x, z).ok).toBe(false);
  });

  it('faces an open square Bloombot can stand on to use it (east, toward the path)', () => {
    const sim = new Sim(createInitialState(7));
    expect(sim.bench.facing()).toEqual([1, 0]);
    const f = sim.bench.front()!;
    expect(new Walker(sim).walkable(GROUND, f.x, f.z)).toBe(true);
  });

  it('stays where it is across a save and load', () => {
    const sim = new Sim(createInitialState(7));
    const st = JSON.parse(new SaveService().serialize(sim.state)) as GameState;
    const again = new Sim(st);
    expect(again.bench.at).toEqual(sim.bench.at);
    expect(again.grid.get(GROUND, again.bench.at!.x, again.bench.at!.z)!.occupantId).toBe(BENCH_OCCUPANT);
  });

  it('says what it is when Bloombot faces it or the pointer is on it, in plain words', () => {
    const sim = new Sim(createInitialState(7));
    const t = sim.grid.get(GROUND, sim.bench.at!.x, sim.bench.at!.z)!;
    const d = sim.salvage.describe(t)!;
    expect(d.title).toContain('Workbench');
    expect(d.detail).toContain('{interact}');
    expect(bannedIn(d.title + ' ' + d.detail)).toEqual([]);
  });
});

describe('#783: an older save gets the workbench too', () => {
  it('on the same square beside the house when that is free', () => {
    const st = olderSave();
    expect(st.salvage!.bench).toBeUndefined();
    const sim = new Sim(st);
    expect(sim.state.salvage!.bench).toEqual(PARK_SET.bench);
    expect(sim.grid.get(GROUND, PARK_SET.bench.x, PARK_SET.bench.z)!.occupantId).toBe(BENCH_OCCUPANT);
  });

  it('on the nearest free square beside the house when the player built on that one, moving nothing they built', () => {
    const st = olderSave((s) => {
      delete s.state.salvage!.bench;
      // clear the stamp the new game made, then build a machine where the bench would go
      s.grid.get(GROUND, PARK_SET.bench.x, PARK_SET.bench.z)!.occupantId = undefined;
      s.state.machines.push({ id: 'm99', type: 'chest', roofId: GROUND, x: PARK_SET.bench.x, z: PARK_SET.bench.z, size: 1, boostUntil: 0, timer: 0, charge: 0 });
    });
    const machines = JSON.stringify(st.machines);
    const sim = new Sim(st);
    const b = sim.bench.at!;
    expect(b).not.toEqual(PARK_SET.bench);
    expect(besideHouse(b.x, b.z)).toBe(true);
    expect(JSON.stringify(sim.state.machines)).toBe(machines);
    expect(sim.grid.get(GROUND, PARK_SET.bench.x, PARK_SET.bench.z)!.occupantId).toBe('m99');
    expect(sim.grid.get(GROUND, b.x, b.z)!.occupantId).toBe(BENCH_OCCUPANT);
    // it can still be walked up to
    const f = sim.bench.front()!;
    expect(new Walker(sim).walkable(GROUND, f.x, f.z)).toBe(true);
  });

  it('never on the house door, a pile, the steps or water, and always with room to stand', () => {
    const sim = new Sim(createInitialState(7));
    const bench = new CraftBench(sim);
    const [dx, dz] = sh.door;
    expect(bench.free(dx, dz)).toBe(false);
    expect(bench.free(dx, dz + 1)).toBe(false);
    for (const p of PARK_SET.piles) expect(bench.free(p.x, p.z)).toBe(false);
    for (let dz2 = 0; dz2 < sh.size; dz2++) for (let dx2 = 0; dx2 < sh.size; dx2++) expect(bench.free(sh.x + dx2, sh.z + dz2)).toBe(false);
  });

  it('keeps looking further out when every square touching the house is taken', () => {
    const st = olderSave((s) => {
      let id = 200;
      for (let z = sh.z - 1; z <= sh.z + sh.size; z++)
        for (let x = sh.x - 1; x <= sh.x + sh.size; x++) {
          if (!besideHouse(x, z)) continue;
          const t = s.grid.get(GROUND, x, z)!;
          if (t.blocked || (t.occupantId && t.occupantId !== BENCH_OCCUPANT)) continue;
          t.occupantId = undefined;
          s.state.machines.push({ id: `m${id++}`, type: 'chest', roofId: GROUND, x, z, size: 1, boostUntil: 0, timer: 0, charge: 0 });
        }
    });
    const sim = new Sim(st);
    const b = sim.bench.at!;
    expect(besideHouse(b.x, b.z)).toBe(false);
    expect(Math.max(Math.abs(b.x - (sh.x + 1)), Math.abs(b.z - (sh.z + 1)))).toBeLessThanOrEqual(3); // two squares out
  });
});

describe('#783: the house is a home, and every line points at the workbench', () => {
  it('Show me where for an upgrade or a second-level move leads to the workbench, not the house', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.keepers.pylon = { step: 'request1' };
    const where = [...upgradeRows(sim), ...moveTwoRows(sim)].map((r) => r.where).filter((w) => w && w.name !== 'the fountain' && !/vault|jetty|cliff|roof/.test(w.name));
    expect(where.length).toBeGreaterThan(0);
    for (const w of where) {
      expect(w!.name).toBe('the workbench');
      expect({ x: w!.x, z: w!.z }).toEqual(sim.bench.front());
    }
  });

  it('no line tells the player to craft in the house or at the table', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.keepers.pylon = { step: 'request1' };
    const lines = [...upgradeRows(sim), ...moveTwoRows(sim)].map((r) => r.how);
    lines.push(sim.build.check('cultivator', GROUND, 12, 12).reason ?? '');
    for (const l of lines) {
      expect(l).not.toMatch(/crafting table|in the house|at the table/);
      expect(bannedIn(l), l).toEqual([]);
    }
  });
});
