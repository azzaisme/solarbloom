import * as pc from 'playcanvas';
import { lowGeometry, type VPrim } from '../Shapes';
import type { TreeGeo } from '../TreeGen';
import { SEM_A, SEM_B, SEM_C } from './TransitionMaterial';

interface Template {
  pos: Float32Array;
  nrm: Float32Array;
  idx: Uint32Array;
}
const TEMPLATES = new Map<VPrim, Template>();
function template(type: VPrim): Template {
  let t = TEMPLATES.get(type);
  if (!t) {
    const g = lowGeometry(type);
    t = { pos: new Float32Array(g.positions!), nrm: new Float32Array(g.normals!), idx: new Uint32Array(g.indices!) };
    TEMPLATES.set(type, t);
  }
  return t;
}

const linCache = new Map<string, [number, number, number]>();
/** sRGB hex → linear 0–1 (matches the vertex-colour material). */
export function linHex(hex: string): [number, number, number] {
  let c = linCache.get(hex);
  if (!c) {
    const col = new pc.Color();
    col.fromString(hex);
    c = [Math.pow(col.r, 2.2), Math.pow(col.g, 2.2), Math.pow(col.b, 2.2)];
    linCache.set(hex, c);
  }
  return c;
}

/** sRGB hex → one float holding 8-bit r, g, b (exact in float32), for the surface's "from" colour. */
const packCache = new Map<string, number>();
export function packHex(hex: string, grey = 0): number {
  const key = grey ? `${hex}|${grey}` : hex;
  const hit = packCache.get(key);
  if (hit !== undefined) return hit;
  const v = packHexRaw(hex, grey);
  packCache.set(key, v);
  return v;
}
function packHexRaw(hex: string, grey: number): number {
  const col = new pc.Color();
  col.fromString(hex);
  let [r, g, b] = [col.r, col.g, col.b];
  if (grey > 0) {
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    r += (l * 0.85 - r) * grey;
    g += (l * 0.88 - g) * grey;
    b += (l * 0.95 - b) * grey;
  }
  return Math.round(r * 255) + Math.round(g * 255) * 256 + Math.round(b * 255) * 65536;
}

