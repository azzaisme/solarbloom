import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { big, toNum } from '../src/core/Big';
import type { MachineData, MachineType } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { fill, makeSim, PAD, rich } from './helpers';

/** Phase 5 E14: superstructures (tier 3 cores, staged construction, abilities). */

function setup() {
  const sim = makeSim();
  rich(sim);
  sim.state.caps.energy = big(1e6);
  sim.state.caps.water = big(1e6);
  sim.state.resources.energy = big(1e6);
  sim.state.resources.water = big(1e6);
  sim.state.resources.biomass = big(1e9);
  for (const t of sim.grid.tilesOf(PAD)) t.blocked = false; // the test pad's vents would block 2×2 footprints
  fill(sim, 0, 0, 7, 7, 'restored');
  return sim;
}
/** Three edge-connected tier-2 machines in a row from (x, z), merged into a core. */
function makeCore(sim: Sim, type: MachineType, x = 4, z = 6) {
  const ms = [0, 1, 2].map((i) => sim.build.place(type as never, PAD, x + i * (type === 'droneHub' ? 2 : 1), z)!);
  for (const m of ms) m.tier = 2;
  const p = sim.merge.plan(ms[0].id)!;
  expect(p.ok, p.reason).toBe(true);
  expect(p.core).toBe(true);
  expect(sim.merge.commit(ms[0].id, p.partners.map((m) => m.id), p.key, p.fee)).toBeDefined();
  return ms;
}
function build(sim: Sim, type: MachineType, x: number, z: number): MachineData {
  for (const k of ['energy', 'water'] as const) sim.state.resources[k] = sim.state.caps[k];
  const m = sim.supers.place(type, PAD, x, z)!;
  expect(m).toBeDefined();
  expect(sim.supers.advance(m.id)).toBe(true);
  expect(sim.supers.advance(m.id)).toBe(true);
  for (const k of ['energy', 'water'] as const) sim.state.resources[k] = sim.state.caps[k]; // above the drones' reserve again
  return m;
}
const restoreNear = (sim: Sim, m: MachineData, n: number) => {
  let done = 0;
  for (const t of sim.grid.tilesNear(m, 3)) {
    if (done >= n) break;
    if (t.occupantId) continue;
    t.ground = 'prepared';
    t.bloom = 0;
    sim.grid.touch(t);
    sim.restoration.complete(t, 'pulse');
    done++;
  }
  return done;
};

