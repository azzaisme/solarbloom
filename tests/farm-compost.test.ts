import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { COMPOST, DIGESTER } from '../src/data/compost';
import { DAY_SECONDS } from '../src/data/time';
import { MACHINE_RECIPES } from '../src/data/crafting';
import { KEEPERS, REGIONS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;

function farm(): Sim {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.state.salvage!.tier = 2;
  sim.bot = { roofId: GROUND, x: 8.5, z: 11.5 };
  // the digester's recipe is handed over by Clock Plaza's Keeper (data/crafting)
  sim.state.salvage!.keepers[KEEPERS.find((k) => k.region === 'clockPlaza')!.id] = { step: 'settled' };
  return sim;
}

/** Builds a farm machine on open ground (stocking its crafting-table recipe first). */
function build(sim: Sim, type: 'compostBin' | 'bioDigester', x: number, z: number): MachineData {
  const t = sim.grid.get(GROUND, x, z)!;
  t.blocked = false;
  t.feature = undefined;
  t.ground = 'restored';
  sim.grid.touch(t);
  for (const [k, v] of Object.entries(sim.build.recipe(type)!)) sim.inventory.addToStore(k as 'scrap', v!);
  const m = sim.build.place(type, GROUND, x, z);
  expect(m, type).toBeDefined();
  return m!;
}

/** Runs the compost system alone for some seconds of play, in minute steps. */
function run(sim: Sim, seconds: number) {
  for (let left = seconds; left > 0; left -= 60) {
    const dt = Math.min(60, left);
    sim.state.time += dt;
    sim.compost.tick(dt);
  }
}

describe('E23.5.3: the compost bin', () => {
  it('biomass and food scraps rot down into compost, then compost matures into fertiliser, over game days', () => {
    const sim = farm();
    const m = build(sim, 'compostBin', 12, 16);
    sim.inventory.add('biomass', 9);
    expect(sim.compost.fill(m, 'biomass')).toBe(9);
    expect(sim.inventory.count('biomass')).toBe(0);
    run(sim, COMPOST.compostDays * DAY_SECONDS + 1);
    expect(sim.compost.bin(m).compost).toBe(1);
    expect(sim.compost.bin(m).fertiliser).toBeUndefined();
    run(sim, (COMPOST.compostDays * 2 + COMPOST.matureDays) * DAY_SECONDS);
    const st = sim.compost.bin(m);
    expect((st.compost ?? 0) + (st.fertiliser ?? 0)).toBe(3); // 9 feed → 3 compost
    expect(st.fertiliser).toBeGreaterThanOrEqual(1);
    run(sim, 3 * COMPOST.matureDays * DAY_SECONDS);
    expect(sim.compost.bin(m).fertiliser).toBe(3);
    expect(sim.compost.take(m, 'fertiliser')).toBe(3);
    expect(sim.inventory.count('fertiliser')).toBe(3);
  });

  it('food rots down richer than biomass', () => {
    const sim = farm();
    const m = build(sim, 'compostBin', 12, 16);
    sim.inventory.add('food', 2);
    sim.compost.fill(m, 'food');
    expect(sim.compost.bin(m).feed).toBe(2 * COMPOST.foodWorth);
    run(sim, COMPOST.compostDays * DAY_SECONDS + 1);
    expect(sim.compost.bin(m).compost).toBe(1);
  });

  it('a full bin waits: nothing is lost, and taking what it made lets it carry on', () => {
    const sim = farm();
    const m = build(sim, 'compostBin', 12, 16);
    sim.inventory.add('biomass', 40);
    expect(sim.compost.fill(m, 'biomass')).toBe(COMPOST.feedCapacity);
    expect(sim.compost.fill(m, 'biomass')).toBe(0); // the feed is full too
    run(sim, 10 * DAY_SECONDS);
    let st = sim.compost.bin(m);
    expect((st.compost ?? 0) + (st.fertiliser ?? 0)).toBe(COMPOST.outputCapacity);
    // top the feed up: with the outputs full, it waits
    sim.inventory.deposit('biomass');
    sim.inventory.add('biomass', 12);
    expect(sim.compost.fill(m, 'biomass')).toBe(12);
    run(sim, 2 * DAY_SECONDS);
    st = sim.compost.bin(m);
    expect(st.feed).toBe(12);
    expect((st.compost ?? 0) + (st.fertiliser ?? 0)).toBe(COMPOST.outputCapacity);
    // take the fertiliser and it carries on
    expect(sim.compost.take(m, 'fertiliser')).toBe(COMPOST.outputCapacity);
    run(sim, 2 * DAY_SECONDS);
    expect(sim.compost.bin(m).feed ?? 0).toBe(0);
    // 12 feed → 4 compost; they mature one at a time (half a day each), so after two days 3 are fertiliser
    expect(sim.compost.bin(m)).toMatchObject({ compost: 1, fertiliser: 3 });
  });

  it('carried compost can go back in to mature; a removed bin hands back what was inside; bins survive a save', () => {
    const sim = farm();
    const m = build(sim, 'compostBin', 12, 16);
    sim.inventory.add('compost', 2);
    expect(sim.compost.returnCompost(m)).toBe(2);
    run(sim, COMPOST.matureDays * DAY_SECONDS + 1);
    expect(sim.compost.bin(m)).toEqual({ compost: 1, fertiliser: 1, ripen: expect.any(Number) });
    const saver = new SaveService(undefined);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(back.compost.bin(m.id)).toEqual(sim.compost.bin(m));
    expect(sim.build.remove(m.id)).toBe(true);
    expect(sim.inventory.count('compost') + sim.inventory.stored('compost')).toBe(1);
    expect(sim.inventory.count('fertiliser') + sim.inventory.stored('fertiliser')).toBe(1);
    expect(sim.state.salvage!.bins?.[m.id]).toBeUndefined();
  });

  it('E23.6.2: compost research speeds every bin (the compostSpeed effect)', () => {
    const sim = farm();
    const m = build(sim, 'compostBin', 12, 16);
    expect(sim.compost.researchReady).toBe(true);
    const base = sim.compost.speed(m);
    (sim as unknown as { research: { effect(id: string): number } }).research = { effect: (id) => (id === 'compostSpeed' ? 0.5 : 0) };
    expect(sim.compost.speed(m)).toBeCloseTo(base * 1.5);
  });

  it('fertiliser is what a landmark tree (the Mother Tree) asks for', () => {
    expect(MACHINE_RECIPES.find((r) => r.builds === 'motherTree')!.cost.fertiliser).toBeGreaterThan(0);
  });
});

/** A controlled grid for the digester's own rules (a steady demand); the real E23.3 grid is tested above. */
function grid(sim: Sim, demand: () => number) {
  const sources: ((m: MachineData) => number)[] = [];
  const power = {
    register: (_type: string, def: { source: (m: MachineData) => number }) => sources.push(def.source),
    networkOf: () => ({ demand: demand(), stored: 0, capacity: 0 }),
    supplied: (m: MachineData) => sources.reduce((n, f) => n + f(m), 0),
  };
  (sim as unknown as { power: typeof power }).power = power;
  return power;
}

describe('E23.5.3: the Bio Digester', () => {
  it('done when: a night can be carried by a fed digester alone', () => {
    const sim = farm();
    const m = build(sim, 'bioDigester', 12, 16);
    const nightLoad = 6; // a charger (E23.3's heaviest consumer) all night
    const power = grid(sim, () => nightLoad);
    sim.inventory.add('biomass', DIGESTER.capacity);
    expect(sim.compost.feed(m)).toBe(DIGESTER.capacity);
    const night = DAY_SECONDS / 3; // dusk at 2/3 of the day to dawn (E23.7's clock)
    let short = 0;
    for (let t = 0; t < night; t += 60) {
      run(sim, 60);
      if (power.supplied(m) < nightLoad) short++;
    }
    expect(short).toBe(0);
    expect(sim.compost.mood(m)).toBe('running');
    expect(sim.compost.fuel(m)).toBeCloseTo(DIGESTER.capacity - DIGESTER.burnPerDay / 3, 3);
  });

  it('done when, on the real E23.3 grid: a fed digester alone carries a game night for a charger-sized load', () => {
    const sim = farm();
    sim.state.salvage!.tier = 4;
    // a load drawing a charger's 6 W all night (a real charger draws only while bloombot sits on it): a chest
    sim.power.register('chest', { consumer: { shed: 'charger', draw: 6 } });
    // the power pole and the chest come from Mast Row's and Saltwind's Keepers (data/crafting)
    for (const r of ['mastRow', 'saltwind']) sim.state.salvage!.keepers[KEEPERS.find((k) => k.region === r)!.id] = { step: 'settled' };
    const pole = build(sim, 'relay' as 'bioDigester', 12, 16);
    const dig = build(sim, 'bioDigester', 13, 16);
    const load = build(sim, 'chest' as 'bioDigester', 12, 17);
    sim.inventory.add('biomass', DIGESTER.capacity);
    sim.compost.feed(dig);
    // to dusk on the game clock: no sun, so nothing but the digester can power it
    sim.state.time = 0;
    const f0 = sim.clock.gameDayFraction();
    sim.state.time = ((((2 / 3 - f0) % 1) + 1) % 1) * DAY_SECONDS + 1;
    expect(sim.clock.gameIsNight()).toBe(true);
    let dark = 0;
    let steps = 0;
    while (sim.clock.gameIsNight()) {
      sim.state.time += 10;
      sim.power.tick(10);
      sim.compost.tick(10);
      const net = sim.power.networkOf(load)!;
      if (steps++ > 2 && (!net || net.served < net.demand - 1e-6 || !sim.power.isPowered(load))) dark++;
    }
    expect(steps * 10).toBeGreaterThan(DAY_SECONDS / 3 - 20); // a whole night went by
    expect(sim.power.networkOf(pole)?.sources.some((s) => s.id === dig.id)).toBe(true);
    expect(dark).toBe(0);
    expect(sim.compost.fuel(dig)).toBeGreaterThan(0);
  });

  it('E23.8.1: a digester in Clock Plaza (machinery) gives 1.5× power for the same biomass', () => {
    const sim = farm();
    const dig = build(sim, 'bioDigester', 12, 16);
    sim.inventory.add('biomass', 5);
    sim.compost.feed(dig);
    expect(sim.compost.output(dig)).toBe(DIGESTER.output);
    const plaza = REGIONS.find((r) => r.id === 'clockPlaza')!;
    const at = { ...dig, x: plaza.landmark.x + 3, z: plaza.landmark.z + 3 };
    (sim.state.salvage!.digesters ??= {})[at.id] = 5;
    expect(sim.compost.output(at)).toBe(DIGESTER.output * 1.5);
  });

  it('day or night alike; an empty digester just stops, and runs again when fed', () => {
    const sim = farm();
    const m = build(sim, 'bioDigester', 12, 16);
    const power = grid(sim, () => 6);
    sim.inventory.add('biomass', 2);
    sim.compost.feed(m);
    run(sim, 60);
    expect(power.supplied(m)).toBe(DIGESTER.output);
    run(sim, DAY_SECONDS);
    expect(sim.compost.mood(m)).toBe('empty');
    expect(power.supplied(m)).toBe(0);
    sim.inventory.add('biomass', 5);
    sim.compost.feed(m);
    expect(power.supplied(m)).toBe(DIGESTER.output);
  });

  it('burns nothing while its grid wants no power, or with no grid at all (it waits, fed)', () => {
    const sim = farm();
    const m = build(sim, 'bioDigester', 12, 16);
    sim.inventory.add('biomass', 10);
    sim.compost.feed(m);
    run(sim, DAY_SECONDS);
    expect(sim.compost.fuel(m)).toBe(10);
    let want = 0;
    grid(sim, () => want);
    run(sim, DAY_SECONDS / 4);
    expect(sim.compost.mood(m)).toBe('idle');
    expect(sim.compost.fuel(m)).toBe(10);
    want = 6;
    run(sim, DAY_SECONDS / 4);
    expect(sim.compost.fuel(m)).toBeCloseTo(10 - DIGESTER.burnPerDay / 4, 3);
  });
});
