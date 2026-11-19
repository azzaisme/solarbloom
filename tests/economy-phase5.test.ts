import { describe, expect, it } from 'vitest';
import { big, toNum } from '../src/core/Big';
import { createInitialState, GROUND } from '../src/core/GameState';
import { PARK } from '../src/core/Areas';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { regionById } from '../src/core/OldCityLayout';
import { fill, makeSim, PAD, rich } from './helpers';


describe('Phase 5 E12: uncapped biomass', () => {
  // E23.5.1 / E23.1.1: biomass is gathered into the backpack in stacks, so no store ever caps it (and the old
  // counter no longer grows); a full energy store still caps
  it('biomass is never capped by a store; a full energy store still caps', () => {
    const sim = new Sim(createInitialState(4));
    sim.state.resources.biomass = big(99);
    sim.econ.add('biomass', 1e6);
    expect(toNum(sim.state.resources.biomass)).toBe(99); // the counter is gone from play
    expect(sim.econ.cap('biomass')).toBeUndefined();
    expect(sim.econ.isFull('biomass')).toBe(false);
    // a backpack stack has a limit, the store at the shed has none: past 100 and still growing
    expect(sim.inventory.add('biomass', sim.inventory.stackLimit())).toBe(0);
    sim.inventory.addToStore('biomass', 1e6);
    expect(sim.inventory.stored('biomass')).toBe(1e6);
    sim.econ.add('energy', 1e6);
    expect(sim.econ.isFull('energy')).toBe(true);
  });

  it('Seed Vault still grows energy and water, never biomass', () => {
    const sim = new Sim(createInitialState(4));
    sim.state.resources.biomass = big(1e6);
    expect(sim.upgrades.grant('seedVault')).toBeGreaterThan(0);
    expect(toNum(sim.state.caps.energy)).toBe(TUNING.storageTiers.energy[1]);
    expect(toNum(sim.state.caps.water)).toBe(TUNING.storageTiers.water[1]);
    expect(sim.econ.cap('biomass')).toBeUndefined();
  });
});

describe('Phase 5 E12: per-machine upgrades', () => {
  it('a level belongs to the machine it was bought for; others keep theirs', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    const a = sim.build.place('solar', PAD, 5, 5)!;
    const b = sim.build.place('solar', PAD, 6, 6)!;
    const e0 = sim.production.solarOutput(b, true);
    expect(sim.upgrades.grant('solarArray', a.id)).toBeGreaterThan(0);
    expect(sim.upgrades.levelOf(a, 'solarArray')).toBe(1);
    expect(sim.upgrades.levelOf(b, 'solarArray')).toBe(0);
    expect(sim.production.solarOutput(b, true)).toBe(e0);
    expect(sim.production.solarOutput(a, true)).toBeCloseTo(e0 * 1.5, 9);
  });

  it('a grant for a machine that is gone, or of the wrong type, changes nothing (E23.1.5)', () => {
    const sim = makeSim();
    expect(sim.upgrades.grant('solarArray', 'm-gone')).toBe(0);
    const core = sim.state.machines.find((m) => m.type === 'core')!;
    expect(sim.upgrades.grant('solarArray', core.id)).toBe(0);
    expect(sim.upgrades.levelOf(core, 'solarArray')).toBe(0);
  });
});

describe('Phase 5 E12: smaller goals and no specialty stall', () => {
  it('city areas pay rewarded steps at 25 / 50 / 75% of what their landmark needs, once each', () => {
    const sim = new Sim(createInitialState(7));
    sim.areas.clear(PARK, true);
    const id = sim.areas.revealed().find((a) => a !== PARK)!;
    const steps: number[] = [];
    sim.bus.on('area.step', ({ step }) => steps.push(step));
    const need = sim.areas.need(id);
    let done = 0;
    for (let pass = 0; pass < 200 && done < need; pass++)
      for (const t of sim.areas.entryTiles(id)) {
        if (done >= need) break;
        if (!sim.restoration.isEligible(t)) continue;
        sim.restoration.complete(t, 'pulse');
        done++;
      }
    expect(steps).toEqual([1, 2, 3]);
    sim.areas.checkSteps(id);
    expect(steps).toEqual([1, 2, 3]); // never twice
    expect(sim.state.areas[id].steps).toBe(3);
  });

  it('an area restored all the way is ready to wake', () => {
    const sim = new Sim(createInitialState(7));
    sim.areas.clear(PARK, true);
    const id = sim.areas.revealed().find((a) => a !== PARK)!;
    for (let pass = 0; pass < 400; pass++) {
      const open = sim.areas.entryTiles(id).filter((t) => sim.restoration.isEligible(t));
      if (!open.length) break;
      for (const t of open) sim.restoration.complete(t, 'pulse');
    }
    const c = sim.areas.counts(id);
    expect(c.restored).toBe(c.restorable);
    // E21.9: and once its Keeper asks for the landmark (no material or specialty stall on top)
    expect(sim.areas.ready(id)).toBe(false);
    sim.state.salvage.keepers[regionById(id)!.keeper] = { step: 'landmark' };
    expect(sim.areas.ready(id)).toBe(true);
    void GROUND;
  });
});
