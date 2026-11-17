import { describe, expect, it } from 'vitest';
import { SaveService } from '../src/app/SaveService';
import { PARK } from '../src/core/Areas';
import { createInitialState, GROUND } from '../src/core/GameState';
import { CHUNK } from '../src/core/Hash';
import { Rng } from '../src/core/Rng';
import { Sim } from '../src/gameplay/Sim';
import { BOT, spawnPose, Walker } from '../src/gameplay/Walker';

/** A city with the park and at least 40 areas around it revealed, most of them cleared. */
function bigCity(seed = 7) {
  const sim = new Sim(createInitialState(seed));
  sim.state.progression.coreActivated = true;
  sim.areas.clear(PARK, true);
  for (let r = 1; r <= 6 && sim.areas.revealed().length < 40; r++)
    for (let cz = -r; cz <= r; cz++)
      for (let cx = -r; cx <= r; cx++) {
        if (Math.max(Math.abs(cx), Math.abs(cz)) !== r) continue;
        const id = sim.areas.map.areaOfChunk(cx, cz);
        if (sim.areas.fog(id) !== 'hidden') sim.areas.clear(id, true);
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

  it('reveals a city of at least 40 areas for the walk tests', () => {
    expect(sim.areas.revealed().length).toBeGreaterThanOrEqual(40);
  });

  it('starts beside the park fountain, on legal ground', () => {
    const p = spawnPose(sim, w);
    expect(w.fits(p.roofId, p.x, p.z)).toBe(true);
    expect(sim.areas.map.areaOfCell(Math.floor(p.x), Math.floor(p.z))).toBe(PARK);
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
    const p = spawnPose(sim, w);
    const goal = { x: 2, z: 2 };
    const path = w.path(GROUND, p.x, p.z, (x, z) => x === goal.x && z === goal.z, goal);
    expect(path).toBeDefined();
    expect(path!.at(-1)).toEqual({ x: 2.5, z: 2.5 });
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

  it('walks one chunk in a straight line without leaving legal ground', () => {
    const p = spawnPose(sim, w);
    for (let i = 0; i < CHUNK * 4; i++) w.move(p, 0.25, 0);
    expect(w.fits(p.roofId, p.x, p.z)).toBe(true);
  });
});
