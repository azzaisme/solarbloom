import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { TileData } from '../src/core/types';
import { FARM_USES } from '../src/data/farm';
import { FRUIT_IDS, isFruit, type FruitId } from '../src/data/fruit';
import { CHARGE } from '../src/data/charge';
import { Sim } from '../src/gameplay/Sim';
import { BOT, spawnPose, Walker } from '../src/gameplay/Walker';

SaveService.clock = () => 0;
const oldSim = (seed = 7) => new Sim(createInitialState(seed));
/** A dead park tile bloombot can pulse (E23.1.4: a pulse costs only charge). */
const pulseable = (sim: Sim, n = 1): TileData[] => {
  const out: TileData[] = [];
  for (const t of sim.areas.tiles(PARK)) {
    if (out.length >= n) break;
    if (t.ground !== 'polluted' || t.blocked || t.occupantId || !sim.restoration.checkPulse(t).ok) continue;
    if (out.every((o) => Math.hypot(o.x - t.x, o.z - t.z) > 5)) out.push(t); // far apart: one pulse can't take another
  }
  return out;
};

describe('E23.2.1: bloombot\'s charge', () => {
  it('every game has a charge: it starts full and a pulse costs some (E23.1.1: one rule set)', () => {
    const sim = new Sim(createInitialState(7));
    expect(sim.charge.value()).toBe(CHARGE.max);
    expect(sim.charge.use('pulse')).toBe(true);
    expect(sim.charge.value()).toBeLessThan(CHARGE.max);
  });


  it('a full charge lasts about 10 minutes of active play (the data\'s profile)', () => {
    const sim = oldSim();
    const a = CHARGE.active;
    let t = 0;
    let nextPulse = 0;
    // a pulse every few seconds and sprinting part of each second, until the charge runs out
    while (!sim.charge.empty && t < 3600) {
      if (t >= nextPulse) {
        sim.charge.use('pulse');
        nextPulse += a.pulseEverySeconds;
      }
      sim.charge.use('sprint', a.sprintShare);
      t += 1;
    }
    expect(t / 60).toBeGreaterThan(a.minutes * 0.95);
    expect(t / 60).toBeLessThan(a.minutes * 1.05);
  });

  it('pulses cost charge; walking is free; at zero no pulse and no pry, but bloombot is never stranded', () => {
    const sim = oldSim();
    const [t, t2, t3] = pulseable(sim, 3);
    expect(sim.restoration.pulse(t.id)).toBe(true);
    expect(sim.charge.value()).toBeCloseTo(CHARGE.max - CHARGE.pulse);
    // run it down
    sim.state.charge!.value = 0.3;
    expect(sim.charge.canUse('pulse')).toBe(true); // a little left still fires
    expect(sim.restoration.pulse(t2.id)).toBe(true);
    expect(sim.charge.empty).toBe(true);
    const chk = sim.restoration.checkPulse(t3);
    expect(chk.ok).toBe(false);
    expect(chk.reason).toMatch(/charge/i);
    expect(sim.restoration.pulse(t3.id)).toBe(false);
    // abilities wait for charge too (a barricade with Pry)
    sim.state.salvage!.abilities.push('pry');
    expect(sim.gates.problem({ id: 'g-mastRow', kind: 'barricade', cells: [[7, -1]], needs: { ability: 'pry' }, blocked: 'x', how: 'y' })).toMatch(/charge/i);
    // never stranded: the low-power walk still moves, and every walkable cell is still reachable
    expect(BOT.walk * CHARGE.lowPowerWalk).toBeGreaterThan(1);
    const w = new Walker(sim);
    const p = spawnPose(sim, w);
    const fountain = sim.areas.landmark(PARK)!;
    expect(w.path(GROUND, p.x, p.z, (x, z) => Math.abs(x - fountain.x) <= 2 && Math.abs(z - fountain.z) <= 2, { x: fountain.x, z: fountain.z })).toBeTruthy();
    const before = { ...p };
    w.move(p, 0.5, 0);
    w.move(p, 0, 0.5);
    expect(Math.hypot(p.x - before.x, p.z - before.z)).toBeGreaterThan(0);
  });

  it('eating biomass or food recharges slowly and uses the item; nothing to eat says so', () => {
    const sim = oldSim();
    sim.state.charge = { value: 10 };
    const pack = sim.state.salvage!.pack as Record<string, number>;
    for (const k of Object.keys(pack)) delete pack[k];
    expect(sim.charge.eat()).toBe('none');
    // the numbers come from E23.5.1's farm items
    const food = FARM_USES.food.charge * CHARGE.max;
    const biomass = FARM_USES.biomass.charge * CHARGE.max;
    const honey = FARM_USES.honey.charge * CHARGE.max; // E23.5.4.1: beehives' strong snack, best first
    // #785: fruit from fruit trees, sweet snacks between honey and food, the sweetest first
    const fruits = CHARGE.edibles.filter((e) => isFruit(e.id)).map((e) => [e.id, FARM_USES[e.id as FruitId].charge * CHARGE.max]);
    expect(fruits.length).toBe(FRUIT_IDS.length);
    expect(CHARGE.edibles.map((e) => [e.id, e.charge])).toEqual([['honey', honey], ...fruits, ['food', food], ['biomass', biomass]]);
    // food first, from the backpack
    pack.food = 1;
    pack.biomass = 3;
    const bio = () => pack.biomass ?? 0;
    const meal = sim.charge.eat();
    expect(meal).toMatchObject({ id: 'food' });
    expect(sim.charge.eat()).toBe('busy');
    expect((sim.state.salvage!.pack as Record<string, number>).food).toBeUndefined();
    sim.advance(1);
    expect(sim.charge.value()).toBeGreaterThan(10);
    expect(sim.charge.value()).toBeLessThan(10 + food);
    sim.advance(3);
    expect(sim.charge.value()).toBeCloseTo(10 + food, 5);
    // then biomass, also from the backpack
    expect(sim.charge.eat()).toMatchObject({ id: 'biomass' });
    expect(bio()).toBe(2);
    sim.advance(3);
    expect(sim.charge.value()).toBeCloseTo(10 + food + biomass, 5);
    sim.state.charge!.value = CHARGE.max;
    expect(sim.charge.eat()).toBe('full');
  });

  it('chargers call recharge(amount); sleeping fills it; research cells make it bigger; it saves', () => {
    const sim = oldSim();
    sim.state.charge = { value: 0 };
    const full: string[] = [];
    sim.bus.on('charge.full', (e) => full.push(e.source));
    expect(sim.charge.recharge(CHARGE.meditatePerSecond * 2, 'charger')).toBeCloseTo(CHARGE.meditatePerSecond * 2);
    expect(sim.charge.recharge(1e6, 'charger')).toBeCloseTo(CHARGE.max - CHARGE.meditatePerSecond * 2);
    expect(full).toEqual(['charger']);
    sim.state.charge!.cells = 2;
    expect(sim.charge.max).toBe(CHARGE.max + 2 * CHARGE.cellCapacity);
    sim.charge.sleep();
    expect(sim.charge.value()).toBe(sim.charge.max);
    sim.state.charge!.efficiency = 1;
    expect(sim.charge.cost('pulse')).toBeCloseTo(CHARGE.pulse * (1 - CHARGE.efficiencyStep));
    sim.charge.use('pulse');
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.charge.value()).toBeCloseTo(sim.charge.value());
    expect(back.charge.max).toBe(sim.charge.max);
  });
});

