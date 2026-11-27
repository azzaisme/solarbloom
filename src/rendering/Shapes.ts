import * as pc from 'playcanvas';
import { detailTextures } from './DetailTex';

export type Prim = 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'plane' | 'torus';
/** Vertex-coloured primitives; 'sphereHi' is a smoother sphere for big canopies and domes. */
export type VPrim = Prim | 'sphereHi' | 'disc';

export function initLowPoly(device: pc.GraphicsDevice) {
  vcDevice = device;
  vcMaterial = new pc.StandardMaterial();
  vcMaterial.diffuse = new pc.Color(1, 1, 1);
  vcMaterial.diffuseVertexColor = true;
  vcMaterial.useMetalness = true;
  vcMaterial.metalness = 0;
  vcMaterial.gloss = 0.3;
  // Look 3.1: world-space detail textures over the vertex colours (stone, grass, grain), one draw call still.
  detailTextures.init(device);
  detailTextures.apply(vcMaterial);
  // Look 1.9: vertex alpha below 1 marks glowing geometry (lit lamps, Radiant flowers); see LookShaders.
  vcMaterial.setDefine('LOOK_VC_GLOW', true);
  vcMaterial.update();
}

// Vertex-coloured low-poly meshes: every tile decoration shares ONE material, so a batch
// region draws in a single call instead of one per colour.
const vcCache = new Map<string, pc.Mesh>();
let vcDevice: pc.GraphicsDevice | undefined;
let vcMaterial: pc.StandardMaterial | undefined;

/** The shared vertex-colour material (merged chunk meshes use it too). */
export function vertexColourMaterial(): pc.StandardMaterial {
  return vcMaterial!;
}

export function lowGeometry(type: VPrim): pc.Geometry {
  switch (type) {
    case 'sphereHi':
      return new pc.SphereGeometry({ radius: 0.5, latitudeBands: 9, longitudeBands: 12 });
    case 'sphere':
      return new pc.SphereGeometry({ radius: 0.5, latitudeBands: 5, longitudeBands: 7 });
    case 'cone':
      return new pc.ConeGeometry({ baseRadius: 0.5, peakRadius: 0, height: 1, heightSegments: 1, capSegments: 6 });
    case 'cylinder':
      return new pc.CylinderGeometry({ radius: 0.5, height: 1, heightSegments: 1, capSegments: 6 });
    case 'disc': // E23.13: a smooth round slab (the rounded tip of ground poking out into water)
      return new pc.CylinderGeometry({ radius: 0.5, height: 1, heightSegments: 1, capSegments: 32 });
    case 'capsule':
      return new pc.CapsuleGeometry({ radius: 0.5, height: 2, heightSegments: 1, sides: 6 });
    default:
      return new pc.BoxGeometry({ halfExtents: new pc.Vec3(0.5, 0.5, 0.5) });
  }
}

/** Shared low-poly mesh with a baked colour (sRGB hex → linear, matching material colours). */
export function vcMesh(type: VPrim, hex: string): pc.Mesh {
  const key = `${type}|${hex}`;
  let m = vcCache.get(key);
  if (m) return m;
  const c = new pc.Color();
  c.fromString(hex);
  // fromGeometry stores colours as normalised bytes (0–255).
  const lin = [c.r, c.g, c.b].map((v) => Math.round(Math.pow(v, 2.2) * 255));
  const g = lowGeometry(type);
  const n = g.positions!.length / 3;
  const colors: number[] = new Array(n * 4);
  for (let i = 0; i < n; i++) {
    colors[i * 4] = lin[0];
    colors[i * 4 + 1] = lin[1];
    colors[i * 4 + 2] = lin[2];
    colors[i * 4 + 3] = 255;
  }
  g.colors = colors;
  m = pc.Mesh.fromGeometry(vcDevice!, g);
  // The cache holds its own reference: otherwise the engine frees a shared mesh when the last
  // entity using it is destroyed, and the next tile with that colour would get a dead mesh.
  m.incRefCount();
  vcCache.set(key, m);
  return m;
}

/** A primitive whose colour is baked into its vertices (shares one material for batching). */
export function vshape(parent: pc.Entity, type: VPrim, hex: string, o: ShapeOpts = {}): pc.Entity {
  const e = new pc.Entity(o.name ?? type);
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(vcMesh(type, hex), vcMaterial!)], castShadows: o.shadow ?? false, receiveShadows: o.receive ?? true });
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

export function setVColor(e: pc.Entity, type: VPrim, hex: string) {
  const mi = e.render?.meshInstances[0];
  if (mi) mi.mesh = vcMesh(type, hex);
}

export interface ShapeOpts {
  pos?: [number, number, number];
  scale?: [number, number, number] | number;
  rot?: [number, number, number];
  shadow?: boolean;
  receive?: boolean;
  name?: string;
}

