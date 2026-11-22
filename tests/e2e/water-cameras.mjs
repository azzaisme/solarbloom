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
// Each shot is also checked for straight lines on the water (LINES): no seam across the moon path at night, and no
// hard band across the open sea from the zoomed-out view at any time.
// PERF=1 measures instead: frame time (median, mean, p95 over 8 s, vsync off) and draw calls on High at `start` and
// `overview` by day, printed as `perf …`. Alternate base and branch builds.
//   ONLY=day,night just these times;   SPOTS=light,opensea just these spots;   STRIP=1 also 6 frames 0.25 s apart
//   DIST=dist-base serve another build (a base, for before shots and perf)
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
/**
 * Straight lines on the water, measured in the shots (rect: x0, y0, x1, y1 in the 1920 × 1080 frame):
 *   seam  the moon path at night, sampled across where the first cut's value-noise lattice drew a hard vertical step
 *         (x 975): for each column, its mean step to the next, against the mean of the steps 3 columns either side.
 *         A seam is a spike there (17.8 on the first cut); the soft edges of the path and its slanted crests aren't.
 *   band  the open sea from the zoomed-out view, where the night's green ran out and clipped flat (y 370): each row's
 *         median colour, and how sharply that bends (second step, 6 rows apart, worst channel). A clip is a kink
 *         (16–17 at night before the grade's soft floor); fog and depth fade smoothly (7 or under at any time).
 */
const LINES = [
  { what: 'no seam across the moon path', kind: 'seam', spots: ['light'], times: ['night'], rect: [900, 430, 1080, 552], max: 5 },
  { what: 'no hard band across the sea', kind: 'band', spots: ['overview', 'opensea'], times: ['day', 'golden', 'night'], rect: [1150, 150, 1450, 420], max: 10 },
];
/** One straight-line measure (LINES) on a screenshot, decoded in the page. */
const straightLine = (page, png, c) =>
  page.evaluate(
    async ({ b64, kind, rect }) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const cx = cv.getContext('2d');
      cx.drawImage(bmp, 0, 0);
      const [x0, y0, x1, y1] = rect;
      const w = x1 - x0;
      const h = y1 - y0;
      const px = cx.getImageData(x0, y0, w, h).data;
      const at = (x, y, ch) => px[(y * w + x) * 4 + ch];
      if (kind === 'seam') {
        const d = [];
        for (let x = 0; x < w - 1; x++) {
          let s = 0;
          for (let y = 0; y < h; y++) for (let ch = 0; ch < 3; ch++) s += at(x + 1, y, ch) - at(x, y, ch);
          d.push(s / h);
        }
        let worst = 0;
        for (let i = 3; i < d.length - 3; i++) worst = Math.max(worst, Math.abs(d[i] - (d[i - 3] + d[i + 3]) / 2));
        return worst;
      }
      const med = [];
      for (let y = 0; y < h; y++) {
        const row = [];
        for (let ch = 0; ch < 3; ch++) {
          const v = [];
          for (let x = 0; x < w; x++) v.push(at(x, y, ch));
          v.sort((a, b) => a - b);
          row.push(v[w >> 1]);
        }
        med.push(row);
      }
      let worst = 0;
      for (let y = 6; y < h - 6; y++) for (let ch = 0; ch < 3; ch++) worst = Math.max(worst, Math.abs(med[y + 6][ch] - 2 * med[y][ch] + med[y - 6][ch]));
      return worst;
    },
    { b64: png.toString('base64'), kind: c.kind, rect: c.rect },
  );
const port = 4248;
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
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
        if (process.env.PRE)
          console.log(
            '  pre:',
            JSON.stringify(
              await page.evaluate((src) => {
                const g = window.solarbloom;
                const water = g.app.root.find((e) => e.render?.meshInstances?.[0]?.material?.name === "water")[0]?.render.meshInstances[0].material;
                return new Function('g', 'water', src)(g, water);
              }, process.env.PRE),
            ),
          );
        const file = `${dir}/${TAG}-${name}-${spot}.png`;
        const shot = await page.screenshot({ path: file });
        console.log(`  ${file}  (pitch ${cam.pitch.toFixed(1)}°, fov ${cam.fov.toFixed(0)}°${cam.explore ? '' : ', zoomed out'})`);
        for (const c of LINES.filter((c) => c.spots.includes(spot) && c.times.includes(name))) {
          const v = await straightLine(page, shot, c);
          const ok = v <= c.max;
          console.log(`    ${ok ? '✓' : '✗'} ${c.what}: ${v.toFixed(1)} (at most ${c.max})`);
          if (!ok) failed = true;
        }
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
