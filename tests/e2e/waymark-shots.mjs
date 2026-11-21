// E24 (#609): review shots of the way marked to the current goal, at the Steam Deck's size (1280 × 800, UI at 150%,
// the deck graphics), by day and at night, into docs/review/waymark/ (or argv[2]).
//   npx vite build && GPU=1 node tests/e2e/waymark-shots.mjs [outDir]
// Each goal is set up through the game's own state (as a player would reach it), bloombot is put a little way off,
// and the shot shows the minimap's pin and the light standing on the goal. Close crops of the minimap show the pin
// on the rim (goal off the map), the barricades and the hatched shut regions. Fails on any page error, and when the
// pin or the light is missing where the goal card has a goal.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { QUIET_CSS, startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/waymark';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4209, strictPort: true }, logLevel: 'silent' });
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
  await startGame(page, 'http://localhost:4209', { slot: 3, query: 'gfx=deck', settings: { uiScale: 150 } });
  await page.addStyleTag({ content: QUIET_CSS });

  /** Sets the light clock to a fraction of the day (0.3 morning, 0.83 midnight), clear weather. */
  const clock = (f) =>
    page.evaluate((f) => {
      const s = window.solarbloom.sim;
      s.weather.forceForTest('sunny', 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
      s.lights.dark = s.power.sky().dark;
    }, f);
  /** Puts bloombot at a cell, facing a way (radians, 0 = south, π = north), presses Show me where (H), and lets the camera and the goal settle. */
  const stand = async (x, z, facing, wait = 6000) => {
    await page.evaluate(({ x, z, facing }) => {
      const b = window.solarbloom.bot;
      Object.assign(b.pose, { x, z, facing });
    }, { x, z, facing });
    await page.waitForTimeout(1500);
    // Show me where (#605): the camera turns to look along the way to the goal, as a player would ask it to
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(wait);
  };
  /** What the game marks now: the goal, the light's place, the pin. */
  const marked = () =>
    page.evaluate(() => {
      const g = window.solarbloom;
      const pin = document.querySelector('#minimap .mm-goal');
      return { goal: g.goal, light: g.waymark.place, pin: !pin.hidden, edge: pin.classList.contains('edge'), card: document.querySelector('#objTitle')?.textContent, label: document.querySelector('#minimap').getAttribute('aria-label') };
    });
  const shot = async (name, { pin = true, light = true, edge } = {}) => {
    const m = await marked();
    console.log(`  ${name}: goal ${m.goal?.kind} "${m.goal?.name}" · card "${m.card}" · pin ${m.pin}${m.edge ? ' (rim)' : ''} · light ${!!m.light}`);
    if (pin !== m.pin) fail(`${name}: pin ${m.pin ? 'shown' : 'missing'}`);
    if (edge !== undefined && edge !== m.edge) fail(`${name}: pin ${m.edge ? 'on the rim' : 'on the map'}`);
    if (light !== !!m.light) fail(`${name}: light ${m.light ? 'shown' : 'missing'}`);
    await page.screenshot({ path: `${dir}/${name}.png` });
    const box = await page.locator('#minimap').boundingBox();
    if (box) await page.screenshot({ path: `${dir}/${name}-map.png`, clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 36), width: box.width + 48, height: box.height + 60 } });
    console.log(`  ✓ ${dir}/${name}.png`);
  };

  // 1. The first goal: the fountain wants what bloombot carries. Bloombot on the beach path, the fountain ahead.
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    s.inventory.add('scrap', 20);
    s.inventory.add('seeds', 6);
  });
  await clock(0.3);
  await stand(8.5, 21.5, Math.PI);
  await shot('day-fountain');
  // the same, from the jetty: the fountain is off the map, so its pin waits on the rim
  await stand(8.5, 45.5, Math.PI);
  await shot('day-fountain-from-jetty', { edge: true });

  // 2. Past the first step, with Pry: the fountain wants copper and glass, found behind barricades. The goal is the
  // Mast Row barricade; every shut way in, and the regions behind them, show on the map.
  await page.evaluate(() => {
    const s = window.solarbloom.sim;
    const sv = s.state.salvage;
    s.inventory.take?.('scrap', 20);
    s.inventory.take?.('seeds', 6);
    sv.delivered.scrap = 20;
    sv.delivered.seeds = 6;
    sv.tier = 1;
    if (!sv.abilities.includes('pry')) sv.abilities.push('pry');
    sv.delivered.timber = 30;
  });
  await stand(8.5, 9.5, Math.PI);
  await shot('day-barricade');
  await clock(0.83);
  await page.waitForTimeout(3000);
  await shot('night-barricade');
  await stand(8.5, 21.5, Math.PI);
  await shot('night-barricade-far');
  // arrived: the light fades and the pin tucks under bloombot
  await stand(7.5, 0.5, Math.PI);
  await shot('night-arrived', { pin: false, light: false });

  if (errors.length) fail(`page errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);
