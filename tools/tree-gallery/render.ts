// P7-E29: a gallery of every tree species at one stage and detail level, beside a Bloombot-sized post, lit by one
// shadowing sun, so tree shapes can be judged without loading the whole game. tools/tree-gallery/shoot.mjs opens it.
//   ?stage=3&lod=1&scale=1&view=side|iso|third|top&variant=0
import * as pc from 'playcanvas';
import { foliageMaterial, treeMesh } from '../../src/rendering/Foliage';
import { LOOK } from '../../src/data/look';
import { SPECIES, treeGeo, type Form, type Lod, type Species, type TreeStage } from '../../src/rendering/TreeGen';

const q = new URLSearchParams(location.search);
const stage = +(q.get('stage') ?? 3) as TreeStage;
const lod = +(q.get('lod') ?? 1) as Lod;
const scale = +(q.get('scale') ?? 1.8);
const variant = +(q.get('variant') ?? 0);
const view = q.get('view') ?? 'side';
// forms=1: the P7-E29 forms (umbrella, columnar, fruit, coastal) and the willow, instead of the five species
const items: [Species, Form][] = q.get('forms') ? [['oak', 'umbrella'], ['birch', 'columnar'], ['cherry', 'fruit'], ['oak', 'coastal'], ['willow', 'standard']] : SPECIES.map((sp) => [sp, 'standard']);
const W = 1600, H = 700;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const app = new pc.Application(canvas, { graphicsDeviceOptions: { preserveDrawingBuffer: true, antialias: true } });
app.setCanvasFillMode(pc.FILLMODE_NONE);
app.setCanvasResolution(pc.RESOLUTION_FIXED, W, H);
app.scene.ambientLight = new pc.Color(0.42, 0.45, 0.5);

const camera = new pc.Entity('camera');
camera.addComponent('camera', { clearColor: new pc.Color(0.62, 0.77, 0.9), nearClip: 0.1, farClip: 200, fov: 30 });
camera.camera!.toneMapping = pc.TONEMAP_ACES;
camera.camera!.gammaCorrection = pc.GAMMA_SRGB;
const span = SPECIES.length * 3.2;
if (view === 'iso') camera.setPosition(span / 2 - 1.6, 14, 14);
else if (view === 'top') camera.setPosition(span / 2 - 1.6, 24, 0.5);
else if (view === 'third') camera.setPosition(0.5, 1.1, 3.2);
else camera.setPosition(span / 2 - 1.6, 2.2, 17);
camera.lookAt(view === 'third' ? 0.5 : span / 2 - 1.6, view === 'third' ? 1.2 : view === 'top' ? 0 : 1.4, view === 'top' ? -1.5 : 0);
app.root.addChild(camera);

const sun = new pc.Entity('sun');
sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.94, 0.84), intensity: 1.6, castShadows: true, shadowDistance: 40, shadowResolution: 2048, shadowBias: 0.2, normalOffsetBias: 0.05, shadowType: pc.SHADOW_PCF3_32F });
// the game's sun (data/look.ts LOOK.sun), so shadows and dappled shade fall as they do in the world
const el = (LOOK.sun.elevation * Math.PI) / 180;
const [hx, hz] = LOOK.sun.toward;
const hl = Math.hypot(hx, hz) || 1;
sun.setRotation(new pc.Quat().setFromDirections(pc.Vec3.DOWN, new pc.Vec3((hx / hl) * Math.cos(el), -Math.sin(el), (hz / hl) * Math.cos(el)).normalize()));
app.root.addChild(sun);

const ground = new pc.Entity('ground');
const gm = new pc.StandardMaterial();
gm.diffuse = new pc.Color(0.3, 0.52, 0.22);
gm.update();
ground.addComponent('render', { type: 'plane', material: gm });
ground.setLocalScale(80, 1, 40);
ground.setPosition(span / 2, 0, 0);
app.root.addChild(ground);

// Bloombot is about half a tile tall
const bm = new pc.StandardMaterial();
bm.diffuse = new pc.Color(0.95, 0.95, 0.92);
bm.update();
const mat = foliageMaterial();
let tris = 0;
items.forEach(([sp, form], i) => {
  const g = treeGeo(sp, stage, variant, lod, form);
  tris += g.tris;
  const e = new pc.Entity(sp);
  e.addComponent('render', { meshInstances: [new pc.MeshInstance(treeMesh(app.graphicsDevice, g), mat)], castShadows: true, receiveShadows: true });
  e.setPosition(i * 3.2, 0, 0);
  e.setLocalScale(scale, scale, scale);
  app.root.addChild(e);
  const bot = new pc.Entity('bot');
  bot.addComponent('render', { type: 'capsule', material: bm });
  bot.setLocalScale(0.25, 0.5, 0.25);
  bot.setPosition(i * 3.2 + 1.0, 0.25, 0.6);
  app.root.addChild(bot);
  (window as unknown as { treeInfo: Record<string, number> }).treeInfo ??= {};
  (window as unknown as { treeInfo: Record<string, number> }).treeInfo[form === 'standard' ? sp : form] = g.tris;
});
app.start();
let frames = 0;
app.on('update', () => {
  if (++frames === 4) (window as unknown as { ready: number }).ready = tris;
});
