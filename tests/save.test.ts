import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { Sim } from '../src/gameplay/Sim';
import { PARK } from '../src/core/Areas';
import { HOME } from '../src/gameplay/ProgressionSystem';
import { fill, GROUND, makeSim, rich } from './helpers';

describe('save & progression', () => {
  it('round-trips tile state, machines and upgrades; rejects bad saves', () => {
    const saver = new SaveService(undefined);
    const sim = makeSim();
    rich(sim);
    fill(sim, 2, 2, 5, 5, 'restored');
    sim.build.place('condenser', 'r1', 3, 3);
    sim.upgrades.purchase('solarArray');
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.progression.restoredCount('r1')).toBe(sim.progression.restoredCount('r1'));
    expect(copy.state.machines.length).toBe(sim.state.machines.length);
    expect(copy.upgrades.level('solarArray')).toBe(1);
    expect(saver.deserialize(JSON.stringify({ version: 999, rooftops: [] }))).toBeUndefined();
    expect(saver.deserialize('nope')).toBeUndefined();
  });

  it('the fountain wakes once, needs all machines, tiles and full blooms, and clears the park', () => {
    const sim = makeSim();
    rich(sim);
    const park = sim.areas.tiles(PARK).filter((t) => !t.blocked && !t.occupantId);
    expect(sim.progression.activateCore()).toBe(false);
    for (const t of park) {
      t.ground = 'restored';
      t.bloom = 3;
      t.pollution = 0;
      sim.grid.touch(t);
    }
    for (const type of ['solar', 'condenser', 'pollinator', 'droneHub', 'motherTree'] as const) {
      const spot = park.find((t) => sim.build.check(type, GROUND, t.x, t.z).ok)!;
      expect(sim.build.place(type, GROUND, spot.x, spot.z), type).toBeTruthy();
    }
    expect(sim.progression.coreReady()).toBe(true);
    let events = 0;
    sim.bus.on('rooftop.coreRestored', () => events++);
    expect(sim.progression.activateCore()).toBe(true);
    expect(sim.progression.activateCore()).toBe(false);
    expect(events).toBe(1);
    expect(sim.areas.fog(PARK)).toBe('cleared');
    const copy = new Sim(new SaveService(undefined).deserialize(JSON.stringify(sim.state))!);
    expect(copy.progression.activateCore()).toBe(false);
  });

  it('a scripted first session reaches the core without deadlock', { timeout: 30_000 }, () => {
    // A simple greedy "player bot": pulses the cheapest tile, builds and upgrades as soon as possible.
    const sim = makeSim(7);
    const order = ['solar', 'condenser', 'pollinator', 'droneHub', 'motherTree'] as const;
    let t = 0;
    for (; t < 30 * 60 * 10 && !sim.state.progression.coreActivated; t++) {
      if (t % 5 === 0) {
        const tiles = sim.progression.tilesFor(HOME).filter((x) => sim.restoration.checkPulse(x).ok);
        const rank = (x: { ground: string }) => (x.ground === 'prepared' ? 0 : x.ground === 'polluted' ? 1 : 2);
        tiles.sort((a, b) => rank(a) - rank(b) || a.pollution - b.pollution);
        if (tiles[0]) sim.restoration.pulse(tiles[0].id);
        for (const type of order) {
          if (sim.progression.built(type)) continue;
          const spot = sim.progression.tilesFor(HOME).find((x) => sim.build.check(type, GROUND, x.x, x.z).ok);
          if (spot) sim.build.place(type, GROUND, spot.x, spot.z);
          break;
        }
        if (sim.upgrades.status(sim.upgrades.all().find((u) => u.id === 'seedVault')!).ok) sim.upgrades.purchase('seedVault');
        if (sim.progression.coreReady()) sim.progression.activateCore();
        if (sim.state.resources.energy < 2) sim.harvestSun();
      }
      sim.tick();
    }
    expect(sim.state.progression.coreActivated).toBe(true);
    expect(t / 10).toBeLessThan(30 * 60);
  });
});

describe('save format v4', () => {
  it('discards a pre-city (v1–v3) save: the game starts fresh and says so', async () => {
    const { SaveService, SAVE_KEY } = await import('../src/app/SaveService');
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    for (const version of [1, 2, 3]) {
      store.set(SAVE_KEY, JSON.stringify({ version, seed: 5, rooftops: [], machines: [] }));
      const r = new SaveService(storage).loadResult();
      expect(r.scrapped).toBe(true);
      expect(r.state).toBeUndefined();
      expect(store.has(SAVE_KEY)).toBe(false);
    }
  });

  it('backs up a save from a newer version instead of overwriting it', async () => {
    const { SaveService, SAVE_KEY } = await import('../src/app/SaveService');
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const future = JSON.stringify({ ...makeSim().state, version: 99 });
    store.set(SAVE_KEY, future);
    const r = new SaveService(storage).loadResult();
    expect(r.state).toBeUndefined();
    expect(r.backedUpAs).toBeDefined();
    expect(store.get(r.backedUpAs!)).toBe(future);
  });
});
