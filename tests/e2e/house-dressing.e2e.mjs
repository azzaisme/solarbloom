// #861 (epic #845): the house's own dressing at every level, with no player decorations: the house grows with the
// real delivery and Bloombot goes in through the front door with the real key. Each level is photographed from the
// door (as docs/review/782/inside-*.png were) by day and at night, and each extra room from inside it.
// Screenshots go to SHOTS_DIR (default docs/review/861). Run after `vite build`.
// Slow software-rendered browsers: E2E_TIMEOUT=900000 and CHROME=/path/to/chromium.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';
import { grow, shot as shotIn, wait, walkTo, where } from './lib/house.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.env.SHOTS_DIR ?? 'docs/review/861';
mkdirSync(dir, { recursive: true });
const PORT = Number(process.env.PORT ?? 4252);
const LONG = Number(process.env.E2E_TIMEOUT) || 240_000;
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const shot = (page, file) => shotIn(page, dir, file);
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const NAMES = ['shed', 'cottage', 'house', 'home'];

/** The light clock at a fraction of the day (0.4 morning, 0.83 midnight), and a moment for the light to follow. */
const daytime = async (page, f) => {
  await page.evaluate((f) => {
    const s = window.solarbloom.sim;
    (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
  }, f);
  await wait(2500);
};

try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.setDefaultTimeout(LONG);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startGame(page, `http://localhost:${PORT}`, { query: 'gfx=low', settings: { hints: false, noVistas: true } });
  await wait(2000);
  await page.evaluate(() => {
    const g = window.solarbloom;
    const sv = g.sim.state.salvage;
    sv.tier = Math.max(1, sv.tier);
    for (const m of ['scrap', 'timber', 'glass', 'clay', 'gears', 'copper', 'sunstone']) sv.store[m] = 999;
  });
  await wait(1500);

  for (const level of [1, 2, 3, 4]) {
    const name = NAMES[level - 1];
    await grow(page, level);
    await daytime(page, 0.4);
    const d = await page.evaluate(() => {
      const g = window.solarbloom;
      const h = g.sim.house;
      return {
        mine: g.cozy.insideCount(),
        beams: g.houseInside.beamsShown().length,
        rooms: h.rooms().map((r) => r.id),
      };
    });
    check(d.mine === 0, `the ${name}: no decorations of the player's inside (${d.mine})`);
    console.log(`  ${name}: ${JSON.stringify(d)}`);
    await shot(page, `inside-${level}-${name}.png`);
    await daytime(page, 0.83);
    await shot(page, `inside-${level}-${name}-night.png`);
    await daytime(page, 0.4);
    // each extra room from inside it, its near wall sunk
    for (const r of await page.evaluate(() => window.solarbloom.sim.house.rooms().slice(1).map((r) => ({ id: r.id, x: r.x, z: r.z, w: r.w })))) {
      const x = r.x + Math.floor(r.w / 2);
      const there = await walkTo(page, x, r.z + 1, x, r.z);
      const w = await where(page);
      check(there && w.room === r.id && w.blocking === 0, `the ${name}: in the ${r.id}, in view`);
      await shot(page, `inside-${level}-${name}-${r.id}.png`);
    }
  }
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  failures.push(String(e));
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
