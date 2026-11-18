import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { chunkPiles, landingArea, mainlandType, mainlandAreaOfChunk } from '../src/core/Mainland';
import { allPiles } from '../src/core/OldCityLayout';
import type { BuildableType, MaterialId } from '../src/core/types';
import { MACHINES } from '../src/data/machines';
import { MAINLAND, MAINLAND_MACHINES, SALVAGE_FIELDS } from '../src/data/mainland';
import { MATERIALS, RECIPES } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import type { PowerHook, WaterHook } from '../src/gameplay/MainlandSystem';

/** E23.8.3.2 (#452): steel from the industrial ruins, and mainland-only machines with recipes. */

const MACHS: BuildableType[] = ['gridBattery', 'longPump'];

/** A Great Bloom game with the landing district cleared and plenty in the backpack. */
function bloomed() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.state.salvage!.tier = MAINLAND.opensAtTier;
  sim.state.salvage!.abilities = ['pry', 'hover', 'climb', 'glide'];
  sim.mainland.open();
  sim.areas.clear(landingArea(), true);
  for (const m of ['steel', 'copper', 'gears', 'clay', 'scrap'] as MaterialId[]) sim.inventory.add(m, 40);
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
});

describe('E23.8.3.2: mainland machines', () => {
  it('each has a steel recipe, after the Great Bloom', () => {
    for (const t of MACHS) {
      expect(RECIPES[t], t).toBeDefined();
      expect(RECIPES[t]!.cost.steel, t).toBeGreaterThan(0);
      expect(RECIPES[t]!.tier).toBe(MAINLAND.opensAtTier);
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
    expect(sim.inventory.count('steel')).toBe(40 - RECIPES.gridBattery!.cost.steel!);
  });

  it('joins the grid as storage and a pumping consumer, and the water network as a long-reach pump, when they exist', () => {
    const sim = new Sim(createInitialState(7, 'oldcity'));
    const calls: [string, unknown][] = [];
    const host = sim as unknown as { power?: PowerHook; water?: WaterHook };
    host.power = { register: (t, spec) => calls.push([t, spec]) };
    host.water = { registerPump: (t, spec) => calls.push([`water:${t}`, spec]) };
    sim.mainland.wire();
    expect(sim.mainland.wired).toEqual({ power: true, water: true });
    expect(calls).toEqual([
      ['gridBattery', { battery: { capacity: MAINLAND_MACHINES.gridBattery.capacity, rate: MAINLAND_MACHINES.gridBattery.rate } }],
      ['longPump', { consumer: { shed: 'pump', draw: MAINLAND_MACHINES.longPump.draw } }],
      ['water:longPump', { reach: MAINLAND_MACHINES.longPump.reach, flow: MAINLAND_MACHINES.longPump.flow }],
    ]);
    // without them (today on testing), nothing breaks and nothing is wired
    expect(new Sim(createInitialState(7, 'oldcity')).mainland.wired.water).toBe(false);
  });
});
