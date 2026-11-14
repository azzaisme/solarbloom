import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { createInitialState } from '../src/core/GameState';
import type { CatRewardType } from '../src/core/types';
import { CAT_ANCHORS } from '../src/data/rooftops';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { awakenSeed, ground, makeSim, rich } from './helpers';

const saver = new SaveService(undefined);
type Applier = { apply(t: CatRewardType, mult: number, hidden: number): string };

function neighbourhood(seed: number) {
  const sim = new Sim(createInitialState(seed));
  rich(sim);
  awakenSeed(sim);
  sim.hood.buildLink('seed-reservoir');
  sim.state.progression.cores.r2 = true;
  sim.hood.buildLink('seed-canopy');
  return sim;
}

describe('Lucky Cat across the neighbourhood', () => {
  it('only hides on playable rooftops, and the new rewards stay out of the pool until they are useful', () => {
    const sim = makeSim(4);
    expect(sim.cat.candidates().every((a) => a.roofId === 'r1')).toBe(true);
    const seen = new Set<CatRewardType>();
    for (let i = 0; i < 400; i++) seen.add(sim.cat.rollReward());
    expect(seen.has('goldenRelay')).toBe(false);
    expect(seen.has('catsGarden')).toBe(false);
    const hood = neighbourhood(4);
    const seen2 = new Set<CatRewardType>();
    for (let i = 0; i < 400; i++) seen2.add(hood.cat.rollReward());
    expect(seen2.has('goldenRelay')).toBe(true);
    expect(seen2.has('catsGarden')).toBe(true);
  });

  it('spawns one cat at a time, on all three rooftops over 200 games, never under the HUD', () => {
    const roofs = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const sim = neighbourhood(seed);
      sim.cat.anchorView = (a) => (a.id === 'res-corner' ? 'covered' : a.roofId === 'r1' ? 'visible' : 'offscreen');
      expect(sim.cat.spawn()).toBe(true);
      expect(sim.cat.spawn()).toBe(false); // at most one
      const a = sim.cat.anchor(sim.state.cat.active!.anchorId)!;
      expect(a.id).not.toBe('res-corner');
      expect(sim.grid.isPlayable(a.roofId)).toBe(true);
      roofs.add(a.roofId);
    }
    expect([...roofs].sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('Golden Relay pays once, survives a reload, and is spent by the next crossing', () => {
    const sim = neighbourhood(8);
    sim.cat.spawn('cistern-rim');
    sim.state.cat.found = 1; // not the first cat (that one is always a Lucky Harvest)
    (sim.cat as unknown as Applier).apply('goldenRelay', 1, 0);
    expect(sim.state.relayBonus).toBe(TUNING.cat.goldenRelayExtra);
    (sim.cat as unknown as Applier).apply('goldenRelay', 1, 0); // can't stack: degrades to a harvest
    expect(sim.state.relayBonus).toBe(TUNING.cat.goldenRelayExtra);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.state.relayBonus).toBe(TUNING.cat.goldenRelayExtra);
    for (const t of copy.grid.tilesOf('r1')) if (!t.blocked && !t.occupantId) ground(copy, 'r1', t.x, t.z, 'prepared');
    for (const t of copy.grid.tilesOf('r2')) if (!t.blocked && !t.occupantId) ground(copy, 'r2', t.x, t.z, 'prepared');
    copy.restoration.complete(copy.grid.get('r1', 6, 2)!, 'pulse');
    copy.advance(4);
    expect(copy.state.relayBonus).toBe(0);
  });

  it("Cat's Garden restores a small cluster of eligible tiles on one playable rooftop", () => {
    const sim = neighbourhood(12);
    const before = new Map(sim.grid.rooftops.flatMap((r) => sim.grid.tilesOf(r.id)).map((t) => [t.id, `${t.ground}${t.bloom}`]));
    const summary = (sim.cat as unknown as Applier).apply('catsGarden', 1, 0);
    expect(summary).toMatch(/garden blooms on/);
    sim.advance(5);
    const changed = sim.grid.rooftops.flatMap((r) => sim.grid.tilesOf(r.id)).filter((t) => before.get(t.id) !== `${t.ground}${t.bloom}`);
    expect(changed.length).toBeGreaterThanOrEqual(2);
    expect(changed.length).toBeLessThanOrEqual(TUNING.cat.catsGardenTiles);
    expect(new Set(changed.map((t) => t.roofId)).size).toBe(1);
    for (const t of changed) {
      expect(sim.grid.isPlayable(t.roofId)).toBe(true);
      expect(t.blocked || !!t.occupantId).toBe(false);
      expect(t.ground).toBe('restored');
      expect(t.bloom).toBeGreaterThanOrEqual(2);
    }
  });

  it('never blocks a build: a machine on the cat’s nook sends it to another spot, same spawn and nothing paid', () => {
    const sim = makeSim(6);
    rich(sim);
    const anchor = CAT_ANCHORS.find((a) => a.id === 'core-step')!;
    expect(sim.cat.spawn(anchor.id)).toBe(true);
    const spawnedAt = sim.state.cat.active!.spawnedAt;
    const res = JSON.stringify(sim.state.resources);
    ground(sim, 'r1', 2, 0, 'restored');
    expect(sim.build.check('solar', 'r1', 2, 0).ok).toBe(true);
    const cost = sim.build.cost('solar').biomass ?? 0;
    expect(sim.build.place('solar', 'r1', 2, 0)).toBeTruthy();
    expect(sim.state.cat.active!.anchorId).not.toBe(anchor.id);
    expect(sim.state.cat.active!.spawnedAt).toBe(spawnedAt);
    const after = JSON.parse(res);
    after.biomass -= cost;
    expect(sim.state.resources.biomass).toBeCloseTo(after.biomass);
    expect(sim.state.cat.found).toBe(0);
  });

  it('a cat hiding on the Canopy reloads in the same nook and pays exactly once', () => {
    const sim = neighbourhood(15);
    expect(sim.cat.spawn('canopy-rail')).toBe(true);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.state.cat.active?.anchorId).toBe('canopy-rail');
    expect(copy.cat.claim()).toBeDefined();
    const after = new Sim(saver.deserialize(saver.serialize(copy.state))!);
    expect(after.state.cat.active).toBeUndefined();
    expect(after.cat.claim()).toBeUndefined();
    expect(after.state.cat.found).toBe(1);
  });
});
