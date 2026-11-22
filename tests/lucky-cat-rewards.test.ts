import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND, isRestorable } from '../src/core/GameState';
import type { CatRewardType, MachineData } from '../src/core/types';
import { REGIONS } from '../src/data/oldcity';
import { TUNING } from '../src/data/tuning';
import type { CatAt } from '../src/gameplay/LuckyCatSystem';
import type { PowerSky } from '../src/gameplay/PowerEnv';
import { Sim } from '../src/gameplay/Sim';
import { fill, makeSim, openNextGoal, PAD, rich } from './helpers';

/**
 * E23.12 (#528): every Lucky Cat reward pays out in the E23 loop (the backpack, charge, the grid, drones, restored
 * ground), never in a counter, and says so in the world's own words. Each test drives the real system it touches.
 */
type Applier = { apply(t: CatRewardType, mult: number, at?: CatAt): string };
const apply = (sim: Sim, t: CatRewardType, at?: CatAt, mult = 1) => (sim.cat as unknown as Applier).apply(t, mult, at);
const DAY: PowerSky = { sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 };

/** The middle cell of a region (its first chunk). */
function regionCell(id: string): CatAt {
  const r = REGIONS.find((x) => x.id === id)!;
  return { roofId: GROUND, x: r.chunks.x0 * 16 + 8, z: r.chunks.z0 * 16 + 8 };
}

function parkCell(sim: Sim): CatAt {
  const t = sim.areas.tiles(PARK).find((x) => !x.blocked)!;
  return { roofId: GROUND, x: t.x + 0.5, z: t.z + 0.5 };
}

/** The fountain is awake and `n` areas are cleared (as tests/lucky-cat-city.test.ts does). */
function grownCity(seed: number, n: number) {
  const sim = new Sim(createInitialState(seed));
  sim.state.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  let grown = 0;
  while (grown < n) {
    // the next area, opening its region's gate (or the mainland) first when the open ones are done
    const id = openNextGoal(sim);
    if (!id) break;
    for (const t of sim.areas.tiles(id)) {
      if (!isRestorable(t, sim.state.machines) || t.ground === 'restored') continue;
      t.ground = 'restored';
      t.bloom = 1;
      t.pollution = 0;
      sim.grid.touch(t);
    }
    if (!sim.areas.clear(id, true)) break; // asserted below: every area asked for grows
    grown++;
  }
  expect(grown).toBe(n);
  return sim;
}

