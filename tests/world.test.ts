import { describe, expect, it } from 'vitest';
import { CHUNK, generateTile } from '../src/core/Generation';
import { createInitialState, GROUND } from '../src/core/GameState';
import { chunkOf, Grid, tileId } from '../src/core/Grid';
import { Rng } from '../src/core/Rng';
import { Sim } from '../src/gameplay/Sim';
import { makeSim } from './helpers';

const layers = () => createInitialState(1).layers;

describe('world model: global grid and chunks (City 01.1)', () => {
  it('keys round-trip, including negative coordinates and chunk borders', () => {
    const g = new Grid(42, layers());
    for (const [x, z] of [[0, 0], [-1, -1], [-17, 33], [15, 16], [16, 15], [-16, -16], [1000, -2000]]) {
      const t = g.get(GROUND, x, z)!;
      expect(t.id).toBe(tileId(GROUND, x, z));
      expect([t.x, t.z]).toEqual([x, z]);
      expect(g.byTileId(t.id)).toBe(t);
    }
    expect(chunkOf(-1)).toBe(-1);
    expect(chunkOf(15)).toBe(0);
    expect(chunkOf(16)).toBe(1);
    // Neighbours work across chunk borders, in both directions.
    const edge = g.get(GROUND, 15, 0)!;
    expect(g.neighbors(edge).map((n) => n.id).sort()).toEqual([tileId(GROUND, 14, 0), tileId(GROUND, 15, -1), tileId(GROUND, 15, 1), tileId(GROUND, 16, 0)].sort());
  });

  it('generates chunks only when touched', () => {
    const g = new Grid(42, layers());
    expect(g.loadedChunks(GROUND)).toHaveLength(0);
    g.get(GROUND, 5, 5);
    g.get(GROUND, 6, 7);
    expect(g.loadedChunks(GROUND)).toHaveLength(1);
    g.get(GROUND, -1, 5);
    expect(g.loadedChunks(GROUND)).toHaveLength(2);
  });

  it('bounded (rooftop) layers have no tiles outside their size', () => {
    const g = new Grid(42, layers());
    expect(g.get('r1', 8, 0)).toBeUndefined();
    expect(g.get('r1', -1, 0)).toBeUndefined();
    expect(g.tilesOf('r1')).toHaveLength(64);
  });
});

describe('world model: deterministic generation (City 01.2)', () => {
  it('the same seed gives identical tiles whatever order chunks are visited in', () => {
    const cells: [string, number, number][] = [];
    const rng = new Rng(9);
    for (let i = 0; i < 400; i++) cells.push([GROUND, Math.floor(rng.range(-200, 200)), Math.floor(rng.range(-200, 200))]);
    for (const l of ['r1', 'r2', 'r3']) for (let i = 0; i < 20; i++) cells.push([l, Math.floor(rng.range(0, 8)), Math.floor(rng.range(0, 8))]);
    const a = new Grid(777, layers());
    const b = new Grid(777, layers());
    const shuffled = [...cells].sort(() => rng.next() - 0.5);
    const snap = (t: ReturnType<Grid['get']>) => t && [t.id, t.ground, t.pollution, t.variant, t.blocked];
    const fromA = cells.map(([l, x, z]) => snap(a.get(l, x, z)));
    for (const [l, x, z] of shuffled) b.get(l, x, z);
    expect(cells.map(([l, x, z]) => snap(b.get(l, x, z)))).toEqual(fromA);
    // A different seed gives a different world.
    const c = new Grid(778, layers());
    expect(cells.map(([l, x, z]) => snap(c.get(l, x, z)))).not.toEqual(fromA);
  });

  it('generation never touches the game RNG', () => {
    const sim = makeSim(5);
    const before = sim.rng.state;
    for (let x = -100; x < 100; x += 7) sim.grid.get(GROUND, x, x * 2);
    expect(sim.rng.state).toBe(before);
  });

  it('authored rooftop features come from the layout data', () => {
    const sim = makeSim(3);
    expect(sim.grid.get('r1', 7, 0)!.blocked).toBe(true); // rusty vent
    expect(sim.grid.get('r1', 3, 4)!.ground).toBe('prepared');
    expect(sim.grid.get('r1', 3, 1)!.occupantId).toBeDefined(); // starter panel, rebuilt from the machine list
    const l = sim.grid.layer('r1')!;
    expect(generateTile(3, l, 2, 2)).toEqual(generateTile(3, l, 2, 2));
    expect(CHUNK).toBe(16);
  });
});

