import { expect } from 'vitest';
import { GROUND } from '../src/core/GameState';
import { levelY } from '../src/core/Height';
import { causewayRamps } from '../src/core/Mainland';
import { PARK_SET, REGIONS, type RampDef } from '../src/data/oldcity';
import type { Sim } from '../src/gameplay/Sim';
import { PIPE_SIZE, pipeHeight, pipeRun, pipeSurface, type V3 } from '../src/rendering/PipeVisuals';

/** Every stair and ramp in the world: the park's, the regions', the causeway's. */
export function allFlights(): RampDef[] {
  return [...PARK_SET.ramps, ...REGIONS.flatMap((r) => r.ramps), ...causewayRamps()];
}

/**
 * A pipe straight up a flight's middle row, from the tile below one end to the tile beyond the other (in world
 * order, along x or z), as each tile draws it: its two half-runs (pipeRun), the back one read from the edge in. The
 * flight's tiles and the ground round it are generated first, as when their chunk loads.
 */
export function lineUp(sim: Sim, ramp: RampDef) {
  for (let z = ramp.z - 1; z <= ramp.z + ramp.d; z++) for (let x = ramp.x - 1; x <= ramp.x + ramp.w; x++) expect(sim.grid.get(GROUND, x, z)).toBeDefined();
  const alongZ = ramp.dir === 'n' || ramp.dir === 's';
  const row = alongZ ? ramp.x + Math.floor(ramp.w / 2) : ramp.z + Math.floor(ramp.d / 2);
  const c0 = alongZ ? ramp.z : ramp.x;
  const n = alongZ ? ramp.d : ramp.w;
  const tiles: { c: number; back: V3[]; fwd: V3[] }[] = [];
  for (let c = c0 - 1; c <= c0 + n; c++) {
    const [x, z] = alongZ ? [row, c] : [c, row];
    const [cx, cz] = [x + 0.5, z + 0.5];
    const back = pipeRun(sim, x, z, cx, cz, alongZ ? cx : cx - 0.5, alongZ ? cz - 0.5 : cz).reverse();
    const fwd = pipeRun(sim, x, z, cx, cz, alongZ ? cx : cx + 0.5, alongZ ? cz + 0.5 : cz);
    tiles.push({ c, back, fwd });
  }
  return { alongZ, c0, n, tiles, at: (p: V3) => (alongZ ? p[2] : p[0]) };
}

const pitchOf = (a: V3, b: V3, alongZ: boolean) => (b[1] - a[1]) / (alongZ ? b[2] - a[2] : b[0] - a[0]);

/**
 * The checks every flight passes, either way up: the pipe clears every tread; it meets every tile edge level (no
 * drop anywhere, the foot included); between its two bends (where it levels off at the top, and just past the foot)
 * it is one straight slope at the flight's own pitch, the treads stepping under it; and its stretches meet each other
 * end to end with no gap. Returns which way the flight climbs.
 */
export function checkFlight(sim: Sim, ramp: RampDef): 'rising' | 'falling' {
  const tag = `${ramp.dir} ${ramp.x},${ramp.z} ${ramp.from}→${ramp.to}`;
  const { alongZ, c0, n, tiles, at } = lineUp(sim, ramp);
  const flightPitch = (levelY(ramp.to) - levelY(ramp.from)) / n; // per tile along the flight's own way
  const sign = ramp.dir === 's' || ramp.dir === 'e' ? 1 : -1; // its own way, in world order
  const worldPitch = flightPitch * sign;
  // one line, world order, every stretch
  const line: V3[] = [];
  for (const t of tiles) {
    for (const half of [t.back, t.fwd]) {
      // each half starts where the last ended: at the middle (both halves read it there) and at the edges (the two tiles meet level)
      if (line.length) expect(Math.abs(half[0][1] - line[line.length - 1][1]), `${tag}: a step at ${at(half[0]).toFixed(3)}`).toBeLessThan(1e-3);
      line.push(...(line.length ? half.slice(1) : half));
    }
  }
  // clears every tread, its nosing too, by the flat gap at least (every 1 cm)
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const len = Math.abs(at(b) - at(a));
    for (let s = 0; s <= len; s += 0.01) {
      const k = len ? s / len : 0;
      const p: V3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      const gap = p[1] - PIPE_SIZE.r - pipeSurface(sim, p[0], p[2]);
      expect(gap, `${tag}: clearance at ${at(p).toFixed(3)}`).toBeGreaterThanOrEqual(PIPE_SIZE.clear - 1e-6);
      // and the drawn line is the pipe's height there (within the tile it lies in)
      expect(Math.abs(p[1] - pipeHeight(sim, p[0], p[2])), `${tag}: off its height at ${at(p).toFixed(3)}`).toBeLessThan(1e-6);
    }
  }
  // the bends: where its pitch changes. Exactly two: where it levels off at the top, and where it meets the ground past the foot
  const pitches: { from: number; to: number; pitch: number }[] = [];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    if (Math.abs(at(b) - at(a)) < 1e-9) continue;
    const p = pitchOf(a, b, alongZ);
    const last = pitches[pitches.length - 1];
    if (last && Math.abs(last.pitch - p) < 1e-4) last.to = at(b); // (one pitch, read tile by tile)
    else pitches.push({ from: at(a), to: at(b), pitch: p });
  }
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0; // (+0: no -0)
  expect(pitches.map((p) => r4(p.pitch)), `${tag}: level, the flight's slope, level`).toEqual([0, r4(worldPitch), 0]);
  const [, slope] = pitches;
  // the flight in world order spans [c0, c0 + n]; its low end is where the pipe comes down to
  const lowAt = worldPitch > 0 ? c0 : c0 + n;
  const highAt = worldPitch > 0 ? c0 + n : c0;
  const footBend = worldPitch > 0 ? slope.from : slope.to;
  const topBend = worldPitch > 0 ? slope.to : slope.from;
  // past the foot, on the flat tile there, under half a tile out (it reaches the level run before the tile's middle)
  expect(Math.abs(footBend - lowAt), `${tag}: the foot's bend`).toBeGreaterThan(0.05);
  expect(Math.abs(footBend - lowAt), `${tag}: the foot's bend`).toBeLessThan(0.45);
  expect(worldPitch > 0 ? footBend < lowAt : footBend > lowAt, `${tag}: the foot's bend lies beyond the flight`).toBe(true);
  // the top's on the flight's top tile, where it levels off to meet the ground above
  expect(Math.abs(topBend - highAt), `${tag}: the top's bend`).toBeLessThan(1);
  expect(worldPitch > 0 ? topBend < highAt : topBend > highAt, `${tag}: the top's bend lies on the flight`).toBe(true);
  // the treads under it do step (a real stair or ramp, not one drawn smooth)
  const ground: number[] = [];
  for (let s = slope.from; s <= slope.to; s += 0.01) ground.push(pipeSurface(sim, alongZ ? tiles[0].fwd[0][0] : s, alongZ ? s : tiles[0].fwd[0][2]));
  expect(ground.some((g, i) => i > 0 && Math.abs(g - ground[i - 1]) > 0.02), `${tag}: treads`).toBe(true);
  return flightPitch > 0 ? 'rising' : 'falling';
}
