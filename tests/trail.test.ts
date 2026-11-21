import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { REGIONS } from '../src/data/oldcity';
import { WAYMARK } from '../src/data/waymark';
import { Sim } from '../src/gameplay/Sim';
import { trailDots, trailRoute, type TrailRoute } from '../src/gameplay/TrailRoute';
import { spawnPose, Walker, type BotPose } from '../src/gameplay/Walker';
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

describe('#632: with no way there yet, it goes as close as it can and says why', () => {
  it('a Keeper behind rubble before Pry: the trail stops on this side and says the rubble blocks it', () => {
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
