import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { big, toNum } from '../src/core/Big';
import type { MachineData } from '../src/core/types';
import { TUNING } from '../src/data/tuning';
import { Sim } from '../src/gameplay/Sim';
import { fill, makeSim, PAD, rich } from './helpers';

/** Phase 5 E13: merging three connected tier-1 machines into one tier 2. */

function setup() {
  const sim = makeSim();
  rich(sim);
  fill(sim, 0, 0, 7, 7, 'restored');
  return sim;
}
const place = (sim: Sim, type: Parameters<Sim['build']['place']>[0], x: number, z: number) => sim.build.place(type, PAD, x, z)!;
/** Everything a failed merge must leave alone. */
const snapshot = (sim: Sim) =>
  JSON.stringify({ m: sim.state.machines, r: sim.state.resources, d: sim.state.drones, t: [...sim.grid.tilesOf(PAD)].map((t) => [t.id, t.occupantId, t.ground, t.bloom]), st: sim.state.stats });
const merge = (sim: Sim, anchor: MachineData, partners?: MachineData[]) => {
  const plan = sim.merge.plan(anchor.id, partners?.map((p) => p.id))!;
  return { plan, merged: plan.ok ? sim.merge.commit(anchor.id, plan.partners.map((p) => p.id), plan.key, plan.fee) : undefined };
};

