import { describe, expect, it } from 'vitest';
import * as pc from 'playcanvas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { levelY } from '../src/core/Height';
import { Sim } from '../src/gameplay/Sim';
import { PIPE_SIZE, PipeVisuals, pipeGlass, pipeHeight, pipePlan, pipeSurface, type PipeTile } from '../src/rendering/PipeVisuals';
import { WaterOverlay } from '../src/rendering/WaterOverlay';
import { allFlights, checkFlight } from './pipe-flights';
import { headlessApp } from './helpers';

/** Mast Row awake, with pipes to lay: its flight runs south down from its terrace, x 25–28, z −22…−20 (level 2 → 1). */
function mastRow() {
  const sim = new Sim(createInitialState(7));
  sim.state.salvage!.keepers.sluice = { step: 'request1' }; // Cistern Basin's Keeper awake: pipes are handed over
  sim.state.salvage!.pack = { pipe: 40 };
  sim.areas.clear('mastRow', true);
  for (let z = -26; z <= -16; z++) for (let x = 22; x <= 31; x++) sim.grid.get(GROUND, x, z);
  return sim;
}

/** Lays pipe on these tiles (clearing anything standing there first). */
function lay(sim: Sim, cells: [number, number][]) {
  for (const [x, z] of cells) {
    const t = sim.grid.get(GROUND, x, z)!;
    if (t.blocked || t.occupantId) Object.assign(t, { blocked: false, occupantId: undefined, feature: undefined });
    expect(sim.water.pipes.lay(GROUND, x, z), `${x},${z}: ${sim.water.pipes.layProblem(GROUND, x, z)}`).toBe(true);
  }
}

const column = (x: number, z0: number, z1: number): [number, number][] => Array.from({ length: z1 - z0 + 1 }, (_, i) => [x, z0 + i]);
const tileAt = (plan: PipeTile[], x: number, z: number) => plan.find((t) => t.x === x && t.z === z)!;
const isLevel = (pts: [number, number, number][]) => pts.every((p) => Math.abs(p[1] - pts[0][1]) < 1e-9);

