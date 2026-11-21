import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { Rng } from '../src/core/Rng';
import { Sim } from '../src/gameplay/Sim';
import { regionById } from '../src/core/OldCityLayout';
import { objectiveSentence } from '../src/ui/ObjectiveCard';

const TOPICS = ['charge', 'grid', 'water', 'farm', 'keeper', 'restore'];

function check(sim: Sim, label: string) {
  const g = sim.advisor.suggest();
  expect(g.text.length, label).toBeGreaterThan(10);
  expect(g.label.length, label).toBeGreaterThan(3);
  // E23.1.5: every hint belongs to the new loop, and none speaks of buying, upgrades or saving up.
  expect(TOPICS, label).toContain(g.topic);
  expect(g.text, label).not.toMatch(/upgrade|afford|save up|saving|buy|price/i);
  // E23.1.4: no energy, water or biomass counters left to speak of (charge is the only meter)
  expect(`${g.text} ${g.label}`, label).not.toMatch(/energy|biomass|harvest|storage|\bfull\b/i);
  const a = g.action;
  // Every suggestion is achievable now (or is an honest wait).
  if (a.kind === 'wake') {
    const m = sim.machine(a.machineId)!;
    expect(sim.areas.ready(sim.areas.areaOf(m)!), label).toBe(true);
  } else if (a.kind === 'focus' && g.topic === 'restore') expect(sim.restoration.checkPulse(sim.grid.get(a.layer ?? GROUND, a.x, a.z)!).ok, label).toBe(true);
  else if (a.kind === 'wait') expect(a.seconds, label).toBeGreaterThan(0);
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
    // E21.9: a region's landmark wakes once half of it is restored and its Keeper has asked for it
    sim.state.salvage.keepers[regionById(id)!.keeper] = { step: 'landmark' };
    expect(sim.areas.ready(id)).toBe(true);
    const g = check(sim, 'ready');
    expect(g.action).toEqual({ kind: 'wake', machineId: sim.areas.landmark(id)!.id });
  });

  it('reads the other sub-epics handles when they exist: charge, then power, then water (E23.1.5)', () => {
    const sim = new Sim(createInitialState(3));
    const loop = sim as unknown as Record<string, unknown>;
    // the same shape as E23.2's ChargeSystem: `low` below CHARGE.lowShare, `share` 0…1
    loop.charge = { low: true, share: 0.1 };
    expect(check(sim, 'low charge').topic).toBe('charge');
    loop.charge = { low: false, share: 1 };
    const m: MachineData = { id: sim.newId('m'), type: 'solar', roofId: GROUND, x: 1, z: 1, size: 1, boostUntil: 0, timer: 0, charge: 0 };
    sim.state.machines.push(m);
    loop.power = { isPowered: (x: MachineData) => x.id !== m.id };
    const g = check(sim, 'dark machine');
    expect(g.topic).toBe('grid');
    expect(g.action).toEqual({ kind: 'focus', x: 1, z: 1 });
    loop.power = { isPowered: () => true };
    loop.water = { isLow: (id: string) => id === PARK };
    expect(check(sim, 'low water').topic).toBe('water');
  });

  it('points at the next Keeper', () => {
    const sim = new Sim(createInitialState(3));
    sim.state.progression.coreActivated = true;
    const g = check(sim, 'old city');
    expect(['keeper', 'restore']).toContain(g.topic);
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
            if (rng.next() < 0.6) sim.areas.clear(id);
          }
        }
        // E23.1.4: the charge and the backpack are what's left to run short of
        sim.state.charge = { ...sim.state.charge, value: rng.next() < 0.3 ? 0 : rng.next() * sim.charge.max };
        sim.state.salvage.pack.biomass = rng.next() < 0.3 ? 0 : Math.floor(rng.next() * 40);
        sim.advance(rng.range(0.1, 3));
        check(sim, `seed ${seed} step ${i}`);
      }
    }
  });

  it('names the nearest frontier', () => {
    const sim = new Sim(createInitialState(5));
    // E23.1.1: the Old City opens with the park and the first region (Saltwind) in view, nothing else
    expect(sim.advisor.nearestFrontier()?.areaId).toBe('saltwind');
    sim.areas.clear(PARK, true);
    const f = sim.advisor.nearestFrontier()!;
    expect(sim.areas.fog(f.areaId)).not.toBe('cleared');
    for (const id of sim.areas.revealed()) if (id !== PARK && sim.areas.fog(id) !== 'cleared') expect(sim.areas.info(id).distance).toBeGreaterThanOrEqual(f.distance);
  });

  // E23.1.5: the cozy guarantee no-stall gave the classic advisor, rewritten for the Old City. A player who does
  // nothing but what the advisor says (walk there, then the one obvious action) wakes the fountain, starting from
  // a new game with nothing at all in the backpack.
  it('a fresh game with nothing in the backpack reaches fountain tier 1 by following the advisor alone', { timeout: 120_000 }, () => {
    const sim = new Sim(createInitialState(9));
    expect(Object.values(sim.state.salvage.pack).every((n) => !n)).toBe(true);
    const [fx, fz] = sim.areas.info(PARK).landmark;
    const fountain = sim.areas.landmark(PARK)!;
    const seen = new Set<string>();
    let followed = 0;
    while (sim.state.salvage!.tier < 1 && sim.time < 40 * 60) {
      const g = check(sim, `t=${sim.time.toFixed(0)}`);
      seen.add(g.topic);
      const a = g.action;
      if (a.kind === 'focus') {
        sim.bot = { roofId: a.layer ?? GROUND, x: a.x, z: a.z }; // walking there (the walk itself is E23.10.1's proof)
        const pile = sim.salvage.pileAt(a.x, a.z);
        const t = sim.grid.get(a.layer ?? GROUND, a.x, a.z);
        if (pile) while (sim.salvage.left(pile.id) > 0 && !sim.salvage.problem(pile.id) && sim.salvage.salvage(pile.id) > 0) sim.advance(1);
        else if (a.x === fx && a.z === fz) {
          sim.bot = { roofId: GROUND, x: fountain.x - 1, z: fountain.z };
          sim.fountain.giveAll();
        } else if (t && sim.restoration.checkPulse(t).ok) sim.restoration.pulse(t.id);
        followed++;
      }
      sim.advance(a.kind === 'wait' ? a.seconds : 1.5);
    }
    expect(sim.state.salvage!.tier, `stuck at t=${sim.time.toFixed(0)}: "${sim.advisor.suggest().text}"`).toBe(1);
    expect(followed).toBeGreaterThan(20);
    expect([...seen].every((t) => ['keeper', 'restore'].includes(t))).toBe(true); // no charge, grid or water yet
    // eslint-disable-next-line no-console
    console.log(`advisor alone: fountain tier 1 at ${(sim.time / 60).toFixed(1)} min, ${followed} steps followed`);
  });

  it('speaks through the objective card: a shortage in the loop first (under the goal, #605), the next step once the fountain is done', () => {
    const sim = new Sim(createInitialState(4));
    expect(objectiveSentence(sim).text).toMatch(/fountain/); // a new game: wake the fountain
    expect(objectiveSentence(sim).parts?.map((p) => p.label)).toEqual(['Scrap', 'Seeds', 'Park']);
    (sim as unknown as Record<string, unknown>).charge = { low: true, share: 0.1 };
    expect(objectiveSentence(sim).next).toMatch(/running low/);
    expect(objectiveSentence(sim).text).toMatch(/fountain/); // #605: the goal never disappears
    (sim as unknown as Record<string, unknown>).charge = { low: false, share: 0.9 };
    sim.state.salvage!.tier = 5; // every tier done
    const g = sim.advisor.suggest();
    expect(objectiveSentence(sim).text).toBe(g.text);
  });
});
