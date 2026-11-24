import { TIERS } from '../src/data/salvage';
import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { Sim } from '../src/gameplay/Sim';
import { regionById } from '../src/core/OldCityLayout';
import { AREA_SPECIALTY, areaPanelData, areaPanelHtml } from '../src/ui/AreaPanel';

function city(seed = 3) {
  const sim = new Sim(createInitialState(seed));
  sim.state.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  return sim;
}

function restore(sim: Sim, id: string, n: number) {
  const tiles = sim.areas.tiles(id).filter((t) => isRestorable(t, sim.state.machines) && t.ground !== 'restored');
  for (const t of tiles.slice(0, n)) {
    t.ground = 'restored';
    t.bloom = 1;
    t.pollution = 0;
    sim.grid.touch(t);
  }
}

describe('area panel (City 14.2)', () => {
  it('shows type, specialty, live fog progress, the checklist and machines, and no income bonus (E23.1.4)', () => {
    const sim = city();
    const id = sim.areas.nextGoal()!;
    const lm = sim.areas.landmark(id)!;
    const a = sim.areas.info(id);
    let d = areaPanelData(sim, id);
    expect(d.fog).toBe('thinning'); // E23.1.1: Saltwind is in view from the start, its fog already thinning
    expect(d.restored).toBe(0);
    expect(d.need).toBe(sim.areas.need(id));
    let html = areaPanelHtml(sim, id, lm.id);
    expect(html).toContain(AREA_SPECIALTY[a.type]);
    expect(html).toContain(`Turn ${d.need} patches of ground green (0 of ${d.need})`);
    const NO_COUNTERS = /Bonus|\/min|⚡|💧|energy|biomass/i; // E23.1.4: no counters for an area to add to
    expect(html).not.toMatch(NO_COUNTERS);
    expect(html).toContain('Machines: none yet');
    expect(html).not.toContain('data-wake');

    // Progress updates live.
    restore(sim, id, 10);
    d = areaPanelData(sim, id);
    expect(d.restored).toBe(10);
    expect(areaPanelHtml(sim, id, lm.id)).toContain(`(10 of ${d.need})`);

    // A machine inside it is listed.
    const spot = sim.areas.tiles(id).find((t) => t.ground === 'restored' && !t.occupantId)!;
    const m: MachineData = { id: sim.newId('m'), type: 'solar', roofId: GROUND, x: spot.x, z: spot.z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
    sim.state.machines.push(m);
    sim.grid.indexMachine(m);
    expect(areaPanelData(sim, id).machines).toEqual({ solar: 1 });
    expect(areaPanelHtml(sim, id, lm.id)).toContain('1 Solar Panel');

    // Ready: the wake button appears; cleared: the panel says so.
    restore(sim, id, 999);
    expect(areaPanelHtml(sim, id, lm.id)).not.toContain('data-wake'); // E21.9: not before its Keeper asks
    sim.state.salvage.keepers[regionById(id)!.keeper] = { step: 'landmark' };
    expect(areaPanelHtml(sim, id, lm.id)).toContain(`data-wake="${lm.id}"`);
    expect(sim.areas.clear(id)).toBe(true);
    html = areaPanelHtml(sim, id, lm.id);
    expect(html).toContain('🌫️ Clear');
    expect(html).not.toContain('data-wake');
    expect(html).not.toMatch(NO_COUNTERS);
    expect(Object.keys(areaPanelData(sim, id))).not.toContain('bonus');
  });

  it('the park lists its fountain steps (E21.6), ticked as they are reached', () => {
    const sim = new Sim(createInitialState(4));
    let html = areaPanelHtml(sim, PARK, sim.areas.landmark(PARK)?.id);
    for (const t of TIERS) expect(html).toContain(`⬜ Fountain step ${t.tier}: ${t.name}`);
    sim.state.salvage.tier = 2;
    html = areaPanelHtml(sim, PARK, sim.areas.landmark(PARK)?.id);
    expect(html).toContain(`✅ Fountain step 2: ${TIERS[1].name}`);
    expect(html).toContain(`⬜ Fountain step 3: ${TIERS[2].name}`);
  });
});
