import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { chunkPiles, chunkRuins, landingArea, mainlandType, mainlandAreaOfChunk, mainlandWater } from '../src/core/Mainland';
import { canStep } from '../src/core/Height';
import { allPiles, seaCell, setPieceAt } from '../src/core/OldCityLayout';
import type { BuildableType, MachineData, MaterialId } from '../src/core/types';
import { MACHINES } from '../src/data/machines';
import { MAINLAND, MAINLAND_MACHINES, SALVAGE_FIELDS } from '../src/data/mainland';
import { MATERIALS } from '../src/data/salvage';
import { MACHINE_RECIPES } from '../src/data/crafting';
import { Sim } from '../src/gameplay/Sim';
import { itemCells } from '../src/ui/BackpackModel';

// the mainland is closed for the island release (a future update); these tests are about the mainland itself
beforeAll(() => {
  MAINLAND.open = true;
});
afterAll(() => {
  MAINLAND.open = false;
});

const RECIPE = (t: string) => MACHINE_RECIPES.find((r) => r.builds === t);

/** E23.8.3.2 (#452): steel from the industrial ruins, and mainland-only machines with recipes. */

const MACHS: BuildableType[] = ['gridBattery'];

/** A Great Bloom game with the landing district cleared and plenty in the backpack. */
function bloomed() {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = MAINLAND.opensAtTier;
  sim.state.salvage!.abilities = ['prune', 'hover', 'climb', 'glide'];
  sim.mainland.open();
  sim.areas.clear(landingArea(), true);
  for (const m of ['steel', 'copper', 'gears', 'clay', 'scrap'] as MaterialId[]) sim.inventory.add(m, 40);
  for (const c of ['batteryCell', 'pipe', 'motor'] as const) sim.inventory.add(c, 10);
  return sim;
}

/** A clear 2 × 2 of restorable ground in the landing district, restored so a machine can stand on it. */
function spot(sim: Sim): [number, number] {
  const [cx, cz] = MAINLAND.landing;
  for (let z = cz * 16 + 1; z < cz * 16 + 30; z++)
    for (let x = cx * 16 + 4; x < cx * 16 + 30; x++) {
      const cells = sim.grid.footprint(GROUND, x, z, 2);
      if (cells.some((c) => !c || c.blocked || c.occupantId || c.ramp)) continue;
      for (const c of cells) {
        c!.ground = 'restored';
        c!.pollution = 0;
        sim.grid.touch(c!);
      }
      return [x, z];
    }
  throw new Error('no spot');
}

