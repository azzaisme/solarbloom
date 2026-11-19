import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { big } from '../src/core/Big';
import type { MachineData } from '../src/core/types';
import { isMergeable } from '../src/data/machines';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { fill, makeSim, PAD, rich } from './helpers';

SaveService.clock = () => 0;
const saver = new SaveService(undefined);

/** A test pad: dead concrete everywhere, a restored strip along z = 6..7 with a Drone Hub and a Cultivator. */
function setup(seed = 1, upg: Record<string, number> = {}) {
  const sim = makeSim(seed);
  rich(sim);
  fill(sim, 0, 0, 7, 5, 'polluted');
  fill(sim, 0, 6, 7, 7, 'restored');
  sim.build.place('droneHub', PAD, 4, 6);
  const m = sim.build.place('cultivator', PAD, 1, 6)!;
  expect(m).toBeDefined();
  m.upg = { ...upg };
  // keep drones out of it (so only the tiller restores here)
  sim.state.drones.length = 0;
  sim.state.machines.find((x) => x.type === 'droneHub')!.upg = {};
  return { sim, m };
}
const doneOf = (m: MachineData) => m.cult?.done ?? 0;
const restored = (sim: Sim) => sim.grid.tilesOf(PAD).filter((t) => t.z < 6 && t.ground === 'restored').length;

describe('Look 6.8: the Cultivator (#177)', () => {
  it('unlocks with a Drone Hub, is priced in biomass with an energy part, and does not merge', () => {
    const sim = makeSim(9);
    expect(sim.build.isUnlocked('cultivator')).toBe(false);
    rich(sim);
    fill(sim, 0, 6, 7, 7, 'restored');
    sim.build.place('droneHub', PAD, 4, 6);
    expect(sim.build.isUnlocked('cultivator')).toBe(true);
    const c = sim.build.cost('cultivator');
    expect(big(c.biomass!).gt(0) && big(c.energy!).gt(0)).toBe(true);
    expect(isMergeable('cultivator')).toBe(false);
  });

  it('works dead ground near its dock with no player input, drawing energy instead of pulse costs', () => {
    const { sim, m } = setup();
    let spentWater = 0;
    let drawn = 0;
    const spend = sim.econ.spend.bind(sim.econ);
    sim.econ.spend = (c) => {
      const ok = spend(c);
      if (ok && c.energy && !c.water) drawn += big(c.energy).toNumber();
      return ok;
    };
    const mine: string[] = [];
    sim.bus.on('tile.restored', ({ tile, source }) => source === 'cultivator' && mine.push(tile.id));
    sim.bus.on('drone.jobStarted', () => (spentWater = 1));
    sim.advance(60);
    expect(doneOf(m)).toBeGreaterThanOrEqual(4);
    expect(mine.length).toBe(doneOf(m));
    expect(restored(sim)).toBeGreaterThanOrEqual(doneOf(m));
    expect(drawn).toBeGreaterThan(doneOf(m) * 1.5); // energy drawn while working (about 2.5 ⚡ a tile)
    void spentWater;
  });

  it('its tiles take gameplay time: softening, then growth, with gameplay-flagged transitions', () => {
    const { sim, m } = setup(2);
    sim.advance(3);
    const u = m.cult!.units[0];
    expect(u.work.length).toBe(1);
    const t = sim.grid.byTileId(u.work[0])!;
    sim.advance(1);
    expect(t.ground).toBe('polluted');
    expect(t.tr).toMatchObject({ k: 'soften', g: 1 });
    expect(t.pollution).toBeLessThan(100);
    expect(sim.restoration.checkPulse(t).reason).toMatch(/Cultivator is breaking up this slab — \d+s/);
  });

  it('shares the drones’ reservations: a drone never takes a tiller’s tile', () => {
    const { sim, m } = setup(3);
    sim.advance(3);
    const id = m.cult!.units[0].work[0];
    expect(sim.drones.isReserved(id)).toBe(true);
    expect(sim.restoration.isEligible(sim.grid.byTileId(id)!)).toBe(false);
  });

  it('upgrades change its rate: speed, width, a second tiller; Seed Mix starts tiles at bloom 2', () => {
    const run = (upg: Record<string, number>) => {
      const { sim, m } = setup(4, upg);
      const mine: string[] = [];
      sim.bus.on('tile.restored', ({ tile, source }) => source === 'cultivator' && mine.push(tile.id));
      sim.advance(90);
      return { done: doneOf(m), sim, m, mine };
    };
    const base = run({}).done;
    expect(run({ cultSpeed: 3 }).done).toBeGreaterThan(base);
    expect(run({ cultWidth: 2 }).done).toBeGreaterThan(base);
    const two = run({ cultSecond: 1 });
    expect(two.m.cult!.units.length).toBe(2);
    expect(two.done).toBeGreaterThan(base);
    const seeded = run({ cultSeed: 1 });
    const mine = seeded.mine.map((id) => seeded.sim.grid.byTileId(id)!);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((t) => t.bloom >= TUNING.cultivator.seedBloom)).toBe(true);
  });

  it('parks when the energy store is below the drones’ reserve', () => {
    const { sim, m } = setup(6);
    sim.state.resources.energy = big(sim.state.caps.energy.toNumber() * TUNING.drone.reserve * 0.5);
    sim.production.markDirty();
    for (const x of sim.state.machines) if (x.type === 'solar') x.starter = true;
    sim.advance(10);
    expect(m.cult!.units[0].parked).toBe(true);
    expect(doneOf(m)).toBe(0);
  });

  it('a tap knocks its tile along, within limits', () => {
    const { sim, m } = setup(7);
    sim.advance(3);
    const t = sim.grid.byTileId(m.cult!.units[0].work[0])!;
    sim.advance(0.5);
    const p0 = t.pollution;
    expect(sim.restoration.pulse(t.id)).toBe(false); // no pulse…
    expect(t.pollution).toBeLessThan(p0 - 10); // …a knock instead
    expect(sim.cultivators.knock(t)).toBe(false); // too soon after the last
    sim.advance(TUNING.cultivator.knock.gap + 0.1);
    let n = 1;
    while (sim.cultivators.knock(t)) {
      n++;
      sim.advance(TUNING.cultivator.knock.gap + 0.1);
    }
    expect(n).toBeLessThanOrEqual(TUNING.cultivator.knock.max * 2); // per phase: softening, then growing
  });

  it('saves mid-work and keeps going after a reload', () => {
    const { sim, m } = setup(8);
    sim.advance(4);
    const json = saver.serialize(sim.state);
    const copy = new Sim(saver.deserialize(json)!);
    expect(saver.serialize(copy.state)).toBe(json);
    const cm = copy.state.machines.find((x) => x.id === m.id)!;
    copy.advance(40);
    expect(doneOf(cm)).toBeGreaterThan(doneOf(m));
  });
});
