import * as pc from 'playcanvas';

/**
 * #596: warm the shaders behind the loading screen. The first draw of a material variant compiles and links its
 * shader there and then, and on a real GPU that is 40–220 ms each: a hitch on the first pulse, the first pool on
 * screen, or an area waking (its towers and its Keeper). While the loading screen is still up this draws, for a few
 * frames, everything the scene holds but would not draw yet (out of view, or under a disabled entity: the Keepers
 * still asleep, a progress ring waiting for its first job) and a sample of each kind made only on demand (a tower,
 * a pool, a growth transition). Each first draw in play then finds its shader already linked.
 */
export class ShaderWarmup {
  private added: { layer: pc.Layer; comp: pc.RenderComponent; mis: pc.MeshInstance[]; casters: pc.MeshInstance[] }[] = [];
  private samples?: pc.Entity;
  private culling = true;
  private frames = -1;

  constructor(
    private app: pc.AppBase,
    private camera: pc.CameraComponent,
  ) {}

  /** Not started, running, or done. */
  get state(): 'idle' | 'running' | 'done' {
    return this.frames < 0 ? 'idle' : this.frames === Infinity ? 'done' : 'running';
  }

  /** Puts everything in to be drawn, from the next frame on; `samples` are mesh and material pairs made for it. */
  start(root: pc.Entity, samples: [pc.Mesh, pc.Material][], sampleLayers: number[]) {
    if (this.frames >= 0) return;
    this.frames = 0;
    // the samples: never culled, drawn where the camera looks (behind the loading screen)
    const e = new pc.Entity('shader-warmup');
    const mis = samples.map(([mesh, mat]) => {
      const mi = new pc.MeshInstance(mesh, mat);
      mi.cull = false;
      return mi;
    });
    e.addComponent('render', { meshInstances: mis, layers: sampleLayers, castShadows: true, receiveShadows: true });
    this.app.root.addChild(e);
    this.samples = e;
    // everything that exists but is in no layer now (under a disabled entity)
    for (const c of root.findComponents('render') as pc.RenderComponent[]) {
      const list = c.meshInstances;
      if (!list?.length || ShaderWarmup.active(c)) continue;
      for (const id of c.layers) {
        const layer = this.app.scene.layers.getLayerById(id);
        if (!layer) continue;
        const mis = list.filter((mi) => !layer.meshInstancesSet.has(mi));
        if (!mis.length) continue;
        const casters = mis.filter((mi) => mi.castShadow && !layer.shadowCastersSet.has(mi));
        layer.addMeshInstances(mis, true);
        layer.addShadowCasters(casters);
        this.added.push({ layer, comp: c, mis, casters });
      }
    }
    // and what is out of view
    this.culling = this.camera.frustumCulling;
    this.camera.frustumCulling = false;
  }

  /** A render component drawing now (its own and every parent entity enabled); a destroyed one is not. */
  private static active(c: pc.RenderComponent): boolean {
    return !!c.entity && c.enabled && c.entity.enabled; // an entity's `enabled` is false under a disabled parent too
  }

  /** How many of them are in for now (for the tests). */
  get warming(): number {
    return this.added.reduce((n, a) => n + a.mis.length, 0) + (this.samples?.render?.meshInstances.length ?? 0);
  }

  /** Called once a frame: after `frames` drawn frames, takes it all out again. */
  update(frames = 2) {
    if (this.state !== 'running') return;
    if (++this.frames <= frames) return;
    this.finish();
  }

  finish() {
    if (this.state !== 'running') return;
    for (const { layer, comp, mis, casters } of this.added) {
      if (ShaderWarmup.active(comp)) continue; // enabled meanwhile: it draws on, as its own
      layer.removeMeshInstances(mis, true);
      layer.removeShadowCasters(casters);
    }
    this.added = [];
    const meshes = new Set(this.samples?.render?.meshInstances.map((mi) => mi.mesh));
    this.samples?.destroy();
    this.samples = undefined;
    for (const m of meshes) m?.destroy();
    this.camera.frustumCulling = this.culling;
    this.frames = Infinity;
  }
}
