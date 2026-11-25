import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { allPiles } from '../src/core/OldCityLayout';
import { PARK_SET, REGIONS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { earlyPowerHint } from '../src/ui/OldCityGuide';
import { objectiveSentence } from '../src/ui/ObjectiveCard';
import { POWER } from '../src/data/power';

const oldMarket = REGIONS.find((r) => r.id === 'oldMarket')!;

describe('First power in the park', () => {
  it('Old Market has glass piles, refilling like every pile', () => {
    const glass = oldMarket.piles.filter((p) => p.material === 'glass');
    expect(glass.length).toBeGreaterThanOrEqual(4);
    for (const p of glass) expect(p.model).toBe('salvage-glass');
    // every pile is in the layout (so it refills, E23.7.4, and oldcity-height proves it can be reached on foot)
    const ids = new Set(allPiles().map((p) => p.id));
    for (const p of glass) expect(ids.has(p.id)).toBe(true);
  });

  it('uses park Scrap and one panel to recharge before the fountain wakes', () => {
    const sim = new Sim(createInitialState(7));
    const scrap = PARK_SET.piles.find((pile) => pile.material === 'scrap')!;
    expect(earlyPowerHint(sim)).toBeUndefined();
    while (sim.inventory.count('scrap') < 6 && sim.salvage.left(scrap.id)) sim.salvage.salvage(scrap.id);
    expect(sim.inventory.count('scrap')).toBeGreaterThanOrEqual(6);

    for (const [x, z] of [[11, 10], [12, 10], [11, 11], [12, 12]]) {
      const tile = sim.grid.get(GROUND, x, z)!;
      expect(sim.restoration.complete(tile, 'pulse')).toBeGreaterThan(0);
    }
    expect(earlyPowerHint(sim)).toContain('{buildMenu}');
    expect(objectiveSentence(sim, undefined).next).toContain('Solar Panel');
    const solar = sim.build.place('solar', GROUND, 11, 10)!;
    expect(solar).toBeDefined();
    expect(earlyPowerHint(sim)).toContain('Charger right beside');
    const charger = sim.build.place('charger', GROUND, 12, 10)!;
    expect(charger).toBeDefined();
    expect(earlyPowerHint(sim)).toBeUndefined();
    expect(sim.fountain.tier).toBe(0);
    expect(sim.areas.counts(PARK).restored).toBeLessThan(60);
    expect(sim.power.networkOf(charger)?.sources).toEqual([solar]);

    sim.bot = { roofId: GROUND, x: 12.5, z: 11.5 };
    const before = sim.charge.value();
    sim.charge.use('sprint', 60);
    expect(sim.charge.value()).toBeLessThan(before);
    const drained = sim.charge.value();
    sim.advance(3);
    expect(sim.power.draw(charger)).toBe(POWER.draw.charger);
    expect(sim.power.servedShare(charger)).toBeGreaterThan(0);
    expect(sim.power.servedShare(charger)).toBeLessThan(1);
    expect(sim.charge.value()).toBeGreaterThan(drained + 3);
  });
});
