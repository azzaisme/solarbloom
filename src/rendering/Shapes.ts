import * as pc from 'playcanvas';

export type Prim = 'box' | 'sphere' | 'cylinder' | 'cone' | 'capsule' | 'plane' | 'torus';

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
