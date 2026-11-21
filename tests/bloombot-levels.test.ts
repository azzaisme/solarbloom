import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { CHARGE } from '../src/data/charge';
import { COMPONENT_RECIPES } from '../src/data/crafting';
import { PULSE_LOADS } from '../src/data/pulse';
import { PROJECTS, RESEARCH, RESEARCH_UPGRADES } from '../src/data/research';
import { Sim } from '../src/gameplay/Sim';

/**
 * #623 (E25): the five Bloombot upgrades go to five levels. Levels 4 and 5 are priced in late materials, every level
 * changes something in its own system, and the numbers stay sane at level 5.
 */
const BLOOMBOT = ['chargeCells', 'chargeEfficiency', 'sprint', 'pulseRadius', 'backpack'];
const LATE = new Set(['sunCell', 'sunstone', 'motor', 'batteryCell']);

/** a game with every Bloombot project done and plenty of everything in store */
function ready() {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.tier = 1;
  sim.bot = { roofId: GROUND, x: 8.5, z: 11.5 }; // by the house (the table)
  sim.state.salvage!.keepers.pylon = { step: 'request1' }; // research runs once a Keeper is awake
  sim.state.salvage!.research = { analysed: [], done: PROJECTS.map((p) => p.id), running: [], levels: {} };
  for (const m of ['scrap', 'seeds', 'copper', 'gears', 'wire', 'planks', 'clay', 'glassPane', 'batteryCell', 'motor', 'sunCell', 'sunstone'] as const) sim.inventory.addToStore(m, 200);
  return sim;
}

/** what each level reads as, in its own system */
function reading(sim: Sim, id: string): number {
  switch (id) {
    case 'chargeCells':
      return sim.charge.max;
    case 'chargeEfficiency':
      return -sim.charge.cost('pulse');
    case 'sprint':
      return -sim.charge.cost('sprint');
    case 'pulseRadius':
      return sim.restoration.pulseRadius();
    default:
      return sim.inventory.stackLimit();
  }
}

describe('#623: levels 4 and 5 for every Bloombot upgrade', () => {
  it('each of the five has five levels, and 4 and 5 cost only late things', () => {
    for (const id of BLOOMBOT) {
      const u = RESEARCH_UPGRADES.find((q) => q.id === id)!;
      expect(u.levels.length, id).toBe(5);
      for (const l of u.levels.slice(3)) {
        const parts = Object.keys(l.cost);
        expect(parts.some((k) => k === 'sunCell' || k === 'sunstone' || k === 'motor'), `${id}: ${parts}`).toBe(true);
        for (const k of parts) expect(LATE.has(k), `${id}: ${k}`).toBe(true);
      }
      // level 5 asks for more than level 4 (a made part counts as what goes into it: a Sun cell is 2, a Motor 3)
      const worth = (k: string) => {
        const r = COMPONENT_RECIPES.find((c) => c.id === k);
        return r ? Object.values(r.cost).reduce((a, n) => a + (n ?? 0), 0) / r.makes : 1;
      };
      const size = (i: number) => Object.entries(u.levels[i].cost).reduce((a, [k, n]) => a + worth(k) * (n ?? 0), 0);
      expect(size(4), id).toBeGreaterThan(size(3));
    }
  });

  it('every level, 1 to 5, changes something in its own system', () => {
    for (const id of BLOOMBOT) {
      const sim = ready();
      let before = reading(sim, id);
      for (let lvl = 1; lvl <= 5; lvl++) {
        expect(sim.research.upgrade(id), `${id} level ${lvl}`).toBe(lvl);
        const now = reading(sim, id);
        expect(now, `${id} level ${lvl}`).toBeGreaterThan(before);
        before = now;
      }
      expect(sim.research.upgrade(id), id).toBe(0);
      expect(sim.research.upgradeProblem(id)).toBe('As good as it gets');
    }
  });

  it('the numbers at level 5 stay sane', () => {
    const sim = ready();
    for (const id of BLOOMBOT) for (let i = 0; i < 5; i++) sim.research.upgrade(id);
    // charge: 100 + 5 cells of 25
    expect(sim.charge.max).toBe(CHARGE.max + 5 * CHARGE.cellCapacity);
    // a pulse costs about 0.59 of what it did; sprinting half as much again, and a quarter faster
    expect(sim.charge.cost('pulse')).toBeCloseTo(CHARGE.pulse * 0.9 ** 5, 6);
    expect(sim.charge.cost('sprint')).toBeCloseTo(CHARGE.sprintPerSecond * 0.9 ** 5 * 0.5, 6);
    expect(1 + RESEARCH.sprintSpeedPerLevel * sim.research.level('sprint')).toBeCloseTo(1.25, 6);
    // stacks: 100 more than without the upgrade
    const plain = new Sim(createInitialState(7));
    plain.state.salvage!.tier = 1;
    expect(sim.inventory.stackLimit()).toBe(plain.inventory.stackLimit() + 100);
  });

  it('Wider pulse: levels 1 to 3 as before, then a tile each, and never past the cap', () => {
    const sim = ready();
    const r = [sim.restoration.pulseRadius()];
    for (let i = 0; i < 5; i++) {
      sim.research.upgrade('pulseRadius');
      r.push(sim.restoration.pulseRadius());
    }
    expect(r).toEqual([0, 1.5, 2.9, 4.5, 5.5, 6.5]);
    // a fertiliser load (a tier further) and an overcharge on top: still within the widest a pulse goes
    const fert = PULSE_LOADS.find((l) => l.id === 'fertiliser')!.extraReach;
    expect(sim.restoration.pulseRadius(false, fert)).toBe(RESEARCH.pulseMaxRadius);
    expect(sim.restoration.pulseRadius(true, fert)).toBe(RESEARCH.pulseMaxRadius);
    expect(RESEARCH.pulseMaxRadius).toBeLessThan(9);
  });

  it("a level 3 pulse with fertiliser reaches as far as it did before #623", () => {
    const sim = ready();
    for (let i = 0; i < 3; i++) sim.research.upgrade('pulseRadius');
    expect(sim.restoration.pulseRadius(false, 1)).toBe(7.1);
    expect(sim.restoration.pulseRadius(true)).toBe(7.1);
  });
});
