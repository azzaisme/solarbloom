// Phase 7 (The Living Landscape): fixed-camera reference shots and image metrics.
//   npm run build, then node tests/e2e/p7-shots.mjs [outDir]          (default docs/review/p7/<TAG>)
// Cameras (docs/VISUAL_ACCEPTANCE_TESTS.md):
//   A third     Bloombot's start, the follow (third-person) camera as the game opens it
//   B iso       the furthest zoom, high and looking down over the start, the canal and the bay
//   C shore     on the canal bank by the plank bridge, looking along the water past restored and ruined ground
// Stages (the ground round the spots):
//   early   a fresh game, nothing restored
//   mid     the start's area restored to full bloom (radius 8 round the start and the canal spot)
//   late    a wide stretch restored to full bloom (radius 20 round each spot, every area there cleared)
// Each shot is saved with and without the HUD (`-ui`), and metrics are printed and written to metrics.json:
// clipped world pixels (any channel ≥ 254, the top 22% of the frame skipped as sky), mean luminance, draw calls and
// triangles.   TAG=before|after (default after)   ONLY=day,golden,night (default day)   STAGES=early,mid,late
//   CAMS=third,iso,shore   NOUI=1 skips the HUD shots   DIST=dist-base serves another build
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';
import { gameUrl } from './lib/start-game.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const TAG = process.env.TAG ?? 'after';
const dir = process.argv[2] ?? `docs/review/p7/${TAG}`;
mkdirSync(dir, { recursive: true });
const ALL = { day: 0.3, golden: 0.6, night: 0.83 };
const TIMES = Object.fromEntries(Object.entries(ALL).filter(([k]) => (process.env.ONLY ?? 'day').split(',').includes(k)));
const STAGES = (process.env.STAGES ?? 'early,mid,late').split(',');
const CAMS = (process.env.CAMS ?? 'third,iso,shore').split(',');
const SHORE = { at: [-3.75, 30.5], look: [0, 1] };
const ISO = { at: [2, 30], yaw: 200 };
const port = +(process.env.PORT ?? 4251);
const server = await preview({ build: { outDir: process.env.DIST ?? 'dist' }, preview: { port, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const metrics = {};
let failed = false;
const measure = (page, png) =>
  page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d');
    cx.drawImage(bmp, 0, 0);
    const y0 = Math.floor(bmp.height * 0.22);
    const px = cx.getImageData(0, y0, bmp.width, bmp.height - y0).data;
    let clip = 0;
    let lum = 0;
    let sat = 0;
    const n = px.length / 4;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2];
      if (r >= 254 || g >= 254 || b >= 254) clip++;
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat += mx ? (mx - mn) / mx : 0;
    }
    return { clipPct: +((100 * clip) / n).toFixed(2), meanLum: +(lum / n).toFixed(1), meanSat: +(sat / n).toFixed(3) };
  }, png.toString('base64'));

