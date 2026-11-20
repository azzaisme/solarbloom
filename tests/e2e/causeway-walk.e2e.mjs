// E23.8.3.1 (#451): bloombot walks the Long Causeway, in the real game (headless Chromium).
//   node tests/e2e/causeway-walk.e2e.mjs     (after `vite build`; SHOTS_DIR overrides the screenshot folder)
// Before the Great Bloom there is no way across: the broken middle is open sea and bloombot's path-finder finds no
// route to the mainland. After it, bloombot walks from the island end, down the ramp onto the raised sea-level
// middle, up the far ramp and onto the mainland's landing district. Screenshots of the walk go to
// docs/review/causeway-walk-*.png. Fails on any check or page error.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4198, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failed = true;
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await page.goto('http://localhost:4198/?slot=1&gfx=deck');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom?.sim && !!window.solarbloom?.bot);
  await page.addStyleTag({ content: '#hint, #intro, .toast, #toasts { display: none !important; }' });
  await page.evaluate(() => document.querySelector('#introGo')?.click());

  // the island end of the causeway, and a spot on the landing district past its far end
  const ends = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const start = [101.5, 7.5];
    const goal = [150, 7];
    // the island end must be clear ground for bloombot to stand on
    s.areas.clear(s.areas.map.areaOfChunk(6, 0), true);
    g.bot.teleport('g', start[0], start[1]);
    return { start, goal, at: [g.bot.pose.x, g.bot.pose.z] };
  });
  check(Math.abs(ends.at[0] - ends.start[0]) < 1.5, `bloombot stands at the island end of the causeway (${ends.at.map((v) => v.toFixed(1))})`);

  // before the Great Bloom: no way across
  const before = await page.evaluate(({ goal }) => window.solarbloom.bot.goTo('g', goal[0], goal[1]), ends);
  check(before === false, 'before the Great Bloom, bloombot finds no way across the broken causeway');

  // the Great Bloom raises the middle
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.state.salvage.tier = 5;
    s.bus.emit('fountain.tier', { tier: 5 });
    g.chunks.markAll();
  });
  const after = await page.evaluate(({ goal }) => window.solarbloom.bot.goTo('g', goal[0], goal[1]), ends);
  check(after === true, 'after the Great Bloom, bloombot has a path to the mainland');

  // walk it, frame by frame, with the camera following; shots at the start, the sea-level middle and the far end
  const walkFor = (secs) =>
    page.evaluate((secs) => {
      const g = window.solarbloom;
      const ys = [];
      for (let t = 0; t < secs; t += 0.05) {
        g.bot.update(0.05);
        g.updateExploreCamera?.(0.05);
        g.camera.update(0.05);
        const [x, y] = g.bot.world();
        ys.push([+x.toFixed(2), +y.toFixed(3)]);
      }
      return { x: g.bot.pose.x, z: g.bot.pose.z, ys };
    }, secs);
  const track = [];
  const gaps = new Set();
  const shot = async (name) => {
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log(`  · ${dir}/${name}.png`);
  };
  await shot('causeway-walk-1-start');
  for (let i = 0; i < 60; i++) {
    const r = await walkFor(1);
    gaps.add(track.length); // the real game loop walks bloombot between batches too (the shots wait): no frame pair there
    track.push(...r.ys);
    if (i === 8) await shot('causeway-walk-2-ramp');
    if (r.x >= 122 && !track.shotMiddle) {
      track.shotMiddle = true;
      await shot('causeway-walk-3-middle');
    }
    if (r.x >= ends.goal[0] - 1.5) break;
  }
  await shot('causeway-walk-4-mainland');
  const end = await page.evaluate(() => {
    const g = window.solarbloom;
    return { x: g.bot.pose.x, z: g.bot.pose.z, area: g.sim.areas.map.areaOfChunk(Math.floor(g.bot.pose.x / 16), Math.floor(g.bot.pose.z / 16)) };
  });
  check(end.x >= 144, `bloombot walked onto the mainland (x ${end.x.toFixed(1)}, ${end.area})`);
  check(end.area.startsWith('ml_'), `and stands in a mainland district (${end.area})`);
  const onDeck = track.filter(([x]) => x >= 104 && x <= 146);
  const hi = Math.max(...track.map(([, y]) => y)); // the deck's high ends (the real game loop also walks bloombot during the shots' waits)
  const lo = Math.min(...onDeck.filter(([x]) => x >= 120 && x <= 129).map(([, y]) => y));
  check(onDeck.length > 20, `the walk crossed the causeway (${onDeck.length} frames on it)`);
  check(lo < hi - 0.2, `down the ramp onto the raised sea-level middle and back up (deck ends ${hi.toFixed(2)} m, middle ${lo.toFixed(2)} m)`);
  // never a jump: bloombot's height changes smoothly along the ramps
  let worst = 0;
  let worstAt = 0;
  for (let i = 1; i < track.length; i++) {
    if (gaps.has(i)) continue;
    const d = Math.abs(track[i][1] - track[i - 1][1]);
    if (d > worst) { worst = d; worstAt = i; }
  }
  if (worst >= 0.25) console.log('  jump at', JSON.stringify(track.slice(Math.max(0, worstAt - 3), worstAt + 3)));
  check(worst < 0.25, `no step or jump on the way (largest height change per frame ${worst.toFixed(3)} m)`);
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
process.exit(failed ? 1 : 0);
