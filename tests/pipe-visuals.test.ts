import { describe, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { levelY, rampAt } from '../src/core/Height';
import { OLD_CITY } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { PIPE_SIZE, PipeVisuals, pipeHeight, pipeSurface } from '../src/rendering/PipeVisuals';

/**
 * Points along the middle of a ramp, from its foot to its top, every 1 cm. The flight's tiles and the ground at both
 * ends are generated first (as when their chunk loads in the game: the heights read loaded tiles).
 */
function along(sim: Sim, x: number, z: number) {
  const { ramp } = rampAt(x, z)!;
  for (let cz = ramp.z - 1; cz <= ramp.z + ramp.d; cz++) for (let cx = ramp.x - 1; cx <= ramp.x + ramp.w; cx++) expect(sim.grid.get(GROUND, cx, cz)).toBeDefined();
  const alongZ = ramp.dir === 'n' || ramp.dir === 's';
  const len = alongZ ? ramp.d : ramp.w;
  const mid = alongZ ? ramp.x + ramp.w / 2 : ramp.z + ramp.d / 2;
  const start = alongZ ? ramp.z : ramp.x;
  const pts: [number, number][] = [];
  for (let s = 0.005; s < len; s += 0.01) {
    const c = start + s;
    pts.push(alongZ ? [mid, c] : [c, mid]);
  }
  return { ramp, pts };
}

describe('E23.4.2: a pipe down a stair runs as one straight slope', () => {
  const sim = new Sim(createInitialState(7));
  // the park's stairs to the beach, and Mast Row's flight down from its terrace (the one in docs/review/pipes)
  const flights: [number, number][] = [[7, 14], [27, -21]];

  it('clears every tread (its nosing too) by at least the flat gap, all the way down', () => {
    for (const [x, z] of flights) {
      const { pts } = along(sim, x, z);
      expect(pts.length).toBeGreaterThan(50);
      for (const [px, pz] of pts) {
        const gap = pipeHeight(sim, px, pz) - PIPE_SIZE.r - pipeSurface(sim, px, pz);
        expect(gap, `${px.toFixed(2)},${pz.toFixed(2)}`).toBeGreaterThanOrEqual(PIPE_SIZE.clear - 1e-6);
      }
    }
  });

  it('has no steps of its own on the flight: it climbs smoothly, never faster than the stair, never back down', () => {
    for (const [x, z] of flights) {
      const { ramp, pts } = along(sim, x, z);
      const alongZ = ramp.dir === 'n' || ramp.dir === 's';
      const len = alongZ ? ramp.d : ramp.w;
      const pitch = (Math.abs(levelY(ramp.to) - levelY(ramp.from)) / len) * 1.0001; // height per tile along the flight
      const ys = pts.map(([px, pz]) => pipeHeight(sim, px, pz));
      const rising = ys[ys.length - 1] > ys[0];
      for (let i = 1; i < ys.length; i++) {
        const dy = ys[i] - ys[i - 1];
        expect(Math.abs(dy), `step at ${i}`).toBeLessThanOrEqual(pitch * 0.01 + 1e-6); // no riser inside the flight
        expect(rising ? dy : -dy).toBeGreaterThanOrEqual(-1e-9); // one way only
      }
      // and the treads under it do step (this is a real stair, not a ramp drawn smooth)
      const ground = pts.map(([px, pz]) => pipeSurface(sim, px, pz));
      expect(ground.some((g, i) => i > 0 && Math.abs(g - ground[i - 1]) > 0.02)).toBe(true);
      expect(OLD_CITY.levelHeight).toBeGreaterThan(0);
    }
  });

  it('tiles on a flight meet level at their edges: no drop, so no collars, between them', () => {
    for (const [x, z] of flights) {
      const { ramp } = along(sim, x, z);
      const alongZ = ramp.dir === 'n' || ramp.dir === 's';
      const mid = alongZ ? ramp.x + ramp.w / 2 : ramp.z + ramp.d / 2;
      const start = alongZ ? ramp.z : ramp.x;
      const len = alongZ ? ramp.d : ramp.w;
      for (let c = start + 1; c < start + len; c++) {
        const a = alongZ ? pipeHeight(sim, mid, c - 1e-4) : pipeHeight(sim, c - 1e-4, mid);
        const b = alongZ ? pipeHeight(sim, mid, c + 1e-4) : pipeHeight(sim, c + 1e-4, mid);
        expect(Math.abs(a - b), `edge at ${c}`).toBeLessThan(1e-3); // (PipeVisuals draws a drop only beyond 1 mm)
      }
    }
  });

  it('meets the ground at the top of the flight with no drop, and at the foot with one short one', () => {
    for (const [x, z] of flights) {
      const { ramp } = along(sim, x, z);
      const alongZ = ramp.dir === 'n' || ramp.dir === 's';
      const mid = alongZ ? ramp.x + ramp.w / 2 : ramp.z + ramp.d / 2;
      // the cells just beyond each end of the flight
      const startEdge = alongZ ? ramp.z : ramp.x;
      const endEdge = startEdge + (alongZ ? ramp.d : ramp.w);
      const at = (c: number): [number, number] => (alongZ ? [mid, c] : [c, mid]);
      // the ground at both ends exists (as it does once its chunk loads in the game)
      for (const c of [startEdge - 0.01, endEdge + 0.01]) expect(sim.grid.get(GROUND, Math.floor(at(c)[0]), Math.floor(at(c)[1]))).toBeDefined();
      const fromSide = pipeHeight(sim, ...at(startEdge - 0.01));
      const fromEnd = pipeHeight(sim, ...at(startEdge + 0.01));
      const toEnd = pipeHeight(sim, ...at(endEdge - 0.01));
      const toSide = pipeHeight(sim, ...at(endEdge + 0.01));
      const [top, topRamp, foot, footRamp] = ramp.to > ramp.from ? [toSide, toEnd, fromSide, fromEnd] : [fromSide, fromEnd, toSide, toEnd];
      expect(Math.abs(topRamp - top)).toBeLessThan(1e-6); // levels off into the ground above: no drop at the top
      const drop = footRamp - foot;
      expect(drop).toBeGreaterThanOrEqual(0); // at the foot, just over the first tread…
      expect(drop).toBeLessThan(0.25); // …a short drop to the ground below, not a wall
    }
  });

  it("draws the line down Mast Row's flight with one drop, at its foot, and no sight glass on the slope", () => {
    const s2 = new Sim(createInitialState(7));
    s2.state.salvage!.keepers.sluice = { step: 'request1' }; // Cistern Basin's Keeper awake: pipes are handed over
    s2.state.salvage!.pack = { pipe: 20 };
    s2.areas.clear('mastRow', true);
    along(s2, 27, -21);
    for (let z = -24; z <= -18; z++) {
      const t = s2.grid.get(GROUND, 27, z)!;
      if (t.blocked || t.occupantId) Object.assign(t, { blocked: false, occupantId: undefined, feature: undefined });
      expect(s2.water.pipes.lay(GROUND, 27, z), `27,${z}: ${s2.water.pipes.layProblem(GROUND, 27, z)}`).toBe(true);
    }
    const canvas = { width: 1, height: 1, getContext: () => null, addEventListener() {}, removeEventListener() {}, style: {} };
    const device = new pc.NullGraphicsDevice(canvas as unknown as HTMLCanvasElement);
    const app = new pc.AppBase(canvas as unknown as HTMLCanvasElement);
    const opts = new pc.AppOptions();
    opts.graphicsDevice = device;
    opts.componentSystems = [pc.RenderComponentSystem];
    app.init(opts);
    const root = new pc.Entity('root', app);
    app.root.addChild(root);
    const drops = vi.spyOn(PipeVisuals.prototype as unknown as { riser: (...a: number[]) => void }, 'riser');
    const glass = vi.spyOn(PipeVisuals.prototype as unknown as { sloped: (x: number, z: number) => boolean }, 'sloped');
    const v = new PipeVisuals(s2, root, device);
    v.update(1);
    // one drop: off the flight's foot (z -20 → -19) to the street; none between the flight's own tiles
    expect(drops).toHaveBeenCalledTimes(1);
    const [, , px, pz] = drops.mock.calls[0];
    expect([px, pz]).toEqual([27.5, -19]);
    // the three tiles on the flight carry no sight glass; the four on flat ground do
    const onSlope = glass.mock.results.filter((r) => r.value === true).length;
    expect(onSlope).toBe(3);
    expect(root.findByName('pipe-glass')).toBeTruthy();
    drops.mockRestore();
    glass.mockRestore();
    v.destroy();
    app.destroy();
  });
});
