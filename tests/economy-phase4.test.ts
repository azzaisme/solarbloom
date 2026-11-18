import { big, toNum } from '../src/core/Big';
import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { CAPPED, KINDS } from '../src/core/Economy';
import { createInitialState } from '../src/core/GameState';
import { MACHINES } from '../src/data/machines';
import { TUNING } from '../src/data/tuning';
import { UPGRADES } from '../src/data/upgrades';
import { SEED_CORE_MACHINES } from '../src/gameplay/ProgressionSystem';
import { Sim } from '../src/gameplay/Sim';
import { presetSim } from '../src/app/DevTools';
import { runBot } from './bots';

const fresh = (seed = 7) => new Sim(createInitialState(seed));

describe('Phase 4 E01: economy rescue', () => {
  it('config: costs are finite and non-negative, storage tiers grow, every Seed Vault level fits the storage before it', () => {
    for (const def of Object.values(MACHINES)) for (const k of KINDS) expect(Number.isFinite(toNum(def.cost[k] ?? 0)) && toNum(def.cost[k] ?? 0) >= 0).toBe(true);
    for (const k of KINDS) {
      const t = TUNING.storageTiers[k];
      expect(t[0]).toBe(TUNING.start.caps[k]);
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    }
    const vault = UPGRADES.find((u) => u.id === 'seedVault')!;
    expect(vault.maxLevel).toBe(TUNING.storageTiers.energy.length - 1);
  });

  it('every purchase the fountain requires fits in the starting store (E01.1)', () => {
    const caps = TUNING.start.caps;
    for (const type of SEED_CORE_MACHINES) for (const k of KINDS) expect(MACHINES[type].cost[k] ?? 0, `${type} ${k}`).toBeLessThanOrEqual(caps[k]);
    for (const k of KINDS) expect(TUNING.core.cost[k as 'energy' | 'biomass'] ?? 0).toBeLessThanOrEqual(caps[k]);
    // Drones keep spending energy and water, so a store never sits full of them: leave a quarter free.
    for (const k of ['energy', 'water'] as const) {
      for (const type of SEED_CORE_MACHINES) expect(MACHINES[type].cost[k] ?? 0, `${type} ${k}`).toBeLessThanOrEqual(caps[k] * 0.75);
      expect((TUNING.core.cost as Partial<Record<string, number>>)[k] ?? 0).toBeLessThanOrEqual(caps[k] * 0.75);
    }
    // The Phase 4 screenshot's economy: the Drone Hub is now buyable once enough biomass grows (Phase 5: no cap).
    const sim = presetSim('screenshot', 7);
    expect(sim.econ.exceedsStorage(sim.build.cost('droneHub'))).toBeUndefined();
  });

  it('the fountain wakes from a fresh save without Lucky Cats', { timeout: 60_000 }, () => {
    for (const seed of [7, 21]) {
      const r = runBot({ seed, minutes: 20, noCats: true });
      expect(r.fountain, `seed ${seed}`).toBeGreaterThan(0);
      expect(r.firsts.droneHub).toBeLessThan(4 * 60);
    }
  });

  it('the Drone Hub comes at about minute 2–3 for an active player', { timeout: 60_000 }, () => {
    for (const seed of [7, 99]) {
      const a = runBot({ seed, minutes: 15 });
      expect(a.firsts.droneHub).toBeLessThan(3.5 * 60);
    }
  });

  it('Seed Vault steps through the storage tiers, and cleared areas still multiply them', () => {
    const sim = fresh();
    const s = sim.state;
    s.resources.biomass = big(100);
    expect(sim.upgrades.grant('seedVault')).toBeGreaterThan(0);
    for (const k of CAPPED) expect(toNum(s.caps[k])).toBe(TUNING.storageTiers[k][1]);
    // (biomass has no cap since Phase 5)
    s.resources.biomass = big(1e5);
    for (let i = 0; i < 10; i++) sim.upgrades.grant('seedVault');
    expect(sim.upgrades.level('seedVault')).toBe(4);
    for (const k of CAPPED) expect(toNum(s.caps[k])).toBeGreaterThanOrEqual(TUNING.storageTiers[k][4]);
  });

  it('the same tile pulsed many times in one tick is paid once (E01 acceptance)', () => {
    const sim = fresh();
    const s = sim.state;
    s.resources.energy = big(60);
    s.resources.water = big(40);
    const t = sim.areas.tiles(PARK).find((x) => sim.restoration.checkPulse(x).ok)!;
    const before = toNum(s.resources.energy);
    for (let i = 0; i < 20; i++) sim.restoration.pulse(t.id);
    expect(before - toNum(s.resources.energy)).toBeLessThanOrEqual(TUNING.pulse.polluted.energy + 1e-9);
  });

  it('from empty stores the player can always act again (E01.6)', () => {
    const sim = fresh();
    const s = sim.state;
    s.resources.energy = big(0); s.resources.water = big(0); s.resources.biomass = big(0);
    expect(sim.harvestSun()).toBe(true);
    sim.advance(10);
    const t = sim.areas.tiles(PARK).find((x) => x.ground !== 'restored' && sim.restoration.isEligible(x))!;
    expect(sim.restoration.checkPulse(t).ok).toBe(true);
  });

  it('income lost to full stores is tracked, never banked beyond the cap', () => {
    const sim = fresh();
    const s = sim.state;
    s.resources.energy = big(s.caps.energy);
    sim.advance(10);
    expect(toNum(s.resources.energy)).toBeLessThanOrEqual(toNum(s.caps.energy));
    expect(sim.log.overflow.energy).toBeGreaterThan(5);
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
    const s = sim.state;
    s.caps.energy = big(1000); s.caps.water = big(1000);
    s.resources.energy = big(1000); s.resources.water = big(1000);
    const restored: { x: number; z: number }[] = [];
    sim.bus.on('tile.restored', ({ tile, source }) => source === 'drone' && restored.push(tile));
    const spent = { ...sim.econ.spent };
    sim.advance(120);
    expect(restored.length).toBeGreaterThan(3);
    for (const t of restored) expect(Math.max(Math.abs(t.x - lamp.x), Math.abs(t.z - lamp.z))).toBeLessThanOrEqual(TUNING.drone.old.radius);
    expect(sim.econ.spent.energy).toBe(spent.energy); // nobody else spent; the old drone is free
  });

  it('is not a Drone Hub: the fountain still needs one, and hub upgrades and unlocks stay locked', () => {
    const sim = fresh();
    sim.advance(1);
    expect(sim.progression.requirements().find((r) => r.label.includes('Drone Hub'))!.done).toBe(false);
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

