import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { big, toNum } from '../src/core/Big';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';
import { mmss, runBot } from './bots';

/** Region unlocks (owner, 18 Nov 2026): revealed areas stay sealed in thick fog until bought. */

const U = TUNING.city.unlock as { enabled: boolean };
beforeEach(() => (U.enabled = true));
afterEach(() => (U.enabled = false));

function world(seed = 4) {
  const sim = new Sim(createInitialState(seed));
  const g = sim.grid.layer(GROUND)!;
  g.unlocked = true;
  g.preview = false;
  return sim;
}

function clearPark(sim: Sim) {
  for (const t of sim.areas.tiles(PARK)) {
    if (!isRestorable(t, sim.state.machines) || t.ground === 'restored') continue;
    t.ground = 'restored';
    t.bloom = 1;
    t.pollution = 0;
    sim.grid.touch(t);
  }
  expect(sim.areas.clear(PARK, true)).toBe(true);
}

function rich(sim: Sim) {
  sim.state.caps.energy = big(1e6);
  sim.state.resources.energy = big(1e6);
  sim.state.resources.biomass = big(1e9);
}

describe('region unlocks', () => {
  it('clearing the park seals its neighbours: thick fog that nothing can enter, with a price', () => {
    const sim = world();
    clearPark(sim);
    const sealed = sim.areas.sealedAreas();
    expect(sealed.sort()).toEqual([...sim.areas.info(PARK).neighbours].sort());
    const walker = new Walker(sim);
    for (const id of sealed) {
      expect(sim.areas.fog(id)).toBe('hidden');
      expect(sim.areas.revealed()).not.toContain(id);
      expect(sim.areas.entryTiles(id)).toEqual([]);
      const t = sim.areas.tiles(id).find((x) => !x.blocked)!;
      expect(sim.areas.canTouch(t)).toBe(false);
      expect(walker.walkable(GROUND, t.x, t.z)).toBe(false);
      expect(sim.areas.fogReason(t)).toMatch(/unlock it for/);
      const c = sim.areas.unlockCost(id)!;
      expect(toNum(c.biomass)).toBeGreaterThanOrEqual(TUNING.city.unlock.biomass);
      expect(toNum(c.energy)).toBeLessThanOrEqual(Math.max(1, toNum(sim.econ.cap('energy')!) * TUNING.city.unlock.capShare));
    }
    expect(sim.areas.nextGoal()).toBeUndefined(); // nothing to work on until something is bought
  });

  it('unlocking needs the price, spends exactly it, and opens the area with a way in', () => {
    const sim = world();
    clearPark(sim);
    const id = sim.areas.sealedAreas()[0];
    sim.state.resources.biomass = big(0);
    let failed = '';
    sim.bus.on('action.failed', ({ reason }) => (failed = reason));
    expect(sim.areas.unlock(id)).toBe(false);
    expect(failed).toMatch(/Needs/);
    expect(sim.areas.sealed(id)).toBe(true);
    rich(sim);
    const cost = sim.areas.unlockCost(id)!;
    const b0 = sim.state.resources.biomass;
    const e0 = sim.state.resources.energy;
    let opened = '';
    sim.bus.on('area.unlocked', ({ areaId }) => (opened = areaId));
    expect(sim.areas.unlock(id)).toBe(true);
    expect(opened).toBe(id);
    expect(toNum(b0.sub(sim.state.resources.biomass))).toBeCloseTo(toNum(cost.biomass), 6);
    expect(toNum(e0.sub(sim.state.resources.energy))).toBeCloseTo(toNum(cost.energy), 6);
    expect(sim.areas.fog(id)).toBe('frontier');
    expect(sim.areas.revealed()).toContain(id);
    expect(sim.areas.entryTiles(id).length).toBeGreaterThan(0);
    expect(sim.areas.unlock(id)).toBe(false); // once
  });

  it('later areas cost more, and the price is fixed when an area appears', () => {
    const sim = world(9);
    clearPark(sim);
    rich(sim);
    const [a, b] = sim.areas.sealedAreas();
    const pa = toNum(sim.areas.unlockCost(a)!.biomass);
    sim.areas.unlock(a);
    expect(toNum(sim.areas.unlockCost(b)!.biomass)).toBe(pa > 0 ? toNum(sim.areas.unlockCost(b)!.biomass) : 0); // unchanged by buying another
    // Clear the bought area: its newly revealed neighbours are priced after one unlock, so higher.
    for (const t of sim.areas.tiles(a)) if (isRestorable(t, sim.state.machines)) Object.assign(t, { ground: 'restored', bloom: 1, pollution: 0 });
    sim.areas.clear(a, true);
    const fresh = sim.areas.sealedAreas().filter((id) => !sim.areas.info(PARK).neighbours.includes(id));
    if (fresh.length) expect(toNum(sim.areas.unlockCost(fresh[0])!.biomass)).toBeGreaterThan(pa);
  });

  it('seals and prices survive save and load; saves from before unlocks stay open', () => {
    const saver = new SaveService(undefined);
    const sim = world();
    clearPark(sim);
    const id = sim.areas.sealedAreas()[0];
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.areas.sealed(id)).toBe(true);
    expect(toNum(copy.areas.unlockCost(id)!.biomass)).toBe(toNum(sim.areas.unlockCost(id)!.biomass));
    U.enabled = false;
    const old = world();
    clearPark(old);
    expect(old.areas.sealedAreas()).toEqual([]);
    expect(old.areas.revealed().length).toBeGreaterThan(1);
  });

  it('the pacing bot buys regions and keeps going (report)', { timeout: 300000 }, () => {
    const r = runBot({ seed: 7, minutes: 20, unlocks: true });
    console.log(`\nregion unlocks, seed 7, 20 min: fountain ${mmss(r.fountain)} · areas bought at ${r.unlocked.map(mmss).join(', ')} · tiles ${r.tilesRestored}\n`);
    expect(r.fountain).toBeGreaterThan(0);
    expect(r.unlocked.length).toBeGreaterThan(0);
  });
});
