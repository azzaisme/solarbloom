import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { SAVE_VERSION } from '../src/core/GameState';
import type { GameState } from '../src/core/types';
import { ROOFTOPS } from '../src/data/rooftops';
import { Sim } from '../src/gameplay/Sim';
import { makeSim } from './helpers';
import round2Core from './fixtures/round2-core.json';
import round2Mid from './fixtures/round2-mid.json';

// Real saves written by the Round 2 build (commit 745db8b) with its own scripted player.
const FIXTURES: Record<string, unknown> = { 'round2-mid': round2Mid, 'round2-core': round2Core };
const fixture = (name: string) => JSON.stringify(FIXTURES[name]);
const saver = new SaveService(undefined);

describe('Phase 3 save migration', () => {
  for (const name of ['round2-mid', 'round2-core']) {
    it(`migrates a real Round 2 save (${name}) without touching the Seed`, () => {
      const raw = JSON.parse(fixture(name)) as GameState;
      const s = saver.deserialize(fixture(name))!;
      expect(s).toBeDefined();
      expect(s.version).toBe(SAVE_VERSION);
      // The Seed keeps every tile exactly, by stable roof-scoped id.
      const oldSeed = raw.rooftops.find((r) => r.id === 'r1')!;
      const seed = s.rooftops.find((r) => r.id === 'r1')!;
      expect(seed.tiles.map((t) => [t.id, t.ground, t.bloom, t.occupantId ?? ''])).toEqual(oldSeed.tiles.map((t) => [t.id, t.ground, t.bloom, t.occupantId ?? '']));
      for (const t of seed.tiles) expect(t.id).toBe(`r1:${t.x}:${t.z}`);
      // Machines, drones, upgrades, resources, cat: all kept.
      for (const m of raw.machines) expect(s.machines.find((x) => x.id === m.id)).toMatchObject({ type: m.type, roofId: 'r1', x: m.x, z: m.z });
      expect(s.drones.map((d) => d.id)).toEqual(raw.drones.map((d) => d.id));
      expect(s.upgrades).toEqual(raw.upgrades);
      expect(s.resources).toEqual(raw.resources);
      expect(s.cat.active).toEqual(raw.cat.active);
      // New rooftops come from the authored layouts, locked.
      for (const def of ROOFTOPS.filter((d) => d.id !== 'r1')) {
        const r = s.rooftops.find((x) => x.id === def.id)!;
        expect([r.width, r.depth, r.preview]).toEqual([def.width, def.depth, true]);
        expect(r.tiles.every((t) => t.id === `${def.id}:${t.x}:${t.z}`)).toBe(true);
        expect(s.machines.filter((m) => m.roofId === def.id && m.type === 'core')).toHaveLength(1);
      }
      expect(new Set(s.machines.map((m) => m.id)).size).toBe(s.machines.length);
      expect(s.rooftops.find((r) => r.id === 'r2')!.unlocked).toBe(raw.progression.coreActivated);
      expect(s.progression.cores.r1 ?? false).toBe(raw.progression.coreActivated);
      expect(s.links).toEqual({});
    });
  }

  it('a migrated save plays on, and saving/reloading changes nothing', () => {
    const s = saver.deserialize(fixture('round2-core'))!;
    const sim = new Sim(s);
    sim.advance(60);
    const once = saver.serialize(sim.state);
    const twice = saver.serialize(saver.deserialize(once)!);
    expect(twice).toBe(once);
    // the core can't be re-awakened for a second reward
    expect(sim.progression.activateCore()).toBe(false);
  });

  it('a fresh game starts with three rooftops: the Seed playable, the others locked', () => {
    const sim = makeSim();
    expect(sim.state.rooftops.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(sim.grid.isPlayable('r1')).toBe(true);
    expect(sim.grid.isPlayable('r2')).toBe(false);
    expect(sim.grid.isPlayable('r3')).toBe(false);
    const t = sim.grid.get('r2', 2, 2)!;
    expect(sim.restoration.checkPulse(t).ok).toBe(false);
    expect(sim.build.check('solar', 'r3', 2, 2).ok).toBe(false);
    const copy = saver.deserialize(saver.serialize(sim.state))!;
    expect(saver.serialize(copy)).toBe(saver.serialize(sim.state));
  });
});
