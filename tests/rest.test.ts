import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { CHARGE } from '../src/data/charge';
import { KEEPERS } from '../src/data/oldcity';
import { PROJECTS } from '../src/data/research';
import { BOT_CLIPS, REST, seatLift } from '../src/data/rest';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const oldSim = () => new Sim(createInitialState(7));
/** The park's old benches (generated props). */
const parkBenches = (sim: Sim) => [[3, 6], [10, 6], [5, 9], [9, 10]].map(([x, z]) => sim.rest.benchAt(x, z)!);

describe('E23.2.3: benches', () => {
  it('the park has old benches, broken until mended with a little scrap', () => {
    const sim = oldSim();
    const benches = parkBenches(sim);
    expect(benches.every((b) => b && b.kind === 'old')).toBe(true);
    const b = benches[0];
    expect(sim.rest.usable(b)).toBe(false);
    expect(sim.rest.sitOnBench(b)).toBe(false);
    expect(sim.rest.mend(b)).toMatch(/scrap/i);
    sim.inventory.add('scrap', REST.mendCost.scrap!);
    expect(sim.rest.mend(b)).toBeUndefined();
    expect(sim.inventory.count('scrap')).toBe(0);
    expect(sim.rest.usable(b)).toBe(true);
    // mended for good (saved)
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.rest.usable(b)).toBe(true);
  });

  it('a placed bench is ready at once', () => {
    const sim = oldSim();
    sim.state.cozy = { decor: { [`${GROUND}|2|12`]: 'bench@1' } };
    const b = sim.rest.benchAt(2, 12)!;
    expect(b.kind).toBe('placed');
    expect(b.facing).toBeCloseTo(-Math.PI / 2); // turned with the decoration, as it is drawn
    expect(sim.rest.benchAt(3, 6)!.facing).toBe(0);
    expect(sim.rest.usable(b)).toBe(true);
  });

  it('sitting trickles charge back; standing stops it and puts time back to normal; sitting is never saved', () => {
    const sim = oldSim();
    const b = parkBenches(sim)[1];
    sim.inventory.add('scrap', 3);
    sim.rest.mend(b);
    sim.state.charge = { value: 10 };
    expect(sim.rest.sitOnBench(b)).toBe(true);
    sim.rest.fast = true;
    sim.advance(10);
    expect(sim.charge.value()).toBeCloseTo(10 + 10 * CHARGE.benchPerSecond, 1);
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.rest.sitting).toBeUndefined();
    sim.rest.stand();
    expect(sim.rest.sitting).toBeUndefined();
    expect(sim.rest.fast).toBe(false);
    const v = sim.charge.value();
    sim.advance(5);
    expect(sim.charge.value()).toBeCloseTo(v, 5);
  });

  it('only Keepers who are friends may sit beside bloombot, nearest first', () => {
    const sim = oldSim();
    expect(sim.rest.friends(5, 5)).toEqual([]);
    sim.state.salvage!.keepers[KEEPERS[0].id] = { step: 'request1' };
    sim.state.salvage!.keepers[KEEPERS[1].id] = { step: 'request2' };
    expect(sim.rest.friends(5, 5)).toEqual([]); // still asking for things: not a friend yet
    sim.state.salvage!.keepers[KEEPERS[0].id] = { step: 'settled' };
    sim.state.salvage!.keepers[KEEPERS[1].id] = { step: 'settled' };
    // a friend still lost in the fog is never shown, so it can't come and sit
    for (const k of KEEPERS.slice(0, 2)) delete sim.state.areas[k.region];
    expect(sim.rest.friends(KEEPERS[1].x, KEEPERS[1].z)).toEqual([]);
    for (const k of KEEPERS.slice(0, 2)) sim.state.areas[k.region] = { fog: 'cleared', revealedAt: 0 };
    expect(sim.rest.friends(KEEPERS[1].x, KEEPERS[1].z)).toEqual([KEEPERS[1].id, KEEPERS[0].id]);
    // E23.9.2's friendship decides once it is on the sim (three gifts after settling): only true friends
    (sim.keepers as unknown as { isFriend(id: string): boolean }).isFriend = (id) => id === KEEPERS[0].id;
    expect(sim.rest.friends(KEEPERS[1].x, KEEPERS[1].z)).toEqual([KEEPERS[0].id]);
  });

  it('never stranded by day: at zero with an empty pack, resting on a bench brings the pulse back', () => {
    const sim = oldSim();
    const b = parkBenches(sim)[1];
    sim.inventory.add('scrap', REST.mendCost.scrap!);
    sim.rest.mend(b); // a bench mended earlier in the day
    // nothing to eat: biomass and food are backpack items (E23.1.4), and the pack is empty
    for (const k of Object.keys(sim.state.salvage!.pack)) delete (sim.state.salvage!.pack as Record<string, number>)[k];
    sim.state.charge = { value: 0 };
    sim.bot = { roofId: GROUND, x: b.x + 0.5, z: b.z + 1.5 }; // in front of the bench
    expect(sim.clock.gameIsDay()).toBe(true); // daytime: no sleeping to fall back on
    expect(sim.clock.canSleep()).toBe(false);
    const dead = sim.areas.tiles('park').find((t) => t.ground === 'polluted' && !t.blocked && !t.occupantId)!;
    expect(sim.restoration.checkPulse(dead).ok).toBe(false);
    expect(sim.rest.sitOnBench(b)).toBe(true);
    sim.advance(Math.ceil(CHARGE.pulse / CHARGE.benchPerSecond) + 1);
    sim.rest.stand();
    expect(sim.restoration.pulse(dead.id)).toBe(true);
  });
});

