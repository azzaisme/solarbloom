import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MaterialId } from '../src/core/types';
import { PARK_SET, REGIONS } from '../src/data/oldcity';
import { PACK, TIERS } from '../src/data/salvage';
import { MACHINE_RECIPES } from '../src/data/crafting';
import { MACHINES } from '../src/data/machines';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);
const NEAR = { roofId: GROUND, x: 8.5, z: 11.5 };
const oldSim = (seed = 7) => {
  const sim = new Sim(createInitialState(seed));
  sim.bot = NEAR;
  return sim;
};
/** Marks n park tiles restored. */
function restorePark(sim: Sim, n: number) {
  let k = sim.areas.counts(PARK).restored;
  for (const t of sim.areas.tiles(PARK)) {
    if (k >= n) break;
    if (t.blocked || t.occupantId || t.ground === 'restored') continue;
    t.ground = 'restored';
    t.bloom = 1;
    t.pollution = 0;
    sim.grid.touch(t);
    k++;
  }
}
/** Gives every material of a tier's delivery. */
function stock(sim: Sim, tier: number) {
  for (const [k, v] of Object.entries(TIERS[tier - 1].delivery)) sim.inventory.addToStore(k as MaterialId, v!);
  sim.state.salvage!.items = [...(TIERS[tier - 1].items ?? [])];
}
const wakeLandmarks = (sim: Sim, n: number) => REGIONS.slice(0, n).forEach((r) => (sim.state.areas[r.id] = { fog: 'cleared', revealedAt: 0, clearedAt: 0 }));

describe('E21.6: the fountain', () => {
  it('part deliveries are kept, also through a save', () => {
    const sim = oldSim();
    sim.inventory.add('scrap', 12);
    expect(sim.fountain.deliver('scrap')).toBe(12);
    expect(sim.fountain.remaining('scrap')).toBe(8);
    expect(sim.fountain.deliver('seeds')).toBe(0);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(back.fountain.given('scrap')).toBe(12);
    expect(saver.serialize(back.state)).toBe(json);
    // never more than is wanted
    back.bot = NEAR;
    back.inventory.add('scrap', 40);
    expect(back.fountain.deliver('scrap')).toBe(8);
    expect(back.inventory.count('scrap')).toBe(32);
  });

  it('a tier cannot advance without its condition, and advances as soon as it is met', () => {
    const sim = oldSim();
    stock(sim, 1);
    sim.fountain.giveAll();
    expect(sim.fountain.delivered()).toBe(true);
    expect(sim.fountain.tier).toBe(0);
    restorePark(sim, 59);
    sim.tick();
    expect(sim.fountain.tier).toBe(0);
    restorePark(sim, 60);
    sim.tick();
    expect(sim.fountain.tier).toBe(1);
  });

  it('each tier grants exactly what the table says', () => {
    const sim = oldSim();
    const tiers: number[] = [];
    sim.bus.on('fountain.tier', (e) => tiers.push(e.tier));
    restorePark(sim, 60);
    const abilities = ['pry', 'hover', 'climb', 'glide'];
    for (let tier = 1; tier <= 5; tier++) {
      wakeLandmarks(sim, TIERS[tier - 1].needs.landmarks ?? 0);
      stock(sim, tier);
      sim.fountain.giveAll();
      expect(sim.fountain.tier, `tier ${tier}`).toBe(tier);
      expect(sim.state.salvage!.abilities).toEqual(abilities.slice(0, Math.min(4, tier)));
      expect(sim.inventory.stackLimit()).toBe(PACK.stack[tier]);
      // E23.6.1: every machine the fountain opens (a crafting-table recipe with a tier) opens at exactly its tier;
      // the rest wait for a Keeper, research or a find, never for the fountain
      for (const r of MACHINE_RECIPES) {
        if (!r.builds) continue;
        const at = sim.build.recipeTier(r.builds);
        if ('tier' in r.unlock) expect(at, r.id).toBe(r.unlock.tier);
        else expect(at, r.id).toBe(99);
        if (at < 99) expect(sim.build.isUnlocked(r.builds), `${r.id} at ${tier}`).toBe(at <= tier);
        else expect(sim.build.isUnlocked(r.builds), `${r.id} at ${tier}`).toBe(false);
      }
      // and the fountain says so: its list names every machine it opens at this tier, and only those
      const named = MACHINE_RECIPES.filter((r) => r.builds && 'tier' in r.unlock).map((r) => ({ name: MACHINES[r.builds!].name, tier: (r.unlock as { tier: number }).tier }));
      for (const m of named) expect(TIERS[tier - 1].gives.includes(m.name), `${m.name} listed at tier ${tier}`).toBe(m.tier === tier);
      const keeperMachines = MACHINE_RECIPES.filter((r) => r.builds && !('tier' in r.unlock)).map((r) => MACHINES[r.builds!].name);
      for (const n of keeperMachines) expect(TIERS[tier - 1].gives, `${n} is not the fountain's`).not.toContain(n);
    }
    expect(tiers).toEqual([1, 2, 3, 4, 5]);
  });

  it('tier 1 wakes the park and shows the ring-1 regions behind their barricades', () => {
    const sim = oldSim();
    restorePark(sim, 60);
    stock(sim, 1);
    sim.fountain.giveAll();
    expect(sim.state.progression.coreActivated).toBe(true);
    expect(sim.areas.fog(PARK)).toBe('cleared');
    for (const id of ['mastRow', 'oldMarket', 'elderGrove']) expect(sim.areas.sealed(id), id).toBe(true);
  });

  it('tier 1 can be reached in a new game using only what the park holds', () => {
    const sim = oldSim(21);
    // salvage every park pile
    for (const p of PARK_SET.piles) while (sim.salvage.left(p.id) > 0) if (!sim.salvage.salvage(p.id)) break;
    expect(sim.inventory.count('scrap')).toBe(40); // a full stack: the rest waits in the piles
    sim.fountain.giveAll();
    for (const p of PARK_SET.piles) while (sim.salvage.left(p.id) > 0) if (!sim.salvage.salvage(p.id)) break;
    expect(sim.fountain.remaining('scrap')).toBe(0);
    expect(sim.fountain.remaining('seeds')).toBe(0);
    // restore the park by hand: pulse, wait for energy and water, repeat
    for (let i = 0; i < 4000 && sim.areas.counts(PARK).restored < 60; i++) {
      const t = sim.areas.tiles(PARK).find((q) => sim.restoration.checkPulse(q).ok && q.ground !== 'restored');
      if (t) sim.restoration.pulse(t.id);
      sim.advance(1);
      if (!sim.state.progression.coreActivated && sim.time % 20 < 1) sim.harvestSun();
    }
    sim.advance(2);
    expect(sim.fountain.tier).toBe(1);
  });
});
