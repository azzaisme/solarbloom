import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/core/GameState';
import type { GameState } from '../src/core/types';
import { SEASON_DAYS, SEASON_LOOK, SEASON_WEATHER_ODDS, SEASON_WORDS, SEASONS, SNOW_BUILD, WINTER_COZY, seasonLine, type Season } from '../src/data/seasons';
import { DAY, DAY_SECONDS, gameDays } from '../src/data/time';
import { WEATHER, WEATHER_KINDS } from '../src/data/weather';
import { nextSeason, seasonOf, seasonOnDayOf, snowBuild } from '../src/gameplay/Seasons';
import { Sim } from '../src/gameplay/Sim';
import { buildGiant } from '../src/rendering/GiantTreeGen';
import { PALETTE } from '../src/rendering/Palette';
import { fallingLeafColour, linear, seasonLookAt, seasonShading, seasonUniforms, SeasonShading } from '../src/rendering/SeasonLook';
import { DECIDUOUS, LEAF_CARD_VERTICES, LEAF_FLAG, SEASON_FLAG, SPECIES, buildTree, plainFlex } from '../src/rendering/TreeGen';
import { bannedIn } from '../src/ui/words';

const fresh = (seed = 7) => new Sim(createInitialState(seed));
/** Moves the game clock on by `days` game days without running the sim (as sleeping does). */
const skip = (sim: Sim, days: number) => {
  sim.state.clock ??= { offset: DAY.startFraction * DAY_SECONDS };
  sim.state.clock.offset += gameDays(days);
};
const reload = (sim: Sim) => new Sim(JSON.parse(JSON.stringify(sim.state)) as GameState);

