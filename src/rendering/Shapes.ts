import * as pc from 'playcanvas';

export type Prim = 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'plane' | 'torus';
/** Vertex-coloured primitives; 'sphereHi' is a smoother sphere for big canopies and domes. */
export type VPrim = Prim | 'sphereHi';

export function initLowPoly(device: pc.GraphicsDevice) {
  vcDevice = device;
  vcMaterial = new pc.StandardMaterial();
  vcMaterial.diffuse = new pc.Color(1, 1, 1);
  vcMaterial.diffuseVertexColor = true;
  vcMaterial.useMetalness = true;
  vcMaterial.metalness = 0;
  vcMaterial.gloss = 0.3;
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