class Grow<T extends Float32Array | Uint8Array | Uint32Array> {
  n = 0;
  constructor(public a: T) {}
  reserve(k: number) {
    if (this.n + k <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new (this.a.constructor as new (n: number) => T)(cap);
    b.set(this.a.subarray(0, this.n) as never);
    this.a = b;
  }
  view(): T {
    return this.a.subarray(0, this.n) as T;
  }
}

/**
 * What the next primitives are: how they move (mode), when (t0, duration and the in/out windows) and around what.
 * See TransitionMaterial for the meaning of each number.
 */
export interface Pen {
  t0: number;
  d: number;
  mode: number;
  inA: number;
  inB: number;
  outA: number;
  outB: number;
  /** ground height under the pieces (they grow up from it) */
  groundY: number;
}

/** Surface data for one slab (see TransitionMaterial: trB / trC). */
export interface SurfaceData {
  t0: number;
  d: number;
  from: number;
  fromPol: number;
  toPol: number;
  code: number;
  dir: number;
  feature: number;
  lushAt: number;
  lushUntil: number;
}

const hash2 = (x: number, z: number) => {
  let h = Math.imul(Math.round(x * 100), 73856093) ^ Math.imul(Math.round(z * 100), 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

/**
 * Look 6.12: builds transition geometry (living surfaces and transition decoration) into one mesh with the three
 * transition streams. Same primitives and colour handling as the chunk renderer's builder.
 */
export class TrMeshBuilder {
  private pos = new Grow(new Float32Array(1 << 12));
  private nrm = new Grow(new Float32Array(1 << 12));
  private col = new Grow(new Uint8Array(1 << 12));
  private a = new Grow(new Float32Array(1 << 12));
  private b = new Grow(new Float32Array(1 << 12));
  private c = new Grow(new Float32Array(1 << 12));
  private idx = new Grow(new Uint32Array(1 << 12));
  /** 0 = full colour … 1 = grey (fog), as in the chunk builder */
  grey = 0;
  /** tip colour (the chunk builder shades tuft tips); transition props draw in their base colour for a few seconds */
  tip = '';
  pen: Pen = { t0: -1e6, d: 1, mode: 0, inA: 0, inB: 0, outA: 2, outB: 3, groundY: 0 };
  /** surface data for the next slab(s) (mode 3) */
  surf?: SurfaceData;
  verts = 0;

  private colour(hex: string): [number, number, number] {
    let [r, g, b] = linHex(hex);
    if (this.grey > 0) {
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      const k = this.grey;
      r += (l * 0.85 - r) * k;
      g += (l * 0.88 - g) * k;
      b += (l * 0.95 - b) * k;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  private reserve(nv: number, ni: number) {
    this.pos.reserve(nv * 3);
    this.nrm.reserve(nv * 3);
    this.col.reserve(nv * 4);
    this.a.reserve(nv * 4);
    this.b.reserve(nv * 4);
    this.c.reserve(nv * 4);
    this.idx.reserve(ni);
  }

  private stream(ax: number, ay: number, az: number, seed: number) {
    const A = this.a.a, B = this.b.a, C = this.c.a;
    let k = this.a.n;
    const s = this.surf;
    const p = this.pen;
    if (p.mode === 3 && s) {
      A[k] = s.t0; A[k + 1] = s.d; A[k + 2] = 3; A[k + 3] = 0;
      B[k] = s.from; B[k + 1] = s.fromPol; B[k + 2] = s.toPol; B[k + 3] = s.code;
      C[k] = s.dir; C[k + 1] = s.feature; C[k + 2] = s.lushAt; C[k + 3] = s.lushUntil;
    } else {
      A[k] = p.t0; A[k + 1] = p.d; A[k + 2] = p.mode; A[k + 3] = seed;
      B[k] = p.inA; B[k + 1] = p.inB; B[k + 2] = p.outA; B[k + 3] = p.outB;
      C[k] = ax; C[k + 1] = ay; C[k + 2] = az; C[k + 3] = hash2(az, ax);
    }
    k += 4;
    this.a.n = this.b.n = this.c.n = k;
  }

  /** One primitive at `p`, scaled by `s`. Its anchor is the ground point under it (pieces grow up from the ground). */
  add(type: VPrim, hex: string, p: [number, number, number], s: [number, number, number] | number) {
    const t = template(type);
    const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
    const [R, G, B] = this.colour(hex);
    const nv = t.pos.length / 3;
    this.reserve(nv, t.idx.length);
    const base = this.pos.n / 3;
    const P = this.pos.a, N = this.nrm.a, C = this.col.a;
    let o = this.pos.n, c = this.col.n;
    const seed = hash2(p[0], p[2]);
    const ay = this.pen.groundY;
    for (let i = 0; i < t.pos.length; i += 3, o += 3, c += 4) {
      P[o] = p[0] + t.pos[i] * sx;
      P[o + 1] = p[1] + t.pos[i + 1] * sy;
      P[o + 2] = p[2] + t.pos[i + 2] * sz;
      const nx = t.nrm[i] / sx, ny = t.nrm[i + 1] / sy, nz = t.nrm[i + 2] / sz;
      const len = Math.hypot(nx, ny, nz) || 1;
      N[o] = nx / len;
      N[o + 1] = ny / len;
      N[o + 2] = nz / len;
      C[c] = R; C[c + 1] = G; C[c + 2] = B; C[c + 3] = 255;
      this.stream(p[0], this.pen.mode === 2 ? p[1] : ay, p[2], seed);
    }
    this.pos.n = o;
    this.nrm.n = o;
    this.col.n = c;
    let k = this.idx.n;
    const I = this.idx.a;
    for (let i = 0; i < t.idx.length; i++) I[k++] = base + t.idx[i];
    this.idx.n = k;
    this.verts += nv;
  }

  /** Cached tree/shrub geometry (as the foliage builder stamps it), growing from its base. */
  addGeo(g: TreeGeo, x: number, y: number, z: number, rotY: number, scale: number) {
    const nv = g.pos.length / 4;
    this.reserve(nv, g.idx.length);
    const base = this.pos.n / 3;
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    const P = this.pos.a, N = this.nrm.a, C = this.col.a;
    let o = this.pos.n, c = this.col.n;
    const seed = hash2(x, z);
    const grey = this.grey;
    for (let i = 0; i < nv; i++, o += 3, c += 4) {
      const px = g.pos[i * 4], py = g.pos[i * 4 + 1], pz = g.pos[i * 4 + 2];
      P[o] = x + (px * cs - pz * sn) * scale;
      P[o + 1] = y + py * scale;
      P[o + 2] = z + (px * sn + pz * cs) * scale;
      const nx = g.nrm[i * 3], nz = g.nrm[i * 3 + 2];
      N[o] = nx * cs - nz * sn;
      N[o + 1] = g.nrm[i * 3 + 1];
      N[o + 2] = nx * sn + nz * cs;
      let r = g.col[i * 4], gg = g.col[i * 4 + 1], b = g.col[i * 4 + 2];
      if (grey > 0) {
        const l = 0.3 * r + 0.59 * gg + 0.11 * b;
        r += (l * 0.85 - r) * grey;
        gg += (l * 0.88 - gg) * grey;
        b += (l * 0.95 - b) * grey;
      }
      C[c] = r; C[c + 1] = gg; C[c + 2] = b; C[c + 3] = 255;
      this.stream(x, y, z, seed);
    }
    this.pos.n = o;
    this.nrm.n = o;
    this.col.n = c;
    let k = this.idx.n;
    const I = this.idx.a;
    for (let i = 0; i < g.idx.length; i++) I[k++] = base + g.idx[i];
    this.idx.n = k;
    this.verts += nv;
  }

  build(device: pc.GraphicsDevice): pc.Mesh | undefined {
    if (!this.idx.n) return undefined;
    const m = new pc.Mesh(device);
    m.setPositions(this.pos.view());
    m.setNormals(this.nrm.view());
    m.setColors32(this.col.view());
    m.setVertexStream(SEM_A, this.a.view(), 4);
    m.setVertexStream(SEM_B, this.b.view(), 4);
    m.setVertexStream(SEM_C, this.c.view(), 4);
    m.setIndices(this.idx.view());
    m.update(pc.PRIMITIVE_TRIANGLES);
    // Pieces lift a little above their rest pose (heave, overshoot): pad the bounds so they never cull early.
    const P = this.pos.a;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.n; i += 3)
      for (let k = 0; k < 3; k++) {
        const v = P[i + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    const pad = 0.2;
    m.aabb = new pc.BoundingBox(
      new pc.Vec3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2),
      new pc.Vec3((hi[0] - lo[0]) / 2 + pad, (hi[1] - lo[1]) / 2 + pad, (hi[2] - lo[2]) / 2 + pad),
    );
    return m;
  }
}