describe('E23.8.3.2: steel', () => {
  it('is a material found only on the mainland', () => {
    expect(MATERIALS.steel.mainlandOnly).toBe(true);
    expect(allPiles().some((p) => p.material === 'steel')).toBe(false); // none on the island
    for (const [t, mats] of Object.entries(SALVAGE_FIELDS.materials)) if (t !== 'downtown') expect(mats!.steel, t).toBeUndefined();
  });

  it('comes from the industrial ruins: their salvage fields hold it, other districts never do', () => {
    let steel = 0;
    let elsewhere = 0;
    for (let cx = 9; cx < 60; cx++)
      for (let cz = -25; cz < 25; cz++)
        for (const p of chunkPiles(cx, cz).values()) {
          if (p.material !== 'steel') continue;
          if (mainlandType(mainlandAreaOfChunk(cx, cz)) === 'downtown') steel++;
          else elsewhere++;
        }
    expect(steel).toBeGreaterThan(20);
    expect(elsewhere).toBe(0);
  });

  it('lies in industrial ruins: frames, a broken gantry and rust stains round every steel field, and nowhere else', () => {
    const bad: string[] = [];
    let fields = 0;
    let gantries = 0;
    for (let cx = 9; cx < 60; cx++)
      for (let cz = -25; cz < 25; cz++) {
        const piles = [...chunkPiles(cx, cz).values()];
        const ruins = [...chunkRuins(cx, cz).values()];
        // a field in the industrial ruins (a downtown district): its piles are mostly steel
        const steel = piles.length > 0 && mainlandType(mainlandAreaOfChunk(cx, cz)) === 'downtown';
        if (!steel) {
          expect(ruins, `${cx},${cz}`).toEqual([]);
          continue;
        }
        fields++;
        expect(ruins.filter((q) => q.kind === 'frame').length, `${cx},${cz} frames`).toBeGreaterThan(0);
        expect(ruins.filter((q) => q.kind === 'stain').length, `${cx},${cz} stains`).toBeGreaterThan(0);
        const g = ruins.filter((q) => q.kind === 'gantry');
        if (g.length) {
          gantries++;
          expect(g.map((q) => q.part).sort()).toEqual(['a', 'b']);
        }
        for (const q of ruins) {
          const lx = q.x - cx * 16;
          const lz = q.z - cz * 16;
          const at = `${q.kind} ${q.x},${q.z}`;
          if (lx === 7 || lx === 8 || lz === 7 || lz === 8) bad.push(`${at} on an avenue`);
          if (seaCell(q.x, q.z) || mainlandWater(q.x, q.z)) bad.push(`${at} in the water`);
          const sp = setPieceAt(q.x, q.z);
          if (sp?.kind !== 'ruin' || sp.ruin !== q) bad.push(`${at} is not its cell's set piece`);
          // a frame or a gantry leg never stands next to a pile
          if (q.kind !== 'stain') for (const p of piles) if (Math.max(Math.abs(p.x - q.x), Math.abs(p.z - q.z)) <= 1) bad.push(`${at} by ${p.id}`);
        }
      }
    expect(bad).toEqual([]);
    expect(fields).toBeGreaterThan(10);
    expect(gantries).toBeGreaterThan(fields / 2);
  });

  it('the ruins never wall a pile in: every steel field pile is reached on foot from its avenues', () => {
    const sim = new Sim(createInitialState(7));
    const tile = (x: number, z: number) => sim.grid.get(GROUND, x, z)!;
    let checked = 0;
    for (let cx = 9; cx < 40; cx++)
      for (let cz = -12; cz < 12; cz++) {
        if (!chunkRuins(cx, cz).size) continue;
        // a walk inside the chunk from where its avenues cross
        const x0 = cx * 16;
        const z0 = cz * 16;
        const seen = new Set<string>();
        const q: [number, number][] = [];
        for (const [x, z] of [[x0 + 7, z0 + 7], [x0 + 8, z0 + 8]]) if (!tile(x, z).blocked) q.push([x, z]);
        while (q.length) {
          const [x, z] = q.pop()!;
          const k = `${x},${z}`;
          if (seen.has(k)) continue;
          seen.add(k);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < x0 || nz < z0 || nx >= x0 + 16 || nz >= z0 + 16) continue;
            if (!tile(nx, nz).blocked && canStep(x, z, nx, nz)) q.push([nx, nz]);
          }
        }
        for (const p of chunkPiles(cx, cz).values()) {
          const reached = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => seen.has(`${p.x + dx},${p.z + dz}`));
          expect(reached, p.id).toBe(true);
          checked++;
        }
        // frames and gantry legs stand solid; the ground under a gantry stays walkable
        for (const r of chunkRuins(cx, cz).values()) if (r.kind !== 'stain') expect(tile(r.x, r.z).blocked, `${r.kind} ${r.x},${r.z}`).toBe(true);
        for (const r of chunkRuins(cx, cz).values())
          if (r.kind === 'gantry' && r.part === 'a')
            for (let d = 1; d < r.span!; d++) expect(tile(r.x + (r.turn === 0 ? d : 0), r.z + (r.turn === 1 ? d : 0)).blocked).toBe(false);
      }
    expect(checked).toBeGreaterThan(30);
  }, 20000);

  it('is never traded for: Tally gives every other material, not steel', () => {
    const sim = bloomed();
    expect(sim.landmarks.tradeTargets()).not.toContain('steel');
    sim.landmarks.canTrade = () => true;
    expect(sim.landmarks.trade('scrap', 'steel')).toBe(false);
    expect(sim.inventory.count('steel')).toBe(40);
    expect(sim.landmarks.trade('scrap', 'copper')).toBe(true);
  });

  it('says where it lies in world words: the backpack and a missing recipe point past the causeway', () => {
    const sim = bloomed();
    const cell = itemCells(sim).find((c) => c.id === 'steel')!;
    expect(cell.from).toBe('Found in the industrial ruins past the causeway');
    expect(sim.build.whereFrom('steel')).toBe(' from the industrial ruins past the causeway');
    sim.state.salvage!.pack.steel = 0;
    sim.state.salvage!.store.steel = 0;
    expect(sim.build.missingLabel('gridBattery')).toBe('Needs Steel 🔩 from the industrial ruins past the causeway');
  });
});

