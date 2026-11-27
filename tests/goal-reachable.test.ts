import { describe, expect, it } from 'vitest';
import { createInitialState, GROUND } from '../src/core/GameState';
import { allPiles } from '../src/core/OldCityLayout';
import { LANDING } from '../src/data/oldcity';
import { nearestByFoot, walkCost } from '../src/gameplay/Advisor';
import { Sim } from '../src/gameplay/Sim';
import { trailRoute } from '../src/gameplay/TrailRoute';
import { Walker } from '../src/gameplay/Walker';
import { goalSpot } from '../src/ui/GoalSpot';
import { firstHedge } from '../src/ui/ObjectiveCard';

/**
 * #644: Show me where must lead somewhere bloombot can walk to. On a fresh game, once the jetty's crate was dug out,
 * the goal was the Scrap pile nearest in a straight line: across the canal, so the trail stopped at the water while
 * plenty of piles lay on the beach. The goal is now the candidate nearest on foot; one it can't reach only when it
 * can reach none.
 */
function freshAtSpawn() {
  const sim = new Sim(createInitialState(7));
  const [x, z] = LANDING.spawn;
  sim.bot = { roofId: GROUND, x, z };
  sim.state.bot = { roofId: GROUND, x, z, facing: Math.PI };
  return sim;
}
const pose = (sim: Sim) => ({ roofId: GROUND, x: sim.bot!.x, z: sim.bot!.z, facing: Math.PI });
const dig = (sim: Sim, id: string) => {
  for (let i = 0; i < 50 && sim.salvage.left(id) > 0; i++) if (!sim.salvage.salvage(id)) break;
};

describe('#644: Show me where picks a goal bloombot can walk to', () => {
  it('a fresh game: first the jetty crate, then a pile on this side of the canal, and the trail gets there', () => {
    const sim = freshAtSpawn();
    const first = goalSpot(sim)!;
    expect(first.kind).toBe('pile');
    expect(trailRoute(sim, new Walker(sim), pose(sim), first).reached).toBe(true);
    const crate = allPiles().find((p) => p.x === first.cell.x && p.z === first.cell.z)!;
    dig(sim, crate.id);
    expect(sim.salvage.left(crate.id)).toBe(0);
    const next = goalSpot(sim)!;
    expect(next.kind).toBe('pile');
    expect(walkCost(sim, next.cell.x, next.cell.z), `${next.name} at ${next.cell.x},${next.cell.z}`).toBeDefined();
    const route = trailRoute(sim, new Walker(sim), pose(sim), next);
    expect(route.reached, route.why).toBe(true);
    // the pile it used to pick: nearest in a straight line, across the canal
    const across = allPiles().find((p) => p.id === 'sw-s2')!;
    expect(walkCost(sim, across.x, across.z)).toBeUndefined();
    expect(next.cell).not.toEqual({ x: across.x, z: across.z });
  });

  it('a pile across water loses to one bloombot can reach, even one further off in a straight line', () => {
    const sim = freshAtSpawn();
    const across = allPiles().find((p) => p.id === 'sw-s2')!; // 18 tiles off, over the canal
    const beach = allPiles().find((p) => p.id === 'sw-s7')!; // 24 tiles off, up the beach
    const b = sim.bot!;
    const d = (p: { x: number; z: number }) => Math.abs(p.x - Math.floor(b.x)) + Math.abs(p.z - Math.floor(b.z));
    expect(d(across)).toBeLessThan(d(beach));
    expect(walkCost(sim, across.x, across.z)).toBeUndefined();
    expect(walkCost(sim, beach.x, beach.z)).toBeGreaterThan(0);
    expect(nearestByFoot(sim, [across, beach], (p) => ({ x: p.x, z: p.z }))).toBe(beach);
    // and between two it can reach, the nearer on foot
    const jetty = allPiles().find((p) => p.id === 'sw-t2')!;
    expect(nearestByFoot(sim, [beach, jetty], (p) => ({ x: p.x, z: p.z }))).toBe(jetty);
  });

  it('with nothing it can reach, it still names the nearest (the trail then says why it stops)', () => {
    const sim = freshAtSpawn();
    const across = allPiles().filter((p) => walkCost(sim, p.x, p.z) === undefined);
    expect(across.length).toBeGreaterThan(1);
    const b = sim.bot!;
    const straight = [...across].sort((p, q) => Math.abs(p.x - b.x) + Math.abs(p.z - b.z) - (Math.abs(q.x - b.x) + Math.abs(q.z - b.z)))[0];
    expect(nearestByFoot(sim, across, (p) => ({ x: p.x, z: p.z }))).toBe(straight);
    expect(nearestByFoot(sim, [], (p: { x: number; z: number }) => p)).toBeUndefined();
  });

  it('the rubble the card points at once bloombot can pry is rubble it can walk up to', () => {
    const sim = freshAtSpawn();
    sim.state.salvage!.abilities.push('prune');
    const r = firstHedge(sim)!;
    expect(r).toBeDefined();
    expect(walkCost(sim, r.gate.cells[0][0], r.gate.cells[0][1])).toBeDefined();
  });

  it('the flood is capped: it never walks the whole city', () => {
    const sim = freshAtSpawn();
    const costs = new Walker(sim).costsFrom(GROUND, sim.bot!.x, sim.bot!.z, 500, 1000);
    expect(costs.size).toBeLessThanOrEqual(500);
    const near = new Walker(sim).costsFrom(GROUND, sim.bot!.x, sim.bot!.z, 1e6, 6);
    expect(Math.max(...near.values())).toBeLessThanOrEqual(6);
  });
});
