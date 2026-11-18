import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { decorKey } from '../src/core/Decor';
import type { MachineData } from '../src/core/types';
import { REGIONS } from '../src/data/oldcity';
import { ITEM_DEFS } from '../src/data/items';
import { OVERGROWTH, OVERGROWTH_TUNING } from '../src/data/overgrowth';
import { PROJECTS } from '../src/data/research';
import { Sim } from '../src/gameplay/Sim';

const NEAR = { roofId: GROUND, x: 8.5, z: 11.5 };
const DAY = OVERGROWTH_TUNING.growDays * OVERGROWTH_TUNING.daySeconds;
const CACHES = new Set(REGIONS.flatMap((r) => r.caches.map((c) => c.id)));

/** A park with a chest, a bench, a pipe run (E23.4's saved pipes) and two linked poles (a stand-in E23.3 grid). */
function park() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.state.salvage!.tier = 1;
  sim.bot = NEAR;
  const chest = { id: 'c1', type: 'chest', roofId: GROUND, x: 14, z: 14, size: 1 } as MachineData;
  const a = { id: 'pa', type: 'relay', roofId: GROUND, x: 10, z: 20, size: 1 } as MachineData;
  const b = { id: 'pb', type: 'relay', roofId: GROUND, x: 16, z: 20, size: 1 } as MachineData;
  sim.state.machines.push(chest, a, b);
  sim.grid.indexMachine(chest);
  sim.grid.get(GROUND, 14, 14)!.occupantId = chest.id;
  sim.state.cozy = { ...(sim.state.cozy ?? {}), decor: { [decorKey(GROUND, 12, 12)]: 'bench' } } as never;
  (sim.state as unknown as { water: { pipes: string[] } }).water = { pipes: ['18,10', '19,10', '20,10'] };
  Object.assign(sim, { power: { networks: () => [{ links: [[a, b]] }] } });
  for (const k of ['c-elderGrove-2', 'c-saltwind-1']) sim.state.salvage!.caches.push(k);
  sim.state.salvage!.research = { analysed: [], done: PROJECTS.filter((p) => p.branch === 'decor').map((p) => p.id), running: [], levels: {} };
  sim.inventory.addToStore('seeds', 200);
  sim.inventory.addToStore('planks', 20);
  return sim;
}

