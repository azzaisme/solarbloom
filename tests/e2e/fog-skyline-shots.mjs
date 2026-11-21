// #635: review shots of the skyline in fog, at the Steam Deck's size (1280 × 800, UI at 150%, the deck graphics), into
// docs/review/fog-skyline/ (or argv[2]).
//   npx vite build && GPU=1 node tests/e2e/fog-skyline-shots.mjs [outDir]
// Bloombot stands on the beach path below the park, facing the steps up to the fountain, carrying what the fountain
// wants, and presses Show me where: the park wall, the steps, the trail and the waymark's beam should all show, with
// the skyline faded into the fog behind them. Shots by day and at night, in fog and (for comparison) clear.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/fog-skyline';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4214, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
const fail = (why) => {
  failed = true;
  console.error(`  ✗ ${why}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await startGame(page, 'http://localhost:4214', { slot: 3, query: 'gfx=deck', settings: { uiScale: 150 } });

  /** Sets the light clock to a fraction of the day (0.45 late morning, 0.83 midnight) and the weather, and lets it settle. */
  const sky = async (f, weather) => {
    await page.evaluate(({ f, weather }) => {
      const s = window.solarbloom.sim;
      s.weather.forceForTest(weather, 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
      s.lights.dark = s.power.sky().dark;
    }, { f, weather });
    // fog eases in over a few seconds
    await page.waitForTimeout(7000);
  };
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.inventory.add('scrap', 20);
    s.inventory.add('seeds', 6);
  });
  // the load wheel's first-time introduction shows when bloombot first carries seeds: let it pass
  await page.waitForTimeout(9000);

  const shot = async (name) => {
    await page.evaluate(() => {
      const g = window.solarbloom;
      Object.assign(g.bot.pose, { x: 8.5, z: 24.5, facing: Math.PI });
      g.camera.turnTo(360, true);
      g.trail.clear();
    });
    await page.waitForTimeout(2500);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(2200);
    const t = await page.evaluate(() => {
      const g = window.solarbloom;
      return { far: g.camera.cam.farClip, veil: g.skyline.veil ?? 0, dots: g.trail.count, on: g.trail.showing };
    });
    console.log(`  ${name}: far clip ${t.far.toFixed(1)} · skyline veil ${t.veil.toFixed(2)} · trail ${t.on ? `${t.dots} dots` : 'missing'}`);
    if (!t.on || !t.dots) fail(`${name}: no trail`);
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log(`  ✓ ${dir}/${name}.png`);
  };

  await sky(0.45, 'sunny');
  await shot('day-clear');
  await sky(0.45, 'fog');
  await shot('day-fog');
  await sky(0.83, 'fog');
  await shot('night-fog');
  await sky(0.83, 'sunny');
  await shot('night-clear');

  if (errors.length) fail(`page errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);
