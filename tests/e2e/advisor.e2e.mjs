// E23.1.5 (#369): no upgrade drawer and no prices in the walking view, and the advisor speaking through the one
// objective line. A new game in the built build: the hotbar has no Upgrades button, U opens nothing, no buy
// button exists anywhere; the objective names what the fountain wants; when bloombot runs low (a stand-in for
// E23.2's charge, same shape) the line says so, then goes back. Screenshots go to docs/review/advisor-*.png.
// Run after `vite build`.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4242, strictPort: true }, logLevel: 'silent' });
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
  });
  await page.goto('http://localhost:4242/?slot=1&new', { timeout: 180_000 });
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 180_000 });
  await page.waitForTimeout(1500);
  const title = () => page.evaluate(() => document.querySelector('#objTitle')?.textContent ?? '');

  check(await page.evaluate(() => !document.querySelector('#upgBtn') && !document.querySelector('#upgrades') && !document.querySelector('[data-buy]')), 'no Upgrades button, drawer or buy button anywhere');
  await page.keyboard.press('KeyU');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => !document.querySelector('.drawer.open')), 'U opens nothing');
  const start = await title();
  check(/fountain/i.test(start) && /Scrap|Seeds/.test(start), `the objective names what the fountain wants ("${start}")`);
  await page.screenshot({ path: `${dir}/advisor-start.png`, timeout: 180_000 });

  // bloombot runs low (E23.2's ChargeSystem shape: low / share)
  // (the card asks the advisor twice a second; a software-rendered frame can take seconds, so wait for the line)
  const lineIs = (re) => page.waitForFunction((src) => new RegExp(src, 'i').test(document.querySelector('#objTitle')?.textContent ?? ''), re.source, { timeout: 60_000 }).catch(() => {});
  await page.evaluate(() => (window.solarbloom.sim.charge = { low: true, share: 0.1 }));
  await lineIs(/running low/);
  const low = await title();
  check(/running low/i.test(low), `running low shows on the objective line ("${low}")`);
  await page.screenshot({ path: `${dir}/advisor-low.png`, timeout: 180_000 });
  await page.evaluate(() => (window.solarbloom.sim.charge = { low: false, share: 1 }));
  await lineIs(/fountain/);
  const back = await title();
  check(back === start, `and goes back to the fountain once charged ("${back}")`);

  // the advisor's own hint is about the loop (salvage for the fountain, here)
  const hint = await page.evaluate(() => window.solarbloom.sim.advisor.suggest());
  check(['keeper', 'restore'].includes(hint.topic) && !/upgrade|buy|price|afford|saving/i.test(hint.text), `the advisor's step is part of the loop ("${hint.text}")`);
  check(errors.length === 0, `no errors (${errors.join(' / ')})`);
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('advisor: all checks passed');