describe('E23.8.3.2: mainland machines', () => {
  it('each has a steel recipe, after the Great Bloom', () => {
    for (const t of MACHS) {
      expect(RECIPE(t), t).toBeDefined();
      expect(RECIPE(t)!.cost.steel, t).toBeGreaterThan(0);
      expect(RECIPE(t)!.unlock).toEqual({ tier: MAINLAND.opensAtTier });
      expect(MACHINES[t].mainlandOnly).toBe(true);
    }
  });

  it('can be built on the mainland and never on the island', () => {
    const sim = bloomed();
    const [x, z] = spot(sim);
    for (const t of MACHS) {
      expect(sim.build.check(t, GROUND, 6, 6).reason, `${t} in the park`).toMatch(/only on the mainland/);
      expect(sim.build.check(t, GROUND, x, z).ok, `${t} on the mainland: ${sim.build.check(t, GROUND, x, z).reason}`).toBe(true);
    }
    const m = sim.build.place('gridBattery', GROUND, x, z);
    expect(m?.type).toBe('gridBattery');
    expect(sim.inventory.count('steel')).toBe(40 - RECIPE('gridBattery')!.cost.steel!);
  });

  it('joins the grid as storage', () => {
    const sim = new Sim(createInitialState(7));
    const bat = { id: 'b', type: 'gridBattery', roofId: GROUND, x: 0, z: 0, size: 2 } as unknown as MachineData;
    expect(sim.power.roleOf(bat)).toEqual({ battery: { capacity: MAINLAND_MACHINES.gridBattery.capacity, rate: MAINLAND_MACHINES.gridBattery.rate } });
  });

  it('on the real grid: the Grid Battery stores the day and carries a drone hub through the night', () => {
    const sim = new Sim(createInitialState(7));
    let sky = { sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 };
    sim.power.skyOverride = () => sky;
    const put = (type: string, x: number, z: number, size = 2): MachineData => {
      const m = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 } as unknown as MachineData;
      sim.state.machines.push(m);
      return m;
    };
    const x = MAINLAND.minChunkX * 16 + 20;
    const sun = put('solar', x, 0, 1); // a small farm
    put('solar', x, 1, 1);
    put('solar', x + 1, 1, 1);
    const bat = put('gridBattery', x + 2, 0);
    const hub = put('droneHub', x + 4, 0);
    // E23.6.3: a hub draws only for its drones at work, so one is out working all day and night
    sim.state.drones = [{ id: 'd1', hubId: hub.id, role: 'restorer', mode: 'working', px: x + 5, pz: 1, timer: 0 } as never];
    const net = sim.power.networkOf(sun)!;
    expect(sim.power.networkOf(bat)).toBe(net);
    expect(net.batteries).toContain(bat);
    expect(net.consumers).toContain(hub);
    expect(sim.power.stored(bat).capacity).toBe(MAINLAND_MACHINES.gridBattery.capacity);
    for (let i = 0; i < 200; i++) sim.power.tick(0.5);
    expect(sim.power.isPowered(hub)).toBe(true);
    const day = sim.power.stored(bat).stored;
    expect(day).toBeGreaterThan(0);
    sky = { sun: 0, solar: 0, cloudy: false, wind: 0, dark: 1 };
    sim.power.tick(0.5);
    expect(sim.power.isPowered(hub)).toBe(true); // the battery carries it
    expect(sim.power.stored(bat).stored).toBeLessThan(day);
  });
});
