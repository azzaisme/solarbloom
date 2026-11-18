import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { DAY, DAY_SECONDS, gameDays, gameMinutes, NIGHT_FINDS } from '../src/data/time';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

/**
 * E23.7.1.1 (#445): every timer counts in game days. Two halves: nothing in the simulation reads the real clock
 * (so no timer can run on real time), and each E23 timer is written in game time (data/time) and takes exactly
 * that much play, the same in both clock modes, whatever the real clock does.
 */
const oldSim = (seed = 7) => new Sim(createInitialState(seed, 'oldcity'));
const at = (h: number) => () => new Date(2026, 10, 18, h, 0, 0);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Runs a sim in one clock mode with the real clock stuck at 02:00, until `done`; returns the ticks it took. */
function ticksUntil(real: boolean, setup: (s: Sim) => void, done: (s: Sim) => boolean, max = 200_000): number {
  const sim = oldSim();
  sim.clock.now = at(2);
  sim.clock.real = real;
  setup(sim);
  let n = 0;
  while (!done(sim) && n < max) {
    sim.tick();
    n++;
  }
  return n;
}

afterEach(() => vi.useRealTimers());

describe('E23.7.1.1: every timer counts in game days', () => {
  it('nothing in the simulation reads the real clock (only Clock, for the sky in "follow my clock" mode)', { timeout: 120_000 }, () => {
    const offenders: string[] = [];
    for (const f of [...files('src/gameplay'), ...files('src/core'), ...files('src/data')]) {
      const src = readFileSync(f, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/Date\.now\(|new Date\(|performance\.now\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders.filter((o) => !o.replace(/\\/g, '/').endsWith('src/gameplay/Clock.ts:27') && !/Clock\.ts/.test(o))).toEqual([]);
  });

  it('the E23 timers are written in game time', () => {
    expect(TUNING.pulse.growSeconds).toBe(gameMinutes(0.4));
    expect(TUNING.cultivator.growSeconds).toBe(gameMinutes(1.5));
    expect(TUNING.drone.old.cycleSeconds).toBe(gameMinutes(3.5));
    expect(TUNING.drone.old.workSeconds).toBe(gameMinutes(0.4));
    expect(gameDays(1)).toBe(DAY_SECONDS);
  });

  it('a pulse blooms in the same play time in both clock modes, and moving the real clock changes nothing', { timeout: 120_000 }, () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 2, 0, 0));
    const pulse = (s: Sim) => {
      const t = s.grid.get(GROUND, 7, 4)!;
      s.restoration.beginGrowth(t, 'pulse', TUNING.pulse.growSeconds);
      // the real clock jumps a whole day forward mid-growth: nothing in the sim may notice
      vi.setSystemTime(new Date(2026, 10, 19, 14, 0, 0));
    };
    const done = (s: Sim) => s.grid.get(GROUND, 7, 4)!.ground === 'restored';
    const game = ticksUntil(false, pulse, done);
    const real = ticksUntil(true, pulse, done);
    expect(game).toBe(Math.round(TUNING.pulse.growSeconds / TUNING.simStep));
    expect(real).toBe(game);
  });

  it('night finds come back after one game night, in game time', { timeout: 120_000 }, () => {
    const sim = oldSim();
    const f = NIGHT_FINDS[0];
    const now = sim.clock.gameSeconds();
    sim.state.clock = { offset: now - sim.state.time + (DAY.dayShare + 0.05) * DAY_SECONDS - (now % DAY_SECONDS) };
    sim.nightFinds.take(f.id);
    expect(sim.nightFinds.visible(f.id)).toBe(false);
    sim.advance(gameDays(1) - 1);
    expect(sim.nightFinds.visible(f.id)).toBe(true);
  });

  it('E23.7.2: the weather turns once a game day, at dawn on the game clock, in both clock modes', { timeout: 120_000 }, () => {
    for (const real of [false, true]) {
      const sim = oldSim(5);
      sim.clock.now = at(2);
      sim.clock.real = real;
      const days: number[] = [];
      sim.bus.on('weather.changed', (e) => days.push(e.day));
      sim.advance(gameDays(2));
      expect(days, real ? 'follow my clock' : 'own day').toEqual([2, 3]);
    }
  });

  it('growth can ask whether it is night on the game clock, which "follow my clock" never changes', () => {
    const sim = oldSim();
    sim.clock.now = at(13); // the real midday
    sim.clock.real = true;
    const now = sim.clock.gameSeconds();
    sim.state.clock = { ...sim.state.clock!, offset: now - sim.state.time + 0.8 * DAY_SECONDS - (now % DAY_SECONDS) };
    expect(sim.clock.isDay()).toBe(true); // the sky follows the real midday
    expect(sim.clock.gameIsNight()).toBe(true); // growth follows the game's night
    expect(sim.clock.gameDayFraction()).toBeCloseTo(0.8, 6);
    sim.clock.real = false;
    expect(sim.clock.isNight()).toBe(true);
  });
});
