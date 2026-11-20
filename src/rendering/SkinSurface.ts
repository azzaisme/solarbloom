import * as pc from 'playcanvas';

/**
 * E23.2.4: a model's surface as it is drawn right now: the world position of every vertex under an entity, skinned
 * on the CPU exactly as the GPU does it (each vertex: the weighted sum of bone world matrix × inverse bind pose ×
 * position), so it follows the rig in whatever pose it is in. Visitors use bloombot's to rest on it (a bird on its
 * head, a frog in its lap) rather than float above or sink into it. A few thousand vertices: read on demand (when an
 * animal settles), never every frame.
 */

type Reader = (i: number, c: number) => number;

const SIZE: Record<number, number> = { [pc.TYPE_INT8]: 1, [pc.TYPE_UINT8]: 1, [pc.TYPE_INT16]: 2, [pc.TYPE_UINT16]: 2, [pc.TYPE_INT32]: 4, [pc.TYPE_UINT32]: 4, [pc.TYPE_FLOAT32]: 4, [pc.TYPE_FLOAT16]: 2 };

function half(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + f / 1024);
}

/**
 * A vertex or index buffer's CPU-side copy of its data. PlayCanvas keeps it (as `storage`) for buffers it may need to
 * re-upload, but leaves it out of its public typings, so it is read here, once, behind a cast.
 */
function cpuCopy(buffer: pc.VertexBuffer | pc.IndexBuffer | undefined): ArrayBuffer | undefined {
  return (buffer as unknown as { storage?: ArrayBuffer } | undefined)?.storage;
}

/** One element of a vertex buffer's format as a reader: (vertex, component) → number (normalised where it is). */
function reader(vb: pc.VertexBuffer, name: string): Reader | undefined {
  const el = vb.getFormat().elements.find((e) => e.name === name);
  const storage = cpuCopy(vb);
  if (!el || !storage) return undefined;
  const view = new DataView(storage);
  const size = SIZE[el.dataType] ?? 4;
  const norm = el.normalize;
  return (i, c) => {
    const o = el.offset + i * el.stride + c * size;
    switch (el.dataType) {
      case pc.TYPE_INT8:
        return norm ? Math.max(view.getInt8(o) / 127, -1) : view.getInt8(o);
      case pc.TYPE_UINT8:
        return norm ? view.getUint8(o) / 255 : view.getUint8(o);
      case pc.TYPE_INT16:
        return norm ? Math.max(view.getInt16(o, true) / 32767, -1) : view.getInt16(o, true);
      case pc.TYPE_UINT16:
        return norm ? view.getUint16(o, true) / 65535 : view.getUint16(o, true);
      case pc.TYPE_FLOAT16:
        return half(view.getUint16(o, true));
      default:
        return view.getFloat32(o, true);
    }
  };
}

const M = new pc.Mat4();

/** Every vertex drawn under `entity`, in world space, appended to `out` as x, y, z triples. Returns `out`. */
export function surfacePoints(entity: pc.Entity, out: number[] = []): number[] {
  for (const r of entity.findComponents('render') as pc.RenderComponent[]) {
    if (!r.enabled || !r.entity.enabled) continue;
    for (const mi of r.meshInstances) vertices(mi, out);
  }
  return out;
}

/**
 * The triangles drawn under `entity`, in world space, as 9 numbers each (three corners), skinned like
 * surfacePoints (and its vertices, each once, into `corners` when given). A low-poly body's faces are far apart at
 * its vertices, so resting on it is worked out on these.
 */
export function surfaceTriangles(entity: pc.Entity, out: number[] = [], corners?: number[]): number[] {
  for (const r of entity.findComponents('render') as pc.RenderComponent[]) {
    if (!r.enabled || !r.entity.enabled) continue;
    for (const mi of r.meshInstances) {
      const mesh = mi.mesh;
      const ib = mesh?.indexBuffer?.[pc.RENDERSTYLE_SOLID];
      const ibData = cpuCopy(ib);
      const prim = mesh?.primitive?.[pc.RENDERSTYLE_SOLID];
      if (!mesh || !prim || prim.type !== pc.PRIMITIVE_TRIANGLES) continue;
      const vs: number[] = [];
      vertices(mi, vs); // this mesh instance's vertices (the same skinning, one mesh at a time)
      if (corners) for (const c of vs) corners.push(c); // (and each corner once, when asked)
      const idx = ib && ibData ? (ib.format === pc.INDEXFORMAT_UINT32 ? new Uint32Array(ibData) : ib.format === pc.INDEXFORMAT_UINT8 ? new Uint8Array(ibData) : new Uint16Array(ibData)) : undefined;
      const count = prim.count;
      for (let t = prim.base; t + 2 < prim.base + count; t += 3) {
        for (let k = 0; k < 3; k++) {
          const v = idx ? idx[t + k] : t + k;
          out.push(vs[v * 3], vs[v * 3 + 1], vs[v * 3 + 2]);
        }
      }
    }
  }
  return out;
}