describe('E23.2.3: meditating at a charger', () => {
  /** A machine on cleared ground, as the build system leaves it (E23.3's grid finds it by its tiles). */
  const put = (sim: Sim, type: string, x: number, z: number): MachineData => {
    const t = sim.grid.get(GROUND, x, z)!;
    t.ground = 'restored';
    t.blocked = false;
    const m = { id: sim.newId('m'), type, roofId: GROUND, x, z, size: 1, boostUntil: 0, timer: 0, charge: 0 } as unknown as MachineData;
    sim.state.machines.push(m);
    t.occupantId = m.id;
    sim.grid.indexMachine(m);
    return m;
  };
  /** Clear noon, so solar panels give their full power (E23.7's sky is not what these tests are about). */
  const noon = (sim: Sim) => {
    sim.power.skyOverride = () => ({ sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 });
    return sim;
  };

  it('meditates at a real charger: the pad charges it while the grid has power, and nothing on a dead line', () => {
    const sim = noon(oldSim());
    const pad = put(sim, 'charger', 30, 30);
    expect(sim.power.roleOf(pad), "the charger's role on the grid").toBeTruthy();
    sim.state.charge = { value: 0 };
    sim.bot = { roofId: GROUND, x: 30.5, z: 31.35 }; // sitting at the pad's edge, as Resting seats it
    expect(sim.rest.meditate(pad)).toBe(true);
    // a lone pad: no power, no charge (never powered without a source on its network)
    sim.advance(3);
    expect(sim.rest.powered(pad)).toBe(false);
    expect(sim.charge.value()).toBe(0);
    expect(sim.rest.sitting?.kind).toBe('charger');
    // panels beside it: the pad charges fast, once (no second fill from the meditation itself)
    put(sim, 'solar', 31, 30);
    put(sim, 'solar', 29, 30);
    sim.advance(2);
    expect(sim.rest.powered(pad)).toBe(true);
    expect(sim.charge.value()).toBeCloseTo(2 * CHARGE.meditatePerSecond, 1);
    expect(CHARGE.meditatePerSecond).toBeGreaterThan(CHARGE.benchPerSecond * 5); // fast, next to a bench
  });

  it('stands up when the charger goes, or when bloombot is no longer at it', () => {
    const sim = noon(oldSim());
    const pad = put(sim, 'charger', 30, 30);
    sim.bot = { roofId: GROUND, x: 30.5, z: 31.35 };
    sim.rest.meditate(pad);
    sim.bot = { roofId: GROUND, x: 30.5, z: 33.5 }; // moved away
    sim.advance(1);
    expect(sim.rest.sitting).toBeUndefined();
    sim.bot = { roofId: GROUND, x: 30.5, z: 31.35 };
    sim.rest.meditate(pad);
    sim.state.machines.splice(sim.state.machines.indexOf(pad), 1);
    sim.advance(1);
    expect(sim.rest.sitting).toBeUndefined();
  });

  it('a machine with no grid role is never a powered charger, and cannot be meditated at', () => {
    const sim = noon(oldSim());
    const odd = put(sim, 'notACharger', 30, 30);
    expect(sim.power.roleOf(odd)).toBeUndefined();
    expect(sim.rest.powered(odd)).toBe(false);
    expect(sim.rest.meditate(odd)).toBe(false);
    expect(sim.rest.sitting).toBeUndefined();
  });
});