describe('#830: the season clock', () => {
  it('a new garden starts on the first day of spring, year 1', () => {
    const sim = fresh();
    expect(sim.seasons.season()).toBe('spring');
    expect(sim.seasons.dayOfSeason()).toBe(1);
    expect(sim.seasons.year()).toBe(1);
    expect(sim.state.seasons).toEqual({ startDay: 1 });
    expect(sim.seasons.line()).toBe('Spring, day 1 of 3');
  });

  it('runs spring, summer, autumn, winter, three game days each, then a new year', () => {
    expect(SEASONS).toEqual(['spring', 'summer', 'autumn', 'winter']);
    expect(SEASON_DAYS).toBe(3);
    const sim = fresh();
    const seen: string[] = [];
    for (let d = 0; d < 13; d++) {
      seen.push(`${sim.seasons.season()}${sim.seasons.dayOfSeason()}`);
      skip(sim, 1);
    }
    expect(seen).toEqual(['spring1', 'spring2', 'spring3', 'summer1', 'summer2', 'summer3', 'autumn1', 'autumn2', 'autumn3', 'winter1', 'winter2', 'winter3', 'spring1']);
    expect(sim.seasons.year()).toBe(2);
    // a year is 12 game days of 48 minutes: about ten hours of play
    expect((SEASON_DAYS * SEASONS.length * DAY.minutes) / 60).toBeCloseTo(9.6, 5);
  });

  it('progress runs smoothly from 0 to 1 through a season, on the game clock', () => {
    const sim = fresh();
    const p0 = sim.seasons.progress();
    expect(p0).toBeCloseTo(DAY.startFraction / SEASON_DAYS, 5);
    sim.advance(60);
    expect(sim.seasons.progress()).toBeGreaterThan(p0);
    skip(sim, 1.5);
    expect(sim.seasons.progress()).toBeCloseTo(p0 + 1.5 / SEASON_DAYS + 60 / DAY_SECONDS / SEASON_DAYS, 4);
    skip(sim, 3 - 1.5 - DAY.startFraction - 60 / DAY_SECONDS - 0.001);
    expect(sim.seasons.season()).toBe('spring');
    expect(sim.seasons.progress()).toBeGreaterThan(0.999);
    skip(sim, 0.002);
    expect(sim.seasons.season()).toBe('summer');
    expect(sim.seasons.progress()).toBeLessThan(0.001);
  });

  it('announces a new season once, on the step it turns, and never on loading', () => {
    const sim = fresh();
    const got: unknown[] = [];
    sim.bus.on('season.changed', (e) => got.push(e));
    sim.advance(1);
    expect(got).toEqual([]);
    skip(sim, 3);
    sim.advance(1);
    expect(got).toEqual([{ season: 'summer', from: 'spring', year: 1 }]);
    sim.advance(1);
    expect(got.length).toBe(1);
    // loading mid-summer says nothing
    const again = reload(sim);
    const after: unknown[] = [];
    again.bus.on('season.changed', (e) => after.push(e));
    again.advance(2);
    expect(after).toEqual([]);
  });

  it('sleeping through a season\'s last night wakes in the next season (and says so)', () => {
    const sim = fresh();
    sim.seasons.jumpTo('winter', 3);
    const f = sim.clock.gameDayFraction();
    skip(sim, 0.8 - f); // late evening
    sim.advance(0.2);
    const got: unknown[] = [];
    sim.bus.on('season.changed', (e) => got.push(e));
    expect(sim.clock.sleep()).toBe(true);
    sim.advance(0.2);
    expect(sim.seasons.season()).toBe('spring');
    expect(sim.seasons.dayOfSeason()).toBe(1);
    expect(got).toEqual([{ season: 'spring', from: 'winter', year: 2 }]);
  });

  it('saves and loads: a reload keeps the season, the day of it and its progress', () => {
    const sim = fresh();
    sim.seasons.jumpTo('autumn', 2);
    sim.advance(30);
    const before = sim.seasons.now();
    const after = reload(sim).seasons.now();
    expect(after).toEqual(before);
  });

  it('a garden saved before seasons starts a fresh spring on the day it first loads (and keeps it)', () => {
    const sim = fresh();
    skip(sim, 9.4); // game day 10
    const old = JSON.parse(JSON.stringify(sim.state)) as GameState;
    delete old.seasons;
    const loaded = new Sim(old);
    expect(loaded.clock.gameDay()).toBe(10);
    expect(loaded.seasons.season()).toBe('spring');
    expect(loaded.seasons.dayOfSeason()).toBe(1);
    expect(loaded.state.seasons).toEqual({ startDay: 10 });
    // and it stays anchored there across later loads
    skip(loaded, 4);
    expect(reload(loaded).seasons.line()).toBe('Summer, day 2 of 3');
  });

  it('pure helpers agree with the sim (seasonOf, seasonOnDayOf, nextSeason)', () => {
    const sim = fresh();
    sim.seasons.jumpTo('summer', 3);
    expect(seasonOf(sim.state)).toEqual(sim.seasons.now());
    const today = sim.clock.gameDay();
    expect(seasonOnDayOf(sim.state, today)).toBe('summer');
    expect(seasonOnDayOf(sim.state, today + 1)).toBe('autumn');
    expect(seasonOnDayOf(sim.state, today - 3)).toBe('spring');
    expect(seasonOnDayOf(sim.state, today - 6)).toBe('winter'); // the year before
    expect(sim.seasons.seasonOnDay(today + 4)).toBe('winter');
    expect(SEASONS.map(nextSeason)).toEqual(['summer', 'autumn', 'winter', 'spring']);
    expect(sim.seasons.next()).toBe('autumn');
    expect(sim.seasons.label()).toBe('Summer');
  });

  it('jumpTo never moves the game clock (no timer is skipped)', () => {
    const sim = fresh();
    const t = sim.clock.gameSeconds();
    for (const s of SEASONS) {
      sim.seasons.jumpTo(s, 2);
      expect(sim.seasons.season()).toBe(s);
      expect(sim.seasons.dayOfSeason()).toBe(2);
      expect(sim.clock.gameSeconds()).toBe(t);
    }
  });
});