/**
 * The vertices drawn under `entity` (each once, x, y, z), skinned as surfaceTriangles skins them and in the same order
 * as its `corners`, without building the triangles: for measuring where something rests.
 */
export function skinnedVertices(entity: pc.Entity, out: number[] = []): number[] {
  for (const r of entity.findComponents('render') as pc.RenderComponent[]) {
    if (!r.enabled || !r.entity.enabled) continue;
    for (const mi of r.meshInstances) {
      const prim = mi.mesh?.primitive?.[pc.RENDERSTYLE_SOLID];
      if (!prim || prim.type !== pc.PRIMITIVE_TRIANGLES) continue;
      vertices(mi, out);
    }
  }
  return out;
}

/**
 * For each vertex surfaceTriangles puts into `corners` (in the same order), whether `bones` (by name) carry at least
 * `share` of it: 1 if so, 0 if not. The skin never changes, so this is worked out once per model.
 */
export function vertexOnBones(entity: pc.Entity, bones: (name: string) => boolean, share: number): Uint8Array {
  const out: number[] = [];
  for (const r of entity.findComponents('render') as pc.RenderComponent[]) {
    if (!r.enabled || !r.entity.enabled) continue;
    for (const mi of r.meshInstances) {
      const mesh = mi.mesh;
      const prim = mesh?.primitive?.[pc.RENDERSTYLE_SOLID];
      if (!mesh || !prim || prim.type !== pc.PRIMITIVE_TRIANGLES) continue;
      const u = unpack(mesh);
      if (!u) continue;
      const skin = mi.skinInstance;
      const on = skin ? skin.bones.map((b) => bones(b.name)) : [];
      for (let i = 0; i < u.n; i++) {
        let carried = 0;
        if (u.w && u.ix) for (let k = 0; k < 4; k++) if (on[u.ix[i * 4 + k]]) carried += u.w[i * 4 + k];
        out.push(carried >= share ? 1 : 0);
      }
    }
  }
  return Uint8Array.from(out);
}

/** A mesh's vertex data read out once into plain arrays (the buffer never changes; reading it is the slow part). */
interface Unpacked {
  n: number;
  pos: Float32Array;
  w?: Float32Array;
  ix?: Uint16Array;
}
const UNPACKED = new WeakMap<pc.Mesh, Unpacked | null>();

function unpack(mesh: pc.Mesh): Unpacked | null {
  let u = UNPACKED.get(mesh);
  if (u !== undefined) return u;
  const vb = mesh.vertexBuffer;
  const pos = vb && reader(vb, pc.SEMANTIC_POSITION);
  if (!vb || !pos) u = null;
  else {
    const n = vb.numVertices;
    const w = reader(vb, pc.SEMANTIC_BLENDWEIGHT);
    const ix = reader(vb, pc.SEMANTIC_BLENDINDICES);
    u = { n, pos: new Float32Array(n * 3) };
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) u.pos[i * 3 + c] = pos(i, c);
    if (w && ix) {
      u.w = new Float32Array(n * 4);
      u.ix = new Uint16Array(n * 4);
      for (let i = 0; i < n; i++)
        for (let k = 0; k < 4; k++) {
          u.w[i * 4 + k] = w(i, k);
          u.ix[i * 4 + k] = ix(i, k);
        }
    }
  }
  UNPACKED.set(mesh, u);
  return u;
}