try {
  for (const stage of STAGES) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.setDefaultTimeout(300_000);
    // Software GL renders the High tier at about 1 fps here, and chunks stream a few per frame, so loading would take
    // many minutes: rendering is paused while the world builds and resumed only to take each shot.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('sb.e2e.seeded')) return;
      sessionStorage.setItem('sb.e2e.seeded', '1');
      try { localStorage.clear(); } catch {}
    });
    await page.goto(gameUrl(`http://localhost:${port}`, { slot: 1, query: `gfx=${process.env.GFX ?? 'high'}` }), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.solarbloom?.app, null, { timeout: 240_000 });
    await page.evaluate(() => (window.solarbloom.app.autoRender = false));
    for (let i = 0; ; i++) {
      const st = await page.evaluate(() => {
        const g = window.solarbloom;
        g.app.autoRender = false;
        return { gone: !!(g.bot && document.querySelector('#loading')?.classList.contains('gone')), steps: g.loadSteps?.(), fps: g.app.stats.frame.fps };
      });
      if (st.gone) break;
      if (i % 6 === 5) console.log(`  loading ${stage}: ${JSON.stringify(st)}`);
      if (i > 120) throw new Error('the game never finished loading');
      await page.waitForTimeout(5000);
    }
    await page.evaluate(() => window.solarbloom.pause?.clear?.('blur'));
    await page.waitForTimeout(3000);
    const start = await page.evaluate(
      ({ stage, spots }) => {
        const g = window.solarbloom;
        const s = g.sim;
        const p = g.bot.pose;
        const here = [p.x, p.z];
        if (stage === 'early') return here;
        s.gates.open('g-saltwind', true);
        const r = stage === 'late' ? 20 : 8;
        for (const [cx, cz] of [[Math.floor(p.x), Math.floor(p.z)], ...spots]) {
          const seen = new Set();
          for (let dz = -r; dz <= r; dz += 4)
            for (let dx = -r; dx <= r; dx += 4) {
              const area = s.areas.areaOf({ roofId: 'g', x: cx + dx, z: cz + dz });
              if (!area || seen.has(area) || (stage === 'mid' && (dx || dz))) continue;
              seen.add(area);
              if (s.state.areas[area]) s.state.areas[area].sealed = false;
              s.areas.clear(area, true);
            }
          for (let dz = -r; dz <= r; dz++)
            for (let dx = -r; dx <= r; dx++) {
              if (dx * dx + dz * dz > r * r) continue;
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
      { stage, spots: [[Math.floor(SHORE.at[0]), Math.floor(SHORE.at[1])], [ISO.at[0], ISO.at[1]]] },
    );
    for (const [time, f] of Object.entries(TIMES)) {
      await page.evaluate((f) => {
        const s = window.solarbloom.sim;
        s.weather.forceForTest('sunny', 1e9);
        (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
        s.lights.dark = s.power.sky().dark;
      }, f);
      await page.waitForFunction(() => window.solarbloom.chunks.pending === 0, null, { timeout: 90_000 }).catch(() => {});
      await page.waitForTimeout(stage === 'early' ? 3000 : 12000);
      const zoom0 = await page.evaluate(() => window.solarbloom.camera.zoom);
      for (const cam of CAMS) {
        const info = await page.evaluate(
          ({ cam, start, shore, iso, zoom0 }) => {
            const g = window.solarbloom;
            const c = g.camera;
            if (cam === 'iso') {
              g.bot.teleport('g', start[0], start[1]);
              g.bot.following = false;
              c.glide(iso.at[0], 0, iso.at[1], c.minZoom);
              c.setZoom(c.minZoom);
              c.turnTo(iso.yaw);
            } else {
              c.setZoom(zoom0);
              if (cam === 'third') {
                g.bot.teleport('g', start[0], start[1]);
                g.bot.following = true;
                c.turnTo(20);
              } else {
                const [lx, lz] = shore.look;
                g.bot.teleport('g', shore.at[0], shore.at[1]);
                g.bot.pose.facing = Math.atan2(lx, lz);
                g.bot.following = true;
                let best = 0;
                let bestDot = -2;
                for (let y = 0; y < 360; y += 5) {
                  c.turnTo(y, true);
                  c.update(0.016);
                  const fw = c.entity.forward;
                  const l = Math.hypot(fw.x, fw.z) || 1;
                  const dot = (fw.x * lx + fw.z * lz) / l;
                  if (dot > bestDot) [bestDot, best] = [dot, y];
                }
                c.turnTo(best, true);
              }
            }
            for (let i = 0; i < 300; i++) c.update(0.05);
            return { pitch: c.pitch, fov: c.fov };
          },
          { cam, start, shore: SHORE, iso: ISO, zoom0 },
        );
        await page.waitForFunction(() => window.solarbloom.chunks.pending === 0, null, { timeout: 90_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.evaluate(() => window.solarbloom.look.snapMood());
        await page.evaluate(() => (window.solarbloom.app.autoRender = true));
        await page.waitForTimeout(+(process.env.RENDER_MS ?? 9000)); // a few real frames (shadows, SSAO, reflections)
        const name = `${stage}-${time}-${cam}`;
        if (!process.env.NOUI) await page.screenshot({ path: `${dir}/${name}-ui.png` });
        await page.addStyleTag({ content: '#hud, #res, #obj, #minimap, #prompt, #dock, .toast, #toasts { visibility: hidden !important; }' });
        await page.waitForTimeout(300);
        const shot = await page.screenshot({ path: `${dir}/${name}.png` });
        await page.evaluate(() => document.querySelectorAll('style').forEach((s) => s.textContent.includes('visibility: hidden !important') && s.remove()));
        const stats = await page.evaluate(() => {
          const st = window.solarbloom.app.stats;
          return { drawCalls: st.drawCalls?.total ?? 0, triangles: st.frame?.triangles ?? 0 };
        });
        await page.evaluate(() => (window.solarbloom.app.autoRender = false));
        const m = { ...(await measure(page, shot)), ...stats, pitch: +info.pitch.toFixed(1) };
        metrics[name] = m;
        console.log(`  ${name}: ${JSON.stringify(m)}`);
      }
    }
    if (errors.length) {
      failed = true;
      console.error(`  ✗ page errors (${stage}):\n` + [...new Set(errors)].slice(0, 6).join('\n'));
    }
    await page.close();
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  writeFileSync(`${dir}/metrics.json`, JSON.stringify(metrics, null, 2));
  await browser.close();
  server.httpServer.close();
}
console.log(failed ? 'FAILED' : 'all good');
process.exit(failed ? 1 : 0);