describe('#830: the weather follows the seasons', () => {
  const tally = (seed: number) => {
    const sim = fresh(seed);
    const n: Record<Season, Record<string, number>> = { spring: {}, summer: {}, autumn: {}, winter: {} };
    for (let day = 13; day < 13 + 12 * 60; day++) {
      const s = sim.seasons.seasonOnDay(day);
      const k = sim.weather.kindOn(day);
      n[s][k] = (n[s][k] ?? 0) + 1;
    }
    return n;
  };
  const share = (n: Record<string, number>, k: string) => (n[k] ?? 0) / Object.values(n).reduce((a, b) => a + b, 0);

  it('spring showers, summer sun, autumn wind, winter snow', () => {
    const n = tally(11);
    expect(share(n.spring, 'rain')).toBeGreaterThan(share(n.summer, 'rain'));
    expect(share(n.spring, 'rain')).toBeGreaterThan(share(n.winter, 'rain'));
    expect(share(n.summer, 'sunny')).toBeGreaterThan(Math.max(share(n.spring, 'sunny'), share(n.autumn, 'sunny'), share(n.winter, 'sunny')));
    expect(share(n.autumn, 'wind')).toBeGreaterThan(Math.max(share(n.spring, 'wind'), share(n.summer, 'wind'), share(n.winter, 'wind')));
    expect(share(n.winter, 'snow')).toBeGreaterThan(0.2);
  });

  it('snow only ever falls in winter, and winter never brings a storm', () => {
    for (const seed of [1, 7, 42]) {
      const n = tally(seed);
      expect(n.spring.snow ?? 0).toBe(0);
      expect(n.summer.snow ?? 0).toBe(0);
      expect(n.autumn.snow ?? 0).toBe(0);
      expect(n.winter.storm ?? 0).toBe(0);
    }
    for (const s of SEASONS) for (const k of WEATHER_KINDS) expect(SEASON_WEATHER_ODDS[s][k]).toBeGreaterThanOrEqual(0);
  });

  it('the forecast is still always right (tomorrow\'s kind is fixed by the seed, the day and its season)', () => {
    const sim = fresh(5);
    sim.seasons.jumpTo('autumn', 3);
    const tomorrow = sim.weather.forecast();
    skip(sim, 1);
    sim.advance(0.2);
    expect(sim.seasons.season()).toBe('winter');
    expect(sim.weather.kind()).toBe(tomorrow);
  });

  it('day 1 is still sunny', () => {
    expect(fresh().weather.kind()).toBe('sunny');
  });
});

describe('#830: winter never punishes', () => {
  it('snow is gentle: panels as on a cloudy day, planters never dry, nothing slowed or struck', () => {
    const e = WEATHER.snow;
    expect(e.solar).toBeGreaterThanOrEqual(WEATHER.cloudy.solar);
    expect(e.planterDrying).toBe(0);
    expect(e.bloomSpeed).toBeGreaterThanOrEqual(1);
    expect(e.gatherBonus).toBeGreaterThanOrEqual(1);
    expect(e.lightning).toBe(0);
    expect(e.blowsInSalvage).toBe(false);
    expect(e.evaporation).toBe(0);
    expect(e.view).toBeGreaterThanOrEqual(0.8);
  });

  it('a season changes nothing but the weather\'s odds: growth and charge run the same in winter as in summer', () => {
    const run = (season: Season) => {
      const sim = fresh(3);
      sim.seasons.jumpTo(season, 2);
      sim.weather.forceForTest('cloudy', gameDays(1));
      sim.advance(120);
      return { charge: sim.state.charge, bloom: sim.weather.bloomSpeed(), solar: sim.clock.solarFactor() };
    };
    expect(run('winter')).toEqual(run('summer'));
  });

  it('Cozy Mode: winter\'s grey days never slow the panels (and only winter is changed)', () => {
    const sim = fresh();
    sim.seasons.jumpTo('winter', 2);
    sim.weather.forceForTest('fog', gameDays(2));
    expect(sim.weather.effects().solar).toBe(WEATHER.fog.solar);
    sim.seasons.setCozyMode(true);
    expect(sim.weather.effects().solar).toBe(WINTER_COZY.solarFloor);
    expect(sim.weather.effects().fogFinds).toBe(true); // the rest of the day is unchanged
    sim.weather.forceForTest('sunny', gameDays(2));
    expect(sim.weather.effects().solar).toBe(1); // never lowered
    sim.seasons.jumpTo('summer', 2);
    sim.weather.forceForTest('fog', gameDays(2));
    expect(sim.weather.effects().solar).toBe(WEATHER.fog.solar);
  });
});

describe('#830: the words', () => {
  it('the season line and every toast read plainly and warmly', () => {
    for (const s of SEASONS) {
      const w = SEASON_WORDS[s];
      for (const t of [w.name, w.arrive, w.detail, seasonLine(s, 2)]) {
        expect(bannedIn(t), t).toEqual([]);
        expect(t).not.toMatch(/[{}]|\b(click|tap)\b/i);
      }
    }
    expect(seasonLine('autumn', 2)).toBe('Autumn, day 2 of 3');
  });
});

