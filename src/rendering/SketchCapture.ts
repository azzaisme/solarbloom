import * as pc from 'playcanvas';
import { Rng } from '../core/Rng';
import { visitorModelUrl } from './Visitors';

export const SKETCH_WIDTH = 480;
export const SKETCH_HEIGHT = 400;

export interface SketchCapture {
  /** RGB view normals. Alpha is zero on paper and encodes object and depth elsewhere. */
  geometry: Uint8Array;
  /** Lit colour from the same camera, including the frog's markings. */
  colour: Uint8Array;
}

function frogAsset(app: pc.Application): Promise<pc.ContainerResource> {
  return new Promise((resolve, reject) => {
    app.assets.loadFromUrl(visitorModelUrl('frog'), 'container', (error, asset) => {
      if (error || !asset?.resource) reject(new Error('The frog model could not load.'));
      else resolve(asset.resource as pc.ContainerResource);
    });
  });
}

function frame(app: pc.Application): Promise<void> {
  return new Promise((resolve, reject) => {
    const handle = app.once('frameend', () => {
      clearTimeout(timeout);
      resolve();
    });
    const timeout = window.setTimeout(() => {
      handle.off();
      reject(new Error('The sketch camera did not render.'));
    }, 5000);
    app.renderNextFrame = true;
  });
}

