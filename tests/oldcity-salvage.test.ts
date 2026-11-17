import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { PARK_SET } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);
const oldSim = (seed = 7) => new Sim(createInitialState(seed, 'oldcity'));
const pile = (id: string) => PARK_SET.piles.find((p) => p.id === id)!;

describe('E21.2: salvage piles', () => {
  it('the park holds 60 Scrap and 18 Seeds, the first pile right in front of bloombot', () => {
    const sim = oldSim();
    expect(sim.salvage.looseLeft('scrap', 'park')).toBe(60);
    expect(sim.salvage.looseLeft('seeds', 'park')).toBe(18);
    const t = sim.grid.get(GROUND, 8, 9)!;
    expect(t.blocked).toBe(true);
    expect(sim.salvage.pileAt(8, 9)?.id).toBe('pk-s1');
  });

  it('a small pile empties in two goes, and the tile under it can then be pulsed', () => {
    const sim = oldSim();
    expect(sim.salvage.salvage('pk-s1')).toBe(3);
    expect(sim.salvage.left('pk-s1')).toBe(3);
    expect(sim.grid.get(GROUND, 8, 9)!.blocked).toBe(true);
    expect(sim.salvage.salvage('pk-s1')).toBe(3);
    expect(sim.salvage.left('pk-s1')).toBe(0);
    expect(sim.inventory.count('scrap')).toBe(6);
    const t = sim.grid.get(GROUND, 8, 9)!;
    expect(t.blocked).toBe(false);
    expect(sim.salvage.pileAt(8, 9)).toBeUndefined();
    expect(sim.restoration.checkPulse(t).ok).toBe(true);
    expect(sim.restoration.pulse(t.id)).toBe(true);
    // a large one takes eight
    let n = 0;
    while (sim.salvage.left('pk-s5') > 0 && n < 20) sim.salvage.salvage('pk-s5'), n++;
    expect(n).toBe(8);
  });

  it('a full stack leaves the pile untouched', () => {
    const sim = oldSim();
    sim.inventory.add('scrap', 40);
    const fails: string[] = [];
    sim.bus.on('action.failed', (e) => fails.push(e.reason));
    expect(sim.salvage.salvage('pk-s3')).toBe(0);
    expect(sim.salvage.left('pk-s3')).toBe(12);
    expect(fails[0]).toMatch(/full/);
    // one unit of room takes one unit
    sim.inventory.take('scrap', 1);
    expect(sim.salvage.salvage('pk-s3')).toBe(1);
    expect(sim.salvage.left('pk-s3')).toBe(11);
  });

  it('piles never reappear after save and load', () => {
    const sim = oldSim(21);
    sim.salvage.salvage('pk-s1');
    sim.salvage.salvage('pk-s1');
    sim.salvage.salvage('pk-e1');
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(back.salvage.left('pk-s1')).toBe(0);
    expect(back.grid.get(GROUND, 8, 9)!.blocked).toBe(false);
    expect(back.salvage.left('pk-e1')).toBe(3);
    expect(back.grid.get(GROUND, pile('pk-e1').x, pile('pk-e1').z)!.blocked).toBe(true);
    expect(saver.serialize(back.state)).toBe(json);
  });
});

describe('E21.2: Reclaimers', () => {
  const reclaimer = (sim: Sim): MachineData => {
    const m: MachineData = { id: sim.newId('m'), type: 'reclaimer', roofId: GROUND, x: 23, z: -8, size: 2, boostUntil: 0, timer: 0, charge: 0 };
    sim.state.machines.push(m);
    sim.grid.indexMachine(m);
    return m;
  };

  it('a Reclaimer on Mast Row\'s seam sends 6 Copper a minute to the store', () => {
    const sim = oldSim();
    reclaimer(sim);
    sim.advance(60);
    expect(sim.inventory.stored('copper')).toBe(6);
    sim.advance(30);
    expect(sim.inventory.stored('copper')).toBe(9);
  });

  it('while away it earns half that, for up to 4 hours', () => {
    const sim = oldSim();
    reclaimer(sim);
    expect(sim.salvage.offline(600).copper).toBe(30);
    expect(sim.salvage.offline(10 * 3600).copper).toBe(720);
  });

  it('its part-filled minute survives a save byte for byte', () => {
    const sim = oldSim();
    reclaimer(sim);
    sim.advance(25);
    const json = saver.serialize(sim.state);
    const back = new Sim(saver.deserialize(json)!);
    expect(saver.serialize(back.state)).toBe(json);
    back.advance(35);
    expect(back.inventory.stored('copper')).toBe(6);
  });
});