describe('Phase 5 E13: merging', () => {
  it('pacing pass: tier2Beside counts the touching group of tier 2s of that type (build-tooltip core hint)', () => {
    const sim = setup();
    const a = place(sim, 'solar', 2, 2), b = place(sim, 'solar', 3, 2);
    a.tier = 2;
    b.tier = 2;
    expect(sim.merge.tier2Beside('solar', PAD, 4, 2, 1)).toBe(2); // touches b, whose group includes a
    expect(sim.merge.tier2Beside('solar', PAD, 2, 3, 1)).toBe(2);
    expect(sim.merge.tier2Beside('solar', PAD, 5, 5, 1)).toBe(0); // touches nothing
    expect(sim.merge.tier2Beside('pollinator', PAD, 4, 2, 1)).toBe(0); // another type
    const c = place(sim, 'solar', 2, 4); // tier 1: not counted
    expect(c.tier ?? 1).toBe(1);
    expect(sim.merge.tier2Beside('solar', PAD, 2, 5, 1)).toBe(0);
  });

  it('three panels in a row merge into one Solar Array: tier-2 output for 3 consumed, two tiles freed, tiles keep their state', () => {
    const sim = setup();
    const a = place(sim, 'solar', 4, 5), b = place(sim, 'solar', 5, 5), c = place(sim, 'solar', 6, 5);
    const one = sim.production.solarOutput(a, true);
    const t5 = sim.grid.get(PAD, 5, 5)!;
    t5.bloom = 3;
    const plan = sim.merge.plan(a.id)!;
    expect(plan.ok).toBe(true);
    expect(plan.free).toBe(true);
    expect(plan.toName).toBe('Solar Array');
    expect(plan.freed.map((t) => `${t.x},${t.z}`).sort()).toEqual(['5,5', '6,5']);
    const m = sim.merge.commit(a.id, plan.partners.map((p) => p.id), plan.key)!;
    expect(m.id).toBe(a.id);
    expect(m.tier).toBe(2);
    expect(sim.machine(b.id)).toBeUndefined();
    expect(sim.machine(c.id)).toBeUndefined();
    expect(sim.machinesOfType('solar').filter((x) => !x.starter)).toEqual([a]);
    expect(t5.occupantId).toBeUndefined();
    expect(t5.ground).toBe('restored');
    expect(t5.bloom).toBe(3);
    expect(sim.production.solarOutput(m, true)).toBeCloseTo(one * TUNING.merge.solarMult, 9);
    // The freed tile can be built on again.
    expect(sim.build.check('solar', PAD, 5, 5).ok).toBe(true);
  });

  it('any connected member can be the anchor; an L-shape counts; diagonal-only contact never does', () => {
    const sim = setup();
    const a = place(sim, 'solar', 4, 4), b = place(sim, 'solar', 5, 4), c = place(sim, 'solar', 5, 5);
    expect(sim.merge.plan(c.id)!.ok).toBe(true);
    expect(sim.merge.plan(a.id)!.ok).toBe(true);
    const sim2 = setup();
    const d = place(sim2, 'solar', 4, 4);
    place(sim2, 'solar', 5, 5);
    place(sim2, 'solar', 6, 6);
    const before = snapshot(sim2);
    const p = sim2.merge.plan(d.id)!;
    expect(p.ok).toBe(false);
    expect(sim2.merge.commit(d.id, p.options.map((o) => o.id), 'x')).toBeUndefined();
    expect(snapshot(sim2)).toBe(before);
    void b;
  });

  it('mixed types, mixed tiers and the starter panel cannot merge, and nothing changes', () => {
    const sim = setup();
    const starter = sim.machinesOfType('solar').find((m) => m.starter)!; // at 3,1
    const s1 = place(sim, 'solar', 4, 1), s2 = place(sim, 'solar', 5, 1);
    const before = snapshot(sim);
    expect(sim.merge.plan(starter.id)!.ok).toBe(false);
    expect(sim.merge.plan(s1.id, [starter.id, s2.id])!.ok).toBe(false);
    const k = place(sim, 'condenser', 6, 1);
    const p = sim.merge.plan(s1.id, [s2.id, k.id])!;
    expect(p.ok).toBe(false);
    expect(sim.merge.commit(s1.id, [s2.id, k.id], p.key)).toBeUndefined();
    void before;
    // Mixed tiers: a Solar Array beside two panels.
    const sim2 = setup();
    const a = place(sim2, 'solar', 4, 5);
    place(sim2, 'solar', 5, 5);
    place(sim2, 'solar', 6, 5);
    merge(sim2, a);
    const x = place(sim2, 'solar', 5, 5), y = place(sim2, 'solar', 6, 5);
    const snap = snapshot(sim2);
    expect(sim2.merge.plan(a.id)!.ok).toBe(false); // top tier until E14
    expect(sim2.merge.plan(x.id, [a.id, y.id])!.ok).toBe(false);
    expect(snapshot(sim2)).toBe(snap);
  });

  it('first merge of a type is free; later ones cost ~20 s of steady biomass income; unaffordable changes nothing', () => {
    const sim = setup();
    const a = place(sim, 'solar', 4, 5);
    place(sim, 'solar', 5, 5);
    place(sim, 'solar', 6, 5);
    expect(merge(sim, a).merged).toBeDefined();
    const b = place(sim, 'solar', 4, 6), c = place(sim, 'solar', 5, 6);
    place(sim, 'solar', 6, 6);
    const p = sim.merge.plan(b.id)!;
    expect(p.free).toBe(false);
    const rate = toNum(sim.production.rates(true).biomass);
    expect(toNum(p.fee.biomass!)).toBeGreaterThanOrEqual(Math.max(TUNING.merge.minFee, rate * TUNING.merge.feeSeconds) - 1);
    sim.state.resources.biomass = big(0);
    const before = snapshot(sim);
    const q = sim.merge.plan(b.id)!;
    expect(q.ok).toBe(false);
    expect(sim.merge.commit(b.id, q.partners.map((x) => x.id), p.key, p.fee)).toBeUndefined();
    expect(snapshot(sim)).toBe(before);
    void c;
  });

  it('a stale preview or a repeated confirm changes nothing', () => {
    const sim = setup();
    const a = place(sim, 'solar', 4, 5), b = place(sim, 'solar', 5, 5), c = place(sim, 'solar', 6, 5);
    const p = sim.merge.plan(a.id)!;
    expect(sim.merge.commit(a.id, [b.id, c.id], 'wrong-key')).toBeUndefined();
    expect(sim.merge.commit(a.id, [b.id, c.id], p.key)).toBeDefined();
    const after = snapshot(sim);
    expect(sim.merge.commit(a.id, [b.id, c.id], p.key)).toBeUndefined();
    expect(snapshot(sim)).toBe(after);
  });

  it('keeps the highest level of each upgrade and reports the levels lost', () => {
    const sim = setup();
    sim.state.resources.biomass = big(1e9);
    const a = place(sim, 'solar', 4, 5), b = place(sim, 'solar', 5, 5), c = place(sim, 'solar', 6, 5);
    for (let i = 0; i < 1; i++) sim.upgrades.purchase('solarArray', a.id);
    for (let i = 0; i < 3; i++) sim.upgrades.purchase('solarArray', b.id);
    for (let i = 0; i < 2; i++) sim.upgrades.purchase('solarArray', c.id);
    const p = sim.merge.plan(a.id)!;
    expect(p.lost).toEqual([{ upgrade: 'solarArray', name: expect.any(String), kept: 3, lost: [1, 2] }]);
    const m = sim.merge.commit(a.id, p.partners.map((x) => x.id), p.key)!;
    expect(sim.upgrades.levelOf(m, 'solarArray')).toBe(3);
  });

  it('merging never makes the next machine cheaper (prices count lifetime builds)', () => {
    const sim = setup();
    const a = place(sim, 'solar', 4, 5);
    place(sim, 'solar', 5, 5);
    place(sim, 'solar', 6, 5);
    const price = toNum(sim.build.cost('solar').biomass!);
    merge(sim, a);
    expect(toNum(sim.build.cost('solar').biomass!)).toBe(price);
    place(sim, 'solar', 5, 5);
    expect(toNum(sim.build.cost('solar').biomass!)).toBeGreaterThan(price);
  });

  it('tap to swap: a tapped connected machine replaces a partner, keeping the three connected', () => {
    const sim = setup();
    const a = place(sim, 'solar', 4, 5), b = place(sim, 'solar', 5, 5), c = place(sim, 'solar', 4, 4), d = place(sim, 'solar', 3, 5);
    const p = sim.merge.plan(a.id, [b.id, c.id])!;
    expect(p.ok).toBe(true);
    expect(p.options.map((m) => m.id).sort()).toEqual([b.id, c.id, d.id].sort());
    const ids = sim.merge.swap(p, d.id)!;
    expect(ids).toContain(d.id);
    expect(sim.merge.plan(a.id, ids)!.ok).toBe(true);
  });

  it('Fleet Hub: partner hubs’ drones leave with no reservation left behind; the fleet launches ×3 drones and reaches 2 further', () => {
    const sim = setup();
    fill(sim, 0, 2, 7, 7, 'polluted');
    for (let z = 4; z < 6; z++) for (let x = 0; x < 6; x++) sim.grid.get(PAD, x, z)!.ground = 'restored';
    const a = place(sim, 'droneHub', 0, 4), b = place(sim, 'droneHub', 2, 4), c = place(sim, 'droneHub', 4, 4);
    const r0 = sim.upgrades.droneRadius(a);
    for (let i = 0; i < 40; i++) sim.advance(0.1); // drones take jobs
    const p = sim.merge.plan(b.id)!;
    expect(p.ok).toBe(true);
    const restored = sim.state.stats.tilesRestored;
    sim.merge.commit(b.id, p.partners.map((x) => x.id), p.key);
    expect(sim.state.drones.filter((d) => d.hubId === a.id || d.hubId === c.id)).toEqual([]);
    for (const d of sim.state.drones) if (d.targetTileId) expect(sim.drones.isReserved(d.targetTileId)).toBe(true);
    expect(sim.state.stats.tilesRestored).toBe(restored); // nothing paid by removing drones
    sim.advance(0.1);
    expect(sim.state.drones.filter((d) => d.hubId === b.id && d.expiresAt === undefined).length).toBe(3);
    expect(sim.upgrades.droneRadius(sim.machine(b.id)!)).toBe(r0 + TUNING.merge.fleetRadiusBonus);
    for (let i = 0; i < 100; i++) sim.advance(0.1); // keeps running without errors
  });

  it('Bloom Garden biomass bonus and radius +1; Condenser Array water', () => {
    const sim = setup();
    const g = place(sim, 'pollinator', 4, 5);
    place(sim, 'pollinator', 5, 5);
    place(sim, 'pollinator', 6, 5);
    const r = sim.upgrades.pollinatorReach(g);
    merge(sim, g);
    expect(sim.upgrades.pollinatorReach(g)).toBe(r + 1);
    const far = sim.grid.get(PAD, 4, 3)!; // 2 tiles away: only in the bigger zone
    expect(sim.production.gardenZoneMult(far)).toBe(TUNING.merge.gardenBiomassMult);
    const w0 = toNum(sim.production.rates(true).water);
    const k = place(sim, 'condenser', 4, 1);
    place(sim, 'condenser', 5, 1);
    place(sim, 'condenser', 6, 1);
    const w3 = toNum(sim.production.rates(true).water);
    merge(sim, k);
    expect(toNum(sim.production.rates(true).water) - w0).toBeCloseTo(((w3 - w0) / 3) * TUNING.merge.waterMult, 6);
  });

  it('after a merge, reload never brings the merged-away machines back; tier, upgrades and counts persist', () => {
    const sim = setup();
    const a = place(sim, 'solar', 4, 5), b = place(sim, 'solar', 5, 5);
    place(sim, 'solar', 6, 5);
    merge(sim, a);
    const saver = new SaveService(undefined);
    const copy = new Sim(saver.deserialize(saver.serialize(sim.state))!);
    expect(copy.machine(a.id)!.tier).toBe(2);
    expect(copy.machine(b.id)).toBeUndefined();
    expect(copy.grid.get(PAD, 5, 5)!.occupantId).toBeUndefined();
    expect(copy.state.stats.merges?.solar).toBe(1);
    expect(toNum(copy.build.cost('solar').biomass!)).toBe(toNum(sim.build.cost('solar').biomass!));
  });

  it('caches stay right when a merge is followed by builds that restore the machine count', () => {
    const sim = setup();
    const a = place(sim, 'solar', 4, 5);
    place(sim, 'solar', 5, 5);
    place(sim, 'solar', 6, 5);
    const total = sim.state.machines.length;
    merge(sim, a);
    const x = place(sim, 'solar', 5, 5), y = place(sim, 'solar', 6, 5);
    expect(sim.state.machines.length).toBe(total);
    expect(sim.machine(x.id)).toBe(x);
    expect(sim.machinesOfType('solar')).toContain(y);
    const e = toNum(sim.production.rates(true).energy);
    const exp = sim.machinesOfType('solar').reduce((s, m) => s + sim.production.solarOutput(m, true), 0);
    expect(e).toBeGreaterThanOrEqual(exp - 1e-6);
  });
});
