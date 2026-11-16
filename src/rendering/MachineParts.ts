import * as pc from 'playcanvas';
import type { ShapeOpts } from './Shapes';

/**
 * Look 3.12: procedural machine parts with bevelled edges and smooth normals (rounded boxes, lathed bodies,
 * swept pipes and arches, low-poly balls and rings). Every mesh is built once per size and cached (the cache
 * holds a reference, so destroying a machine never frees a shared mesh); parts share `mat()` materials, so
 * machines still merge into their region batches.
 *
 * Meshy hook: a future GLB for a machine would replace these procedural parts. Load it the way the drone does
 * (src/rendering/DroneVisuals.ts: `app.assets.loadFromUrl(new URL('../../assets/raw/<machine>/<machine>.glb',
 * import.meta.url).href, 'container', ...)` and `resource.instantiateRenderEntity()`), keeping these parts as the
 * fallback while it loads.
 */

const cache = new Map<string, pc.Mesh>();
const q = (n: number) => Math.round(n * 1000) / 1000;

interface Geo {
  p: number[];
  n: number[];
  i: number[];
}

function cached(key: string, make: () => Geo): pc.Mesh {
  let m = cache.get(key);
  if (m) return m;
  const d = make();
  const g = new pc.Geometry();
  g.positions = d.p;
  g.normals = d.n;
  g.indices = d.i;
  // planar UVs (x, z): enough for world/detail layers; parts carry no textures of their own
  const uv: number[] = [];
  for (let k = 0; k < d.p.length; k += 3) uv.push(d.p[k], d.p[k + 2]);
  g.uvs = uv;
  m = pc.Mesh.fromGeometry(pc.AppBase.getApplication()!.graphicsDevice, g);
  m.incRefCount();
  cache.set(key, m);
  return m;
}

/** A box w × h × d (centred) whose edges and corners are rounded with radius r (smooth normals, ~108 tris). */
export function rbox(w: number, h: number, d: number, r = 0.02): pc.Mesh {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  r = Math.min(r, hx * 0.95, hy * 0.95, hz * 0.95);
  // tiny slats, seams and strips: a bevel would not show, so a plain 12-triangle box
  if (r < 0.01)
    return cached(`box|${q(w)}|${q(h)}|${q(d)}`, () => {
      const g = new pc.BoxGeometry({ halfExtents: new pc.Vec3(hx, hy, hz) });
      return { p: Array.from(g.positions!), n: Array.from(g.normals!), i: Array.from(g.indices!) };
    });
  return cached(`rbox|${q(w)}|${q(h)}|${q(d)}|${q(r)}`, () => {
    const p: number[] = [], n: number[] = [], i: number[] = [];
    const H = [hx, hy, hz];
    // face normal axis, u axis, v axis (u × v = normal)
    const faces: [number, number, number, number][] = [
      [0, 1, 1, 2], [0, -1, 2, 1], [1, 1, 2, 0], [1, -1, 0, 2], [2, 1, 0, 1], [2, -1, 1, 0],
    ];
    for (const [ax, sg, ua, va] of faces) {
      const us = [-H[ua], -H[ua] + r, H[ua] - r, H[ua]];
      const vs = [-H[va], -H[va] + r, H[va] - r, H[va]];
      const base = p.length / 3;
      for (const v of vs)
        for (const u of us) {
          const pt = [0, 0, 0];
          pt[ax] = sg * H[ax];
          pt[ua] = u;
          pt[va] = v;
          const inner = pt.map((c, k) => Math.max(-(H[k] - r), Math.min(H[k] - r, c)));
          let dir = pt.map((c, k) => c - inner[k]);
          const len = Math.hypot(dir[0], dir[1], dir[2]);
          if (len < 1e-6) {
            dir = [0, 0, 0];
            dir[ax] = sg;
          } else dir = dir.map((c) => c / len);
          p.push(inner[0] + dir[0] * r, inner[1] + dir[1] * r, inner[2] + dir[2] * r);
          n.push(dir[0], dir[1], dir[2]);
        }
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++) {
          const a = base + y * 4 + x, b = a + 1, c = a + 5, e = a + 4;
          i.push(a, b, c, a, c, e);
        }
    }
    return { p, n, i };
  });
}

/** A lathe from profile points [r, y, nr, ny] (bottom to top, normals given), around Y with `sides` sides. */
export function lathe(key: string, prof: [number, number, number, number][], sides = 16): pc.Mesh {
  return cached(`lathe|${key}|${sides}`, () => {
    const p: number[] = [], n: number[] = [], i: number[] = [];
    for (const [r, y, nr, ny] of prof)
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        p.push(r * c, y, r * s);
        n.push(nr * c, ny, nr * s);
      }
    const W = sides + 1;
    for (let k = 0; k < prof.length - 1; k++)
      for (let j = 0; j < sides; j++) {
        const a = k * W + j, b = a + 1, c = a + W + 1, d = a + W;
        i.push(a, d, c, a, c, b);
      }
    return { p, n, i };
  });
}

