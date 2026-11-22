// #681 (E27.3): review shots for dropping the distant city skyline, into docs/review/skyline-off/ (or argv[2]).
//   npx vite build && GPU=1 node tests/e2e/skyline-off-shots.mjs [outDir]
// A new game at the Steam Deck's size (1280 × 800, ?gfx=deck). Bloombot stands where a new game starts and the camera
// looks out past the city to the horizon, by day, at dusk, at midnight and in fog by day, from two views: the follow
// camera (the game's own zoom, as a player sees it) and the wide view (the map's overview, M). The walking HUD is
// hidden so the horizon shows. Run it on the base build for the "before" set and on this branch for "after".
// Checks: no page errors, and no `skyline` on the game object.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame, QUIET_CSS, WALKING_HUD } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/skyline-off';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4281, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const SKIES = [
  ['day', 0.45, 'sunny'],
  ['dusk', 0.662, 'sunny'],
  ['night', 0.83, 'sunny'],
  ['fog', 0.45, 'fog'],
];
const YAW = 200;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await startGame(page, 'http://localhost:4281', { slot: 3, query: 'gfx=deck', settings: { uiScale: 150 } });
  await page.addStyleTag({ content: `${QUIET_CSS} ${WALKING_HUD.join(', ')}, #hud { visibility: hidden !important; }` });
  const start = await page.evaluate(() => ({ x: window.solarbloom.bot.pose.x, z: window.solarbloom.bot.pose.z }));
  for (const [sky, f, weather] of SKIES) {
    await page.evaluate(({ f, weather }) => {
      const s = window.solarbloom.sim;
      s.weather.forceForTest(weather, 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
      s.lights.dark = s.power.sky().dark;
    }, { f, weather });
    // the sky and fog ease toward the new hour and weather
    await page.waitForTimeout(7000);
    for (const view of ['follow', 'wide']) {
      await page.evaluate(({ start, yaw }) => {
        const g = window.solarbloom;
        Object.assign(g.bot.pose, { x: start.x, z: start.z });
        g.bot.following = true;
        g.camera.turnTo(yaw, true);
        for (let i = 0; i < 300; i++) g.camera.update(0.05);
      }, { start, yaw: YAW });
      await page.waitForTimeout(2500);
      if (view === 'wide') {
        await page.keyboard.press('KeyM');
        await page.waitForTimeout(3500);
      }
      const file = `${out}/${view}-${sky}.png`;
      await page.screenshot({ path: file });
      console.log(`  ${file}`);
      if (view === 'wide') {
        await page.keyboard.press('KeyM');
        await page.waitForTimeout(2500);
      }
    }
  }
  check(await page.evaluate(() => !('skyline' in window.solarbloom) || !window.solarbloom.skyline), 'no skyline on the game');
  check(errors.length === 0, `no page errors${errors.length ? ` (${errors.slice(0, 3).join(' | ')})` : ''}`);
} catch (e) {
  console.log(`✗ crashed: ${e.message}`);
  failures.push('crash');
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failures.length ? 1 : 0);
