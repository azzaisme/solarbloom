import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { canStep, heightAt, levelAt, rampAt } from '../src/core/Height';
import { pickTerraced } from '../src/core/Picking';
import { KEEPERS, PARK_SET, REGIONS } from '../src/data/oldcity';
import { Sim } from '../src/gameplay/Sim';
import { spawnPose, Walker } from '../src/gameplay/Walker';

const oldSim = (seed = 7) => new Sim(createInitialState(seed, 'oldcity'));
const MAST = REGIONS[0];

/** An Old City with Mast Row open (its gate pried), so bloombot can walk there. */
function openMastRow(sim: Sim) {
  sim.state.areas.mastRow = { fog: 'thinning', revealedAt: 0 };
  for (const [x, z] of MAST.gate.cells) {
    const t = sim.grid.get(GROUND, x, z)!;
    t.blocked = false;
    t.unblocked = true;
  }
}

describe('E21.24: terraces', () => {
  it('levels are the same for every seed, and classic ground has none', () => {
    const a = oldSim(1);
    const b = oldSim(99);
    for (let z = -32; z < 32; z += 2) for (let x = -16; x < 32; x += 2) expect(a.grid.get(GROUND, x, z)!.level).toBe(b.grid.get(GROUND, x, z)!.level);
    const classic = new Sim(createInitialState(1));
    expect(classic.grid.get(GROUND, 3, 3)!.level).toBeUndefined();
    expect(classic.grid.terraced(GROUND)).toBe(false);
  });

  it('the park is a low rise with steps down to the beach; Mast Row has its embankment', () => {
    expect(levelAt(8, 8)).toBe(1);
    expect(levelAt(8, 20)).toBe(0); // the beach
    expect(levelAt(0, 60)).toBe(0); // the sea
    expect(levelAt(26, -28)).toBe(2); // the tram embankment
    expect(rampAt(7, 14)?.ramp.kind).toBe('stair');
    // the stairs join the park to the beach; the rest of the park's south edge is a cliff
    expect(canStep(7, 13, 7, 14)).toBe(true);
    expect(canStep(7, 14, 7, 15)).toBe(true);
    expect(canStep(7, 15, 7, 16)).toBe(true);
    expect(canStep(3, 15, 3, 16)).toBe(false);
    expect(canStep(7, 14, 5, 14)).toBe(false); // not a neighbour
    expect(canStep(6, 14, 5, 14)).toBe(false); // off the side of the stair
    expect(heightAt(7.5, 14.0)).toBeCloseTo(1, 5);
    expect(heightAt(7.5, 16.0)).toBeCloseTo(0, 5);
  });

  it('no walkable step crosses a cliff', () => {
    for (let z = -33; z < 18; z++)
      for (let x = -2; x < 33; x++)
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const ra = rampAt(x, z);
          const rb = rampAt(x + dx, z + dz);
          if (ra || rb) continue;
          if (levelAt(x, z) !== levelAt(x + dx, z + dz)) expect(canStep(x, z, x + dx, z + dz), `${x},${z}`).toBe(false);
          else expect(canStep(x, z, x + dx, z + dz)).toBe(true);
        }
  });

  it('every pile, the Keeper, the seam, the caches, the pages and the landmark of the park and Mast Row can be reached on foot', () => {
    const sim = oldSim();
    openMastRow(sim);
    const w = new Walker(sim);
    const start = spawnPose(sim, w);
    const keeper = KEEPERS.find((k) => k.id === 'pylon')!;
    const targets: [string, number, number, number][] = [
      ...PARK_SET.piles.map((p) => [p.id, p.x, p.z, 1] as [string, number, number, number]),
      ...MAST.piles.map((p) => [p.id, p.x, p.z, 1] as [string, number, number, number]),
      ['pylon', keeper.x, keeper.z, 1],
      ['seam', MAST.seam.x, MAST.seam.z, 2],
      ['mast', MAST.landmark.x, MAST.landmark.z, 2],
      ...MAST.caches.map((c) => [c.id, c.x, c.z, 1] as [string, number, number, number]),
      ...MAST.pages.map((c) => [c.id, c.x, c.z, 1] as [string, number, number, number]),
      [MAST.lookout.id, MAST.lookout.x, MAST.lookout.z, 1],
      ['tram stop', MAST.patch.x, MAST.patch.z, 1],
    ];
    for (const [id, x, z, size] of targets) {
      const touching = (cx: number, cz: number) => cx >= x - 1 && cx <= x + size && cz >= z - 1 && cz <= z + size && !(cx >= x && cx < x + size && cz >= z && cz < z + size);
      const onto = (cx: number, cz: number) => cx >= x && cx < x + size && cz >= z && cz < z + size;
      const path = w.path(GROUND, start.x, start.z, (cx, cz) => touching(cx, cz) || (onto(cx, cz) && w.walkable(GROUND, cx, cz)), { x, z });
      expect(path, id).toBeDefined();
    }
  });

  it('walking stops at a cliff edge and follows a ramp up', () => {
    const sim = oldSim();
    openMastRow(sim);
    const w = new Walker(sim);
    // walk east along z = -27 at level 1 into the embankment's west wall (x = 25 is level 2): stopped
    const p = { roofId: GROUND, x: 23.5, z: -26.5, facing: 0 };
    for (let i = 0; i < 40; i++) w.move(p, 0.1, 0);
    expect(p.x).toBeLessThan(25);
    // from the foot of the ramp (z = -19, level 1) north up it onto the embankment
    const q = { roofId: GROUND, x: 26.5, z: -18.5, facing: 0 };
    for (let i = 0; i < 80; i++) w.move(q, 0, -0.1);
    expect(q.z).toBeLessThan(-23);
    expect(heightAt(q.x, q.z)).toBe(2);
  });

  it('bloombot is never left inside a cliff or on a ramp\'s side after a reload', () => {
    const sim = oldSim();
    openMastRow(sim);
    const w = new Walker(sim);
    for (const [x, z] of [[26.5, -21.5], [7.5, 14.5], [6.5, 15.2], [24.9, -27.5]]) {
      const p = { roofId: GROUND, x, z, facing: 0 };
      expect(w.settle(p)).toBe(true);
      expect(w.fits(GROUND, p.x, p.z)).toBe(true);
    }
  });

  it('nothing can be built across two levels or on a ramp', () => {
    const sim = oldSim();
    openMastRow(sim);
    sim.state.salvage!.tier = 4;
    for (const [x, z] of [[24, -27], [26, -21], [7, 14]]) {
      for (let dz = 0; dz < 2; dz++)
        for (let dx = 0; dx < 2; dx++) {
          const t = sim.grid.get(GROUND, x + dx, z + dz)!;
          t.ground = 'restored';
          t.blocked = false;
        }
      expect(sim.build.footprintProblem(GROUND, x, z, 2, ['restored']), `${x},${z}`).toBe('Needs level ground');
    }
    expect(sim.build.footprintProblem(GROUND, 14, 3, 1, ['restored', 'polluted'])).toBeUndefined();
  });

  it('picking finds the first terrace the ray meets, on slopes too', () => {
    const h = (x: number, z: number) => heightAt(x, z);
    const down = { x: 0, y: -1, z: 0 };
    // straight down onto the embankment (level 2) and beside it (level 1)
    const top = pickTerraced({ x: 26.5, y: 20, z: -27.5 }, down, 0.08, h)!;
    expect([top.fx, top.fz].map((v) => Math.round(v * 100) / 100)).toEqual([26.5, -27.5]);
    expect(Math.floor(pickTerraced({ x: 23.5, y: 20, z: -27.5 }, down, 0.08, h)!.fx)).toBe(23);
    // a slanted ray that would reach the low street behind the embankment hits the embankment's wall top first
    const slant = pickTerraced({ x: 20.5, y: 10, z: -27.5 }, { x: 0.5, y: -0.6, z: 0 }, 0.08, h)!;
    expect(levelAt(Math.floor(slant.fx), -28)).toBe(2);
    // on the ramp: straight down at a quarter of the way up lands on that ramp cell
    const ramp = pickTerraced({ x: 26.5, y: 20, z: -20.3 }, down, 0.08, h)!;
    expect(Math.floor(ramp.fz)).toBe(-21);
    // a slanted ray down the park's stairs lands on a stair cell, not on the beach beyond
    const stairs = pickTerraced({ x: 7.5, y: 6, z: 9 }, { x: 0, y: -0.75, z: 0.66 }, 0.08, h)!;
    expect(rampAt(Math.floor(stairs.fx), Math.floor(stairs.fz)) || levelAt(Math.floor(stairs.fx), Math.floor(stairs.fz)) === 1).toBeTruthy();
  });


  it('the Elder Tree on its hill, the Old Cistern on its island and the observatory on its summit are reached on foot', () => {
    const sim = oldSim();
    for (const id of ['elderGrove', 'cistern', 'observatory']) sim.state.areas[id] = { fog: 'thinning', revealedAt: 0 };
    const w = new Walker(sim);
    expect(levelAt(-20, -4)).toBe(2);
    expect(levelAt(56, 48)).toBe(1);
    expect(levelAt(40, 40)).toBe(0);
    expect(levelAt(60, -66)).toBe(4);
    for (const id of ['elderGrove', 'cistern', 'observatory']) {
      const r = REGIONS.find((q) => q.id === id)!;
      const k = KEEPERS.find((q) => q.region === id)!;
      const from = { x: k.x + 0.5, z: k.z + 1.5 };
      expect(w.walkable(GROUND, Math.floor(from.x), Math.floor(from.z)), id).toBe(true);
      const path = w.path(GROUND, from.x, from.z, (x, z) => Math.abs(x - r.landmark.x - 0.5) <= 1.5 && Math.abs(z - r.landmark.z - 0.5) <= 1.5 && !(x >= r.landmark.x && x <= r.landmark.x + 1 && z >= r.landmark.z && z <= r.landmark.z + 1), { x: r.landmark.x, z: r.landmark.z });
      expect(path, id).toBeDefined();
      // and its lookout stands on a terrace's edge
      const lo = r.lookout;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => levelAt(lo.x + dx, lo.z + dz) < levelAt(lo.x, lo.z));
      expect(edge, `${id} lookout`).toBe(true);
    }
  });

  it('a lookout is a set piece: a bench and a telescope that blocks its tile', () => {
    const sim = oldSim();
    sim.state.areas.mastRow = { fog: 'thinning', revealedAt: 0 };
    const lo = MAST.lookout;
    const t = sim.grid.get(GROUND, lo.x, lo.z)!;
    expect(t.blocked).toBe(true);
    expect(t.prop).toBe(`lookout:${lo.id}`);
    expect(sim.salvage.describe(t)?.title).toBe('A lookout');
    expect(sim.salvage.see(`lookout:${lo.id}`)).toBe(true);
    expect(sim.salvage.see(`lookout:${lo.id}`)).toBe(false);
  });
});
