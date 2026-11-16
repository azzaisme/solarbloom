// The game works: a quick end-to-end check of the core loop on a real new game, for `npm test`.
// It boots a new game, plays a few minutes like a player would (pulse, build, let drones work), and
// saves and reloads. The deep checks (pacing, economy curves, soaks) live in `npm run test:full`.
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { toNum } from '../src/core/Big';
import { createInitialState } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';
import { fill, makeSim, rich } from './helpers';

SaveService.clock = () => 0;

const finite = (sim: Sim) =>
  (['energy', 'water', 'biomass'] as const).every((k) => Number.isFinite(toNum(sim.state.resources[k])) && toNum(sim.state.resources[k]) >= 0);

/** Pulses the first tile the player could pulse right now; true if it worked. */
function pulseOne(sim: Sim) {
  const t = sim.areas.tiles('park').find((x) => sim.restoration.checkPulse(x).ok);
  return t ? sim.restoration.pulse(t.id) : false;
}

describe('smoke: the game works', () => {
  it('a new game boots with a park to restore and energy to start with', () => {
    const sim = new Sim(createInitialState(42));
    expect(sim.areas.tiles('park').length).toBeGreaterThan(100);
    expect(sim.areas.counts('park').restored).toBeLessThan(sim.areas.tiles('park').length);
    expect(toNum(sim.state.resources.energy)).toBeGreaterThan(0);
    expect(finite(sim)).toBe(true);
  });

  it('a player pulse costs energy and restores a park tile', () => {
    const sim = new Sim(createInitialState(42));
    const before = sim.areas.counts('park').restored;
    const energy = toNum(sim.state.resources.energy);
    expect(pulseOne(sim)).toBe(true);
    expect(toNum(sim.state.resources.energy)).toBeLessThan(energy);
    sim.advance(3);
    expect(sim.areas.counts('park').restored).toBeGreaterThan(before);
  });

  it('three minutes of play: tiles keep getting restored, resources stay sane, the old drone turns up and works', () => {
    const sim = new Sim(createInitialState(42));
    const start = sim.areas.counts('park').restored;
    for (let s = 0; s < 180; s++) {
      pulseOne(sim);
      sim.advance(1);
      expect(finite(sim)).toBe(true);
    }
    expect(sim.areas.counts('park').restored).toBeGreaterThan(start + 10);
    expect(sim.state.drones.length).toBeGreaterThanOrEqual(1);
    expect(sim.state.stats.droneJobs).toBeGreaterThan(0);
  });

  it('building a drone hub adds a drone that restores tiles on its own', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 4, 4, 5, 5, 'restored');
    const drones = sim.state.drones.length;
    expect(sim.build.place('droneHub', 'r1', 4, 4)).toBeTruthy();
    expect(sim.state.drones.length).toBeGreaterThan(drones);
    const jobs = sim.state.stats.droneJobs;
    sim.advance(20);
    expect(sim.state.stats.droneJobs).toBeGreaterThan(jobs);
  });

  it('saves and loads back to the same game', () => {
    const sim = new Sim(createInitialState(42));
    for (let s = 0; s < 30; s++) {
      pulseOne(sim);
      sim.advance(1);
    }
    const saver = new SaveService(undefined);
    const json = saver.serialize(sim.state);
    const loaded = saver.deserialize(json);
    expect(loaded).toBeDefined();
    const again = new Sim(loaded!);
    expect(again.areas.counts('park').restored).toBe(sim.areas.counts('park').restored);
    expect(again.state.drones.length).toBe(sim.state.drones.length);
    expect(toNum(again.state.resources.biomass)).toBeCloseTo(toNum(sim.state.resources.biomass), 6);
    expect(saver.serialize(again.state)).toBe(json);
  });
});
