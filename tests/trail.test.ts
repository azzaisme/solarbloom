import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { KEEPERS, REGIONS } from '../src/data/oldcity';
import { allPiles } from '../src/core/OldCityLayout';
import { WAYMARK } from '../src/data/waymark';
import { Sim } from '../src/gameplay/Sim';
import { trailDots, trailRoute, type TrailRoute } from '../src/gameplay/TrailRoute';
import { spawnPose, Walker, type BotPose } from '../src/gameplay/Walker';
import { leafFlight, randomLeafLaunch } from '../src/rendering/TrailLeaf';
import { pavingOverlayLift, RAISED_PAVING_LIFT, RESTORED_PATH_LIFT } from '../src/rendering/PavingSurface';
import { goalSpot, type GoalSpot } from '../src/ui/GoalSpot';
import { WORDS } from '../src/ui/words';

/**
 * #632: Show me where draws a trail along a way bloombot can really walk: round water, walls and rubble, to the goal
 * spot, or as close as it gets with a plain reason why it stops.
 */

const fresh = () => new Sim(createInitialState(7));
const at = (x: number, z: number, kind: GoalSpot['kind'] = 'spot'): GoalSpot => ({ roofId: GROUND, x: x + 0.5, z: z + 0.5, cell: { x, z }, kind, name: 'there' });

/** Every step of the way is onto a walkable cell next to the last one, without cutting a corner. */
function walkable(walker: Walker, r: TrailRoute) {
  const p = r.points;
  for (let i = 1; i < p.length; i++) {
    const ax = Math.floor(p[i - 1].x);
    const az = Math.floor(p[i - 1].z);
    const bx = Math.floor(p[i].x);
    const bz = Math.floor(p[i].z);
    expect(walker.walkable(r.roofId, bx, bz), `${bx},${bz}`).toBe(true);
    expect(Math.max(Math.abs(bx - ax), Math.abs(bz - az))).toBeLessThanOrEqual(1);
    if (bx !== ax && bz !== az) {
      expect(walker.walkable(r.roofId, bx, az)).toBe(true);
      expect(walker.walkable(r.roofId, ax, bz)).toBe(true);
    }
  }
}

/** Does the straight line between two points cross a cell bloombot can't stand on? */
function lineBlocked(walker: Walker, a: { x: number; z: number }, b: { x: number; z: number }) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) * 4);
  for (let i = 0; i <= n; i++) if (!walker.walkable(GROUND, Math.floor(a.x + ((b.x - a.x) * i) / n), Math.floor(a.z + ((b.z - a.z) * i) / n))) return true;
  return false;
}

const end = (r: TrailRoute) => r.points[r.points.length - 1];

describe('#632: the trail follows a walkable way', () => {
  it('a fresh game: from the jetty to the first salvage pile, every step on ground bloombot can walk', () => {
    const sim = fresh();
    const walker = new Walker(sim);
    const bot = spawnPose(sim, walker);
    const goal = goalSpot(sim)!;
    const r = trailRoute(sim, walker, bot, goal);
    expect(r.reached).toBe(true);
    expect(r.why).toBeUndefined();
    walkable(walker, r);
    expect(r.points[0]).toEqual({ x: bot.x, z: bot.z });
    expect(Math.hypot(end(r).x - goal.x, end(r).z - goal.z)).toBeLessThanOrEqual(WAYMARK.trail.reach);
  });

  it('from the jetty to the fountain it goes round what a straight line would cross', () => {
    const sim = fresh();
    const walker = new Walker(sim);
    const bot = spawnPose(sim, walker);
    const [fx, fz] = sim.areas.info(PARK).landmark;
    const goal = at(fx, fz, 'fountain');
    expect(lineBlocked(walker, bot, goal)).toBe(true);
    const r = trailRoute(sim, walker, bot, goal);
    expect(r.reached).toBe(true);
    walkable(walker, r);
    const len = r.points.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - r.points[i].x, p.z - r.points[i].z), 0);
    // longer than the straight line to where it ends: it bends round what's in the way
    expect(len).toBeGreaterThan(Math.hypot(end(r).x - bot.x, end(r).z - bot.z) + 0.5);
  });

  it('low on charge, it leads to the place to rest', () => {
    const sim = fresh();
    (sim as unknown as Record<string, unknown>).charge = { low: true, share: 0.05 };
    const walker = new Walker(sim);
    const goal = goalSpot(sim);
    if (!goal || goal.kind !== 'rest') return;
    const r = trailRoute(sim, walker, spawnPose(sim, walker), goal);
    expect(r.reached).toBe(true);
    walkable(walker, r);
  });

  it('to the rubble across a way in: it reaches the rubble from the near side', () => {
    const sim = fresh();
    const walker = new Walker(sim);
    const g = REGIONS.find((q) => q.id === 'mastRow')!.gate;
    const [gx, gz] = g.cells[0];
    const r = trailRoute(sim, walker, spawnPose(sim, walker), at(gx, gz, 'gate'));
    expect(r.reached).toBe(true);
    walkable(walker, r);
  });
});

