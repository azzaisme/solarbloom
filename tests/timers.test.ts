import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { DAY, DAY_SECONDS, gameDays, gameMinutes, NIGHT_FINDS } from '../src/data/time';
import { SALVAGE } from '../src/data/salvage';
import { TUNING } from '../src/data/tuning';
import { GATHER } from '../src/data/farm';
import { PROJECTS } from '../src/data/research';
import { KEEPERS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';

/**
 * E23.7.1.1 (#445): every timer counts in game days. Two halves: nothing in the simulation reads the real clock
 * (so no timer can run on real time), and each E23 timer is written in game time (data/time) and takes exactly
 * that much play, the same in both clock modes, whatever the real clock does.
 */
const oldSim = (seed = 7) => new Sim(createInitialState(seed));
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

  it('E23.5.1: clipped ground grows back in the same play time in both clock modes, whatever the real clock does', { timeout: 300_000 }, () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 2, 0, 0));
    /** Seconds of play from clipping a flowered tile until it can be gathered again (whole-sim ticks of 1 s). */
    const regrow = (real: boolean): number => {
      const sim = oldSim();
      sim.clock.now = at(2);
      sim.clock.real = real;
      const t = sim.grid.get(GROUND, 10, 14)!;
      t.blocked = false;
      t.ground = 'restored';
      t.pollution = 0;
      t.bloom = 2;
      sim.grid.touch(t);
      expect(sim.gather.gather(t)).toBeGreaterThan(0);
      // the real clock jumps a whole day forward mid-regrow: nothing in the sim may notice
      vi.setSystemTime(new Date(2026, 10, 19, 14, 0, 0));
      let n = 0;
      while (!sim.gather.canGather(t) && n < 10_000) {
        sim.tick(1);
        n++;
      }
      return n;
    };
    const game = regrow(false);
    expect(game).toBe(Math.ceil(gameDays(GATHER.regrowDays)));
    expect(regrow(true)).toBe(game);
  });

  it('E23.6.2: a research project takes its game days of play in both clock modes, whatever the real clock does', { timeout: 300_000 }, () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 2, 0, 0));
    const p = PROJECTS.find((x) => x.id === 'pw-lines')!;
    const start = (s: Sim) => {
      s.state.salvage!.tier = 1;
      s.state.salvage!.keepers.pylon = { step: 'request1' }; // the station is there once Pylon wakes
      s.bot = { roofId: GROUND, x: 8.5, z: 11.5 };
      // the station runs on the house's grid (E23.3); here it stands on a powered network (no poles laid in a test)
      Object.assign(s.power, { isPowered: () => true });
      s.research.analyse({ keeper: 'mastRow' });
      s.inventory.add('copper', 12);
      expect(s.research.start(p.id)).toBe(true);
      // the real clock jumps a whole day forward mid-project: nothing in the sim may notice
      vi.setSystemTime(new Date(2026, 10, 19, 14, 0, 0));
    };
    const done = (s: Sim) => s.research.done(p.id);
    const game = ticksUntil(false, start, done);
    const real = ticksUntil(true, start, done);
    expect(game).toBe(Math.ceil(gameDays(p.days) / TUNING.simStep - 1e-6));
    expect(real).toBe(game);
  });

  it('E23.5.2 (#446): a sun crop and a night-only crop ripen in the same play time in both clock modes, the real clock jumping', { timeout: 600_000 }, () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    /** Seconds of play from planting until ripe (whole-sim ticks of 1 s), with the real clock at `hour` then jumping. */
    const ripen = (crop: 'tomato' | 'moonflower', real: boolean, hour: number): number => {
      vi.setSystemTime(new Date(2026, 10, 18, hour, 0, 0));
      const sim = oldSim();
      sim.clock.now = () => new Date(); // the faked real clock
      sim.clock.real = real;
      sim.state.salvage!.tier = 1;
      sim.weather.forceForTest('sunny', 1e12);
      sim.water.isWatered = () => true; // this is about the clock: the bed is watered (E23.4's own tests cover water)
      const t = sim.grid.get(GROUND, 12, 16)!;
      t.blocked = false;
      t.feature = undefined;
      t.ground = 'restored';
      t.pollution = 0;
      sim.grid.touch(t);
      // the Planter box is on the crafting table (3 Planks), open once Tide wakes on Saltwind Beach (Timber)
      sim.state.salvage!.keepers[KEEPERS.find((k) => k.region === 'saltwind')!.id] ??= { step: 'settled' };
      sim.inventory.addToStore('planks', 3);
      sim.bot = { roofId: GROUND, x: 8.5, z: 11.5 };
      const m = sim.build.place('planter', GROUND, 12, 16)!;
      (sim.state.salvage!.crops ??= []).push(crop);
      sim.inventory.add('seeds', 1);
      expect(sim.farm.plant(m, crop)).toBe(true);
      let n = 0;
      while (!sim.farm.look(m).ripe && n < 20_000) {
        sim.tick(1);
        if (n === 500) vi.setSystemTime(new Date(2026, 10, 19, (hour + 12) % 24, 0, 0)); // the real clock jumps half a day
        n++;
      }
      return n;
    };
    for (const crop of ['tomato', 'moonflower'] as const) {
      const game = ripen(crop, false, 2);
      expect(game, `${crop} ripens`).toBeLessThan(20_000);
      expect(ripen(crop, true, 2), `${crop}: follow my clock from 02:00`).toBe(game);
      expect(ripen(crop, true, 14), `${crop}: follow my clock from 14:00`).toBe(game);
    }
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

  it('E23.7.4: a salvage pile refills over game days of play, the same in both clock modes', { timeout: 300_000 }, () => {
    const empty = (s: Sim) => {
      while (s.salvage.left('pk-s1') > 0) s.salvage.salvage('pk-s1');
    };
    const full = (s: Sim) => s.salvage.left('pk-s1') >= SALVAGE.units.small;
    const game = ticksUntil(false, empty, full, 400_000);
    const real = ticksUntil(true, empty, full, 400_000);
    // a whole pile: SALVAGE.refillDays game days (checked every few seconds)
    expect(game * TUNING.simStep).toBeGreaterThanOrEqual(gameDays(SALVAGE.refillDays) - 1e-6);
    expect(game * TUNING.simStep).toBeLessThanOrEqual(gameDays(SALVAGE.refillDays) + SALVAGE.refillCheckSeconds + 0.2);
    expect(real).toBe(game);
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
