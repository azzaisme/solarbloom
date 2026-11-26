// #784: charging. The owner: "Charger is the answer". A Charger stays the fastest way to charge (the payoff for
// building), a bench gives a clearly felt trickle of 2 a second, and the fountain a slower one of 1 a second (the
// owner's numbers). A snack (Food) gives +25, Honey 40, Greens 8. The order Charger > bench > fountain must hold, with knacks and with
// a Charger on one starting Solar Panel. And the player must see it charging, whatever it charges from.
import { FRUIT_IDS } from '../src/data/fruit';
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { KNACK_TUNING as T } from '../src/data/bloombot';
import { CHARGE } from '../src/data/charge';
import { FARM_USES } from '../src/data/farm';
import { POWER } from '../src/data/power';
import { Sim } from '../src/gameplay/Sim';
import { bannedIn, WORDS } from '../src/ui/words';

SaveService.clock = () => 0;
const fresh = () => new Sim(createInitialState(7));
const wake = (sim: Sim, id: string) => (sim.state.salvage!.keepers[id] = { step: 'request1' });

/** A machine on cleared ground, as the build system leaves it. */
function put(sim: Sim, type: string, x: number, z: number): MachineData {
  const t = sim.grid.get(GROUND, x, z)!;
  t.ground = 'restored';
  t.blocked = false;
  const m = { id: sim.newId('m'), type, roofId: GROUND, x, z, size: 1, boostUntil: 0, timer: 0, charge: 0 } as unknown as MachineData;
  sim.state.machines.push(m);
  t.occupantId = m.id;
  sim.grid.indexMachine(m);
  return m;
}
const sky = (sim: Sim, solar: number, cloudy = false) => {
  sim.power.skyOverride = () => ({ sun: solar, solar, cloudy, wind: 0, dark: 0 });
};

/** Charge a second, measured in the sim over `secs`, from empty. */
function measure(sim: Sim, secs = 10): number {
  sim.state.charge = { value: 0 };
  sim.advance(secs);
  return sim.charge.value() / secs;
}
/** Sitting on a mended park bench. */
function onBench(sim: Sim): Sim {
  const b = sim.rest.benchAt(10, 6)!;
  sim.inventory.add('scrap', 3);
  sim.rest.mend(b);
  sim.bot = { roofId: GROUND, x: 10.5, z: 7.2 };
  expect(sim.rest.sitOnBench(b)).toBe(true);
  return sim;
}
/** Standing still beside the park's fountain (resting at home). */
function atFountain(sim: Sim): Sim {
  const f = sim.areas.landmark(PARK)!;
  const core = sim.state.machines.find((m) => m.type === 'core' && sim.areas.areaOf(m) === PARK)!;
  sim.bot = { roofId: GROUND, x: core.x + core.size + 1.5, z: f.z + 0.5 };
  expect(sim.charge.atHome()).toBe(true);
  return sim;
}
/** Meditating at a Charger with `panels` Solar Panels beside it, in a sky of `solar`. */
function atCharger(sim: Sim, panels: number, solar = 1, cloudy = false): Sim {
  sky(sim, solar, cloudy);
  const pad = put(sim, 'charger', 30, 30);
  for (let i = 0; i < panels; i++) put(sim, 'solar', [31, 29, 30][i], [30, 30, 29][i]);
  sim.bot = { roofId: GROUND, x: 30.5, z: 31.35 };
  expect(sim.rest.meditate(pad)).toBe(true);
  return sim;
}

