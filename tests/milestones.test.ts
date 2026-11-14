import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import type { SpecialtyKind } from '../src/gameplay/Milestones';
import { Sim } from '../src/gameplay/Sim';

const saver = new SaveService(undefined);

function city(seed: number) {
  const sim = new Sim(createInitialState(seed));
  const st = sim.state;
  st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
  st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
  st.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  return sim;
}

/** Areas within `r` chunks of the park (ring by ring, deterministic). */
function areasNear(sim: Sim, r: number): string[] {
  const out = new Set<string>();
  for (let d = 1; d <= r; d++)
    for (let cz = -d; cz <= d; cz++)
      for (let cx = -d; cx <= d; cx++) {
        const id = sim.areas.map.areaOfChunk(cx, cz);
        if (id !== PARK) out.add(id);
      }
  return [...out];
}

/** Reveals an area the honest way: a neighbour of it is cleared (forced), so its fog edge is open. */
function openUp(sim: Sim, id: string) {
  if (sim.areas.fog(id) !== 'hidden') return;
  const nb = sim.areas.info(id).neighbours[0];
  sim.areas.clear(nb, true);
}

/**
 * Plays an area's specialty with plenty of resources: the advisor's next step for it each second (a build or a
 * pulse), otherwise a pulse at the fog edge. Returns the seconds it took, or Infinity.
 */
function solve(sim: Sim, id: string, limit = 15 * 60): number {
  const t0 = sim.time;
  while (sim.time - t0 < limit) {
    if (sim.milestones.specialty(id).met) return sim.time - t0;
    const st = sim.state.resources;
    st.energy = st.water = st.biomass = 1e6;
    const step = sim.advisor.specialtyStep(id);
    if (step?.action.kind === 'build') sim.build.place(step.action.type, GROUND, step.action.x, step.action.z);
    else if (step?.action.kind === 'focus') sim.restoration.pulse(sim.grid.get(step.action.layer ?? GROUND, step.action.x, step.action.z)!.id);
    else {
      const edge = sim.areas.entryTiles(id).find((t) => sim.restoration.checkPulse(t).ok);
      if (edge) sim.restoration.pulse(edge.id);
    }
    sim.advance(1);
  }
  return Infinity;
}

