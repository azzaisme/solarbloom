// P7-E32 (#762): what re-placing the distant ruins costs the CPU on a frame where the camera moves. Every vertex of the
// slices in view is slid along its ray each such frame (Ruins.update); this times that call in-page while the camera
// turns a degree per call (pure JS plus the vertex upload, so software GL's slow rendering doesn't skew it).
//   npx vite build && node tests/e2e/p7-ruins-cpu.mjs        CAMS=third,shore   CALLS=240
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { CHROME_ARGS, openGame, placeCam, setTime, TIMES } from './lib/p7-scene.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const CAMS = (process.env.CAMS ?? 'third,shore').split(',');
const CALLS = +(process.env.CALLS ?? 240);
const port = +(process.env.PORT ?? 4262);
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: CHROME_ARGS });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await openGame(page, port, process.env.GFX ?? 'high', 'cpu');
  await page.evaluate(() => window.solarbloom.ruins.ready);
  await setTime(page, TIMES.day, 2000);
  const start = await page.evaluate(() => [window.solarbloom.bot.pose.x, window.solarbloom.bot.pose.z]);
  const zoom0 = await page.evaluate(() => window.solarbloom.camera.zoom);
  for (const cam of CAMS) {
    await placeCam(page, cam, start, zoom0);
    const r = await page.evaluate((calls) => {
      const g = window.solarbloom;
      const pos = g.camera.entity.getPosition().clone();
      const f0 = g.camera.entity.forward.clone();
      const fog = g.app.scene.fog;
      const times = [];
      for (let i = 0; i < calls; i++) {
        // turn a degree a call (and creep forward a little), as a camera swinging round would
        const a = (i * Math.PI) / 180;
        const fwd = f0.clone();
        fwd.set(f0.x * Math.cos(a) - f0.z * Math.sin(a), f0.y, f0.x * Math.sin(a) + f0.z * Math.cos(a));
        pos.x += 0.01;
        const t = performance.now();
        g.ruins.update(pos, fwd, fog.start, fog.end);
        times.push(performance.now() - t);
      }
      times.sort((x, y) => x - y);
      const q = (p) => +times[Math.min(times.length - 1, Math.floor(p * times.length))].toFixed(3);
      return { calls, median: q(0.5), p95: q(0.95), max: q(1) };
    }, CALLS);
    console.log(`  ${cam}: ruins re-placed per moving frame (ms): ${JSON.stringify(r)}`);
  }
  await page.close();
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failed ? 'FAILED' : 'all good');
process.exit(failed ? 1 : 0);