describe('E23.2.1 (#371): one meter, fed by the grid and by research', () => {
  it('battery cells researched make a bigger charge, and meditating at a powered pad fills it to the new top', () => {
    const sim = oldSim();
    sim.power.skyOverride = () => ({ sun: 1, solar: 1, cloudy: false, wind: 0, dark: 0 });
    // the research is done and the cells are in the pack: buy "Bigger charge" twice through the real research
    sim.state.salvage!.research = { analysed: [], done: PROJECTS.map((p) => p.id), running: [], levels: {} };
    sim.inventory.add('batteryCell', 5);
    sim.inventory.add('gears', 4);
    const max0 = sim.charge.max;
    expect(sim.research.upgrade('chargeCells')).toBe(1);
    expect(sim.research.upgrade('chargeCells')).toBe(2);
    expect(sim.charge.max).toBe(max0 + 2 * CHARGE.cellCapacity);
    // a charger with panels beside it, bloombot sat at its edge meditating
    const put = (type: string, x: number, z: number): MachineData => {
      const t = sim.grid.get(GROUND, x, z)!;
      t.ground = 'restored';
      t.blocked = false;
      const m = { id: sim.newId('m'), type, roofId: GROUND, x, z, size: 1, boostUntil: 0, timer: 0, charge: 0 } as unknown as MachineData;
      sim.state.machines.push(m);
      t.occupantId = m.id;
      sim.grid.indexMachine(m);
      return m;
    };
    const pad = put('charger', 30, 30);
    put('solar', 31, 30);
    put('solar', 29, 30);
    sim.state.charge = { ...sim.state.charge!, value: max0 - 1 };
    sim.bot = { roofId: GROUND, x: 30.5, z: 31.35 };
    expect(sim.rest.meditate(pad)).toBe(true);
    sim.advance(Math.ceil((2 * CHARGE.cellCapacity + 1) / CHARGE.meditatePerSecond) + 2);
    expect(sim.charge.value()).toBeCloseTo(sim.charge.max, 3); // past the old top, to the new one
    expect(sim.charge.max).toBeGreaterThan(max0);
  });
});

describe('E23.2.3: a bench taken away', () => {
  it('stands bloombot up when the placed bench it sits on is picked up', () => {
    const sim = oldSim();
    sim.state.cozy = { decor: { [`${GROUND}|2|12`]: 'bench@0' } };
    const b = sim.rest.benchAt(2, 12)!;
    const stood: unknown[] = [];
    sim.bus.on('rest.stood', (e) => stood.push(e));
    expect(sim.rest.sitOnBench(b)).toBe(true);
    sim.advance(1);
    expect(sim.rest.sitting?.kind).toBe('bench');
    delete sim.state.cozy.decor![`${GROUND}|2|12`];
    sim.advance(1);
    expect(sim.rest.sitting).toBeUndefined();
    expect(stood.length).toBe(1); // the game puts the view back on this event
  });
});

describe('E23.2.3: sitting on the seat', () => {
  it("lifts bloombot so the sit clip's hips rest on the bench seat, legs dangling", () => {
    const lift = seatLift(REST.benchSeat, 0.95);
    expect(lift).toBeCloseTo(REST.benchSeat - BOT_CLIPS.seatHips * 0.95, 6);
    expect(lift).toBeGreaterThan(0);
    expect(lift + BOT_CLIPS.seatHips * 0.95).toBeCloseTo(REST.benchSeat, 6); // hips on the seat
    expect(seatLift(0.1, 0.95)).toBe(0); // never sunk below the ground
  });
});
