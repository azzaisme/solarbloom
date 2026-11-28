import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import type { GameState, TileData } from '../src/core/types';
import { LAID_NAME } from '../src/gameplay/LaidPaths';
import { Sim } from '../src/gameplay/Sim';
import { treeSpot, treeWorldOf } from '../src/rendering/TreePlacement';
import { bannedIn } from '../src/ui/words';
import { PAD, makeSim } from './helpers';

/** The park, cleared; and its open lawn squares (nothing on them, not a pond, not a slope). */
function park() {
  const sim = new Sim(createInitialState(7));
  sim.areas.clear(PARK, true);
  const lawn = sim.areas.tiles(PARK).filter((t) => !sim.paths.layProblem('footpath', GROUND, t.x, t.z));
  return { sim, lawn };
}
const feature = (t: TileData) => t.feature ?? 'lawn';

/** Footpaths and roads Bloombot lays in build mode (gameplay/LaidPaths). */
describe('laid footpaths and roads', () => {
  it('a footpath turns open ground to paving, a road to road, and both are free', () => {
    const { sim, lawn } = park();
    expect(lawn.length).toBeGreaterThan(10);
    const [a, b] = lawn;
    const pack = JSON.stringify(sim.state.salvage!.pack);
    expect(sim.paths.lay('footpath', GROUND, a.x, a.z)).toBe(true);
    expect(sim.paths.lay('road', GROUND, b.x, b.z)).toBe(true);
    expect([a.feature, a.laid, b.feature, b.laid]).toEqual(['paving', 'footpath', 'road', 'road']);
    expect([sim.paths.kindAt(a.x, a.z), sim.paths.kindAt(b.x, b.z)]).toEqual(['footpath', 'road']);
    expect([sim.paths.count(), sim.paths.count('road')]).toEqual([2, 1]);
    expect(JSON.stringify(sim.state.salvage!.pack)).toBe(pack);
  });

  it('laying the other kind over a laid square swaps it; the same kind again is refused', () => {
    const { sim, lawn } = park();
    const t = lawn[0];
    sim.paths.lay('footpath', GROUND, t.x, t.z);
    expect(sim.paths.layProblem('footpath', GROUND, t.x, t.z)).toBe('A footpath is already here');
    expect(sim.paths.lay('road', GROUND, t.x, t.z)).toBe(true);
    expect([t.feature, sim.paths.count('footpath'), sim.paths.count('road')]).toEqual(['road', 0, 1]);
    expect(sim.state.laid).toEqual({ road: [`${t.x},${t.z}`] });
  });

  it('lifting gives back the ground the seed made, and an empty list leaves the save', () => {
    const { sim, lawn } = park();
    const t = lawn[3];
    const was = feature(t);
    sim.paths.lay('road', GROUND, t.x, t.z);
    expect(sim.paths.lift(t.x, t.z)).toBe(true);
    expect([feature(t), t.laid]).toEqual([was, undefined]);
    expect(sim.state.laid).toBeUndefined();
    expect(sim.paths.lift(t.x, t.z)).toBe(false);
  });

  it('says why it cannot go somewhere, in plain words', () => {
    const { sim, lawn } = park();
    const tiles = sim.areas.tiles(PARK);
    const water = tiles.find((t) => t.feature === 'water')!;
    const paved = tiles.find((t) => (t.feature === 'paving' || t.feature === 'road') && !t.blocked)!;
    const blocked = tiles.find((t) => t.blocked && t.feature !== 'water' && t.feature !== 'paving' && t.feature !== 'road')!;
    const why = (t: TileData) => sim.paths.layProblem('road', GROUND, t.x, t.z);
    expect(why(water)).toBe('Not in the water');
    expect(why(paved)).toBe('This ground is already paved');
    expect(why(blocked)).toBe('Something is in the way');
    const busy = lawn[5];
    busy.occupantId = 'm1';
    expect(why(busy)).toBe('Something stands here');
    busy.occupantId = undefined;
    // roofs and rooms keep their floors
    const roof = makeSim();
    expect(roof.paths.layProblem('footpath', PAD, 4, 4)).toBe('A footpath goes on the ground');
    const said = [why(water), why(paved), why(blocked), 'Something stands here', 'A footpath goes on the ground', 'Not on steps or a slope', 'That’s a Keeper’s pond', 'Not under the fog', ...Object.values(LAID_NAME)];
    for (const s of said) expect(bannedIn(s!), s).toEqual([]);
    // a refused lay changes nothing and tells the player
    let heard = '';
    sim.bus.on('action.failed', (e) => (heard = e.reason));
    expect(sim.paths.lay('road', GROUND, water.x, water.z)).toBe(false);
    expect(heard).toBe('Not in the water');
    expect(sim.paths.count()).toBe(0);
  });

  it('is saved, and a loaded game has its paths back on the ground', () => {
    const { sim, lawn } = park();
    const [a, b, c] = lawn;
    sim.paths.lay('footpath', GROUND, b.x, b.z);
    sim.paths.lay('footpath', GROUND, a.x, a.z);
    sim.paths.lay('road', GROUND, c.x, c.z);
    const saved = JSON.parse(JSON.stringify(sim.state)) as GameState;
    expect(saved.laid!.footpath).toEqual([`${a.x},${a.z}`, `${b.x},${b.z}`].sort());
    const back = new Sim(saved);
    expect(back.paths.count()).toBe(3);
    expect(back.grid.get(GROUND, a.x, a.z)!.feature).toBe('paving');
    expect(back.grid.get(GROUND, c.x, c.z)!.laid).toBe('road');
    // lifted after loading: still the seed's ground
    back.paths.lift(c.x, c.z);
    expect(feature(back.grid.get(GROUND, c.x, c.z)!)).toBe(feature(new Sim(createInitialState(7)).grid.get(GROUND, c.x, c.z)!));
  });

  it('no tree grows through a laid square, and one may again once it is lifted', () => {
    const { sim } = park();
    const w = treeWorldOf(sim);
    const t = sim.areas.tiles(PARK).find((q) => treeSpot(q, 'park', w) && !sim.paths.layProblem('footpath', GROUND, q.x, q.z));
    if (!t) return; // (every tree spot in this park is taken by something else)
    sim.paths.lay('footpath', GROUND, t.x, t.z);
    expect(treeSpot(t, 'park', w)).toBeUndefined();
    sim.paths.lift(t.x, t.z);
    expect(treeSpot(t, 'park', w)).toBeDefined();
  });

  it('grass turns paving into lawn (a market floor, a plaza), and lifting it brings the paving back', () => {
    const { sim, lawn } = park();
    const tiles = sim.areas.tiles(PARK);
    const paved = tiles.find((t) => t.feature === 'paving' && !t.blocked && !t.occupantId && !t.ramp)!;
    const why = (t: TileData) => sim.paths.layProblem('grass', GROUND, t.x, t.z);
    expect(why(paved)).toBeUndefined();
    expect(why(lawn[0])).toBe('Grass already grows here');
    const road = tiles.find((t) => t.feature === 'road' && !t.blocked);
    if (road) expect(why(road)).toBe('The city’s roads stay');
    expect(sim.paths.lay('grass', GROUND, paved.x, paved.z)).toBe(true);
    expect([paved.feature, paved.laid]).toEqual(['lawn', 'grass']);
    expect(sim.paths.onPath(paved.x + 0.5, paved.z + 0.5)).toBe(false); // grass is no path to sprint along
    // it is lawn like any other: a dead square can be pulsed green
    paved.ground = 'polluted';
    expect(sim.restoration.isEligible(paved)).toBe(true);
    // a path over it, or grass over a laid path: lift first
    expect(sim.paths.layProblem('footpath', GROUND, paved.x, paved.z)).toBe('Lift the grass first');
    sim.paths.lay('footpath', GROUND, lawn[0].x, lawn[0].z);
    expect(why(lawn[0])).toBe('Lift the footpath first');
    // saved and loaded
    const back = new Sim(JSON.parse(JSON.stringify(sim.state)) as GameState);
    expect(back.state.laid!.grass).toEqual([`${paved.x},${paved.z}`]);
    expect(back.grid.get(GROUND, paved.x, paved.z)!.feature).toBe('lawn');
    expect(sim.paths.lift(paved.x, paved.z)).toBe(true);
    expect([paved.feature, paved.laid]).toEqual(['paving', undefined]);
    for (const s of ['Grass already grows here', 'The city’s roads stay', 'Not on the jetty', 'Lift the grass first', 'Grass goes on the ground', 'Grass is already here']) expect(bannedIn(s), s).toEqual([]);
  });

  it('knows when Bloombot stands on one (sprinting there costs less charge)', () => {
    const { sim, lawn } = park();
    const t = lawn[0];
    expect(sim.paths.onPath(t.x + 0.5, t.z + 0.5)).toBe(false);
    sim.paths.lay('footpath', GROUND, t.x, t.z);
    expect(sim.paths.onPath(t.x + 0.2, t.z + 0.9)).toBe(true);
    expect(sim.paths.onPath(t.x + 1.2, t.z + 0.9)).toBe(sim.paths.kindAt(t.x + 1, t.z) !== undefined);
  });
});
