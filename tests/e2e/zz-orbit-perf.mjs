import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const query = process.env.Q ?? 'gfx=deck';
const server = await preview({ preview: { port: 4224, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
await page.goto(`http://localhost:4224/?${query}`);
await page.waitForFunction(() => !!window.solarbloom && !!window.solarbloom.bot, null, { timeout: 90000 });
if (await page.locator('#introGo').isVisible().catch(() => false)) await page.click('#introGo');
await page.evaluate(() => {
  const g = window.solarbloom, s = g.sim;
  for (const t of s.areas.tiles('park')) {
    if (!s.restoration.isEligible(t)) continue;
    t.ground = 'restored'; t.pollution = 0; t.tr = undefined; t.bloom = 1 + ((t.x * 3 + t.z * 5) % 4); s.grid.touch(t);
  }
  s.state.progression.coreActivated = true; s.areas.clear('park', true); g.chunks.markAll();
});
await page.waitForFunction(() => { const c = window.solarbloom.camera; return Math.abs(c.zoom - c.zoomTarget) < 1e-3; }, null, { timeout: 60000 });
console.log('query', query, 'deck', await page.evaluate(() => window.solarbloom.deck));
for (const [yaw, off] of [[45, 0], [45, -9], [45, 25], [45, 58], [225, -9], [135, -9]]) {
  await page.evaluate(([yaw, off]) => { const c = window.solarbloom.camera; c.yaw = c.yawGoal = yaw; c.pitchOffset = off; }, [yaw, off]);
  await page.waitForTimeout(7000);
  const m = await page.evaluate(() => {
    const g = window.solarbloom, st = g.app.stats;
    const ch = g.chunks;
    return { pitch: +g.camera.pitch.toFixed(0), draw: st.drawCalls.total, tris: st.frame.triangles ?? st.frame.primitives ?? null, chunks: ch.views?.size ?? null, far: +g.camera.cam.farClip.toFixed(0) };
  });
  console.log(`yaw ${yaw} offset ${off}`, JSON.stringify(m));
}
await browser.close(); server.httpServer.close();