/** One mesh instance's vertices in world space (skinned where it is skinned). */
function vertices(mi: pc.MeshInstance, out: number[]) {
  const u = mi.mesh && unpack(mi.mesh);
  if (!u) return;
  const { n, pos, w, ix } = u;
  const skin = mi.skinInstance;
  const mats = skin && w && ix ? skin.bones.map((b, k) => new pc.Mat4().mul2(b.getWorldTransform(), skin.skin.inverseBindPose[k]).data) : undefined;
  const m0 = M.copy(mi.node.getWorldTransform()).data;
  let o = out.length;
  out.length += n * 3;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    if (mats && w && ix) {
      let px = 0;
      let py = 0;
      let pz = 0;
      for (let k = 0; k < 4; k++) {
        const wt = w[i * 4 + k];
        if (!(wt > 0)) continue;
        const m = mats[ix[i * 4 + k]];
        px += wt * (m[0] * x + m[4] * y + m[8] * z + m[12]);
        py += wt * (m[1] * x + m[5] * y + m[9] * z + m[13]);
        pz += wt * (m[2] * x + m[6] * y + m[10] * z + m[14]);
      }
      out[o++] = px;
      out[o++] = py;
      out[o++] = pz;
    } else {
      out[o++] = m0[0] * x + m0[4] * y + m0[8] * z + m0[12];
      out[o++] = m0[1] * x + m0[5] * y + m0[9] * z + m0[13];
      out[o++] = m0[2] * x + m0[6] * y + m0[10] * z + m0[14];
    }
  }
}

/** A height where a vertical line crosses a face, and whether that face looks up (its outside is above). */
interface Cross {
  y: number;
  up: boolean;
}

/**
 * A surface (triangles, 9 numbers each), ready to be asked where vertical lines cross it: its triangles sorted into
 * square cells across the ground (`cell` wide), so a line is tested only against the few over its cell, exactly.
 * Built once a frame for bloombot (its pose changes), once for an animal (in its own frame).
 */
const YS: number[] = [];
const UPS: number[] = [];

export class Surface {
  readonly x0: number;
  readonly z0: number;
  private readonly nx: number;
  private readonly nz: number;
  private readonly start: Int32Array;
  private readonly list: Int32Array;

  constructor(
    readonly tris: readonly number[],
    private readonly cell = 0.02,
  ) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < tris.length; i += 3) {
      x0 = Math.min(x0, tris[i]);
      x1 = Math.max(x1, tris[i]);
      z0 = Math.min(z0, tris[i + 2]);
      z1 = Math.max(z1, tris[i + 2]);
    }
    const n = tris.length / 9;
    this.x0 = n ? x0 : 0;
    this.z0 = n ? z0 : 0;
    this.nx = n ? Math.max(1, Math.ceil((x1 - x0) / cell) + 1) : 0;
    this.nz = n ? Math.max(1, Math.ceil((z1 - z0) / cell) + 1) : 0;
    // two passes: how many in each cell, then each triangle into every cell its bounds cover
    const count = new Int32Array(this.nx * this.nz + 1);
    const span = (i: number, k: number) => {
      const lo = Math.min(tris[i + k], tris[i + 3 + k], tris[i + 6 + k]);
      const hi = Math.max(tris[i + k], tris[i + 3 + k], tris[i + 6 + k]);
      const o = k === 0 ? this.x0 : this.z0;
      return [Math.floor((lo - o) / cell), Math.floor((hi - o) / cell)];
    };
    for (let t = 0; t < n; t++) {
      const [a0, a1] = span(t * 9, 0);
      const [b0, b1] = span(t * 9, 2);
      for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) count[a * this.nz + b + 1]++;
    }
    for (let c = 1; c < count.length; c++) count[c] += count[c - 1];
    this.start = count;
    this.list = new Int32Array(count[count.length - 1]);
    const fill = count.slice(0, -1);
    for (let t = 0; t < n; t++) {
      const [a0, a1] = span(t * 9, 0);
      const [b0, b1] = span(t * 9, 2);
      for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) this.list[fill[a * this.nz + b]++] = t;
    }
  }

  /**
   * Every height at which the vertical line through (x, z) crosses a face, appended to `out`, with which way each
   * face looks (from its winding: glTF's front faces wind anticlockwise, so (b-a)×(c-a) points out of the body).
   */
  cross(x: number, z: number, out: Cross[]): Cross[] {
    this.flat(x, z, YS, UPS);
    for (let k = 0; k < YS.length; k++) out.push({ y: YS[k], up: UPS[k] === 1 });
    return out;
  }

  /** As cross(), into two lists kept and reused (no garbage): the heights, and 1 where the face looks up, else 0. */
  flat(x: number, z: number, ys: number[], ups: number[]) {
    ys.length = 0;
    ups.length = 0;
    const a = Math.floor((x - this.x0) / this.cell);
    const b = Math.floor((z - this.z0) / this.cell);
    if (a < 0 || b < 0 || a >= this.nx || b >= this.nz) return;
    const c = a * this.nz + b;
    const tris = this.tris;
    for (let k = this.start[c]; k < this.start[c + 1]; k++) {
      const i = this.list[k] * 9;
      const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
      const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
      const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
      // barycentric in the xz plane
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      ys.push(u * ay + v * by + (1 - u - v) * cy);
      ups.push((bz - az) * (cx - ax) - (bx - ax) * (cz - az) > 0 ? 1 : 0);
    }
  }

}