describe('#830: the look', () => {
  it('summer is the world as it was: no tint, blossom, autumn, bare branches or frost', () => {
    const l = seasonLookAt('summer', 0.3);
    expect([l.grass, l.autumn, l.bare, l.blossom, l.frost]).toEqual([0, 0, 0, 0, 0]);
    expect(l.leafFall).toBe(1);
  });

  it('each season shows its own sign mid-season', () => {
    expect(seasonLookAt('spring', 0.4).blossom).toBeGreaterThan(0.3);
    expect(seasonLookAt('autumn', 0.4).autumn).toBeGreaterThan(0.6);
    expect(seasonLookAt('autumn', 0.4).leafFall).toBeGreaterThan(2);
    const w = seasonLookAt('winter', 0.4);
    expect(w.bare).toBeGreaterThan(0.7);
    expect(w.frost).toBeGreaterThan(0.2);
    expect(w.frost).toBeLessThan(0.7); // gentle, never a white-out
  });

  it('eases from one season into the next with no jump at the turn', () => {
    for (let i = 0; i < SEASONS.length; i++) {
      const a = seasonLookAt(SEASONS[i], 0.99999);
      const b = seasonLookAt(SEASONS[(i + 1) % SEASONS.length], 0);
      for (const k of ['grass', 'autumn', 'bare', 'blossom', 'frost', 'leafFall'] as const) expect(Math.abs(a[k] - b[k]), `${SEASONS[i]} ${k}`).toBeLessThan(1e-3);
      for (let c = 0; c < 3; c++) expect(Math.abs(a.grassColour[c] - b.grassColour[c])).toBeLessThan(1e-3);
    }
    // and holds still through most of a season
    expect(seasonLookAt('autumn', 0.1)).toEqual(seasonLookAt('autumn', 0.6));
  });

  it('a winter dawn is frostier, and fresh snow adds a little more', () => {
    const noon = seasonLookAt('winter', 0.4, 0.33);
    expect(seasonLookAt('winter', 0.4, 0.01).frost).toBeGreaterThan(noon.frost);
    expect(seasonLookAt('winter', 0.4, 0.33, true).frost).toBeGreaterThan(noon.frost);
    expect(seasonLookAt('summer', 0.4, 0.01, true).frost).toBe(0); // never outside winter
  });

  it('colours come from the palette, as uniforms every season material reads', () => {
    const u = seasonUniforms(seasonLookAt('winter', 0.4));
    expect(u.uSeasonFrost).toEqual(linear(PALETTE.season.frost));
    expect(u.uSeasonAut1).toEqual(linear(PALETTE.season.autumn[1]));
    expect(u.uSeasonBlos0).toEqual(linear(PALETTE.season.blossom[0]));
    expect(u.uSeasonA[2]).toBeCloseTo(SEASON_LOOK.winter.bare, 5);
    const sh = new SeasonShading();
    const got: Record<string, unknown> = {};
    sh.register({ setParameter: (k, v) => (got[k] = v) });
    expect(sh.set(seasonLookAt('autumn', 0.4))).toBe(true);
    expect(sh.set(seasonLookAt('autumn', 0.5))).toBe(false); // unchanged: no work
    expect(got.uSeasonA).toEqual(seasonUniforms(seasonLookAt('autumn', 0.4)).uSeasonA);
    expect(seasonShading).toBeInstanceOf(SeasonShading);
  });

  it('falling leaves: petals in spring, gold and red in autumn, the tree\'s own green in summer, evergreens unchanged', () => {
    const own: [number, number, number] = [20, 90, 10];
    const bytes = (hex: string) => linear(hex).map((v) => Math.round(v * 255));
    expect(fallingLeafColour(seasonLookAt('summer', 0.4), own, true, 0.1, 0.1)).toEqual(own);
    expect(fallingLeafColour(seasonLookAt('spring', 0.4), own, true, 0.05, 0.1)).toEqual(bytes(PALETTE.season.blossom[0]));
    expect(PALETTE.season.autumn.map(bytes)).toContainEqual(fallingLeafColour(seasonLookAt('autumn', 0.4), own, true, 0.3, 0.5));
    expect(fallingLeafColour(seasonLookAt('winter', 0.4), own, true, 0.1, 0.5)).toEqual(bytes(PALETTE.season.withered));
    expect(fallingLeafColour(seasonLookAt('autumn', 0.4), own, false, 0.1, 0.5)).toEqual(own);
  });
});