describe('area milestone generator (City 09.1)', () => {
  it('every area near the park gets a specialty its own layout supports, sized within its caps', () => {
    for (const seed of [3, 8, 19]) {
      const sim = city(seed);
      for (const id of areasNear(sim, 8)) {
        const a = sim.areas.info(id);
        const sp = sim.milestones.specialty(id);
        expect(sim.milestones.supports(id, sp.kind), `${id} ${sp.kind}`).toBe(true);
        const def = TUNING.milestones[a.type];
        if (def.kind === sp.kind) expect(sp.need).toBeLessThanOrEqual(def.max);
        expect(sp.need).toBeGreaterThanOrEqual(1);
        // Share-sized actions never ask for more than the area holds.
        if (sp.kind === 'fullBloom' || sp.kind === 'chain') expect(sp.need).toBeLessThanOrEqual(Math.max(1, sim.areas.counts(id).restorable));
        // A canal plan uses only the area's own water and banks.
        const plan = sim.milestones.canalPlan(id);
        if (sp.kind === 'canalFlow') {
          expect(plan).toBeDefined();
          for (const [x, z] of plan!.path) {
            const t = sim.grid.get(GROUND, x, z)!;
            expect(t.feature).toBe('water');
            expect(sim.areas.areaOf(t)).toBe(id);
          }
          for (const [x, z] of [plan!.garden, plan!.condenser]) expect(sim.areas.areaOf(sim.grid.get(GROUND, x, z)!)).toBe(id);
        }
      }
    }
  });

  it('sizes grow with distance from the park and stop at their caps', () => {
    const sim = city(4);
    const byKind = new Map<SpecialtyKind, { d: number; need: number }[]>();
    for (const id of areasNear(sim, 14)) {
      const sp = sim.milestones.specialty(id);
      const list = byKind.get(sp.kind) ?? [];
      list.push({ d: sim.areas.info(id).distance, need: sp.need });
      byKind.set(sp.kind, list);
    }
    for (const [kind, list] of byKind) {
      const near = list.filter((x) => x.d <= 2).map((x) => x.need);
      const far = list.filter((x) => x.d >= 10).map((x) => x.need);
      if (!near.length || !far.length) continue;
      expect(Math.max(...far), kind).toBeGreaterThanOrEqual(Math.min(...near));
    }
    expect([...byKind.keys()].length).toBeGreaterThanOrEqual(6); // every type's action shows up
  });

  it('every kind of specialty is actually achievable by playing the area (two areas of each kind, two seeds)', { timeout: 120000 }, () => {
    const seen = new Map<SpecialtyKind, number>();
    for (const seed of [5, 12]) {
      const sim = city(seed);
      const per = new Map<SpecialtyKind, number>();
      for (const id of areasNear(sim, 6)) {
        const kind = sim.milestones.kind(id);
        if ((per.get(kind) ?? 0) >= 2) continue;
        per.set(kind, (per.get(kind) ?? 0) + 1);
        openUp(sim, id);
        if (sim.areas.fog(id) === 'cleared') continue;
        const t = solve(sim, id);
        expect(t, `seed ${seed} ${id} ${kind}: ${JSON.stringify(sim.milestones.specialty(id))}`).toBeLessThan(15 * 60);
        seen.set(kind, (seen.get(kind) ?? 0) + 1);
      }
    }
    expect([...seen.keys()].sort()).toEqual(['canalFlow', 'canopy', 'chain', 'corridor', 'fullBloom', 'overflow', 'roofBloom', 'solarBoost']);
  });

  it('the wake needs the specialty as well as the restored share', () => {
    const sim = city(6);
    const id = areasNear(sim, 2).find((a) => sim.milestones.kind(a) === 'overflow' || sim.milestones.kind(a) === 'corridor')!;
    openUp(sim, id);
    const tiles = sim.areas.tiles(id).filter((t) => isRestorable(t, sim.state.machines) && t.ground !== 'restored');
    for (const t of tiles.slice(0, sim.areas.need(id) + 5)) {
      t.ground = 'restored';
      t.bloom = 1;
      sim.grid.touch(t);
    }
    expect(sim.areas.counts(id).restored).toBeGreaterThanOrEqual(sim.areas.need(id));
    expect(sim.areas.ready(id)).toBe(false);
    expect(sim.areas.clear(id)).toBe(false);
    const ready: string[] = [];
    sim.bus.on('area.ready', ({ areaId }) => ready.push(areaId));
    expect(solve(sim, id)).toBeLessThan(15 * 60);
    expect(sim.areas.ready(id)).toBe(true);
    expect(ready).toContain(id);
    expect(sim.areas.clear(id)).toBe(true);
  });

  it('progress is saved, and only counts while the area is in fog', () => {
    const sim = city(7);
    const id = areasNear(sim, 3).find((a) => sim.milestones.kind(a) === 'solarBoost')!;
    openUp(sim, id);
    sim.state.areas[id].spec = 1;
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.milestones.specialty(id).have).toBe(1);
    // A boost on a panel in a hidden area doesn't count.
    const hidden = areasNear(sim, 6).find((a) => sim.areas.fog(a) === 'hidden' && sim.milestones.kind(a) === 'solarBoost');
    if (hidden) {
      const [x, z] = sim.areas.info(hidden).landmark;
      const m: MachineData = { id: sim.newId('m'), type: 'solar', roofId: GROUND, x: x + 3, z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
      sim.state.machines.push(m);
      sim.bus.emit('solar.boost', { machineId: m.id });
      expect(sim.state.areas[hidden]).toBeUndefined();
    }
  });

  it('machines can never put a share-sized specialty out of reach', () => {
    const sim = city(9);
    const id = areasNear(sim, 10).find((a) => sim.milestones.kind(a) === 'fullBloom' || sim.milestones.kind(a) === 'chain')!;
    openUp(sim, id);
    const before = sim.milestones.specialty(id).need;
    // Machines on every other free tile.
    sim.areas.tiles(id).forEach((t, i) => {
      if (i % 2 || t.blocked || t.occupantId) return;
      const m: MachineData = { id: sim.newId('m'), type: 'solar', roofId: GROUND, x: t.x, z: t.z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
      sim.state.machines.push(m);
      sim.grid.indexMachine(m);
      t.occupantId = m.id;
      sim.grid.touch(t);
    });
    const c = sim.areas.counts(id);
    const after = sim.milestones.specialty(id).need;
    expect(after).toBeLessThanOrEqual(before);
    expect(after).toBeLessThanOrEqual(Math.max(1, c.restorable - c.fullBloom));
  });

  it('a fogged area that is all in full bloom is never stuck on its specialty', () => {
    const sim = city(10);
    const id = areasNear(sim, 3).find((a) => sim.milestones.kind(a) === 'corridor')!;
    openUp(sim, id);
    for (const t of sim.areas.tiles(id)) {
      if (!isRestorable(t, sim.state.machines) || t.occupantId) continue;
      t.ground = 'restored';
      t.bloom = TUNING.restore.maxBloom;
      sim.grid.touch(t);
    }
    expect(sim.milestones.specialty(id).have).toBe(0);
    expect(sim.milestones.specialty(id).met).toBe(true);
    expect(sim.areas.ready(id)).toBe(true);
  });

  it('the park and the rooftop campaign have no specialty to meet', () => {
    expect(city(1).milestones.met(PARK)).toBe(true);
    const roofs = new Sim(createInitialState(1, { rooftops: true }));
    expect(roofs.milestones.met('anything')).toBe(true);
  });
});
