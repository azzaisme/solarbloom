// #763: Tide's rock pool moved off the foot of the park's beach steps. Run after `vite build`:
//   node tests/e2e/pond-763-shots.mjs [outDir]   (default docs/review/pond-763)   TAG=before|after   DIST=<build dir>
// Saltwind round Tide is restored (so the pool is full water) and the follow camera looks north at the steps.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { gameUrl } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const TAG = process.env.TAG ?? 'after';
const dir = process.argv[2] ?? 'docs/review/pond-763';
mkdirSync(dir, { recursive: true });
const port = +(process.env.PORT ?? 4252);
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(300_000);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('sb.e2e.seeded')) return;
    sessionStorage.setItem('sb.e2e.seeded', '1');
    try { localStorage.clear(); } catch {}
  });
  await page.goto(gameUrl(`http://localhost:${port}`, { slot: 1, query: 'gfx=medium' }), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.solarbloom?.app, null, { timeout: 240_000 });
  // software GL is slow: pause rendering while the world streams (see p7-shots.mjs)
  for (let i = 0; ; i++) {
    const gone = await page.evaluate(() => {
      const g = window.solarbloom;
      g.app.autoRender = false;
      return !!(g.bot && document.querySelector('#loading')?.classList.contains('gone'));
    });
    if (gone) break;
    if (i > 120) throw new Error('the game never finished loading');
    await page.waitForTimeout(5000);
  }
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    g.pause?.clear?.('blur');
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.3 - s.clock.dayFraction()) * 2880;
    for (const [x, z] of [[10, 19], [8, 10]]) {
      const area = s.areas.areaOf({ roofId: 'g', x, z });
      if (area && s.state.areas[area]) s.state.areas[area].sealed = false;
      if (area) s.areas.clear(area, true);
    }
    for (let z = 8; z <= 28; z++)
      for (let x = 0; x <= 16; x++) {
        const t = s.grid.peek('g', x, z);
        if (!t || t.blocked || t.occupantId || t.ramp) continue;
        Object.assign(t, { ground: 'restored', bloom: 3, pollution: 0 });
        s.grid.touch(t);
        g.chunks.markTile(t);
      }
    g.bot.teleport('g', 8, 24.5);
    g.bot.pose.facing = Math.PI; // north (−z), toward the steps
    g.bot.following = true;
    const c = g.camera;
    let best = 0;
    let bestDot = -2;
    for (let y = 0; y < 360; y += 5) {
      c.turnTo(y, true);
      c.update(0.016);
      const fw = c.entity.forward;
      const dot = -fw.z / (Math.hypot(fw.x, fw.z) || 1);
      if (dot > bestDot) [bestDot, best] = [dot, y];
    }
    c.turnTo(best, true);
    for (let i = 0; i < 300; i++) c.update(0.05);
  });
  await page.waitForFunction(() => window.solarbloom.chunks.pending === 0, null, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(8000);
  await page.evaluate(() => window.solarbloom.look.snapMood());
  await page.addStyleTag({ content: '#hud, #res, #obj, #minimap, #prompt, #dock, .toast, #toasts { visibility: hidden !important; }' });
  await page.evaluate(() => (window.solarbloom.app.autoRender = true));
  await page.waitForTimeout(10000);
  await page.screenshot({ path: `${dir}/${TAG}-steps.png` });
  console.log(`  ${dir}/${TAG}-steps.png`);
  if (errors.length) {
    failed = true;
    console.error('  ✗ page errors:\n' + [...new Set(errors)].slice(0, 6).join('\n'));
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
