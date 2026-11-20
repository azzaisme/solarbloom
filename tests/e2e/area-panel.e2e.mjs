// The area panel opens from an area's label in the overview and from its landmark (City 14.2).
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await preview({ preview: { port: 4190, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let ok = true;
const fail = (m) => { ok = false; console.error('  ✗', m); };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:4190/?slot=1&cursor=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  const id = await page.evaluate(() => {
    const g = window.solarbloom;
    g.sim.state.progression.coreActivated = true;
    g.sim.areas.clear('park', true);
    g.camera.glide(8, 0, 8, 0.3);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
    return g.sim.areas.nextGoal();
  });
  // 1. From the overview label.
  await page.waitForTimeout(1500);
  await page.locator(`[data-area="${id}"]`).first().click({ timeout: 10000 });
  await page.waitForTimeout(500);
  const fromLabel = await page.evaluate(() => document.querySelector('#inspect.open [data-area-panel]')?.getAttribute('data-area-panel'));
  if (fromLabel !== id) fail(`label click opened ${fromLabel}, wanted ${id}`);
  else console.log('  ✓ opens from the overview label');
  // 2. From the landmark (closing first).
  await page.evaluate(() => document.querySelector('#inspect [data-close]')?.click());
  const xy = await page.evaluate((id) => {
    const g = window.solarbloom;
    const [x, z] = g.sim.areas.info(id).landmark;
    g.camera.glide(x + 1, 0, z + 1, 1.2);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
    const V = g.camera.target.constructor;
    return g.camera.toScreen(new V(x + 1, 0.3, z + 1));
  }, id);
  await page.waitForTimeout(800);
  await page.mouse.click(xy.x, xy.y);
  await page.waitForTimeout(500);
  const fromLandmark = await page.evaluate(() => document.querySelector('#inspect.open [data-area-panel]')?.getAttribute('data-area-panel'));
  if (fromLandmark !== id) fail(`landmark click opened ${fromLandmark}, wanted ${id}`);
  else console.log('  ✓ opens from the landmark');
  await page.waitForTimeout(1500);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(ok ? 0 : 1);
