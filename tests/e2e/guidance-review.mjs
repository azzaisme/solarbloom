// Capture the same fountain exit and market task on the baseline and the updated build.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { gameUrl, waitForGame } from './lib/start-game.mjs';

const out = process.env.SHOTS_DIR ?? 'docs/review/market-guidance';
const port = Number(process.env.ART_PORT ?? 4212);
const before = !!process.env.ART_BASELINE;
mkdirSync(out, { recursive: true });
const server = await preview({
  build: { outDir: process.env.ART_BUILD ?? 'dist' },
  preview: { port, strictPort: true }, logLevel: 'silent',
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
] });
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 700 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(String(error)); console.error(String(error)); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  await page.addInitScript(() => localStorage.setItem('solarbloom.settings', JSON.stringify({ reducedMotion: true, noVistas: true })));
  await page.goto(gameUrl(`http://localhost:${port}`, { query: 'gfx=low&models=classic' }), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.solarbloom?.bot, null, { timeout: 120000 });
  console.log('Game initialized');
  // Software WebGL can take minutes to render every warmup frame. Stream the normal scene,
  // then request individual frames to compile and draw the materials visible in each shot.
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.app.autoRender = false;
    Object.defineProperty(g.warmup, 'state', { value: 'done' });
  });
  await waitForGame(page, 90000);
  console.log('Game ready');
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.app.autoRender = false;
    g.sim.state.salvage.tier = 1;
    g.sim.state.salvage.abilities.push('pry');
    g.sim.gates.open('g-oldMarket', true);
    g.skipCinematic?.();
    g.sim.state.salvage.keepers.tally = { step: 'request2' };
    g.sim.weather.forceForTest('sunny', 1e9);
    (g.sim.state.clock ??= { offset: 0 }).offset += (0.35 - g.sim.clock.dayFraction()) * 2880;
  });
  console.log('Market request staged');
  async function at(x, z, facing) {
    await page.evaluate(({ x, z, facing }) => {
      const g = window.solarbloom;
      Object.assign(g.bot.pose, { x, z, facing });
      g.camera.turnTo(facing * 180 / Math.PI + 180, true);
      g.trail.clear();
    }, { x, z, facing });
    await page.waitForTimeout(2200);
  }
  async function shot(label) {
    console.log(`Rendering ${label}`);
    await page.evaluate(() => { window.solarbloom.app.renderNextFrame = true; });
    await page.waitForTimeout(550);
    await page.screenshot({ path: `${out}/${before ? 'before' : 'after'}-${label}.png`, timeout: 90000 });
    console.log(`Captured ${label}`);
  }
  await at(11.5, 7.5, Math.PI / 2);
  console.log('Fountain exit staged');
  assert.equal(await page.evaluate(() => window.solarbloom.hud.objective.showWhere()), true);
  await page.waitForFunction(() => window.solarbloom.trail.showing);
  await shot('fountain-exit');

  await at(25.5, 19.5, Math.PI / 2);
  if (!before) await page.waitForFunction(() => window.solarbloom.tileFx.objectiveFrames?.size > 0);
  await shot('market-tiles');
  if (!before) {
    const removed = await page.evaluate(() => {
      const g = window.solarbloom;
      const tile = [...g.sim.keepers.patchTiles('tally')].find(tile => tile.ground !== 'restored');
      g.sim.restoration.complete(tile, 'pulse');
      return tile.id;
    });
    await page.waitForFunction(id => !window.solarbloom.tileFx.objectiveFrames.has(id), removed);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  server.httpServer.close();
}
