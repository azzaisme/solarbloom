import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { POWER } from '../src/data/power';
import type { PowerSky } from '../src/gameplay/PowerEnv';
import { sunAt } from '../src/gameplay/PowerEnv';
import { Sim } from '../src/gameplay/Sim';

const DAY: PowerSky = { sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 };
const NIGHT: PowerSky = { sun: 0, solar: 0, cloudy: false, wind: 0, dark: 1 };

/** A sim with test machine types: a 10 W generator, a 1000 W·s battery and one consumer per shed class. */
function world() {
  const sim = new Sim(createInitialState(7));
  let sky = DAY;
  sim.power.skyOverride = () => sky;
  sim.power.register('gen', { source: () => 10 });
  sim.power.register('bat', { battery: { capacity: 1000, rate: 20 } });
  sim.power.register('lamp', { consumer: { shed: 'lamp', draw: 2, dims: true } });
  sim.power.register('pump', { consumer: { shed: 'pump', draw: 3 } });
  sim.power.register('helper', { consumer: { shed: 'helper', draw: 4 } });
  sim.power.register('charger', { consumer: { shed: 'charger', draw: 5 } });
  const put = (type: string, x: number, z: number, size = 1): MachineData => {
    const m = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 } as unknown as MachineData;
    sim.state.machines.push(m);
    return m;
  };
  return { sim, put, setSky: (s: PowerSky) => (sky = s) };
}

