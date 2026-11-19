import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { regionOfCell, setPieceAt } from '../src/core/OldCityLayout';
import { DRESS, KEEPERS, REGIONS } from '../src/data/oldcity';
import { MATERIALS } from '../src/data/salvage';
import { Sim } from '../src/gameplay/Sim';
import { Walker } from '../src/gameplay/Walker';

/**
 * E23.8 (#327–#329): every region is dressed with 6–10 old things of its own (Mast Row's tram rails besides), drawn
 * from existing models or shapes, never a salvage model (nothing to mistake for a pile), and never in the way: each
 * blocking prop stands apart from every pile and every other prop, and the Keeper still reaches everything.
 */
describe('E23.8: region dressing', () => {
  const salvageModels = new Set(Object.values(MATERIALS).flatMap((m) => m.models));

  it('each region has 6–10 dressing props of known kinds, none drawn with a salvage model', () => {
    for (const r of REGIONS) {
      const props = r.dressing.filter((d) => !DRESS[d.kind].walk);
      expect(props.length, r.id).toBeGreaterThanOrEqual(6);
      expect(props.length, r.id).toBeLessThanOrEqual(10);
      for (const d of r.dressing) {
        expect(DRESS[d.kind], `${r.id} ${d.kind}`).toBeDefined();
        expect([0, 1, 2, 3]).toContain(d.turn);
      }
    }
    for (const def of Object.values(DRESS)) if (def.model) expect(salvageModels.has(def.model), def.model).toBe(false);
    // Mast Row's tram lines run in its road
    const rails = REGIONS.find((r) => r.id === 'mastRow')!.dressing.filter((d) => d.kind === 'tram-rails');
    expect(rails.length).toBeGreaterThanOrEqual(3);
  });

  it('every prop stands in its region, on its own cell, stamped (blocking, but rails), apart from piles and other props', () => {
    const sim = new Sim(createInitialState(7));
    for (const r of REGIONS) {
      const blockers = [...r.piles.map((p) => [p.x, p.z, p.id] as const), ...r.dressing.filter((d) => !DRESS[d.kind].walk).map((d) => [d.x, d.z, `${d.kind}@${d.x},${d.z}`] as const)];
      for (const d of r.dressing) {
        expect(regionOfCell(d.x, d.z)?.id, `${r.id} ${d.kind}`).toBe(r.id);
        // its own cell: no other set piece claimed it
        const sp = setPieceAt(d.x, d.z);
        expect(sp?.kind === 'dress' && sp.dress === d, `${r.id} ${d.kind} at ${d.x},${d.z}`).toBe(true);
        const t = sim.grid.get(GROUND, d.x, d.z)!;
        expect(t.prop).toBe(`dress:${d.kind}:${d.turn}`);
        expect(t.blocked, `${d.kind} blocks`).toBe(!DRESS[d.kind].walk);
        if (DRESS[d.kind].walk) expect(t.feature, 'rails lie in the road').toBe('road');
        else for (const [x, z, id] of blockers) if (x !== d.x || z !== d.z) expect(Math.max(Math.abs(x - d.x), Math.abs(z - d.z)), `${d.kind}@${d.x},${d.z} beside ${id}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('with every prop standing, the Keeper still reaches every pile, cache, page and lookout of its region', () => {
    const sim = new Sim(createInitialState(7));
    sim.state.salvage!.abilities = ['pry', 'hover', 'climb', 'glide'];
    for (const r of REGIONS) sim.state.areas[r.id] = { fog: 'thinning', revealedAt: 0 };
    for (const r of REGIONS)
      for (const [x, z] of r.gate.cells) {
        const t = sim.grid.get(GROUND, x, z)!;
        t.blocked = false;
        t.unblocked = true;
      }
    const w = new Walker(sim);
    for (const r of REGIONS) {
      const k = KEEPERS.find((q) => q.region === r.id)!;
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
      const beside = (x: number, z: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => seen.has(`${x + dx},${z + dz}`));
      for (const p of r.piles) expect(beside(p.x, p.z), `${r.id} ${p.id}`).toBe(true);
      for (const c of [...r.caches, ...r.pages, r.lookout]) if (regionOfCell(c.x, c.z)?.id === r.id) expect(beside(c.x, c.z), `${r.id} ${c.id}`).toBe(true);
      for (const d of r.dressing) if (DRESS[d.kind].walk) expect(seen.has(`${d.x},${d.z}`), `${r.id} rails at ${d.x},${d.z}`).toBe(true);
    }
  });

  it('nothing is built over old tram rails', () => {
    const sim = new Sim(createInitialState(7));
    const d = REGIONS.find((r) => r.id === 'mastRow')!.dressing.find((q) => q.kind === 'tram-rails')!;
    expect(sim.build.footprintProblem(GROUND, d.x, d.z, 1, ['polluted', 'prepared', 'restored', 'growing'])).toMatch(/tram lines|fog/i);
  });
});
