import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState } from '../src/core/GameState';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';

const fresh = (seed = 7) => new Sim(createInitialState(seed));

describe('Phase 4 E01: economy rescue', () => {
  it('the same tile pulsed many times in one tick is paid once (E01 acceptance)', () => {
    const sim = fresh();
    const t = sim.areas.tiles(PARK).find((x) => sim.restoration.checkPulse(x).ok)!;
    const before = sim.charge.value();
    for (let i = 0; i < 20; i++) sim.restoration.pulse(t.id);
    expect(before - sim.charge.value()).toBeLessThanOrEqual(sim.charge.cost('pulse') + 1e-9);
  });

  it('from an empty charge the player can always act again (E01.6; E23.1.4: eat from the backpack)', () => {
    const sim = fresh();
    sim.charge.drainForTest();
    sim.state.salvage.pack.biomass = 1;
    const t = sim.areas.tiles(PARK).find((x) => x.ground !== 'restored' && sim.restoration.isEligible(x))!;
    expect(sim.restoration.checkPulse(t).ok).toBe(false);
    sim.charge.eat();
    sim.advance(10);
    expect(sim.restoration.checkPulse(t).ok).toBe(true);
  });
});

describe('Phase 4 E01: the old drone', () => {
  it('lives by the old solar lamp from the start, works for free and only nearby', () => {
    const sim = fresh();
    sim.advance(0.2);
    const old = sim.state.drones.filter((d) => d.old);
    expect(old).toHaveLength(1);
    const lamp = sim.machine(old[0].hubId)!;
    expect(lamp.starter && lamp.type === 'solar').toBe(true);
    const restored: { x: number; z: number }[] = [];
    sim.bus.on('tile.restored', ({ tile, source }) => source === 'drone' && restored.push(tile));
    const charge = sim.charge.value();
    const pack = JSON.stringify(sim.state.salvage.pack);
    sim.advance(120);
    expect(restored.length).toBeGreaterThan(3);
    for (const t of restored) expect(Math.max(Math.abs(t.x - lamp.x), Math.abs(t.z - lamp.z))).toBeLessThanOrEqual(TUNING.drone.old.radius);
    // the old drone is free: no charge and nothing from the backpack
    expect(sim.charge.value()).toBe(charge);
    expect(JSON.stringify(sim.state.salvage.pack)).toBe(pack);
  });

  it('is not a Drone Hub: hub upgrades and unlocks stay locked', () => {
    const sim = fresh();
    sim.advance(1);
    expect(sim.machinesOfType('droneHub')).toEqual([]);
    expect(sim.build.isUnlocked('motherTree')).toBe(false);
    expect(sim.upgrades.grant('droneSpeed')).toBe(0); // no hub to give it to
  });

  it('comes back in games saved before it existed', () => {
    const sim = fresh();
    sim.state.drones = [];
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    copy.advance(0.2);
    expect(copy.state.drones.filter((d) => d.old)).toHaveLength(1);
  });
});

