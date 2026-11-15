import { big } from '../src/core/Big';
import { describe, expect, it } from 'vitest';
import { meetSpecialty } from './city-helpers';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { Rng } from '../src/core/Rng';
import { Sim } from '../src/gameplay/Sim';

function check(sim: Sim, label: string) {
  const g = sim.advisor.suggest();
  expect(g.text.length, label).toBeGreaterThan(10);
  expect(g.label.length, label).toBeGreaterThan(3);
  const a = g.action;
  // Every suggestion is achievable now (or is an honest wait for something that always refills).
  if (a.kind === 'wake') {
    const m = sim.machine(a.machineId)!;
    const id = sim.areas.areaOf(m)!;
    expect(id === PARK ? sim.progression.coreReady() : sim.areas.ready(id), label).toBe(true);
  } else if (a.kind === 'focus') expect(sim.restoration.checkPulse(sim.grid.get(a.layer ?? GROUND, a.x, a.z)!).ok, label).toBe(true);
  else if (a.kind === 'upgrades') expect(sim.upgrades.all().some((d) => sim.upgrades.status(d).ok), label).toBe(true);
  else if (a.kind === 'build') expect(sim.build.check(a.type, GROUND, a.x, a.z).ok, label).toBe(true);
  else if (a.kind === 'district') expect(sim.districts.available(a.districtId), label).toBe(true);
  else if (a.kind === 'harvest') expect(sim.state.harvestReadyAt <= sim.time, label).toBe(true);
  else if (a.kind === 'merge') expect(sim.merge.plan(a.machineId)?.ok, label).toBe(true);
  else expect(a.seconds, label).toBeGreaterThan(0);
  return g;
}

function restoreArea(sim: Sim, id: string, all = false) {
  const tiles = sim.areas.tiles(id).filter((t) => isRestorable(t, sim.state.machines) && t.ground !== 'restored');
  for (const t of all ? tiles : tiles.slice(0, sim.areas.need(id))) {
    t.ground = 'restored';
    t.bloom = 1;
    t.pollution = 0;
    sim.grid.touch(t);
  }
}

describe('objective advisor (City 14.1)', () => {
  it('a fresh game suggests restoring the park', () => {
    const sim = new Sim(createInitialState(1));
    const g = check(sim, 'fresh');
    expect(g.action.kind).toBe('focus');
  });

  it('a ready landmark is the top suggestion', () => {
    const sim = new Sim(createInitialState(2));
    sim.state.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    const id = sim.areas.nextGoal()!;
    restoreArea(sim, id);
    meetSpecialty(sim, id);
    const g = check(sim, 'ready');
    expect(g.action).toEqual({ kind: 'wake', machineId: sim.areas.landmark(id)!.id });
  });

  it('broke, with the harvest on cooldown: an honest wait, never nothing', () => {
    const sim = new Sim(createInitialState(3));
    sim.state.resources.energy = big(0); sim.state.resources.water = big(0); sim.state.resources.biomass = big(0);
    sim.state.harvestReadyAt = sim.time + 12;
    const g = check(sim, 'broke');
    expect(g.action).toEqual({ kind: 'wait', seconds: 12 });
    sim.state.harvestReadyAt = 0;
    expect(check(sim, 'broke, harvest ready').action.kind).toBe('harvest');
  });

  it('everything in reach already bloomed and machines everywhere: still a suggestion', () => {
    const sim = new Sim(createInitialState(4));
    sim.state.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    for (const id of sim.areas.revealed()) restoreArea(sim, id, true);
    for (const t of sim.areas.tiles(PARK)) {
      if (t.blocked || t.occupantId || sim.isCoreTile(t)) continue;
      const m: MachineData = { id: sim.newId('m'), type: 'solar', roofId: GROUND, x: t.x, z: t.z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
      sim.state.machines.push(m);
      sim.grid.indexMachine(m);
      t.occupantId = m.id;
    }
    check(sim, 'all bloomed');
    sim.state.resources.energy = big(0); sim.state.resources.water = big(0); sim.state.resources.biomass = big(0);
    sim.state.harvestReadyAt = sim.time + 5;
    check(sim, 'all bloomed, broke');
  });

  it('soak: 300 random states across a growing city always have an achievable suggestion', { timeout: 60000 }, () => {
    const rng = new Rng(77);
    for (let seed = 1; seed <= 6; seed++) {
      const sim = new Sim(createInitialState(seed));
      for (let i = 0; i < 50; i++) {
        const r = rng.next();
        if (r < 0.15 && !sim.state.progression.coreActivated) {
          sim.state.progression.coreActivated = true;
          sim.areas.clear(PARK, true);
        } else if (r < 0.45 && sim.state.progression.coreActivated) {
          const id = sim.areas.nextGoal();
          if (id) {
            restoreArea(sim, id, rng.next() < 0.3);
            if (rng.next() < 0.5) meetSpecialty(sim, id);
            if (rng.next() < 0.6) sim.areas.clear(id);
          }
        }
        const st = sim.state.resources;
        st.energy = big(rng.next() < 0.3 ? 0 : rng.next() * 200);
        st.water = big(rng.next() < 0.3 ? 0 : rng.next() * 50);
        st.biomass = big(rng.next() < 0.3 ? 0 : rng.next() * 500);
        sim.state.harvestReadyAt = rng.next() < 0.5 ? sim.time + rng.range(1, 30) : 0;
        sim.advance(rng.range(0.1, 3));
        check(sim, `seed ${seed} step ${i}`);
      }
    }
  });

  it('names the nearest frontier', () => {
    const sim = new Sim(createInitialState(5));
    expect(sim.advisor.nearestFrontier()).toBeUndefined();
    sim.state.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    const f = sim.advisor.nearestFrontier()!;
    expect(sim.areas.fog(f.areaId)).not.toBe('cleared');
    for (const id of sim.areas.revealed()) if (id !== PARK && sim.areas.fog(id) !== 'cleared') expect(sim.areas.info(id).distance).toBeGreaterThanOrEqual(f.distance);
  });
});
