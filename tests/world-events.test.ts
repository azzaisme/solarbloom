import { describe, expect, it } from 'vitest';
import { big, toNum } from '../src/core/Big';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, SAVE_VERSION } from '../src/core/GameState';
import type { BuildableType, CatVariant, GameState, TileData, WorldEventType } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Modifiers } from '../src/gameplay/Modifiers';
import { Sim } from '../src/gameplay/Sim';
import { WORLD_EVENTS } from '../src/gameplay/WorldEventSystem';
import { runBot } from './bots';

/**
 * Phase 5 E15: world events and the Hidden Lucky Cat's rarer variants. Every event is started with the seeded
 * debug trigger (`sim.events.trigger`, also `sbDev.event` in the dev build) and checked to resolve normally.
 */
const saver = new SaveService(undefined);

function rich(sim: Sim) {
  const s = sim.state;
  s.caps.energy = big(1e6);
  s.caps.water = big(1e6);
  s.resources.energy = big(5e5);
  s.resources.water = big(5e5);
  s.resources.biomass = big(1e6);
}

/** A park with `n` restored tiles (stage 1) and, optionally, a Drone Hub and a condenser (automation unlocked). */
function parkSim(seed = 7, n = 60, machines: BuildableType[] = ['droneHub', 'condenser']) {
  const sim = new Sim(createInitialState(seed));
  sim.cat.anchorView = () => 'visible';
  rich(sim);
  let k = 0;
  for (const t of sim.areas.tiles(PARK)) {
    if (k >= n || !sim.restoration.isEligible(t)) continue;
    sim.restoration.complete(t, 'pulse', undefined, true);
    k++;
  }
  for (const type of machines) {
    const spot = sim.areas.tiles(PARK).find((t) => t.ground === 'restored' && sim.build.check(type, GROUND, t.x, t.z).ok);
    expect(spot, `room for a ${type}`).toBeDefined();
    expect(sim.build.place(type, GROUND, spot!.x, spot!.z)).toBeTruthy();
  }
  sim.production.markDirty();
  return sim;
}

function reload(sim: Sim): Sim {
  const next = new Sim(saver.deserialize(saver.serialize(sim.state))!);
  next.cat.anchorView = () => 'visible';
  return next;
}

const growable = (sim: Sim) => sim.areas.tiles(PARK).filter((t) => t.ground === 'restored' && !t.occupantId && t.bloom < TUNING.restore.maxBloom);
const blooms = (sim: Sim) => new Map(sim.areas.tiles(PARK).map((t) => [t.id, t.ground === 'restored' ? t.bloom : -1]));

