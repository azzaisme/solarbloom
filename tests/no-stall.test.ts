import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

/** The laziest possible player: follows the advisor's suggestion every few seconds, nothing else. */
function followAdvisor(sim: Sim, seconds: number, until: () => boolean): number {
  const t0 = sim.time;
  while (sim.time - t0 < seconds) {
    if (until()) return sim.time - t0;
    const g = sim.advisor.suggest();
    const a = g.action;
    if (a.kind === 'wake') {
      const m = sim.machine(a.machineId)!;
      const id = sim.areas.areaOf(m)!;
      if (id === PARK) sim.progression.activateCore();
      else sim.areas.clear(id);
    } else if (a.kind === 'focus') {
      // Pulse there, and every other affordable edge tile nearby (as a player would, tapping along the edge).
      for (let i = 0; i < 6; i++) {
        const t = sim.grid.get(GROUND, a.x, a.z)!;
        if (!sim.restoration.pulse(t.id)) break;
        const g2 = sim.advisor.suggest();
        if (g2.action.kind !== 'focus') break;
        Object.assign(a, g2.action);
      }
    } else if (a.kind === 'district') sim.districts.bloom(a.districtId);
    else if (a.kind === 'build') sim.build.place(a.type, GROUND, a.x, a.z);
    else if (a.kind === 'harvest') sim.harvestSun();
    else if (a.kind === 'upgrades') {
      const up = sim.upgrades.all().find((d) => sim.upgrades.status(d).ok);
      if (up) sim.upgrades.purchase(up.id);
    }
    sim.advance(2);
  }
  return Infinity;
}

function fill(sim: Sim, id: string) {
  for (const t of sim.areas.tiles(id)) {
    if (!isRestorable(t, sim.state.machines)) continue;
    t.ground = 'restored';
    t.bloom = TUNING.restore.maxBloom;
    t.pollution = 0;
    sim.grid.touch(t);
  }
}

function pack(sim: Sim, id: string, type: MachineData['type'] = 'solar') {
  for (const t of sim.areas.tiles(id)) {
    if (t.blocked || t.occupantId || sim.isCoreTile(t)) continue;
    const m: MachineData = { id: sim.newId('m'), type, roofId: GROUND, x: t.x, z: t.z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
    sim.state.machines.push(m);
    sim.grid.indexMachine(m);
    t.occupantId = m.id;
  }
  sim.production.markDirty();
}

const broke = (sim: Sim) => {
  const r = sim.state.resources;
  r.energy = r.water = r.biomass = 0;
};

describe('no-stall guarantees (City 09.5)', () => {
  it('a fresh park with nothing at all in the bank still reaches the fountain', { timeout: 60000 }, () => {
    const sim = new Sim(createInitialState(11));
    broke(sim);
    const t = followAdvisor(sim, 30 * 60, () => sim.state.progression.coreActivated);
    console.log(`  fountain from nothing: ${(t / 60).toFixed(1)} min`); // eslint-disable-line no-console
    expect(t).toBeLessThan(30 * 60);
  });

  it('park fully bloomed and packed with machines, broke: the next area still clears', { timeout: 60000 }, () => {
    const sim = new Sim(createInitialState(12));
    sim.state.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    fill(sim, PARK);
    pack(sim, PARK, 'pollinator');
    broke(sim);
    const goal = sim.areas.nextGoal()!;
    const t = followAdvisor(sim, 45 * 60, () => sim.areas.fog(goal) === 'cleared');
    console.log(`  next area, park packed and broke: ${(t / 60).toFixed(1)} min`); // eslint-disable-line no-console
    expect(t).toBeLessThan(45 * 60);
  });

  it('40 areas out, back to starting storage and empty pockets: another area still clears', { timeout: 120000 }, () => {
    const sim = new Sim(createInitialState(13));
    sim.state.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    // Clear a long way out so the frontier is at high difficulty, then lose everything.
    for (let i = 0; i < 40; i++) {
      const id = sim.areas.nextGoal()!;
      fill(sim, id);
      sim.areas.clear(id);
    }
    broke(sim);
    Object.assign(sim.state.caps, TUNING.start.caps); // and back to the starting storage
    const goal = sim.areas.revealed().filter((id) => sim.areas.fog(id) !== 'cleared').sort((a, b) => sim.areas.info(b).distance - sim.areas.info(a).distance)[0];
    expect(sim.areas.info(goal).difficulty).toBeGreaterThan(1.3);
    const before = cleared(sim);
    const t = followAdvisor(sim, 90 * 60, () => cleared(sim) > before);
    console.log(`  far area at starting storage: ${(t / 60).toFixed(1)} min`); // eslint-disable-line no-console
    expect(t).toBeLessThan(90 * 60);
  });

  it('every revealed area always has a wake target it can reach (need never exceeds what can be restored)', () => {
    const sim = new Sim(createInitialState(14));
    sim.state.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    for (let i = 0; i < 30; i++) {
      for (const id of sim.areas.revealed()) {
        if (sim.areas.fog(id) === 'cleared') continue;
        const c = sim.areas.counts(id);
        expect(sim.areas.need(id), id).toBeLessThanOrEqual(Math.max(1, c.restorable));
      }
      const id = sim.areas.nextGoal()!;
      // Machines built all over part of it shrink what can be restored; the need follows.
      pack(sim, id);
      fill(sim, id);
      sim.areas.clear(id);
    }
  });
});

function cleared(sim: Sim) {
  return sim.areas.revealed().filter((id) => sim.areas.fog(id) === 'cleared').length;
}
