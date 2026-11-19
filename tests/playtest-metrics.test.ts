import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { wakeNextArea } from './helpers';

describe('local playtest instrumentation (City 09.7)', () => {
  it('records the time to each area and summarises a session readably', () => {
    const sim = new Sim(createInitialState(9));
    sim.state.progression.coreActivated = true;
    sim.state.progression.coreActivatedAt = 400;
    sim.areas.clear(PARK, true);
    for (let i = 0; i < 25; i++) {
      sim.advance(30);
      expect(wakeNextArea(sim)).toBe(true); // E23.1.1: through the gates, as a player would
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
