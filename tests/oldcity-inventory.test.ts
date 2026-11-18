import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { big } from '../src/core/Big';
import { createInitialState, GROUND } from '../src/core/GameState';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);
const oldSim = (seed = 7) => new Sim(createInitialState(seed, 'oldcity'));
/** Beside the fountain (a way into the store), and far from any. */
const NEAR = { roofId: GROUND, x: 8.5, z: 11.5 };
const FAR = { roofId: GROUND, x: 8.5, z: -40.5 };

describe('E21.1: the backpack', () => {
  it('stacks stop at the tier limit and the rest is handed back', () => {
    const sim = oldSim();
    const inv = sim.inventory;
    const full: number[] = [];
    sim.bus.on('pack.full', (e) => full.push(e.left));
    expect(inv.stackLimit()).toBe(40);
    expect(inv.add('scrap', 30)).toBe(0);
    expect(inv.add('scrap', 15)).toBe(5);
    expect(inv.count('scrap')).toBe(40);
    expect(full).toEqual([5]);
    sim.state.salvage!.tier = 2;
    expect(inv.stackLimit()).toBe(60);
    sim.state.salvage!.tier = 4;
    expect(inv.stackLimit()).toBe(120);
    sim.state.salvage!.blueprints.push('packFrame');
    expect(inv.stackLimit()).toBe(160);
  });

  it('take is all or nothing; deposit and withdraw move between pack and store, withdraw only up to a stack', () => {
    const sim = oldSim();
    const inv = sim.inventory;
    inv.add('copper', 12);
    expect(inv.take('copper', 13)).toBe(false);
    expect(inv.take('copper', 2)).toBe(true);
    expect(inv.deposit('copper', 4)).toBe(4);
    expect(inv.count('copper')).toBe(6);
    expect(inv.stored('copper')).toBe(4);
    inv.addToStore('copper', 100);
    expect(inv.withdraw('copper')).toBe(34); // a stack is 40, 6 already carried
    expect(inv.count('copper')).toBe(40);
    expect(inv.depositAll()).toBe(40);
    expect(inv.count('copper')).toBe(0);
  });
});

describe('E21.1: paying', () => {
  it('pays from the pack first, then the store — only within 12 tiles of a way into it', () => {
    const sim = oldSim();
    const inv = sim.inventory;
    inv.add('scrap', 4);
    inv.addToStore('scrap', 20);
    const cost = { scrap: 10 };
    expect(inv.canPay(cost, FAR)).toBe(false);
    expect(inv.shortfall(cost, FAR)).toBe('scrap');
    expect(inv.canPay(cost, NEAR)).toBe(true);
    expect(inv.pay(cost, NEAR)).toBe(true);
    expect(inv.count('scrap')).toBe(0);
    expect(inv.stored('scrap')).toBe(14);
    // exactly 12 tiles from the fountain's footprint (7–8, 7–8) counts; 13 doesn't
    expect(inv.nearStore({ roofId: GROUND, x: 8.5, z: 20.5 })).toBe(true);
    expect(inv.nearStore({ roofId: GROUND, x: 8.5, z: 21.5 })).toBe(false);
  });

  it('E23.5.1: a recipe’s biomass is a carried item, paid like any material (the counter is never read)', () => {
    const sim = oldSim();
    const inv = sim.inventory;
    sim.state.resources.biomass = big(1000);
    inv.add('biomass', 5);
    inv.add('seeds', 10);
    expect(inv.shortfall({ seeds: 10, biomass: 20 }, FAR)).toBe('biomass');
    inv.add('biomass', 20);
    expect(inv.pay({ seeds: 10, biomass: 20 }, FAR)).toBe(true);
    expect(inv.count('biomass')).toBe(5);
    expect(sim.econ.get('biomass').toNumber()).toBe(1000);
  });

  it('a refund goes to the pack, anything over a stack to the store', () => {
    const sim = oldSim();
    const inv = sim.inventory;
    inv.add('scrap', 35);
    inv.refund({ scrap: 10 });
    expect(inv.count('scrap')).toBe(40);
    expect(inv.stored('scrap')).toBe(5);
  });
});

describe('E21.1: saving', () => {
  it('save → load → save is byte-identical with a part-filled pack and store', () => {
    const sim = oldSim(21);
    sim.inventory.add('scrap', 17);
    sim.inventory.add('seeds', 3);
    sim.inventory.addToStore('copper', 9);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(back.inventory.count('scrap')).toBe(17);
    expect(back.inventory.stored('copper')).toBe(9);
    expect(saver.serialize(back.state)).toBe(json);
  });

  it('nothing changes under classic rules', () => {
    const sim = new Sim(createInitialState(7));
    expect(sim.inventory.on).toBe(false);
    expect(sim.inventory.add('scrap', 5)).toBe(5);
    expect(sim.inventory.canPay({ scrap: 1 }, NEAR)).toBe(false);
    expect('salvage' in sim.state).toBe(false);
  });
});
