// E23.2.4: measures what is really drawn, for the clipping checks of the wildlife play-test (tests/e2e/wildlife-e23.mjs).
// Bloombot's surface is its real vertices, skinned on the CPU exactly as the GPU does it (each vertex: the weighted
// sum of bone world matrix × inverse bind pose × position), so the checks follow the rig in whatever pose it is in.
// Loaded into the page as an init script; `installBodyProbe()` puts the helpers on `window.__probe`.

/** Installs window.__probe: points(entity), box(entity), inside(points, box, margin), gap(points, point). */
export function installBodyProbe() {
  const SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 2 };
  const half = (h) => {
    const s = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const f = h & 0x3ff;
    return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + f / 1024);
  };
  /** One element of a vertex format as a reader: (vertex index, component) → number. */
  function reader(vb, name) {
    const el = vb.getFormat().elements.find((e) => e.name === name);
    if (!el) return undefined;
    const view = new DataView(vb.storage);
    const size = SIZE[el.dataType];
    const norm = el.normalize;
    return (i, c) => {
      const o = el.offset + i * el.stride + c * size;
      switch (el.dataType) {
        case 0: return norm ? Math.max(view.getInt8(o) / 127, -1) : view.getInt8(o);
        case 1: return norm ? view.getUint8(o) / 255 : view.getUint8(o);
        case 2: return norm ? Math.max(view.getInt16(o, true) / 32767, -1) : view.getInt16(o, true);
        case 3: return norm ? view.getUint16(o, true) / 65535 : view.getUint16(o, true);
        case 7: return half(view.getUint16(o, true));
        default: return view.getFloat32(o, true);
      }
    };
  }
  /** a × b, column-major 4×4 */
  const mul = (a, b) => {
    const o = new Float64Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  };
  const meshes = (e) => (e.findComponents ? e.findComponents('render') : []).flatMap((r) => r.meshInstances).filter((mi) => mi.visible !== false && mi.node.enabled);

  /** World positions of every vertex drawn under `entity` (skinned or not), as [x, y, z][]. */
  function points(entity) {
    const out = [];
    for (const mi of meshes(entity)) {
      const vb = mi.mesh.vertexBuffer;
      if (!vb?.storage) continue;
      const pos = reader(vb, 'POSITION');
      if (!pos) continue;
      const n = vb.numVertices;
      const skin = mi.skinInstance;
      if (skin) {
        const w = reader(vb, 'BLENDWEIGHT');
        const ix = reader(vb, 'BLENDINDICES');
        const mats = skin.bones.map((b, k) => mul(b.getWorldTransform().data, skin.skin.inverseBindPose[k].data));
        for (let i = 0; i < n; i++) {
          const x = pos(i, 0), y = pos(i, 1), z = pos(i, 2);
          let px = 0, py = 0, pz = 0;
          for (let k = 0; k < 4; k++) {
            const wt = w(i, k);
            if (!(wt > 0)) continue;
            const m = mats[ix(i, k)];
            px += wt * (m[0] * x + m[4] * y + m[8] * z + m[12]);
            py += wt * (m[1] * x + m[5] * y + m[9] * z + m[13]);
            pz += wt * (m[2] * x + m[6] * y + m[10] * z + m[14]);
          }
          out.push([px, py, pz]);
        }
      } else {
        const m = mi.node.getWorldTransform().data;
        for (let i = 0; i < n; i++) {
          const x = pos(i, 0), y = pos(i, 1), z = pos(i, 2);
          out.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]);
        }
      }
    }
    return out;
  }

  /** The world bounds of the points drawn under `entity`: { min: [x,y,z], max: [x,y,z] }. */
  function box(entity) {
    const ps = points(entity);
    if (!ps.length) return undefined;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of ps) for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
    return { min, max };
  }

  /** How many points lie inside `b` shrunk by `margin` on every side (a margin per axis, or one for all). */
  function inside(ps, b, margin = 0) {
    const m = Array.isArray(margin) ? margin : [margin, margin, margin];
    let n = 0;
    for (const p of ps) if (p[0] > b.min[0] + m[0] && p[0] < b.max[0] - m[0] && p[1] > b.min[1] + m[1] && p[1] < b.max[1] - m[1] && p[2] > b.min[2] + m[2] && p[2] < b.max[2] - m[2]) n++;
    return n;
  }

  /** The distance from `q` to the nearest of `ps`. */
  function gap(ps, q) {
    let d = Infinity;
    for (const p of ps) d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    return d;
  }

  /** The triangles drawn under `entity` (skinned like points()), as [[x,y,z],[x,y,z],[x,y,z]][]. */
  function tris(entity) {
    const out = [];
    for (const [m, mi] of meshes(entity).entries()) {
      const before = points({ findComponents: () => [{ meshInstances: [mi] }] });
      const ib = mi.mesh.indexBuffer?.[0];
      const prim = mi.mesh.primitive?.[0];
      if (!prim) continue;
      const idx = ib?.storage ? (ib.format === 2 ? new Uint32Array(ib.storage) : ib.format === 0 ? new Uint8Array(ib.storage) : new Uint16Array(ib.storage)) : undefined;
      for (let t = prim.base; t + 2 < prim.base + prim.count; t += 3) {
        const tri = [0, 1, 2].map((k) => before[idx ? idx[t + k] : t + k]);
        tri.mesh = m; // which mesh it belongs to (each is its own closed surface)
        tri.name = mi.node.name;
        out.push(tri);
      }
    }
    return out;
  }

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  /** The distance from p to triangle abc (the closest point on it; Ericson, Real-Time Collision Detection 5.1.5). */
  function triDist(p, a, b, c) {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    let q;
    if (d1 <= 0 && d2 <= 0) q = a;
    else {
      const bp = sub(p, b);
      const d3 = dot(ab, bp), d4 = dot(ac, bp);
      if (d3 >= 0 && d4 <= d3) q = b;
      else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
        else {
          const cp = sub(p, c);
          const d5 = dot(ab, cp), d6 = dot(ac, cp);
          if (d6 >= 0 && d5 <= d6) q = c;
          else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
            else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); q = [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]; }
              else { const den = 1 / (va + vb + vc); const v = vb * den, w = vc * den; q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]; }
            }
          }
        }
      }
    }
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  }
  /** The distance from p to the nearest of the triangles. */
  function dist(ts, p) {
    let d = Infinity;
    for (const [a, b, c] of ts) {
      // a quick bound first: no closer than the triangle's bounds
      const lo = [0, 1, 2].map((k) => Math.max(Math.min(a[k], b[k], c[k]) - p[k], 0, p[k] - Math.max(a[k], b[k], c[k])));
      if (Math.hypot(lo[0], lo[1], lo[2]) >= d) continue;
      d = Math.min(d, triDist(p, a, b, c));
    }
    return d;
  }
  /**
   * Whether p is inside the surface the triangles make, by the faces straight above and below it, counted both ways
   * (up the line a face looking up is a way out, one looking down a way in; down it, the other way round; glTF winds
   * front faces anticlockwise, so (b-a)×(c-a) points out): inside when both counts say so. Overlapping parts
   * (bloombot's head sunk into its body, in one mesh) count twice; an open, one-sided panel counts one way only.
   * Returns the mesh's node name when inside, else undefined.
   */
  function insideMesh(ts, p) {
    let up = 0;
    let down = 0;
    let name;
    for (const t of ts) {
      const [a, b, c] = t;
      if ((p[0] < a[0] && p[0] < b[0] && p[0] < c[0]) || (p[0] > a[0] && p[0] > b[0] && p[0] > c[0]) || (p[2] < a[2] && p[2] < b[2] && p[2] < c[2]) || (p[2] > a[2] && p[2] > b[2] && p[2] > c[2])) continue;
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((b[2] - c[2]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[2] - c[2])) / d;
      const v = ((c[2] - a[2]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[2] - c[2])) / d;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const y = u * a[1] + v * b[1] + (1 - u - v) * c[1];
      const looksUp = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 0;
      if (y > p[1]) up += looksUp ? 1 : -1;
      else down += looksUp ? -1 : 1;
      name ??= t.name;
    }
    return up > 0 && down > 0 ? name ?? 'mesh' : undefined;
  }

  window.__probe = { points, box, inside, gap, tris, dist, insideMesh };
}