describe('#632: a solid goal counts as reached from beside it, whatever it is', () => {
  it('the fountain (solid) from the jetty: gets there, ends beside it, no note', () => {
    const sim = fresh();
    const walker = new Walker(sim);
    const [fx, fz] = sim.areas.info(PARK).landmark;
    expect(walker.walkable(GROUND, fx, fz)).toBe(false);
    const r = trailRoute(sim, walker, spawnPose(sim, walker), at(fx, fz, 'fountain'));
    expect(r.reached).toBe(true);
    expect(r.why).toBeUndefined();
    expect(Math.hypot(end(r).x - (fx + 0.5), end(r).z - (fz + 0.5))).toBeLessThan(3);
  });

  it('a salvage pile across the park: gets there, beside the pile', () => {
    const sim = fresh();
    const walker = new Walker(sim);
    const bot = spawnPose(sim, walker);
    const pile = allPiles()
      .filter((p) => walker.walkable(GROUND, p.x + 1, p.z) || walker.walkable(GROUND, p.x - 1, p.z) || walker.walkable(GROUND, p.x, p.z + 1))
      .filter((p) => sim.areas.fog(sim.areas.map.areaOfCell(p.x, p.z)) !== 'hidden')
      .sort((a, b) => Math.hypot(b.x - bot.x, b.z - bot.z) - Math.hypot(a.x - bot.x, a.z - bot.z))
      .find((p) => Math.hypot(p.x - bot.x, p.z - bot.z) < 60)!;
    expect(pile).toBeDefined();
    const r = trailRoute(sim, walker, bot, at(pile.x, pile.z, 'pile'));
    expect(r.reached).toBe(true);
    expect(r.why).toBeUndefined();
    walkable(walker, r);
  });

  it('a Keeper beyond rubble that has been pried open: gets there, no note', () => {
    const sim = fresh();
    const pylon = KEEPERS.find((k) => k.id === 'pylon')!;
    const region = REGIONS.find((q) => q.id === pylon.region)!;
    sim.gates.open(region.gate.id, true);
    const walker = new Walker(sim);
    const r = trailRoute(sim, walker, spawnPose(sim, walker), at(pylon.x, pylon.z, 'keeper'));
    expect(r.reached).toBe(true);
    expect(r.why).toBeUndefined();
    walkable(walker, r);
  });

  it('real rubble: the same Keeper before the rubble is pried open, the trail stops at the rubble and says so', () => {
    const sim = fresh();
    const pylon = KEEPERS.find((k) => k.id === 'pylon')!;
    const region = REGIONS.find((q) => q.id === pylon.region)!;
    const walker = new Walker(sim);
    const r = trailRoute(sim, walker, spawnPose(sim, walker), at(pylon.x, pylon.z, 'keeper'));
    expect(r.reached).toBe(false);
    expect(r.why).toBe(`${region.gate.blocked} ${region.gate.how}`);
  });

  it('a wide landmark, deep in its own footprint: reached from its nearest open cell', () => {
    const sim = fresh();
    const region = REGIONS.find((q) => q.id === 'mastRow')!;
    sim.gates.open(region.gate.id, true);
    const walker = new Walker(sim);
    const r = trailRoute(sim, walker, spawnPose(sim, walker), at(region.landmark.x, region.landmark.z, 'landmark'));
    expect(r.reached).toBe(true);
    expect(r.why).toBeUndefined();
  });
});

