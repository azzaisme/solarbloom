// P7-E32.8 (#762): what the distant ruins cost per fixed camera: how many of their meshes the camera draws (each is one
// draw call; the rest are culled), out of how many, and the frame's total draw calls.
//   npx vite build && node tests/e2e/p7-ruins-cost.mjs        STAGES=early,late   CAMS=third,iso,shore
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { CHROME_ARGS, openGame, placeCam, setStage, setTime, TIMES } from './lib/p7-scene.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const STAGES = (process.env.STAGES ?? 'early').split(',');
const CAMS = (process.env.CAMS ?? 'third,iso,shore').split(',');
const port = +(process.env.PORT ?? 4261);
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: CHROME_ARGS });
let failed = false;
try {
  for (const stage of STAGES) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openGame(page, port, process.env.GFX ?? 'high', stage);
    const start = await setStage(page, stage);
    await setTime(page, TIMES.day, 3000);
    const zoom0 = await page.evaluate(() => window.solarbloom.camera.zoom);
    for (const cam of CAMS) {
      await placeCam(page, cam, start, zoom0);
      await page.evaluate(() => (window.solarbloom.app.autoRender = true));
      await page.waitForTimeout(6000); // a few frames at software GL's ~1 fps
      const r = await page.evaluate(() => {
        const g = window.solarbloom;
        // a slice switched off keeps its last visibleThisFrame, so count only the enabled ones
        const slices = g.ruins.root.children;
        const drawn = !g.ruins.root.enabled ? 0 : slices.filter((e) => e.enabled && e.render?.meshInstances.some((m) => m.visibleThisFrame)).length;
        const out = { ruinsDrawn: drawn, ruinsMeshes: slices.length, drawCalls: g.app.stats.drawCalls?.total ?? 0 };
        g.app.autoRender = false;
        return out;
      });
      console.log(`  ${stage}-day-${cam}: ${JSON.stringify(r)}`);
    }
    if (errors.length) {
      failed = true;
      console.error('  ✗ page errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
    }
    await page.close();
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failed ? 'FAILED' : 'all good');
process.exit(failed ? 1 : 0);
