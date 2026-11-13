import { describe, expect, it } from 'vitest';
import { distToFootprint, tileId } from '../src/core/Grid';
import { makeSim } from './helpers';

describe('grid', () => {
  it('has stable ids and an 8x8 first rooftop', () => {
    const sim = makeSim();
    const r = sim.grid.roof('r1')!;
    expect(r.tiles.length).toBe(64);
    expect(sim.grid.get('r1', 3, 5)!.id).toBe(tileId('r1', 3, 5));
    expect(sim.grid.get('r1', 8, 0)).toBeUndefined();
  });

  it('neighbors respect edges', () => {
    const sim = makeSim();
    expect(sim.grid.neighbors(sim.grid.get('r1', 0, 0)!).length).toBe(2);
    expect(sim.grid.neighbors(sim.grid.get('r1', 7, 3)!).length).toBe(3);
    expect(sim.grid.neighbors(sim.grid.get('r1', 4, 4)!).length).toBe(4);
  });

  it('world <-> cell conversion round-trips for every tile', () => {
    const sim = makeSim();
    for (const t of sim.grid.roof('r1')!.tiles) {
      const [wx, , wz] = sim.grid.tileWorld(t);
      expect(sim.grid.worldToCell('r1', wx + 0.49, wz - 0.49)).toEqual({ x: t.x, z: t.z });
    }
  });

  it('footprint distance is Manhattan to nearest footprint cell', () => {
    expect(distToFootprint(5, 5, 2, 2, 2)).toBe(4);
    expect(distToFootprint(2, 3, 2, 2, 2)).toBe(0);
    expect(distToFootprint(4, 2, 2, 2, 2)).toBe(1);
  });

  it('tilesNear clips at rooftop edges', () => {
    const sim = makeSim();
    const near = sim.grid.tilesNear({ roofId: 'r1', x: 0, z: 0, size: 1 }, 1);
    expect(near.map((t) => t.id).sort()).toEqual(['r1:0:1', 'r1:1:0']);
  });
});