describe('E23.4.2: a pipe up or down a stair or ramp runs as one straight slope', () => {
  it('on every flight in the world, every way it faces and either way up: clears every tread, no drops, two clean bends', () => {
    const sim = new Sim(createInitialState(7));
    const seen = new Map<string, Set<string>>();
    for (const ramp of allFlights()) {
      const way = checkFlight(sim, ramp);
      if (!seen.has(ramp.dir)) seen.set(ramp.dir, new Set());
      seen.get(ramp.dir)!.add(way);
    }
    // the world's flights face south, north and east (west: pipe-visuals-west, the causeway's ramps turned round)
    expect([...seen.keys()].sort()).toEqual(['e', 'n', 's']);
    expect([...seen.get('e')!].sort()).toEqual(['falling', 'rising']); // the causeway's ramps: down to its broken middle, and up again
    expect(seen.get('s')!.has('falling')).toBe(true);
    expect(seen.get('n')!.has('rising')).toBe(true);
    // stairs as well as ramps
    expect(allFlights().some((r) => r.kind === 'stair')).toBe(true);
  });

  it("down Mast Row's flight: no drop anywhere, every edge joined end to end, and sight glasses only where it runs level", () => {
    const sim = mastRow();
    lay(sim, column(27, -24, -18));
    const plan = pipePlan(sim);
    expect(plan.length).toBe(7);
    expect(plan.flatMap((t) => t.risers)).toEqual([]); // the foot too: it bends down to the street, it doesn't drop
    for (const t of plan)
      for (const h of t.halves) {
        // every half meets the next tile's run at the edge, carrying on along it (a mitred join)
        if (sim.water.pipes.has(t.x + h.dx, t.z + h.dz)) expect(h.after, `${t.x},${t.z} → ${h.dx},${h.dz}`).toBeDefined();
        // and the tiles between the ends run straight through their middles, each half mitred to the other
        if (t.z > -24 && t.z < -18) expect(t.straight && !!h.before, `${t.x},${t.z}: straight through`).toBe(true);
      }
    // sloped: the flight's three tiles, the bend past the foot (z −19's north half), never the terrace above it
    const sloped = plan.flatMap((t) => t.halves.filter((h) => h.sloped).map((h) => `${t.z}:${h.dz}`)).sort();
    expect(sloped).toEqual(['-19:-1', '-20:-1', '-20:1', '-21:-1', '-21:1', '-22:-1', '-22:1'].sort());
    // the glasses: on top of the pipe at each level tile's middle; none on the flight
    const glass = pipeGlass(sim, plan);
    expect(glass.map((g) => g.z - 0.5).sort((a, b) => a - b)).toEqual([-24, -23, -19, -18]);
    for (const g of glass) {
      expect(g.x).toBe(27.5);
      const centre = pipeHeight(sim, g.x, g.z);
      expect(g.y).toBeCloseTo(centre + PIPE_SIZE.r * 0.85 + 0.01, 9); // sitting on the pipe's top
      expect(g.y - centre).toBeLessThan(PIPE_SIZE.r + 0.05); // not floating above it
    }
  });

  it('turns on a tile of the flight: the run across it is level, and meets the slope at the middle with a joint, no upright', () => {
    const sim = mastRow();
    lay(sim, [...column(27, -24, -21), [26, -21], [25, -21]]);
    const plan = pipePlan(sim);
    const turn = tileAt(plan, 27, -21);
    expect(turn.straight).toBe(false); // a joint drum in its middle
    const north = turn.halves.find((h) => h.dz === -1)!;
    const west = turn.halves.find((h) => h.dx === -1)!;
    expect(north.sloped).toBe(true);
    expect(isLevel(west.pts)).toBe(true); // across the flight: level
    expect(Math.abs(north.pts[0][1] - west.pts[0][1])).toBeLessThan(1e-9); // one height in the middle: no upright
    // across the flight it stays level to the ramp's edge, meeting each tile on its row level
    for (const x of [26, 25]) for (const h of tileAt(plan, x, -21).halves) expect(isLevel(h.pts), `${x},-21`).toBe(true);
    expect(plan.flatMap((t) => t.risers)).toEqual([]);
    // the turn's tile slopes at its middle: no glass; the tiles across the flight run level: a glass each, on the pipe
    const glass = pipeGlass(sim, plan);
    expect(glass.find((g) => g.x === 27.5 && g.z === -20.5)).toBeUndefined();
    for (const x of [25, 26]) {
      const g = glass.find((q) => q.x === x + 0.5 && q.z === -20.5)!;
      expect(g, `${x},-21`).toBeDefined();
      expect(g.y).toBeCloseTo(tileAt(plan, x, -21).halves[0].pts[0][1] + PIPE_SIZE.r * 0.85 + 0.01, 9);
    }
  });

  it('turns on the landing at the foot: the bend down off the flight, then level round the corner', () => {
    const sim = mastRow();
    lay(sim, [...column(27, -22, -19), [28, -19], [29, -19]]);
    const plan = pipePlan(sim);
    const landing = tileAt(plan, 27, -19);
    const up = landing.halves.find((h) => h.dz === -1)!;
    const east = landing.halves.find((h) => h.dx === 1)!;
    expect(up.sloped).toBe(true);
    expect(up.pts.length).toBe(3); // middle, the bend, the edge
    expect(Math.abs(up.pts[1][1] - up.pts[0][1])).toBeLessThan(1e-9); // level from the middle to the bend
    expect(Math.abs(up.pts[1][2] - -19)).toBeLessThan(0.45); // the bend under half a tile past the flight's foot (z -19)
    expect(isLevel(east.pts)).toBe(true);
    expect(Math.abs(up.pts[0][1] - east.pts[0][1])).toBeLessThan(1e-9);
    expect(landing.straight).toBe(false);
    expect(plan.flatMap((t) => t.risers)).toEqual([]);
    // the landing's middle is level: its glass sits there, on the pipe
    const g = pipeGlass(sim, plan).find((q) => q.x === 27.5 && q.z === -18.5)!;
    expect(g.y).toBeCloseTo(pipeSurface(sim, 27.5, -18.5) + PIPE_SIZE.clear + PIPE_SIZE.r + PIPE_SIZE.r * 0.85 + 0.01, 9);
  });

  it('on flat ground nothing changes: straight level runs at the flat gap, flanges, a glass on every tile, no bends', () => {
    const sim = mastRow();
    lay(sim, [[25, -25], [26, -25], [27, -25], [28, -25]]); // along Mast Row's terrace
    const plan = pipePlan(sim);
    for (const t of plan) {
      const ground = pipeSurface(sim, t.x + 0.5, t.z + 0.5);
      for (const h of t.halves) {
        expect(h.pts.length, `${t.x}: one straight stretch`).toBe(2);
        expect(isLevel(h.pts)).toBe(true);
        expect(h.sloped).toBe(false); // so it keeps its flange
        expect(h.pts[0][1]).toBeCloseTo(ground + PIPE_SIZE.clear + PIPE_SIZE.r, 9);
      }
    }
    expect(plan.flatMap((t) => t.risers)).toEqual([]);
    expect(pipeGlass(sim, plan).length).toBe(4);
  });

  it('a real step (no flight) still drops, with one upright drawn by the higher tile', () => {
    const sim = mastRow();
    // off the side of Mast Row's terrace (level 2, x 25 on) down its wall to the street (level 1, x 24)
    expect(sim.grid.get(GROUND, 24, -25)!.level).toBe(1);
    expect(sim.grid.get(GROUND, 25, -25)!.level).toBe(2);
    lay(sim, [[23, -25], [24, -25], [25, -25], [26, -25]]);
    const plan = pipePlan(sim);
    const risers = plan.flatMap((t) => t.risers.map((r) => ({ ...r, tile: [t.x, t.z] })));
    expect(risers.length).toBe(1);
    expect(risers[0].tile).toEqual([25, -25]);
    expect([risers[0].x, risers[0].z]).toEqual([25, -24.5]); // at the wall, between the two
    expect(risers[0].hi - risers[0].lo).toBeCloseTo(levelY(2) - levelY(1), 6);
    // the two runs either side stay level (no bend toward the wall: only a flight's foot bends)
    for (const t of plan) for (const h of t.halves) expect(isLevel(h.pts), `${t.x}`).toBe(true);
  });

  it('PipeVisuals draws the plan: the body, and one glass per level tile', () => {
    const sim = mastRow();
    lay(sim, column(27, -24, -18));
    const { device, root, destroy } = headlessApp();
    const v = new PipeVisuals(sim, root, device);
    v.update(1);
    const body = root.findByName('pipes') as pc.Entity;
    expect(body.render!.meshInstances.length).toBeGreaterThan(0);
    // a glass is a box of five faces (20 corners): as many as pipeGlass places
    const glass = root.findByName('pipe-glass') as pc.Entity;
    const corners = glass.render!.meshInstances.reduce((n, mi) => n + mi.mesh!.vertexBuffer!.numVertices, 0);
    expect(corners).toBe(20 * pipeGlass(sim).length);
    v.destroy();
    destroy();
  });

  it("the Water view's arrows lie along the pipe: tilted with it down the flight, level on flat ground", () => {
    const sim = mastRow();
    lay(sim, column(27, -24, -18));
    // water running down the line (south, +z), every tile
    const flow = new Map<string, [number, number][]>(column(27, -24, -18).map(([x, z]) => [`${x},${z}`, [[0, 1]]]));
    const arrows = WaterOverlay.arrows(sim, flow);
    expect(arrows.length).toBe(7);
    for (const [tip, l, r] of arrows) {
      const z = Math.floor(tip[2]);
      // inside the pipe, on its centre line, at every corner
      for (const p of [tip, l, r]) expect(Math.abs(p[1] - pipeHeight(sim, 27.5, p[2])), `${z}`).toBeLessThan(PIPE_SIZE.r * 0.2);
      // the chevron's back corners stand level across the pipe
      expect(l[1]).toBeCloseTo(r[1], 9);
      const drop = l[1] - tip[1]; // how far the tip lies below its back
      const pipeDrop = pipeHeight(sim, 27.5, l[2]) - pipeHeight(sim, 27.5, tip[2]);
      expect(drop).toBeCloseTo(pipeDrop, 9); // tilted exactly as the pipe is
      if (z >= -22 && z <= -20) expect(drop, `${z}: on the flight, pointing down it`).toBeGreaterThan(0.05);
      if (z <= -23 || z === -18) expect(drop, `${z}: flat ground`).toBe(0);
    }
  });
});
