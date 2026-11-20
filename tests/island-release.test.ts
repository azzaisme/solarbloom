import { afterEach, describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { landingArea, mainlandClosedAt } from '../src/core/Mainland';
import type { ItemId, MaterialId } from '../src/core/types';
import { COMPONENT_RECIPES, DECOR_RECIPES, MACHINE_RECIPES, type ItemCost } from '../src/data/crafting';
import { MACHINES } from '../src/data/machines';
import { MAINLAND, MAINLAND_CLOSED } from '../src/data/mainland';
import { HOUSE, KEEPERS, REGIONS } from '../src/data/oldcity';
import { PROJECTS } from '../src/data/research';
import { MATERIALS, TIERS, tierGives } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import { itemCells } from '../src/ui/BackpackModel';
import { Walker } from '../src/gameplay/Walker';
import { TurnBack } from '../src/gameplay/TurnBack';
import { tradeHtml } from '../src/ui/OldCityPanel';

/**
 * Island release: the mainland is a future update. It stays in the code, unreachable behind `MAINLAND.open`:
 * bloombot can't step onto the causeway (the game turns it back with "More coming soon"), the Great Bloom raises the
 * causeway but reveals nothing past it, and nothing on the island needs the mainland or points the player there.
 */

const C = MAINLAND.causeway;
const mainlandOnly = (m: string) => !!MATERIALS[m as MaterialId]?.mainlandOnly;

/** The raw materials a cost comes to (components opened up). */
function raw(cost: ItemCost, out = new Set<string>()): Set<string> {
  for (const id of Object.keys(cost) as ItemId[]) {
    const comp = COMPONENT_RECIPES.find((c) => c.id === id);
    if (comp) raw(comp.cost, out);
    else out.add(id);
  }
  return out;
}

afterEach(() => {
  MAINLAND.open = false;
});

describe('island release: the gate at the causeway', () => {
  it('ships closed', () => {
    expect(MAINLAND.open).toBe(false);
    expect(`${MAINLAND_CLOSED.title} ${MAINLAND_CLOSED.detail}`).toBe('The mainland is still waking up. More coming soon.');
  });

  it('bloombot can never stand on the causeway or the mainland, even with the fog cleared, and walks the island up to it', () => {
    const sim = new Sim(createInitialState(7));
    const areaOf = (x: number, z: number) => sim.areas.map.areaOfCell(x, z);
    for (const [x, z] of [[C.x0, C.z0], [C.x0 + 1, C.z1], [C.x1, C.z0], [160, 0], [200, -40]]) {
      sim.state.areas[areaOf(x, z)] = { fog: 'cleared', revealedAt: 0 };
      expect(mainlandClosedAt(x, z), `${x},${z}`).toBe(true);
    }
    const walker = new Walker(sim);
    for (const [x, z] of [[C.x0, C.z0], [C.x0, C.z1], [C.x0 + 3, C.z0], [160, 0]]) expect(walker.walkable(GROUND, x, z), `${x},${z}`).toBe(false);
    // the island side stays the island: not closed
    expect(mainlandClosedAt(C.x0 - 1, C.z0)).toBe(false);
    expect(mainlandClosedAt(0, 0)).toBe(false);
    // the future update flips one flag
    MAINLAND.open = true;
    expect(mainlandClosedAt(C.x0, C.z0)).toBe(false);
    expect(walker.walkable(GROUND, C.x0, C.z0)).toBe(true);
  });

  it('the Great Bloom raises the causeway but reveals nothing past it while the mainland is closed', () => {
    const sim = new Sim(createInitialState(7));
    sim.bus.emit('fountain.tier', { tier: MAINLAND.opensAtTier });
    expect(sim.state.areas[landingArea()]?.fog ?? 'hidden').toBe('hidden');
    MAINLAND.open = true;
    const open = new Sim(createInitialState(7));
    open.bus.emit('fountain.tier', { tier: MAINLAND.opensAtTier });
    expect(open.state.areas[landingArea()]?.fog).not.toBe('hidden');
  });
});

describe('island release: the island needs nothing from the mainland', () => {
  it('every recipe the island shows is made from island materials', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.tier = 5;
    const shown = sim.crafting.machines();
    expect(shown.length).toBeGreaterThan(5);
    for (const r of shown) for (const m of raw(r.cost)) expect(mainlandOnly(m), `${r.id} needs ${m}`).toBe(false);
    for (const r of DECOR_RECIPES) for (const m of raw(r.cost)) expect(mainlandOnly(m), `${r.id} needs ${m}`).toBe(false);
    for (const r of COMPONENT_RECIPES) for (const m of raw(r.cost)) expect(mainlandOnly(m), `${r.id} needs ${m}`).toBe(false);
    for (const p of PROJECTS) for (const m of raw(p.cost)) expect(mainlandOnly(m), `research ${p.id} needs ${m}`).toBe(false);
  });

  it('the mainland-only machines (the Grid Battery) are hidden from the table, the fountain and the backpack', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.tier = 5;
    const hidden = MACHINE_RECIPES.filter((r) => r.builds && MACHINES[r.builds].mainlandOnly);
    expect(hidden.map((r) => r.builds)).toContain('gridBattery');
    for (const r of hidden) {
      expect(sim.crafting.machines(), r.id).not.toContain(r);
      expect(sim.crafting.machineRecipe(r.builds!), r.id).toBeUndefined();
      expect(sim.build.isUnlocked(r.builds!), r.id).toBe(false);
    }
    for (const t of TIERS) expect(tierGives(t)).not.toContain('Grid Battery');
    expect(itemCells(sim).map((c) => c.id)).not.toContain('steel');
    expect(sim.landmarks.tradeTargets()).not.toContain('steel');
    // Tally's trade panel: neither the give row nor the get row offers Steel
    expect(tradeHtml(sim, undefined)).not.toMatch(/Steel|data-arg="steel"/);
    expect(tradeHtml(sim, 'scrap')).not.toMatch(/Steel|data-arg="steel"/);
    // and they come back with the mainland
    MAINLAND.open = true;
    expect(tierGives(TIERS[4])).toContain('Grid Battery');
    expect(itemCells(sim).map((c) => c.id)).toContain('steel');
    expect(sim.crafting.machines().some((r) => r.builds === 'gridBattery')).toBe(true);
  });

  it('nothing the island asks for (fountain, Keepers, gates, the house) needs a mainland material', () => {
    for (const t of TIERS) for (const m of Object.keys(t.delivery)) expect(mainlandOnly(m), `tier ${t.tier}: ${m}`).toBe(false);
    for (const k of KEEPERS) for (const m of [...Object.keys(k.request1), ...Object.keys(k.landmark)]) expect(mainlandOnly(m), `${k.name}: ${m}`).toBe(false);
    for (const r of REGIONS) {
      const n = r.gate.needs;
      if ('repair' in n && n.repair) for (const m of Object.keys(n.repair)) expect(mainlandOnly(m), `${r.id} gate: ${m}`).toBe(false);
    }
    for (const h of HOUSE) for (const m of Object.keys(h.delivery)) expect(mainlandOnly(m), `house ${h.level}: ${m}`).toBe(false);
  });
});

