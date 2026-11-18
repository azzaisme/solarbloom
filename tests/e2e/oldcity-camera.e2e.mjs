// E21.22: the exploration camera, in the real page (a new Old City game, ?gfx=deck):
// - pitch stays within 20°–60° (default 35°) and the zoom within its three steps;
// - after 3 s of walking with no camera input the view drifts back behind bloombot (not before);
// - the camera never ends below the ground, also tilted low beside Mast Row's embankment;
// - a full circle at each zoom step in the park and in Mast Row: no page errors, within the Deck's draw calls;
// - walking down Mast Row's main street, no building covers bloombot at more than 30% opacity.
// Run after a build: `node tests/e2e/oldcity-camera.e2e.mjs` (also in `npm run test:e2e`).
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}
const DRAW_LIMIT = 450;
const server = await preview({ preview: { port: 4185, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures++;
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4185/?slot=1&gfx=deck');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom?.bot);
  const step = (secs) => page.evaluate((secs) => { const g = window.solarbloom; for (let t = 0; t < secs; t += 0.05) { g.bot.update(0.05); g.updateExploreCamera(0.05); g.updateBotZoom?.(); g.camera.update(0.05); } }, secs);
  // pitch and zoom limits
  const lim = await page.evaluate(() => {
    const g = window.solarbloom;
    const c = g.camera;
    const out = { start: c.pitchGoal };
    c.pitchBy(200);
    for (let i = 0; i < 60; i++) c.update(0.05);
    out.max = c.explorePitchNow;
    c.pitchBy(-400);
    for (let i = 0; i < 60; i++) c.update(0.05);
    out.min = c.explorePitchNow;
    c.pitchBy(15);
    const zs = [];
    for (let i = 0; i < 4; i++) { g.zoomStepBy(1); g.updateBotZoom(); zs.push(c.zoomTarget); }
    for (let i = 0; i < 4; i++) { g.zoomStepBy(-1); g.updateBotZoom(); zs.push(c.zoomTarget); }
    out.zooms = zs.map((z) => Math.round(z * 100) / 100);
    g.zoomStepBy(1);
    g.updateBotZoom();
    return out;
  });
  check(lim.start === 35, `default pitch 35° (${lim.start})`);
  check(Math.abs(lim.max - 60) < 0.5 && Math.abs(lim.min - 20) < 0.5, `pitch stays in 20°–60° (${lim.min.toFixed(1)}–${lim.max.toFixed(1)})`);
  check(Math.max(...lim.zooms) <= 4.27 + 0.01 && Math.min(...lim.zooms) >= 2.04, `zoom stays on its three steps (${[...new Set(lim.zooms)].join(', ')})`);
  // auto-recentre: turn the view, walk; no drift before 3 s, a drift back after
  await page.evaluate(() => {
    const g = window.solarbloom;
    document.querySelector('#introGo')?.click();
    g.bot.teleport('g', 8.5, 34.5);
    g.bot.pose.facing = Math.PI;
    g.camTurn(90, 0);
    g.bot.goTo('g', 8, 18, 1, () => {});
  });
  const h0 = await page.evaluate(() => window.solarbloom.camera.heading);
  await step(2);
  const h2 = await page.evaluate(() => window.solarbloom.camera.heading);
  await step(2.5);
  const h4 = await page.evaluate(() => window.solarbloom.camera.heading);
  check(Math.abs(h2 - h0) < 0.5, `no drift in the first 3 s of walking (${(h2 - h0).toFixed(1)}°)`);
  check(Math.abs(h4 - h2) > 5, `drifts back behind bloombot after 3 s (${(h4 - h2).toFixed(1)}°)`);
  // never below the ground: tilted low, looking across Mast Row's embankment
  const ground = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.state.areas.mastRow = { fog: 'thinning', revealedAt: 0 };
    g.chunks.markAll();
    g.bot.teleport('g', 23.5, -26.5);
    g.camera.pitchBy(-100);
    let worst = Infinity;
    for (let a = 0; a < 360; a += 15) {
      g.camera.turnTo(a, true);
      for (let i = 0; i < 40; i++) g.camera.update(0.05);
      const p = g.camera.entity.getPosition();
      worst = Math.min(worst, p.y - g.groundY(p.x, p.z));
    }
    g.camera.pitchBy(15);
    return worst;
  });
  check(ground >= 0.5, `the camera stays above the ground (lowest clearance ${ground.toFixed(2)})`);
  // a full circle at each zoom step, in the park and in Mast Row, within the Deck's draw calls
  for (const [x, z, where] of [[8.5, 10.5, 'park'], [8.5, -12.5, 'Mast Row']])
    for (const zs of [0, 1, 2]) {
      await page.evaluate(({ x, z, zs }) => {
        const g = window.solarbloom;
        g.bot.teleport('g', x, z);
        g.zoomStep = zs;
        g.updateBotZoom();
      }, { x, z, zs });
      await page.waitForTimeout(2500);
      let worst = 0;
      for (let k = 0; k < 12; k++) {
        await page.evaluate(() => window.solarbloom.camTurn(30, 0));
        await page.waitForTimeout(250);
        worst = Math.max(worst, await page.evaluate(() => window.solarbloom.app.stats.drawCalls.total));
      }
      check(worst <= DRAW_LIMIT, `${where}, zoom step ${zs}: a full circle, worst ${worst} draw calls (limit ${DRAW_LIMIT})`);
    }
  // walking down Mast Row's main street: nothing covers bloombot at more than 30%
  let worstCover = 0;
  for (let zc = -4; zc >= -30; zc -= 4) {
    await page.evaluate((zc) => {
      const g = window.solarbloom;
      g.bot.teleport('g', 8.5, zc + 0.5);
      g.bot.pose.facing = Math.PI;
      g.camera.turnTo(0, true);
    }, zc);
    await page.waitForTimeout(1200);
    const cover = await page.evaluate(() => {
      const g = window.solarbloom;
      const cam = g.camera.cam;
      const [bx, by, bz] = g.bot.world();
      const V = g.camera.target.constructor;
      const eye = cam.entity.getPosition();
      const to = { x: bx, y: by + 0.45, z: bz };
      let worst = 0;
      for (const v of g.chunks.views.values())
        for (const t of v.towers ?? []) {
          // the same sight-line test the game uses: a box standing between the camera and bloombot
          let hit = false;
          for (let i = 1; i < 40 && !hit; i++) {
            const k = i / 40;
            const x = eye.x + (to.x - eye.x) * k, y = eye.y + (to.y - eye.y) * k, z = eye.z + (to.z - eye.z) * k;
            if (Math.abs(x - t.x) <= t.r && Math.abs(z - t.z) <= t.r && y >= t.base && y <= t.top) hit = true;
          }
          if (hit) worst = Math.max(worst, t.a);
        }
      return worst;
    });
    worstCover = Math.max(worstCover, cover);
  }
  check(worstCover <= 0.31, `walking down Mast Row, a building over bloombot is at most ${Math.round(worstCover * 100)}% opaque`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 2).join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failures) process.exit(1);
