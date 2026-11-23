import { describe, expect, it } from 'vitest';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { REGIONS } from '../src/data/oldcity';
import { WAYMARK } from '../src/data/waymark';
import { Sim } from '../src/gameplay/Sim';
import { doneHere, emblemFrame, emblemSymbol, GOAL_KINDS, HEART, LOTUS, lotusLines, lotusSvg, petalOutline, SYMBOL_RADIUS } from '../src/rendering/Emblem';
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

describe('the waymark emblem: what the goal is for', () => {
  it('every goal kind has its own symbol, drawn inside its circle', () => {
    const seen = new Set<string>();
    for (const k of GOAL_KINDS) {
      const f = emblemSymbol(k);
      expect(f.idx.length, k).toBeGreaterThan(0);
      expect(f.idx.length % 3, k).toBe(0);
      expect(Math.max(...f.idx), k).toBeLessThan(f.pos.length / 2);
      expect(f.col.length, k).toBe((f.pos.length / 2) * 4);
      for (let i = 0; i < f.pos.length; i += 2) expect(Math.hypot(f.pos[i], f.pos[i + 1]), k).toBeLessThanOrEqual(SYMBOL_RADIUS + 1e-6);
      seen.add(f.pos.map((v) => v.toFixed(3)).join());
    }
    expect(seen.size).toBe(GOAL_KINDS.length);
  });

  it('the lotus: a tall centre petal, side petals fanning wider and lower, on a leaf pad, in a soft halo', () => {
    const f = emblemFrame();
    const xs = f.pos.filter((_, i) => i % 2 === 0);
    const ys = f.pos.filter((_, i) => i % 2 === 1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1.4);
    expect(Math.min(...ys)).toBeGreaterThan(-1);
    // the centre petal is the tallest; each pair beside it lower and wider out, the pair symmetric
    const petals = LOTUS.filter((p) => !p.leaf);
    const centre = petals.find((p) => p.b[0] === 0)!;
    for (const p of petals.filter((q) => q !== centre)) {
      expect(p.b[1]).toBeLessThan(centre.b[1]);
      expect(petals.some((q) => q.b[0] === -p.b[0] && q.b[1] === p.b[1])).toBe(true);
    }
    expect(LOTUS.some((p) => p.leaf)).toBe(true);
    // the halo's edge is see-through, so the lotus has no hard outline round its glow
    expect(Math.min(...f.col.filter((_, i) => i % 4 === 3))).toBe(0);
  });

  it('the symbol sits in the heart of the centre petal, inside its edges', () => {
    const centre = LOTUS.find((p) => !p.leaf && p.b[0] === 0)!;
    const outline = petalOutline(centre.a[0], centre.a[1], centre.b[0], centre.b[1], centre.w, 32);
    const halfWidthAt = (y: number) => Math.max(...outline.filter(([, py]) => Math.abs(py - y) < 0.05).map(([x]) => Math.abs(x)));
    const r = SYMBOL_RADIUS * HEART.scale;
    expect(halfWidthAt(HEART.y)).toBeGreaterThan(r);
    expect(HEART.y - r).toBeGreaterThan(centre.a[1]);
    expect(HEART.y + r).toBeLessThan(centre.b[1]);
  });

  it('the symbols are gold, painted and glowing, rest in its own blue and cyan', () => {
    const paint = emblemSymbol('pile', 'paint').col;
    const light = emblemSymbol('pile', 'light').col;
    const rest = emblemSymbol('rest', 'paint').col;
    const restLight = emblemSymbol('rest', 'light').col;
    expect(paint[0]).toBeGreaterThan(paint[2]);
    expect(light[0] + light[1] + light[2]).toBeGreaterThan(paint[0] + paint[1] + paint[2]);
    expect(rest[2]).toBeGreaterThan(rest[0]);
    expect(restLight[2]).toBeGreaterThan(restLight[0]);
  });

  it('only the outline: lines along the petals, the stretches behind a petal in front left out', () => {
    const lines = lotusLines();
    expect(lines.some((l) => l.leaf)).toBe(true);
    const petals = LOTUS.map((p) => petalOutline(p.a[0], p.a[1], p.b[0], p.b[1], p.w, 40));
    const isIn = (x: number, y: number, poly: [number, number][]) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i];
        const [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    };
    // nothing of the leaf pad's edge shows inside the centre petal, which stands in front of it
    const centre = petals[LOTUS.findIndex((p) => !p.leaf && p.b[0] === 0)];
    for (const l of lines.filter((q) => q.leaf)) for (const [x, y] of l.pts) expect(isIn(x, y, centre)).toBe(false);
    // the centre petal's tip, in front of everything behind it, is all there
    const tip = LOTUS.find((p) => !p.leaf && p.b[0] === 0)!.b;
    expect(lines.some((l) => !l.leaf && l.pts.some(([x, y]) => Math.hypot(x - tip[0], y - tip[1]) < 1e-6))).toBe(true);
    // the logo draws strokes only, no fill
    expect(lotusSvg()).toContain('fill="none"');
  });

  it('one lotus: the page icon and the title badge are the same lotus as the waymark', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('index.html', 'utf8');
    const icon = /<link rel="icon" href="data:image\/svg\+xml,([^"]*)" \/>/.exec(html)?.[1];
    expect(icon && decodeURIComponent(icon), 'run npx vite-node scripts/lotus-icon.ts').toBe(lotusSvg());
    expect(readFileSync('src/ui/Title.ts', 'utf8')).toContain('${lotusSvg()}');
    expect(readFileSync('src/ui/Loading.ts', 'utf8')).toContain('${lotusSvg()}');
  });

  it('the beam fades as bloombot walks in, so the lotus on the spot is all that is left once it is there', () => {
    expect(WAYMARK.beam.far).toBeGreaterThan(WAYMARK.beam.close);
    expect(WAYMARK.beam.close).toBeGreaterThan(WAYMARK.near);
    expect(WAYMARK.pulse.reach).toBeGreaterThan(WAYMARK.beam.close);
  });
});

