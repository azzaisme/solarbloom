// E24 (#610): screenshots of rewritten UI text at 1280 × 800 and 150% interface size, to check each line reads
// well and fits its box. Run after `vite build`: GPU=1 node tests/e2e/human-text-shots.mjs
// Shots go to docs/review/e24-human-text/ (SHOTS_DIR to change).
// - lock-refusal: the refusal when a locked hotbar slot is chosen (BuildSystem.lockLabel), before the fountain wakes
// - build-menu: the build menu once the fountain is awake, a card locked until fountain step 2 selected
// - toast-*: rewritten toasts, one at a time, at their real size in the toast column
// - settings: the Game tab with "Stay with Bloombot when a new place opens"
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { openBuildMenu, closeBuildMenu, showBuildTab, startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/e24-human-text';
mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 4253);
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await startGame(page, `http://localhost:${port}`, { settings: { uiScale: 150 } });
  await page.waitForTimeout(1500);

  // 1. a locked slot's refusal, before the fountain wakes
  const lock = await page.evaluate(() => {
    const g = window.solarbloom;
    const why = g.sim.build.lockLabel('condenser');
    g.hud.showFail(why);
    return why;
  });
  check(lock === '🔒 Wake the fountain first', `the Water Condenser's lock reads "${lock}"`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/lock-refusal.png` });

  // 2. the build menu once the fountain is awake: the Pollinator Garden waits for fountain step 2
  await page.evaluate(() => {
    const sv = window.solarbloom.sim.state.salvage;
    sv.tier = Math.max(sv.tier, 1);
    if (!sv.abilities.includes('prune')) sv.abilities.push('prune');
  });
  await page.waitForTimeout(1200);
  await openBuildMenu(page);
  check(await showBuildTab(page, 'pollinator'), 'the build menu has a tab with the Pollinator Garden');
  await page.click('#buildMenu.open [data-tool="pollinator"]', { force: true }); // a locked card is aria-disabled, but a click still selects it
  await page.waitForTimeout(300);
  const why = await page.evaluate(() => document.querySelector('#buildMenu.open [data-tool="pollinator"] .bm-why')?.textContent ?? '');
  const warn = await page.evaluate(() => document.querySelector('#buildMenu.open .bm-warn')?.textContent ?? '');
  check(why === 'Reach fountain step 2', `its card says "${why}"`);
  check(warn === 'Reach fountain step 2 to build it.', `its details say "${warn}"`);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('#buildMenu.open .bm-why, #buildMenu.open .bm-warn')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.textContent));
  check(!clipped.length, `no lock note is cut off ${clipped.join(' | ')}`);
  await page.screenshot({ path: `${dir}/build-menu.png` });
  await closeBuildMenu(page);

  // 3. rewritten toasts, one at a time (the toast column shows one), at their real size
  const toasts = [
    ['welcome', 'Welcome back. Your garden is just as you left it 🌱', ''],
    ['drone-hub', '🛸 Drone Hub built. Your drone takes the small jobs now, and you can plant a Mother Tree 🌳', 'gold'],
    ['mega-pulse', '💥 Mega Pulse ready<small>Your next pulse blooms a huge patch of the city around that tile.</small>', 'gold'],
    ['cat', '🐱 You found a Lucky Cat!', 'cat'],
    ['chain', '🌸 14 blooms in a row!', 'gold'],
    ['reservoir', '⛲ The reservoir spills over!<small>Water runs into the dry planters, and they grow lush for a while.</small>', 'gold'],
    ['old-save', "This version couldn't read your old save. It's kept as a backup, and a new garden has started.<small>solarbloom.save.1.backup</small>", ''],
    ['controls', 'The controls changed in this update, so your own keys are back to the defaults.', ''],
  ];
  for (const [k, html, kind] of toasts) {
    await page.evaluate(([html, kind]) => {
      document.querySelectorAll('#toasts > *').forEach((t) => t.remove());
      window.solarbloom.hud.toast(html, kind, 20);
    }, [html, kind]);
    await page.waitForTimeout(700);
    const t = await page.evaluate(() => {
      const el = document.querySelector('#toasts > *');
      const r = el?.getBoundingClientRect();
      return el ? { text: el.innerText.replace(/\n/g, ' / '), on: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight } : undefined;
    });
    check(!!t?.on, `toast "${t?.text ?? k}" is on screen, whole`);
    await page.screenshot({ path: `${dir}/toast-${k}.png` });
  }
  await page.evaluate(() => document.querySelectorAll('#toasts > *').forEach((t) => t.remove()));

  // 4. Settings: the Game tab's camera rows
  let row = false;
  for (const tab of ['game', 'controls', 'display', 'sound', 'access']) {
    await page.evaluate((tab) => (window.solarbloom.settingsUi.isOpen ? window.solarbloom.settingsUi.show(tab) : window.solarbloom.settingsUi.open(tab)), tab);
    await page.waitForTimeout(400);
    row = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#settings *')].filter((e) => !e.children.length).find((e) => e.textContent.trim() === 'Stay with Bloombot when a new place opens');
      el?.scrollIntoView({ block: 'center' });
      return !!el;
    });
    if (row) break;
  }
  check(row, 'Settings shows "Stay with Bloombot when a new place opens"');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/settings.png` });
  await page.evaluate(() => window.solarbloom.settingsUi.close());
  check(!errors.length, `no page errors ${errors.join(' | ')}`);
} catch (e) {
  failures.push(String(e));
  console.log('✗', e);
  await page.screenshot({ path: `${dir}/x-error.png` }).catch(() => {});
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failures.length ? `${failures.length} failed` : 'all good');
process.exit(failures.length ? 1 : 0);
