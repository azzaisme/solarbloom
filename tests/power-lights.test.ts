import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { decorKey } from '../src/core/Decor';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { DECOR_OPTION } from '../src/data/cozy';
import { LIGHT, LIGHTING, LIGHTS } from '../src/data/lights';
import { POWER } from '../src/data/power';
import { Cozy } from '../src/gameplay/Cozy';
import { Sim } from '../src/gameplay/Sim';
import type { WeatherKind } from '../src/data/weather';

SaveService.clock = () => 0;

/**
 * A sim on E23.7's real clock and weather. `sky.f` sets the time of day (0 dawn, 2/3 dusk) through the clock's offset;
 * `sky.kind` holds a weather (`forceForTest`).
 */
function world() {
  const sim = new Sim(createInitialState(7));
  const st = sim.state;
  const sky = {
    get f(): number {
      return sim.clock.dayFraction();
    },
    set f(v: number) {
      (st.clock ??= { offset: 0 }).offset = v * POWER.daySeconds - st.time;
    },
    get kind(): WeatherKind {
      return sim.weather.kind();
    },
    set kind(k: WeatherKind) {
      sim.weather.forceForTest(k, 1e9);
    },
  };
  sky.f = 0.3;
  sky.kind = 'sunny';
  const put = (type: string, x: number, z: number, size = 1): MachineData => {
    const m = { id: sim.newId('m'), type, roofId: GROUND, x, z, size, boostUntil: 0, timer: 0, charge: 0 } as unknown as MachineData;
    sim.state.machines.push(m);
    return m;
  };
  const light = (kind: string, x: number, z: number) => {
    const c = (sim.state.cozy ??= {});
    c.decor = { ...(c.decor ?? {}), [decorKey(GROUND, x, z)]: kind };
    return decorKey(GROUND, x, z);
  };
  /** Runs the lights and the grid for `seconds` (1 s steps), with the clock moving if `day` is set. */
  const run = (seconds: number, day = false) => {
    for (let i = 0; i < seconds; i++) {
      // play time passes (only the lights and the grid are ticked here); without `day` the hour is held
      const f = sky.f;
      st.time += 1;
      if (!day) sky.f = f;
      sim.lights.tick(1);
      sim.power.tick(1);
    }
  };
  const glow = (key: string) => sim.lights.all().find((l) => l.key === key)!.glow;
  return { sim, sky, put, light, run, glow };
}

