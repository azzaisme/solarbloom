// E28.W06 (#699): the water proven in both cameras. A fixed set of spots from the follow (third-person) camera and the
// zoomed-out view, at day (noon), golden hour and night (midnight), on High at 1920 × 1080, with page-error checks.
//   npm run build, then GPU=1 node tests/e2e/water-cameras.mjs [outDir]      (default docs/review/e28-699)
// Run it on the base build with TAG=before and on the branch (TAG=after, the default): the spots and camera match.
// The ground round each spot is restored to full bloom first (its area cleared), and the Saltwind canal gate opened.
// Follow camera (as you play: the exploration camera, its own pitch):
//   start     Bloombot's start, the camera as the game opens it
//   jetty     on the jetty's far end, looking out to sea
//   light     on the jetty's far end, facing the key light across the water (the sun by day, the moon by night): the
//             low-angle highlights, and the moon's path on the water at night
//   shore     on the sandbar island at player height, looking along its waterline (shore detail)
//   canal     on the canal bank by the plank bridge, looking down the canal to the sea
//   grazing   on the jetty's end with the camera tilted down to the horizon (grazing angles: artefacts, the far sea)
// Zoomed-out view (the furthest zoom, looking down):
//   overview  over the start, the island and the bay
//   opensea   a middle zoom over the bay past the sandbar, the water filling the frame (repeating patterns, tiling)
// PERF=1 measures instead: frame time (median, mean, p95 over 8 s, vsync off) and draw calls on High at `start` and
// `overview` by day, printed as `perf …`. Alternate base and branch builds.
//   ONLY=day,night just these times;   SPOTS=light,opensea just these spots;   STRIP=1 also 6 frames 0.25 s apart
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/e28-699';
mkdirSync(dir, { recursive: true });
const TAG = process.env.TAG ?? 'after';
const ALL = { day: 0.3, golden: 0.6, night: 0.83 };
const TIMES = process.env.ONLY ? Object.fromEntries(Object.entries(ALL).filter(([k]) => process.env.ONLY.split(',').includes(k))) : ALL;
const SPOTS = (process.env.SPOTS ?? 'start,jetty,light,shore,canal,grazing,overview,opensea').split(',');
const PERF = !!process.env.PERF;
const STRIP = !!process.env.STRIP;
/**
 * Follow-camera spots: where Bloombot stands, which way the camera looks (world x, z; 'light' = toward the key light),
 * and the camera's pitch (degrees down; undefined keeps the game's own).
 */
