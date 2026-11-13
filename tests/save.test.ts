import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { Sim } from '../src/gameplay/Sim';
import { fill, makeSim, rich } from './helpers';

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

  it('core activates once, needs all machines, tiles and full blooms, and unlocks roof 2', () => {
    const sim = makeSim();
    rich(sim);
    fill(sim, 0, 0, 7, 7, 'restored');
    expect(sim.progression.activateCore()).toBe(false);
    for (const t of sim.grid.roof('r1')!.tiles.slice(10, 40)) t.bloom = 3;
    sim.build.place('solar', 'r1', 5, 5);
    sim.build.place('condenser', 'r1', 6, 5);
    sim.build.place('pollinator', 'r1', 5, 6);
    sim.build.place('droneHub', 'r1', 2, 2);
    expect(sim.progression.coreReady()).toBe(true);
    let events = 0;
    sim.bus.on('rooftop.coreRestored', () => events++);
    expect(sim.progression.activateCore()).toBe(true);
    expect(sim.progression.activateCore()).toBe(false);
    expect(events).toBe(1);
    expect(sim.grid.roof('r2')!.unlocked).toBe(true);
    const copy = new Sim(new SaveService(undefined).deserialize(JSON.stringify(sim.state))!);
    expect(copy.progression.activateCore()).toBe(false);
  });

  it('a scripted first session reaches the core without deadlock', () => {
    // A simple greedy "player bot": pulses the cheapest tile, builds and upgrades as soon as possible.
    const sim = makeSim(7);
    const order = ['solar', 'condenser', 'pollinator', 'droneHub'] as const;
    let t = 0;
    for (; t < 20 * 60 * 10 && !sim.state.progression.coreActivated; t++) {
      if (t % 5 === 0) {
        const tiles = sim.grid.roof('r1')!.tiles.filter((x) => sim.restoration.checkPulse(x).ok);
        const rank = (x: { ground: string }) => (x.ground === 'prepared' ? 0 : x.ground === 'polluted' ? 1 : 2);
        tiles.sort((a, b) => rank(a) - rank(b) || a.pollution - b.pollution);
        if (tiles[0]) sim.restoration.pulse(tiles[0].id);
        for (const type of order) {
          if (sim.progression.built(type)) continue;
          const spot = sim.grid.roof('r1')!.tiles.find((x) => sim.build.check(type, 'r1', x.x, x.z).ok);
          if (spot) sim.build.place(type, 'r1', spot.x, spot.z);
          break;
        }
        if (sim.progression.coreReady()) sim.progression.activateCore();
        if (sim.state.resources.energy < 2) sim.harvestSun();
      }
      sim.tick();
    }
    expect(sim.state.progression.coreActivated).toBe(true);
    expect(t / 10).toBeLessThan(15 * 60);
  });
});

describe('save migration', () => {
  it('upgrades a Round 1 (v1) save and keeps its progress', async () => {
    const { SaveService } = await import('../src/app/SaveService');
    const sim = makeSim(3);
    rich(sim);
    fill(sim, 2, 2, 5, 5, 'restored');
    sim.build.place('condenser', 'r1', 3, 3);
    const old = JSON.parse(JSON.stringify(sim.state));
    old.version = 1;
    for (const m of old.machines) delete m.charge;
    delete old.cat.stash;
    delete old.cat.log;
    const s = new SaveService(undefined).deserialize(JSON.stringify(old))!;
    expect(s.version).toBe(2);
    expect(s.machines.every((m) => m.charge === 0)).toBe(true);
    expect(s.cat.stash).toBe(0);
    expect(new Sim(s).progression.restoredCount('r1')).toBe(sim.progression.restoredCount('r1'));
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
