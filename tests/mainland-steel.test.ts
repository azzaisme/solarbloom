import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { chunkPiles, landingArea, mainlandType, mainlandAreaOfChunk } from '../src/core/Mainland';
import { allPiles } from '../src/core/OldCityLayout';
import type { BuildableType, MachineData, MaterialId } from '../src/core/types';
import { MACHINES } from '../src/data/machines';
import { MAINLAND, MAINLAND_MACHINES, SALVAGE_FIELDS } from '../src/data/mainland';
import { MATERIALS } from '../src/data/salvage';
import { MACHINE_RECIPES } from '../src/data/crafting';
import { Sim } from '../src/gameplay/Sim';
import { itemCells } from '../src/ui/BackpackModel';
import type { PowerHook } from '../src/gameplay/MainlandSystem';

const RECIPE = (t: string) => MACHINE_RECIPES.find((r) => r.builds === t);

/** E23.8.3.2 (#452): steel from the industrial ruins, and mainland-only machines with recipes. */

const MACHS: BuildableType[] = ['gridBattery'];

/** A Great Bloom game with the landing district cleared and plenty in the backpack. */
function bloomed() {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = MAINLAND.opensAtTier;
  sim.state.salvage!.abilities = ['pry', 'hover', 'climb', 'glide'];
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
    expect(sim.build.whereFrom('steel')).toBe(' — the industrial ruins past the causeway');
    sim.state.salvage!.pack.steel = 0;
    sim.state.salvage!.store.steel = 0;
    expect(sim.build.missingLabel('gridBattery')).toBe('Needs Steel 🔩 — the industrial ruins past the causeway');
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

  it('joins the grid as storage when the grid exists', () => {
    const sim = new Sim(createInitialState(7));
    const calls: [string, unknown][] = [];
    const host = sim as unknown as { power?: PowerHook };
    host.power = { register: (t, spec) => calls.push([t, spec]) };
    sim.mainland.wire();
    expect(sim.mainland.wired).toEqual({ power: true });
    expect(calls).toEqual([
      ['gridBattery', { battery: { capacity: MAINLAND_MACHINES.gridBattery.capacity, rate: MAINLAND_MACHINES.gridBattery.rate } }],
    ]);
  });

  it('on the real grid: the Grid Battery stores the day and carries a drone hub through the night', () => {
    const sim = new Sim(createInitialState(7));
    expect(sim.mainland.wired.power).toBe(true);
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
