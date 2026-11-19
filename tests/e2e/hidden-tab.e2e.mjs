// E23.1 (#355): no idle mechanics. A hidden tab waits, exactly as a closed game: the world does not advance while
// hidden, nothing is paid back when the tab returns, and no "catching up" toast appears. Runs on the built game
// with the "Pause when the window is not in focus" setting OFF, so only the hidden page can be what pauses it.
// Screenshot: docs/review/hidden-tab-back.png. Run after `vite build`.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4243, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/AudioContext/.test(m.text()) && errors.push(m.text())); // headless has no audio device
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    // the focus setting off: a hidden page must pause by itself
    localStorage.setItem('solarbloom.settings', JSON.stringify({ pauseOnBlur: false }));
  });
  await page.goto('http://localhost:4243/?slot=1&new', { timeout: 180_000 });
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 180_000 });
  // the game runs while showing
  const a = await page.evaluate(() => window.solarbloom.sim.time);
  await page.waitForFunction((a) => window.solarbloom.sim.time > a + 1, a, { timeout: 120_000 });
  check(true, 'the game runs while the tab shows');

  const setHidden = (h) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, h);
  await setHidden(true);
  const t0 = await page.evaluate(() => window.solarbloom.sim.time);
  await page.waitForTimeout(10_000);
  const t1 = await page.evaluate(() => window.solarbloom.sim.time);
  check(t1 === t0, `ten seconds hidden advance the game not at all (${(t1 - t0).toFixed(2)} s)`);
  const wallBack = Date.now();
  await setHidden(false);
  await page.waitForFunction((t) => window.solarbloom.sim.time > t, t1, { timeout: 120_000 });
  await page.waitForTimeout(1000);
  const t2 = await page.evaluate(() => window.solarbloom.sim.time);
  const wall = (Date.now() - wallBack) / 1000;
  check(t2 - t1 <= wall + 0.5, `back: it carries on from where it was, no faster than real time (${(t2 - t1).toFixed(2)} s in ${wall.toFixed(2)} s), nothing paid back`);
  const toasts = await page.evaluate(() => document.querySelector('#toasts')?.textContent ?? '');
  check(!/catching up|while you were away/i.test(toasts), `no "catching up" toast ("${toasts}")`);
  await page.screenshot({ path: `${dir}/hidden-tab-back.png`, timeout: 180_000 });
  check(errors.length === 0, `no errors (${errors.join(' / ')})`);
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('hidden tab: all checks passed');
