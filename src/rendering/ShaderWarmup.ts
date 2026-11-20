import * as pc from 'playcanvas';

/** A mesh and material to draw once; `own` meshes were made for the warm-up and are destroyed after it. */
export interface WarmupSample {
  mesh: pc.Mesh;
  material: pc.Material;
  own?: boolean;
}

/**
 * #596: warm the shaders behind the loading screen. The first draw of a material variant compiles and links its
 * shader there and then, and on a real GPU that is 40–250 ms each: a hitch on the first pulse, the first pool on
 * screen, or an area waking (its towers, its props turning from neglected to alive, its Keeper). While the loading
 * screen is still up this draws, for a few frames, everything the scene holds but would not draw yet (out of view,
 * or under a disabled entity: a progress ring waiting for its first job) and a sample of each kind made only on
 * demand (a tower, a pool, a growth transition, every model's living look). Each first draw in play then finds its
 * shader already linked.
 */
export class ShaderWarmup {
  private added: { layer: pc.Layer; comp?: pc.RenderComponent; mis: pc.MeshInstance[]; casters: pc.MeshInstance[] }[] = [];
  private own: pc.Mesh[] = [];
  private node?: pc.GraphNode;
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

  /** Puts everything in to be drawn, from the next frame on. */
  start(root: pc.Entity, samples: WarmupSample[], sampleLayers: number[]) {
    if (this.frames >= 0) return;
    this.frames = 0;
    // the samples: straight into the layers (no render component: removing one would destroy a shared mesh), never
    // culled, drawn at the origin (behind the loading screen)
    const node = (this.node = new pc.GraphNode('shader-warmup'));
    this.app.root.addChild(node);
    const mis = samples.map((s) => {
      const mi = new pc.MeshInstance(s.mesh, s.material, node);
      mi.cull = false;
      mi.castShadow = true;
      if (s.own) this.own.push(s.mesh);
      return mi;
    });
    for (const id of sampleLayers) {
      const layer = this.app.scene.layers.getLayerById(id);
      if (layer && mis.length) this.add(layer, mis);
    }
    // everything that exists but is in no layer now (under a disabled entity)
    for (const c of root.findComponents('render') as pc.RenderComponent[]) {
      const list = c.meshInstances;
      if (!list?.length || ShaderWarmup.active(c)) continue;
      for (const id of c.layers) {
        const layer = this.app.scene.layers.getLayerById(id);
        if (layer) this.add(layer, list, c);
      }
    }
    // and what is out of view
    this.culling = this.camera.frustumCulling;
    this.camera.frustumCulling = false;
  }

  private add(layer: pc.Layer, list: readonly pc.MeshInstance[], comp?: pc.RenderComponent) {
    const mis = list.filter((mi) => !layer.meshInstancesSet.has(mi));
    if (!mis.length) return;
    const casters = mis.filter((mi) => mi.castShadow && !layer.shadowCastersSet.has(mi));
    layer.addMeshInstances(mis, true);
    layer.addShadowCasters(casters);
    this.added.push({ layer, comp, mis, casters });
  }

  /** A render component drawing now (its own and every parent entity enabled); a destroyed one is not. */
  private static active(c: pc.RenderComponent): boolean {
    return !!c.entity && c.enabled && c.entity.enabled; // an entity's `enabled` is false under a disabled parent too
  }

  /** How many mesh instances are in for now (for the tests). */
  get warming(): number {
    return this.added.reduce((n, a) => n + a.mis.length, 0);
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
      if (comp && ShaderWarmup.active(comp)) continue; // enabled meanwhile: it draws on, as its own
      layer.removeMeshInstances(mis, true);
      layer.removeShadowCasters(casters);
    }
    this.added = [];
    this.node?.destroy();
    this.node = undefined;
    for (const m of this.own) m.destroy();
    this.own = [];
    this.camera.frustumCulling = this.culling;
    this.frames = Infinity;
  }
}
