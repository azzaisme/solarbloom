import * as pc from 'playcanvas';

/** Original glTF models, loaded once and instanced with shared meshes/materials. */
const containers = new Map<string, pc.ContainerResource>();
export async function loadModelKit(app: pc.Application) {
  await Promise.all(['solar', 'condenser', 'pollinator', 'droneHub', 'drone', 'motherTree', 'relay', 'reservoirGarden', 'fountain', 'coreArch'].map((name) => new Promise<void>((resolve, reject) => {
    const asset = new pc.Asset(name, 'container', { url: `${import.meta.env.BASE_URL}models/${name}.glb` });
    asset.once('load', () => { containers.set(name, asset.resource as pc.ContainerResource); resolve(); });
    asset.once('error', (err: unknown) => reject(new Error(`Could not load ${name} model: ${String(err)}`)));
    app.assets.add(asset);
    app.assets.load(asset);
  })));
}
export function model(name: string, parent: pc.Entity): pc.Entity {
  const resource = containers.get(name);
  if (!resource) throw new Error(`Model kit not ready: ${name}`);
  const root = resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
  parent.addChild(root);
  return root;
}
export function pivot(root: pc.Entity, name: string): pc.Entity {
  const node = root.findByName(name);
  if (!node) throw new Error(`Missing model pivot: ${name}`);
  return node as pc.Entity;
}

/** Per-instance state material, keeping dormant/awake transitions independent. */
export function replaceMaterial(root: pc.Entity, name: string, material: pc.Material) {
  for (const render of root.findComponents('render') as pc.RenderComponent[]) {
    for (const instance of render.meshInstances) if (instance.material?.name === name) instance.material = material;
  }
}