/** A lathe whose normals come from the profile (smooth); repeat a point for a hard edge. */
export function latheAuto(key: string, pts: [number, number][], sides = 16): pc.Mesh {
  const prof: [number, number, number, number][] = pts.map(([r, y], k) => {
    let nr = 0, ny = 0;
    for (const [a, b] of [[k - 1, k], [k, k + 1]]) {
      if (a < 0 || b >= pts.length) continue;
      const dr = pts[b][0] - pts[a][0], dy = pts[b][1] - pts[a][1];
      const l = Math.hypot(dr, dy);
      if (l < 1e-6) continue;
      nr += dy / l;
      ny += -dr / l;
    }
    const l = Math.hypot(nr, ny) || 1;
    return [r, y, nr / l, ny / l];
  });
  // a hard edge: the repeated point takes only its own side's normal
  for (let k = 0; k < pts.length - 1; k++) {
    if (Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) > 1e-6) continue;
    const side = (a: number, b: number): [number, number] => {
      if (a < 0 || b >= pts.length) return [0, 1];
      const dr = pts[b][0] - pts[a][0], dy = pts[b][1] - pts[a][1];
      const l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    };
    const [r0, y0] = side(k - 1, k);
    const [r1, y1] = side(k + 1, k + 2);
    prof[k] = [pts[k][0], pts[k][1], r0, y0];
    prof[k + 1] = [pts[k][0], pts[k][1], r1, y1];
  }
  return lathe(`auto|${key}`, prof, sides);
}

/** A closed cylinder of radius r from y0 to y1 with rounded bottom/top edges (radii rb, rt). */
export function rcyl(r: number, y0: number, y1: number, rt = 0.02, rb = 0.01, sides = 16): pc.Mesh {
  const prof: [number, number, number, number][] = [[0, y0, 0, -1]];
  const arc = (cx: number, cy: number, rad: number, a0: number, a1: number) => {
    const segs = rad > 0 ? 2 : 1;
    for (let k = 0; k <= segs; k++) {
      const a = a0 + ((a1 - a0) * k) / segs;
      prof.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a), Math.cos(a), Math.sin(a)]);
    }
  };
  arc(r - rb, y0 + rb, rb, -Math.PI / 2, 0);
  arc(r - rt, y1 - rt, rt, 0, Math.PI / 2);
  prof.push([0, y1, 0, 1]);
  return lathe(`rcyl|${q(r)}|${q(y0)}|${q(y1)}|${q(rt)}|${q(rb)}`, prof, sides);
}

/** A half-ellipsoid dome (radius r, height h) standing on y0, closed underneath. */
export function dome(r: number, h: number, y0 = 0, sides = 16): pc.Mesh {
  const prof: [number, number, number, number][] = [[0, y0, 0, -1], [r, y0, 0, -1]];
  for (let k = 0; k <= 5; k++) {
    const a = (k / 5) * (Math.PI / 2);
    const nr = Math.cos(a) / r, ny = Math.sin(a) / h;
    const l = Math.hypot(nr, ny);
    prof.push([r * Math.cos(a), y0 + h * Math.sin(a), nr / l, ny / l]);
  }
  return lathe(`dome|${q(r)}|${q(h)}|${q(y0)}`, prof, sides);
}

/** A low-poly ball of diameter 1 (scale it like the 'sphere' primitive). */
export function ball(lat = 6, lon = 8): pc.Mesh {
  return cached(`ball|${lat}|${lon}`, () => {
    const g = new pc.SphereGeometry({ radius: 0.5, latitudeBands: lat, longitudeBands: lon });
    return { p: Array.from(g.positions!), n: Array.from(g.normals!), i: Array.from(g.indices!) };
  });
}