describe('#784: the charging sources, in order', () => {
  it('the tuning: bench 2 a second, the fountain 1 a second, a Charger the fastest', () => {
    expect(CHARGE.benchPerSecond).toBe(2);
    expect(CHARGE.home.perSecond).toBe(1);
    expect(CHARGE.home.perSecond).toBeLessThan(CHARGE.benchPerSecond);
    expect(CHARGE.meditatePerSecond).toBeGreaterThan(CHARGE.benchPerSecond * T.rest); // even past a Gable bench
    expect(POWER.charger.rate).toBe(CHARGE.meditatePerSecond);
  });

  it('in play: Charger > bench > fountain, measured in the sim', () => {
    const bench = measure(onBench(fresh()));
    const home = measure(atFountain(fresh()));
    const charger = measure(atCharger(fresh(), 2));
    expect(bench).toBeCloseTo(CHARGE.benchPerSecond, 1);
    // the fountain waits a moment of standing still first
    expect(home).toBeCloseTo((CHARGE.home.perSecond * (10 - CHARGE.home.stillSeconds)) / 10, 1);
    expect(charger).toBeCloseTo(CHARGE.meditatePerSecond, 1);
    expect(charger).toBeGreaterThan(bench);
    expect(bench).toBeGreaterThan(home);
  });

  it('the order holds on one starting Solar Panel, by sun or cloud (the Charger only partly powered)', () => {
    const benchBest = CHARGE.benchPerSecond * T.rest; // a bench with Gable's Easy rest
    for (const [solar, cloudy] of [[1, false], [POWER.solar.cloudFactor, true]] as const) {
      const sim = atCharger(fresh(), 1, solar, cloudy);
      sim.state.charge = { value: 0 }; // full, the pad draws nothing
      sim.advance(1);
      const pad = sim.chargers.docked()!;
      const share = sim.power.servedShare(pad);
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThan(1); // one panel can't feed a whole Charger
      const rate = measure(sim, 5);
      expect(rate).toBeCloseTo(POWER.charger.rate * share, 1);
      expect(rate, `Charger on one panel (sun ${solar}) beats even an Easy-rest bench`).toBeGreaterThan(benchBest);
    }
  });

  it('with knacks too: Pylon\'s Charger > Gable\'s bench > Gable\'s fountain, and each knack only helps its own', () => {
    const sims = () => {
      const s = fresh();
      wake(s, 'gable');
      wake(s, 'pylon');
      return s;
    };
    const bench = measure(onBench(sims()));
    const home = measure(atFountain(sims()));
    const charger = measure(atCharger(sims(), 2), 5); // (a Pylon Charger fills it in under 10 seconds)
    expect(bench).toBeCloseTo(CHARGE.benchPerSecond * T.rest, 1);
    expect(home).toBeCloseTo((CHARGE.home.perSecond * T.rest * (10 - CHARGE.home.stillSeconds)) / 10, 1);
    expect(charger).toBeCloseTo(CHARGE.meditatePerSecond * T.charger, 1);
    expect(charger).toBeGreaterThan(bench);
    expect(bench).toBeGreaterThan(home);
    // Gable alone (no Pylon): the Charger at its plain speed still beats a Gable bench
    expect(CHARGE.meditatePerSecond).toBeGreaterThan(CHARGE.benchPerSecond * T.rest);
    // the same knack on both keeps the fountain under the bench
    expect(CHARGE.home.perSecond * T.rest).toBeLessThan(CHARGE.benchPerSecond * T.rest);
  });

  it('a snack gives +25 (Food); Honey 40, Greens 8, best first', () => {
    expect(FARM_USES.food.charge * CHARGE.max).toBe(25);
    const by = Object.fromEntries(CHARGE.edibles.map((e) => [e.id, e.charge]));
    // #785: fruit from fruit trees are sweet snacks between Food and Honey
    const fruit = Object.fromEntries(FRUIT_IDS.map((f) => [f, by[f]]));
    for (const f of FRUIT_IDS) {
      expect(by[f], f).toBeGreaterThan(by.food);
      expect(by[f], f).toBeLessThan(by.honey);
    }
    expect(by).toEqual({ honey: 40, food: 25, biomass: 8, ...fruit });
    expect(by.honey).toBeGreaterThan(by.food);
    expect(by.biomass).toBeLessThan(by.food);
    const sim = fresh();
    sim.state.charge = { value: 10 };
    const pack = sim.state.salvage!.pack as Record<string, number>;
    for (const k of Object.keys(pack)) delete pack[k];
    pack.food = 1;
    expect(sim.charge.eat()).toMatchObject({ id: 'food' });
    sim.advance(4);
    expect(sim.charge.value()).toBeCloseTo(35, 1); // (less a hair of idle use)
  });

  it('a bench by the fountain charges as a bench: the fountain\'s trickle does not pile on top while sitting', () => {
    const sim = onBench(fresh());
    expect(sim.charge.atHome()).toBe(true); // this park bench is beside the fountain
    expect(measure(sim)).toBeCloseTo(CHARGE.benchPerSecond, 1);
    expect(sim.charge.resting).toBe(false);
    expect(sim.charge.chargingFrom).toBe('bench');
  });

  it('a full charge still lasts about 10 minutes of active play: the drain is untouched', () => {
    expect(CHARGE.max).toBe(100);
    expect(CHARGE.pulse).toBe(1);
    expect(CHARGE.sprintPerSecond).toBeCloseTo(1 / 6);
  });
});