describe('#830: which leaves follow the seasons', () => {
  const flagged = (pos: Float32Array) => {
    let n = 0;
    for (let i = 3; i < pos.length; i += 4) if (pos[i] >= SEASON_FLAG) n++;
    return n;
  };

  it('every deciduous tree\'s leaf cards carry SEASON_FLAG; the Spire Pine\'s never do', () => {
    for (const sp of SPECIES) {
      const g = buildTree(sp, 4, 1, 1);
      if (!DECIDUOUS[sp]) {
        expect(flagged(g.pos), sp).toBe(0);
        continue;
      }
      expect(g.leafStarts!.length, sp).toBeGreaterThan(0);
      for (const s of g.leafStarts!) for (let j = 0; j < LEAF_CARD_VERTICES; j++) expect(g.pos[(s + j) * 4 + 3], sp).toBeGreaterThanOrEqual(SEASON_FLAG);
      // and the trunk does not
      expect(g.pos[3], `${sp} root`).toBeLessThan(LEAF_FLAG);
    }
    expect(DECIDUOUS.pine).toBe(false);
  });

  it('far trees and giant trees follow the seasons too', () => {
    expect(flagged(buildTree('oak', 3, 2, 0).pos)).toBeGreaterThan(0);
    expect(flagged(buildGiant(3, 1, 1).pos)).toBeGreaterThan(0);
  });

  it('plainFlex takes both flags off, leaving the wind\'s own flex', () => {
    expect(plainFlex(0.7)).toBeCloseTo(0.7, 6);
    expect(plainFlex(0.7 + LEAF_FLAG)).toBeCloseTo(0.7, 6);
    expect(plainFlex(0.7 + SEASON_FLAG)).toBeCloseTo(0.7, 6);
    expect(plainFlex(0.7 + LEAF_FLAG + SEASON_FLAG)).toBeCloseTo(0.7, 6);
  });
});

describe('#830: snow builds up', () => {
  const all = (k: 'snow' | 'sunny' | 'cloudy') => () => k;

  it('snowy days lay it down, through the day, with no cap below a white garden', () => {
    expect(snowBuild(10, 10, 0.5, all('snow'))).toBeCloseTo(SNOW_BUILD.perSnowDay / 2, 6);
    expect(snowBuild(10, 10, 1, all('snow'))).toBeCloseTo(SNOW_BUILD.perSnowDay, 6);
    expect(snowBuild(10, 12, 1, all('snow'))).toBe(1); // three snowy days: all white
  });

  it('dry days melt it by their weather, never below none', () => {
    const kinds: Record<number, 'snow' | 'sunny' | 'cloudy'> = { 10: 'snow', 11: 'snow', 12: 'cloudy' };
    const c = snowBuild(10, 12, 1, (d) => kinds[d]);
    expect(c).toBeCloseTo(2 * SNOW_BUILD.perSnowDay - SNOW_BUILD.melt.cloudy, 6);
    expect(snowBuild(10, 12, 1, (d) => (d === 10 ? 'snow' : 'sunny'))).toBe(0);
  });

  it('only winter and the first of spring have snow; a reload shows the same snow; spring melts it', () => {
    const sim = fresh(9);
    sim.seasons.jumpTo('autumn', 2);
    expect(sim.seasons.snowCover()).toBe(0);
    sim.seasons.jumpTo('winter', 3);
    sim.weather.forceForTest('snow', gameDays(1));
    skip(sim, 0.5);
    const c = sim.seasons.snowCover();
    expect(c).toBeGreaterThan(0);
    // the same winter's weather is fixed, so a reload agrees (the held test weather aside: hold it again)
    const again = reload(sim);
    again.weather.forceForTest('snow', gameDays(1));
    expect(again.seasons.snowCover()).toBeCloseTo(c, 6);
    sim.seasons.jumpTo('spring', 1);
    const f = sim.clock.gameDayFraction();
    skip(sim, SNOW_BUILD.springMeltDays + 0.05 - f);
    expect(sim.seasons.snowCover()).toBe(0);
    sim.seasons.jumpTo('summer', 1);
    expect(sim.seasons.snowCover()).toBe(0);
  });

  it('the shaders get it as uSeasonB.z, and it never changes anything but the look', () => {
    expect(seasonUniforms(seasonLookAt('winter', 0.5, 0.3, true, 0.8)).uSeasonB[2]).toBeCloseTo(0.8, 6);
    expect(seasonLookAt('winter', 0.5, 0.3, true, 3).snow).toBe(1);
    const run = (snow: boolean) => {
      const sim = fresh(3);
      sim.seasons.jumpTo('winter', 3);
      sim.weather.forceForTest(snow ? 'snow' : 'cloudy', gameDays(1));
      sim.advance(60);
      return { charge: sim.state.charge, bloom: sim.weather.bloomSpeed() };
    };
    expect(run(true)).toEqual(run(false));
  });
});
