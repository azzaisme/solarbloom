// E21.24: the Old City's cliffs, ramps and stairs stay inside the Deck preset's draw-call limit (the Medium tier's
// 450, as in tests/perf/browser.perf.mjs), turning a full circle at three zooms over the park's steps, the beach
// and Mast Row's tram embankment. Run after a build: `node tests/e2e/oldcity-drawcalls.e2e.mjs`.
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}
const LIMIT = 450;
const server = await preview({ preview: { port: 4183, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4183/?slot=1&gfx=deck');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    for (const id of ['mastRow', 'elderGrove', 'oldMarket']) s.state.areas[id] = { fog: 'thinning', revealedAt: 0 };
    window.solarbloom.chunks.markAll();
  });
  for (const [x, z] of [[8, 14], [8, 30], [26, -24]])
    for (const zoom of [0.6, 1, 1.6]) {
      await page.evaluate(({ x, z, zoom }) => {
        const g = window.solarbloom;
        if (g.bot) g.bot.following = false;
        g.camera.glide(x, 0, z, zoom);
      }, { x, z, zoom });
      await page.waitForTimeout(2500); // let the chunks around build
      const draws = [];
      for (let k = 0; k < 12; k++) {
        await page.evaluate((k) => window.solarbloom.camera.orbit(30), k);
        await page.waitForTimeout(250);
        draws.push(await page.evaluate(() => window.solarbloom.app.stats.drawCalls.total));
      }
      draws.sort((a, b) => a - b);
      const median = draws[Math.floor(draws.length / 2)];
      const worst = draws[draws.length - 1];
      const ok = median <= LIMIT;
      if (!ok) failed = true;
      console.log(`  ${ok ? '✓' : '✗'} ${x},${z} zoom ${zoom}: draw calls median ${median}, worst ${worst} (limit ${LIMIT})`);
    }
  if (errors.length) {
    failed = true;
    console.error('  ✗ page errors:', errors.slice(0, 3));
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failed) process.exit(1);