describe('#632: with no way there yet, it goes as close as it can and says why', () => {
  it('real rubble: a Keeper behind it before Pry, the trail stops on this side and says the rubble blocks it', () => {
    const sim = fresh();
    const walker = new Walker(sim);
    const region = REGIONS.find((q) => q.id === 'mastRow')!;
    const [gx, gz] = region.gate.cells[0];
    // straight through the rubble and out the other side
    const goal = at(gx, gz - 6, 'keeper');
    const r = trailRoute(sim, walker, spawnPose(sim, walker), goal);
    expect(r.reached).toBe(false);
    walkable(walker, r);
    // it says what blocks it and what to do: wake the fountain, and Bloombot learns to pry rubble
    expect(r.why).toBe(`${region.gate.blocked} ${region.gate.how}`);
    expect(r.why).toMatch(/fountain/);
    // it stops near the rubble, not somewhere off to the side
    expect(Math.hypot(end(r).x - (gx + 0.5), end(r).z - (gz + 0.5))).toBeLessThan(3);
  });

  it('somewhere nobody has found yet, with no rubble on the line: it says so plainly', () => {
    const sim = fresh();
    const walker = new Walker(sim);
    const region = REGIONS.find((q) => q.id === 'oldMarket')!;
    const goal = at(region.landmark.x, region.landmark.z, 'landmark');
    const r = trailRoute(sim, walker, spawnPose(sim, walker), goal);
    expect(r.reached).toBe(false);
    walkable(walker, r);
    expect([`${region.gate.blocked} ${region.gate.how}`, WORDS.trail.hidden, WORDS.trail.water, WORDS.trail.blocked]).toContain(r.why);
  });

  it('a goal on another level: no trail, and it says where the goal is', () => {
    const sim = fresh();
    const walker = new Walker(sim);
    const bot: BotPose = spawnPose(sim, walker);
    const r = trailRoute(sim, walker, bot, { ...at(1, 1), roofId: 'roof-1' });
    expect(r.reached).toBe(false);
    expect(r.points).toHaveLength(1);
    expect(r.why).toBe(WORDS.trail.level);
  });

  it('with Pry in hand, the same rubble says to walk up and open it', () => {
    const sim = fresh();
    sim.state.salvage!.abilities.push('pry');
    const walker = new Walker(sim);
    const region = REGIONS.find((q) => q.id === 'mastRow')!;
    const [gx, gz] = region.gate.cells[0];
    const r = trailRoute(sim, walker, spawnPose(sim, walker), at(gx, gz - 6, 'keeper'));
    expect(r.reached).toBe(false);
    expect(r.why).toBe(`${region.gate.blocked} ${WORDS.trail.openNow}`);
  });

  it('the reasons are plain words, none of the banned ones', async () => {
    const { bannedIn } = await import('../src/ui/words');
    for (const w of Object.values(WORDS.trail)) expect(bannedIn(w), w).toEqual([]);
  });
});

describe('#632: the dots along the way', () => {
  it('one every gap along the way, the first a gap out from bloombot, never past the end', () => {
    const pts = [
      { x: 0.5, z: 0.5 },
      { x: 1.5, z: 0.5 },
      { x: 2.5, z: 0.5 },
      { x: 3.5, z: 0.5 },
      { x: 4.5, z: 0.5 },
    ];
    const dots = trailDots(pts, 0.5);
    expect(dots[0].s).toBeCloseTo(0.5);
    expect(dots[0].x).toBeCloseTo(1);
    expect(dots.length).toBe(8);
    for (let i = 1; i < dots.length; i++) expect(dots[i].s - dots[i - 1].s).toBeCloseTo(0.5);
    expect(dots[dots.length - 1].x).toBeLessThanOrEqual(4.5);
  });

  it('corners are softened: a right-angle turn curves, and the dots stay near the cells walked', () => {
    const pts = [
      { x: 0.5, z: 0.5 },
      { x: 1.5, z: 0.5 },
      { x: 2.5, z: 0.5 },
      { x: 2.5, z: 1.5 },
      { x: 2.5, z: 2.5 },
    ];
    const dots = trailDots(pts, 0.25);
    // no dot sits right on the corner's point
    expect(dots.some((d) => Math.abs(d.x - 2.5) < 0.02 && Math.abs(d.z - 0.5) < 0.02)).toBe(false);
    for (const d of dots) {
      const near = Math.min(...pts.map((p) => Math.max(Math.abs(p.x - d.x), Math.abs(p.z - d.z))));
      expect(near).toBeLessThanOrEqual(0.5);
    }
  });

  it('a very long way keeps its first stretch, up to the cap', () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 1000, z: 0 },
    ];
    const dots = trailDots(pts, 0.7, 50);
    expect(dots).toHaveLength(50);
    expect(dots[0].x).toBeCloseTo(0.7);
  });
});

