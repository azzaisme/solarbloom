import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';

describe('local playtest instrumentation (City 09.7)', () => {
  it('records the time to each area and summarises a session readably', () => {
    const sim = new Sim(createInitialState(9));
    sim.state.progression.coreActivated = true;
    sim.state.progression.coreActivatedAt = 400;
    sim.areas.clear(PARK, true);
    for (let i = 0; i < 25; i++) {
      sim.advance(30);
      sim.areas.clear(sim.areas.nextGoal()!, true);
    }
    sim.state.stats.maxCombo = 87;
    sim.state.stats.catsFound = 4;
    const times = sim.state.stats.areaTimes!;
    expect(times).toHaveLength(25);
    expect(times[1] - times[0]).toBe(30);
    const text = sim.metrics.summary();
    expect(text).toContain('Areas cleared 25');
    expect(text).toContain('Biggest chain ×87');
    expect(text).toContain('Lucky Cats found 4');
    expect(text).toMatch(/Time to each area: #1 \d+:\d\d/);
    expect(text).toContain('… #25');
    expect(text.split('\n').length).toBeLessThanOrEqual(10); // short enough to paste anywhere
  });

  it('the timings survive save and load', () => {
    const sim = new Sim(createInitialState(10));
    sim.state.progression.coreActivated = true;
    sim.areas.clear(PARK, true);
    sim.advance(20);
    sim.areas.clear(sim.areas.nextGoal()!, true);
    sim.state.stats.stuckSeconds = 12;
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.state.stats.areaTimes).toEqual(sim.state.stats.areaTimes);
    expect(copy.metrics.summary()).toBe(sim.metrics.summary());
  });
});

describe('incremental metrics (City 06.5)', () => {
  it('stuck time counted incrementally matches checking every upgrade every tick', async () => {
    const { createInitialState: create } = await import('../src/core/GameState');
    const { Sim: S } = await import('../src/gameplay/Sim');
    const { TUNING: T } = await import('../src/data/tuning');
    const sim = new S(create(3));
    let naive = 0;
    const naiveTick = () => {
      const s = sim;
      const minPulse = T.pulse.prepared.energy * s.upgrades.pulseEnergyMult;
      if (s.econ.get('energy') >= minPulse && s.econ.get('water') >= 1) return;
      if (s.time >= s.state.harvestReadyAt) return;
      if (s.upgrades.all().some((u) => s.upgrades.status(u).ok)) return;
      naive += T.simStep;
    };
    const st = sim.state;
    for (let round = 0; round < 6; round++) {
      // Broke, harvest cooling down: stuck until income buys something; sometimes an upgrade gets bought.
      st.resources.energy = 0;
      st.resources.water = 0;
      st.resources.biomass = round * 15;
      st.harvestReadyAt = sim.time + 40;
      for (let i = 0; i < 300; i++) {
        sim.tick();
        naiveTick(); // same moment as Metrics.tick: after the tick's production
        if (i === 150) {
          const up = sim.upgrades.all().find((u) => sim.upgrades.status(u).ok);
          if (up) sim.upgrades.purchase(up.id);
        }
      }
    }
    expect(st.stats.stuckSeconds).toBeGreaterThan(5);
    expect(st.stats.stuckSeconds).toBeCloseTo(naive, 5);
  });
});