describe('Phase 5 E15: world event scheduler', () => {
  it('waits for automation, then offers an event 3–6 active minutes later, then every 3–6 minutes after one ends', () => {
    const sim = parkSim(7, 60, []);
    sim.advance(600);
    expect(sim.state.events!.count).toBe(0); // no Drone Hub: no events
    expect(sim.state.events!.nextAt).toBe(-1);
    const hub = sim.areas.tiles(PARK).find((t) => t.ground === 'restored' && sim.build.check('droneHub', GROUND, t.x, t.z).ok)!;
    sim.build.place('droneHub', GROUND, hub.x, hub.z);
    const unlockedAt = sim.time;
    const starts: { t: number; type: WorldEventType }[] = [];
    const ends: number[] = [];
    sim.bus.on('world.started', ({ type }) => starts.push({ t: sim.time, type }));
    sim.bus.on('world.ended', () => ends.push(sim.time));
    sim.advance(40 * 60);
    expect(starts.length).toBeGreaterThanOrEqual(5);
    const first = starts[0].t - unlockedAt;
    expect(first).toBeGreaterThanOrEqual(TUNING.events.firstMin - 0.2);
    expect(first).toBeLessThanOrEqual(TUNING.events.firstMax + 0.2);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i].t - ends[i - 1];
      expect(gap).toBeGreaterThanOrEqual(TUNING.events.laterMin - 0.2);
      expect(gap).toBeLessThanOrEqual(TUNING.events.laterMax + 0.2);
      expect(starts[i].type).not.toBe(starts[i - 1].type); // never the same one twice in a row
    }
  });

  it('is seeded: the same seed gives the same schedule, and it never draws from the game rng', () => {
    const run = () => {
      const sim = parkSim(11);
      const log: string[] = [];
      sim.bus.on('world.started', ({ type }) => log.push(`${Math.round(sim.time * 10)}:${type}`));
      sim.advance(30 * 60);
      return log;
    };
    const a = run();
    expect(a.length).toBeGreaterThan(3);
    expect(run()).toEqual(a);
    // The scheduler has its own saved stream.
    const sim = parkSim(11);
    const rng = sim.rng.state;
    sim.events.tick();
    expect(sim.state.events!.nextAt).toBeGreaterThan(0);
    expect(sim.rng.state).toBe(rng);
  });

  it('every event type triggers under the debug trigger and resolves normally; none is needed to progress', () => {
    for (const type of WORLD_EVENTS) {
      const sim = parkSim(3);
      const ended: WorldEventType[] = [];
      sim.bus.on('world.ended', ({ type }) => ended.push(type));
      expect(sim.events.trigger(type)).toBe(true);
      expect(sim.events.active?.type).toBe(type);
      sim.advance(40);
      expect(ended).toEqual([type]);
      expect(sim.events.active).toBeUndefined();
      expect(sim.state.events!.active).toBeUndefined();
      expect(sim.state.events!.nextAt).toBeGreaterThan(sim.time + TUNING.events.laterMin - 41);
      expect(sim.mods.solarMult()).toBe(1);
      expect(sim.mods.waterMult()).toBe(1);
    }
  });

  it('no event is needed to progress: the scripted bot wakes the fountain with events off as with them on', { timeout: 120000 }, () => {
    const off = runBot({ seed: 7, minutes: 12, noEvents: true });
    const on = runBot({ seed: 7, minutes: 12 });
    expect(off.events).toEqual([]);
    expect(off.fountain).toBeGreaterThan(0);
    expect(on.fountain).toBeGreaterThan(0);
    expect(on.events.length).toBeGreaterThan(0);
  });

  it('pausing stops an event exactly where it is (simulation time only)', () => {
    const sim = parkSim(3);
    sim.events.trigger('supernova');
    sim.advance(5);
    const left = sim.events.remaining();
    const st = JSON.stringify(sim.state.events);
    // Paused: the game simply doesn't tick the sim. Nothing about the event changes with wall-clock time.
    expect(JSON.stringify(sim.state.events)).toBe(st);
    expect(sim.events.remaining()).toBeCloseTo(left, 6);
    sim.advance(left + 0.2);
    expect(sim.events.active).toBeUndefined();
  });
});

describe('Phase 5 E15: modifier stacking policy', () => {
  it('same category: the strongest; different categories: the product, capped at 20×; pulse tiers add the strongest', () => {
    const c = (list: [string, number, 'frenzy' | 'boost' | 'event'][]) => Modifiers.compose(list.map(([stat, value, category]) => ({ stat: stat as 'solar', value, category })));
    expect(c([['solar', 3, 'boost'], ['solar', 3, 'boost']]).solar).toBe(3);
    expect(c([['solar', 10, 'event'], ['solar', 3, 'boost']]).solar).toBe(TUNING.modifiers.maxProduct);
    expect(c([['solar', 2, 'event'], ['solar', 3, 'boost']]).solar).toBe(6);
    expect(c([['biomass', 10, 'frenzy'], ['solar', 10, 'event']])).toEqual({ biomass: 10, solar: 10 });
    expect(c([['pulse', 2, 'frenzy'], ['pulse', 1, 'event']]).pulse).toBe(2);
  });

  it('Supernova ×10 applies once to baseline solar; with Solar Surge and Frenzy it stays capped and ends cleanly', () => {
    const sim = parkSim(5);
    const base = toNum(sim.production.rates(true).energy) - sim.areas.bonusIncome().energy;
    const rate = () => toNum(sim.production.rates().energy) - sim.areas.bonusIncome().energy;
    expect(rate()).toBeCloseTo(base, 6);
    sim.events.trigger('supernova');
    expect(rate()).toBeCloseTo(base * 10, 6);
    // Asking again (or a second tick) never multiplies an already-boosted rate.
    expect(rate()).toBeCloseTo(base * 10, 6);
    sim.state.buffs.push({ type: 'solarFrenzy', until: sim.time + 60 }); // a Lucky Cat's Solar Surge ×3
    sim.state.buffs.push({ type: 'megaflower', until: sim.time + 60 }); // same category as the surge
    sim.state.frenzy = { charge: 100 };
    expect(sim.frenzy.activate()).toBe(true);
    sim.tick();
    expect(sim.mods.solarMult()).toBe(TUNING.modifiers.maxProduct);
    expect(rate()).toBeCloseTo(base * TUNING.modifiers.maxProduct, 6);
    expect(sim.mods.biomassMult()).toBe(TUNING.frenzy.biomassMult); // the event doesn't touch biomass
    // A second event can't start on top (no overlap), so nothing stacks further.
    expect(sim.events.trigger('rain')).toBe(false);
    expect(sim.events.trigger('supernova')).toBe(false);
    sim.advance(TUNING.events.supernova.seconds);
    expect(sim.events.active).toBeUndefined();
    expect(sim.mods.solarMult()).toBe(TUNING.cat.frenzyMult); // only the surge is left
  });

  it('overflow rules still apply: a full energy store wastes the Supernova and only charges Frenzy within its cap', () => {
    const sim = parkSim(5);
    sim.state.caps.energy = big(100);
    sim.state.resources.energy = big(100);
    sim.state.frenzy = { charge: 0 };
    sim.events.trigger('supernova');
    sim.advance(TUNING.events.supernova.seconds);
    expect(toNum(sim.state.resources.energy)).toBeLessThanOrEqual(100);
    // ≤ maxPerSecond per second however big the boosted overflow is (plus a little from other sources).
    expect(sim.state.frenzy!.charge).toBeLessThanOrEqual(TUNING.frenzy.overflow.maxPerSecond * TUNING.events.supernova.seconds + 1);
  });

  it('Super Rain multiplies water ×3 once (with other boosts still capped)', () => {
    const sim = parkSim(5);
    const water = () => toNum(sim.production.rates().water) - sim.areas.bonusIncome().water;
    const base = water();
    sim.events.trigger('rain');
    expect(water()).toBeCloseTo(base * TUNING.events.rain.mult, 6);
    sim.advance(TUNING.events.rain.seconds + 1);
    expect(water()).toBeCloseTo(base, 6);
  });
});

