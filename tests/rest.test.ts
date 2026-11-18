import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { CHARGE } from '../src/data/charge';
import { KEEPERS } from '../src/data/oldcity';
import { BOT_CLIPS, REST, seatLift } from '../src/data/rest';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const oldSim = () => new Sim(createInitialState(7, 'oldcity'));
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
    for (const k of Object.keys(sim.state.salvage!.pack)) delete (sim.state.salvage!.pack as Record<string, number>)[k];
    sim.econ.spend({ biomass: sim.econ.get('biomass') });
    sim.econ.add('energy', 1e6);
    sim.econ.add('water', 1e6);
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
  const charger = (sim: Sim): MachineData => {
    const m = { id: 'mc1', type: 'charger', roofId: GROUND, x: 6, z: 12, size: 1, boostUntil: 0, timer: 0, charge: 0 } as unknown as MachineData;
    sim.state.machines.push(m);
    return m;
  };

  it('charges fast while powered, nothing while the grid is short, and stops if the charger goes', () => {
    const sim = oldSim();
    const m = charger(sim);
    sim.state.charge = { value: 0 };
    sim.rest.meditate(m);
    sim.advance(5);
    expect(sim.charge.value()).toBeCloseTo(5 * CHARGE.meditatePerSecond, 1);
    expect(CHARGE.meditatePerSecond).toBeGreaterThan(CHARGE.benchPerSecond * 5); // fast, next to a bench
    // E23.3's grid, once the charger has a role on it (E23.3.3): an unpowered charger gives nothing
    let powered = false;
    sim.power.roleOf = (() => ({})) as typeof sim.power.roleOf;
    sim.power.isPowered = () => powered;
    const v = sim.charge.value();
    sim.advance(3);
    expect(sim.charge.value()).toBeCloseTo(v, 5);
    powered = true;
    sim.advance(1);
    expect(sim.charge.value()).toBeGreaterThan(v);
    sim.state.machines.splice(sim.state.machines.indexOf(m), 1);
    sim.advance(1);
    expect(sim.rest.sitting).toBeUndefined();
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
