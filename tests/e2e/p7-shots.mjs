// Phase 7 (The Living Landscape): fixed-camera reference shots and image metrics.
//   npm run build, then node tests/e2e/p7-shots.mjs [outDir]          (default docs/review/p7/<TAG>)
// Cameras (docs/VISUAL_ACCEPTANCE_TESTS.md):
//   A third     Bloombot's start, the follow (third-person) camera as the game opens it
//   B iso       the furthest zoom, high and looking down over the start, the canal and the bay
//   C shore     on the canal bank by the plank bridge, looking along the water past restored and ruined ground
// Stages (the ground round the spots):
//   early   a fresh game, nothing restored
//   mid     the start's area restored to full bloom (radius 8 round the start and the canal spot)
//   late    a wide stretch restored to full bloom (radius 20 round each spot, every area there cleared)
// Each shot is saved with and without the HUD (`-ui`), and metrics are printed and written to metrics.json:
// clipped world pixels (any channel ≥ 254, the top 22% of the frame skipped as sky), mean luminance, draw calls and
// triangles.   TAG=before|after (default after)   ONLY=day,golden,night (default day)   STAGES=early,mid,late
//   CAMS=third,iso,shore   NOUI=1 skips the HUD shots   DIST=dist-base serves another build
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { CHROME_ARGS, measure, openGame, placeCam, setStage, setTime, shoot, TIMES as ALL } from './lib/p7-scene.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const TAG = process.env.TAG ?? 'after';
const dir = process.argv[2] ?? `docs/review/p7/${TAG}`;
mkdirSync(dir, { recursive: true });
const TIMES = Object.fromEntries(Object.entries(ALL).filter(([k]) => (process.env.ONLY ?? 'day').split(',').includes(k)));
const STAGES = (process.env.STAGES ?? 'early,mid,late').split(',');
const CAMS = (process.env.CAMS ?? 'third,iso,shore').split(',');
const port = +(process.env.PORT ?? 4251);
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: CHROME_ARGS });
const metrics = {};
let failed = false;

try {
  for (const stage of STAGES) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await openGame(page, port, process.env.GFX ?? 'high', stage);
    const start = await setStage(page, stage);
    for (const [time, f] of Object.entries(TIMES)) {
      await setTime(page, f, stage === 'early' ? 3000 : 12000);
      const zoom0 = await page.evaluate(() => window.solarbloom.camera.zoom);
      for (const cam of CAMS) {
        const info = await placeCam(page, cam, start, zoom0);
        const name = `${stage}-${time}-${cam}`;
        const { shot, stats } = await shoot(page, `${dir}/${name}.png`, { ui: !process.env.NOUI, renderMs: +(process.env.RENDER_MS ?? 9000) });
        const m = { ...(await measure(page, shot)), ...stats, pitch: +info.pitch.toFixed(1) };
        metrics[name] = m;
        console.log(`  ${name}: ${JSON.stringify(m)}`);
      }
    }
    if (errors.length) {
      failed = true;
      console.error(`  ✗ page errors (${stage}):\n` + [...new Set(errors)].slice(0, 6).join('\n'));
    }
    await page.close();
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  writeFileSync(`${dir}/metrics.json`, JSON.stringify(metrics, null, 2));
  await browser.close();
  server.httpServer.close();
}
console.log(failed ? 'FAILED' : 'all good');
process.exit(failed ? 1 : 0);
