import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { DAY_SECONDS, gameDays } from '../src/data/time';
import { WEATHER, WEATHER_KINDS, type WeatherKind } from '../src/data/weather';
import { Sim } from '../src/gameplay/Sim';

const oldSim = (seed = 7) => new Sim(createInitialState(seed, 'oldcity'));
/** a sim whose weather is held at a kind (the E23.10 test hook) */
function under(kind: WeatherKind, seed = 7) {
  const sim = oldSim(seed);
  sim.weather.forceForTest(kind, gameDays(2));
  return sim;
}
/** noon on the game clock */
function noon(sim: Sim) {
  const now = sim.clock.gameSeconds();
  const target = Math.floor(now / DAY_SECONDS) * DAY_SECONDS + DAY_SECONDS / 3;
  sim.state.clock = { ...(sim.state.clock ?? { offset: 0 }), offset: (sim.state.clock?.offset ?? now - sim.state.time) + (target - now) };
}

describe('E23.7.2.1: weather effects (every row in data)', () => {
  it('every kind of weather has a row, and every row helps something and is gentle', () => {
    for (const k of WEATHER_KINDS) {
      const e = WEATHER[k];
      expect(e.solar).toBeGreaterThanOrEqual(0);
      expect(e.solar).toBeLessThanOrEqual(1);
      expect(e.bloomSpeed).toBeGreaterThanOrEqual(1); // weather never slows restoration below normal
    }
  });

  it('sunny: solar at full; planters dry faster and ponds evaporate a little', () => {
    const sim = under('sunny');
    noon(sim);
    expect(sim.clock.solarFactor()).toBe(1);
    expect(sim.weather.effects().planterDrying).toBeGreaterThan(1);
    expect(sim.weather.effects().evaporation).toBeGreaterThan(0);
  });

  it('cloudy: solar −20%', () => {
    const sim = under('cloudy');
    noon(sim);
    expect(sim.clock.solarFactor()).toBeCloseTo(0.8, 6);
  });

  it('rain: fills ponds, waters planters, ground blooms faster; solar low', () => {
    const sim = under('rain');
    noon(sim);
    expect(sim.weather.rain()).toBeGreaterThan(0);
    expect(sim.weather.effects().planterDrying).toBe(0);
    expect(sim.weather.bloomSpeed()).toBeGreaterThan(1);
    expect(sim.clock.solarFactor()).toBeLessThan(0.5);
  });

  it('rain makes restoring ground bloom faster', () => {
    const ticks = (kind: WeatherKind) => {
      const sim = under(kind);
      const t = sim.grid.get(GROUND, 7, 4)!;
      sim.restoration.beginGrowth(t, 'pulse', 3);
      let n = 0;
      while (t.ground !== 'restored' && n < 1000) {
        sim.tick();
        n++;
      }
      return n;
    };
    expect(ticks('rain')).toBeLessThan(ticks('sunny'));
  });

  it('wind: turbines spin; blown leaves make biomass easy to gather', () => {
    const sim = under('wind');
    expect(sim.weather.wind()).toBeGreaterThan(0.5);
    expect(sim.weather.effects().gatherBonus).toBeGreaterThan(1);
    expect(sim.weather.current().kind).toBe('wind');
  });

  it('storm: turbines at full, fast refills, salvage blown in; no solar', () => {
    const sim = under('storm');
    noon(sim);
    expect(sim.weather.wind()).toBe(1);
    expect(sim.weather.rain()).toBeGreaterThan(WEATHER.rain.rain);
    expect(sim.weather.effects().blowsInSalvage).toBe(true);
    expect(sim.clock.solarFactor()).toBe(0);
  });

  it('fog: fog-only finds are out; shorter views', () => {
    const sim = under('fog');
    noon(sim);
    expect(sim.weather.effects().view).toBeLessThan(1);
    expect(sim.nightFinds.out().some((f) => f.when === 'fog')).toBe(true);
    const clear = under('sunny');
    noon(clear);
    expect(clear.nightFinds.out().some((f) => f.when === 'fog')).toBe(false);
  });

  it('classic games have no weather', () => {
    const sim = new Sim(createInitialState(7, 'classic'));
    expect(sim.weather.kind()).toBe('sunny');
    expect(sim.weather.solar()).toBe(1);
  });
});

