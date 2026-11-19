import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { tileLevel } from '../src/core/Height';
import { regionOfCell } from '../src/core/OldCityLayout';
import { KEEPERS, REGIONS, type RegionId } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';

/**
 * E23.8 (#329): three optional glides back toward the park, from the far regions' high ground. Each perch stands in
 * its region on ground bloombot walks to; it lands lower down, in a region nearer the fountain, on ground walked
 * from there. Glide (fountain tier 4) and a little charge; never needed to get anywhere.
 */
const FOUNTAIN = [8.5, 8.5];
const all = REGIONS.flatMap((r) => r.glides.map((g) => ({ r, g })));

/** Ground reached on foot from a region's Keeper, every gate open. */
function reached(sim: Sim, id: RegionId): Set<string> {
  const w = new Walker(sim);
  const k = KEEPERS.find((q) => q.region === id)!;
  const seen = new Set<string>([`${k.x},${k.z}`]);
  const queue: [number, number][] = [[k.x, k.z]];
  while (queue.length) {
    const [x, z] = queue.shift()!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      const key = `${nx},${nz}`;
      if (seen.has(key) || Math.max(Math.abs(nx - k.x), Math.abs(nz - k.z)) > 96 || !w.walkable(GROUND, nx, nz) || !w.stepOk(GROUND, x, z, nx, nz)) continue;
      seen.add(key);
      queue.push([nx, nz]);
    }
  }
  return seen;
}

function openWorld(): Sim {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.abilities = ['pry', 'hover', 'climb', 'glide'];
  for (const r of REGIONS) sim.state.areas[r.id] = { fog: 'thinning', revealedAt: 0 };
  for (const r of REGIONS)
    for (const [x, z] of r.gate.cells) {
      const t = sim.grid.get(GROUND, x, z)!;
      t.blocked = false;
      t.unblocked = true;
    }
  return sim;
}

describe('E23.8 (#329): optional glides back toward the park', () => {
  it('three glides, from ring 3 down toward the park: lower, nearer the fountain, at most 24 cells', () => {
    expect(all.length).toBe(3);
    for (const { r, g } of all) {
      expect(r.ring, g.id).toBe(3);
      expect(regionOfCell(g.x, g.z)?.id, g.id).toBe(r.id);
      const land = regionOfCell(g.to[0], g.to[1]);
      expect(land && land.ring < r.ring, `${g.id} lands in a nearer ring`).toBe(true);
      expect(tileLevel(g.to[0], g.to[1]), `${g.id} lands lower`).toBeLessThan(tileLevel(g.x, g.z));
      const d = (x: number, z: number) => Math.hypot(x + 0.5 - FOUNTAIN[0], z + 0.5 - FOUNTAIN[1]);
      expect(d(g.to[0], g.to[1]), `${g.id} brings bloombot nearer the fountain`).toBeLessThan(d(g.x, g.z));
      expect(Math.hypot(g.to[0] - g.x, g.to[1] - g.z), g.id).toBeLessThanOrEqual(24);
    }
    const ids = all.map(({ g }) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each perch stands on its cell, walked up to from its Keeper; each landing is open ground walked from the near Keeper', () => {
    const sim = openWorld();
    for (const { r, g } of all) {
      const t = sim.grid.get(GROUND, g.x, g.z)!;
      expect(t.prop, g.id).toBe(`glide:${g.id}`);
      expect(t.blocked, g.id).toBe(true);
      const from = reached(sim, r.id);
      expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => from.has(`${g.x + dx},${g.z + dz}`)), `${g.id}: its perch is walked up to`).toBe(true);
      const land = regionOfCell(g.to[0], g.to[1])!;
      expect(reached(sim, land.id).has(`${g.to[0]},${g.to[1]}`), `${g.id}: its landing is walked from ${land.id}'s Keeper`).toBe(true);
    }
  });

  it('gliding needs Glide and a little charge, and uses the charge', () => {
    const sim = new Sim(createInitialState(7));
    const { g } = all[0];
    expect(sim.gates.glideAt(g.x, g.z)).toBe(g);
    expect(sim.gates.glideProblem()).toMatch(/needs Glide/);
    expect(sim.gates.glide(g)).toBe(false);
    sim.state.salvage!.abilities = ['pry', 'hover', 'climb', 'glide'];
    expect(sim.gates.glideProblem()).toBeUndefined();
    const before = sim.charge.value();
    expect(sim.gates.glide(g)).toBe(true);
    expect(sim.charge.value()).toBeLessThan(before);
    // out of charge: it waits until bloombot has rested (nothing is lost)
    sim.state.charge!.value = 0;
    expect(sim.gates.glideProblem()).toMatch(/Out of charge/);
  });
});