describe('Phase 5 E14: superstructure cores', () => {
  it('three tier-2 machines become a stored core: all three leave, their tiles freed and kept, nothing placed yet', () => {
    const sim = setup();
    const t = sim.grid.get(PAD, 5, 6)!;
    t.bloom = 3;
    const ms = makeCore(sim, 'solar');
    for (const m of ms) expect(sim.machine(m.id)).toBeUndefined();
    expect(t.occupantId).toBeUndefined();
    expect(t.bloom).toBe(3);
    expect(sim.supers.coreCount('solar')).toBe(1);
  });

  it('a blocked footprint never uses the core or charges anything; a valid one pays only the foundation', () => {
    const sim = setup();
    makeCore(sim, 'solar');
    const before = JSON.stringify([sim.state.resources, sim.state.cores]);
    sim.grid.get(PAD, 1, 4)!.blocked = true;
    expect(sim.supers.check('solar', PAD, 0, 4).ok).toBe(false);
    expect(sim.supers.place('solar', PAD, 0, 4)).toBeUndefined();
    expect(sim.supers.place('solar', PAD, 7, 7)).toBeUndefined(); // off the edge
    expect(JSON.stringify([sim.state.resources, sim.state.cores])).toBe(before);
    const costs = sim.supers.check('solar', PAD, 2, 3).costs;
    const b0 = sim.state.resources.biomass;
    const m = sim.supers.place('solar', PAD, 2, 3)!;
    expect(m.size).toBe(2);
    expect(m.project!.stage).toBe(1);
    expect(toNum(b0.sub(sim.state.resources.biomass))).toBe(toNum(costs[0].biomass!));
    expect(sim.supers.coreCount('solar')).toBe(0);
  });

  it('builds in three paid stages with prices locked at placement; it does nothing until built, then ×18', () => {
    const sim = setup();
    makeCore(sim, 'solar');
    const one = sim.production.solarOutput(sim.machinesOfType('solar').find((x) => x.starter)!, true) / (TUNING.starterSolarRate / TUNING.solarRate);
    const m = sim.supers.place('solar', PAD, 2, 3)!;
    expect(sim.production.solarOutput(m, true)).toBe(0);
    const assembly = sim.supers.nextCost(m)!;
    // Income changes don't move the locked price.
    fill(sim, 0, 0, 7, 7, 'restored');
    for (const t of sim.grid.tilesOf(PAD)) t.bloom = 3;
    sim.production.markDirty();
    expect(toNum(sim.supers.nextCost(m)!.biomass!)).toBe(toNum(assembly.biomass!));
    sim.state.resources.biomass = big(0);
    expect(sim.supers.advance(m.id)).toBe(false);
    expect(m.project!.stage).toBe(1);
    sim.state.resources.biomass = big(1e12);
    expect(sim.supers.advance(m.id)).toBe(true);
    expect(sim.production.solarOutput(m, true)).toBe(0);
    expect(sim.supers.advance(m.id)).toBe(true);
    expect(m.project).toBeUndefined();
    expect(sim.supers.advance(m.id)).toBe(false);
    expect(sim.production.solarOutput(m, true)).toBeCloseTo(one * TUNING.super.outputMult, 6);
    expect(sim.state.stats.supers).toBe(1);
  });

  it('cores, construction stages and ability charge survive save and load', () => {
    const sim = setup();
    makeCore(sim, 'solar');
    makeCore(sim, 'condenser', 4, 7);
    const m = sim.supers.place('solar', PAD, 2, 3)!;
    sim.supers.advance(m.id);
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.supers.coreCount('condenser')).toBe(1);
    const c = copy.machine(m.id)!;
    expect(c.project!.stage).toBe(2);
    expect(toNum(copy.supers.nextCost(c)!.biomass!)).toBe(toNum(sim.supers.nextCost(m)!.biomass!));
    copy.supers.advance(c.id);
    copy.supers.addCharge(c, 7);
    const again = new Sim(saver.deserialize(saver.serialize(copy.state))!);
    expect(again.machine(m.id)!.ability!.charge).toBe(7);
  });

  it('a superstructure never merges again', () => {
    const sim = setup();
    makeCore(sim, 'solar');
    const m = build(sim, 'solar', 2, 3);
    expect(sim.merge.canMerge(m)).toBe(false);
    expect(sim.merge.plan(m.id)!.ok).toBe(false);
  });
});

