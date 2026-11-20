import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { CHUNK } from '../src/core/Hash';
import { Rng } from '../src/core/Rng';
import { Sim } from '../src/gameplay/Sim';
import { BOT, spawnPose, Walker } from '../src/gameplay/Walker';
import { runOldCityBot } from './oldcity-bot';
import { unlockAll } from './helpers';
import { REGIONS } from '../src/data/oldcity';

/** E23.1.1: the whole island open: the fountain awake, every ability, every region's gate open and its landmark woken. */
function bigCity(seed = 7) {
  const sim = new Sim(createInitialState(seed));
  unlockAll(sim);
  sim.state.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  for (const r of REGIONS) {
    sim.gates.open(r.gate.id, true);
    if (sim.areas.fog(r.id) !== 'hidden') sim.areas.clear(r.id, true);
  }
  return sim;
}

/** Every revealed ground cell bloombot may stand on, by "x,z". */
function walkableCells(sim: Sim, w: Walker): Set<string> {
  const out = new Set<string>();
  for (const id of sim.areas.revealed())
    for (const t of sim.areas.tiles(id)) if (w.walkable(GROUND, t.x, t.z)) out.add(`${t.x},${t.z}`);
  return out;
}

describe('bloombot walking (G.2)', () => {
  const sim = bigCity();
  const w = new Walker(sim);

  it('opens every region of the island for the walk tests', () => {
    for (const r of REGIONS) expect(sim.areas.fog(r.id), r.id).toBe('cleared');
  });

  it('starts at the Landing on Saltwind Beach (E21.26), on legal ground', () => {
    const p = spawnPose(sim, w);
    expect(w.fits(p.roofId, p.x, p.z)).toBe(true);
    expect(sim.areas.map.areaOfCell(Math.floor(p.x), Math.floor(p.z))).toBe('saltwind');
  });

  it('never stands in fog, an obstacle or a machine after 10 minutes of random input', () => {
    const rng = new Rng(99);
    const rnd = () => rng.next();
    const p = spawnPose(sim, w);
    const dt = 1 / 30;
    let dir = 0;
    let travelled = 0;
    for (let i = 0; i < 10 * 60 * 30; i++) {
      if (rnd() < 0.03) dir = rnd() * Math.PI * 2; // change direction now and then
      const speed = (rnd() < 0.3 ? BOT.sprint : BOT.walk) * (w.wading(p) ? BOT.wade : 1);
      travelled += w.move(p, Math.sin(dir) * speed * dt, Math.cos(dir) * speed * dt);
      p.facing = dir;
      if (!w.fits(p.roofId, p.x, p.z)) throw new Error(`bloombot in a blocked cell at ${p.x.toFixed(2)},${p.z.toFixed(2)} on step ${i}`);
    }
    expect(travelled).toBeGreaterThan(200); // it really went places, not stuck in a corner
  });

  it('can reach every revealed walkable cell on foot, or stand next to it to act on it', () => {
    const cells = walkableCells(sim, w);
    const p = spawnPose(sim, w);
    const seen = new Set<string>([`${Math.floor(p.x)},${Math.floor(p.z)}`]);
    const queue = [[Math.floor(p.x), Math.floor(p.z)]];
    while (queue.length) {
      const [x, z] = queue.pop()!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${z + dz}`;
        if (seen.has(k) || !w.walkable(GROUND, x + dx, z + dz)) continue;
        seen.add(k);
        queue.push([x + dx, z + dz]);
      }
    }
    // A cell walled in by obstacles can't be stood on, but bloombot acts on the cell in front, so standing
    // beside it is enough (8 ways, matching Walker.front).
    const near = (c: string) => {
      const [x, z] = c.split(',').map(Number);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (seen.has(`${x + dx},${z + dz}`)) return true;
      return false;
    };
    const walledIn = [...cells].filter((c) => !seen.has(c));
    const missed = walledIn.filter((c) => !near(c));
    expect(missed.length, `out of reach: ${missed.slice(0, 10).join(' ')}`).toBe(0);
    expect(walledIn.length).toBeLessThan(cells.size / 1000);
  });

  it('finds a path across the park and around the fountain', () => {
    // E23.1.1: from the Landing on the beach, up through the park to the far side of the fountain
    const p = spawnPose(sim, w);
    const [fx, fz] = sim.areas.info(PARK).landmark;
    const far = Math.sign(fz - p.z) || 1; // the fountain lies this way from the Landing
    const goal = sim.areas
      .tiles(PARK)
      .filter((t) => (t.z - fz) * far >= 4 && w.walkable(GROUND, t.x, t.z))
      .sort((a, b) => Math.abs(a.x - fx) + Math.abs(a.z - fz) - (Math.abs(b.x - fx) + Math.abs(b.z - fz)))[0];
    expect(goal).toBeDefined();
    const path = w.path(GROUND, p.x, p.z, (x, z) => x === goal.x && z === goal.z, goal);
    expect(path).toBeDefined();
    expect(path!.at(-1)).toEqual({ x: goal.x + 0.5, z: goal.z + 0.5 });
    expect(path!.some((c) => sim.areas.areaOf({ roofId: GROUND, x: Math.floor(c.x), z: Math.floor(c.z) }) === PARK)).toBe(true);
    for (const c of path!) expect(w.walkable(GROUND, Math.floor(c.x), Math.floor(c.z))).toBe(true);
  });

  it('acts on the cell in front, 8 ways', () => {
    const p = { roofId: GROUND, x: 5.5, z: 5.5, facing: 0 };
    expect(w.front(p)).toEqual({ x: 5, z: 6 });
    p.facing = Math.PI / 2;
    expect(w.front(p)).toEqual({ x: 6, z: 5 });
    p.facing = Math.PI / 4;
    expect(w.front(p)).toEqual({ x: 6, z: 6 });
    p.facing = Math.PI;
    expect(w.front(p)).toEqual({ x: 5, z: 4 });
  });

  it('acts on the cell its facing ray enters first (depth), not the facing rounded to 8 ways', () => {
    // near the right edge of its cell, facing 30° off +z: its face is at the cell to the right, right beside it
    const p = { roofId: GROUND, x: 5.92, z: 5.1, facing: Math.PI / 6 };
    expect(w.front(p)).toEqual({ x: 6, z: 5 });
    // the same facing from the left edge: the ray goes out through the top first
    p.x = 5.08;
    p.z = 5.8;
    expect(w.front(p)).toEqual({ x: 5, z: 6 });
    // 36° from the middle of the cell (the old rounding said diagonal) leaves through the top, not the far corner
    p.x = 5.5;
    p.z = 5.5;
    p.facing = (36 * Math.PI) / 180;
    expect(w.front(p)).toEqual({ x: 5, z: 6 });
    // through (nearly) the corner: the diagonal cell
    p.facing = (44 * Math.PI) / 180;
    expect(w.front(p)).toEqual({ x: 6, z: 6 });
    // every way round, the cell it acts on touches bloombot's own cell
    for (let a = 0; a < 360; a += 7) {
      p.facing = (a * Math.PI) / 180;
      const f = w.front(p);
      expect(Math.max(Math.abs(f.x - 5), Math.abs(f.z - 5)), `${a}°`).toBe(1);
    }
  });

  it('is pushed to the nearest free cell when something solid appears under it', () => {
    const p = spawnPose(sim, w);
    const t = sim.grid.get(GROUND, Math.floor(p.x), Math.floor(p.z))!;
    t.blocked = true;
    expect(w.fits(p.roofId, p.x, p.z)).toBe(false);
    expect(w.settle(p)).toBe(true);
    expect(w.fits(p.roofId, p.x, p.z)).toBe(true);
    t.blocked = false;
  });

  it('keeps its place through a save round trip, and old saves have none', () => {
    const saver = new SaveService();
    const fresh = new Sim(createInitialState(3));
    expect(saver.deserialize(saver.serialize(fresh.state))!.bot).toBeUndefined();
    fresh.state.bot = { roofId: GROUND, x: 9.25, z: 11.75, facing: 1.5 };
    expect(saver.deserialize(saver.serialize(fresh.state))!.bot).toEqual({ roofId: GROUND, x: 9.25, z: 11.75, facing: 1.5 });
  });

  it('leaves the save alone: a scripted run never writes bloombot into its save', () => {
    let sim: Sim | undefined;
    runOldCityBot(5, 3, 'tier1', { onSecond: (x) => (sim = x) });
    expect(sim!.state.bot).toBeUndefined();
    expect(new SaveService().serialize(sim!.state)).not.toContain('"bot"');
  });

  it('walks one chunk in a straight line without leaving legal ground', () => {
    const p = spawnPose(sim, w);
    for (let i = 0; i < CHUNK * 4; i++) w.move(p, 0.25, 0);
    expect(w.fits(p.roofId, p.x, p.z)).toBe(true);
  });
});
