import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { DAY, DAY_SECONDS, gameDays, gameHours, NIGHT_FINDS } from '../src/data/time';
import { daylightAt, gameDayOf, realFraction, solarAt } from '../src/gameplay/Clock';
import { Sim } from '../src/gameplay/Sim';

const oldSim = (seed = 7) => new Sim(createInitialState(seed, 'oldcity'));
/** a real clock stuck at this local hour */
const at = (h: number, m = 0) => () => new Date(2026, 10, 18, h, m, 0);
/** moves the game clock to a day fraction (as sleeping does: through the offset) */
function setFraction(sim: Sim, f: number) {
  const now = sim.clock.gameSeconds();
  const target = Math.floor(now / DAY_SECONDS) * DAY_SECONDS + f * DAY_SECONDS;
  sim.state.clock = { ...(sim.state.clock ?? { offset: 0 }), offset: (sim.state.clock?.offset ?? now - sim.state.time) + (target - now) };
}

describe('E23.7.1.1: the 48-minute day', () => {
  it('a game day is 48 minutes of play: 32 of day, 16 of night', () => {
    expect(DAY_SECONDS).toBe(48 * 60);
    expect(gameDays(1)).toBe(2880);
    expect(gameHours(1)).toBe(120);
    expect(DAY.dayShare * DAY.minutes).toBeCloseTo(32);
    const sim = oldSim();
    setFraction(sim, 0);
    let dayTicks = 0;
    const steps = DAY_SECONDS / 1; // one-second steps
    for (let i = 0; i < steps; i++) {
      if (sim.clock.isDay()) dayTicks++;
      sim.state.time += 1;
    }
    expect(dayTicks).toBe(32 * 60);
  });

  it('a new game starts on day 1, in the morning', () => {
    const sim = oldSim();
    expect(sim.clock.gameDay()).toBe(1);
    expect(sim.clock.isDay()).toBe(true);
    expect(sim.clock.hour()).toBeGreaterThanOrEqual(6);
    expect(sim.clock.hour()).toBeLessThan(10);
  });

  it('every timer counts in game days: the clock is play time, and play time is game days', { timeout: 60_000 }, () => {
    const sim = oldSim();
    const d0 = sim.clock.gameDay();
    const t0 = sim.time;
    sim.advance(gameDays(1));
    expect(sim.clock.gameDay()).toBe(d0 + 1);
    expect(sim.clock.elapsedDays(t0)).toBeCloseTo(1, 6);
    expect(sim.clock.days).toBeCloseTo(sim.time / DAY_SECONDS, 9);
    // a timer written in game days (here: half a game day) runs out after exactly that much play
    const due = sim.time + gameDays(0.5);
    let ticks = 0;
    while (sim.time < due - 1e-9) {
      sim.tick();
      ticks++;
    }
    expect(ticks * 0.1).toBeCloseTo(DAY_SECONDS / 2, 3);
    // the save list and the menu read the same day without a Sim
    expect(gameDayOf(sim.state)).toBe(sim.clock.gameDay());
  });

  it('dawn and dusk are announced on the bus as the day turns', { timeout: 60_000 }, () => {
    const sim = oldSim();
    const seen: string[] = [];
    sim.bus.on('clock.dusk', () => seen.push('dusk'));
    sim.bus.on('clock.dawn', () => seen.push('dawn'));
    sim.advance(gameDays(1));
    expect(seen).toEqual(['dusk', 'dawn']);
  });

  it('solar is zero at night, full at midday, and ramps through the morning', () => {
    expect(solarAt(DAY.dayShare / 2)).toBe(1);
    expect(solarAt(0.8)).toBe(0);
    expect(solarAt(0.01)).toBeGreaterThan(0);
    expect(solarAt(0.01)).toBeLessThan(0.5);
    expect(daylightAt(0.85)).toBe(0);
    expect(daylightAt(DAY.dayShare / 2)).toBe(1);
    const sim = oldSim();
    setFraction(sim, 0.85);
    expect(sim.clock.solarFactor()).toBe(0);
    setFraction(sim, 0.33);
    expect(sim.clock.solarFactor()).toBe(1);
  });
});