describe('Phase 5 E15: Great Migration and Super Rain tiles', () => {
  it('Great Migration grows at most 20 eligible tiles one stage each, once, and says how many', () => {
    // No machines: nothing else nurtures tiles meanwhile, so every change here is the migration's.
    const sim = parkSim(9, 80, []);
    const before = blooms(sim);
    let ended = -1;
    sim.bus.on('world.ended', ({ done }) => (ended = done));
    sim.events.trigger('migration');
    const queue = [...sim.events.active!.queue!];
    expect(queue.length).toBe(TUNING.events.migration.tiles);
    expect(new Set(queue).size).toBe(queue.length);
    sim.advance(TUNING.events.migration.seconds + 1);
    const after = blooms(sim);
    let grown = 0;
    for (const [id, b] of after) {
      if ((before.get(id) ?? -1) < 1) continue; // newly restored by something else (the old drone): not a stage
      const d = b - before.get(id)!;
      expect(d).toBeLessThanOrEqual(1);
      if (d === 1) {
        expect(queue).toContain(id);
        grown++;
      }
    }
    expect(grown).toBe(TUNING.events.migration.tiles);
    expect(ended).toBe(TUNING.events.migration.tiles);
  });

  it('reload in the middle resumes the same queue: same tiles, never twice, no extra pay', () => {
    const visitsOf = (sim: Sim, into: string[]) => sim.bus.on('world.tile', ({ tileId }) => into.push(tileId));
    const straight = parkSim(9, 80);
    const a: string[] = [];
    visitsOf(straight, a);
    straight.events.trigger('migration');
    straight.advance(TUNING.events.migration.seconds + 1);
    expect(a.length).toBe(TUNING.events.migration.tiles);

    const sim = parkSim(9, 80);
    const b: string[] = [];
    visitsOf(sim, b);
    sim.events.trigger('migration');
    sim.advance(6);
    const half = sim.state.events!.active!.done!;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(TUNING.events.migration.tiles);
    let back = reload(sim);
    visitsOf(back, b);
    expect(back.events.active?.type).toBe('migration');
    expect(back.events.remaining()).toBeCloseTo(sim.events.remaining(), 6);
    back.advance(3);
    back = reload(back); // twice, for good measure
    visitsOf(back, b);
    back.advance(TUNING.events.migration.seconds);
    expect(back.events.active).toBeUndefined();
    expect(b).toEqual(a); // the same tiles, in the same order, each exactly once
    expect(back.state.events!.count).toBe(1);
  });

  it('no eligible tiles: a Migration pays steady income instead and never celebrates 0 tiles', () => {
    const sim = parkSim(9, 40);
    for (const t of growable(sim)) {
      t.bloom = TUNING.restore.maxBloom;
      sim.grid.touch(t);
    }
    sim.production.markDirty();
    expect(sim.events.migrationTargets()).toEqual([]);
    const bio = sim.state.resources.biomass;
    const started: { tiles: number; fallback?: string }[] = [];
    sim.bus.on('world.started', (e) => started.push(e));
    sim.events.trigger('migration');
    expect(started[0].tiles).toBe(0);
    expect(started[0].fallback).toMatch(/pollen worth \+/);
    const paid = toNum(sim.state.resources.biomass.sub(bio));
    expect(paid).toBeGreaterThanOrEqual(TUNING.events.fallbackMin);
    expect(paid).toBeGreaterThanOrEqual(toNum(sim.production.rates(true).biomass) * TUNING.events.fallbackSeconds.migration - 1e-6);
    // Reload in the middle: the fallback is not paid again.
    const back = reload(sim);
    const b2 = back.state.resources.biomass;
    back.advance(TUNING.events.migration.seconds + 1);
    expect(back.events.active).toBeUndefined();
    expect(toNum(back.state.resources.biomass.sub(b2))).toBeLessThan(paid); // only ordinary income since
  });

  it('Super Rain: at most 3 waves of 12 tiles, each tile visited once; dry moss is watered into bloom', () => {
    const sim = parkSim(4, 30);
    // Some moss around: rain can water it.
    let moss = 0;
    for (const t of sim.areas.tiles(PARK)) if (t.ground === 'prepared') moss++;
    const waves: string[][] = [];
    sim.bus.on('world.wave', ({ tiles }) => waves.push(tiles));
    const visits = new Map<string, number>();
    sim.bus.on('world.tile', ({ tileId }) => visits.set(tileId, (visits.get(tileId) ?? 0) + 1));
    sim.events.trigger('rain');
    sim.advance(TUNING.events.rain.seconds + 1);
    expect(waves.length).toBe(TUNING.events.rain.waves);
    for (const w of waves) expect(w.length).toBeLessThanOrEqual(TUNING.events.rain.waveTiles);
    for (const n of visits.values()) expect(n).toBe(1);
    expect(visits.size).toBeLessThanOrEqual(TUNING.events.rain.waves * TUNING.events.rain.waveTiles);
    expect(visits.size).toBeGreaterThan(0);
    void moss;
  });

  it('Super Rain with nothing to water still pays (and says so) instead of a 0-tile wave', () => {
    const sim = parkSim(4, 300);
    for (const t of sim.grid.tilesNear({ roofId: GROUND, x: 8, z: 8, size: 1 }, 40)) {
      if (t.ground === 'restored') t.bloom = TUNING.restore.maxBloom;
      else if (t.ground === 'prepared') t.ground = 'polluted';
      sim.grid.touch(t);
    }
    const waves: { tiles: string[]; fallback?: string }[] = [];
    sim.bus.on('world.wave', (w) => waves.push(w));
    const bio = sim.state.resources.biomass;
    sim.events.trigger('rain');
    sim.advance(TUNING.events.rain.seconds + 1);
    expect(waves.length).toBe(TUNING.events.rain.waves);
    for (const w of waves) {
      if (!w.tiles.length) expect(w.fallback).toMatch(/rain-fed growth \+/);
    }
    expect(waves.some((w) => !w.tiles.length)).toBe(true);
    expect(sim.state.resources.biomass.gt(bio)).toBe(true);
  });
});

