import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { allPiles } from '../src/core/OldCityLayout';
import { REGIONS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { FIRST_STEPS, oldCityHint, oldCityStep, panelNeeds } from '../src/ui/OldCityGuide';

/**
 * E23.1.4 (#536): the first Solar Panel is Tally's craft (the Old Market's Keeper) and is made from glass panes and
 * wire, so the guide asks for it after the first Keeper, and the Old Market has glass to salvage. A fresh game can
 * gather enough glass and copper for it, step by step as the guide's hint says, and the hint never asks for
 * something that can't be had yet.
 */
const oldMarket = REGIONS.find((r) => r.id === 'oldMarket')!;
const mastRow = REGIONS.find((r) => r.id === 'mastRow')!;

/** Salvages every pile of one region's material until `enough` is carried (false: the region's piles ran out first). */
function salvageUntil(sim: Sim, region: string, m: 'glass' | 'copper', enough: number): boolean {
  for (const p of allPiles().filter((q) => q.material === m && (REGIONS.find((r) => r.id === region)!.piles as { id: string }[]).some((x) => x.id === q.id))) {
    while (sim.inventory.count(m) < enough && sim.salvage.left(p.id) > 0 && !sim.salvage.problem(p.id)) sim.salvage.salvage(p.id);
    if (sim.inventory.count(m) >= enough) return true;
  }
  return sim.inventory.count(m) >= enough;
}

describe('E23.1.4: the first Solar Panel', () => {
  it('Old Market has glass piles, refilling like every pile', () => {
    const glass = oldMarket.piles.filter((p) => p.material === 'glass');
    expect(glass.length).toBeGreaterThanOrEqual(4);
    for (const p of glass) expect(p.model).toBe('salvage-glass');
    // every pile is in the layout (so it refills, E23.7.4, and oldcity-height proves it can be reached on foot)
    const ids = new Set(allPiles().map((p) => p.id));
    for (const p of glass) expect(ids.has(p.id)).toBe(true);
  });

  it('comes after the first Keeper: the guide leads to Tally, the glass, the copper, the table, then the build', () => {
    const sim = new Sim(createInitialState(7));
    const sv = sim.state.salvage!;
    const hint = () => oldCityHint(sim, 7, () => 'E').text;
    sv.tier = 1; // the water is back: bloombot can pry (the tier's ability, as the fountain gives it)
    sv.abilities.push('pry');
    // the steps before (a pile salvaged, four tiles restored; the fountain's tier covers the rest)
    expect(sim.salvage.salvage(allPiles()[0].id)).toBeGreaterThan(0);
    sim.state.stats.tilesRestored = 4;
    // the step order: a barricade, then a Keeper, then the panel
    expect(oldCityStep(sim)).toBe(5);
    // the first barricade and Keeper: Elder Grove's (not the Old Market), so the panel is still locked after them
    const grove = REGIONS.find((r) => r.id === 'elderGrove')!;
    expect(sim.gates.open(grove.gate.id)).toBe(true);
    expect(oldCityStep(sim)).toBe(6);
    const moss = sim.keepers.def(grove.keeper);
    sim.inventory.add('scrap', 5);
    sim.keepers.pulse(moss.id);
    sim.keepers.interact(moss.id);
    expect(oldCityStep(sim)).toBe(7);
    // the panel is Tally's craft: first the Old Market's barricade, then Tally
    expect(hint()).toMatch(/Tally in Old Market knows how to make a ☀️ Solar Panel: hold \S+ beside the rubble into Old Market to pry it open/);
    expect(sim.gates.open(oldMarket.gate.id)).toBe(true);
    expect(hint()).toMatch(/Tally sleeps in Old Market and knows how to make the ☀️ Solar Panel\. Press \S+ beside it to stir it/);
    const tally = sim.keepers.def(oldMarket.keeper);
    sim.inventory.add('scrap', 5);
    sim.keepers.pulse(tally.id);
    sim.keepers.interact(tally.id);
    expect(sim.crafting.unlocked(sim.crafting.machineRecipe('solar')!.unlock)).toBe(true);
    // the panel's own Scrap, then the Old Market's glass (for the panes)
    sim.inventory.add('scrap', 10);
    expect(panelNeeds(sim).salvage).toContain('glass');
    expect(hint()).toMatch(/Dig 🪟 Glass out of the glinting piles in Old Market for the ☀️ Solar Panel/);
    expect(salvageUntil(sim, 'oldMarket', 'glass', 4)).toBe(true);
    // then copper (for the wire), on Mast Row behind its barricade
    expect(panelNeeds(sim).salvage).toEqual(['copper']);
    expect(hint()).toMatch(/needs 🔧 Copper, found in Mast Row: hold \S+ beside the rubble into it to pry it open/);
    expect(sim.gates.open(mastRow.gate.id)).toBe(true);
    expect(hint()).toMatch(/Dig 🔧 Copper out of the glinting piles in Mast Row/);
    expect(salvageUntil(sim, 'mastRow', 'copper', 2)).toBe(true);
    // the table makes the panes and the wire
    expect(panelNeeds(sim)).toEqual({ craft: ['glassPane', 'wire'], salvage: [] });
    expect(hint()).toMatch(/Make 🔲 Glass pane and ➰ Wire at the crafting table/);
    expect(sim.crafting.craft('glassPane', 2)).toBe(2);
    expect(sim.crafting.craft('wire', 1)).toBe(1);
    sim.advance(30);
    expect(panelNeeds(sim)).toEqual({ craft: [], salvage: [] });
    // and the panel is built beside home
    expect(hint()).toBe('Build a ☀️ Solar Panel from the build menu');
    sim.areas.clear(PARK, true);
    // the green ground the player has pulsed by now (the old drone sleeps until woken, so nothing else made it)
    for (const t of sim.areas.tiles(PARK).filter((q) => q.ground !== 'restored' && !q.blocked && !q.occupantId).slice(0, 12)) sim.restoration.complete(t, 'pulse');
    const spot = sim.areas.tiles(PARK).find((t) => t.ground === 'restored' && !t.occupantId && !t.blocked && sim.build.check('solar', GROUND, t.x, t.z).ok)!;
    expect(sim.build.place('solar', GROUND, spot.x, spot.z)).toBeDefined();
    expect(oldCityStep(sim)).toBe(FIRST_STEPS - 1); // every first step done: the advisor takes over
  });

  it('never asks for what can\'t be had: each panel hint names a place that is open, a Keeper there, or the table', () => {
    const sim = new Sim(createInitialState(21));
    sim.state.salvage!.tier = 1;
    sim.state.salvage!.abilities.push('pry');
    const text = oldCityHint(sim, 7, () => 'E').text;
    // nothing open yet: the hint is to pry the Keeper's own barricade, never to salvage or make anything
    expect(text).toMatch(/beside the rubble into Old Market to pry it open/);
    expect(text).not.toMatch(/Salvage|Make|Build/);
  });
});
