import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { REGIONS } from '../src/data/oldcity';
import { WAYMARK } from '../src/data/waymark';
import { Sim } from '../src/gameplay/Sim';
import { goalSpot } from '../src/ui/GoalSpot';
import { pinAt, shutRegions } from '../src/ui/Minimap';

/**
 * E24 (#609): marking the way. The goal card's goal has a place, the minimap pins it (on the rim when it is off the
 * map), the world marks it with a soft light, and every shut way in shows on the map from the very start.
 */

const fresh = () => new Sim(createInitialState(7));
const region = (id: string) => REGIONS.find((r) => r.id === id)!;
const loop = (sim: Sim) => sim as unknown as Record<string, unknown>;

/** Past the first fountain step: Pry in hand, the next step (copper, timber, glass) to gather. */
function tierOne(sim: Sim) {
  const sv = sim.state.salvage!;
  sv.tier = 1;
  if (!sv.abilities.includes('pry')) sv.abilities.push('pry');
  return sv;
}

describe('#609: the pin and the light follow the goal spot', () => {
  it('a fresh game: the spot is the salvage pile by the jetty, close enough that the pin tucks under bloombot', () => {
    const sim = fresh();
    const g = goalSpot(sim)!;
    expect(g.kind).toBe('pile');
    const bot = { roofId: GROUND, x: sim.state.bot?.x ?? g.x, z: sim.state.bot?.z ?? g.z, facing: 0 };
    if (Math.hypot(bot.x - g.x, bot.z - g.z) <= WAYMARK.near) expect(pinAt(bot, g)).toBeUndefined();
    // from across the park the same spot is pinned
    expect(pinAt({ roofId: GROUND, x: g.x + 10, z: g.z, facing: 0 }, g)).toBeDefined();
  });

  it('carrying what the fountain asks for, the pin and the light go to the fountain', () => {
    const sim = fresh();
    const t = sim.fountain.next()!;
    for (const [m, n] of Object.entries(t.delivery)) if (m !== 'biomass') sim.inventory.add(m as never, n as number);
    const g = goalSpot(sim)!;
    expect(g.kind).toBe('fountain');
    const [fx, fz] = sim.areas.info(PARK).landmark;
    expect(Math.hypot(g.cell.x - fx, g.cell.z - fz)).toBeLessThan(3);
  });

  it('with Pry, when the copper and glass lie behind barricades, the spot is the way in, and the map draws it shut', () => {
    const sim = fresh();
    const sv = tierOne(sim);
    sv.delivered.scrap = 20;
    sv.delivered.seeds = 6;
    sv.delivered.timber = 30;
    const g = goalSpot(sim)!;
    expect(g.kind).toBe('gate');
    const r = REGIONS.find((q) => q.gate.cells.some(([x, z]) => x === g.cell.x && z === g.cell.z))!;
    expect(r).toBeDefined();
    expect(shutRegions(sim)).toContain(r);
  });

  it('low on charge, the spot is a place to rest, and the pin wears the low-charge badge', () => {
    const sim = fresh();
    loop(sim).charge = { low: true, share: 0.05 };
    const g = goalSpot(sim);
    if (g) expect(g.kind).toBe('rest');
  });
});

describe('#609: the minimap pins the goal', () => {
  const bot = { roofId: GROUND, x: 10.5, z: 10.5, facing: 0 };
  const goal = (x: number, z: number) => ({ roofId: GROUND, x, z, cell: { x: Math.floor(x), z: Math.floor(z) }, kind: 'fountain' as const, name: 'the fountain' });

  it('a goal on the map stands where it is: east is right, south (+z) is down', () => {
    const at = pinAt(bot, goal(16.5, 10.5))!;
    expect(at.edge).toBe(false);
    expect(at.x).toBeGreaterThan(89 + 15);
    expect(at.y).toBeCloseTo(89);
    const s = pinAt(bot, goal(10.5, 18.5))!;
    expect(s.y).toBeGreaterThan(89 + 15);
    expect(s.x).toBeCloseTo(89);
  });

  it('a goal off the map waits on the rim, pointing the way', () => {
    const at = pinAt(bot, goal(10.5 + 300, 10.5 - 300))!;
    expect(at.edge).toBe(true);
    // due east it sits rimInset in from the edge (north and south keep further in, below)
    const east = pinAt(bot, goal(10.5 + 300, 10.5))!;
    expect(Math.hypot(east.x - 89, east.y - 89)).toBeCloseTo(89 - WAYMARK.rimInset, 0);
    expect(Math.hypot(at.x - 89, at.y - 89)).toBeLessThanOrEqual(89 - WAYMARK.rimInset);
    expect(at.x).toBeGreaterThan(89); // north-east: right and up
    expect(at.y).toBeLessThan(89);
  });

  it('straight north or south it keeps clear of the N badge and the clock on the rim', () => {
    const n = pinAt(bot, goal(10.5, 10.5 - 300))!;
    expect(n.edge).toBe(true);
    expect(n.y).toBeCloseTo(WAYMARK.rimInset + WAYMARK.rimBadges, 0);
    const s = pinAt(bot, goal(10.5, 10.5 + 300))!;
    expect(178 - s.y).toBeCloseTo(WAYMARK.rimInset + WAYMARK.rimBadges, 0);
  });

  it('no pin once bloombot is there, on another layer, or with no goal', () => {
    expect(pinAt(bot, goal(11, 11))).toBeUndefined();
    expect(pinAt(bot, { ...goal(30, 30), roofId: 'roof-1' })).toBeUndefined();
    expect(pinAt(bot, undefined)).toBeUndefined();
  });
});

describe('#609: the shut ways in show from the start', () => {
  it('every gate is on the map in a fresh game, and one leaves the map once it opens', () => {
    const sim = fresh();
    const shut = shutRegions(sim);
    expect(shut.map((r) => r.id).sort()).toEqual(REGIONS.map((r) => r.id).sort());
    sim.state.salvage!.opened.push(region('mastRow').gate.id);
    expect(shutRegions(sim).map((r) => r.id)).not.toContain('mastRow');
  });

  it('the shut regions are hidden in the fog at the start (the map hatches them, so their shape shows)', () => {
    const sim = fresh();
    for (const r of shutRegions(sim).filter((q) => q.gate.opensRegion !== false)) {
      const cx = ((r.chunks.x0 + r.chunks.x1 + 1) / 2) * 16;
      const cz = ((r.chunks.z0 + r.chunks.z1 + 1) / 2) * 16;
      expect(sim.areas.map.areaOfCell(Math.floor(cx), Math.floor(cz)), r.id).toBe(r.id);
      expect(sim.areas.fog(r.id), r.id).toBe('hidden');
    }
  });
});
