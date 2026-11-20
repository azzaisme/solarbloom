// Phase 5 zoom-dependent camera: the restored park at each zoom step, from the overview to the closest view.
// Fails on page errors or console errors. Run after `vite build`. Args: [dir] [prefix]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review';
const prefix = process.argv[3] ?? 'camera';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4197, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
// Look 4: desktop and a portrait phone, at every zoom band (city overview, far, mid/default, near, closest).
const SIZES = process.env.CAM_SIZES === 'desktop' ? [['desktop', 1280, 800]] : [['desktop', 1280, 800], ['phone', 390, 844]];
try {
 for (const [size, vw, vh] of SIZES) {
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`page: ${e}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto('http://localhost:4197/?slot=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.waitForTimeout(1000);
  // Restore the whole park; stages mixed by position so every stage shows (1 sapling … 4 Radiant).
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    for (const t of s.areas.tiles('park')) {
      if (!s.restoration.isEligible(t)) continue;
      s.restoration.complete(t, 'pulse');
      t.bloom = 1 + ((t.x * 3 + t.z * 5) % 4);
      s.grid.touch(t);
    }
    g.chunks.markAll();
  });
  for (const zoom of [0.22, 0.42, 0.7, 1, 1.4, 1.9]) {
    await page.evaluate((z) => {
      const g = window.solarbloom;
      g.camera.glide(8, 0, 8, z);
      for (let i = 0; i < 200; i++) g.camera.update(0.05);
    }, zoom);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${dir}/${prefix}-${size}-z${String(zoom).replace('.', '')}.png` });
  }
  await page.close();
 }
} finally {
  await browser.close();
  await server.close();
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page or console errors');
process.exit(errors.length ? 1 : 0);