describe('the Bloom Pulse: the game says the goal the waymark stands on is done', () => {
  const pile = { roofId: GROUND, x: 10.5, z: 10.5, kind: 'pile' as const };
  const gate = { roofId: GROUND, x: 7.5, z: 0.5, kind: 'gate' as const };
  const there = { roofId: GROUND, x: 11, z: 11 };
  const R = WAYMARK.pulse.reach;

  it('a deed at the spot that finishes its kind of goal: done', () => {
    expect(doneHere(pile, ['pile'], { x: 10, z: 10 }, undefined, R, true)).toBe(true);
    // no place given (a gate opened): bloombot standing at it is the place
    expect(doneHere(gate, ['gate'], undefined, { roofId: GROUND, x: 7.5, z: 2 }, R, true)).toBe(true);
    expect(doneHere({ ...pile, kind: 'park' }, ['park', 'spot'], { roofId: GROUND, x: 11, z: 10 }, there, R, true)).toBe(true);
  });

  it('not done: another kind of deed, somewhere else, another layer, or the waymark never showed there', () => {
    expect(doneHere(pile, ['gate'], undefined, there, R, true)).toBe(false);
    expect(doneHere(pile, ['pile'], { x: 30, z: 30 }, there, R, true)).toBe(false);
    expect(doneHere(pile, ['pile'], { roofId: 'roof-1', x: 10.5, z: 10.5 }, there, R, true)).toBe(false);
    expect(doneHere(gate, ['gate'], undefined, { roofId: GROUND, x: 30, z: 30 }, R, true)).toBe(false);
    expect(doneHere(pile, ['pile'], { x: 10, z: 10 }, there, R, false)).toBe(false);
    expect(doneHere(undefined, ['pile'], { x: 10, z: 10 }, there, R, true)).toBe(false);
  });

  it('resting is not an objective, so it never blooms', () => {
    expect(doneHere({ ...pile, kind: 'rest' }, ['rest', 'pile'], undefined, there, R, true)).toBe(false);
  });

  it('every goal but resting has a deed in the game that finishes it', async () => {
    const src = (await import('node:fs')).readFileSync('src/app/Game.ts', 'utf8');
    const wired = new Set([...src.matchAll(/waymark\.done\(\[([^\]]+)\]/g)].flatMap((m) => m[1].split(',').map((k) => k.trim().replace(/'/g, ''))));
    for (const k of GOAL_KINDS.filter((x) => x !== 'rest')) expect(wired, k).toContain(k);
  });
});
