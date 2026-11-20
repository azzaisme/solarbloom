// The far skyline switched off (owner, 20 Nov 2026), seen from the follow camera. Run after `vite build`:
//   node tests/e2e/skyline-off-shots.mjs [outDir]   (default docs/review/skyline-off)
//   1 day / 2 night: a new game from where it starts, looking out past the city to the horizon
// Prints ✓/✗ checks and exits non-zero if any fails. Requires Playwright.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/skyline-off';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4281, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.setDefaultTimeout(240000);
try {
  await page.goto(`${base}/?slot=1&ui=oldcity&gfx=high`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 240000 });
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  await page.addStyleTag({ content: '.toast, #toasts { display: none !important; }' });
  check(await page.evaluate(() => !window.solarbloom.skyline), 'no Skyline is built');
  for (const [name, f] of [['1-day', 0.3], ['2-night', 0.83]]) {
    await page.evaluate((f) => {
      const g = window.solarbloom;
      const s = g.sim;
      s.weather.forceForTest('sunny', 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
      g.bot.following = true;
      g.camera.turnTo(200);
      for (let i = 0; i < 300; i++) g.camera.update(0.05);
    }, f);
    await page.waitForTimeout(8000);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`  ${out}/${name}.png`);
  }
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} catch (e) {
  console.log(`✗ crashed: ${e.message}`);
  failures.push('crash');
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures.length ? 1 : 0);
