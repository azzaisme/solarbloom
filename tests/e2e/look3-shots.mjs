// Look 3 (#105): surfaces, foliage and detail. Near-zoom shots of a restored park (to hold beside
// docs/reference/target-look.png), the park at each stage, paving and grass close up, area edges, a building street,
// and the frame-time / triangle budget readout. Deterministic: `?still` freezes the wind. Fails on page or console
// errors (e.g. a shader that doesn't compile). Run after `vite build` (npm run shots:look3).
//
//   node tests/e2e/look3-shots.mjs [outDir]          (default docs/review/look3)
//   DIST=some/dist PORT=4310 node tests/e2e/look3-shots.mjs out   (serve another build)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/look3';
const port = Number(process.env.PORT ?? 4198);
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port, strictPort: true }, build: process.env.DIST ? { outDir: process.env.DIST } : undefined, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const only = process.env.ONLY ? process.env.ONLY.split(',') : undefined;
const want = (n) => !only || only.some((o) => n.startsWith(o));
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`page: ${e}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(`http://localhost:${port}/?still`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.waitForTimeout(800);
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
  await page.addStyleTag({ content: '#hud .toast, #toasts, .toast { display: none !important; }' });
  const shot = async (name, x, z, zoom, settle = 2200) => {
    if (!want(name)) return;
    await page.evaluate(([x, z, zoom]) => {
      const g = window.solarbloom;
      g.camera.maxZoom = 4;
      g.camera.glide(x, 0, z, zoom);
      for (let i = 0; i < 200; i++) g.camera.update(0.05);
    }, [x, z, zoom]);
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${dir}/${name}.png` });
  };
  // 1. Dead park, close up (cracked paving, weeds, broken railings).
  await shot('look3-dead-near', 6, 9, 2.2);
  // 2. The park restored part-way: stages by distance from the corner, so buds, first flowers and drifts all show.
  await page.evaluate(() => {
    const g = window.solarbloom, s = g.sim;
    for (const t of s.areas.tiles('park')) {
      if (!s.restoration.isEligible(t)) continue;
      const d = Math.hypot(t.x - 4, t.z - 4);
      if (d > 9) continue;
      s.restoration.complete(t, 'pulse');
      t.bloom = d < 3 ? 3 : d < 5.5 ? 2 : 1;
      s.grid.touch(t);
    }
    g.chunks.markAll();
  });
  await shot('look3-stages-near', 5, 8, 1.8);
  // 3. The whole park restored and lush (mostly Thriving, some Radiant), with the park's props repaired.
  await page.evaluate(() => {
    const g = window.solarbloom, s = g.sim;
    for (const t of s.areas.tiles('park')) {
      if (!s.restoration.isEligible(t)) continue;
      s.restoration.complete(t, 'pulse');
      t.bloom = (t.x * 7 + t.z * 3) % 9 === 0 ? 4 : 3;
      s.grid.touch(t);
    }
    s.state.progression.coreActivated = true;
    s.areas.clear('park', true);
    g.chunks.markAll();
  });
  await shot('look3-park-near', 6, 10, 2.4);
  await shot('look3-park-close', 4.5, 11, 3.2);
  await shot('look3-park-edge', 14, 12, 2.2);
  await shot('look3-park-game', 8, 8, 0.95);
  await shot('look3-park-far', 8, 8, 0.45);
  // 4. A cleared city street with buildings next to the park.
  await page.evaluate(() => {
    const g = window.solarbloom, s = g.sim;
    const id = s.areas.map.areaOfChunk(1, 0);
    for (const t of s.areas.tiles(id)) {
      if (!s.restoration.isEligible(t)) continue;
      s.restoration.complete(t, 'pulse');
      t.bloom = 3;
      s.grid.touch(t);
    }
    s.areas.clear(id, true);
    g.chunks.markAll();
  });
  await shot('look3-street-near', 22, 8, 1.6);
  if (want('look3-budget')) {
    const stats = await page.evaluate(async () => {
      const g = window.solarbloom;
      g.camera.glide(8, 0, 8, 0.95);
      for (let i = 0; i < 200; i++) g.camera.update(0.05);
      await new Promise((r) => setTimeout(r, 2500));
      return g.chunks.detailStats();
    });
    console.log('detail budget at gameplay zoom:', JSON.stringify(stats));
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (errors.length) {
  console.error(errors.slice(0, 10).join('\n'));
  process.exit(1);
}
console.log('no page or console errors');