describe('E23.6.6: overgrowth', () => {
  it('the starting set, each with a real cost, unlocked somewhere reachable', () => {
    expect(OVERGROWTH.map((o) => o.id)).toEqual(['ivy', 'moss', 'clematis', 'morningGlory', 'climbingRose', 'wisteria', 'hangingBasket']);
    for (const o of OVERGROWTH) {
      for (const k of Object.keys(o.cost)) expect(k in ITEM_DEFS, `${o.id}: ${k}`).toBe(true);
      const u = o.unlock;
      if ('research' in u) expect(PROJECTS.find((p) => p.id === u.research)?.gives, o.id).toEqual({ recipe: o.id });
      else if ('find' in u) expect(CACHES.has(u.find), o.id).toBe(true);
      else expect('home' in u, o.id).toBe(true);
    }
  });

  it('each kind can be placed on a power line, a pipe run and a machine (and a decoration and a ruin)', () => {
    for (const o of OVERGROWTH) {
      const sim = park();
      const og = sim.overgrowth;
      const line = og.hostAt(GROUND, 13, 20);
      expect(line?.kind, o.id).toBe('line');
      const pipe = og.hostAt(GROUND, 19, 10);
      expect(pipe?.kind).toBe('pipe');
      const machine = og.hostAt(GROUND, 14, 14);
      expect(machine?.kind).toBe('machine');
      const bench = og.hostAt(GROUND, 12, 12);
      expect(bench?.kind).toBe('decor');
      for (const h of [line, pipe, machine, bench]) expect(og.place(o.id, h), `${o.id} on ${h!.kind}`).toBeUndefined();
      expect(Object.keys(og.all()).length).toBe(4);
    }
  });

  it('a ruin takes it too', () => {
    const sim = park();
    let ruin: { x: number; z: number } | undefined;
    for (let x = -20; x < 20 && !ruin; x++)
      for (let z = -20; z < 20 && !ruin; z++) {
        const t = sim.grid.get(GROUND, x, z);
        if (t?.blocked && t.feature === 'obstacle') ruin = { x, z };
      }
    expect(ruin).toBeDefined();
    const h = sim.overgrowth.hostAt(GROUND, ruin!.x, ruin!.z);
    expect(h?.kind).toBe('ruin');
    expect(sim.overgrowth.place('ivy', h)).toBeUndefined();
  });

  it('it costs cuttings or seeds and comes back whole when removed', () => {
    const sim = park();
    const before = sim.inventory.stored('seeds');
    const h = sim.overgrowth.hostAt(GROUND, 14, 14)!;
    sim.overgrowth.place('wisteria', h);
    expect(sim.inventory.stored('seeds')).toBe(before - 5);
    expect(sim.overgrowth.place('ivy', h)).toBe('Something already grows here');
    sim.overgrowth.remove(h.key);
    expect(sim.inventory.count('seeds') + sim.inventory.stored('seeds')).toBe(before);
    expect(sim.overgrowth.all()).toEqual({});
  });

  it('a kind not known yet cannot be placed', () => {
    const sim = park();
    sim.state.salvage!.research = { analysed: [], done: [], running: [], levels: {} };
    expect(sim.overgrowth.place('wisteria', sim.overgrowth.hostAt(GROUND, 14, 14))).toBe('Wisteria is not known yet');
    expect(sim.overgrowth.known()).toContain('ivy');
    expect(sim.overgrowth.known()).not.toContain('wisteria');
  });

  it('grows in from a sprout over a game day', () => {
    const sim = park();
    const h = sim.overgrowth.hostAt(GROUND, 14, 14)!;
    sim.overgrowth.place('ivy', h);
    const g = sim.overgrowth.at(h.key)!;
    expect(sim.overgrowth.growth(g)).toBe(0);
    sim.state.time += DAY / 2;
    expect(sim.overgrowth.growth(g)).toBeCloseTo(0.5, 5);
    sim.state.time += DAY;
    expect(sim.overgrowth.growth(g)).toBe(1);
  });

  it('adds to the area\'s plant variety, a kind once; and never changes how a machine works', () => {
    const sim = park();
    const area = sim.areas.areaOf({ roofId: GROUND, x: 14, z: 14 })!;
    expect(sim.overgrowth.kindsIn(area)).toEqual([]);
    const before = JSON.stringify(sim.machine('c1'));
    expect(sim.areas.areaOf({ roofId: GROUND, x: 12, z: 12 })).toBe(area);
    sim.overgrowth.place('ivy', sim.overgrowth.hostAt(GROUND, 14, 14));
    sim.overgrowth.place('clematis', sim.overgrowth.hostAt(GROUND, 12, 12));
    sim.overgrowth.place('ivy', sim.overgrowth.hostAt(GROUND, 19, 10)); // a second ivy counts once
    expect(sim.overgrowth.kindsIn(area).sort()).toEqual(['clematis', 'ivy']);
    expect(JSON.stringify(sim.machine('c1'))).toBe(before);
    // the island's ecosystem counts overgrowth kinds as plant variety
    sim.ecosystem.refresh(true);
    const bare = park();
    bare.ecosystem.refresh(true);
    expect(sim.ecosystem.bio.species).toBe(bare.ecosystem.bio.species + 2);
  });

  it('taking a machine down gives its overgrowth back', () => {
    const sim = park();
    const h = sim.overgrowth.hostAt(GROUND, 14, 14)!;
    sim.overgrowth.place('moss', h);
    sim.state.machines = sim.state.machines.filter((m) => m.id !== 'c1');
    sim.overgrowth.tidy();
    expect(sim.overgrowth.at(h.key)).toBeUndefined();
  });

  it('survives a save, sorted for byte-identical saves', () => {
    const sim = park();
    sim.overgrowth.place('moss', sim.overgrowth.hostAt(GROUND, 19, 10));
    sim.overgrowth.place('ivy', sim.overgrowth.hostAt(GROUND, 14, 14));
    expect(Object.keys(sim.state.salvage!.overgrowth!)).toEqual(['m:c1', 'p:19,10']);
  });
});
