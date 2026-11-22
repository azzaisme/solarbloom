// E28.W03 (#696): every deck, pier and causeway that stands in the water, from the follow camera and the zoomed-out
// view, at day, golden hour and night, on High at 1920 × 1080, into docs/review/e28-696/ (or argv[2]).
//   npm run build, then GPU=1 node tests/e2e/bridge-shots.mjs [outDir]
// Run it on the base build with TAG=before and on the branch (TAG=after, the default): the spots and the camera match.
// The ground round each spot is restored to full bloom first, its area cleared, and the Saltwind canal gate opened (so
// its plank bridge is down).
// Spots:
//   jetty     follow camera on the Landing's jetty where it leaves the beach, looking out along it to sea
//   jettyside follow camera on the beach beside the jetty, looking across at its side, posts and shore end
//   canal     follow camera on the canal bank beside the Saltwind plank bridge, looking at it
//   causeway  follow camera on the island's east shore, looking across at the Long Causeway's walls in the sea
//   pier      follow camera on the old pier out in the bay, looking along its edge
//   overview  the zoomed-out view over the jetty, the beach and the bay
// Times: day (noon), golden (late afternoon) and night (midnight).
// PERF=1 measures instead of shooting: frame time (median, mean, p95 over 8 s, vsync off) and draw calls on High, at
// the jetty spot and the overview by day, printed as `perf …`. Run it on base and branch alternately.
//   ONLY=day,night just these times;   SPOTS=jetty,canal just these spots
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/e28-696';
mkdirSync(dir, { recursive: true });
const TAG = process.env.TAG ?? 'after';
const ALL = { day: 0.3, golden: 0.6, night: 0.83 };
const TIMES = process.env.ONLY ? Object.fromEntries(Object.entries(ALL).filter(([k]) => process.env.ONLY.split(',').includes(k))) : ALL;
const SPOTS = (process.env.SPOTS ?? 'jetty,jettyside,canal,causeway,pier,overview').split(',');
const PERF = !!process.env.PERF;
/** where Bloombot stands, which way the camera looks (world x, z), and the extra camera turn (degrees) */
const PLACES = {
  jetty: { at: [8.5, 45.6], look: [0, 1], turn: 0 },
  jettyside: { at: [5.5, 44.5], look: [0.75, 0.66], turn: 0 },
  canal: { at: [-0.6, 34.6], look: [-0.5, 0.85], turn: 30 },
  causeway: { at: [107.5, 11.5], look: [0.8, -0.6], turn: 0 },
  pier: { at: [21.6, 53.6], look: [0.3, 1], turn: 0 },
};
const port = 4247;
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const gpu = ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
const browser = await chromium.launch({ args: process.env.GPU ? gpu : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'warning' && /GL_INVALID|Feedback loop/.test(m.text())) errors.push(m.text());
  });
  page.setDefaultTimeout(300_000);
  await startGame(page, `http://localhost:${port}`, { slot: 1, query: 'gfx=high' });
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#hud, .toast, #toasts { display: none !important; }' });
  // restore the ground round every spot once, up front, and open the canal gate
  await page.evaluate((places) => {
    const g = window.solarbloom;
    const s = g.sim;
    s.gates.open('g-saltwind', true);
    for (const { at } of Object.values(places)) {
      const [cx, cz] = [Math.floor(at[0]), Math.floor(at[1])];
      const area = s.areas.areaOf({ roofId: 'g', x: cx, z: cz });
      if (area && s.state.areas[area]) s.state.areas[area].sealed = false;
      if (area) s.areas.clear(area, true);
      for (let dz = -7; dz <= 7; dz++)
        for (let dx = -7; dx <= 7; dx++) {
          const t = s.grid.peek('g', cx + dx, cz + dz);
          if (!t || t.blocked || t.occupantId || t.ramp) continue;
          t.ground = 'restored';
          t.bloom = 4;
          t.pollution = 0;
          s.grid.touch(t);
          g.chunks.markTile(t);
        }
    }
  }, PLACES);
  const at = (f) =>
    page.evaluate((f) => {
      const s = window.solarbloom.sim;
      s.weather.forceForTest('sunny', 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
      s.lights.dark = s.power.sky().dark;
    }, f);
  await page.waitForFunction(() => window.solarbloom.chunks.pending === 0, null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(12000); // restored ground grows in
  const place = (spot) =>
    page.evaluate(
      ({ spot, p }) => {
        const g = window.solarbloom;
        if (spot === 'overview') {
          g.bot.teleport('g', 8.5, 44.5);
          g.bot.following = false;
          g.camera.glide(8.5, 0, 46, g.camera.minZoom);
          g.camera.setZoom(g.camera.minZoom);
          g.camera.turnTo(200);
        } else {
          const [lx, lz] = p.look;
          g.bot.teleport('g', p.at[0], p.at[1]);
          g.bot.pose.facing = Math.atan2(lx, lz);
          g.bot.following = true;
          let best = 0;
          let bestDot = -2;
          for (let y = 0; y < 360; y += 5) {
            g.camera.turnTo(y, true);
            g.camera.update(0.016);
            const f = g.camera.entity.forward;
            const l = Math.hypot(f.x, f.z) || 1;
            const dot = (f.x * lx + f.z * lz) / (l * Math.hypot(lx, lz));
            if (dot > bestDot) [bestDot, best] = [dot, y];
          }
          g.camera.turnTo(best + p.turn, true);
        }
        for (let i = 0; i < 300; i++) g.camera.update(0.05);
      },
      { spot, p: PLACES[spot] },
    );
  if (PERF) {
    await at(ALL.day);
    for (const spot of ['jetty', 'overview']) {
      await place(spot);
      await page.waitForFunction(() => window.solarbloom.chunks.pending === 0, null, { timeout: 60_000 }).catch(() => {});
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
      console.log(`  perf ${TAG} ${spot}: ${perf.frames} frames, median ${perf.median.toFixed(2)} ms, mean ${perf.mean.toFixed(2)} ms, p95 ${perf.p95.toFixed(2)} ms, draw calls ${perf.calls}`);
    }
  } else
    for (const [name, f] of Object.entries(TIMES)) {
      await at(f);
      for (const spot of SPOTS) {
        await place(spot);
        await page.waitForFunction(() => window.solarbloom.chunks.pending === 0, null, { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.evaluate(() => window.solarbloom.look.snapMood());
        await page.waitForTimeout(2500);
        const file = `${dir}/${TAG}-${name}-${spot}.png`;
        await page.screenshot({ path: file });
        console.log(`  ${file}`);
      }
    }
  if (errors.length) {
    failed = true;
    console.error('    ✗ page errors:\n' + [...new Set(errors)].slice(0, 5).join('\n'));
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(failed ? 'FAILED' : 'all good');
process.exit(failed ? 1 : 0);
