// Diagnostic: does E sit bloombot on the mended park bench? Loads a new game, mends the bench at (10, 6), stands
// bloombot in front of it, presses E, and prints the state before and after (prompt, pause reasons, cinematic, the
// tile in front, sitting). `GPU=1 DIST=<dir> node tests/e2e/sit-probe.mjs` after `vite build`. About a minute.
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await preview({ root: process.cwd(), build: { outDir: process.env.DIST ?? 'dist' }, preview: { port: 4651 + Math.floor(Math.random() * 300), strictPort: false }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  const t0 = Date.now();
  await page.goto(`${server.resolvedUrls.local[0]}?slot=1&new=1&gfx=${process.env.GFX ?? 'high'}`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(0), 's');
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  const state = () =>
    page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      return {
        prompt: document.getElementById('prompt')?.innerText ?? '(none)',
        paused: g.paused,
        reasons: g.pause.reasons ? [...g.pause.reasons] : g.pause,
        cinematic: g.cinematic,
        modal: g.hud.modalOpen,
        building: g.building?.(),
        tray: g.hud.trayOpen,
        pose: g.bot.pose,
        front: g.bot.front?.(),
        sitting: s.rest.sitting?.kind ?? null,
        seat: g.bot.seat ?? null,
      };
    });
  const mend = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.inventory.add('scrap', 3);
    const b = s.rest.benchAt(10, 6);
    return b ? (s.rest.mend(b) ?? 'mended') : 'no bench at 10,6';
  });
  console.log('mend:', mend);
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.bot.following = true;
    g.bot.teleport('g', 10, 7);
    Object.assign(g.bot.pose, { x: 10.5, z: 7.6, facing: Math.PI });
  });
  await page.waitForTimeout(2000);
  console.log('before E:', JSON.stringify(await state()));
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  console.log('0.3 s after E:', JSON.stringify(await state()));
  await page.waitForTimeout(5000);
  console.log('5 s after E:', JSON.stringify(await state()));
} finally {
  await browser.close();
  await server.close();
}
