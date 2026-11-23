// Renders the loading screen's Bloombot from the real model and saves it as two sprite strips:
//   src/ui/loading/bot-walk.webp   one walk cycle, walking towards screen right
//   src/ui/loading/bot-turn.webp   standing, turning from walking right to facing the camera
// and prints the timing the loading screen's CSS uses (src/ui/title.css, the .ld-walker block).
//
//   node tools/bot-sprite/make.mjs
//
// Run it again after Bloombot's model, face or walk changes. It serves tools/bot-sprite/ with Vite's dev server and
// renders in Chromium with the GPU (one heavy job: wrap it in ~/.solarbloom/heavy.sh).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = 'src/ui/loading';
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { port: 4213, strictPort: true }, logLevel: 'silent' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 400 } });
  page.on('pageerror', (e) => console.error('page error:', e));
  await page.goto('http://localhost:4213/tools/bot-sprite/index.html');
  await page.waitForFunction(() => 'renderSprites' in window, null, { timeout: 120_000 });
  const r = await page.evaluate(async () => {
    const s = await window.renderSprites();
    /** Stitches frames side by side into one strip. */
    const strip = async (frames) => {
      const imgs = await Promise.all(
        frames.map(
          (src) =>
            new Promise((ok) => {
              const i = new Image();
              i.onload = () => ok(i);
              i.src = src;
            }),
        ),
      );
      const c = document.createElement('canvas');
      c.width = imgs[0].width * imgs.length;
      c.height = imgs[0].height;
      const g = c.getContext('2d');
      imgs.forEach((im, k) => g.drawImage(im, k * im.width, 0));
      return c.toDataURL('image/webp', 0.92);
    };
    return { walk: await strip(s.walk), turn: await strip(s.turn), frames: { walk: s.walk.length, turn: s.turn.length }, period: s.period, pxPerSecond: s.pxPerSecond };
  });
  for (const k of ['walk', 'turn']) writeFileSync(`${out}/bot-${k}.webp`, Buffer.from(r[k].split(',')[1], 'base64'));
  // the loading screen shows the frames at half size (120 × 150)
  console.log(`frames: walk ${r.frames.walk}, turn ${r.frames.turn}`);
  console.log(`walk cycle: ${r.period.toFixed(3)} s; on screen it moves ${(r.pxPerSecond / 2).toFixed(1)} CSS px per second`);
} finally {
  await browser.close();
  await server.close();
}
