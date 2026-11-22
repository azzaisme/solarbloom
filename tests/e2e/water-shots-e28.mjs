// E28.W01 (#694): the water, from the follow camera and the zoomed-out view, at day, golden hour and night.
// `npm run build` first, then `GPU=1 node tests/e2e/water-shots-e28.mjs [outDir]` (default docs/review/e28-694).
// A new game with the ground round Bloombot's start restored to full bloom (as sunlit-shots does), so the shore, the
// shallows and the open sea are all in view. Spots:
//   sea       follow camera at the start, looking out over the jetty to the open sea
//   shore     follow camera at the start, looking back over the restored island and the shallows round it
//   overview  the zoomed-out view (the furthest zoom) over the start, the island and the sea
// Times: day (noon), golden (late afternoon, the sun low and warm) and night (midnight).
// It also measures, on High at the sea spot by day: frame time (median and mean of the frame times over 8 s, vsync
// off) and draw calls, printed as `perf …` (the PR's before/after numbers).
//   TAG=before     name the shots (default: after)
//   ONLY=day,night just these times;   SPOTS=sea,overview just these spots;   NOPERF=1 skip the measure
//   NOREFLECT=1    the High-tier planar reflection off (to measure what it costs on its own)
//   STRIP=1        also 6 frames 0.25 s apart after each shot (`…-f0.png` …), for motion strips and GIFs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/e28-694';
mkdirSync(dir, { recursive: true });
const TAG = process.env.TAG ?? 'after';
const ALL = { day: 0.3, golden: 0.6, night: 0.83 };
const TIMES = process.env.ONLY ? Object.fromEntries(Object.entries(ALL).filter(([k]) => process.env.ONLY.split(',').includes(k))) : ALL;
const SPOTS = (process.env.SPOTS ?? 'sea,shore,overview').split(',');
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port: 4244, strictPort: true }, logLevel: 'silent' });
const gpu = ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
const browser = await chromium.launch({ args: process.env.GPU ? gpu : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`    ✗ ${msg}`);
};
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'warning' && /GL_INVALID|Feedback loop/.test(m.text())) errors.push(m.text());
  });
  page.setDefaultTimeout(300_000);
  await page.goto('http://localhost:4244/?slot=1&gfx=high');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom && !!window.solarbloom.sim);
  // the loading screen is done (every step full) and has faded
  await page.waitForFunction(() => Object.values(window.solarbloom.loadSteps()).every((v) => v === 1), null, { polling: 500 });
  await page.waitForTimeout(4000);
  if (process.env.NOREFLECT)
    await page.evaluate(() => {
      const r = window.solarbloom.waterReflection;
      const update = r.update.bind(r);
      r.update = (_on, y) => update(false, y);
    });
  await page.addStyleTag({ content: '#hud, .toast, #toasts { display: none !important; }' });
  const start = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const p = g.bot.pose;
    const x0 = Math.round(p.x);
    const z0 = Math.round(p.z);
    for (let dz = -9; dz <= 9; dz++)
      for (let dx = -9; dx <= 5; dx++) {
        const t = s.grid.get('g', x0 + dx, z0 + dz);
        if (!t || t.feature === 'water' || !s.areas.canTouch(t)) continue;
        t.ground = 'restored';
        t.bloom = 3;
        t.pollution = 0;
        s.grid.touch(t);
        g.chunks.markTile(t);
      }
    return [p.x, p.z];
  });
  const at = (f) =>
    page.evaluate((f) => {
      const s = window.solarbloom.sim;
      s.weather.forceForTest('sunny', 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
      s.lights.dark = s.power.sky().dark;
    }, f);
  const place = (spot) =>
    page.evaluate(
      ({ spot, start }) => {
        const g = window.solarbloom;
        const [x, z] = start;
        g.bot.teleport('g', x, z);
        if (spot === 'overview') {
          g.bot.following = false;
          g.camera.glide(x - 4, 0, z - 6, g.camera.minZoom);
          g.camera.setZoom(g.camera.minZoom);
          g.camera.turnTo(200);
        } else {
          g.bot.following = true;
          g.camera.turnTo(spot === 'sea' ? 200 : 20);
        }
        for (let i = 0; i < 300; i++) g.camera.update(0.05);
      },
      { spot, start },
    );
  for (const [name, f] of Object.entries(TIMES)) {
    await at(f);
    for (const spot of SPOTS) {
      await place(spot);
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.solarbloom.look.snapMood());
      await page.waitForTimeout(3000);
      const file = `${dir}/${TAG}-${name}-${spot}.png`;
      await page.screenshot({ path: file });
      console.log(`  ${file}`);
      if (process.env.STRIP)
        for (let i = 0; i < 6; i++) {
          await page.screenshot({ path: `${dir}/${TAG}-${name}-${spot}-f${i}.png` });
          await page.waitForTimeout(250);
        }
    }
  }
  if (!process.env.NOPERF) {
    await at(ALL.day);
    await place('sea');
    await page.waitForTimeout(3000);
    const perf = await page.evaluate(
      () =>
        new Promise((done) => {
          const app = window.solarbloom.app;
          const ms = [];
          const calls = [];
          const t0 = performance.now();
          let last = t0;
          const tick = () => {
            const now = performance.now();
            ms.push(now - last);
            last = now;
            calls.push(app.stats?.drawCalls?.total ?? 0);
            if (now - t0 < 8000) requestAnimationFrame(tick);
            else {
              ms.sort((a, b) => a - b);
              const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
              done({ frames: ms.length, mean, median: ms[Math.floor(ms.length / 2)], p95: ms[Math.floor(ms.length * 0.95)], calls: Math.round(calls.reduce((a, b) => a + b, 0) / calls.length) });
            }
          };
          requestAnimationFrame(tick);
        }),
    );
    console.log(`  perf ${TAG}: ${perf.frames} frames, median ${perf.median.toFixed(2)} ms, mean ${perf.mean.toFixed(2)} ms, p95 ${perf.p95.toFixed(2)} ms, draw calls ${perf.calls}`);
  }
  if (errors.length) fail('page errors:\n' + [...new Set(errors)].slice(0, 5).join('\n'));
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failed ? 'FAILED' : 'all good');
process.exit(failed ? 1 : 0);
