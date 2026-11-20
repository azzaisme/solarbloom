import { describe, expect, it } from 'vitest';
import * as pc from 'playcanvas';
import { ShaderWarmup } from '../src/rendering/ShaderWarmup';

/** A headless app with render and camera components (a null device: nothing is drawn, the layers are real). */
function app() {
  const canvas = { width: 1, height: 1, getContext: () => null, addEventListener() {}, removeEventListener() {}, style: {} } as unknown as HTMLCanvasElement;
  const a = new pc.AppBase(canvas);
  const opts = new pc.AppOptions();
  opts.graphicsDevice = new pc.NullGraphicsDevice(canvas);
  opts.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem];
  a.init(opts);
  const cam = new pc.Entity('camera');
  cam.addComponent('camera');
  a.root.addChild(cam);
  const world = a.scene.layers.getLayerById(pc.LAYERID_WORLD)!;
  const box = () => {
    const m = new pc.Mesh(a.graphicsDevice);
    m.setPositions([0, 0, 0, 1, 0, 0, 0, 0, 1]);
    m.setIndices([0, 1, 2]);
    m.update();
    return m;
  };
  const thing = (name: string, parent: pc.Entity = a.root) => {
    const e = new pc.Entity(name);
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(box(), new pc.StandardMaterial())], castShadows: true });
    parent.addChild(e);
    return e;
  };
  return { a, cam: cam.camera!, world, box, thing };
}

const mi = (e: pc.Entity) => e.render!.meshInstances[0];

describe('#596: shaders warm behind the loading screen', () => {
  it('draws what sleeps under a disabled entity for a few frames, then leaves the layers as they were', () => {
    const { a, cam, world, thing } = app();
    const shown = thing('shown');
    const off = thing('keeper');
    off.enabled = false;
    const group = new pc.Entity('rings');
    a.root.addChild(group);
    const child = thing('ring', group);
    group.enabled = false; // disabled through its parent
    expect(world.meshInstancesSet.has(mi(shown))).toBe(true);
    expect(world.meshInstancesSet.has(mi(off))).toBe(false);
    expect(world.meshInstancesSet.has(mi(child))).toBe(false);

    const w = new ShaderWarmup(a, cam);
    expect(w.state).toBe('idle');
    w.start(a.root, [], [pc.LAYERID_WORLD]);
    expect(w.state).toBe('running');
    for (const e of [shown, off, child]) expect(world.meshInstancesSet.has(mi(e))).toBe(true);
    expect(world.shadowCastersSet.has(mi(off))).toBe(true);
    expect(cam.frustumCulling).toBe(false); // what is out of view draws too

    w.update(2);
    w.update(2);
    expect(w.state).toBe('running');
    w.update(2);
    expect(w.state).toBe('done');
    expect(world.meshInstancesSet.has(mi(shown))).toBe(true); // what was drawn before stays
    expect(world.meshInstancesSet.has(mi(off))).toBe(false);
    expect(world.meshInstancesSet.has(mi(child))).toBe(false);
    expect(world.shadowCastersSet.has(mi(off))).toBe(false);
    expect(cam.frustumCulling).toBe(true);
    a.destroy();
  });

  it('samples of materials made on demand draw unculled; its own meshes go after, a shared one stays', () => {
    const { a, cam, world, box } = app();
    const mine = box();
    const shared = box(); // a model library's cached part: other entities instantiate it later
    const mats = [new pc.StandardMaterial(), new pc.StandardMaterial(), new pc.StandardMaterial()];
    const w = new ShaderWarmup(a, cam);
    w.start(a.root, [{ mesh: mine, material: mats[0], own: true }, { mesh: mine, material: mats[1], own: true }, { mesh: shared, material: mats[2] }], [pc.LAYERID_WORLD]);
    const samples = [...world.meshInstancesSet].filter((m) => m.mesh === mine || m.mesh === shared);
    expect(samples.map((m) => m.material)).toEqual(mats);
    expect(samples.every((m) => m.cull === false && m.castShadow)).toBe(true);
    expect(w.warming).toBe(3);
    w.finish();
    expect([...world.meshInstancesSet].some((m) => m.mesh === mine || m.mesh === shared)).toBe(false);
    expect([...world.shadowCastersSet].some((m) => m.mesh === mine || m.mesh === shared)).toBe(false);
    expect(a.root.findByName('shader-warmup')).toBeNull();
    expect(w.warming).toBe(0);
    expect(mine.vertexBuffer).toBeFalsy(); // destroyed
    expect(shared.vertexBuffer).toBeTruthy(); // still there for the library
    a.destroy();
  });

  it('something enabled while it warms keeps drawing; one destroyed meanwhile leaves nothing behind', () => {
    const { a, cam, world, thing } = app();
    const ring = thing('ring');
    const gone = thing('gone');
    ring.enabled = false;
    gone.enabled = false;
    const goneMi = mi(gone);
    const w = new ShaderWarmup(a, cam);
    w.start(a.root, [], [pc.LAYERID_WORLD]);
    ring.enabled = true; // the game shows it during the warm-up frames
    gone.destroy();
    w.finish();
    expect(world.meshInstancesSet.has(mi(ring))).toBe(true);
    expect(world.meshInstancesSet.has(goneMi)).toBe(false);
    a.destroy();
  });

  it('starts once', () => {
    const { a, cam, world, thing } = app();
    const w = new ShaderWarmup(a, cam);
    w.start(a.root, [], [pc.LAYERID_WORLD]);
    w.finish();
    const late = thing('late');
    late.enabled = false;
    w.start(a.root, [], [pc.LAYERID_WORLD]);
    expect(w.state).toBe('done');
    expect(world.meshInstancesSet.has(mi(late))).toBe(false);
    a.destroy();
  });
});
