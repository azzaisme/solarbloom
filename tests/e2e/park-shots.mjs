// The park from dilapidated to lush (City 05.2): one screenshot per stage (0, 25, 50, 75%, fountain awake) into docs/review/.
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review';
const server = await preview({ preview: { port: 4193, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
await page.goto('http://localhost:4193/?slot=1');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => !!window.solarbloom);
if (await page.locator('#introGo').isVisible()) await page.click('#introGo');
await page.addStyleTag({ content: '#hud .toast, #toasts, .toast { display: none !important; }' });
for (const stage of [0, 1, 2, 3, 4]) {
  await page.evaluate((stage) => {
    const g = window.solarbloom, s = g.sim;
    const goal = 130;
    const want = stage === 4 ? 999 : Math.ceil(goal * stage / 4) + (stage ? 1 : 0);
    let n = s.areas.counts('park').restored;
    const tiles = s.areas.tiles('park').filter((t) => !t.blocked && !t.occupantId && t.ground !== 'restored');
    // Restore outward from the starter corner so the look spreads like play would.
    tiles.sort((a, b) => Math.hypot(a.x - 5, a.z - 5) - Math.hypot(b.x - 5, b.z - 5));
    for (const t of tiles) { if (n >= want) break; t.ground = 'restored'; t.bloom = stage === 4 ? 3 : 1 + (t.variant % 2); t.pollution = 0; s.grid.touch(t); n++; }
    if (stage === 4) { s.state.progression.coreActivated = true; s.areas.clear('park', true); }
    g.camera.glide(8, 0, 8, 0.95);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
  }, stage);
  await page.waitForTimeout(2200);
  const ps = await page.evaluate(() => window.solarbloom.sim.progression.parkStage());
  console.log('stage', stage, 'parkStage', ps);
  await page.screenshot({ path: `${out}/park-stage-${stage}.png` });
}
await browser.close(); server.httpServer.close();
