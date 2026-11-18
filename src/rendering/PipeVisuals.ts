import * as pc from 'playcanvas';
import { GROUND, machinesStamp } from '../core/GameState';
import { levelY } from '../core/Height';
import type { Sim } from '../gameplay/Sim';
import { mat } from './Materials';
import { PALETTE } from './Palette';

/** Pipe size (tiles): the tube's radius, how high its centre sits above the ground, its joints and flanges. */
const PIPE = { r: 0.075, y: 0.11, joint: 0.105, flange: 0.098, flangeLen: 0.035, sides: 10, glass: 0.06 };

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

  private y(x: number, z: number): number {
    const t = this.sim.grid.peek(GROUND, x, z);
    return this.sim.grid.layer(GROUND)!.height + levelY(t?.level ?? 1) + PIPE.y;
  }

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

  private buildBody() {
    this.clear('body');
    const p = this.sim.water.pipes;
    const tube = new Geo();
    const trim = new Geo();
    for (const k of p.keys()) {
      const [x, z] = k.split(',').map(Number);
      const cx = x + 0.5;
      const cz = z + 0.5;
      const y = this.y(x, z);
      const sides: [number, number][] = [...p.links(x, z).map(([nx, nz]) => [nx - x, nz - z] as [number, number]), ...p.machineLinks(x, z).map((l) => [l.dx, l.dz] as [number, number])];
      for (const [dx, dz] of sides) {
        // to the tile's edge; a neighbouring pipe on another height (a stair, a ramp) meets it there with a short
        // upright drop between the two, drawn once by the higher tile, with an elbow drum at each end
        tube.tube(cx, cz, cx + dx * 0.5, cz + dz * 0.5, y, PIPE.r);
        const ny = p.has(x + dx, z + dz) ? this.y(x + dx, z + dz) : y;
        if (ny < y - 1e-3) {
          const ex = cx + dx * 0.5;
          const ez = cz + dz * 0.5;
          tube.drum(ex, ez, ny, y, PIPE.r);
          trim.drum(ex, ez, y - PIPE.joint * 0.9, y + PIPE.joint * 0.9, PIPE.joint);
          trim.drum(ex, ez, ny - PIPE.joint * 0.9, ny + PIPE.joint * 0.9, PIPE.joint);
        }
        const fx = cx + dx * 0.47;
        const fz = cz + dz * 0.47;
        trim.tube(fx - dx * PIPE.flangeLen * 0.5, fz - dz * PIPE.flangeLen * 0.5, fx + dx * PIPE.flangeLen * 0.5, fz + dz * PIPE.flangeLen * 0.5, y, PIPE.flange);
      }
      const straight = sides.length === 2 && sides[0][0] === -sides[1][0] && sides[0][1] === -sides[1][1];
      if (!straight) trim.drum(cx, cz, y - PIPE.joint * 0.9, y + PIPE.joint * 0.9, PIPE.joint); // a joint, junction or cap
      // a low bracket holding it off the ground
      trim.box(cx, (y - PIPE.r + this.y(x, z) - PIPE.y) / 2, cz, 0.05, Math.max(0.01, PIPE.y - PIPE.r), 0.18);
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
      const y = this.y(x, z) + PIPE.r * 0.85;
      (p.carries(x, z) ? wet : dry).box(x + 0.5, y, z + 0.5, PIPE.glass, 0.03, PIPE.glass);
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

  destroy() {
    this.clear('body');
    this.clear('glass');
  }
}