const FOLLOW = {
  jetty: { at: [8.5, 48.5], look: [0, 1] },
  light: { at: [8.5, 48.5], look: 'light' },
  shore: { at: [7.5, 55.5], look: [1, 0], pitch: 10 },
  canal: { at: [-3.75, 30.5], look: [0, 1] },
  grazing: { at: [8.5, 48.5], look: [-0.6, 0.8], pitch: 2 },
};
/** Zoomed-out spots: what the camera looks at, its turn and zoom (undefined: the furthest) */
const ABOVE = { overview: { at: [6, 42], yaw: 200 }, opensea: { at: [14, 60], yaw: 200, zoom: 0.7 } };
const port = 4248;
const server = await preview({ preview: { port, strictPort: true }, logLevel: 'silent' });
const gpu = ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'];
const browser = await chromium.launch({ args: process.env.GPU ? gpu : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' || (m.type() === 'warning' && /GL_INVALID|Feedback loop|shader/i.test(m.text()))) errors.push(`${m.type()}: ${m.text()}`);
  });
  page.setDefaultTimeout(300_000);
  await startGame(page, `http://localhost:${port}`, { slot: 1, query: 'gfx=high' });
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#hud, .toast, #toasts { display: none !important; }' });
  const start = await page.evaluate(
    ({ spots }) => {
      const g = window.solarbloom;
      const s = g.sim;
      s.gates.open('g-saltwind', true);
      const p = g.bot.pose;
      const here = [p.x, p.z];
      for (const [cx, cz] of [[Math.floor(p.x), Math.floor(p.z)], ...spots.map(([x, z]) => [Math.floor(x), Math.floor(z)])]) {
        const area = s.areas.areaOf({ roofId: 'g', x: cx, z: cz });
        if (area && s.state.areas[area]) s.state.areas[area].sealed = false;
        if (area) s.areas.clear(area, true);
        for (let dz = -8; dz <= 8; dz++)
          for (let dx = -8; dx <= 8; dx++) {
            const t = s.grid.peek('g', cx + dx, cz + dz);
            if (!t || t.blocked || t.occupantId || t.ramp) continue;
            t.ground = 'restored';
            t.bloom = 4;
            t.pollution = 0;
            s.grid.touch(t);
            g.chunks.markTile(t);
          }
      }
      return here;
    },
    { spots: Object.values(FOLLOW).map((f) => f.at) },
  );
  const at = (f) =>
    page.evaluate((f) => {
      const s = window.solarbloom.sim;
      s.weather.forceForTest('sunny', 1e9);
      (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
      s.lights.dark = s.power.sky().dark;
    }, f);
  await page.waitForFunction(() => window.solarbloom.chunks.pending === 0, null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(12000); // restored ground grows in
  // the game's own pitch and zoom, put back after a spot that changes them
  const { pitch0, zoom0 } = await page.evaluate(() => ({ pitch0: window.solarbloom.camera.pitchGoal, zoom0: window.solarbloom.camera.zoom }));
  const place = (spot) =>
    page.evaluate(
      ({ spot, start, f, a, zoom0 }) => {
        const g = window.solarbloom;
        const cam = g.camera;
        if (!a) cam.setZoom(zoom0); // back to the game's own zoom after a zoomed-out spot
        if (a) {
          g.bot.teleport('g', start[0], start[1]);
          g.bot.following = false;
          cam.glide(a.at[0], 0, a.at[1], a.zoom ?? cam.minZoom);
          cam.setZoom(a.zoom ?? cam.minZoom);
          cam.turnTo(a.yaw);
        } else if (spot === 'start') {
          g.bot.teleport('g', start[0], start[1]);
          g.bot.following = true;
          cam.turnTo(20);
        } else {
          let [lx, lz] = f.look === 'light' ? [0, 1] : f.look;
          if (f.look === 'light') {
            // toward the key light across the water (the sun, or by night the moon)
            const up = g.scene.sun.up;
            const l = Math.hypot(up.x, up.z) || 1;
            [lx, lz] = [up.x / l, up.z / l];
          }
          g.bot.teleport('g', f.at[0], f.at[1]);
          g.bot.pose.facing = Math.atan2(lx, lz);
          g.bot.following = true;
          let best = 0;
          let bestDot = -2;
          for (let y = 0; y < 360; y += 5) {
            cam.turnTo(y, true);
            cam.update(0.016);
            const fw = cam.entity.forward;
            const l = Math.hypot(fw.x, fw.z) || 1;
            const dot = (fw.x * lx + fw.z * lz) / (l * Math.hypot(lx, lz));
            if (dot > bestDot) [bestDot, best] = [dot, y];
          }
          cam.turnTo(best, true);
          if (f.pitch !== undefined && cam.explore) cam.pitchGoal = f.pitch;
        }
        for (let i = 0; i < 300; i++) cam.update(0.05);
        return { explore: cam.explore, pitch: cam.pitch, fov: cam.fov };
      },
      { spot, start, f: FOLLOW[spot], a: ABOVE[spot], zoom0 },
    );
  if (PERF) {
    await at(ALL.day);
    for (const spot of ['start', 'overview']) {
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
        await page.evaluate((p) => (window.solarbloom.camera.pitchGoal = p), pitch0);
        const cam = await place(spot);
        await page.waitForFunction(() => window.solarbloom.chunks.pending === 0, null, { timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.evaluate(() => window.solarbloom.look.snapMood());
        await page.waitForTimeout(2500);
        const file = `${dir}/${TAG}-${name}-${spot}.png`;
        await page.screenshot({ path: file });
        console.log(`  ${file}  (pitch ${cam.pitch.toFixed(1)}°, fov ${cam.fov.toFixed(0)}°${cam.explore ? '' : ', zoomed out'})`);
        if (STRIP)
          for (let i = 0; i < 6; i++) {
            await page.waitForTimeout(250);
            await page.screenshot({ path: `${dir}/${TAG}-${name}-${spot}-f${i}.png` });
          }
      }
    }
  if (errors.length) {
    failed = true;
    console.error('    ✗ page errors:\n' + [...new Set(errors)].slice(0, 8).join('\n'));
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
