import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { MachineData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

function city(seed = 6) {
  const sim = new Sim(createInitialState(seed));
  const st = sim.state;
  st.caps.energy = st.caps.water = st.caps.biomass = 1e7;
  st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
  st.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  return sim;
}

const deadTiles = (sim: Sim) => sim.areas.tiles(PARK).filter((t) => sim.restoration.isEligible(t));

describe('Mega Pulse and scaled Overcharge (City 11.5)', () => {
  it('manual taps charge the meter; the next tap releases a city-scale chain, once', () => {
    const sim = city();
    let ready = 0;
    let released = 0;
    sim.bus.on('mega.ready', () => ready++);
    sim.bus.on('mega.released', () => released++);
    for (let i = 0; i < TUNING.mega.charge; i++) {
      expect(sim.restoration.megaReady()).toBe(false);
      expect(sim.restoration.pulse(deadTiles(sim)[0].id)).toBe(true);
    }
    expect(sim.restoration.megaReady()).toBe(true);
    expect(ready).toBe(1);
    sim.advance(3);
    const combos: { combo: number; starter: string }[] = [];
    sim.bus.on('chain.ended', (e) => combos.push(e));
    const origin = deadTiles(sim)[5];
    expect(sim.restoration.pulse(origin.id)).toBe(true);
    expect(released).toBe(1);
    expect(sim.state.progression.megaCharge).toBe(0);
    sim.advance(30);
    const big = combos.reduce((a, e) => (e.combo > a.combo ? e : a), { combo: 0, starter: '' });
    expect(big.combo).toBeGreaterThanOrEqual(20);
    expect(big.combo).toBeLessThanOrEqual(sim.restoration.megaBudget() + 40); // budget plus what it sets off
    expect(big.starter).toBe('player');
    expect(origin.ground).toBe('restored');
  });

  it('the Mega Pulse grows with the city, capped', () => {
    const sim = city();
    const first = sim.restoration.megaBudget();
    expect(first).toBe(TUNING.mega.baseTiles);
    for (let i = 0; i < 10; i++) sim.areas.clear(sim.areas.nextGoal()!, true);
    expect(sim.restoration.megaBudget()).toBe(TUNING.mega.baseTiles + 10 * TUNING.mega.tilesPerArea);
    for (let i = 0; i < 200; i++) sim.areas.clear(sim.areas.nextGoal()!, true);
    expect(sim.restoration.megaBudget()).toBe(TUNING.mega.maxTiles);
  });

  it('the meter is saved', async () => {
    const { SaveService } = await import('../src/app/SaveService');
    const sim = city();
    for (let i = 0; i < 7; i++) sim.restoration.pulse(deadTiles(sim)[0].id);
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.state.progression.megaCharge).toBe(7);
  });

  it('chains remember who started them: taps are the player, drones and condensers are automation', () => {
    const sim = city();
    // The park's old drone would start chains of its own: switch it off for this test.
    const old = TUNING.drone.old as { enabled: boolean };
    old.enabled = false;
    sim.state.drones = [];
    try {
    const ended: string[] = [];
    sim.bus.on('chain.ended', (e) => ended.push(e.starter));
    // Gardens in two places, so restoring next to each makes a real chain.
    const spots = deadTiles(sim);
    const garden = (g: (typeof spots)[number]) => {
      const m: MachineData = { id: sim.newId('m'), type: 'pollinator', roofId: GROUND, x: g.x, z: g.z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
      sim.state.machines.push(m);
      sim.grid.indexMachine(m);
      g.occupantId = m.id;
      return sim.grid.neighbors(g).filter((n) => sim.restoration.isEligible(n));
    };
    const a = garden(spots[0]);
    const b = garden(spots.find((t) => Math.abs(t.x - spots[0].x) + Math.abs(t.z - spots[0].z) > 8 && !t.occupantId)!);
    sim.restoration.pulse(a[0].id);
    sim.advance(6);
    sim.restoration.complete(b[0], 'drone');
    sim.advance(6);
    expect(ended).toEqual(['player', 'auto']);
    } finally {
      old.enabled = true;
    }
  });

  it('Overcharge boosts scale with the Overcharge upgrade', () => {
    const sim = city();
    const m: MachineData = { id: sim.newId('m'), type: 'pollinator', roofId: GROUND, x: 3, z: 3, size: 1, boostUntil: 0, timer: 0, charge: 0 };
    m.overchargeUntil = sim.time + 10;
    expect(sim.chains.consumeOvercharge(m)).toBe(1);
    expect(sim.chains.consumeOvercharge(m)).toBe(0); // used up
    sim.state.upgrades.overcharge = 2;
    m.overchargeUntil = sim.time + 10;
    expect(sim.chains.consumeOvercharge(m)).toBe(3);
  });
});
