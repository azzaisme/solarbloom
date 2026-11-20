import { REST } from '../data/rest';

/**
 * E23.2.4: a bench's own frame and the boxes in it. A bench stands in the middle of its tile, turned by `facing`
 * (radians, 0 = facing +z, as bloombot's facing is): across it is (cos f, -sin f) in the world and ahead of it
 * (sin f, cos f), the way Resting seats bloombot on it.
 */
export interface Frame {
  cx: number;
  cz: number;
  facing: number;
}

/** A box in a bench's (or pad's) own frame: `x` across and `z` ahead in that frame, each [min, max]; `y` in the world. */
export interface SeatBox extends Frame {
  x: readonly number[];
  y: readonly number[];
  z: readonly number[];
}

/** A world box, axis-aligned. */
export interface WorldBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** The frame of a bench on tile (`x`, `z`), turned by `facing`. */
export function benchFrame(b: { x: number; z: number; facing: number }): Frame {
  return { cx: b.x + 0.5, cz: b.z + 0.5, facing: b.facing };
}

/** A point `u` across and `w` ahead in the frame, in the world (x, z). */
export function toWorld(f: Frame, u: number, w: number): [number, number] {
  const c = Math.cos(f.facing);
  const s = Math.sin(f.facing);
  return [f.cx + u * c + w * s, f.cz - u * s + w * c];
}

/** A world point's distance ahead in the box's own frame, if it is within the box across and ahead. */
export function inBox(b: SeatBox, x: number, z: number): number | undefined {
  const c = Math.cos(b.facing);
  const s = Math.sin(b.facing);
  const dx = x - b.cx;
  const dz = z - b.cz;
  const u = dx * c - dz * s;
  const w = dx * s + dz * c;
  return u > b.x[0] && u < b.x[1] && w > b.z[0] && w < b.z[1] ? w : undefined;
}

/** The world box around a box in the frame (its four corners turned into the world). */
export function worldBounds(f: Frame, us: readonly number[], ws: readonly number[], y0 = 0, y1 = 0): WorldBox {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const u of us)
    for (const w of ws) {
      const [x, z] = toWorld(f, u, w);
      xs.push(x);
      zs.push(z);
    }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0, y1, z0: Math.min(...zs), z1: Math.max(...zs) };
}

/**
 * A bench's boxes with its ground at `by`: its footprint (REST.benchFoot) and solid parts (REST.benchSolids) as world
 * boxes, for the animals; and its seat and backrest in its own frame, for bloombot to settle onto and keep out of.
 */
export function benchBoxes(b: { x: number; z: number; facing: number }, by: number) {
  const f = benchFrame(b);
  const { along, back, front } = REST.benchFoot;
  const [seat, rest] = REST.benchSolids;
  return {
    footprint: worldBounds(f, [-along, along], [-back, front]),
    solids: REST.benchSolids.map((p) => worldBounds(f, p.x, p.z, by + p.y[0], by + p.y[1])),
    seat: { ...f, x: seat.x, z: seat.z, y: [by + seat.y[0], by + seat.y[1]] } as SeatBox,
    back: { ...f, x: rest.x, z: rest.z, y: [by + rest.y[0], by + rest.y[1]] } as SeatBox,
  };
}
