import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { CHARGE } from '../src/data/charge';
import { KEEPERS } from '../src/data/oldcity';
import { REST } from '../src/data/rest';
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
    expect(sim.charge.value).toBeCloseTo(10 + 10 * CHARGE.benchPerSecond, 1);
    const saver = new SaveService(undefined);
    const back = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(back.rest.sitting).toBeUndefined();
    sim.rest.stand();
    expect(sim.rest.sitting).toBeUndefined();
    expect(sim.rest.fast).toBe(false);
    const v = sim.charge.value;
    sim.advance(5);
    expect(sim.charge.value).toBeCloseTo(v, 5);
  });

  it('Keepers who are friends may sit beside bloombot, nearest first', () => {
    const sim = oldSim();
    expect(sim.rest.friends(5, 5)).toEqual([]);
    sim.state.salvage!.keepers[KEEPERS[0].id] = { step: 'request1' };
    expect(sim.rest.friends(5, 5)).toEqual([]); // just woken: not a friend yet
    sim.state.salvage!.keepers[KEEPERS[0].id] = { step: 'request2' };
    sim.state.salvage!.keepers[KEEPERS[1].id] = { step: 'settled' };
    const f = sim.rest.friends(KEEPERS[1].x, KEEPERS[1].z);
    expect(f).toEqual([KEEPERS[1].id, KEEPERS[0].id]);
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
    expect(sim.charge.value).toBeCloseTo(5 * CHARGE.meditatePerSecond, 1);
    expect(CHARGE.meditatePerSecond).toBeGreaterThan(CHARGE.benchPerSecond * 5); // fast, next to a bench
    // E23.3's grid: an unpowered charger gives nothing
    let powered = false;
    (sim as unknown as { power: { isPowered(m: MachineData): boolean } }).power = { isPowered: () => powered };
    const v = sim.charge.value;
    sim.advance(3);
    expect(sim.charge.value).toBeCloseTo(v, 5);
    powered = true;
    sim.advance(1);
    expect(sim.charge.value).toBeGreaterThan(v);
    sim.state.machines.splice(sim.state.machines.indexOf(m), 1);
    sim.advance(1);
    expect(sim.rest.sitting).toBeUndefined();
  });
});

describe('E23.2.3: the new clips', () => {
  it("bloombot's model carries the sit and meditate loops beside its seven clips", async () => {
    const { readFileSync } = await import('node:fs');
    const buf = readFileSync(new URL('../assets/raw/bloombot/bloombot.glb', import.meta.url));
    const len = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as { animations: { name: string }[] };
    const names = json.animations.map((a) => a.name).sort();
    expect(names).toEqual(['assemble', 'cheer', 'hover', 'idle', 'interact', 'meditate', 'pulse', 'sit', 'walk']);
  });
});
