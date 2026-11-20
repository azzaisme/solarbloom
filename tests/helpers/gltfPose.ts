import { readFileSync } from 'node:fs';

/**
 * Reads a skinned GLB and poses its skeleton at a time in one of its clips (forward kinematics, no engine), so a
 * test can ask where a joint is: how far the hips have dropped, which way a thigh points. Linear keys only (every
 * clip in this project is exported LINEAR or STEP); STEP keys hold.
 */
type Vec = [number, number, number];
type Quat = [number, number, number, number];
interface Gltf {
  nodes: { name?: string; children?: number[]; translation?: Vec; rotation?: Quat; scale?: Vec }[];
  skins?: { joints: number[] }[];
  animations?: { name?: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
  accessors: { bufferView: number; byteOffset?: number; count: number; type: string; max?: number[] }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
}

const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function rotate(q: Quat, v: Vec): Vec {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [p[0], p[1], p[2]];
}
function nlerp(a: number[], b: number[], u: number, quat: boolean): number[] {
  let s = 1;
  if (quat && a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0) s = -1;
  const r = a.map((c, i) => c + (b[i] * s - c) * u);
  if (!quat) return r;
  const l = Math.hypot(...r);
  return r.map((c) => c / l);
}

export class Skeleton {
  private g: Gltf;
  private bin: Buffer;
  private parent: Record<number, number> = {};
  readonly joints: number[];

  constructor(file: string) {
    const b = readFileSync(file);
    const len = b.readUInt32LE(12);
    this.g = JSON.parse(b.subarray(20, 20 + len).toString('utf8')) as Gltf;
    this.bin = b.subarray(20 + len + 8);
    this.g.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (this.parent[c] = i)));
    this.joints = this.g.skins?.[0]?.joints ?? [];
  }

  clips(): string[] {
    return (this.g.animations ?? []).map((a) => a.name ?? '');
  }

  clipLength(name: string): number {
    const a = this.anim(name);
    return Math.max(...a.samplers.map((s) => this.g.accessors[s.input].max?.[0] ?? 0));
  }

  /** Joint channels the clip animates (rotation channels on joints). */
  rotatedJoints(name: string): number[] {
    return this.anim(name).channels.filter((c) => c.target.path === 'rotation' && this.joints.includes(c.target.node)).map((c) => c.target.node);
  }

  /** World positions of every node at time t of the clip (or at rest, with no clip). */
  pose(name?: string, t = 0): Record<string, Vec> {
    const local = this.g.nodes.map((n) => ({ t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1] }));
    if (name) {
      const a = this.anim(name);
      for (const ch of a.channels) {
        const s = a.samplers[ch.sampler];
        const key = ch.target.path === 'rotation' ? 'r' : ch.target.path === 'translation' ? 't' : 's';
        (local[ch.target.node] as Record<string, number[]>)[key] = this.sample(s, t, key === 'r');
      }
    }
    const world: { p: Vec; r: Quat; s: Vec }[] = [];
    const solve = (i: number): { p: Vec; r: Quat; s: Vec } => {
      if (world[i]) return world[i];
      const l = local[i];
      const p = this.parent[i];
      if (p === undefined) return (world[i] = { p: l.t as Vec, r: l.r as Quat, s: l.s as Vec });
      const w = solve(p);
      const off = rotate(w.r, [l.t[0] * w.s[0], l.t[1] * w.s[1], l.t[2] * w.s[2]]);
      return (world[i] = { p: [w.p[0] + off[0], w.p[1] + off[1], w.p[2] + off[2]], r: qmul(w.r, l.r as Quat), s: [w.s[0] * l.s[0], w.s[1] * l.s[1], w.s[2] * l.s[2]] });
    };
    const out: Record<string, Vec> = {};
    this.g.nodes.forEach((n, i) => (out[n.name ?? `${i}`] = solve(i).p));
    return out;
  }

  private anim(name: string) {
    const a = (this.g.animations ?? []).find((x) => x.name === name);
    if (!a) throw new Error(`no clip ${name}`);
    return a;
  }

  private read(i: number): number[][] {
    const a = this.g.accessors[i];
    const v = this.g.bufferViews[a.bufferView];
    const n = ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const stride = v.byteStride ?? n * 4;
    return Array.from({ length: a.count }, (_, k) => Array.from({ length: n }, (_, c) => this.bin.readFloatLE(off + k * stride + c * 4)));
  }

  private sample(s: { input: number; output: number; interpolation?: string }, t: number, quat: boolean): number[] {
    const ts = this.read(s.input).map((x) => x[0]);
    const vs = this.read(s.output);
    if (t <= ts[0]) return vs[0];
    if (t >= ts[ts.length - 1]) return vs[ts.length - 1];
    let k = 0;
    while (ts[k + 1] < t) k++;
    if (s.interpolation === 'STEP') return vs[k];
    return nlerp(vs[k], vs[k + 1], (t - ts[k]) / (ts[k + 1] - ts[k]), quat);
  }
}

/** Unit direction from joint a to joint b in a pose. */
export function dir(pose: Record<string, Vec>, a: string, b: string): Vec {
  const d: Vec = [pose[b][0] - pose[a][0], pose[b][1] - pose[a][1], pose[b][2] - pose[a][2]];
  const l = Math.hypot(...d) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
}