describe('E23.7.1.2: follow my clock', () => {
  it('the sky, light and solar follow the real clock; 06:00 is dawn and 22:00 dusk', () => {
    expect(realFraction(at(6)())).toBe(0);
    expect(realFraction(at(22)())).toBeCloseTo(DAY.dayShare);
    const sim = oldSim();
    sim.clock.now = at(23, 30);
    sim.clock.real = true;
    expect(sim.clock.isNight()).toBe(true);
    expect(sim.clock.solarFactor()).toBe(0);
    expect(sim.clock.hour()).toBe(23);
    expect(sim.clock.minute()).toBe(30);
    sim.clock.now = at(13);
    expect(sim.clock.isDay()).toBe(true);
    expect(sim.clock.solarFactor()).toBe(1);
  });

  it('timers still count in game days: a restoring tile takes the same play time in both modes', () => {
    const growTicks = (real: boolean) => {
      const sim = oldSim();
      sim.clock.now = at(2); // the middle of the real night
      sim.clock.real = real;
      const t = sim.grid.get(GROUND, 7, 4)!;
      sim.restoration.beginGrowth(t, 'pulse', 3);
      let n = 0;
      while (t.ground !== 'restored' && n < 1000) {
        sim.tick();
        n++;
      }
      return { n, day: sim.clock.gameDay() };
    };
    const game = growTicks(false);
    const real = growTicks(true);
    expect(game.n).toBeLessThan(1000);
    expect(real.n).toBe(game.n);
    expect(real.day).toBe(game.day);
  });

  it('switching modes is saved with the game', () => {
    const sim = oldSim();
    sim.clock.real = true;
    expect(JSON.parse(JSON.stringify(sim.state)).clock.real).toBe(true);
    sim.clock.real = false;
    expect(sim.state.clock?.real).toBeUndefined();
  });
});

describe('E23.7.1.3: night finds and sleeping', () => {
  it('each night find appears only at night', () => {
    const sim = oldSim();
    for (const f of NIGHT_FINDS) {
      setFraction(sim, 0.3);
      expect(sim.nightFinds.visible(f.id), `${f.id} by day`).toBe(false);
      expect(sim.nightFinds.at(f.x, f.z)).toBeUndefined();
      setFraction(sim, 0.8);
      expect(sim.nightFinds.visible(f.id), `${f.id} by night`).toBe(true);
      expect(sim.nightFinds.at(f.x, f.z)?.id).toBe(f.id);
    }
    // in "follow my clock" mode they follow the real night
    sim.clock.now = at(12);
    sim.clock.real = true;
    expect(sim.nightFinds.out()).toEqual([]);
    sim.clock.now = at(23);
    expect(sim.nightFinds.out().length).toBe(NIGHT_FINDS.length);
  });

  it('a night find taken tonight is back the next night', { timeout: 60_000 }, () => {
    const sim = oldSim();
    setFraction(sim, 0.8);
    const f = NIGHT_FINDS[0];
    expect(sim.nightFinds.take(f.id)).toBeGreaterThan(0);
    expect(sim.nightFinds.visible(f.id)).toBe(false);
    sim.advance(gameDays(1));
    expect(sim.nightFinds.visible(f.id)).toBe(true);
  });

  it('every night find sits on open, unblocked ground', () => {
    const sim = oldSim();
    for (const f of NIGHT_FINDS) {
      const t = sim.grid.get(GROUND, f.x, f.z);
      expect(t, f.id).toBeDefined();
      expect(t!.blocked, f.id).toBeFalsy();
      expect(t!.occupantId, f.id).toBeFalsy();
    }
  });

  it('sleeping is only for the night, and wakes on the next morning', () => {
    const sim = oldSim();
    setFraction(sim, 0.3);
    expect(sim.clock.sleep()).toBe(false);
    setFraction(sim, 0.9);
    const day = sim.clock.gameDay();
    const t = sim.time;
    expect(sim.clock.sleep()).toBe(true);
    expect(sim.clock.gameDay()).toBe(day + 1);
    expect(sim.clock.isDay()).toBe(true);
    expect(sim.clock.dayFraction()).toBeCloseTo(DAY.wakeFraction, 6);
    // sleeping skips the dark, not play: timers have not run
    expect(sim.time).toBe(t);
  });

  it('sleeping refills bloombot\'s charge when it has one', () => {
    const sim = oldSim();
    let refilled = 0;
    (sim as unknown as { charge: { sleep(): void } }).charge = { sleep: () => refilled++ };
    setFraction(sim, 0.75);
    sim.clock.sleep();
    expect(refilled).toBe(1);
  });

  it('in "follow my clock" mode sleeping is a rest: the real night carries on', () => {
    const sim = oldSim();
    sim.clock.now = at(23);
    sim.clock.real = true;
    const day = sim.clock.gameDay();
    expect(sim.clock.sleep()).toBe(true);
    expect(sim.clock.gameDay()).toBe(day);
    expect(sim.clock.isNight()).toBe(true);
  });
});