describe('island release: bloombot turns back at the causeway', () => {
  // walking east along the causeway's row, from the island side
  const z = C.z0 + 0.5;
  const east = [1, 0] as const;

  it('heading onto the causeway starts a short turn back towards the island, and the card shows', () => {
    const tb = new TurnBack();
    expect(tb.bump(C.x0 - 3.5, z, ...east)).toBe(false); // still a way off
    expect(tb.bump(C.x0 - 0.5, z, ...east)).toBe(true); // the edge: turn back, show the card
    expect(tb.active).toBe(true);
    const step = tb.tick(1 / 60)!;
    expect(step.x).toBeLessThan(0); // back west, towards the island
    expect(step.z).toBeCloseTo(0);
  });

  it('wins over steering for its moment, then hands back', () => {
    const tb = new TurnBack();
    tb.bump(C.x0 - 0.5, z, ...east);
    let t = 0;
    while (tb.tick(1 / 60)) t += 1 / 60;
    expect(t).toBeCloseTo(MAINLAND_CLOSED.turnSeconds, 1);
    expect(tb.active).toBe(false);
  });

  it('shows the card once per approach: holding the stick into it only turns bloombot back again', () => {
    const tb = new TurnBack();
    expect(tb.bump(C.x0 - 0.5, z, ...east)).toBe(true);
    while (tb.tick(1 / 60));
    // still pushing into the causeway: it turns back again, without another card
    expect(tb.bump(C.x0 - 0.5, z, ...east)).toBe(false);
    expect(tb.active).toBe(true);
    while (tb.tick(1 / 60));
    // walks away from the causeway, then comes back: the card shows again
    expect(tb.bump(C.x0 - MAINLAND_CLOSED.rearmCells - 2, z, -1, 0)).toBe(false);
    expect(tb.bump(C.x0 - 0.5, z, ...east)).toBe(true);
  });

  it('walking past along the island never trips it, and an open mainland never turns bloombot back', () => {
    const tb = new TurnBack();
    expect(tb.bump(C.x0 - 1.5, C.z0 - 2.5, ...east)).toBe(false); // the avenue north of the causeway
    expect(tb.bump(0.5, 0.5, ...east)).toBe(false);
    MAINLAND.open = true;
    expect(tb.bump(C.x0 - 0.5, z, ...east)).toBe(false);
    expect(tb.active).toBe(false);
  });
});
