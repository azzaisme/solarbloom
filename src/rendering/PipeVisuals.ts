import * as pc from 'playcanvas';
import { GROUND, machinesStamp } from '../core/GameState';
import { levelY, rampAt } from '../core/Height';
import { SLAB_TOP } from '../core/Picking';
import type { Sim } from '../gameplay/Sim';
import { mat } from './Materials';
import { PALETTE } from './Palette';

/**
 * Pipe size (tiles; a tile is about a metre): the tube's radius; `clear`, the gap under it (10 cm above whatever is
 * below: a slab, a stair's or a ramp's tread), held up by a stick; its joints, flanges and sight glass. `treadTop` is
 * how far a stair's tread (its coping) stands above its step's level (ChunkRenderer.terrace).
 */
const PIPE = { r: 0.075, clear: 0.1, stick: 0.035, foot: 0.09, joint: 0.105, flange: 0.098, flangeLen: 0.035, elbow: 0.04, sides: 10, glass: 0.13, treadTop: 0.1 };

/** A point or direction in the world. */
export type V3 = [number, number, number];

function unit(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Flat lists a mesh is built from. */
class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  idx: number[] = [];

  /** A tube between two points on the same height, along x or z. */
  tube(ax: number, az: number, bx: number, bz: number, y: number, r: number, sides = PIPE.sides) {
    // always from the lower end to the higher (the winding below assumes it: a run toward −x/−z came out inside out)
    if (bx < ax || bz < az) [ax, az, bx, bz] = [bx, bz, ax, az];
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    const base = this.pos.length / 3;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // ring offset perpendicular to the run: (0, c, s) along x, (s, c, 0) along z
      const [ox, oy, oz] = alongX ? [0, c, s] : [s, c, 0];
      this.pos.push(ax + ox * r, y + oy * r, az + oz * r, bx + ox * r, y + oy * r, bz + oz * r);
      this.nrm.push(ox, oy, oz, ox, oy, oz);
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2;
      // wound so the outside faces out
      if (alongX) this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  /**
   * A tube along a run: points in one upright plane (a tile's half-run, level or following a stair's slope). Where
   * its pitch changes it bends cleanly: the ring there lies in the plane halfway between the two stretches (a mitred
   * joint), so they meet with no gap and no overlap. `before` / `after`: the way the pipe comes in before the first
   * point and goes on after the last (the next run), so the end rings are mitred to meet it as well.
   */
  path(pts: V3[], r: number, before?: V3, after?: V3, sides = PIPE.sides) {
    const p = pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1], q[2] - pts[i - 1][2]) > 1e-6);
    if (p.length < 2) return;
    const dirs = p.slice(1).map((q, i) => unit([q[0] - p[i][0], q[1] - p[i][1], q[2] - p[i][2]]));
    // side: level and square to the run (every stretch shares it); up: square to a stretch, in the upright plane
    const h = Math.hypot(dirs[0][0], dirs[0][2]) || 1;
    const S: V3 = [-dirs[0][2] / h, 0, dirs[0][0] / h];
    const up = (d: V3): V3 => {
      const u = unit([S[1] * d[2] - S[2] * d[1], S[2] * d[0] - S[0] * d[2], S[0] * d[1] - S[1] * d[0]]);
      return u[1] < 0 ? [-u[0], -u[1], -u[2]] : u;
    };
    // only a neighbouring run in the same upright plane, carrying on the same way, is mitred to
    const same = (d: V3 | undefined) => (d && Math.abs(d[0] * S[0] + d[2] * S[2]) < 1e-6 && d[0] * dirs[0][0] + d[2] * dirs[0][2] > 0 ? d : undefined);
    const ups = dirs.map(up);
    // each ring: the mitre's up (halfway between the stretches' ups) and how much it stretches to meet both
    const rings = p.map((_, k) => {
      const a = k === 0 ? same(before) : dirs[k - 1];
      const b = k === p.length - 1 ? same(after) : dirs[k];
      if (!a || !b) return { m: ups[Math.min(k, ups.length - 1)], s: 1 };
      const ua = up(a);
      const m = unit([ua[0] + up(b)[0], ua[1] + up(b)[1], ua[2] + up(b)[2]]);
      return { m, s: 1 / Math.max(0.2, m[0] * ua[0] + m[1] * ua[1] + m[2] * ua[2]) };
    });
    for (let j = 0; j < dirs.length; j++) {
      const base = this.pos.length / 3;
      const U = ups[j];
      for (let i = 0; i <= sides; i++) {
        const t = (i / sides) * Math.PI * 2;
        const c = Math.cos(t);
        const s = Math.sin(t);
        for (const k of [j, j + 1]) {
          const { m, s: st } = rings[k];
          this.pos.push(p[k][0] + r * (c * m[0] * st + s * S[0]), p[k][1] + r * c * m[1] * st, p[k][2] + r * (c * m[2] * st + s * S[2]));
          // shaded as the stretch's own round tube
          this.nrm.push(c * U[0] + s * S[0], c * U[1], c * U[2] + s * S[2]);
        }
      }
      // wound so the outside faces out: check the first quad's face against its ring's outward offset
      const q = this.pos;
      const A = base * 3;
      const e1 = [q[A + 3] - q[A], q[A + 4] - q[A + 1], q[A + 5] - q[A + 2]];
      const e2 = [q[A + 6] - q[A], q[A + 7] - q[A + 1], q[A + 8] - q[A + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const out = n[0] * this.nrm[A] + n[1] * this.nrm[A + 1] + n[2] * this.nrm[A + 2] > 0;
      for (let i = 0; i < sides; i++) {
        const v = base + i * 2;
        if (out) this.idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        else this.idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
  }

  /** A short upright drum (a joint at a corner or junction, or a cap). */
  drum(x: number, z: number, y0: number, y1: number, r: number, sides = PIPE.sides) {
    const base = this.pos.length / 3;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.pos.push(x + c * r, y0, z + s * r, x + c * r, y1, z + s * r);
      this.nrm.push(c, 0, s, c, 0, s);
    }
    for (let i = 0; i < sides; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const top = this.pos.length / 3;
    this.pos.push(x, y1, z);
    this.nrm.push(0, 1, 0);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      this.pos.push(x + Math.cos(a) * r, y1, z + Math.sin(a) * r);
      this.nrm.push(0, 1, 0);
    }
    for (let i = 0; i < sides; i++) this.idx.push(top, top + 2 + i, top + 1 + i);
  }

  /** An axis-aligned box (sight glasses, brackets). */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const faces: [number[], number[][]][] = [
      [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
      [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
      [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
      [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
      [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
    ];
    for (const [n, cs] of faces) {
      const b = this.pos.length / 3;
      for (const [cx, cy, cz] of cs) {
        this.pos.push(x + (cx * sx) / 2, y + (cy * sy) / 2, z + (cz * sz) / 2);
        this.nrm.push(n[0], n[1], n[2]);
      }
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }

  mesh(device: pc.GraphicsDevice): pc.Mesh | undefined {
    if (!this.idx.length) return undefined;
    const m = new pc.Mesh(device);
    m.setPositions(this.pos);
    m.setNormals(this.nrm);
    m.setIndices(this.idx);
    m.update(pc.PRIMITIVE_TRIANGLES);
    return m;
  }
}

/** Where a point lies on a stair or ramp: its ramp, how many treads a tile of it has, and how far up it (0…1). */
function onRamp(px: number, pz: number) {
  const x = Math.floor(px);
  const z = Math.floor(pz);
  const hit = rampAt(x, z);
  if (!hit) return undefined;
  const steps = hit.ramp.kind === 'stair' ? 2 : 3;
  const fx = px - x;
  const fz = pz - z;
  const u = hit.ramp.dir === 's' ? fz : hit.ramp.dir === 'n' ? 1 - fz : hit.ramp.dir === 'e' ? fx : 1 - fx;
  return { hit, steps, u, f: (hit.i + u) / hit.n };
}

/** The top of what lies under a point (world y): a terrace tile's slab, or the tread of a stair's or ramp's step. */
export function pipeSurface(sim: Sim, px: number, pz: number): number {
  const base = sim.grid.layer(GROUND)!.height;
  const t = sim.grid.peek(GROUND, Math.floor(px), Math.floor(pz));
  const on = t?.ramp ? onRamp(px, pz) : undefined;
  if (on) {
    // drawn as `steps` treads from its low end to its high end (ChunkRenderer.terrace), coping on top
    const { hit, steps, u } = on;
    const k = Math.min(steps - 1, Math.max(0, Math.floor(u * steps)));
    const lv = hit.ramp.from + ((hit.ramp.to - hit.ramp.from) * (hit.i + (k + 0.5) / steps)) / hit.n;
    return base + levelY(lv) + PIPE.treadTop;
  }
  return base + levelY(t?.level ?? 1) + SLAB_TOP;
}

/**
 * The pipe's centre over a point. On flat ground: `clear` above what lies under it. On a stair or ramp: one straight
 * slope, the way a pipe runs down real steps, that just clears the nosing of every tread (the line through the
 * treads' middles, raised half a step), levelling off to meet the ground at the top. A run across a flight keeps to
 * one point of that slope, so it is level. On flat ground at a flight's foot the slope carries on past the foot and
 * bends level where it meets the height a pipe runs at there (`footSlope`).
 */
export function pipeHeight(sim: Sim, px: number, pz: number): number {
  const t = sim.grid.peek(GROUND, Math.floor(px), Math.floor(pz));
  const on = t?.ramp ? onRamp(px, pz) : undefined;
  if (!on) {
    const flat = pipeSurface(sim, px, pz) + PIPE.clear + PIPE.r;
    return Math.max(flat, footSlope(sim, px, pz, flat));
  }
  const { hit, steps, f } = on;
  const { from, to } = hit.ramp;
  const base = sim.grid.layer(GROUND)!.height;
  const half = 0.5 / (steps * hit.n); // half a tread, as a share of the whole ramp
  const lv = from + (to - from) * (f + (to > from ? half : -half));
  const hi = Math.max(from, to);
  // at the top it meets the ground there: never above the higher of that ground and the top tread
  const cap = Math.max(levelY(hi) + SLAB_TOP, levelY(hi - Math.abs(to - from) * half) + PIPE.treadTop);
  return base + Math.min(levelY(lv) + PIPE.treadTop, cap) + PIPE.clear + PIPE.r;
}

/** Which way a ramp's tiles count up (from its `from` end toward its `to` end). */
const RAMP_DIR: Record<string, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
/** How far past a flight's foot its slope may carry on to meet the ground (tiles: under half a tile, so never as far as the next tile's middle). */
const FOOT_REACH = 0.45;

/**
 * On a flat tile just beyond the low end of a stair or ramp: the flight's slope carried on past its foot, so a pipe
 * coming down meets the height it runs at here in one clean bend (instead of dropping off the bottom tread). -Infinity
 * where there is none: no flight ends at this tile, or its slope would not come down to this tile's height within
 * `FOOT_REACH` of the edge (a wall at its foot: there the pipe drops, as at any step).
 */
function footSlope(sim: Sim, px: number, pz: number, flat: number): number {
  const x = Math.floor(px);
  const z = Math.floor(pz);
  let best = -Infinity;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
    if (!sim.grid.peek(GROUND, x + dx, z + dz)?.ramp) continue;
    const hit = rampAt(x + dx, z + dz);
    if (!hit || hit.ramp.from === hit.ramp.to) continue;
    const [ux, uz] = RAMP_DIR[hit.ramp.dir];
    const lowFirst = hit.ramp.from < hit.ramp.to; // its low end is where its tiles start
    // this tile lies beyond the flight's low end (not beside the flight, not above its top)
    const [ox, oz] = lowFirst ? [-ux, -uz] : [ux, uz];
    if (ox !== -dx || oz !== -dz || hit.i !== (lowFirst ? 0 : hit.n - 1)) continue;
    // the edge the two tiles share, and how far the point is from it
    const ex = dx === 1 ? x + 1 : dx === -1 ? x : px;
    const ez = dz === 1 ? z + 1 : dz === -1 ? z : pz;
    const d = Math.abs(px - ex) + Math.abs(pz - ez);
    const atFoot = pipeHeight(sim, ex + dx * 1e-6, ez + dz * 1e-6);
    const pitch = Math.abs(levelY(hit.ramp.to) - levelY(hit.ramp.from)) / hit.n;
    if (atFoot <= flat || (atFoot - flat) / pitch > FOOT_REACH) continue;
    best = Math.max(best, atFoot - pitch * d);
  }
  return best;
}

/**
 * The pipe's run within tile (x, z) from (ax, az) to (bx, bz) (a half-run: its middle to an edge), as its centre's
 * points: one at each end and one wherever its pitch changes (the top of a flight, the bend past its foot). Heights
 * are read just inside the tile, as its far edge belongs to the next one.
 */
export function pipeRun(sim: Sim, x: number, z: number, ax: number, az: number, bx: number, bz: number): V3[] {
  const N = 24;
  const L = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / (L || 1);
  const uz = (bz - az) / (L || 1);
  const inside = (d: number): [number, number] => [Math.min(x + 1 - 1e-4, Math.max(x + 1e-4, ax + ux * d)), Math.min(z + 1 - 1e-4, Math.max(z + 1e-4, az + uz * d))];
  const ds = Array.from({ length: N + 1 }, (_, k) => {
    const [px, pz] = inside((k / N) * L);
    return Math.abs(px - ax) + Math.abs(pz - az);
  });
  const ys = ds.map((d) => pipeHeight(sim, ...inside(d)));
  // stretches of one pitch (height per tile along the run)
  const runs: { i: number; j: number; s: number }[] = [];
  for (let k = 0; k < N; k++) {
    const s = (ys[k + 1] - ys[k]) / Math.max(1e-9, ds[k + 1] - ds[k]);
    const last = runs[runs.length - 1];
    if (last && Math.abs(s - last.s) < 1e-5) last.j = k + 1;
    else runs.push({ i: k, j: k + 1, s });
  }
  const line = (g: { i: number; s: number }, d: number) => ys[g.i] + g.s * (d - ds[g.i]);
  const out: [number, number][] = [[0, ys[0]]]; // (distance along, height)
  for (let g = 0; g < runs.length - 1; g++) {
    const a = runs[g];
    const m = runs[g + 1];
    const b = runs[g + 2];
    // a pitch change between two samples: one short stretch between two long ones; the bend is where those meet
    if (b && m.j - m.i === 1 && Math.abs(a.s - b.s) > 1e-9) {
      const d = (ys[b.i] - b.s * ds[b.i] - ys[a.i] + a.s * ds[a.i]) / (a.s - b.s);
      if (d >= ds[m.i] - 1e-9 && d <= ds[m.j] + 1e-9) {
        out.push([d, line(a, d)]);
        g++;
        continue;
      }
    }
    out.push([ds[a.j], ys[a.j]]);
  }
  // the far end exactly at the edge, carried on along the last stretch
  out.push([L, line(runs[runs.length - 1], L)]);
  return out.map(([d, y]) => [ax + ux * d, y, az + uz * d]);
}

/** One half of a pipe tile: its middle to the side it joins. */
export interface PipeHalf {
  /** the side (a unit step in x or z) */
  dx: number;
  dz: number;
  /** its centre line (pipeRun) */
  pts: V3[];
  /** does it slope anywhere (no flange then) */
  sloped: boolean;
  /** the way the pipe comes into the middle along the other half (straight through only) */
  before?: V3;
  /** the way it goes on past the edge into the next tile (where they meet level) */
  after?: V3;
}

/** A drop where the ground steps under a pipe at a tile's edge, at (x, z): from `hi` (this side) down to `lo`; (dx, dz) points back toward the higher side. */
export interface PipeRiser {
  x: number;
  z: number;
  dx: number;
  dz: number;
  lo: number;
  hi: number;
}

/** What a pipe tile is drawn as. */
export interface PipeTile {
  x: number;
  z: number;
  wet: boolean;
  halves: PipeHalf[];
  /** drops at its edges down to a lower neighbour (the higher tile draws them) */
  risers: PipeRiser[];
  /** a straight run through (no joint at its middle) */
  straight: boolean;
}

const dirOf = (a: V3, b: V3): V3 => unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
const levelRun = (pts: V3[]) => pts.every((q) => Math.abs(q[1] - pts[0][1]) < 1e-5);

/** Every pipe tile's layout: its half-runs, how they join the runs next to them, and its drops. */
export function pipePlan(sim: Sim): PipeTile[] {
  const p = sim.water.pipes;
  const sidesOf = (x: number, z: number): [number, number][] => [...p.links(x, z).map(([nx, nz]) => [nx - x, nz - z] as [number, number]), ...p.machineLinks(x, z).map((l) => [l.dx, l.dz] as [number, number])];
  const runs = new Map<string, V3[]>();
  const runOf = (x: number, z: number, dx: number, dz: number) => {
    const k = `${x},${z},${dx},${dz}`;
    let r = runs.get(k);
    if (!r) runs.set(k, (r = pipeRun(sim, x, z, x + 0.5, z + 0.5, x + 0.5 + dx * 0.5, z + 0.5 + dz * 0.5)));
    return r;
  };
  const out: PipeTile[] = [];
  for (const key of p.keys()) {
    const [x, z] = key.split(',').map(Number);
    const sides = sidesOf(x, z);
    const straight = sides.length === 2 && sides[0][0] === -sides[1][0] && sides[0][1] === -sides[1][1];
    const tile: PipeTile = { x, z, wet: p.carries(x, z), halves: [], risers: [], straight };
    for (const [dx, dz] of sides) {
      const pts = runOf(x, z, dx, dz);
      const half: PipeHalf = { dx, dz, pts, sloped: !levelRun(pts) };
      if (straight) {
        const [ox, oz] = sides.find(([sx, sz]) => sx !== dx || sz !== dz)!;
        const other = runOf(x, z, ox, oz);
        half.before = dirOf(other[1], other[0]); // coming into the middle along the other half
      }
      if (p.has(x + dx, z + dz)) {
        // the next tile's half-run toward this edge, read back from the edge
        const next = runOf(x + dx, z + dz, -dx, -dz);
        const ny = next[next.length - 1][1];
        const my = pts[pts.length - 1][1];
        if (Math.abs(ny - my) < 1e-3) half.after = dirOf(next[next.length - 1], next[next.length - 2]);
        else if (ny < my) tile.risers.push({ x: x + 0.5 + dx * 0.5, z: z + 0.5 + dz * 0.5, dx: -dx, dz: -dz, lo: ny, hi: my });
      }
      tile.halves.push(half);
    }
    out.push(tile);
  }
  return out;
}

/** A sight glass: where it sits (its middle) and whether it shows water. */
export interface PipeGlass {
  x: number;
  y: number;
  z: number;
  wet: boolean;
}

/**
 * The sight glasses: one on top of each pipe tile's middle, on its highest run there. None where the pipe slopes at
 * its middle (on a flight): a level glass would stick out of it.
 */
export function pipeGlass(sim: Sim, plan = pipePlan(sim)): PipeGlass[] {
  const out: PipeGlass[] = [];
  for (const t of plan) {
    if (t.halves.some((h) => Math.abs(h.pts[1][1] - h.pts[0][1]) > 1e-5)) continue;
    const ys = t.halves.map((h) => h.pts[0][1]);
    const y = Math.max(...(ys.length ? ys : [pipeHeight(sim, t.x + 0.5, t.z + 0.5)]));
    out.push({ x: t.x + 0.5, y: y + PIPE.r * 0.85 + 0.01, z: t.z + 0.5, wet: t.wet });
  }
  return out;
}

/** Pipe sizes, for the tests. */
export const PIPE_SIZE = PIPE;

/**
 * E23.4.2.2 (#424): pipes in the world. Each pipe tile is a pale-blue tube from its middle to every side it joins
 * (a neighbouring pipe, a pump or a reservoir), with a cream joint where it turns or branches, a cap where it ends,
 * flanges at the tile edges, and a small sight glass on top that shows water when the pipe carries some and dark
 * glass when it is dry. The body is rebuilt only when pipes are laid or lifted (or machines change); the sight
 * glasses when what carries water changes. The layout is `pipePlan` and `pipeGlass`; this draws it.
 */
export class PipeVisuals {
  private body?: pc.Entity;
  private glass?: pc.Entity;
  private meshes: pc.Mesh[] = [];
  private glassMeshes: pc.Mesh[] = [];
  private stamp = '';
  private wetStamp = '';
  private acc = 0;

  constructor(
    private sim: Sim,
    private parent: pc.Entity,
    private device: pc.GraphicsDevice,
  ) {}

  update(dt: number) {
    const p = this.sim.water.pipes;
    const st = `${p.version}|${p.keys().length}|${machinesStamp(this.sim.state.machines)}`;
    let rebuilt = false;
    if (st !== this.stamp) {
      this.stamp = st;
      this.wetStamp = '';
      rebuilt = true;
    }
    this.acc += dt;
    if (!rebuilt && this.acc < 0.25 && this.wetStamp) return;
    this.acc = 0;
    const wet = p
      .keys()
      .map((k) => {
        const [x, z] = k.split(',').map(Number);
        return p.carries(x, z) ? '1' : '0';
      })
      .join('');
    if (wet !== this.wetStamp || rebuilt) {
      this.wetStamp = wet;
      // the body keeps carrying and dry pipes apart (the Water view turns only the carrying ones into holograms)
      const plan = pipePlan(this.sim);
      this.buildBody(plan);
      this.buildGlass(plan);
    }
  }

  /** E23.4.5 the Water view's hologram for the pipes that carry water (undefined: their own look). */
  private holoMat?: pc.Material;
  private wetParts: pc.MeshInstance[] = [];
  private wetOrig = new Map<pc.MeshInstance, pc.Material>();

  /** The Water view: pipes that carry water show as `mat` (a hologram); undefined puts their own look back. */
  holo(mat: pc.Material | undefined) {
    if (mat === this.holoMat) return;
    this.holoMat = mat;
    for (const mi of this.wetParts) mi.material = mat ?? this.wetOrig.get(mi)!;
    if (this.glass) this.glass.enabled = !mat; // the sight glasses would float inside the hologram
  }

  private clear(which: 'body' | 'glass') {
    if (which === 'body') {
      this.body?.destroy();
      this.body = undefined;
      for (const m of this.meshes) m.destroy();
      this.meshes = [];
    } else {
      this.glass?.destroy();
      this.glass = undefined;
      for (const m of this.glassMeshes) m.destroy();
      this.glassMeshes = [];
    }
  }

  private surface(px: number, pz: number): number {
    return pipeSurface(this.sim, px, pz);
  }

  /**
   * Where the ground steps under a pipe: an upright between the two heights standing just in front of the riser
   * (on the lower side, never inside the step), the higher run carried over to it, an elbow drum at each end.
   */
  private riser(tube: Geo, trim: Geo, { x: px, z: pz, dx, dz, lo, hi }: PipeRiser) {
    const vx = px - dx * PIPE.r;
    const vz = pz - dz * PIPE.r;
    tube.drum(vx, vz, lo, hi, PIPE.r);
    tube.tube(vx, vz, px, pz, hi, PIPE.r);
    // short elbow fittings at each bend (tall collars hid the whole upright on a stair's low riser)
    trim.drum(vx, vz, lo - PIPE.elbow, lo + PIPE.elbow, PIPE.joint);
    trim.drum(vx, vz, hi - PIPE.elbow, hi + PIPE.elbow, PIPE.joint);
  }

  private buildBody(plan: PipeTile[]) {
    this.clear('body');
    const geo = { wet: { tube: new Geo(), trim: new Geo() }, dry: { tube: new Geo(), trim: new Geo() } };
    for (const t of plan) {
      const { tube, trim } = t.wet ? geo.wet : geo.dry;
      const cx = t.x + 0.5;
      const cz = t.z + 0.5;
      for (const h of t.halves) {
        // from the middle to the tile's edge: level, or following a flight as one straight pipe, bent cleanly where its pitch changes
        tube.path(h.pts, PIPE.r, h.before, h.after);
        // a little stick holding it up, in the middle of the half-run
        const mx = cx + h.dx * 0.25;
        const mz = cz + h.dz * 0.25;
        const ground = this.surface(mx, mz);
        const top = pipeHeight(this.sim, mx, mz) - PIPE.r;
        trim.box(mx, (ground + top) / 2, mz, PIPE.stick, top - ground, PIPE.stick);
        trim.box(mx, ground + 0.008, mz, PIPE.foot, 0.016, PIPE.foot);
        // a flange where tiles join (none on a run that slopes: rings stacked down a flight read as clutter)
        if (!h.sloped) {
          const fx = cx + h.dx * 0.47;
          const fz = cz + h.dz * 0.47;
          const y = h.pts[h.pts.length - 1][1];
          trim.tube(fx - h.dx * PIPE.flangeLen * 0.5, fz - h.dz * PIPE.flangeLen * 0.5, fx + h.dx * PIPE.flangeLen * 0.5, fz + h.dz * PIPE.flangeLen * 0.5, y, PIPE.flange);
        }
      }
      // where it meets a neighbouring pipe on lower ground (a terrace wall, a step at the tile's edge)
      for (const r of t.risers) this.riser(tube, trim, r);
      if (!t.halves.length) {
        // a lone tile: a capped stub on its stick
        const y = pipeHeight(this.sim, cx, cz);
        const ground = this.surface(cx, cz);
        trim.drum(cx, cz, y - PIPE.joint * 0.9, y + PIPE.joint * 0.9, PIPE.joint);
        trim.box(cx, (ground + y - PIPE.r) / 2, cz, PIPE.stick, y - PIPE.r - ground, PIPE.stick);
        trim.box(cx, ground + 0.008, cz, PIPE.foot, 0.016, PIPE.foot);
        continue;
      }
      const atMiddle = t.halves.map((h) => h.pts[0][1]);
      const lo = Math.min(...atMiddle);
      const hi = Math.max(...atMiddle);
      if (hi - lo > 1e-4) {
        // halves at different heights in the middle: an upright joins them, showing blue between two short elbow fittings
        tube.drum(cx, cz, lo, hi, PIPE.r);
        trim.drum(cx, cz, lo - PIPE.elbow, lo + PIPE.elbow, PIPE.joint);
        trim.drum(cx, cz, hi - PIPE.elbow, hi + PIPE.elbow, PIPE.joint);
      } else if (!t.straight) trim.drum(cx, cz, lo - PIPE.joint * 0.9, hi + PIPE.joint * 0.9, PIPE.joint); // a joint, junction or cap
    }
    const parts: pc.MeshInstance[] = [];
    this.wetParts = [];
    this.wetOrig.clear();
    const add = (g: Geo, m: pc.Material, wet: boolean) => {
      const mesh = g.mesh(this.device);
      if (!mesh) return;
      this.meshes.push(mesh);
      const mi = new pc.MeshInstance(mesh, wet && this.holoMat ? this.holoMat : m);
      if (wet) {
        this.wetParts.push(mi);
        this.wetOrig.set(mi, m);
      }
      parts.push(mi);
    };
    for (const wet of [true, false]) {
      const g = wet ? geo.wet : geo.dry;
      add(g.tube, mat(PALETTE.aqua.pipe, { gloss: 0.6, metal: 0.2 }), wet);
      add(g.trim, mat(PALETTE.shell, { gloss: 0.5 }), wet);
    }
    if (!parts.length) return;
    const e = new pc.Entity('pipes');
    e.addComponent('render', { meshInstances: parts, castShadows: true, receiveShadows: true });
    this.parent.addChild(e);
    this.body = e;
  }

  private buildGlass(plan: PipeTile[]) {
    this.clear('glass');
    const wet = new Geo();
    const dry = new Geo();
    for (const g of pipeGlass(this.sim, plan)) (g.wet ? wet : dry).box(g.x, g.y, g.z, PIPE.glass, 0.05, PIPE.glass);
    const parts: pc.MeshInstance[] = [];
    const add = (g: Geo, m: pc.Material) => {
      const mesh = g.mesh(this.device);
      if (!mesh) return;
      this.glassMeshes.push(mesh);
      parts.push(new pc.MeshInstance(mesh, m));
    };
    add(wet, mat(PALETTE.aqua.water, { emissive: PALETTE.aqua.water, emissiveIntensity: 0.8, gloss: 0.9 }));
    add(dry, mat(PALETTE.aqua.abyss, { gloss: 0.9 }));
    if (!parts.length) return;
    const e = new pc.Entity('pipe-glass');
    e.addComponent('render', { meshInstances: parts, castShadows: false, receiveShadows: false });
    e.enabled = !this.holoMat;
    this.parent.addChild(e);
    this.glass = e;
  }

  destroy() {
    this.clear('body');
    this.clear('glass');
  }
}
