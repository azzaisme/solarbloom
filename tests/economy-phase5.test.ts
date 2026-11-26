import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { PARK } from '../src/core/Areas';
import { Sim } from '../src/gameplay/Sim';
import { regionById } from '../src/core/OldCityLayout';
import { fill, makeSim, PAD, rich } from './helpers';

/** full daylight, so a panel's output is its whole rating */
const DAY = { sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 };

describe('Phase 5 E12: uncapped biomass', () => {
  // E23.5.1 / E23.1.1 / E23.1.4: biomass is gathered into the backpack in stacks, so no store ever caps it
  it('biomass is never capped by a store', () => {
    const sim = new Sim(createInitialState(4));
    // a backpack stack has a limit, the store at the shed has none: past 100 and still growing
    expect(sim.inventory.add('biomass', sim.inventory.stackLimit())).toBe(0);
    sim.inventory.addToStore('biomass', 1e6);
    expect(sim.inventory.stored('biomass')).toBe(1e6);
  });
});

describe('Phase 5 E12: per-machine upgrades', () => {
  it('a level belongs to the machine it was bought for; others keep theirs', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    const a = sim.build.place('solar', PAD, 5, 5)!;
    const b = sim.build.place('solar', PAD, 6, 6)!;
    const e0 = sim.power.output(b, DAY);
    expect(e0).toBeGreaterThan(0);
    expect(sim.upgrades.grant('solarArray', a.id)).toBeGreaterThan(0);
    expect(sim.upgrades.levelOf(a, 'solarArray')).toBe(1);
    expect(sim.upgrades.levelOf(b, 'solarArray')).toBe(0);
    expect(sim.power.output(b, DAY)).toBe(e0);
    expect(sim.power.output(a, DAY)).toBeCloseTo(e0 * 1.5, 9);
  });

  it('a grant for a machine that is gone, or of the wrong type, changes nothing (E23.1.5)', () => {
    const sim = makeSim();
    expect(sim.upgrades.grant('solarArray', 'm-gone')).toBe(0);
    const core = sim.state.machines.find((m) => m.type === 'core')!;
    expect(sim.upgrades.grant('solarArray', core.id)).toBe(0);
    expect(sim.upgrades.levelOf(core, 'solarArray')).toBe(0);
  });
});

describe('Phase 5 E12: no specialty stall', () => {
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
    // #787: a gated region's landmark also waits on its works (power, water or drones) until they run
    if (sim.works.gated(id)) {
      expect(sim.areas.ready(id)).toBe(false);
      sim.works.start(id);
    }
    expect(sim.areas.ready(id)).toBe(true);
    void GROUND;
  });
});