describe('E23.7.2.2: the forecast', () => {
  it('the forecast always matches the next day', () => {
    for (const seed of [1, 7, 42, 9001]) {
      const sim = oldSim(seed);
      for (let d = 0; d < 12; d++) {
        const said = sim.weather.forecast();
        sim.state.clock = { offset: sim.clock.gameSeconds() - sim.state.time + DAY_SECONDS }; // a day later
        sim.tick();
        expect(sim.weather.kind(), `seed ${seed} day ${sim.clock.gameDay()}`).toBe(said);
      }
    }
  });

  it('the forecast matches after sleeping through the night too', () => {
    const sim = oldSim(3);
    const now = sim.clock.gameSeconds();
    sim.state.clock = { offset: now - sim.state.time + (DAY_SECONDS * 0.8 - (now % DAY_SECONDS)) };
    const said = sim.weather.forecast();
    sim.clock.sleep();
    expect(sim.weather.kind()).toBe(said);
  });

  it('the first day is sunny, and over many days every kind of weather comes up', () => {
    const sim = oldSim(5);
    expect(sim.weather.kindOn(1)).toBe('sunny');
    const seen = new Set<WeatherKind>();
    for (let d = 1; d < 120; d++) seen.add(sim.weather.kindOn(d));
    expect([...seen].sort()).toEqual([...WEATHER_KINDS].sort());
    for (let d = 2; d < 120; d++) if (sim.weather.kindOn(d) === 'storm') expect(sim.weather.kindOn(d - 1)).not.toBe('storm');
  });
});

describe('E23.7.2.3: storms', () => {
  it('a storm blows in fresh salvage and lightning trips a pole, and nothing is lost', { timeout: 60_000 }, () => {
    const sim = oldSim(11);
    let tripped = 0;
    // the real grid (E23.3) is on the sim; only its trip is watched here
    (sim.power as unknown as { trip(rng: { int(a: number, b: number): number }): string }).trip = (rng) => `pole${++tripped}:${rng.int(0, 9)}`;
    const seen: string[] = [];
    sim.bus.on('weather.storm', () => seen.push('storm'));
    sim.bus.on('weather.lightning', (e) => seen.push(`bolt:${e.poleId}`));
    // something to lose: restored ground, a machine, the backpack and the store
    const t = sim.grid.get(GROUND, 7, 4)!;
    sim.restoration.beginGrowth(t, 'pulse', 1);
    sim.advance(2);
    sim.inventory.add('scrap', 5);
    const before = { machines: sim.state.machines.map((m) => m.id).sort(), restored: t.ground, scrap: sim.inventory.count('scrap'), store: JSON.stringify(sim.state.salvage!.store) };
    sim.weather.forceForTest('storm', gameDays(1));
    sim.advance(gameDays(1));
    expect(seen[0]).toBe('storm');
    expect(seen.filter((x) => x.startsWith('bolt')).length).toBe(WEATHER.storm.lightning);
    expect(tripped).toBe(WEATHER.storm.lightning);
    expect(sim.state.machines.map((m) => m.id).sort()).toEqual(before.machines);
    expect(t.ground).toBe(before.restored);
    expect(sim.inventory.count('scrap')).toBe(before.scrap);
    expect(JSON.stringify(sim.state.salvage!.store)).toBe(before.store);
  });

  it('the weather is the same for the same seed (saves stay byte-identical)', { timeout: 60_000 }, () => {
    const a = oldSim(21);
    const b = oldSim(21);
    a.advance(gameDays(2));
    b.advance(gameDays(2));
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});
