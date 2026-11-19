// E23.4.1 (#381): water levels, played headless. Run after `vite build`:
//   node tests/e2e/water-levels-shots.mjs [outDir]
// Scenes (screenshots in outDir, default docs/review/water-levels):
//   1 pads-full / pads-half / pads-low: the park's pond full of lily pads, then drained: the bed creeps in from the
//     banks and the pads ride down with the water (none left on the bare bed)
//   2 cistern-asleep: Cistern Basin's pond under a storm before the Old Cistern wakes: still dry
//   3 cistern-waking / cistern-awake: the Old Cistern wakes and its pond fills before your eyes
// Prints ✓/✗ checks and exits non-zero if any fails. Requires Playwright.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/water-levels';
mkdirSync(out, { recursive: true });
// other sessions run their own e2e servers at the same time: take the first free port from 4251 up
const server = await preview({ preview: { port: 4251, strictPort: false }, logLevel: 'silent' });
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
await page.goto(`${base}/?slot=1&ui=oldcity`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 240000 });
await page.evaluate(() => window.solarbloom.pause.clear('blur'));

async function settle(ms = 2500) {
  await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 240000 });
  await page.waitForTimeout(ms);
}
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${out}/${name}.png`);
};
const run = (fn, arg) => page.evaluate(fn, arg);

try {
  // the park restored, its pond in full bloom (lily pads and lotus); calm weather
  await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.areas.clear('park', true);
    s.weather.forceForTest('cloudy', Infinity);
    for (let z = -2; z < 18; z++)
      for (let x = -2; x < 18; x++) {
        const t = s.grid.get('g', x, z);
        if (!t || t.blocked) continue;
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = 3;
        delete t.tr;
        s.grid.touch(t);
      }
    g.chunks.markAll();
    g.bot.teleport('g', 4.5, 15.5);
    s.bot = { roofId: 'g', x: 4.5, z: 15.5 };
  });
  await settle(9000);

  // 1: the pads ride the water down
  const pond = await run(() => window.solarbloom.sim.water.bodyAt(window.solarbloom.sim.grid.get('g', 2, 11))?.id);
  check(!!pond, `the park's pond is a body (${pond})`);
  await shot('1-pads-full');
  const tally = () =>
    run((id) => {
      const w = window.solarbloom.sim.water;
      const tiles = [...w.body(id).tiles].map((t) => window.solarbloom.sim.grid.byTileId(t));
      return { level: w.levelOf(id), covered: tiles.filter((t) => w.covered(t)).length, all: tiles.length };
    }, pond);
  await run((id) => window.solarbloom.sim.water.draw(id, window.solarbloom.sim.water.body(id).capacity * 0.5), pond);
  await settle(4000);
  const half = await tally();
  check(half.covered > 0 && half.covered < half.all, `half drained: pads only on the water still there (${JSON.stringify(half)})`);
  await shot('1-pads-half');
  await run((id) => window.solarbloom.sim.water.draw(id, window.solarbloom.sim.water.body(id).capacity * 0.35), pond);
  await settle(4000);
  const low = await tally();
  // the park pond is small (2 middle tiles): lower still, only the middle keeps its pads
  check(low.covered > 0 && low.covered <= half.covered, `lower still: only the middle holds pads (${JSON.stringify(low)})`);
  await shot('1-pads-low');

  // 2: Cistern Basin, opened but its landmark asleep: a storm leaves its pond dry
  const cistern = await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const r = s.water.springBodies('cistern')[0];
    const area = s.areas.map.areaOfCell(64, 41);
    // revealed and its gate open (the player can walk in), the landmark still asleep
    s.areas.reveal(area);
    delete s.state.areas[area].sealed;
    s.areas.afterUnseal(area);
    s.weather.forceForTest('storm', Infinity);
    g.chunks.markAll();
    g.bot.teleport('g', 68.5, 55.5);
    s.bot = { roofId: 'g', x: 68.5, z: 55.5 };
    return { id: r?.id, area, fog: s.areas.fog(area), dormant: r ? s.water.dormant(r) : null };
  });
  check(!!cistern.id && cistern.dormant, `the Cistern pond waits for its landmark (${JSON.stringify(cistern)})`);
  await settle(8000);
  const asleep = await run((id) => window.solarbloom.sim.water.levelOf(id), cistern.id);
  check(asleep === 0, `a storm leaves it dry while the Old Cistern sleeps (level ${asleep})`);
  await shot('2-cistern-asleep');

  // 3: the Old Cistern wakes: the pond fills over the next seconds
  await run((area) => {
    const s = window.solarbloom.sim;
    s.weather.forceForTest('cloudy', Infinity);
    s.areas.clear(area, true);
    window.solarbloom.chunks.markAll();
  }, cistern.area);
  // the rush is 40 s of sim time (headless, the sim runs slower than the clock): wait on the level itself
  const t0 = await run(() => window.solarbloom.sim.time);
  await page.waitForFunction((id) => window.solarbloom.sim.water.levelOf(id) >= 0.45, cistern.id, { timeout: 600000 });
  const mid = await run((id) => ({ level: window.solarbloom.sim.water.levelOf(id), simSeconds: window.solarbloom.sim.time }), cistern.id);
  check(mid.level < 0.9, `waking it fills the pond as you watch (level ${mid.level.toFixed(2)} after ${(mid.simSeconds - t0).toFixed(0)} sim s)`);
  await shot('3-cistern-waking');
  await page.waitForFunction((id) => window.solarbloom.sim.water.levelOf(id) >= 1, cistern.id, { timeout: 600000 });
  const full = await run(() => window.solarbloom.sim.time);
  check(full - t0 < 60, `full within a minute of sim time (${(full - t0).toFixed(0)} s)`);
  await settle(3000);
  await shot('3-cistern-awake');

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} catch (e) {
  console.log(`✗ crashed: ${e.message}`);
  failures.push('crash');
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures.length ? 1 : 0);