/**
 * Whether height y on a vertical line is inside the surface, from the faces the line crosses: counted both ways (up
 * the line, a face looking up is a way out and one looking down a way in; down it, the other way round), inside when
 * both counts say so. Overlapping parts (bloombot's head sunk into its body) count twice; an open, one-sided panel
 * (a visor) counts one way only, so nothing under it is inside.
 */
function within(c: readonly Cross[], y: number): boolean {
  let up = 0;
  let down = 0;
  for (const q of c) {
    if (q.y > y) up += q.up ? 1 : -1;
    else down += q.up ? -1 : 1;
  }
  return up > 0 && down > 0;
}

/** An animal's footprint and height in its own frame (it faces +z): x0..x1 across, z0..z1 nose to tail, h tall. */
export interface Footprint {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h: number;
}

/**
 * Where an animal (its footprint `foot`, turned to `heading`, the walker's convention) can rest on a surface (its
 * triangles) at (x, z): the lowest feet height between `from` and `to` at which, down a 5×5 grid of lines through its
 * footprint, no face crosses its body, none of those lines is inside the surface (the nearest face above looks
 * down), and a face looking up is right under its feet near its middle (the inner 3×3, so it is held where its body
 * is, not at a corner of its bounds). So a frog tucks in on bloombot's knees under its round belly if it fits
 * there, else it sits up on the belly. Undefined when there is no such place.
 */
export function restOn(surface: Surface, x: number, z: number, heading: number, foot: Footprint, from: number, to: number): number | undefined {
  const cs = Math.cos(heading);
  const sn = Math.sin(heading);
  // the grid in the world: its own +x is (cos, -sin), its +z (sin, cos)
  const pts: { x: number; z: number; inner: boolean }[] = [];
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++) {
      const u = foot.x0 + (foot.x1 - foot.x0) * (0.04 + 0.92 * (i / 4));
      const w = foot.z0 + (foot.z1 - foot.z0) * (0.04 + 0.92 * (j / 4));
      pts.push({ x: x + u * cs + w * sn, z: z - u * sn + w * cs, inner: i > 0 && i < 4 && j > 0 && j < 4 });
    }
  const cols = pts.map((p) => {
    const c = surface.cross(p.x, p.z, []);
    return { inner: p.inner, c: c.sort((a, b) => a.y - b.y) };
  });
  // where it could rest: on a face looking up under one of its middle lines, lowest first
  const feetAt = [...new Set(cols.filter((k) => k.inner).flatMap((k) => k.c.filter((q) => q.up && q.y >= from && q.y <= to).map((q) => q.y)))].sort((p, q) => p - q);
  for (const feet of feetAt) {
    const clear = cols.every(({ c }) => {
      const above = c.find((q) => q.y > feet + 0.003);
      if (!above) return true;
      // nothing through its body, and not inside
      return above.y >= feet + foot.h * 0.95 && !within(c, feet + 0.003);
    });
    if (clear) return feet;
  }
  return undefined;
}

/**
 * Whether any of the points (x, y, z triples) is inside the surface the triangles make (`within`, down the vertical
 * line through each). An animal's own vertices,
 * tested against bloombot's surface, so where it rests nothing of it is sunk into bloombot.
 */
export function anyInside(surface: Surface, pts: readonly number[]): boolean {
  for (let i = 0; i < pts.length; i += 3) {
    surface.flat(pts[i], pts[i + 2], YS, UPS);
    let up = 0;
    let down = 0;
    for (let k = 0; k < YS.length; k++) {
      if (YS[k] > pts[i + 1]) up += UPS[k] ? 1 : -1;
      else down += UPS[k] ? -1 : 1;
    }
    if (up > 0 && down > 0) return true; // (within(), on the flat lists)
  }
  return false;
}
