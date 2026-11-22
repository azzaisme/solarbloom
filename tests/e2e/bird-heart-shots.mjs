// #689 (E27.5): the Great Bloom's heart of birds, filmed from the follow camera at the Steam Deck's size (1280 × 800,
// ?gfx=deck, UI at 150%), into docs/review/bird-heart/ (or argv[2]).
//   npx vite build && GPU=1 node tests/e2e/bird-heart-shots.mjs [outDir]
//   then: python tests/e2e/bird-heart-clip.py docs/review/bird-heart   (the clip and the strips, from the frames)
// The real event fires (fountain tier 5, the Great Bloom) and the whole flight is filmed, a frame every 0.3 s of the
// flight's own clock (game time runs at a quarter while filming, so no step is missed):
//   1-flight   the flight as a player sees it, HUD and the bloom message showing
//   2-turn     the same, with the camera swinging 70° while the heart holds: the heart stays put on screen
//   3-calm     reduced motion: the birds grow into place, hold and go
// Checks: the heart's box clears the HUD cards and the bloom message; every bird is out at the formed moment and none
// is left once the flight ends; it plays once (a second bloom while it flies does nothing); no page errors.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/bird-heart';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4285, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({
  args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

async function film(name, { reducedMotion = false, turn = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await startGame(page, 'http://localhost:4285', { slot: 3, query: 'gfx=deck', settings: { uiScale: 150, reducedMotion } });
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.weather.forceForTest('sunny', 1e9);
    (s.state.clock ??= { offset: 0 }).offset += (0.4 - s.clock.dayFraction()) * 2880;
    // Bloombot on the beach path below the park, the camera looking out over the sea
    g.bot.teleport('g', 8.5, 30.5);
    g.bot.pose.facing = 0;
    g.bot.following = true;
    g.camera.turnTo(0, true);
  });
  // first-time cards and the load wheel's introduction pass
  await page.waitForTimeout(6000);
  // the flight is filmed by its own clock: game time slowed to a quarter while filming, a frame every 0.3 s of flight
  await page.evaluate(() => window.solarbloom.sim.bus.emit('fountain.tier', { tier: 5 }));
  await page.evaluate(() => (window.solarbloom.app.timeScale = 0.25));
  const formedAt = reducedMotion ? 1.5 : 5.0;
  let next = 0;
  let frame = 0;
  let started = false;
  let turned = false;
  let formedChecked = false;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const fl = window.solarbloom.birdHeart.flight;
      return fl ? { t: fl.t, box: fl.box, shown: fl.poses.filter((p) => p.shown).length, n: fl.poses.length } : undefined;
    });
    if (!st) {
      if (started) break; // flown and cleaned up
      await page.waitForTimeout(20);
      continue;
    }
    started = true;
    if (turn && !turned && st.t >= 5.6) {
      turned = true;
      await page.evaluate(() => window.solarbloom.camera.turnTo(window.solarbloom.camera.heading + 70));
    }
    if (st.t < next) {
      await page.waitForTimeout(15);
      continue;
    }
    next += 0.3;
    await page.screenshot({ path: `${out}/${name}-${String(frame++).padStart(2, '0')}.png` });
    if (frame === 1) {
      // the box against the HUD's cards and the toasts, the bloom message among them (up for its 6 s from the bloom)
      const rects = await page.evaluate(() =>
        ['#obj', '#res', '#toasts .toast', '#prompt', '#minimap']
          .flatMap((s) => [...document.querySelectorAll(s)])
          .filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { id: e.id || e.className, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
          }),
      );
      const b = { left: st.box.x, top: st.box.y, right: st.box.x + st.box.w, bottom: st.box.y + st.box.h };
      const hits = rects.filter((r) => overlap(b, r));
      check(hits.length === 0, `${name}: the heart (${Math.round(b.left)}–${Math.round(b.right)} × ${Math.round(b.top)}–${Math.round(b.bottom)}) clears the HUD and the bloom message${hits.length ? `: hits ${hits.map((r) => r.id).join(', ')}` : ''}`);
      check(rects.some((r) => String(r.id).includes('toast')), `${name}: the bloom message is up beside it`);
    }
    if (!formedChecked && st.t >= formedAt) {
      formedChecked = true;
      check(st.shown === st.n, `${name}: all ${st.n} birds are out in the heart (${st.shown})`);
    }
  }
  check(started && formedChecked, `${name}: the flight played through (${frame} frames)`);
  await page.evaluate(() => (window.solarbloom.app.timeScale = 1));
  const after = await page.evaluate(() => {
    const g = window.solarbloom;
    const again = g.birdHeart.play(1280, 800, { x: 0, y: 0, w: 100, h: 90 }, false); // a later bloom may play again
    g.birdHeart.stop();
    return { active: g.birdHeart.active, left: g.scene.world.findByName('bird-heart') ? 1 : 0, again };
  });
  check(after.left === 0 && !after.active, `${name}: no bird is left once the flight ends`);
  check(after.again, `${name}: it can play again at a later bloom`);
  if (!reducedMotion && !turn) {
    // once at a time: a second bloom while it flies does nothing
    const once = await page.evaluate(() => {
      const g = window.solarbloom;
      const a = g.birdHeart.play(1280, 800, { x: 500, y: 50, w: 280, h: 250 }, false);
      const b = g.birdHeart.play(1280, 800, { x: 500, y: 50, w: 280, h: 250 }, false);
      const n = g.scene.world.findByName('bird-heart')?.children.length;
      g.birdHeart.stop();
      return { a, b, n };
    });
    check(once.a && !once.b && once.n === 26, `${name}: one flock at a time (${once.n} birds)`);
  }
  check(errors.length === 0, `${name}: no page errors${errors.length ? ` (${errors.slice(0, 3).join(' | ')})` : ''}`);
  await page.close();
}

try {
  await film('1-flight');
  await film('2-turn', { turn: true });
  await film('3-calm', { reducedMotion: true });
} catch (e) {
  console.log(`✗ crashed: ${e.message}`);
  failures.push('crash');
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failures.length ? 1 : 0);
