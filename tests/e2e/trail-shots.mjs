// #632: review shots of Show me where's trail, at the Steam Deck's size (1280 × 800, UI at 150%, the deck graphics),
// by day, at night and in fog, into docs/review/trail/ (or argv[2]).
//   npx vite build && GPU=1 node tests/e2e/trail-shots.mjs [outDir]
// Each shot puts bloombot somewhere, presses Show me where (H) and waits for the trail to run out. Fails on any page
// error, when the trail is missing, when the camera turned away from behind bloombot, or when a way that can't be
// finished doesn't say why.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/trail';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4212, strictPort: true }, logLevel: 'silent' });
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
  await startGame(page, 'http://localhost:4212', { slot: 3, query: 'gfx=deck', settings: { uiScale: 150 } });

  /** Sets the light clock to a fraction of the day (0.3 morning, 0.83 midnight) and the weather. */
  const sky = (f, weather = 'sunny') =>
    page.evaluate(({ f, weather }) => {
      const s = window.solarbloom.sim;
      s.weather.forceForTest(weather, 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
      s.lights.dark = s.power.sky().dark;
    }, { f, weather });
  /** Puts bloombot at a cell facing a way (radians, 0 = south, π = north), lets the camera settle behind it, then asks Show me where: H, or a spot of the shot's own. */
  const ask = async (x, z, facing, spot) => {
    await page.evaluate(({ x, z, facing }) => {
      const b = window.solarbloom.bot;
      Object.assign(b.pose, { x, z, facing });
      // the follow camera, straight behind bloombot (as after walking that way)
      window.solarbloom.camera.turnTo((facing * 180) / Math.PI + 180, true);
      window.solarbloom.trail.clear();
    }, { x, z, facing });
    await page.waitForTimeout(2500);
    const yaw = await page.evaluate(() => window.solarbloom.camera.yaw);
    if (spot) await page.evaluate((spot) => window.solarbloom.showWhere(spot), spot);
    else await page.keyboard.press('KeyH');
    await page.waitForTimeout(2200);
    const after = await page.evaluate(() => window.solarbloom.camera.yaw);
    if (Math.abs(after - yaw) > 10) fail(`the camera turned (${yaw.toFixed(1)}° → ${after.toFixed(1)}°): it should stay with bloombot`);
  };
  const shot = async (name, { reached = true } = {}) => {
    const t = await page.evaluate(() => {
      const tr = window.solarbloom.trail;
      const w = tr.way;
      const b = window.solarbloom.bot.pose;
      return { bot: `${b.x.toFixed(1)},${b.z.toFixed(1)}`, yaw: window.solarbloom.camera.yaw.toFixed(0), on: tr.showing, dots: tr.count, reached: w?.reached, why: w?.why, toast: [...document.querySelectorAll('#toasts .toast')].map((e) => e.textContent).join(' | ') };
    });
    console.log(`  ${name}: bot ${t.bot} yaw ${t.yaw} · trail ${t.on ? `${t.dots} dots` : 'missing'} · ${t.reached ? 'gets there' : `stops: ${t.why}`}${t.toast ? ` · toast "${t.toast}"` : ''}`);
    if (!t.on || !t.dots) fail(`${name}: no trail`);
    if (t.reached !== reached) fail(`${name}: ${t.reached ? 'got there' : 'stopped short'}`);
    if (!t.reached && !t.why) fail(`${name}: stops without saying why`);
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log(`  ✓ ${dir}/${name}.png`);
  };

  // 1. A fresh game, on the beach path below the park: the trail runs down the beach to the first salvage pile by the jetty.
  await sky(0.3);
  await ask(8.5, 24.5, 0);
  await shot('day-first-pile');

  // 2. Carrying what the fountain wants, on the beach path below the park's steps: up the steps to the fountain.
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.inventory.add('scrap', 20);
    s.inventory.add('seeds', 6);
  });
  // the load wheel's first-time introduction shows when bloombot first carries seeds: let it pass
  await page.waitForTimeout(9000);
  await ask(8.5, 24.5, Math.PI);
  await shot('day-to-fountain');
  await sky(0.83);
  await page.waitForTimeout(2500);
  await ask(8.5, 24.5, Math.PI);
  await shot('night-to-fountain');
  await sky(0.45, 'fog');
  await page.waitForTimeout(2500);
  await ask(8.5, 24.5, Math.PI);
  await shot('fog-to-fountain');

  // 3. Somewhere behind the Mast Row rubble before Pry: the trail goes as far as the rubble and says why it stops.
  await sky(0.3);
  await page.waitForTimeout(2500);
  await ask(8.5, 9.5, Math.PI, { roofId: 'g', x: 8, z: -6.5, cell: { x: 7, z: -7 }, kind: 'keeper', name: 'a Keeper' });
  await shot('day-behind-rubble', { reached: false });

  if (errors.length) fail(`page errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);