describe('E23.12 Lucky Cat rewards (#528)', () => {
  it('Lucky Harvest puts food, biomass and the region’s own material in the backpack', () => {
    const sim = makeSim();
    const before = { food: sim.inventory.count('food'), biomass: sim.inventory.count('biomass'), seeds: sim.inventory.count('seeds') };
    const text = apply(sim, 'luckyHarvest', parkCell(sim));
    expect(text).toBe('A gift in your backpack: food, greens and seeds');
    const G = TUNING.cat.gift;
    expect(sim.inventory.count('food') - before.food).toBe(G.food);
    expect(sim.inventory.count('biomass') - before.biomass).toBe(G.biomass);
    expect(sim.inventory.count('seeds') - before.seeds).toBe(G.local); // the park's own: seeds
    // Mast Row is known for copper; the Cistern Basin for clay.
    expect(Object.keys(sim.cat.giftAt(regionCell('mastRow'), 1))).toContain('copper');
    expect(Object.keys(sim.cat.giftAt(regionCell('cistern'), 1))).toContain('clay');
    expect(apply(sim, 'luckyHarvest', regionCell('mastRow'))).toMatch(/food, greens and copper$/);
    expect(sim.inventory.count('copper')).toBeGreaterThanOrEqual(G.local);
  });

  it('Lucky Harvest: fertile soil gives more biomass, rarer cats bigger gifts, and a full backpack spills into the store', () => {
    const sim = makeSim();
    const grove = sim.cat.giftAt(regionCell('elderGrove'), 1);
    const park = sim.cat.giftAt(parkCell(sim), 1);
    expect(grove.biomass!).toBeGreaterThan(park.biomass!);
    expect(sim.cat.giftAt(parkCell(sim), 2).food).toBe(TUNING.cat.gift.food * 2);
    // a full backpack: nothing is lost, the gift waits in the store
    const sv = sim.state.salvage!;
    sv.pack.food = sim.inventory.stackLimit();
    const stored = sim.inventory.stored('food');
    apply(sim, 'luckyHarvest', parkCell(sim));
    expect(sim.inventory.count('food')).toBe(sim.inventory.stackLimit());
    expect(sim.inventory.stored('food') - stored).toBe(TUNING.cat.gift.food);
  });

  it('Solar Surge fills the charge and makes the panels near the cat shine brighter into the grid, for a while', () => {
    const sim = makeSim();
    sim.power.skyOverride = () => DAY;
    const near = sim.state.machines.find((m) => m.type === 'solar' && m.roofId === PAD)!;
    const far: MachineData = { id: sim.newId('m'), type: 'solar', roofId: GROUND, x: 400, z: 400, size: 1, boostUntil: 0, timer: 0, charge: 0 };
    sim.state.machines.push(far);
    const base = sim.power.output(near);
    const farBase = sim.power.output(far);
    expect(base).toBeGreaterThan(0);
    sim.charge.drainForTest();
    expect(sim.charge.empty).toBe(true);
    const text = apply(sim, 'solarFrenzy', { roofId: PAD, x: near.x + 2, z: near.z + 1 });
    expect(text).toBe('Charge full, and the solar panels nearby shine brighter for a while');
    expect(sim.charge.value()).toBeCloseTo(sim.charge.max);
    expect(sim.power.output(near)).toBeCloseTo(base * TUNING.cat.surgeShine);
    expect(sim.power.output(far)).toBeCloseTo(farBase); // out of reach: as before
    sim.advance(TUNING.cat.surgeSeconds + 1);
    expect(sim.power.output(near)).toBeCloseTo(base); // game time passes and it fades
  });

  it('Mega Bloom restores ground in the player’s world', () => {
    const sim = grownCity(7, 3);
    const restored = () => sim.grid.tilesOf(GROUND).filter((t) => t.ground === 'restored').length;
    const before = restored();
    expect(apply(sim, 'megaBloom', undefined)).toBe('A Mega Bloom!');
    sim.advance(20);
    expect(restored()).toBeGreaterThan(before);
  });

  it('Drone Party: drones of hubs near the cat work faster for a while; it is only offered with drones nearby', () => {
    const run = (party: CatAt | undefined) => {
      const sim = makeSim(11);
      rich(sim);
      fill(sim, 0, 0, 7, 7, 'polluted');
      fill(sim, 4, 4, 5, 5, 'restored');
      const hub = sim.build.place('droneHub', PAD, 4, 4)!;
      sim.advance(1);
      if (party) expect(apply(sim, 'droneParty', party)).toBe('The drones nearby work faster for a while');
      const d = sim.state.drones.find((x) => x.hubId === hub.id)!;
      const mult = sim.drones.partyMult(d);
      const jobs0 = sim.state.stats.droneJobs;
      sim.advance(30);
      return { sim, d, mult, jobs: sim.state.stats.droneJobs - jobs0 };
    };
    const plain = run(undefined);
    const near = run({ roofId: PAD, x: 5, z: 5 });
    expect(plain.mult).toBe(1);
    expect(near.mult).toBe(TUNING.cat.partyMult);
    expect(near.jobs).toBeGreaterThan(plain.jobs);
    // the party ends in game time
    near.sim.advance(TUNING.cat.dronePartySeconds);
    expect(near.sim.drones.partyMult(near.d)).toBe(1);
    // offered only near drones: never on a fresh island, never far from every hub
    expect(makeSim().cat.partyAvailable()).toBe(false);
    expect(plain.sim.cat.partyAvailable({ roofId: PAD, x: 5, z: 5 })).toBe(true);
    expect(plain.sim.cat.partyAvailable({ roofId: GROUND, x: 400, z: 400 })).toBe(false); // far from every hub (and the park's old drone)
    const fresh = makeSim();
    fresh.state.cat.found = 1;
    for (let i = 0; i < 200; i++) expect(fresh.cat.rollReward(parkCell(fresh))).not.toBe('droneParty');
    // with no drones, a party degrades to a gift (never nothing)
    expect(apply(fresh, 'droneParty', parkCell(fresh))).toMatch(/^A gift in your backpack/);
  });

  it('Golden Relay turns the relay nearest the cat gold, and a gold relay carries power further', () => {
    const sim = makeSim();
    const put = (x: number): MachineData => {
      const m: MachineData = { id: sim.newId('m'), type: 'relay', roofId: GROUND, x, z: 300, size: 1, boostUntil: 0, timer: 0, charge: 0 };
      sim.state.machines.push(m);
      return m;
    };
    expect(sim.cat.goldenRelayAvailable()).toBe(false); // no relays: never rolled
    const range = sim.relays.range();
    const a = put(300);
    const b = put(300 + Math.ceil(range) + TUNING.cat.goldenRelayRange - 2); // just out of a plain relay's reach
    sim.power.tick(1);
    expect(sim.power.networkOf(a)).not.toBe(sim.power.networkOf(b));
    expect(apply(sim, 'goldenRelay', { roofId: GROUND, x: 299, z: 300 })).toBe('A relay turns gold: it carries power further');
    expect(a.golden).toBe(true);
    expect(b.golden).toBeFalsy();
    expect(sim.relays.range(a)).toBe(range + TUNING.cat.goldenRelayRange);
    sim.power.tick(1);
    expect(sim.power.networkOf(a)).toBe(sim.power.networkOf(b));
    // the next one golds the other relay; then there's none left to gold and it is never rolled
    apply(sim, 'goldenRelay', { roofId: GROUND, x: 299, z: 300 });
    expect(b.golden).toBe(true);
    expect(sim.cat.goldenRelayAvailable()).toBe(false);
  });

  it('a Golden Relay survives save and load', () => {
    const sim = makeSim();
    const m: MachineData = { id: sim.newId('m'), type: 'relay', roofId: GROUND, x: 300, z: 300, size: 1, boostUntil: 0, timer: 0, charge: 0 };
    sim.state.machines.push(m);
    apply(sim, 'goldenRelay', { roofId: GROUND, x: 300, z: 300 });
    const back = new Sim(JSON.parse(JSON.stringify(sim.state)));
    expect(back.machine(m.id)!.golden).toBe(true);
    expect(back.relays.range(back.machine(m.id)!)).toBe(sim.relays.range(m));
  });

  it('Jackpot gives two different rewards from the new pool', { timeout: 120000 }, () => {
    const kinds: [CatRewardType, RegExp][] = [
      ['luckyHarvest', /A gift in your backpack/],
      ['solarFrenzy', /Charge full/],
      ['megaBloom', /A Mega Bloom!/],
      ['droneParty', /drones nearby work faster/],
      ['goldenRelay', /relay turns gold/],
      ['catsGarden', /garden blooms/],
      ['fogWhisker', /fog thins/],
    ];
    for (let seed = 1; seed < 20; seed++) {
      const sim = grownCity(seed, 2);
      const text = apply(sim, 'jackpot', undefined);
      expect(text).toMatch(/^JACKPOT!/);
      const hit = kinds.filter(([, re]) => re.test(text)).map(([k]) => k);
      // two different rewards: the pool only holds rewards that can act here, so neither degrades
      expect(text.split(' · ').length).toBe(3);
      expect(hit.length).toBe(2);
    }
  });

  it('no reward shows a number or touches a counter, over many finds', { timeout: 120000 }, () => {
    const sim = grownCity(8, 6);
    sim.state.cat.found = 1;
    for (let i = 0; i < 80; i++) {
      sim.state.cat.active = undefined;
      sim.cat.spawn();
      const r = sim.cat.claim();
      expect(r).toBeDefined();
      expect(r!.summary).not.toMatch(/\d/);
      sim.advance(2);
    }
    for (const k of ['resources', 'caps', 'harvestReadyAt', 'relayBonus']) expect(sim.state).not.toHaveProperty(k);
  });
});
