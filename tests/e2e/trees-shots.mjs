// Phase 5 visual overhaul: the park's trees up close (mixed growth stages) and at gameplay zoom, plus a growth
// animation frame. Fails on page errors or console errors (e.g. a shader that doesn't compile). Run after `vite build`.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4197, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`page: ${e}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(`http://localhost:4197/?${process.env.LOOK_QUERY ?? 'gfx=high'}`); // High tier: Auto picks Low under SwiftShader
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.waitForTimeout(1000);
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
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
    s.advance?.(30); // Look 6: let the restore transitions finish, so the shots show settled trees
    g.chunks.markAll();
  });
  for (const [name, zoom] of [['trees-close', 3.2], ['trees-near', 1.6], ['trees-game', 0.95], ['trees-far', 0.45]]) {
    await page.evaluate((z) => {
      const g = window.solarbloom;
      g.camera.maxZoom = 4; // closer than players can go, to judge the models
      g.camera.glide(z > 3 ? 4.5 : 8, 0, z > 3 ? 11 : 8, z);
      for (let i = 0; i < 200; i++) g.camera.update(0.05);
    }, zoom);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
  // A growth animation mid-way: nurture a handful of tree tiles near the centre.
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.camera.glide(8, 0, 8, 1.6);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
    const s = g.sim;
    let n = 0;
    for (const t of s.areas.tiles('park')) if (t.ground === 'restored' && t.bloom < 4 && n < 30) { s.restoration.grow(t); n++; }
  });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${dir}/trees-growing.png` });
  const tris = await page.evaluate(() => window.solarbloom.chunks.foliageTris());
  console.log('foliage triangles in loaded chunks:', tris);
} finally {
  await browser.close();
  await server.close();
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page or console errors');
process.exit(errors.length ? 1 : 0);
