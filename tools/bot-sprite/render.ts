// The loading screen's Bloombot, rendered from the real model (rendering/BloombotVisuals: the GLB, its face sheet,
// the green glow and the walk and idle clips, exactly as the game draws it) into transparent frames. The page only
// renders; tools/bot-sprite/make.mjs opens it, stitches the frames into strips and saves them to src/ui/loading/.
import * as pc from 'playcanvas';
import { BloombotVisuals } from '../../src/rendering/BloombotVisuals';

/** One frame's size in pixels (twice the loading screen's 120 × 150, for sharp 2× screens). */
export const FRAME = { w: 240, h: 300 } as const;
/** Half the view's height in world units (the camera is orthographic, so a unit is the same size everywhere). */
const ORTHO = 0.6;
/** Bloombot's facing while walking: towards screen right, turned a little towards the camera (radians, 0 = facing it). */
const WALK_FACING = Math.PI / 2 - 0.55;
/** Its walking speed (world units per second) for the frames: an easy amble. */
const SPEED = 1.1;

const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = FRAME.w;
canvas.height = FRAME.h;
const app = new pc.Application(canvas, { graphicsDeviceOptions: { alpha: true, preserveDrawingBuffer: true, antialias: true } });
app.setCanvasFillMode(pc.FILLMODE_NONE);
app.setCanvasResolution(pc.RESOLUTION_FIXED, FRAME.w, FRAME.h);
app.scene.ambientLight = new pc.Color(0.52, 0.5, 0.48);

const camera = new pc.Entity('camera');
camera.addComponent('camera', {
  projection: pc.PROJECTION_ORTHOGRAPHIC,
  orthoHeight: ORTHO,
  clearColor: new pc.Color(0, 0, 0, 0),
  nearClip: 0.1,
  farClip: 20,
});
camera.camera!.toneMapping = pc.TONEMAP_ACES;
camera.camera!.gammaCorrection = pc.GAMMA_SRGB;
camera.setPosition(0, 1.3, 6);
camera.lookAt(0, 0.56, 0);
app.root.addChild(camera);

// a warm sun from the upper left and in front, and a soft cool fill from the right, like a bright afternoon
const sun = new pc.Entity('sun');
sun.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.93, 0.82), intensity: 1.25, castShadows: false });
sun.setEulerAngles(40, -35, 0);
app.root.addChild(sun);
const fill = new pc.Entity('fill');
fill.addComponent('light', { type: 'directional', color: new pc.Color(0.75, 0.85, 1), intensity: 0.45, castShadows: false });
fill.setEulerAngles(20, 140, 0);
app.root.addChild(fill);

const holder = new pc.Entity('bot');
app.root.addChild(holder);
const bot = new BloombotVisuals(app, holder);
app.start();

const internals = bot as unknown as { loaded: boolean; clips: Map<string, number>; model?: pc.Entity };
const step = (dt: number) => {
  bot.update(dt);
  app.update(dt);
  app.render();
};

/** Renders the frames: one walk cycle, and a turn from walking right to facing the camera (in the idle clip). */
async function renderSprites() {
  while (!internals.loaded) await new Promise((r) => setTimeout(r, 50));
  // the face sheet loads on its own: give it a moment
  await new Promise((r) => setTimeout(r, 1200));
  app.timeScale = 0; // from here the frames advance only by hand
  bot.place(0, 0, 0, WALK_FACING);
  bot.setMove({ pace: SPEED, accel: 0, walk: 2.6, run: 4.6, climb: 0, wading: false, still: 0 });
  bot.setMotion(SPEED, false);
  const anim = internals.model!.anim!;
  for (let i = 0; i < 90; i++) step(1 / 30); // settle into the walk
  const period = (internals.clips.get('walk') ?? 1) / Math.max(0.01, anim.speed);
  const WALK_FRAMES = 16;
  const walk: string[] = [];
  for (let i = 0; i < WALK_FRAMES; i++) {
    step(period / WALK_FRAMES);
    walk.push(canvas.toDataURL('image/png'));
  }
  // stop, then turn to face the camera
  bot.setMove({ pace: 0, accel: 0, walk: 2.6, run: 4.6, climb: 0, wading: false, still: 0 });
  bot.setMotion(0, false);
  for (let i = 0; i < 12; i++) step(1 / 30);
  const TURN_FRAMES = 6;
  const turn: string[] = [];
  for (let i = 0; i < TURN_FRAMES; i++) {
    const k = i / (TURN_FRAMES - 1);
    bot.place(0, 0, 0, WALK_FACING * (1 - k));
    step(1 / 30);
    turn.push(canvas.toDataURL('image/png'));
  }
  // how far a step carries it on screen, so the loading screen moves it at the speed its feet go
  const pxPerUnit = FRAME.h / (ORTHO * 2);
  const across = Math.sin(WALK_FACING);
  return { walk, turn, period, pxPerSecond: SPEED * across * pxPerUnit };
}

(window as unknown as { renderSprites: typeof renderSprites }).renderSprites = renderSprites;