describe('E23.3.5 night lighting', () => {
  it('every light is a decoration in the tray, costs components, and the starting set is open from the start', () => {
    for (const l of LIGHTS) {
      expect(DECOR_OPTION[l.id], l.id).toBeTruthy();
      expect(Object.keys(l.cost).length, l.id).toBeGreaterThan(0);
      if (l.power === 'solar') expect(l.cost.sunCell, l.id).toBeGreaterThan(0);
      if (l.power === 'grid') expect((l.cost.wire ?? 0) + (l.cost.glassPane ?? 0), l.id).toBeGreaterThan(0);
    }
    const sim = new Sim(createInitialState(7));
    const cozy = new Cozy(sim);
    expect(cozy.isDecorUnlocked(DECOR_OPTION.festoon)).toBe(true);
    expect(cozy.isDecorUnlocked(DECOR_OPTION.lamppost)).toBe(false);
    // a find unlocks its style; research styles wait for E23.6.2's sim.research
    sim.state.salvage!.caches.push('c-mastRow-1');
    expect(cozy.checkDecorUnlocks().map((o) => o.id)).toContain('lamppost');
    expect(cozy.isDecorUnlocked(DECOR_OPTION.uplight)).toBe(false);
    (sim as unknown as { research: unknown }).research = { done: (id: string) => id === 'dc-lights' };
    expect(cozy.checkDecorUnlocks().map((o) => o.id)).toEqual(expect.arrayContaining(['uplight', 'fairylights', 'tablelight']));
  });

  it('grid lights come on by themselves at dusk, fading in, and go off at dawn', () => {
    const { sky, put, light, run, glow } = world();
    put('solar', 0, 0);
    put('solar', 1, 0);
    put('battery', 2, 0);
    put('relay', 3, 0);
    const lamp = light('lamppost', 5, 0);
    sky.f = 0.5; // afternoon
    run(30);
    expect(glow(lamp)).toBe(0);
    // through dusk: it fades in over the twilight, never snapping on
    let last = 0;
    let steps = 0;
    while (sky.f < 2 / 3 + 0.05) {
      run(10, true);
      const g = glow(lamp);
      expect(g).toBeGreaterThanOrEqual(last - 1e-9);
      if (g > 0 && g < LIGHT.lamppost.brightness - 0.01) steps++;
      last = g;
    }
    expect(steps).toBeGreaterThan(3); // several in-between brightnesses: a fade
    run(20);
    expect(glow(lamp)).toBeCloseTo(LIGHT.lamppost.brightness, 2);
    // after dawn's twilight it has faded out again
    sky.f = 0.12;
    run(30);
    expect(glow(lamp)).toBeLessThan(0.05);
  });

  it('come on in fog and storms, in the day too', () => {
    const { sim, sky, put, light, run, glow } = world();
    put('solar', 0, 0);
    put('relay', 1, 0);
    const lamp = light('pathlight', 2, 0);
    sky.f = 0.3; // fog cuts the sun too, so a charged battery carries the lamp
    run(20);
    expect(glow(lamp)).toBe(0);
    put('battery', 0, 1).charge = POWER.battery.capacity;
    sky.kind = 'fog';
    run(20);
    expect(glow(lamp)).toBeGreaterThan(0.5);
    expect(sim.power.sky().dark).toBe(1);
  });

  it('a lamp off the grid stays dark; a pole in reach lights it', () => {
    const { sky, put, light, run, glow } = world();
    put('solar', 0, 0);
    put('battery', 1, 0).charge = POWER.battery.capacity; // charged through the day
    const lamp = light('lamppost', 12, 0);
    sky.f = 0.9;
    run(20);
    expect(glow(lamp)).toBe(0);
    put('relay', 2, 0);
    put('relay', 10, 0);
    run(1);
    run(20);
    expect(glow(lamp)).toBeGreaterThan(0.9);
    // a lamp only joins through a pole: a row of lamps touching each other doesn't carry power past its reach
    const row = [14, 15, 16, 17, 18].map((x) => light('pathlight', x, 0));
    run(20);
    expect(glow(row[0])).toBeGreaterThan(0.7); // within 5 tiles of the pole at 10
    expect(glow(row[4])).toBe(0);
  });

  it('grid lights are first in the shed order: on a short grid they dim and go out gently, then come back', () => {
    const { sim, sky, put, light, run, glow } = world();
    let out = 10;
    sim.power.register('gen', { source: () => out });
    sim.power.register('pump', { consumer: { shed: 'pump', draw: 3 } });
    put('gen', 0, 0);
    put('relay', 1, 0);
    const pump = put('pump', 2, 1);
    const lamps = [light('lamppost', 3, 0), light('lamppost', 4, 3)];
    sky.f = 0.9;
    run(20);
    expect(lamps.map(glow).every((g) => g > 0.95)).toBe(true);
    out = 3.25; // the pump (3 W) keeps its power; 0.25 W left for two 0.5 W lamps
    run(1);
    const mid = lamps.map(glow);
    expect(mid.every((g) => g > 0.5)).toBe(true); // fading, not snapped off
    run(20);
    expect(sim.power.isPowered(pump)).toBe(true);
    const [first, second] = lamps.map(glow);
    expect(first).toBeGreaterThan(0.3); // the older lamp dims on what is left
    expect(first).toBeLessThan(0.7);
    expect(second).toBeLessThan(0.02); // the newer one has gone out, one at a time
    out = 3;
    run(20);
    expect(lamps.map(glow).every((g) => g < 0.02)).toBe(true);
    expect(sim.power.isPowered(pump)).toBe(true);
    out = 10;
    run(20);
    expect(lamps.map(glow).every((g) => g > 0.95)).toBe(true);
  });

  it('a solar garden light needs no grid, lasts the night after a sunny day and dims before dawn after a cloudy one', () => {
    const night = (kind: 'sunny' | 'cloudy') => {
      const { sky, light, run, glow } = world();
      const key = light('lantern', 30, 30);
      sky.kind = kind;
      sky.f = 0.0;
      run(Math.round((2 / 3) * POWER.daySeconds), true); // a whole day, dawn to dusk
      sky.kind = 'sunny';
      const glows: number[] = [];
      while (sky.f > 0.5) {
        run(10, true);
        glows.push(glow(key));
      }
      return glows;
    };
    const sunny = night('sunny');
    const cloudy = night('cloudy');
    const full = LIGHT.lantern.brightness;
    // dimmer than a grid light, and lit all night after a sunny day
    expect(Math.max(...sunny)).toBeLessThanOrEqual(full + 1e-9);
    const lateSunny = sunny.slice(-20, -5);
    expect(Math.min(...lateSunny)).toBeGreaterThan(full * 0.8);
    // after a cloudy day the battery runs out before dawn
    const lateCloudy = cloudy.slice(-20, -5);
    expect(Math.min(...lateCloudy)).toBeLessThan(full * 0.5);
    expect(Math.max(...cloudy)).toBeGreaterThan(full * 0.8);
  });

  it('a solar light is a network of its own (it never joins the grid), and keeps its charge through a save', () => {
    const { sim, sky, put, light, run } = world();
    put('solar', 0, 0);
    const key = light('solarstake', 1, 0); // touching a panel
    sky.f = 0.3;
    run(60);
    const n = sim.lights.nodeOf(key)!;
    expect(sim.power.networkOf(n)!.members).toEqual([n]);
    expect(n.charge).toBeGreaterThan(0);
    const saver = new SaveService(undefined);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(back.lights.nodeOf(key)!.charge).toBeCloseTo(n.charge, 2);
  });

  it('glow-pods glow at night with no power at all', () => {
    const { sim, sky, light, run, glow } = world();
    const key = light('glowpod', 40, 40);
    expect(sim.lights.nodeOf(key)).toBeUndefined();
    sky.f = 0.9;
    run(30);
    expect(glow(key)).toBeCloseTo(LIGHT.glowpod.brightness, 2);
    sky.f = 0.4;
    run(60);
    expect(glow(key)).toBeLessThan(0.001);
  });

  it('line lights hang on a linked pole, draw per bulb, go dark when the pole trips and come back on reset', () => {
    const { sim, sky, put, run, glow } = world();
    sim.power.register('gen', { source: () => 5 });
    put('gen', 0, 0);
    const a = put('relay', 1, 0);
    expect(sim.lights.hang('festoon', GROUND, 1, 1)).toMatch(/no lines/);
    const b = put('relay', 11, 0);
    run(1);
    expect(sim.lights.hang('festoon', GROUND, 20, 20)).toMatch(/power pole/);
    expect(sim.lights.hang('lamppost', GROUND, 1, 1)).toMatch(/ground/);
    expect(sim.lights.hang('festoon', GROUND, 1, 1)).toBeUndefined();
    expect(sim.lights.onPole(a)).toBe('festoon');
    sky.f = 0.9;
    run(20);
    const key = `pole:${a.id}`;
    expect(glow(key)).toBeGreaterThan(0.85);
    const n = sim.lights.nodeOf(key)!;
    const bulbs = Math.round(sim.relays.distance(a, b) / LIGHT.festoon.spacing! / 2);
    expect(sim.power.draw(n)).toBeCloseTo(bulbs * LIGHT.festoon.draw!, 5);
    sim.power.trip({ int: () => 0 }); // the first pole: a
    expect(sim.power.isTripped(a)).toBe(true);
    run(20);
    expect(glow(key)).toBeLessThan(0.05);
    sim.power.reset(a);
    run(20);
    expect(glow(key)).toBeGreaterThan(0.85);
    // taking the pole down takes its lights with it
    sim.state.machines = sim.state.machines.filter((m) => m !== a);
    run(1);
    expect(sim.lights.onPole(a)).toBeUndefined();
    expect(sim.lights.all().some((l) => l.key === key)).toBe(false);
  });

  it('lights come on at dusk in both clock modes: the game’s own day, and following the real clock', () => {
    const { sim, sky, put, light, run, glow } = world();
    sim.power.register('gen', { source: () => 5 });
    put('gen', 0, 0);
    put('relay', 1, 0);
    const lamp = light('pathlight', 2, 0);
    // the game clock: midday, then after dusk
    sky.f = 0.35;
    run(20);
    expect(glow(lamp)).toBe(0);
    sky.f = 0.8;
    run(20);
    expect(glow(lamp)).toBeGreaterThan(0.75);
    // "follow my clock": the game clock still says night, but the real clock says 10:30 in the morning: off
    sim.clock.now = () => new Date(2026, 10, 19, 10, 30);
    sim.clock.real = true;
    run(20);
    expect(glow(lamp)).toBeLessThan(0.02);
    // and the real evening, 23:00: on again
    sim.clock.now = () => new Date(2026, 10, 19, 23, 0);
    run(20);
    expect(glow(lamp)).toBeGreaterThan(0.75);
    expect(LIGHTING.fadeSeconds).toBeGreaterThan(0);
  });

  it('an old save’s lamp posts and lanterns keep glowing: lamp posts become solar lamp posts, both start charged', () => {
    // A save from before night lighting: a lamp post and a lantern placed with no grid, and no `state.power`.
    const old = createInitialState(7);
    const post = decorKey(GROUND, 40, 40);
    const lantern = decorKey(GROUND, 44, 40);
    old.cozy = { decor: { [post]: 'lamppost@1', [lantern]: 'lantern' } };
    delete old.power;
    const saver = new SaveService(undefined);
    const sim = new Sim(saver.deserialize(saver.serialize(old))!);
    expect(sim.state.cozy!.decor![post]).toBe('solarlamppost@1'); // the turn is kept
    expect(LIGHT.solarlamppost.power).toBe('solar');
    expect(sim.lights.nodeOf(post)!.charge).toBe(LIGHTING.solar.capacity);
    expect(sim.lights.nodeOf(lantern)!.charge).toBe(LIGHTING.solar.capacity);
    // the first night: both glow, with no pole anywhere
    sim.weather.forceForTest('sunny', 1e9);
    const st = sim.state;
    for (let i = 0; i < 30; i++) {
      (st.clock ??= { offset: 0 }).offset = 0.85 * POWER.daySeconds - st.time;
      st.time += 1;
      sim.lights.tick(1);
      sim.power.tick(1);
    }
    const g = (k: string) => sim.lights.all().find((l) => l.key === k)!.glow;
    expect(g(post)).toBeGreaterThan(0.5 * LIGHT.solarlamppost.brightness);
    expect(g(lantern)).toBeGreaterThan(0.5 * LIGHT.lantern.brightness);
    // Carried over once: a lamp post placed after loading follows the new rules (a grid lamp), through a save too.
    const fresh = decorKey(GROUND, 48, 40);
    st.cozy!.decor![fresh] = 'lamppost';
    const again = new Sim(saver.deserialize(saver.serialize(st))!);
    expect(again.state.cozy!.decor![fresh]).toBe('lamppost');
    expect(again.state.cozy!.decor![post]).toBe('solarlamppost@1');
    // and a new game is marked at once, so its lamp posts are never carried over
    const ng = new Sim(createInitialState(8));
    ng.state.cozy = { decor: { [fresh]: 'lamppost' } };
    expect(new Sim(saver.deserialize(saver.serialize(ng.state))!).state.cozy!.decor![fresh]).toBe('lamppost');
  });
});
