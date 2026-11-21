// #631: Bloombot's colour, at the Steam Deck's size (1280 × 800, UI at 150%, the deck graphics), into
// docs/review/bot-green/<argv[2] ?? 'after'>/.
//   npx vite build && GPU=1 node tests/e2e/bot-green-shots.mjs [before|after]
// Mid-pulse on dead ground and on restored grass, by day, at night and in fog; Bloombot close up (visor eyes and trim
// glow); and the build hologram it projects. Fails on any page error or when a pulse doesn't fire.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
import { QUIET_CSS, startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = `docs/review/bot-green/${process.argv[2] ?? 'after'}`;
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4213, strictPort: true }, logLevel: 'silent' });
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
  await startGame(page, 'http://localhost:4213', { slot: 3, query: 'gfx=deck', settings: { uiScale: 150, hints: false } });
  await page.addStyleTag({ content: QUIET_CSS });

  /** The light clock (0.3 morning, 0.83 midnight) and the weather. */
  const sky = async (f, weather = 'sunny') => {
    await page.evaluate(({ f, weather }) => {
      const s = window.solarbloom.sim;
      s.weather.forceForTest(weather, 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
      s.lights.dark = s.power.sky().dark;
    }, { f, weather });
    await page.waitForTimeout(2500);
  };
  /** The park's dead tiles with dead ground two cells south (where bloombot stands, facing north). */
  const deadTile = () =>
    page.evaluate(() => {
      const s = window.solarbloom.sim;
      const ok = (x, z) => {
        const t = s.grid.get('g', x, z);
        return t && !t.blocked && !t.occupantId && t.feature !== 'water' && t.feature !== 'building';
      };
      const c = s.areas.tiles('park').find((t) => t.ground === 'polluted' && ok(t.x, t.z) && ok(t.x, t.z + 1) && ok(t.x, t.z + 2) && t.z > 3 && t.z < 13 && Math.abs(t.x - 8) > 2);
      return c && { x: c.x, z: c.z };
    });
  /** Stands bloombot two cells south of a tile, facing it, the camera behind; pulses it (Space); shoots mid-pulse. */
  const pulse = async (name, c) => {
    await page.evaluate((c) => {
      const g = window.solarbloom;
      g.bot.teleport('g', c.x + 0.5, c.z + 1.6);
      Object.assign(g.bot.pose, { x: c.x + 0.5, z: c.z + 1.6, facing: Math.PI });
      g.camera.turnTo(360, true);
      g.closeAll?.();
    }, c);
    await page.waitForTimeout(1500);
    const before = await page.evaluate((c) => window.solarbloom.sim.grid.get('g', c.x, c.z).ground, c);
    await page.keyboard.press('Space');
    await page.waitForTimeout(420);
    await page.screenshot({ path: `${dir}/${name}-waves.png` });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${dir}/${name}-ring.png` });
    const after = await page.evaluate((c) => window.solarbloom.sim.grid.get('g', c.x, c.z).ground, c);
    console.log(`  ${name}: ${c.x},${c.z} ${before} → ${after}`);
    if (before === after) fail(`${name}: the pulse didn't take`);
    console.log(`  ✓ ${dir}/${name}-waves.png, -ring.png`);
  };

  // 1. mid-pulse on dead ground: day, night, fog
  for (const [name, f, w] of [
    ['day-dead', 0.3, 'sunny'],
    ['night-dead', 0.83, 'sunny'],
    ['fog-dead', 0.45, 'fog'],
  ]) {
    await sky(f, w);
    const c = await deadTile();
    if (!c) fail(`${name}: no dead tile to pulse`);
    else await pulse(name, c);
  }

  // 2. the park grown round one dead tile: mid-pulse on restored grass, day and night
  const grass = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const open = (x, z) => {
      const t = s.grid.get('g', x, z);
      return t && !t.blocked && !t.occupantId && t.feature !== 'water' && t.feature !== 'building';
    };
    // a dead tile with open ground all round it (nothing to inspect, nothing tall nearby)
    const keep = s.areas.tiles('park').find((t) => {
      if (t.ground !== 'polluted') return false;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (!open(t.x + dx, t.z + dz)) return false;
      return true;
    });
    if (!keep) return undefined;
    // plain grass round it (no flowers or bushes: bloom stays low), as after a few pulses
    for (let dz = -3; dz <= 3; dz++)
      for (let dx = -3; dx <= 3; dx++) {
        if (!dx && !dz) continue;
        const t = s.grid.get('g', keep.x + dx, keep.z + dz);
        t.ground = 'restored';
        t.pollution = 0;
        t.bloom = 0;
        s.grid.touch(t);
      }
    g.chunks.markAll();
    return { x: keep.x, z: keep.z };
  });
  if (!grass) fail('no tile kept dead in the grown park');
  else {
    await sky(0.3, 'sunny');
    await pulse('day-grass', grass);
    // pulse ignores a restored tile, so a second one needs a fresh dead tile: put one back for the night shot
    await page.evaluate((c) => {
      const s = window.solarbloom.sim;
      const t = s.grid.get('g', c.x, c.z);
      t.ground = 'polluted';
      t.pollution = 1;
      t.bloom = 0;
      s.grid.touch(t);
      window.solarbloom.chunks.markAll();
    }, grass);
    await sky(0.83, 'sunny');
    await pulse('night-grass', grass);
  }

  // 3. Bloombot close up (visor eyes, trim glow), by day and at night, facing the camera
  for (const [name, f] of [
    ['bot-day', 0.3],
    ['bot-night', 0.83],
  ]) {
    await sky(f, 'sunny');
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.closeAll?.();
      g.bot.pose.facing = 0;
      g.camera.turnTo(360, true);
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/${name}.png` });
    // the follow camera keeps bloombot just below the middle of the screen
    await page.screenshot({ path: `${dir}/${name}-close.png`, clip: { x: 480, y: 300, width: 320, height: 320 } });
    console.log(`  ✓ ${dir}/${name}.png`);
  }

  // 4. the build hologram Bloombot projects
  await sky(0.3, 'sunny');
  const spot = await deadTile();
  await page.evaluate((c) => {
    const g = window.solarbloom;
    g.sim.inventory.add('scrap', 50);
    g.sim.inventory.add('biomass', 50);
    g.closeAll?.();
    // facing open dead ground a step ahead, where the compost bin would go
    if (c) {
      g.bot.teleport('g', c.x + 0.5, c.z + 1.6);
      Object.assign(g.bot.pose, { x: c.x + 0.5, z: c.z + 1.6, facing: Math.PI });
      g.camera.turnTo(360, true);
    }
    g.sim.inventory.add('planks', 10);
    g.selectTool('compostBin');
  }, spot);
  await page.waitForTimeout(2500);
  // the HUD off (as photo mode hides it), so the build prompt doesn't cover Bloombot and its hologram
  await page.evaluate(() => document.body.classList.add('photo'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/build-hologram.png` });
  await page.screenshot({ path: `${dir}/build-hologram-close.png`, clip: { x: 400, y: 200, width: 480, height: 400 } });
  await page.evaluate(() => document.body.classList.remove('photo'));
  console.log(`  ✓ ${dir}/build-hologram.png`);

  if (errors.length) fail(`page errors:\n${errors.join('\n')}`);
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);