describe('#784: the player sees it charging', () => {
  it('chargingFrom names the source while charge comes in, from each kind, and clears soon after', () => {
    const bench = onBench(fresh());
    bench.state.charge = { value: 0 };
    bench.advance(1);
    expect(bench.charge.chargingFrom).toBe('bench');
    bench.rest.stand();
    bench.bot = { roofId: GROUND, x: 40.5, z: 40.5 }; // walked off, away from home
    bench.advance(1);
    expect(bench.charge.chargingFrom).toBeUndefined();

    const home = atFountain(fresh());
    home.state.charge = { value: 0 };
    home.advance(CHARGE.home.stillSeconds / 2);
    expect(home.charge.chargingFrom).toBeUndefined(); // only once it has stood still a moment
    home.advance(CHARGE.home.stillSeconds);
    expect(home.charge.chargingFrom).toBe('home');

    const pad = atCharger(fresh(), 2);
    pad.state.charge = { value: 0 };
    pad.advance(1);
    expect(pad.charge.chargingFrom).toBe('charger');

    const eat = fresh();
    eat.state.charge = { value: 0 };
    (eat.state.salvage!.pack as Record<string, number>).food = 1;
    eat.charge.eat('food');
    eat.advance(1);
    expect(eat.charge.chargingFrom).toBe('eat');
  });

  it('nothing when full, nothing at an unpowered Charger, nothing from sleep (it fills at once)', () => {
    const bench = onBench(fresh());
    bench.state.charge = { value: CHARGE.max };
    bench.advance(2);
    expect(bench.charge.chargingFrom).toBeUndefined();
    const dark = atCharger(fresh(), 0);
    dark.state.charge = { value: 0 };
    dark.advance(2);
    expect(dark.charge.chargingFrom).toBeUndefined();
    expect(dark.rest.sitting?.kind).toBe('charger');
    const sleep = fresh();
    sleep.state.charge = { value: 0 };
    sleep.charge.sleep();
    expect(sleep.charge.chargingFrom).toBeUndefined();
  });

  it('the words are plain: "Charging up", and what a dark Charger waits for', () => {
    const waits = WORDS.objective.chargerWaits;
    for (const w of [WORDS.objective.charging, ...Object.values(waits)]) expect(bannedIn(w), w).toEqual([]);
    expect(waits.sun).toMatch(/sunshine/);
    expect(waits.panel).toMatch(/Solar Panel/);
  });

  it('a dark Charger says what helps: a Solar Panel when none feeds it, sunshine when its panels are in the dark', () => {
    // no panel joined to it: sunshine would not help, so it asks for a panel
    const lone = atCharger(fresh(), 0);
    lone.state.charge = { value: 0 };
    lone.advance(1);
    const pad = lone.chargers.docked()!;
    expect(lone.charge.chargingFrom).toBeUndefined();
    expect(lone.chargers.waitingFor(pad)).toBe('panel');
    // panels beside it, at night: it waits for sunshine
    const night = atCharger(fresh(), 2, 0);
    night.state.charge = { value: 0 };
    night.advance(1);
    const pad2 = night.chargers.docked()!;
    expect(night.charge.chargingFrom).toBeUndefined();
    expect(night.chargers.waitingFor(pad2)).toBe('sun');
    // the sun comes up: it charges, and waits for nothing
    sky(night, 1);
    night.advance(1);
    expect(night.chargers.waitingFor(pad2)).toBeUndefined();
    expect(night.charge.chargingFrom).toBe('charger');
  });

  it('the feedback tuning: held across a frame, sparkles a few times a second', () => {
    const f = CHARGE.feedback;
    expect(f.holdSeconds).toBeGreaterThan(0.25); // longer than the longest frame step (TUNING.maxFrameDt)
    expect(f.sparkleEvery).toBeGreaterThan(0.1);
    expect(f.sparkleEvery).toBeLessThan(1);
    expect(f.sparkles).toBeGreaterThan(0);
  });

  it('older saves load: nothing new is saved', () => {
    const sim = onBench(fresh());
    sim.state.charge = { value: 0 };
    sim.advance(1);
    const saver = new SaveService(undefined);
    const json = saver.serialize(sim.state);
    expect(json).not.toMatch(/chargingFrom|"flow"/);
    const back = new Sim(saver.deserialize(json)!);
    expect(back.charge.chargingFrom).toBeUndefined();
    expect(back.charge.value()).toBeCloseTo(sim.charge.value(), 3);
  });
});
