// Ponds, played headless (E23.4.4). Run after `vite build`:   node tests/e2e/pond-shots.mjs [outDir]
// (default docs/review/ponds)
//   1 dead-pond / 2 dead-pond-close: the park's pond as a new game finds it: dried, cracked silt, no tile grid
//   3 draining: the pond restored and drained to 40%: the bed bared from the banks wears the same silt
//   4 cistern-asleep: Cistern Basin's pond before the Old Cistern wakes: a dry natural basin (banks, rocks)
//   5 cistern-awake: woken and full: a natural pond with rounded banks, rocks and reeds, no tile grid
// Also checks the advisor's "land is fading" line only where land actually fades.
// Prints ✓/✗ checks and exits non-zero if any fails. Requires Playwright.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/ponds';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4261, strictPort: false }, logLevel: 'silent' });
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
const settle = async (ms = 3000) => {
  await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 240000 });
  await page.waitForTimeout(ms);
};
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${out}/${name}.png`);
};
const run = (fn, arg) => page.evaluate(fn, arg);

try {
  const pond = await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.weather.forceForTest('sunny', Infinity);
    const tiles = [];
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const t = s.grid.get('g', x, z);
        if (t?.feature === 'water' && !t.blocked) tiles.push({ x, z, ground: t.ground });
      }
    g.bot.teleport('g', 3.5, 15.5);
    s.bot = { roofId: 'g', x: 3.5, z: 15.5 };
    return tiles;
  });
  check(pond.length > 3 && pond.every((t) => t.ground === 'polluted'), `the park's pond starts dead (${pond.length} tiles)`);
  await settle(9000);
  await shot('1-dead-pond');
  await run(() => window.solarbloom.bot.teleport('g', 2.5, 14.2));
  await settle(4000);
  await shot('2-dead-pond-close');

  // restore only the pond's water and drain it to 40%: its bared bed wears the same silt
  const id = await run((tiles) => {
    const g = window.solarbloom;
    const s = g.sim;
    for (const p of tiles) {
      const t = s.grid.get('g', p.x, p.z);
      Object.assign(t, { ground: 'restored', pollution: 0, bloom: 1 });
      s.grid.touch(t);
    }
    g.chunks.markAll();
    const b = s.water.bodyAt(s.grid.get('g', tiles[0].x, tiles[0].z));
    s.water.draw(b.id, b.capacity * 0.6);
    g.bot.teleport('g', 3.5, 15.5);
    return b.id;
  }, pond);
  await settle(6000);
  check((await run((id) => window.solarbloom.sim.water.levelOf(id), id)) < 0.5, 'the pond is draining');
  await shot('3-draining');
  const fade = await run((id) => {
    const s = window.solarbloom.sim;
    s.water.draw(id, 1e9);
    const bank = s.grid.get('g', 6, 11);
    const dead = s.water.isLow('park'); // the bank is still dead ground: nothing shows a fade
    Object.assign(bank, { ground: 'restored', pollution: 0, bloom: 3 });
    s.grid.touch(bank);
    return { fade: s.water.fadeAt(bank), dead, garden: s.water.isLow('park') };
  }, id);
  check(!fade.dead && fade.fade > 0 && fade.garden, `the advisor's fading line only where blooming land fades (${JSON.stringify(fade)})`);
  await run((id) => window.solarbloom.sim.water.fill(id, 1e9), id);

  // 4: Cistern Basin, open but its landmark asleep: a dry natural basin
  const cistern = await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const area = s.areas.map.areaOfCell(64, 41);
    s.areas.reveal(area);
    delete s.state.areas[area].sealed;
    s.areas.afterUnseal(area);
    g.chunks.markAll();
    g.bot.teleport('g', 74.5, 57.5);
    s.bot = { roofId: 'g', x: 74.5, z: 57.5 };
    const p = s.water.springBodies('cistern')[0];
    return { id: p.id, area, low: s.water.isLow(area) };
  });
  check(!cistern.low, 'no fading hint for the sleeping Cistern pond');
  await settle(9000);
  await shot('4-cistern-asleep');

  // 5: woken: the pond fills
  await run((area) => {
    window.solarbloom.sim.areas.clear(area, true);
    window.solarbloom.chunks.markAll();
  }, cistern.area);
  await page.waitForFunction((id) => window.solarbloom.sim.water.levelOf(id) >= 1, cistern.id, { timeout: 600000 });
  await settle(5000);
  await shot('5-cistern-awake');
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} catch (e) {
  console.log(`✗ crashed: ${e.message}`);
  failures.push('crash');
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures.length ? 1 : 0);
