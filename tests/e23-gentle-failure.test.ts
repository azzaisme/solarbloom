import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { PARK } from '../src/core/Areas';
import { Sim } from '../src/gameplay/Sim';
import { spawnPose, Walker } from '../src/gameplay/Walker';
import { CHARGE, forceStorm, GAME_DAY, GentleWatch, homeScene, PROBES, resetTrippedPoles, saveText, weather } from './e23-gentle';

/**
 * E23.10.1 (#405): the gentle-failure suite, on seeds 7 and 21. Epic #354 rule 2: a shortage is a puzzle, never a
 * loss. Each check names the system it covers and skips until that system is on `testing` (see tests/e23-gentle.ts
 * for how each is found). The checks that need no E23 system (ground never goes back, builds stay, determinism)
 * run from day one and guard everything the other sub-epics add.
 */
const SEEDS = [7, 21];
// Detect which systems exist once, at collection time, so the skips show in the report.
const probeSim = new Sim(createInitialState(7, 'oldcity'));
const has = (name: string) => !!PROBES.find((p) => p.name === name)!.find(probeSim);
const hasWeather = !!weather(probeSim);

describe('E23.10.1: the gentle-failure proof', () => {
  it('the watch itself: the home scene has ground in every state and machines, and a break is caught', () => {
    const sim = homeScene(7);
    const mast = sim.areas.tiles('mastRow');
    for (const g of ['prepared', 'growing', 'restored'] as const) expect(mast.some((t) => t.ground === g), g).toBe(true);
    expect(sim.state.machines.filter((m) => !m.starter).length).toBeGreaterThanOrEqual(2);
    const w = new GentleWatch(sim);
    w.run(10);
    expect(w.violations).toEqual([]);
    const restored = mast.find((t) => t.ground === 'restored')!;
    restored.ground = 'growing';
    const prepared = mast.find((t) => t.ground === 'prepared')!;
    prepared.ground = 'polluted';
    const lost = sim.state.machines.find((m) => !m.starter)!;
    sim.state.machines = sim.state.machines.filter((m) => m !== lost);
    w.check();
    expect(w.violations.some((v) => v.includes('restored dropped to growing'))).toBe(true);
    expect(w.violations.some((v) => v.includes('back to dead ground'))).toBe(true);
    expect(w.violations.some((v) => v.includes(`${lost.id} was lost`))).toBe(true);
  });

  for (const seed of SEEDS) {
    describe(`seed ${seed}`, () => {
      it('a quiet game day: nothing goes back to dead ground, nothing restored fades, nothing built is lost', () => {
        const sim = homeScene(seed);
        const w = new GentleWatch(sim);
        w.run(GAME_DAY);
        expect(w.violations).toEqual([]);
      });

      for (const p of PROBES)
        it.skipIf(!has(p.name))(`${p.name} runs out: nothing lost, and it all comes back`, () => {
          const sim = homeScene(seed);
          const w = new GentleWatch(sim);
          p.drain(sim);
          w.run(GAME_DAY / 4);
          expect(w.violations).toEqual([]);
          p.refill(sim);
          w.run(120);
          expect(w.violations).toEqual([]);
          expect(p.unrecovered(sim)).toEqual([]);
        });

      it.skipIf(!PROBES.some((p) => has(p.name)))('everything runs out at once through a game day', () => {
        const sim = homeScene(seed);
        const w = new GentleWatch(sim);
        const live = PROBES.filter((p) => p.find(sim));
        for (const p of live) p.drain(sim);
        w.run(GAME_DAY);
        expect(w.violations).toEqual([]);
        for (const p of live) p.refill(sim);
        w.run(120);
        expect(w.violations).toEqual([]);
        expect(live.flatMap((p) => p.unrecovered(sim))).toEqual([]);
      });

      it.skipIf(!hasWeather)('a storm destroys nothing, and a tripped pole resets with one press', () => {
        const sim = homeScene(seed);
        const w = new GentleWatch(sim);
        expect(forceStorm(sim, GAME_DAY / 8)).toBe(true);
        w.run(GAME_DAY / 8);
        expect(w.violations).toEqual([]);
        resetTrippedPoles(sim);
        w.run(60);
        expect(w.violations).toEqual([]);
        expect(PROBES.filter((p) => p.find(sim)).flatMap((p) => p.unrecovered(sim))).toEqual([]);
      });

      it.skipIf(!has('charge'))('at zero charge bloombot is never stranded: it can still walk home from Mast Row', () => {
        const sim = homeScene(seed);
        const w = new GentleWatch(sim);
        CHARGE.drain(sim);
        w.check();
        expect(w.violations).toEqual([]);
        const walker = new Walker(sim);
        const pose = spawnPose(sim, walker);
        const mast = sim.areas.tiles('mastRow').find((t) => t.ground === 'restored' && !t.occupantId && !t.blocked)!;
        const fountain = sim.areas.landmark(PARK)!;
        const out = walker.path(GROUND, pose.x, pose.z, (x, z) => x === mast.x && z === mast.z, { x: mast.x, z: mast.z });
        expect(out, 'walk out to Mast Row').toBeTruthy();
        const last = out![out!.length - 1] ?? pose;
        const home = walker.path(GROUND, last.x, last.z, (x, z) => Math.abs(x - fountain.x) <= 2 && Math.abs(z - fountain.z) <= 2, { x: fountain.x, z: fountain.z });
        expect(home, 'walk home to the fountain').toBeTruthy();
      });

      it('determinism: the same seed and inputs give byte-identical saves', () => {
        const play = () => {
          const sim = homeScene(seed);
          const t = sim.areas.tiles('mastRow').find((x) => x.ground === 'prepared');
          if (t) sim.restoration.pulse(t.id);
          sim.advance(300);
          return saveText(sim);
        };
        const a = play();
        const b = play();
        expect(a.length).toBeGreaterThan(1000);
        expect(a === b).toBe(true);
      });
    });
  }
});
