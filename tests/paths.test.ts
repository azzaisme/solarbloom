import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { rasterCurve } from '../src/core/RoadRaster';
import { ITEM_DEFS } from '../src/data/items';
import { REGIONS } from '../src/data/oldcity';
import { PATH_MATERIALS, PATHS } from '../src/data/paths';
import { PROJECTS } from '../src/data/research';
import { pathCurve } from '../src/gameplay/Paths';
import { Sim } from '../src/gameplay/Sim';

const NEAR = { roofId: GROUND, x: 8.5, z: 11.5 };
const CACHES = new Set(REGIONS.flatMap((r) => r.caches.map((c) => c.id)));

/** A park with open, restored ground from (6, 8) to (22, 24), and plenty of Scrap. */
function park() {
  const sim = new Sim(createInitialState(7, 'oldcity'));
  sim.state.salvage!.tier = 1;
  sim.bot = NEAR;
  for (let x = 4; x < 26; x++)
    for (let z = 6; z < 26; z++) {
      const t = sim.grid.get(GROUND, x, z);
      if (!t || t.occupantId) continue; // the fountain and the starter lamp stay (the store is reached through them)
      t.blocked = false;
      t.ground = 'restored';
      t.pollution = 0;
      if (t.feature === 'water') t.feature = 'lawn';
      sim.grid.touch(t);
    }
  sim.inventory.addToStore('scrap', 400);
  sim.inventory.addToStore('timber', 100);
  return sim;
}