describe('E23.3.1 power grid', () => {
  it('machines the grid does not know are always powered', () => {
    const { sim, put } = world();
    const c = put('chest', 0, 0);
    expect(sim.power.isPowered(c)).toBe(true);
    expect(sim.power.networkOf(c)).toBeUndefined();
  });

  it('touching machines share a network; far ones do not; poles link in range and machines attach to them', () => {
    const { sim, put } = world();
    const g = put('gen', 0, 0);
    const p = put('pump', 1, 1); // diagonal: touching
    const far = put('pump', 39, 0);
    expect(sim.power.networkOf(g)).toBe(sim.power.networkOf(p));
    expect(sim.power.networkOf(far)).not.toBe(sim.power.networkOf(g));
    expect(sim.power.isPowered(p)).toBe(true);
    expect(sim.power.isPowered(far)).toBe(false);
    // A pole line: relays link within their range and the far pump attaches to the last one.
    const range = sim.relays.range();
    const r1 = put('relay', 3, 0);
    const r2 = put('relay', 3 + Math.floor(range), 0);
    const r3 = put('relay', 3 + 2 * Math.floor(range), 0);
    expect(far.x - r3.x).toBeLessThanOrEqual(POWER.pole.attachReach);
    expect(r3.x - r2.x).toBeLessThanOrEqual(range);
    tick(sim);
    const net = sim.power.networkOf(g)!;
    expect(sim.power.networkOf(far)).toBe(net);
    expect(net.poles.map((m) => m.id)).toEqual([r1.id, r2.id, r3.id]);
    expect(net.links.length).toBe(2);
    expect(sim.power.isPowered(far)).toBe(true);
  });

  it('surplus charges the battery; at night the battery covers the deficit, then drains', () => {
    const { sim, put, setSky } = world();
    sim.power.register('gen', { source: (_m, _s, sky) => 10 * sky.sun });
    put('gen', 0, 0);
    const b = put('bat', 1, 0);
    const pump = put('pump', 2, 0);
    for (let i = 0; i < 100; i++) sim.power.tick(1);
    expect(b.charge).toBeCloseTo(700, 6); // 10 − 3 = 7 W surplus for 100 s
    expect(sim.power.networkOf(b)!.batteryFlow).toBeCloseTo(7);
    setSky(NIGHT);
    for (let i = 0; i < 100; i++) sim.power.tick(1);
    expect(b.charge).toBeCloseTo(400, 6);
    expect(sim.power.isPowered(pump)).toBe(true);
    for (let i = 0; i < 200; i++) sim.power.tick(1);
    expect(b.charge).toBeLessThan(3); // too little left to run the pump for a step: it stays put
    expect(sim.power.isPowered(pump)).toBe(false);
    // Comes back by itself at dawn.
    setSky(DAY);
    sim.power.tick(1);
    expect(sim.power.isPowered(pump)).toBe(true);
  });

  it('a battery never charges past its capacity or its rate', () => {
    const { sim, put } = world();
    sim.power.register('gen', { source: () => 100 });
    put('gen', 0, 0);
    const b = put('bat', 1, 0);
    sim.power.tick(1);
    expect(b.charge).toBe(20);
    for (let i = 0; i < 100; i++) sim.power.tick(1);
    expect(b.charge).toBe(1000);
    expect(sim.power.stored(b)).toEqual({ stored: 1000, capacity: 1000 });
  });

  it('when short, sheds lamps, then pumps, then helpers, chargers last; earlier builds keep power longest', () => {
    const { sim, put } = world();
    let out = 14; // 5 + 4 + 3 + 2: everything on
    sim.power.register('gen', { source: () => out });
    put('gen', 0, 0);
    const lamp = put('lamp', 1, 0);
    const pump = put('pump', 2, 0);
    const helper = put('helper', 3, 0);
    const charger = put('charger', 4, 0);
    const on = () => [lamp, pump, helper, charger].map((m) => sim.power.isPowered(m));
    sim.power.tick(1);
    expect(on()).toEqual([true, true, true, true]);
    out = 13; // the lamp dims but stays on
    sim.power.tick(1);
    expect(on()).toEqual([true, true, true, true]);
    out = 11.9; // not enough for the pump: it and the lamp go dark
    sim.power.tick(1);
    expect(on()).toEqual([false, false, true, true]);
    out = 8; // the helper goes
    sim.power.tick(1);
    expect(on()).toEqual([false, false, false, true]);
    out = 4; // even the charger
    sim.power.tick(1);
    expect(on()).toEqual([false, false, false, false]);
    out = 14;
    sim.power.tick(1);
    expect(on()).toEqual([true, true, true, true]);
    // Two pumps, room for one: the older keeps it.
    const pump2 = put('pump', 5, 0);
    out = 14;
    sim.power.tick(1);
    expect([sim.power.isPowered(pump), sim.power.isPowered(pump2)]).toEqual([true, false]);
  });

  it('lights fade: level eases toward the served share over the fade time', () => {
    const { sim, put } = world();
    let out = 2;
    sim.power.register('gen', { source: () => out });
    put('gen', 0, 0);
    const lamp = put('lamp', 1, 0);
    for (let i = 0; i < 100; i++) sim.power.tick(0.2);
    expect(sim.power.level(lamp)).toBeCloseTo(1, 3);
    out = 1;
    sim.power.tick(0.2);
    const l = sim.power.level(lamp);
    expect(l).toBeLessThan(1);
    expect(l).toBeGreaterThan(0.5);
    for (let i = 0; i < 100; i++) sim.power.tick(0.2);
    expect(sim.power.level(lamp)).toBeCloseTo(0.5, 3);
  });

  it('an idle consumer (draw 0) is on and costs nothing', () => {
    const { sim, put } = world();
    let docked = false;
    sim.power.register('charger', { consumer: { shed: 'charger', draw: () => (docked ? 5 : 0) } });
    const c = put('charger', 0, 0);
    expect(sim.power.isPowered(c)).toBe(true);
    docked = true;
    sim.power.tick(1);
    expect(sim.power.isPowered(c)).toBe(false);
  });

  it('is deterministic: the same build gives the same networks and battery levels', () => {
    const run = () => {
      const { sim, put, setSky } = world();
      sim.power.register('gen', { source: (_m, _s, sky) => 6 * sky.sun });
      for (let i = 0; i < 6; i++) {
        put('relay', i * 12, 0);
        put(['gen', 'bat', 'pump', 'lamp', 'helper', 'charger'][i], i * 12 + 2, 1);
      }
      for (let t = 0; t < 600; t++) {
        setSky(t % 200 < 120 ? DAY : NIGHT);
        sim.power.tick(0.5);
      }
      return sim.power.networks().map((n) => [n.id, n.members.map((m) => m.id).join(','), n.stored.toFixed(6), n.served.toFixed(6)]);
    };
    expect(run()).toEqual(run());
  });

  it('solar follows the sun and loses 20% in cloud; E23.7 handles are read when present', () => {
    const { sim, put, setSky } = world();
    const s = put('solar', 0, 0);
    expect(sim.power.output(s, DAY)).toBe(POWER.solar.output);
    setSky(NIGHT);
    expect(sim.power.output(s)).toBe(0);
    // Through the adapter: no clock or weather means a clear day.
    sim.power.skyOverride = undefined;
    expect(sim.power.output(s)).toBe(POWER.solar.output);
    const weather = { kind: 'cloudy' };
    const any = sim as unknown as { weather: unknown; clock: unknown };
    any.weather = { kind: () => weather.kind };
    expect(sim.power.output(s)).toBeCloseTo(POWER.solar.output * 0.8);
    // E23.7's day fraction: 0 dawn, 2/3 dusk; its solar factor wins when present.
    const clock = { f: 0.3 };
    any.clock = { dayFraction: () => clock.f };
    weather.kind = 'sunny';
    expect(sim.power.output(s)).toBe(POWER.solar.output);
    clock.f = 0.8;
    expect(sim.power.output(s)).toBe(0);
    expect(sim.power.sky().dark).toBe(1);
    any.clock = { solarFactor: () => 0.25, daylight: () => 0.5 };
    expect(sim.power.output(s)).toBe(POWER.solar.output * 0.25);
    expect(sunAt(0.5)).toBe(1);
    expect(sunAt(0.9)).toBe(0);
  });

  it('re-links when a pole range changes without a build (Relay Lens)', () => {
    const { sim, put } = world();
    const range = sim.relays.range();
    const a = put('relay', 0, 0);
    const b = put('relay', Math.ceil(range) + 3, 0);
    sim.power.tick(1);
    expect(sim.power.networkOf(a)).not.toBe(sim.power.networkOf(b));
    a.upg = { relayLens: 1 };
    sim.power.tick(1);
    expect(sim.power.networkOf(a)).toBe(sim.power.networkOf(b));
  });

  it('ticks with the sim', () => {
    const { sim, put } = world();
    put('gen', 0, 0);
    const b = put('bat', 1, 0);
    sim.advance(2);
    expect(b.charge).toBeGreaterThan(0);
  });
});