describe('Phase 5 E15: Lucky Cat Invasion and rarer cats', () => {
  it('an invasion hides up to 3 cats in different visible spots; each pays exactly once, also across reloads', () => {
    const sim = parkSim(13);
    sim.state.cat.found = 1; // past the onboarding cat
    sim.state.cat.firstSpawned = true;
    sim.events.trigger('invasion');
    const cats = sim.state.cat.invasion!;
    expect(cats.length).toBe(TUNING.events.invasion.cats);
    expect(new Set(cats.map((c) => c.anchorId)).size).toBe(cats.length);
    expect(new Set(cats.map((c) => c.id)).size).toBe(cats.length);
    for (const c of cats) expect(sim.cat.candidates().some((a) => a.id === c.anchorId)).toBe(false); // taken
    const ids = cats.map((c) => c.id);
    let back = reload(sim);
    expect(back.state.cat.invasion!.map((c) => c.id)).toEqual(ids);
    const found0 = back.state.cat.found;
    expect(back.cat.claim(ids[0])).toBeDefined();
    expect(back.cat.claim(ids[0])).toBeUndefined(); // double tap
    back = reload(back);
    expect(back.cat.claim(ids[0])).toBeUndefined(); // after reload
    expect(back.cat.claim('c9999')).toBeUndefined(); // stale id
    expect(back.cat.claim(ids[1])).toBeDefined();
    expect(back.cat.claim(ids[2])).toBeDefined();
    expect(back.state.cat.found).toBe(found0 + 3);
    expect(back.state.cat.invasion).toEqual([]);
    // Invasion cats never touch the regular cat's timer or stash.
    expect(back.state.cat.nextSpawnAt).toBe(sim.state.cat.nextSpawnAt);
  });

  it('invasion cats stay until found (no timer), and no new invasion comes while some still hide', () => {
    const sim = parkSim(13);
    sim.state.cat.firstSpawned = true;
    sim.events.trigger('invasion');
    expect(sim.events.weights().invasion).toBe(0);
    sim.advance(30 * 60);
    expect(sim.state.cat.invasion!.length).toBe(TUNING.events.invasion.cats);
    expect((sim.state.events!.byType.invasion ?? 0)).toBe(1);
  });

  it('with nowhere to hide, an invasion gives a gift instead of "0 cats"', () => {
    const sim = parkSim(13);
    sim.cat.anchorView = () => 'covered';
    const bio = sim.state.resources.biomass;
    const started: { tiles: number; fallback?: string }[] = [];
    sim.bus.on('world.started', (e) => started.push(e));
    sim.events.trigger('invasion');
    expect(started[0].tiles).toBe(0);
    expect(started[0].fallback).toMatch(/gift/);
    expect(sim.state.resources.biomass.gt(bio)).toBe(true);
  });

  it('every spawned cat can be hinted: after a while, paw prints (the HUD chip and inspect read this)', () => {
    const sim = parkSim(13);
    sim.state.cat.firstSpawned = true;
    sim.events.trigger('invasion');
    const c = sim.state.cat.invasion![0];
    expect(sim.cat.hinted(c)).toBe(false);
    sim.advance(TUNING.cat.hintAfter + 0.2);
    for (const spot of sim.cat.spots()) expect(sim.cat.hinted(spot)).toBe(true);
  });

  it('rarities are 80 / 18 / 2 (hash of seed and id), the first cat is always standard', () => {
    const sim = parkSim(2);
    const n: Record<CatVariant, number> = { standard: 0, golden: 0, rainbow: 0 };
    // Across seeds and across the first cats of each game (the ids a player actually meets).
    for (let seed = 0; seed < 1000; seed++) {
      sim.state.seed = seed;
      for (let i = 1; i <= 20; i++) n[sim.cat.rollVariant(`c${i}`)]++;
    }
    expect(n.standard / 20000).toBeCloseTo(0.8, 1);
    expect(n.golden / 20000).toBeCloseTo(0.18, 1);
    expect(n.rainbow / 20000).toBeGreaterThan(0.01);
    expect(n.rainbow / 20000).toBeLessThan(0.03);
    for (let seed = 1; seed < 40; seed++) {
      const s2 = parkSim(seed, 30, []);
      expect(s2.cat.spawn()).toBe(true);
      expect(s2.state.cat.active!.variant).toBe('standard');
      expect(s2.cat.claim()!.type).toBe('luckyHarvest');
    }
  });

  it('a Golden Cat pays more, a Rainbow Cat gives two rewards; harvests follow steady production, not Frenzy', () => {
    const harvestFor = (variant: CatVariant, frenzy = false) => {
      const sim = parkSim(21);
      sim.state.cat.found = 1;
      sim.state.cat.firstSpawned = true;
      expect(sim.cat.spawn()).toBe(true);
      sim.state.cat.active!.variant = variant;
      if (frenzy) {
        sim.state.frenzy = { charge: 100 };
        sim.frenzy.activate();
      }
      const types: string[] = [];
      sim.bus.on('cat.found', ({ reward, variant: v }) => types.push(`${v}:${reward}`));
      // Force a harvest to compare amounts (golden, standard), or let a rainbow roll its jackpot.
      const before = sim.state.resources.biomass;
      if (variant === 'rainbow') sim.cat.claim();
      else {
        (sim.cat as unknown as { rollReward(): string }).rollReward = () => 'luckyHarvest';
        sim.cat.claim();
      }
      return { gain: toNum(sim.state.resources.biomass.sub(before)), types, rate: toNum(sim.production.rates(true).biomass) };
    };
    const std = harvestFor('standard');
    const gold = harvestFor('golden');
    expect(gold.gain).toBeCloseTo(std.gain * TUNING.cat.variants.golden.mult, 0);
    expect(std.gain).toBeCloseTo(Math.max(TUNING.cat.harvestMin, std.rate * TUNING.cat.harvestSecondsMin), 0);
    expect(harvestFor('standard', true).gain).toBeCloseTo(std.gain, 0); // Frenzy ×10 isn't paid again by a cat
    expect(harvestFor('rainbow').types).toEqual(['rainbow:jackpot']);
  });

  it('cat rewards are capped however many stack (Solar Surge time, drone party, Mega Bloom, hidden-time bonus)', () => {
    const sim = parkSim(21);
    sim.state.cat.found = 1;
    sim.state.cat.firstSpawned = true;
    const apply = sim.cat as unknown as { apply(t: string, mult: number, hidden: number, vmult?: number): string };
    for (let i = 0; i < 6; i++) apply.apply('solarFrenzy', TUNING.cat.maxRewardMult, 1, 3);
    const surge = sim.state.buffs.find((b) => b.type === 'solarFrenzy')!;
    expect(surge.until - sim.time).toBeLessThanOrEqual(TUNING.cat.surgeMaxSeconds + 1e-9);
    const drones = sim.state.drones.length;
    apply.apply('droneParty', 99, 1, 3);
    for (const d of sim.state.drones.slice(drones)) expect((d.expiresAt ?? 0) - sim.time).toBeLessThanOrEqual(TUNING.cat.partyMaxSeconds + 1e-9);
    // The claim multiplier itself: a rainbow cat hidden for an hour is still ≤ maxRewardMult.
    expect(sim.cat.spawn()).toBe(true);
    sim.state.cat.active!.variant = 'rainbow';
    sim.advance(3600);
    const surgeBefore = sim.state.buffs.find((b) => b.type === 'solarFrenzy');
    expect(surgeBefore).toBeUndefined();
    sim.cat.claim();
    for (const b of sim.state.buffs) if (b.type === 'solarFrenzy') expect(b.until - sim.time).toBeLessThanOrEqual(TUNING.cat.surgeMaxSeconds + 1e-9);
  });

  it('a cat found during an event with Frenzy running pays once and keeps every multiplier inside the cap', () => {
    const sim = parkSim(21);
    sim.state.cat.found = 1;
    sim.state.cat.firstSpawned = true;
    sim.events.trigger('supernova');
    sim.state.frenzy = { charge: 100 };
    sim.frenzy.activate();
    expect(sim.cat.spawn()).toBe(true);
    (sim.cat as unknown as { rollReward(): string }).rollReward = () => 'solarFrenzy';
    const id = sim.state.cat.active!.id;
    expect(sim.cat.claim(id)).toBeDefined();
    expect(sim.cat.claim(id)).toBeUndefined();
    sim.tick();
    expect(sim.mods.solarMult()).toBeLessThanOrEqual(TUNING.modifiers.maxProduct);
    expect(sim.mods.biomassMult()).toBe(TUNING.frenzy.biomassMult);
  });

  it('never hides a cat right behind a building (camera side) or a superstructure', () => {
    const sim = parkSim(13);
    for (const a of sim.cat.candidates()) {
      const [x, z] = a.needsFreeTile ?? [Math.floor(a.pos[0]), Math.floor(a.pos[2])];
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1]]) {
        const t: TileData | undefined = sim.grid.get(a.roofId, x + dx, z + dz);
        expect(t?.feature).not.toBe('building');
      }
    }
  });
});

describe('Phase 5 E15: saves', () => {
  it('saves the event and cats (version 6, now 7 with Look 6); an older save is scrapped (no migration, as agreed)', () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(6);
    const sim = parkSim(13);
    sim.state.cat.firstSpawned = true;
    sim.events.trigger('invasion');
    const json = saver.serialize(sim.state);
    const back = saver.deserialize(json)!;
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.events).toEqual(sim.state.events);
    expect(back.cat.invasion).toEqual(sim.state.cat.invasion);
    const old = JSON.parse(json) as GameState;
    old.version = SAVE_VERSION - 1;
    expect(saver.parse(JSON.stringify(old))).toBe('scrapped');
  });
});