describe('E23.2.1: never stranded', () => {
  it('at zero with an empty backpack, bloombot walks home, rests, and pulses again (no shortcuts)', () => {
    const sim = oldSim();
    const [far] = pulseable(sim, 1);
    // nothing to eat anywhere
    for (const k of Object.keys(sim.state.salvage!.pack)) delete (sim.state.salvage!.pack as Record<string, number>)[k];
    sim.state.charge = { value: 0 };
    expect(sim.charge.eat()).toBe('none');
    expect(sim.restoration.checkPulse(far).ok).toBe(false);
    // walk home on foot (the low-power walk), the way a player would
    const w = new Walker(sim);
    const p = spawnPose(sim, w);
    const fountain = sim.state.machines.find((m) => m.type === 'core' && sim.areas.areaOf(m) === PARK)!;
    const path = w.path(GROUND, p.x, p.z, (x, z) => Math.abs(x - (fountain.x + 0.5)) <= 2.5 && Math.abs(z - (fountain.z + 0.5)) <= 2.5, { x: fountain.x, z: fountain.z });
    expect(path).toBeTruthy();
    const end = path![path!.length - 1];
    let walked = 0;
    let px = p.x;
    let pz = p.z;
    for (const step of path!) {
      walked += Math.hypot(step.x - px, step.z - pz);
      px = step.x;
      pz = step.z;
      sim.bot = { roofId: GROUND, x: px, z: pz };
      sim.tick();
    }
    sim.advance(walked / (BOT.walk * CHARGE.lowPowerWalk));
    // passing through gives nothing: only standing still there does
    sim.bot = { roofId: GROUND, x: end.x, z: end.z };
    expect(sim.charge.atHome()).toBe(true);
    sim.advance(CHARGE.home.stillSeconds + 0.5);
    expect(sim.charge.resting).toBe(true);
    sim.advance(10);
    expect(sim.charge.value()).toBeGreaterThan(CHARGE.pulse);
    expect(sim.restoration.pulse(far.id)).toBe(true);
  });

  it('away from home, standing still gives nothing back', () => {
    const sim = oldSim();
    sim.state.charge = { value: 0 };
    sim.bot = { roofId: GROUND, x: 8.5, z: -40.5 };
    sim.advance(30);
    expect(sim.charge.value()).toBe(0);
  });

  it('the gentle-failure hooks: drain, refill, and walking is always possible', () => {
    const sim = oldSim();
    sim.charge.drainForTest();
    expect(sim.charge.empty).toBe(true);
    expect(sim.charge.low).toBe(true);
    expect(sim.charge.canWalk()).toBe(true);
    sim.charge.refillForTest();
    expect(sim.charge.value()).toBe(sim.charge.max);
    expect(sim.charge.low).toBe(false);
  });
});
