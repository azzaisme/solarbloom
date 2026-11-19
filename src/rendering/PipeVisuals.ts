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
    if (st !== this.stamp) {
      this.stamp = st;
      this.wetStamp = '';
      this.buildBody();
    }
    this.acc += dt;
    if (this.acc < 0.25 && this.wetStamp) return;
    this.acc = 0;
    const wet = p
      .keys()
      .map((k) => {
        const [x, z] = k.split(',').map(Number);
        return p.carries(x, z) ? '1' : '0';
      })
      .join('');
    if (wet !== this.wetStamp) {
      this.wetStamp = wet;
      this.buildGlass();
    }
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

  /** The top of what lies under a point (world y): a terrace tile's slab, or the tread of a stair's or ramp's step. */
  private surface(px: number, pz: number): number {
    const x = Math.floor(px);
    const z = Math.floor(pz);
    const base = this.sim.grid.layer(GROUND)!.height;
    const t = this.sim.grid.peek(GROUND, x, z);
    const hit = t?.ramp ? rampAt(x, z) : undefined;
    if (hit) {
      // drawn as `steps` treads from its low end to its high end (ChunkRenderer.terrace), coping on top
      const steps = hit.ramp.kind === 'stair' ? 2 : 3;
      const fx = px - x;
      const fz = pz - z;
      const u = hit.ramp.dir === 's' ? fz : hit.ramp.dir === 'n' ? 1 - fz : hit.ramp.dir === 'e' ? fx : 1 - fx;
      const k = Math.min(steps - 1, Math.max(0, Math.floor(u * steps)));
      const lv = hit.ramp.from + ((hit.ramp.to - hit.ramp.from) * (hit.i + (k + 0.5) / steps)) / hit.n;
      return base + levelY(lv) + PIPE.treadTop;
    }
    return base + levelY(t?.level ?? 1) + SLAB_TOP;
  }

  /** The pipe's centre over a point: `clear` above what lies under it. */
  private pipeY(px: number, pz: number): number {
    return this.surface(px, pz) + PIPE.clear + PIPE.r;
  }

  /**
   * A half-run from a tile's middle (a) to its edge (b), cut where the ground under it steps (a stair's or a ramp's
   * treads along the run), each piece at its own height.
   */
  private pieces(x: number, z: number, ax: number, az: number, bx: number, bz: number): { a: [number, number]; b: [number, number]; y: number }[] {
    const cuts = [0, 1];
    const t = this.sim.grid.peek(GROUND, x, z);
    const hit = t?.ramp ? rampAt(x, z) : undefined;
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    if (hit && (hit.ramp.dir === 'e' || hit.ramp.dir === 'w') === alongX) {
      const steps = hit.ramp.kind === 'stair' ? 2 : 3;
      const a = alongX ? ax : az;
      const b = alongX ? bx : bz;
      const start = alongX ? x : z;
      for (let j = 1; j < steps; j++) {
        const c = start + j / steps;
        const f = (c - a) / (b - a);
        if (f > 1e-6 && f < 1 - 1e-6) cuts.push(f);
      }
    }
    cuts.sort((p, q) => p - q);
    const out: { a: [number, number]; b: [number, number]; y: number }[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const pa: [number, number] = [ax + (bx - ax) * cuts[i], az + (bz - az) * cuts[i]];
      const pb: [number, number] = [ax + (bx - ax) * cuts[i + 1], az + (bz - az) * cuts[i + 1]];
      out.push({ a: pa, b: pb, y: this.pipeY((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2) });
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
    const tube = new Geo();
    const trim = new Geo();
    for (const k of p.keys()) {
      const [x, z] = k.split(',').map(Number);
      const cx = x + 0.5;
      const cz = z + 0.5;
      const sides: [number, number][] = [...p.links(x, z).map(([nx, nz]) => [nx - x, nz - z] as [number, number]), ...p.machineLinks(x, z).map((l) => [l.dx, l.dz] as [number, number])];
      const atMiddle: number[] = [];
      for (const [dx, dz] of sides) {
        // from the middle to the tile's edge, following the ground's steps
        const run = this.pieces(x, z, cx, cz, cx + dx * 0.5, cz + dz * 0.5);
        atMiddle.push(run[0].y);
        run.forEach((s, i) => {
          tube.tube(s.a[0], s.a[1], s.b[0], s.b[1], s.y, PIPE.r);
          // a little stick holding it up, in the middle of each stretch
          const mx = (s.a[0] + s.b[0]) / 2;
          const mz = (s.a[1] + s.b[1]) / 2;
          const ground = this.surface(mx, mz);
          const top = s.y - PIPE.r;
          trim.box(mx, (ground + top) / 2, mz, PIPE.stick, top - ground, PIPE.stick);
          trim.box(mx, ground + 0.008, mz, PIPE.foot, 0.016, PIPE.foot);
          const next = run[i + 1];
          if (next && Math.abs(next.y - s.y) > 1e-4) {
            const up = next.y > s.y ? 1 : -1; // along the run toward the higher piece
            this.riser(tube, trim, s.b[0], s.b[1], dx * up, dz * up, Math.min(s.y, next.y), Math.max(s.y, next.y));
          }
        });
        // where it meets a neighbouring pipe on lower ground (a terrace wall, a step at the tile's edge): the higher
        // tile draws the upright between the two
        const last = run[run.length - 1];
        if (p.has(x + dx, z + dz)) {
          const ex = cx + dx * 0.5;
          const ez = cz + dz * 0.5;
          const ny = this.pipeY(ex + dx * 0.01, ez + dz * 0.01);
          if (ny < last.y - 1e-4) this.riser(tube, trim, ex, ez, -dx, -dz, ny, last.y);
        }
        const fx = cx + dx * 0.47;
        const fz = cz + dz * 0.47;
        trim.tube(fx - dx * PIPE.flangeLen * 0.5, fz - dz * PIPE.flangeLen * 0.5, fx + dx * PIPE.flangeLen * 0.5, fz + dz * PIPE.flangeLen * 0.5, last.y, PIPE.flange);
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
    const add = (g: Geo, m: pc.Material) => {
      const mesh = g.mesh(this.device);
      if (!mesh) return;
      this.meshes.push(mesh);
      parts.push(new pc.MeshInstance(mesh, m));
    };
    add(tube, mat(PALETTE.aqua.pipe, { gloss: 0.6, metal: 0.2 }));
    add(trim, mat(PALETTE.shell, { gloss: 0.5 }));
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
    this.parent.addChild(e);
    this.glass = e;
  }

  /** The heights of the runs leaving a tile's middle (one per side it joins; its own height if it joins none). */
  private middles(x: number, z: number): number[] {
    const p = this.sim.water.pipes;
    const cx = x + 0.5;
    const cz = z + 0.5;
    const sides: [number, number][] = [...p.links(x, z).map(([nx, nz]) => [nx - x, nz - z] as [number, number]), ...p.machineLinks(x, z).map((l) => [l.dx, l.dz] as [number, number])];
    const ys = sides.map(([dx, dz]) => this.pieces(x, z, cx, cz, cx + dx * 0.5, cz + dz * 0.5)[0].y);
    return ys.length ? ys : [this.pipeY(cx, cz)];
  }

  destroy() {
    this.clear('body');
    this.clear('glass');
  }
}