describe('world model: spatial queries (City 01.3)', () => {
  it('tilesNear / tilesWithin / machinesNear give the same answers as brute force', () => {
    const sim = makeSim(8);
    const all = sim.grid.tilesOf('r1');
    const m = { roofId: 'r1', x: 3, z: 3, size: 2 };
    const brute = all.filter((t) => {
      const dx = t.x < 3 ? 3 - t.x : t.x > 4 ? t.x - 4 : 0;
      const dz = t.z < 3 ? 3 - t.z : t.z > 4 ? t.z - 4 : 0;
      return dx + dz > 0 && dx + dz <= 2;
    });
    expect(sim.grid.tilesNear(m, 2).map((t) => t.id).sort()).toEqual(brute.map((t) => t.id).sort());
    const within = all.filter((t) => Math.abs(t.x - 5) + Math.abs(t.z - 5) <= 2);
    expect(sim.grid.tilesWithin('r1', 5, 5, 2).map((t) => t.id).sort()).toEqual(within.map((t) => t.id).sort());
    const near = sim.grid.machinesNear('r1', 2, 2, 3).map((x) => x.id);
    expect(near).toEqual(sim.state.machines.filter((x) => x.roofId === 'r1' && Math.max(0, x.x - 2, 2 - (x.x + x.size - 1)) + Math.max(0, x.z - 2, 2 - (x.z + x.size - 1)) <= 3).map((x) => x.id));
  });

  it('indexes machines across chunk borders on the endless ground', () => {
    const sim = makeSim(8);
    const m = { id: 'm999', type: 'pollinator' as const, roofId: GROUND, x: 15, z: 15, size: 2, boostUntil: 0, timer: 0, charge: 0 };
    sim.grid.indexMachine(m);
    expect(sim.grid.machinesNear(GROUND, 16, 17, 1).map((x) => x.id)).toEqual(['m999']);
    expect(sim.grid.machinesNear(GROUND, 14, 14, 1)).toHaveLength(0);
    expect(sim.grid.machinesNear(GROUND, 13, 16, 2).map((x) => x.id)).toEqual(['m999']);
  });
});

describe('world model: layers (City 01.4)', () => {
  it('adjacency never crosses layers, even where layers sit side by side in the world', () => {
    const sim = makeSim(2);
    for (const l of sim.grid.allLayers)
      for (const t of l.kind === 'raised' ? sim.grid.tilesOf(l.id) : [sim.grid.get(l.id, 0, 0)!, sim.grid.get(l.id, 7, 8)!]) {
        for (const n of sim.grid.neighbors(t)) expect(n.roofId).toBe(t.roofId);
        for (const n of sim.grid.tilesWithin(t.roofId, t.x, t.z, 3)) expect(n.roofId).toBe(t.roofId);
      }
    // r1's edge tile (7,2) and the ground cell that would sit next to it in world space are not neighbours.
    const edge = sim.grid.get('r1', 7, 2)!;
    expect(sim.grid.neighbors(edge).some((n) => n.roofId === GROUND)).toBe(false);
  });

  it('the endless ground exists but is not playable until the park arrives', () => {
    const sim = new Sim(createInitialState(4));
    expect(sim.grid.layer(GROUND)!.kind).toBe('ground');
    expect(sim.grid.isPlayable(GROUND)).toBe(false);
    expect(sim.restoration.checkPulse(sim.grid.get(GROUND, 3, 3)!).ok).toBe(false);
  });
});