describe('#781: leaving the fountain for the market', () => {
  it('blocks intact rail and lets Bloombot and the trail use the open market gap', () => {
    const sim = fresh();
    const walker = new Walker(sim);
    const region = REGIONS.find(region => region.id === 'oldMarket')!;
    const closed = { roofId: GROUND, x: 15.5, z: 7.5, facing: 0 };
    expect(walker.move(closed, 1, 0)).toBeLessThan(0.5);
    sim.gates.open(region.gate.id, true);
    expect(walker.walkable(GROUND, 15, 10)).toBe(true);
    expect(walker.walkable(GROUND, 16, 10)).toBe(true);
    expect(walker.fits(GROUND, 15.94, 10.5)).toBe(false);
    const gap = { roofId: GROUND, x: 15.5, z: 7.5, facing: 0 };
    expect(walker.move(gap, 1, 0)).toBeCloseTo(1);

    const [x, z] = sim.areas.info(PARK).landmark;
    const start = { roofId: GROUND, x: x + 2.5, z: z + 0.5, facing: 0 };
    const patch = region.patch;
    const goal = { ...at(patch.x + 2, patch.z + 1), patchKeeperId: 'tally' };
    const route = trailRoute(sim, walker, start, goal);
    expect(route.reached).toBe(true);
    const crossing = route.points.find((point, index) => index > 0 && point.x >= 16 && route.points[index - 1].x < 16);
    expect(crossing?.z).toBeGreaterThanOrEqual(7.5);
    expect(crossing?.z).toBeLessThanOrEqual(8.5);
    expect(trailDots(route.points).every(point => walker.fits(GROUND, point.x, point.z, 0.06))).toBe(true);
    expect([...sim.keepers.patchTiles('tally')].some(tile =>
      Math.abs(tile.x - Math.floor(end(route).x)) + Math.abs(tile.z - Math.floor(end(route).z)) <= 1
    )).toBe(true);
  });

  it('derives leaf direction from the route', () => {
    const leaves = trailDots([{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 3 }], 0.5);
    expect(leaves[0].heading).toBeCloseTo(Math.PI / 2);
    expect(leaves.at(-1)?.heading).toBeCloseTo(0);
  });
});

describe('falling route leaves and raised paving', () => {
  it('flutters while descending and settles exactly onto the trail', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map(t => leafFlight(t, 0.43, 0.66, { yaw: -2.1, pitch: 0.5, roll: 0.3 }));
    for (let i = 1; i < samples.length; i++) expect(samples[i].height).toBeLessThan(samples[i - 1].height);
    expect(samples[1].roll).not.toBe(samples[2].roll);
    const { yaw, ...settled } = samples.at(-1)!;
    expect(yaw).toBe(-2.1);
    expect(Object.values(settled).every(value => value === 0)).toBe(true);
  });

  it('starts at the light with an independent initial direction for each leaf', () => {
    const first = randomLeafLaunch(() => 0.12);
    const second = randomLeafLaunch(() => 0.83);
    expect(first.yaw).not.toBe(second.yaw);
    for (const launch of [first, second]) {
      const start = leafFlight(0, 1.3, 0.66, launch);
      expect(start).toMatchObject(launch);
      expect(start.height).toBe(0.66);
      expect(leafFlight(1, 1.3, 0.66, launch).yaw).toBe(launch.yaw);
      expect(Math.abs(start.sideways) + Math.abs(start.along)).toBe(0);
    }
  });

  it('clears brick tops and rounded paving corners without lifting plain ground', () => {
    const sim = fresh();
    const tile = { ...sim.grid.get(GROUND, 8, 8)!, blocked: false, occupantId: undefined, feature: 'lawn' as const };
    const brick = { ...tile, feature: 'paving' as const, ground: 'polluted' as const };
    const flat = { peek: () => undefined };
    expect(pavingOverlayLift(flat, tile)).toBe(0);
    expect(pavingOverlayLift(flat, brick)).toBeGreaterThan(RAISED_PAVING_LIFT);
    expect(pavingOverlayLift(flat, { ...brick, ground: 'restored' })).toBeGreaterThan(RESTORED_PATH_LIFT + 0.004);
    const corner = { peek: (_: string, x: number, z: number) =>
      (x === tile.x + 1 && z === tile.z) || (x === tile.x && z === tile.z + 1) ? brick : undefined };
    expect(pavingOverlayLift(corner, tile)).toBeGreaterThan(RESTORED_PATH_LIFT + 0.004);
  });
});