/** A ring with the 'torus' primitive's proportions (outer diameter 1), at a fraction of its triangles. */
export function ring(segments = 20, sides = 6, tube = 0.2): pc.Mesh {
  return cached(`ring|${segments}|${sides}|${q(tube)}`, () => {
    const g = new pc.TorusGeometry({ tubeRadius: tube, ringRadius: 0.5 - tube, segments, sides });
    return { p: Array.from(g.positions!), n: Array.from(g.normals!), i: Array.from(g.indices!) };
  });
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * A tube swept along `path`. Its cross-section is a circle (radius `a`) or, with `b`, a rounded rectangle
 * (half sizes a × b, corner radius rc) whose `a` side follows the initial normal `up0`.
 */
export function tube(key: string, path: V3[], a: number, opts: { b?: number; rc?: number; sides?: number; up0?: V3 } = {}): pc.Mesh {
  return cached(`tube|${key}`, () => {
    // cross-section: [x, y, nx, ny] in the (N, B) plane, counter-clockwise
    const cs: [number, number, number, number][] = [];
    if (opts.b === undefined) {
      const s = opts.sides ?? 8;
      for (let k = 0; k <= s; k++) {
        const t = (k / s) * Math.PI * 2;
        cs.push([a * Math.cos(t), a * Math.sin(t), Math.cos(t), Math.sin(t)]);
      }
    } else {
      const b = opts.b;
      const rc = Math.min(opts.rc ?? 0.02, a * 0.9, b * 0.9);
      const corners: [number, number, number][] = [[a - rc, b - rc, 0], [-(a - rc), b - rc, Math.PI / 2], [-(a - rc), -(b - rc), Math.PI], [a - rc, -(b - rc), Math.PI * 1.5]];
      for (const [cx, cy, t0] of corners)
        for (let k = 0; k <= 2; k++) {
          const t = t0 + (k / 2) * (Math.PI / 2);
          cs.push([cx + rc * Math.cos(t), cy + rc * Math.sin(t), Math.cos(t), Math.sin(t)]);
        }
      cs.push(cs[0]);
    }
    const p: number[] = [], n: number[] = [], i: number[] = [];
    let N: V3 | undefined;
    for (let k = 0; k < path.length; k++) {
      const T = norm(sub(path[Math.min(path.length - 1, k + 1)], path[Math.max(0, k - 1)]));
      if (!N) {
        const up = opts.up0 ?? (Math.abs(T[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
        N = norm(sub(up as V3, T.map((c) => c * dot(up as V3, T)) as V3));
      } else N = norm(sub(N, T.map((c) => c * dot(N!, T)) as V3)); // parallel transport
      const B = cross(T, N);
      for (const [x, y, nx, ny] of cs) {
        p.push(path[k][0] + N[0] * x + B[0] * y, path[k][1] + N[1] * x + B[1] * y, path[k][2] + N[2] * x + B[2] * y);
        n.push(N[0] * nx + B[0] * ny, N[1] * nx + B[1] * ny, N[2] * nx + B[2] * ny);
      }
    }
    const W = cs.length;
    for (let k = 0; k < path.length - 1; k++)
      for (let j = 0; j < W - 1; j++) {
        const a0 = k * W + j, b0 = a0 + 1, c0 = a0 + W + 1, d0 = a0 + W;
        i.push(a0, b0, c0, a0, c0, d0);
      }
    return { p, n, i };
  });
}

/** Points on a quadratic Bezier (for cables and pipes). */
export function bezier(a: V3, c: V3, b: V3, segs = 8): V3[] {
  const out: V3[] = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]]);
  }
  return out;
}

/** A semicircle in the XY plane (radius R, centred at height y0), from +X over the top to -X. */
export function arcPath(R: number, y0: number, segs = 10, from = 0, to = Math.PI): V3[] {
  const out: V3[] = [];
  for (let k = 0; k <= segs; k++) {
    const a = from + ((to - from) * k) / segs;
    out.push([R * Math.cos(a), y0 + R * Math.sin(a), 0]);
  }
  return out;
}

/** An entity drawing one cached part mesh (the counterpart of `shape()` for custom meshes). */
export function part(parent: pc.Entity, mesh: pc.Mesh, material: pc.Material, o: ShapeOpts = {}): pc.Entity {
  const e = new pc.Entity(o.name ?? 'part');
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: o.shadow ?? false, receiveShadows: o.receive ?? true });
  if (o.pos) e.setLocalPosition(o.pos[0], o.pos[1], o.pos[2]);
  if (o.scale !== undefined) {
    const s = o.scale;
    if (typeof s === 'number') e.setLocalScale(s, s, s);
    else e.setLocalScale(s[0], s[1], s[2]);
  }
  if (o.rot) e.setLocalEulerAngles(o.rot[0], o.rot[1], o.rot[2]);
  parent.addChild(e);
  return e;
}

/** The material an entity draws with (works for primitives and custom parts). */
export function matOf(e: pc.Entity): pc.Material | undefined {
  return e.render?.meshInstances[0]?.material ?? undefined;
}

/** Swaps an entity's material (primitives and custom parts alike). */
export function setMat(e: pc.Entity, m: pc.Material) {
  if (!e.render) return;
  for (const mi of e.render.meshInstances) if (mi.material !== m) mi.material = m;
}