export function shape(parent: pc.Entity, type: Prim, material: pc.Material, o: ShapeOpts = {}): pc.Entity {
  const e = new pc.Entity(o.name ?? type);
  e.addComponent('render', {
    type,
    material,
    castShadows: o.shadow ?? false,
    receiveShadows: o.receive ?? true,
  });
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

export function group(parent: pc.Entity, name = 'group', pos?: [number, number, number]): pc.Entity {
  const e = new pc.Entity(name);
  if (pos) e.setLocalPosition(pos[0], pos[1], pos[2]);
  parent.addChild(e);
  return e;
}

/** Assigns a batch group to every render component under `root` (draw-call reduction). */
export function assignBatch(root: pc.Entity, groupId: number) {
  const walk = (e: pc.Entity) => {
    if (e.render) e.render.batchGroupId = groupId;
    for (const c of e.children) walk(c as pc.Entity);
  };
  walk(root);
}

export function setMaterial(e: pc.Entity, m: pc.Material) {
  if (e.render) e.render.material = m;
}

/**
 * #785: a faceted stone: an icosahedron (radius 0.5, like the 'sphere' primitive) with each corner pushed in or out a
 * little, its underside flattened to sit on the ground, and flat-shaded faces so each facet catches the light on its
 * own. A handful of variants (by `seed`), cached.
 */
const stoneMeshes = new Map<number, pc.Mesh>();
export function facetedStoneMesh(device: pc.GraphicsDevice, seed: number): pc.Mesh {
  let m = stoneMeshes.get(seed);
  if (m) return m;
  let s = (seed + 1) * 2654435761;
  const rnd = () => {
    s = (s ^ (s << 13)) >>> 0;
    s = (s ^ (s >>> 17)) >>> 0;
    s = (s ^ (s << 5)) >>> 0;
    return s / 4294967296;
  };
  // A rounded pebble chiselled flat on a few sides: a twice-split icosahedron (rounded all over, no corner sticks
  // out), each point pulled in to the nearest of ~9 random cutting planes. The cuts make broad flat faces meeting at
  // blunt edges; where no cut reaches the stone stays round. Never a spike: every point is on or inside the ball.
  const t = (1 + Math.sqrt(5)) / 2;
  const pts: [number, number, number][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l] as [number, number, number];
  });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let level = 0; level < 2; level++) {
    const mid = new Map<string, number>();
    const half = (a: number, b: number) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let i = mid.get(key);
      if (i === undefined) {
        const [x, y, z] = [pts[a][0] + pts[b][0], pts[a][1] + pts[b][1], pts[a][2] + pts[b][2]];
        const l = Math.hypot(x, y, z);
        i = pts.push([x / l, y / l, z / l]) - 1;
        mid.set(key, i);
      }
      return i;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = half(a, b), bc = half(b, c), ca = half(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  // the cutting planes: a flat underside to sit on, and a few chisel cuts round the sides and top
  const cuts: [number, number, number, number][] = [[0, -1, 0, 0.3]];
  const nCuts = 7 + Math.floor(rnd() * 4);
  for (let i = 0; i < nCuts; i++) {
    const az = ((i + rnd() * 0.6) / nCuts) * Math.PI * 2, el = (rnd() * 1.1 - 0.15) * (Math.PI / 2);
    cuts.push([Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az), 0.37 + rnd() * 0.08]);
  }
  for (const q of pts) {
    let r = 0.5;
    for (const [nx, ny, nz, d] of cuts) {
      const dot = q[0] * nx + q[1] * ny + q[2] * nz;
      if (dot > 1e-3) r = Math.min(r, d / dot);
    }
    q[0] *= r;
    q[1] *= r;
    q[2] *= r;
  }
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (const [a, b, c] of faces) {
    const [pa, pb, pc2] = [pts[a], pts[b], pts[c]];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc2[0] - pa[0], pc2[1] - pa[1], pc2[2] - pa[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((x) => x / nl);
    const i0 = pos.length / 3;
    for (const p of [pa, pb, pc2]) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(n[0], n[1], n[2]);
    }
    idx.push(i0, i0 + 1, i0 + 2);
  }
  m = new pc.Mesh(device);
  m.setPositions(pos);
  m.setNormals(nrm);
  m.setIndices(idx);
  m.update();
  m.incRefCount();
  stoneMeshes.set(seed, m);
  return m;
}

/** #785: a faceted stone (see facetedStoneMesh) in a material, placed like `shape`. */
export function stoneShape(parent: pc.Entity, material: pc.Material, seed: number, o: ShapeOpts = {}): pc.Entity {
  const device = vcDevice ?? pc.Application.getApplication()?.graphicsDevice;
  if (!device) return shape(parent, 'sphere', material, o);
  const e = new pc.Entity(o.name ?? 'stone');
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(facetedStoneMesh(device, seed % 4), material)], castShadows: o.shadow ?? false, receiveShadows: o.receive ?? true });
  if (o.pos) e.setLocalPosition(o.pos[0], o.pos[1], o.pos[2]);
  if (o.scale !== undefined) {
    const sc = o.scale;
    if (typeof sc === 'number') e.setLocalScale(sc, sc, sc);
    else e.setLocalScale(sc[0], sc[1], sc[2]);
  }
  if (o.rot) e.setLocalEulerAngles(o.rot[0], o.rot[1], o.rot[2]);
  parent.addChild(e);
  return e;
}