describe('Phase 5 E14: abilities', () => {
  it('Solar Megaflower: charges from restorations in reach; Solar Burst ×3 energy for 15 s; no double-firing', () => {
    const sim = setup();
    makeCore(sim, 'solar');
    const m = build(sim, 'solar', 2, 3);
    expect(sim.supers.activate(m.id)).toBe(false); // not charged
    restoreNear(sim, m, TUNING.super.megaflower.charge);
    expect(sim.supers.ready(m)).toBe(true);
    const e0 = toNum(sim.production.rates().energy);
    expect(sim.supers.activate(m.id)).toBe(true);
    expect(sim.mods.solarMult()).toBe(TUNING.super.megaflower.mult);
    expect(toNum(sim.production.rates().energy)).toBeGreaterThan(e0 * 2);
    restoreNear(sim, m, 30);
    expect(sim.supers.activate(m.id)).toBe(false); // still running
    for (let i = 0; i < 160; i++) sim.advance(0.1);
    expect(sim.mods.solarMult()).toBe(1);
  });

  it('auto-firing is offered only after the first manual use', () => {
    const sim = setup();
    makeCore(sim, 'solar');
    const m = build(sim, 'solar', 2, 3);
    expect(sim.supers.setAuto(m.id, true)).toBe(false);
    restoreNear(sim, m, 30);
    sim.supers.activate(m.id);
    expect(sim.supers.setAuto(m.id, true)).toBe(true);
    for (let i = 0; i < 160; i++) sim.advance(0.1);
    restoreNear(sim, m, 30);
    sim.advance(0.1);
    expect(m.ability!.used).toBe(2);
  });

  it('Water Nexus: a wave of at most 24 tiles, nearest first; its own wave never recharges it; nothing to water keeps the charge', () => {
    const sim = setup();
    makeCore(sim, 'condenser');
    const m = build(sim, 'condenser', 2, 3);
    fill(sim, 0, 0, 7, 7, 'prepared');
    for (const t of sim.grid.footprint(PAD, 2, 3, 2)) t!.ground = 'restored';
    sim.supers.addCharge(m, TUNING.super.nexus.charge);
    const restoredBefore = sim.state.stats.tilesRestored;
    expect(sim.supers.activate(m.id)).toBe(true);
    for (let i = 0; i < 80; i++) sim.advance(0.1);
    const n = sim.state.stats.tilesRestored - restoredBefore;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(TUNING.super.nexus.tiles * 3); // the wave plus bounded chain reactions
    expect(m.ability!.charge).toBe(0);
    // Everything in full bloom: nothing to do, charge kept.
    for (const t of sim.grid.tilesOf(PAD)) if (!t.occupantId && !t.blocked) {
      t.ground = 'restored';
      t.bloom = TUNING.restore.maxBloom;
    }
    sim.supers.addCharge(m, TUNING.super.nexus.charge);
    expect(sim.supers.activate(m.id)).toBe(false);
    expect(sim.supers.blocked(m)).toMatch(/charge kept/);
    expect(m.ability!.charge).toBe(TUNING.super.nexus.charge);
  });

  it('Tree of Life: 3×3, stores up to 3 charges, each release grows the 12 least-grown tiles a stage', () => {
    const sim = setup();
    makeCore(sim, 'pollinator');
    const m = build(sim, 'pollinator', 2, 3);
    expect(m.size).toBe(3);
    sim.supers.addCharge(m, 1000);
    expect(m.ability!.charge).toBe(TUNING.super.treeOfLife.charge * TUNING.super.treeOfLife.store);
    for (const t of sim.grid.tilesOf(PAD)) if (!t.occupantId) t.bloom = 1;
    const targets = sim.supers.targets(m);
    expect(targets.length).toBe(TUNING.super.treeOfLife.tiles);
    expect(sim.supers.activate(m.id)).toBe(true);
    for (let i = 0; i < 40; i++) sim.advance(0.1);
    for (const t of targets) expect(t.bloom).toBeGreaterThanOrEqual(2);
    // One charge used; a little flow charge (its own growth, ~4 s) comes back, never a whole charge.
    expect(m.ability!.charge).toBeGreaterThanOrEqual(TUNING.super.treeOfLife.charge * 2);
    expect(m.ability!.charge).toBeLessThan(TUNING.super.treeOfLife.charge * 2 + 5);
  });

  it('Drone Megahub: charges from its own drones’ jobs; Swarm launches 6 temporary drones that leave again', () => {
    const sim = setup();
    makeCore(sim, 'droneHub', 0, 6);
    fill(sim, 0, 0, 7, 5, 'polluted');
    for (let x = 2; x < 4; x++) for (let z = 3; z < 5; z++) sim.grid.get(PAD, x, z)!.ground = 'restored';
    const m = build(sim, 'droneHub', 2, 3);
    for (let i = 0; i < 600 && (m.ability?.charge ?? 0) < 3; i++) sim.advance(0.1);
    expect(m.ability!.charge).toBeGreaterThan(0);
    sim.supers.addCharge(m, TUNING.super.megahub.charge);
    expect(sim.supers.activate(m.id)).toBe(true);
    expect(sim.state.drones.filter((d) => d.swarm).length).toBe(TUNING.super.megahub.drones);
    const c0 = m.ability!.charge;
    for (let i = 0; i < 400; i++) sim.advance(0.1);
    expect(sim.state.drones.filter((d) => d.swarm).length).toBe(0);
    expect(m.ability!.charge).toBeGreaterThanOrEqual(c0); // swarm jobs never charged it
  });

  it('two Water Nexuses on auto beside each other stay bounded (no runaway of abilities or rewards)', () => {
    const sim = setup();
    makeCore(sim, 'condenser');
    makeCore(sim, 'condenser', 4, 7);
    const a = build(sim, 'condenser', 0, 3);
    const b = build(sim, 'condenser', 2, 3);
    fill(sim, 0, 0, 7, 7, 'prepared');
    for (const m of [a, b]) for (const t of sim.grid.footprint(PAD, m.x, m.z, 2)) t!.ground = 'restored';
    for (const m of [a, b]) {
      sim.supers.addCharge(m, 100);
      sim.supers.activate(m.id);
      sim.supers.setAuto(m.id, true);
    }
    const used = () => a.ability!.used + b.ability!.used;
    for (let i = 0; i < 1200; i++) sim.advance(0.1);
    expect(used()).toBeLessThanOrEqual(4);
    expect(sim.chains.activeRuns).toBe(0);
  });
});
