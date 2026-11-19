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
   * A tube between any two points (a run down a stair or ramp, sloping with it). Its rings stand square to the run,
   * so a sloped stretch reads as one straight pipe.
   */
  slope(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, sides = PIPE.sides) {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    if (len < 1e-6) return;
    const d = [(bx - ax) / len, (by - ay) / len, (bz - az) / len];
    // side: level and square to the run; up: square to both (the run is never vertical here)
    let sx = -d[2];
    let sz = d[0];
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl;
    sz /= sl;
    const ux = -sz * d[1];
    const uy = sz * d[0] - sx * d[2];
    const uz = sx * d[1];
    const base = this.pos.length / 3;
    for (let i = 0; i <= sides; i++) {
      const t = (i / sides) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const ox = c * ux + s * sx;
      const oy = c * uy;
      const oz = c * uz + s * sz;
      this.pos.push(ax + ox * r, ay + oy * r, az + oz * r, bx + ox * r, by + oy * r, bz + oz * r);
      this.nrm.push(ox, oy, oz, ox, oy, oz);
    }
    // wound so the outside faces out: check the first quad's face against its ring's outward offset
    const p = this.pos;
    const A = base * 3;
    const e1 = [p[A + 3] - p[A], p[A + 4] - p[A + 1], p[A + 5] - p[A + 2]];
    const e2 = [p[A + 6] - p[A], p[A + 7] - p[A + 1], p[A + 8] - p[A + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const out = n[0] * this.nrm[A] + n[1] * this.nrm[A + 1] + n[2] * this.nrm[A + 2] > 0;
    for (let i = 0; i < sides; i++) {
      const q = base + i * 2;
      if (out) this.idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      else this.idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
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
 * The pipe's centre over a point. On flat ground and across a stair: `clear` above what lies under it. Along a stair
 * or ramp: one straight slope, the way a pipe runs down real steps, that just clears the nosing of every tread (the
 * line through the treads' middles, raised half a step) and levels off to meet the ground at the top. At the foot it
 * meets the ground with one short drop (drawn where the tiles meet).
 */
export function pipeHeight(sim: Sim, px: number, pz: number): number {
  const t = sim.grid.peek(GROUND, Math.floor(px), Math.floor(pz));
  const on = t?.ramp ? onRamp(px, pz) : undefined;
  if (!on) return pipeSurface(sim, px, pz) + PIPE.clear + PIPE.r;
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

/** Does a run from (ax, az) toward (bx, bz) go up or down a stair or ramp (not across it)? */
function alongRamp(px: number, pz: number, alongX: boolean): boolean {
  const on = onRamp(px, pz);
  return !!on && (on.hit.ramp.dir === 'e' || on.hit.ramp.dir === 'w') === alongX;
}

/** Pipe sizes, for the tests. */
export const PIPE_SIZE = PIPE;

/**
 * E23.4.2.2 (#424): pipes in the world. Each pipe tile is a pale-blue tube from its middle to every side it joins
 * (a neighbouring pipe, a pump or a reservoir), with a cream joint where it turns or branches, a cap where it ends,
 * flanges at the tile edges, and a small sight glass on top that shows water when the pipe carries some and dark
 * glass when it is dry. The body is rebuilt only when pipes are laid or lifted (or machines change); the sight
 * glasses when what carries water changes.
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
      this.buildBody();
      this.buildGlass();
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

  private pipeY(px: number, pz: number): number {
    return pipeHeight(this.sim, px, pz);
  }

  /**
   * A half-run from a tile's middle (a) to its edge (b) as straight stretches, each with its height at both ends:
   * one level stretch, or (up or down a stair or ramp) a few that follow its slope. Heights are read just inside the
   * tile (its edge belongs to the next one).
   */
  private pieces(x: number, z: number, ax: number, az: number, bx: number, bz: number): { a: [number, number]; b: [number, number]; ya: number; yb: number; sloped: boolean }[] {
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    const inside = (px: number, pz: number): [number, number] => [Math.min(x + 1 - 1e-4, Math.max(x + 1e-4, px)), Math.min(z + 1 - 1e-4, Math.max(z + 1e-4, pz))];
    const yAt = (px: number, pz: number) => this.pipeY(...inside(px, pz));
    if (!this.sim.grid.peek(GROUND, x, z)?.ramp || !alongRamp(...inside(ax, az), alongX)) {
      const y = yAt((ax + bx) / 2, (az + bz) / 2);
      return [{ a: [ax, az], b: [bx, bz], ya: y, yb: y, sloped: false }];
    }
    // the slope can level off part-way (the top of a flight): a few stretches follow it closely
    const N = 4;
    const out: { a: [number, number]; b: [number, number]; ya: number; yb: number; sloped: boolean }[] = [];
    for (let i = 0; i < N; i++) {
      const pa: [number, number] = [ax + ((bx - ax) * i) / N, az + ((bz - az) * i) / N];
      const pb: [number, number] = [ax + ((bx - ax) * (i + 1)) / N, az + ((bz - az) * (i + 1)) / N];
      out.push({ a: pa, b: pb, ya: yAt(pa[0], pa[1]), yb: yAt(pb[0], pb[1]), sloped: true });
    }
    return out;
  }

  /**
   * Where the ground steps under a pipe: an upright between the two heights standing just in front of the riser
   * (on the lower side, never inside the step), the higher run carried over to it, an elbow drum at each end.
   * (dx, dz) points from the lower side to the higher.
   */
  private riser(tube: Geo, trim: Geo, px: number, pz: number, dx: number, dz: number, lo: number, hi: number) {
    const vx = px - dx * PIPE.r;
    const vz = pz - dz * PIPE.r;
    tube.drum(vx, vz, lo, hi, PIPE.r);
    tube.tube(vx, vz, px, pz, hi, PIPE.r);
    // short elbow fittings at each bend (tall collars hid the whole upright on a stair's low riser)
    trim.drum(vx, vz, lo - PIPE.elbow, lo + PIPE.elbow, PIPE.joint);
    trim.drum(vx, vz, hi - PIPE.elbow, hi + PIPE.elbow, PIPE.joint);
  }

  private buildBody() {
    this.clear('body');
    const p = this.sim.water.pipes;
    const geo = { wet: { tube: new Geo(), trim: new Geo() }, dry: { tube: new Geo(), trim: new Geo() } };
    for (const k of p.keys()) {
      const [x, z] = k.split(',').map(Number);
      const { tube, trim } = p.carries(x, z) ? geo.wet : geo.dry;
      const cx = x + 0.5;
      const cz = z + 0.5;
      const sides: [number, number][] = [...p.links(x, z).map(([nx, nz]) => [nx - x, nz - z] as [number, number]), ...p.machineLinks(x, z).map((l) => [l.dx, l.dz] as [number, number])];
      const atMiddle: number[] = [];
      for (const [dx, dz] of sides) {
        // from the middle to the tile's edge: level, or sloping with a stair or ramp as one straight pipe
        const run = this.pieces(x, z, cx, cz, cx + dx * 0.5, cz + dz * 0.5);
        atMiddle.push(run[0].ya);
        for (const s of run) {
          if (s.sloped) tube.slope(s.a[0], s.ya, s.a[1], s.b[0], s.yb, s.b[1], PIPE.r);
          else tube.tube(s.a[0], s.a[1], s.b[0], s.b[1], s.ya, PIPE.r);
        }
        // a little stick holding it up, in the middle of the half-run
        {
          const mx = cx + dx * 0.25;
          const mz = cz + dz * 0.25;
          const ground = this.surface(mx, mz);
          const top = this.pipeY(mx, mz) - PIPE.r;
          trim.box(mx, (ground + top) / 2, mz, PIPE.stick, top - ground, PIPE.stick);
          trim.box(mx, ground + 0.008, mz, PIPE.foot, 0.016, PIPE.foot);
        }
        // where it meets a neighbouring pipe on lower ground (a terrace wall, a step at the tile's edge): the higher
        // tile draws the upright between the two
        const last = run[run.length - 1];
        if (p.has(x + dx, z + dz)) {
          const ex = cx + dx * 0.5;
          const ez = cz + dz * 0.5;
          const ny = this.pipeY(ex + dx * 0.01, ez + dz * 0.01);
          if (ny < last.yb - 1e-4) this.riser(tube, trim, ex, ez, -dx, -dz, ny, last.yb);
        }
        // a flange where tiles join (none along a slope: rings stacked down a flight read as clutter)
        if (!last.sloped) {
          const fx = cx + dx * 0.47;
          const fz = cz + dz * 0.47;
          trim.tube(fx - dx * PIPE.flangeLen * 0.5, fz - dz * PIPE.flangeLen * 0.5, fx + dx * PIPE.flangeLen * 0.5, fz + dz * PIPE.flangeLen * 0.5, last.yb, PIPE.flange);
        }
      }
      if (!atMiddle.length) {
        // a lone tile: a capped stub on its stick
        const y = this.pipeY(cx, cz);
        const ground = this.surface(cx, cz);
        trim.drum(cx, cz, y - PIPE.joint * 0.9, y + PIPE.joint * 0.9, PIPE.joint);
        trim.box(cx, (ground + y - PIPE.r) / 2, cz, PIPE.stick, y - PIPE.r - ground, PIPE.stick);
        trim.box(cx, ground + 0.008, cz, PIPE.foot, 0.016, PIPE.foot);
        continue;
      }
      const lo = Math.min(...atMiddle);
      const hi = Math.max(...atMiddle);
      // halves on different treads meet in the middle (a stair's riser can fall there): an upright joins them
      if (hi - lo > 1e-4) tube.drum(cx, cz, lo, hi, PIPE.r);
      const straight = sides.length === 2 && sides[0][0] === -sides[1][0] && sides[0][1] === -sides[1][1];
      if (hi - lo > 1e-4) {
        // the upright shows blue between two short elbow fittings
        trim.drum(cx, cz, lo - PIPE.elbow, lo + PIPE.elbow, PIPE.joint);
        trim.drum(cx, cz, hi - PIPE.elbow, hi + PIPE.elbow, PIPE.joint);
      } else if (!straight) trim.drum(cx, cz, lo - PIPE.joint * 0.9, hi + PIPE.joint * 0.9, PIPE.joint); // a joint, junction or cap
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

  private buildGlass() {
    this.clear('glass');
    const p = this.sim.water.pipes;
    const wet = new Geo();
    const dry = new Geo();
    for (const k of p.keys()) {
      const [x, z] = k.split(',').map(Number);
      // on the highest run through the tile's middle
      const y = Math.max(...this.middles(x, z)) + PIPE.r * 0.85;
      (p.carries(x, z) ? wet : dry).box(x + 0.5, y + 0.01, z + 0.5, PIPE.glass, 0.05, PIPE.glass);
    }
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

  /** The heights of the runs leaving a tile's middle (one per side it joins; its own height if it joins none). */
  private middles(x: number, z: number): number[] {
    const p = this.sim.water.pipes;
    const cx = x + 0.5;
    const cz = z + 0.5;
    const sides: [number, number][] = [...p.links(x, z).map(([nx, nz]) => [nx - x, nz - z] as [number, number]), ...p.machineLinks(x, z).map((l) => [l.dx, l.dz] as [number, number])];
    const ys = sides.map(([dx, dz]) => this.pieces(x, z, cx, cz, cx + dx * 0.5, cz + dz * 0.5)[0].ya);
    return ys.length ? ys : [this.pipeY(cx, cz)];
  }

  destroy() {
    this.clear('body');
    this.clear('glass');
  }
}
