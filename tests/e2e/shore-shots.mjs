// E28.W02 (#695): where the land meets the water, from the follow camera and the zoomed-out view, at day, golden hour
// and night, on High at 1920 × 1080, into docs/review/e28-695/ (or argv[2]).
//   npm run build, then GPU=1 node tests/e2e/shore-shots.mjs [outDir]
// Run it on the base build with TAG=before and on the branch (TAG=after, the default): the spots and the camera match.
// The ground round each spot is restored to full bloom first (the banks at their richest), its area cleared.
// Spots:
//   island    follow camera at the start, looking back over the restored island and the shallows (W01's "shore")
//   overview  the zoomed-out view over the start, the island and the sea (W01's "overview")
//   surf      Saltwind's surf line, a rounded tip of the beach (#687's spot)
//   sandbar   a corner of the sandbar island out in the sea
//   canal     the canal bank
//   pond      the Cistern's pond
// Times: day (noon), golden (late afternoon) and night (midnight).
// PERF=1 measures instead of shooting: frame time (median, mean, p95 over 8 s, vsync off) and draw calls on High, at
// the island spot and the overview by day, printed as `perf …`. Run it on base and branch alternately (timing on this
// machine swings a lot).
//   ONLY=day,night just these times;   SPOTS=surf,pond just these spots
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { startGame } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/e28-695';
mkdirSync(dir, { recursive: true });
const TAG = process.env.TAG ?? 'after';
const ALL = { day: 0.3, golden: 0.6, night: 0.83 };
const TIMES = process.env.ONLY ? Object.fromEntries(Object.entries(ALL).filter(([k]) => process.env.ONLY.split(',').includes(k))) : ALL;
const SPOTS = (process.env.SPOTS ?? 'island,overview,surf,sandbar,canal,pond').split(',');
const PERF = !!process.env.PERF;
/** the close spots: the edge tile (or, for the pond, where to search for the nearest bank) */
const EDGES = { surf: [0, 41], sandbar: [10, 56], canal: [-4, 24], pond: [63, 44, true] };
/** spots shot looking along the bank (Bloombot on the edge tile, the shore running across the frame), not out over it */
const ALONG = { canal: Number(process.env.CANAL_YAW ?? -60), pond: Number(process.env.POND_YAW ?? 60) };
const port = 4246;
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
  // restore round each close spot once, up front, so every time of day sees the same grown banks
  const edgeAt = {};
  for (const [name, [tx, tz, nearLand]] of Object.entries(EDGES)) {
    if (!SPOTS.includes(name)) continue;
    edgeAt[name] = await page.evaluate(
      ({ tx, tz, nearLand }) => {
        const g = window.solarbloom;
        const s = g.sim;
        const peek = (x, z) => s.grid.peek('g', x, z);
        const wet = (t) => !t || t.feature === 'water';
        let edge = peek(tx, tz);
        if (nearLand) {
          let best;
          for (let dz = -6; dz <= 6; dz++)
            for (let dx = -6; dx <= 6; dx++) {
              const t = peek(tx + dx, tz + dz);
              if (!t || wet(t) || t.blocked || t.ramp) continue;
              if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => wet(peek(t.x + a, t.z + b)))) continue;
              const d = dx * dx + dz * dz;
              if (!best || d < best.d) best = { t, d };
            }
          edge = best?.t;
        }
        if (!edge) return undefined;
        let ox = 0;
        let oz = 0;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
          if (wet(peek(edge.x + a, edge.z + b))) {
            ox += a;
            oz += b;
          }
        const len = Math.hypot(ox, oz) || 1;
        const area = s.areas.areaOf({ roofId: 'g', x: edge.x, z: edge.z });
        if (area && s.state.areas[area]) s.state.areas[area].sealed = false;
        if (area) s.areas.clear(area, true);
        for (let dz = -6; dz <= 6; dz++)
          for (let dx = -6; dx <= 6; dx++) {
            const t = peek(edge.x + dx, edge.z + dz);
            if (!t || t.feature === 'water' || t.blocked || t.occupantId || t.ramp) continue;
            t.ground = 'restored';
            t.bloom = 4;
            t.pollution = 0;
            g.chunks.markTile(t);
          }
        return { x: edge.x, z: edge.z, ox: ox / len, oz: oz / len };
      },
      { tx, tz, nearLand: !!nearLand },
    );
    if (!edgeAt[name]) {
      failed = true;
      console.error(`    ✗ ${name}: no edge tile`);
    }
  }
  await page.waitForFunction(() => window.solarbloom.chunks.pending === 0, null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(12000); // restored ground grows in
  const place = (spot) =>
    page.evaluate(
      ({ spot, start, e, along }) => {
        const g = window.solarbloom;
        const [x, z] = start;
        if (spot === 'overview') {
          g.bot.teleport('g', x, z);
          g.bot.following = false;
          g.camera.glide(x - 4, 0, z - 6, g.camera.minZoom);
          g.camera.setZoom(g.camera.minZoom);
          g.camera.turnTo(200);
        } else if (spot === 'island') {
          g.bot.teleport('g', x, z);
          g.bot.following = true;
          g.camera.turnTo(20);
        } else {
          // Bloombot just back from the edge, the camera looking past it at the water
          const peek = (a, b) => g.sim.grid.peek('g', a, b);
          let bx = e.x + 0.5 - e.ox * (along !== undefined ? 0.1 : 1.2);
          let bz = e.z + 0.5 - e.oz * (along !== undefined ? 0.1 : 1.2);
          const back = peek(Math.floor(bx), Math.floor(bz));
          if (!back || back.feature === 'water') [bx, bz] = [e.x + 0.5, e.z + 0.5];
          g.bot.teleport('g', bx, bz);
          g.bot.pose.facing = Math.atan2(e.ox, e.oz);
          g.bot.following = true;
          let best = 0;
          let bestDot = -2;
          for (let y = 0; y < 360; y += 5) {
            g.camera.turnTo(y, true);
            g.camera.update(0.016);
            const f = g.camera.entity.forward;
            const l = Math.hypot(f.x, f.z) || 1;
            const dot = (f.x * e.ox + f.z * e.oz) / l;
            if (dot > bestDot) [bestDot, best] = [dot, y];
          }
          g.camera.turnTo(best + (along ?? 0), true);
        }
        for (let i = 0; i < 300; i++) g.camera.update(0.05);
      },
      { spot, start, e: edgeAt[spot], along: ALONG[spot] },
    );
  if (PERF) {
    await at(ALL.day);
    for (const spot of ['island', 'overview']) {
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
        if (EDGES[spot] && !edgeAt[spot]) continue;
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