describe('E23.6.7: paths', () => {
  it('the starting materials, each with a real cost and unlocked somewhere reachable', () => {
    expect(PATH_MATERIALS.map((m) => m.id).sort()).toEqual(['boardwalk', 'gravel', 'mossyCobbles', 'oldBrick', 'sandTrail', 'steppingStones', 'woodChip']);
    for (const m of PATH_MATERIALS) {
      for (const k of Object.keys(m.perTile)) expect(k in ITEM_DEFS, `${m.id}: ${k}`).toBe(true);
      const u = m.unlock;
      if ('research' in u) expect(PROJECTS.find((p) => p.id === u.research)?.gives, m.id).toEqual({ recipe: m.id });
      else if ('find' in u) expect(CACHES.has(u.find), m.id).toBe(true);
    }
    expect(PATH_MATERIALS.find((m) => m.id === 'boardwalk')!.overWater).toBe(true);
  });

  it('a path follows a smooth curve through its points, and its tiles come from RoadRaster', () => {
    const c = pathCurve([[8.5, 10.5], [12.5, 14.5], [16.5, 10.5]]);
    expect(c[0]).toEqual([8.5, 10.5]);
    expect(c[c.length - 1]).toEqual([16.5, 10.5]);
    // it passes through the middle point, and bends smoothly (no corner: neighbouring headings stay close)
    expect(c.some(([x, z]) => Math.hypot(x - 12.5, z - 14.5) < 1e-6)).toBe(true);
    let worst = 0;
    for (let i = 2; i < c.length; i++) {
      const a = Math.atan2(c[i - 1][1] - c[i - 2][1], c[i - 1][0] - c[i - 2][0]);
      const b = Math.atan2(c[i][1] - c[i - 1][1], c[i][0] - c[i - 1][0]);
      worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))));
    }
    expect(worst).toBeLessThan(0.6);
    const narrow = rasterCurve(c, PATHS.widths[0]);
    const wide = rasterCurve(c, PATHS.widths[3]);
    expect(narrow.has('12,14')).toBe(true);
    expect(wide.size).toBeGreaterThan(narrow.size * 2);
  });

  it('a path is laid for its materials, reshaped, widened, repaved and removed with everything back', () => {
    const sim = park();
    const before = sim.inventory.stored('scrap');
    const { id, why } = sim.paths.add([[8.5, 10.5], [12.5, 14.5], [16.5, 10.5]], 0, 'gravel');
    expect(why).toBeUndefined();
    const p = sim.paths.get(id!)!;
    const tiles = sim.paths.tiles(p).size;
    expect(sim.inventory.stored('scrap')).toBe(before - tiles);
    expect(sim.paths.onPath(12.5, 14.5)).toBe(true);
    // reshape: move the middle point
    expect(sim.paths.change(id!, { pts: [[8.5, 10.5], [12.5, 18.5], [16.5, 10.5]] })).toBeUndefined();
    expect(sim.paths.onPath(12.5, 18.5)).toBe(true);
    expect(sim.paths.onPath(12.5, 14.5)).toBe(false);
    // add and take away a point
    const at = sim.paths.insertAt(sim.paths.get(id!)!, 10.5, 14);
    const pts = [...sim.paths.get(id!)!.pts];
    pts.splice(at, 0, [10.5, 13.5]);
    expect(sim.paths.change(id!, { pts })).toBeUndefined();
    expect(sim.paths.get(id!)!.pts.length).toBe(4);
    expect(sim.paths.change(id!, { pts: pts.filter((_, i) => i !== at) })).toBeUndefined();
    // widen, then repave (wood chip comes from Tide)
    expect(sim.paths.change(id!, { w: 3 })).toBeUndefined();
    expect(sim.paths.change(id!, { mat: 'woodChip' })).toBe('Wood chip is not known yet');
    sim.state.salvage!.keepers.tide = { step: 'request1' };
    expect(sim.paths.change(id!, { mat: 'woodChip' })).toBeUndefined();
    // removing gives everything back
    expect(sim.paths.remove(id!)).toBe(true);
    expect(sim.inventory.stored('scrap') + sim.inventory.count('scrap')).toBe(before);
    expect(sim.inventory.stored('timber') + sim.inventory.count('timber')).toBe(100);
    expect(sim.paths.all()).toEqual([]);
  });

  it('nothing is built on a path, and a path goes round what is built', () => {
    const sim = park();
    const { id } = sim.paths.add([[8.5, 12.5], [18.5, 12.5]], 1, 'gravel');
    expect(sim.build.footprintProblem(GROUND, 12, 12, 1, ['restored'])).toBe('A path runs here');
    sim.paths.remove(id!);
    sim.state.salvage!.keepers.tide = { step: 'request1' };
    sim.inventory.addToStore('planks', 10);
    expect(sim.build.place('chest', GROUND, 12, 12)).toBeDefined();
    expect(sim.paths.add([[8.5, 12.5], [18.5, 12.5]], 1, 'gravel').why).toBe('Something is built here');
  });

  it('only a boardwalk crosses water', () => {
    const sim = park();
    const w = sim.grid.get(GROUND, 14, 16)!;
    w.feature = 'water';
    expect(sim.paths.add([[10.5, 16.5], [18.5, 16.5]], 0, 'gravel').why).toBe('Only a boardwalk crosses water');
    sim.state.salvage!.research = { analysed: [], done: ['dc-boardwalk'], running: [], levels: {} };
    sim.inventory.addToStore('planks', 40);
    expect(sim.paths.add([[10.5, 16.5], [18.5, 16.5]], 0, 'boardwalk').why).toBeUndefined();
  });

  it('depaving old road turns it back into ground that can be restored, and never back to dead', () => {
    const sim = park();
    // an old road in the park area: make one
    sim.state.resources.energy = sim.state.caps.energy;
    sim.state.resources.water = sim.state.caps.water;
    const road = sim.grid.get(GROUND, 10, 12)!;
    road.feature = 'road';
    road.ground = 'polluted';
    road.pollution = 80;
    const done = sim.grid.get(GROUND, 11, 12)!;
    done.feature = 'paving';
    done.ground = 'restored';
    expect(sim.paths.canDepave(sim.grid.get(GROUND, 12, 12))).toBe('Only old road and paving can be broken up');
    expect(sim.paths.depave(10, 12)).toBeUndefined();
    expect(sim.paths.depave(11, 12)).toBeUndefined();
    expect(road.feature).toBe('lawn');
    expect(road.ground).toBe('polluted'); // dead stays dead, ready for a pulse
    expect(done.ground).toBe('restored'); // restored paving becomes restored soil
    expect(sim.restoration.checkPulse(road)).toMatchObject({ ok: true });
    expect(sim.state.salvage!.depaved).toEqual(['10,12', '11,12']);
    // saved: a chunk loaded again loses its paving again
    const fresh = [{ ...road, feature: 'road' as const }];
    sim.paths.applyChunk(fresh);
    expect(fresh[0].feature).toBe('lawn');
  });

  it('an existing park path can be rerouted: depave a stretch and lay a new curve round it', () => {
    const sim = park();
    const old = [[10, 20], [11, 20], [12, 20], [13, 20]].map(([x, z]) => {
      const t = sim.grid.get(GROUND, x, z)!;
      t.feature = 'paving';
      return t;
    });
    for (const t of old) expect(sim.paths.depave(t.x, t.z)).toBeUndefined();
    const { why } = sim.paths.add([[9.5, 20.5], [11.5, 23.5], [14.5, 20.5]], 0, 'steppingStones');
    expect(why).toBeUndefined();
    expect(old.every((t) => t.feature === 'lawn')).toBe(true);
  });
});