function tick(sim: Sim) {
  sim.power.tick(1);
}

describe('E23.3.2 sources and storage', () => {
  it('a small home grid of solar and a battery runs a lamp and a pump through a whole day and night', () => {
    const { sim, put } = world();
    const clock = { f: 0.3 };
    (sim as unknown as { clock: { dayFraction: () => number } }).clock = { dayFraction: () => clock.f };
    sim.power.skyOverride = undefined;
    for (let i = 0; i < 3; i++) put('solar', i, 0);
    put('battery', 3, 0);
    const pump = put('pump', 4, 0);
    const lamp = put('lamp', 5, 0);
    sim.power.register('pump', { consumer: { shed: 'pump', draw: 3 } });
    sim.power.register('lamp', { consumer: { shed: 'lamp', draw: 0.5, dims: true } });
    const day = POWER.daySeconds;
    let dark = 0;
    // Two full days from mid-morning, in 1 s steps.
    for (let s = 0; s < 2 * day; s++) {
      clock.f = (0.3 + s / day) % 1;
      sim.power.tick(1);
      if (!sim.power.isPowered(pump) || sim.power.level(lamp) < 0.99) dark++;
    }
    expect(dark).toBe(0);
  });

  it('turbine output follows the weather, and is stronger on high ground and in windy regions', () => {
    const { sim, put } = world();
    sim.power.skyOverride = undefined;
    const t = put('windTurbine', 0, 0);
    const weather = { kind: 'sunny' };
    (sim as unknown as { weather: { kind: () => string } }).weather = { kind: () => weather.kind };
    expect(sim.power.output(t)).toBe(0);
    weather.kind = 'windy';
    const windy = sim.power.output(t);
    expect(windy).toBeGreaterThan(0);
    weather.kind = 'storm';
    const storm = sim.power.output(t);
    expect(storm).toBeGreaterThan(windy);
    // Flat ground gives half; three terrace levels up gives the full output.
    expect(storm).toBeCloseTo(POWER.wind.output * POWER.wind.groundShare);
    sim.grid.get(GROUND, 0, 0)!.level = 3;
    expect(sim.power.output(t)).toBeCloseTo(POWER.wind.output);
    // E23.8's region strengths win when present.
    (sim as unknown as { regions: { strength: () => number } }).regions = { strength: () => 1.5 };
    expect(sim.power.output(t)).toBeCloseTo(POWER.wind.output * 1.5);
  });

  it('batteries are on the grid by default and keep their charge in the machine (saved)', () => {
    const { sim, put } = world();
    put('solar', 0, 0);
    const b = put('battery', 1, 0);
    sim.power.tick(10);
    expect(b.charge).toBeCloseTo(Math.min(POWER.battery.rate, POWER.solar.output) * 10);
    expect(JSON.parse(JSON.stringify(b)).charge).toBe(b.charge);
  });

  it('Bloom Relays are poles: networks form across them, and their chain links are unchanged', () => {
    const { sim, put } = world();
    const a = put('relay', 0, 0);
    const b = put('relay', 10, 0);
    const s = put('solar', 1, 0);
    const p = put('pump', 11, 0);
    expect(sim.power.networkOf(s)).toBe(sim.power.networkOf(p));
    expect(sim.relays.linked(a).map((m) => m.id)).toEqual([b.id]);
  });
});