function padMesh(device: pc.GraphicsDevice): pc.Mesh {
  const positions = [-0.22, -0.025, 0.12];
  const indices: number[] = [];
  for (let i = 0; i <= 48; i++) {
    const a = 0.17 + (i / 48) * (Math.PI * 2 - 0.34);
    const r = 1 + 0.022 * Math.sin(a * 11) + 0.02 * Math.sin(a * 5);
    positions.push(-0.22 - 1.64 * r * Math.sin(a), 0.045 * Math.cos(a) ** 2 - 0.025, 0.12 + 1.34 * r * Math.cos(a));
    if (i > 0) indices.push(0, i + 1, i);
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(pc.calculateNormals(positions, indices));
  mesh.setIndices(indices);
  mesh.update();
  return mesh;
}

function captureMaterial(source: pc.StandardMaterial, camera: pc.Entity, object: number) {
  const material = source.clone();
  material.useLighting = true; // keep the normal varying and the normal-map path active
  const chunks = material.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
  chunks.set('litUserDeclarationPS', `
    uniform vec3 sketchRight;
    uniform vec3 sketchUp;
    uniform vec3 sketchBack;
    uniform float sketchObject;
    uniform float sketchGeometry;
  `);
  chunks.set('litUserMainEndPS', `
    vec3 n = normalize(litArgs_worldNormal);
    vec3 viewNormal = vec3(dot(n, sketchRight), dot(n, sketchUp), dot(n, sketchBack));
    if (sketchGeometry > 0.5) {
      gl_FragColor = vec4(viewNormal * 0.5 + 0.5, sketchObject + gl_FragCoord.z * 0.30);
    } else {
      float light = 0.30 + 0.70 * max(0.0, dot(viewNormal, normalize(vec3(-0.5, 0.7, 0.62))));
      gl_FragColor = vec4(pow(max(litArgs_albedo * light, vec3(0.0)), vec3(0.45)), 1.0);
    }
  `);
  const vec = (v: pc.Vec3) => new Float32Array([v.x, v.y, v.z]);
  material.setParameter('sketchRight', vec(camera.right));
  material.setParameter('sketchUp', vec(camera.up));
  material.setParameter('sketchBack', vec(camera.forward.clone().mulScalar(-1)));
  material.setParameter('sketchObject', object);
  material.setParameter('sketchGeometry', 1);
  material.update();
  return material;
}

/** Draw only the sketch subjects on two requested frames, away from the live world camera. */
export async function captureFrog(app: pc.Application, seed: number): Promise<SketchCapture> {
  const resource = await frogAsset(app);
  const rng = new Rng(seed);
  const device = app.graphicsDevice;
  const layer = new pc.Layer({ name: 'Tide sketch capture' });
  const root = new pc.Entity('Tide sketch capture');
  const textures = new pc.Texture(device, {
    name: 'tide-sketch', width: SKETCH_WIDTH, height: SKETCH_HEIGHT, format: pc.PIXELFORMAT_RGBA8, mipmaps: false,
  });
  const target = new pc.RenderTarget({ colorBuffer: textures, depth: true, samples: 1 });
  const materials = new Map<pc.Material, pc.StandardMaterial>();
  let pad: pc.Mesh | undefined;
  const padSource = new pc.StandardMaterial();
  try {
    const cam = new pc.Entity('Tide sketch camera');
    cam.addComponent('camera', {
      layers: [layer.id], priority: -15, projection: pc.PROJECTION_ORTHOGRAPHIC, orthoHeight: 2.0,
      nearClip: 0.1, farClip: 12, clearColor: new pc.Color(0, 0, 0, 0), renderTarget: target,
    });
    const angle = rng.range(0.23, 0.83) * (seed % 2 ? 1 : -1);
    cam.setPosition(Math.sin(angle) * 5.5, rng.range(2.8, 4.1), Math.cos(angle) * 5.5);
    cam.lookAt(rng.range(-0.18, 0.18), 0.55, 0);
    root.addChild(cam);
    // Keep PlayCanvas's normal-map path active on this isolated layer.
    const lamp = new pc.Entity('Tide sketch light');
    lamp.addComponent('light', { type: 'directional', layers: [layer.id], castShadows: false });
    root.addChild(lamp);

    const frog = resource.instantiateRenderEntity({ layers: [layer.id], castShadows: false, receiveShadows: false });
    const fit = new pc.Entity('Frog framing');
    fit.addChild(frog);
    root.addChild(fit);
    root.syncHierarchy();
    const meshes = (frog.findComponents('render') as pc.RenderComponent[]).flatMap((render) => render.meshInstances);
    if (!meshes.length) throw new Error('The frog model has no visible surface.');
    const box = new pc.BoundingBox(meshes[0].aabb.center.clone(), meshes[0].aabb.halfExtents.clone());
    for (const mesh of meshes.slice(1)) box.add(mesh.aabb);
    const scale = 1.94 / (2 * box.halfExtents.x);
    fit.setLocalScale(scale, scale, scale);
    fit.setLocalPosition(-box.center.x * scale, (box.halfExtents.y - box.center.y) * scale, -box.center.z * scale);
    for (const mesh of meshes) {
      if (!(mesh.material instanceof pc.StandardMaterial)) throw new Error('The frog has an unsupported material.');
      let material = materials.get(mesh.material);
      if (!material) {
        material = captureMaterial(mesh.material, cam, 0.10);
        materials.set(mesh.material, material);
      }
      mesh.material = material;
    }

    pad = padMesh(device);
    padSource.diffuse.set(0.40, 0.53, 0.22);
    const leaf = new pc.Entity('Lily pad');
    const padMaterial = captureMaterial(padSource, cam, 0.57);
    materials.set(padSource, padMaterial);
    leaf.addComponent('render', {
      meshInstances: [new pc.MeshInstance(pad, padMaterial)], layers: [layer.id], castShadows: false, receiveShadows: false,
    });
    root.addChild(leaf);

    app.scene.layers.push(layer);
    app.root.addChild(root);
    const read = async () => {
      await frame(app);
      const pixels = await textures.read(0, 0, SKETCH_WIDTH, SKETCH_HEIGHT, { renderTarget: target }) as Uint8Array;
      const upright = new Uint8Array(pixels.length);
      const row = SKETCH_WIDTH * 4;
      for (let y = 0; y < SKETCH_HEIGHT; y++) upright.set(pixels.subarray((SKETCH_HEIGHT - y - 1) * row, (SKETCH_HEIGHT - y) * row), y * row);
      return upright;
    };
    const geometry = await read();
    if (!geometry.some((value, i) => i % 4 === 3 && value > 0 && value < 128)) throw new Error('The sketch camera did not see the frog.');
    for (const material of materials.values()) material.setParameter('sketchGeometry', 0);
    return { geometry, colour: await read() };
  } finally {
    root.destroy();
    app.scene.layers.remove(layer);
    target.destroy();
    textures.destroy();
    for (const material of materials.values()) material.destroy();
    padSource.destroy();
    pad?.destroy();
  }
}
