// City 15.2: browser performance harness.
// Builds a large city save in the page, reloads it the way a player would, then pans across it, zooms through
// every band and plays a ×500 chain, recording frame time, draw calls and hitches for each phase. Fails when a
// number regresses past its threshold. Runs headless with software rendering (SwiftShader), like CI.
//
//   npm run test:perf:browser          (builds first)
//   PERF_AREAS=60 node tests/perf/browser.perf.mjs   (smaller city, quicker)
//   PERF_JSON=out.json ...                            (also write the numbers to a file)
//   PERF_PLOTS=0 ...                                  (E19.1.5: leave the city's plots empty; default fills every one)
//   PERF_TIERS=low,high ...                           (Look 1.11: graphics tiers to measure; default all three)
//   PERF_TIER=medium ...                              (the tier for the main pan / zoom / chain run; default high)
//   PERF_GPU=1 PERF_AREAS=1000 ...                    (City 15.4: a visible window on this machine's real GPU at
//                                                      1920×1080, for the device log; reports fps per phase.
//                                                      Uses installed Edge; PERF_CHANNEL=chrome for Chrome)
//
// Look 1.11: after the main run (on the High tier), the same city is reloaded at each graphics tier (?gfx=…) and
// panned and zoomed again, so every tier's frame time and draw calls are reported and checked.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const AREAS = Number(process.env.PERF_AREAS ?? 150);
const CHAIN = 500;
// A big save takes a while to load; the game being ready (not the page's load event) is what counts.
const READY_MS = Math.max(60000, AREAS * 150);

/**
 * Thresholds for software rendering on a CI runner (a GPU is many times faster). They catch regressions such
 * as lost batching, a per-frame world scan or a chunk-rebuild storm, not absolute device performance — real
 * devices are logged separately (City 15.4).
 */
const LIMITS = {
  loadMs: 8000, // reload → first frames with the big save
  // Game update per frame (sim, chunk streaming and mesh building, labels, VFX): pure JS, stable under
  // software rendering. Render submission and wall time are reported but not gated: with SwiftShader the GL
  // calls block on the software rasteriser, so they measure the runner, not the game.
  updateMedianMs: 20, // measured 12–15 ms on a 4-core cloud container
  hitchMs: 50, // a frame whose update crosses this is a hitch
  hitches: { pan: 8, zoom: 6, chain: 8, transitions: 8 },
  // Per frame, phase median: under 400 at every zoom (machines merge into per-region batches, ground is one
  // mesh per chunk). The chain phase's worst frames are the instant 800 gardens appear, before they batch.
  drawCalls: { pan: 400, zoom: 400, chain: 400, transitions: 400 },
  /**
   * Look 1.11: per graphics tier, phase median draw calls (pan and zoom), and the frame's wall time relative to
   * the Low tier in the same run. High adds the SSAO depth prepass (the scene drawn twice) and the post passes; Low
   * has no post. Absolute wall time under SwiftShader depends on the runner and on whatever else it is doing
   * (measured 370–610 ms per frame on a busy 2026 dev machine), so tiers are gated against each other instead.
   */
  tiers: {
    low: { drawCalls: 400, vsLow: 1 },
    medium: { drawCalls: 450, vsLow: 1.5 },
    high: { drawCalls: 800, vsLow: 2 },
  },
  chainMinCombo: CHAIN,
  saveStepMs: 16, // each main-thread step of an autosave (serialize, base64, storage write) fits in a frame
  catchUpSimMs: 16, // City 06.5: catching up 5 minutes away never spends more than this on simulation in one frame
  // Look 3.17: triangle budget for the heaviest loaded chunk (ground + props + foliage), High tier; Medium and
  // Low thin grass, flowers and clutter further (see docs/art/surfaces.md). Raised from 200k to 450k (#144, Nov
  // 2026) for the desktop target: leafy trees and dense beds (d2e3efc) put the heaviest chunk at 319k (real GPU,
  // 150 areas) to ~420k (a fully lush park, SwiftShader).
  chunkTris: 450000,
};

const PORT = Number(process.env.PORT ?? 4183);
// DIST: compare another build (e.g. the base branch's dist) on the same machine
const server = await preview({ preview: { port: PORT, strictPort: true }, build: process.env.DIST ? { outDir: process.env.DIST } : undefined, logLevel: 'silent' });
const MAIN_TIER = process.env.PERF_TIER ?? 'high';
const TIERS = (process.env.PERF_TIERS ?? 'low,medium,high').split(',').filter((t) => ['low', 'medium', 'high'].includes(t));
const url = `http://localhost:${PORT}/?slot=1&gfx=${MAIN_TIER}`;
// City 15.4: PERF_GPU runs a visible window on the real GPU (a headless or hidden window is throttled and may fall
// back to software), so frame times are a device measurement rather than a regression check.
const GPU = !!process.env.PERF_GPU;
const VIEWPORT = GPU ? { width: Number(process.env.PERF_W ?? 1920), height: Number(process.env.PERF_H ?? 1080) } : { width: 640, height: 400 };
const browser = await chromium.launch(
  GPU
    ? { headless: false, channel: process.env.PERF_CHANNEL ?? 'msedge', args: ['--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] }
    : { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
);
const failures = [];
const results = {};

const T0 = Date.now();
const phase = (m) => console.log(`  … ${((Date.now() - T0) / 1000).toFixed(0)} s: ${m}`);
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
  return { frames: s.length, median: q(0.5), p95: q(0.95), worst: s[s.length - 1] ?? 0 };
};

try {
  // A small viewport: SwiftShader's cost is per pixel, and the CPU-side numbers don't depend on size.
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = [];
  if (GPU) {
    results.device = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER), dpr: devicePixelRatio, cores: navigator.hardwareConcurrency };
    });
    console.log(`  GPU run: ${results.device.renderer} · ${VIEWPORT.width}×${VIEWPORT.height} @${results.device.dpr}x · ${results.device.cores} threads`);
    if (/swiftshader|software/i.test(results.device.renderer ?? '')) failures.push(`PERF_GPU fell back to software rendering (${results.device.renderer})`);
  }
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.PERF_VERBOSE) await page.addInitScript(() => (window.__verbose = true));
  if (process.env.PERF_PLOTS === '0') await page.addInitScript(() => (window.__plots = false));
  if (process.env.PERF_VERBOSE) page.on('console', (m) => console.log('   page:', m.text()));
  await page.goto(url, { waitUntil: 'commit' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => !!window.solarbloom, null, { timeout: READY_MS });
  if (await page.locator('#introGo').isVisible()) await page.click('#introGo');

  phase('page ready');
  // 1. Build a big city: the soak's fast player clears AREAS areas and builds a few machines in each.
  const built = await page.evaluate((AREAS) => {
    const g = window.solarbloom;
    const s = g.sim;
    const st = s.state;
    st.caps.energy = new (st.resources.energy.constructor)(1e9); st.caps.water = new (st.resources.energy.constructor)(1e9);
    st.progression.coreActivated = true;
    s.areas.clear('park', true);
    const insert = (type, t) => {
      if (!t || t.blocked || t.occupantId || s.isCoreTile(t)) return;
      const m = { id: s.newId('m'), type, roofId: 'g', x: t.x, z: t.z, size: 1, boostUntil: 0, timer: 0, charge: 0 };
      st.machines.push(m);
      s.grid.indexMachine(m);
      t.occupantId = m.id;
    };
    let n = 1;
    while (n < AREAS) {
      const id = s.areas.nextGoal();
      if (!id) break;
      const tiles = s.areas.tiles(id).filter((t) => !t.blocked && !t.occupantId && !s.isCoreTile(t) && t.ground !== 'restored');
      for (const t of tiles.slice(0, Math.ceil(tiles.length * 0.7))) {
        t.ground = 'restored';
        t.bloom = 1 + (t.variant % 3);
        t.pollution = 0;
        s.grid.touch(t);
      }
      if (!s.areas.clear(id, true)) break;
      n++;
      const spots = s.areas.tiles(id).filter((t) => !t.blocked && !t.occupantId && t.ground === 'restored');
      for (let i = 0; i < 4; i++) insert(['pollinator', 'solar', 'pollinator', 'solar'][i], spots[(i * 37) % Math.max(1, spots.length)]);
    }
    // E19.1.5: every plot in the city restored and filled (PERF_PLOTS=0 leaves them empty, for comparison)
    const plots = window.__plots === false ? 0 : g.fillPlots();
    g.saver.save(st);
    return { areas: n, machines: st.machines.length, plots, bytes: localStorage.getItem('solarbloom.save')?.length ?? 0 };
  }, AREAS);
  results.city = built;

  phase('city built');
  // 2. Reload it like a player coming back.
  const t0 = Date.now();
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => !!window.solarbloom && window.solarbloom.sim.state.machines.length > 50, null, { timeout: READY_MS });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  results.loadMs = Date.now() - t0;
  // Autosave with the big save loaded: the steps on the main thread, five saves, worst of each.
  results.autosave = await page.evaluate(async () => {
    const g = window.solarbloom;
    const worst = { serialize: 0, encode: 0, write: 0 };
    for (let i = 0; i < 5; i++) {
      const data = await g.saver.serializeCompressed(g.sim.state);
      g.saver.write(data);
      for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], g.saver.timings[k]);
      await new Promise((r) => setTimeout(r, 50));
    }
    return worst;
  });
  const loaded = await page.evaluate(() => ({ areas: Object.values(window.solarbloom.sim.state.areas).filter((a) => a.fog === 'cleared').length }));
  if (loaded.areas < built.areas) failures.push(`reload lost areas: ${loaded.areas}/${built.areas}`);

  phase('reloaded');
  if (process.env.PERF_VERBOSE)
    await page.evaluate(() => {
      // Per-method timing of the game's own update work, printed for slow frames.
      const g = window.solarbloom;
      window.__acc = new Map();
      const wrap = (obj, label) => {
        const proto = Object.getPrototypeOf(obj);
        for (const k of Object.getOwnPropertyNames(proto)) {
          const d = Object.getOwnPropertyDescriptor(proto, k);
          if (k === 'constructor' || !d || typeof d.value !== 'function') continue;
          const f = d.value;
          obj[k] = function (...a) {
            const t = performance.now();
            try {
              return f.apply(this, a);
            } finally {
              const key = `${label}.${k}`;
              window.__acc.set(key, (window.__acc.get(key) ?? 0) + performance.now() - t);
            }
          };
        }
      };
      wrap(g, 'game');
      wrap(g.chunks, 'chunks');
      wrap(g.sim, 'sim');
      if (g.machines) wrap(g.machines, 'machines');
      if (g.hud) wrap(g.hud, 'hud');
      g.app.on('frameend', () => {
        if (g.app.stats.frame.updateTime > 50) {
          const top = [...window.__acc].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v.toFixed(0)}`);
          console.log(`slow update ${g.app.stats.frame.updateTime.toFixed(0)} ms zoom ${g.camera.zoom.toFixed(2)}: ${top.join(' ')}`);
        }
        window.__acc.clear();
      });
    });

  /** Runs `drive(i)` every frame for `frames` frames and records frame times and draw calls. */
  const measure = async (name, frames, drive) => {
    // A visible window stops animation frames when it is minimized or covered: bring it forward, and fail loudly
    // rather than wait forever if frames still stop.
    if (GPU) await page.bringToFront();
    return page.evaluate(
      ({ frames, drive }) =>
        new Promise((resolve, reject) => {
          let lastFrameAt = performance.now();
          const watchdog = setInterval(() => {
            if (performance.now() - lastFrameAt > 10000) {
              clearInterval(watchdog);
              const hidden = document.visibilityState !== 'visible';
              reject(new Error(hidden ? 'no animation frame for 10 s: the page is hidden, keep the browser window visible' : `one frame blocked the main thread for over 10 s (frame ${i} of ${frames})`));
            }
          }, 1000);
          const g = window.solarbloom;
          const step = new Function('g', 'i', 'n', drive);
          const times = [];
          const draws = [];
          const cpu = [];
          const render = [];
          let last = performance.now();
          let i = 0;
          const tick = () => {
            const now = performance.now();
            lastFrameAt = now;
            if (i % 20 === 0 && window.__verbose) console.log(`frame ${i} ${(now - last).toFixed(0)} ms`);
            if (i > 0) {
              if (g.app.stats.frame.updateTime > 50 && window.__verbose) console.log(`slow frame ${i}: update ${g.app.stats.frame.updateTime.toFixed(0)} render ${g.app.stats.frame.renderTime.toFixed(0)} views ${g.chunks.views.size}`);
              times.push(now - last);
              draws.push(g.app.stats.drawCalls.total);
              cpu.push(g.app.stats.frame.updateTime);
              render.push(g.app.stats.frame.renderTime);
            }
            last = now;
            if (i >= frames) {
              clearInterval(watchdog);
              return resolve({ times, draws, cpu, render });
            }
            step(g, i, frames);
            i++;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      { frames, drive },
    ).then((r) => {
      const f = stats(r.times);
      const d = stats(r.draws);
      const c = stats(r.cpu);
      results[name] = {
        ...f,
        updateMedian: c.median,
        updateP95: c.p95,
        updateWorst: c.worst,
        renderMedian: stats(r.render).median,
        hitches: r.cpu.filter((t) => t > LIMITS.hitchMs).length,
        drawCalls: d.median,
        drawCallsWorst: d.worst,
      };
      return results[name];
    }).then(async (res) => {
      // Look 3.17: triangles in loaded chunks after the phase (ground + props, foliage; the heaviest chunk)
      results[name].detail = await page.evaluate(() => window.solarbloom.chunks.detailStats?.());
      return res;
    });
  };

  // 3. Pan across the whole city at mid zoom (a big loop through the cleared region).
  const extent = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    let r = 0;
    for (const id of s.areas.revealed()) for (const [cx, cz] of s.areas.info(id).chunks) r = Math.max(r, Math.abs(cx * 16), Math.abs(cz * 16));
    return Math.min(r, 400);
  });
  results.extentTiles = extent;
  await measure(
    'pan',
    120,
    `const a = (i / n) * Math.PI * 2; const R = ${Math.round(extent * 0.7)};
     g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
     g.camera.glide(Math.cos(a) * R * (i / n), 0, Math.sin(a) * R * (i / n), 0.7);`,
  );

  phase('panned');
  // 4. Zoom through every band, near to the far overview and back, over the park.
  await measure(
    'zoom',
    90,
    `const t = i / n; const z = t < 0.5 ? 1.8 - (1.8 - 0.22) * t * 2 : 0.22 + (1.8 - 0.22) * (t - 0.5) * 2;
     g.camera.glide(8, 0, 8, z);`,
  );

  phase('zoomed');
  results.tier = await page.evaluate(() => window.solarbloom.gfxTier ?? 'n/a');
  // Look 1.11: the same city at each graphics tier (pan and zoom), then back to the main tier for the rest.
  results.tiers = {};
  for (const tier of TIERS) {
    await page.goto(`http://localhost:${PORT}/?slot=1&gfx=${tier}`, { waitUntil: 'commit' });
    await page.waitForFunction(() => !!window.solarbloom && window.solarbloom.sim.state.machines.length > 50, null, { timeout: READY_MS });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
    const got = await page.evaluate(() => window.solarbloom.gfxTier ?? 'n/a');
    const pan = await measure(
      `pan-${tier}`,
      60,
      `const a = (i / n) * Math.PI * 2; const R = ${Math.round(extent * 0.5)};
       g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
       g.camera.glide(Math.cos(a) * R * (i / n), 0, Math.sin(a) * R * (i / n), 0.7);`,
    );
    const zoom = await measure(
      `zoom-${tier}`,
      60,
      `const t = i / n; const z = t < 0.5 ? 1.8 - (1.8 - 0.22) * t * 2 : 0.22 + (1.8 - 0.22) * (t - 0.5) * 2;
       g.camera.glide(8, 0, 8, z);`,
    );
    // Bloombot (G.18): the close default view, following bloombot as it is carried round the city.
    const close = await measure(
      `close-${tier}`,
      60,
      `const a = (i / n) * Math.PI * 2; const R = ${Math.round(extent * 0.5)};
       const x = Math.cos(a) * R * (i / n), z = Math.sin(a) * R * (i / n);
       if (g.bot) { g.bot.teleport('g', x, z); const w = g.bot.world(); g.camera.glide(w[0], 0, w[2], 3.2); }
       else g.camera.glide(x, 0, z, 1.8);`,
    );
    results.tiers[tier] = { applied: got, pan, zoom, close };
    delete results[`pan-${tier}`];
    delete results[`zoom-${tier}`];
    delete results[`close-${tier}`];
    phase(`tier ${tier} (${got}): frame ${pan.median.toFixed(0)} / ${zoom.median.toFixed(0)} ms, draw calls ${pan.drawCalls} / ${zoom.drawCalls}`);
  }
  if (TIERS.length) {
    await page.goto(url, { waitUntil: 'commit' });
    await page.waitForFunction(() => !!window.solarbloom && window.solarbloom.sim.state.machines.length > 50, null, { timeout: READY_MS });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1000)));
  }
  // 4b. Back after 5 minutes in another tab: the city catches up within the per-frame simulation budget.
  results.catchUp = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const g = window.solarbloom;
        const t0 = g.sim.time;
        g.simMsWorst = 0;
        g.awayFor(300);
        let frames = 0;
        const tick = () => {
          frames++;
          if (g.catchUpDebt > 0 && frames < 3000) return requestAnimationFrame(tick);
          resolve({ frames, simMsWorst: g.simMsWorst, simulated: g.sim.time - t0 });
        };
        requestAnimationFrame(tick);
      }),
  );
  phase(`caught up ${results.catchUp.simulated.toFixed(0)} s in ${results.catchUp.frames} frames`);
  // 5. A ×500 chain: a long green corridor of street gardens through the cleared city, set off by one pulse.
  const setup = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const st = s.state;
    st.resources.energy = new (st.resources.energy.constructor)(1e6); st.resources.water = new (st.resources.energy.constructor)(1e6); st.resources.biomass = new (st.resources.energy.constructor)(1e6);
    const cleared = new Set(s.areas.revealed().filter((id) => s.areas.fog(id) === 'cleared'));
    const ok = (x, z) => {
      const t = s.grid.get('g', x, z);
      return t && cleared.has(s.areas.areaOf(t)) ? t : undefined;
    };
    // The longest cleared row near the park.
    let best = { z: 6, from: 0, len: 0 };
    for (let z = -60; z <= 60; z += 3) {
      let from = null;
      for (let x = -300; x <= 300; x++) {
        if (ok(x, z)) {
          if (from === null) from = x;
          if (x - from > best.len) best = { z, from, len: x - from };
        } else from = null;
      }
    }
    // Make it dead again so the chain has work, then line it with gardens every 5 tiles (two rows deep).
    let gardens = 0;
    for (let x = best.from; x <= best.from + best.len; x++)
      for (let dz = -27; dz <= 27; dz++) {
        const t = ok(x, best.z + dz);
        if (!t || t.blocked || t.occupantId || s.isCoreTile(t)) continue;
        t.ground = 'polluted';
        t.bloom = 0;
        t.pollution = 1;
        s.grid.touch(t);
      }
    for (let x = best.from + 1; x <= best.from + best.len; x += 5)
      for (let dz = -25; dz <= 25; dz += 5) {
      const t = s.grid.get('g', x, best.z + dz);
      if (!ok(x, best.z + dz)) continue;
      if (!t) continue;
      t.blocked = false;
      t.feature = 'paving';
      if (t.occupantId) continue;
      const m = { id: s.newId('m'), type: 'pollinator', roofId: 'g', x, z: best.z + dz, size: 1, boostUntil: 0, timer: 0, charge: 0 };
      st.machines.push(m);
      s.grid.indexMachine(m);
      t.occupantId = m.id;
      s.bus.emit('machine.built', { machine: m });
      gardens++;
    }
    s.production.markDirty();
    window.__chain = { combo: 0 };
    s.bus.on('chain.ended', (e) => (window.__chain.combo = Math.max(window.__chain.combo, e.combo)));
    const start = s.grid.get('g', best.from, best.z);
    start.ground = 'polluted';
    start.occupantId = undefined;
    start.blocked = false;
    g.camera.glide(best.from + 20, 0, best.z, 0.6);
    s.restoration.complete(start, 'pulse');
    return { row: best, gardens };
  });
  phase('chain set up');
  results.chainSetup = setup;
  await measure('chain', 150, '');
  if (process.env.PERF_SHOT) await page.screenshot({ path: process.env.PERF_SHOT }); // mid-chain: per-area summary and wave front
  // Software frames are slow, so finish the chain in simulation time and read its final combo.
  results.chainCombo = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    for (let i = 0; i < 600 && s.chains.activeRuns > 0; i++) s.advance(0.1);
    return window.__chain.combo;
  });
  // 6. Look 6 (#180): the worst case for living transitions. The corridor dies again and a second ×500 chain runs
  // through it while an area-clear wave rolls, three Cultivators work and hundreds of tiles around the view soften,
  // turn to moss, bloom and soak at once — all through the transition framework (no tween or entity per tile).
  if (!process.env.PERF_NO_TRANSITIONS) {
    results.trSetup = await page.evaluate((row) => {
      const g = window.solarbloom;
      const s = g.sim;
      if (!s.transitions) return { skipped: true };
      const B = s.state.resources.energy.constructor;
      s.state.resources.energy = new B(1e6);
      s.state.caps.energy = new B(1e6);
      for (let x = row.from; x <= row.from + row.len; x++)
        for (let dz = -27; dz <= 27; dz++) {
          const t = s.grid.get('g', x, row.z + dz);
          if (!t || t.blocked || t.occupantId || s.isCoreTile(t)) continue;
          t.ground = 'polluted';
          t.bloom = 0;
          t.pollution = 1;
          s.grid.touch(t);
        }
      const cx = row.from + 20;
      const cz = row.z;
      // an area-clear wave near the view
      const area = s.areas.areaOf(s.grid.get('g', cx, cz + 30)) ?? s.areas.areaOf(s.grid.get('g', cx, cz));
      if (area) g.chunks.markArea(area, true);
      // three Cultivators, Wide Tines 2, on restored ground beside the corridor
      let cultivators = 0;
      for (let dz = 28; dz < 60 && cultivators < 3; dz += 2)
        for (let dx = 0; dx < 40 && cultivators < 3; dx += 7) {
          const t = s.grid.get('g', cx + dx, cz + dz);
          if (!t || t.blocked || t.occupantId) continue;
          t.ground = 'restored';
          t.bloom = Math.max(1, t.bloom);
          const m = { id: s.newId('m'), type: 'cultivator', roofId: 'g', x: t.x, z: t.z, size: 1, boostUntil: 0, timer: 0, charge: 0, upg: { cultWidth: 2, cultSecond: 1 } };
          s.state.machines.push(m);
          s.grid.indexMachine(m);
          t.occupantId = m.id;
          s.bus.emit('machine.built', { machine: m });
          cultivators++;
        }
      // everything else around the view mid-transition
      let n = 0;
      for (let z = cz - 40; z <= cz + 40; z++)
        for (let x = cx - 40; x <= cx + 40; x++) {
          const t = s.grid.get('g', x, z);
          if (!t || t.blocked || t.occupantId || (z >= cz - 27 && z <= cz + 27 && x >= row.from && x <= row.from + row.len)) continue;
          if (t.ground === 'restored') {
            if ((x + z) % 3 === 0) s.transitions.lush(t, s.time + 25);
            else s.transitions.begin(t, 'bloom', 5, { from: Math.max(1, t.bloom - 1) });
          } else if (t.ground === 'prepared') s.transitions.begin(t, 'moss', 6, { from: 40, dir: 1 + ((x + z) & 3) });
          else s.transitions.begin(t, 'soften', 3, { from: 100, dir: 1 + ((x + z) & 3) });
          n++;
        }
      g.chunks.markAll();
      const start = s.grid.get('g', row.from, row.z);
      start.occupantId = undefined;
      s.restoration.complete(start, 'pulse');
      g.camera.glide(cx, 0, cz, 0.9);
      return { tiles: n, cultivators, live: s.transitions.liveCount };
    }, results.chainSetup.row);
    phase('transitions set up');
    if (!results.trSetup.skipped) {
      await measure('transitions', 150, '');
      results.trCounts = await page.evaluate(() => {
        const g = window.solarbloom;
        let drawn = 0;
        for (const v of g.transitions.liveByChunk.values()) drawn += v;
        return { sim: g.sim.transitions.liveCount, drawn, cultivating: g.sim.cultivators.working().length };
      });
      if (process.env.PERF_SHOT) await page.screenshot({ path: process.env.PERF_SHOT.replace(/\.png$/, '-transitions.png') });
    }
  }
  results.errors = errors;

  // Checks.
  const r = results;
  if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  if (r.loadMs > LIMITS.loadMs) failures.push(`load ${r.loadMs} ms > ${LIMITS.loadMs}`);
  for (const [k, v] of Object.entries(r.autosave)) if (v > LIMITS.saveStepMs) failures.push(`autosave ${k} ${v.toFixed(1)} ms > ${LIMITS.saveStepMs}`);
  for (const k of ['pan', 'zoom', 'chain', 'transitions']) {
    if (!r[k]) continue;
    if (r[k].updateMedian > LIMITS.updateMedianMs) failures.push(`${k} update median ${r[k].updateMedian.toFixed(1)} ms > ${LIMITS.updateMedianMs}`);
    if (r[k].hitches > LIMITS.hitches[k]) failures.push(`${k} hitches ${r[k].hitches} (update > ${LIMITS.hitchMs} ms) > ${LIMITS.hitches[k]}`);
  }
  // The main run's draw-call limits are for Low-tier rendering (one scene pass); other tiers are checked below.
  const passScale = LIMITS.tiers[MAIN_TIER].drawCalls / LIMITS.tiers.low.drawCalls;
  for (const k of ['pan', 'zoom', 'chain', 'transitions']) if (r[k] && r[k].drawCalls > LIMITS.drawCalls[k] * passScale) failures.push(`${k} draw calls ${r[k].drawCalls} > ${Math.round(LIMITS.drawCalls[k] * passScale)}`);
  for (const [tier, t] of Object.entries(r.tiers ?? {})) {
    const L = LIMITS.tiers[tier];
    if (t.applied !== tier) failures.push(`tier ${tier}: the game applied ${t.applied}`);
    for (const k of ['pan', 'zoom', 'close']) {
      if (!t[k]) continue;
      if (t[k].drawCalls > L.drawCalls) failures.push(`tier ${tier} ${k} draw calls ${t[k].drawCalls} > ${L.drawCalls}`);
      const low = r.tiers.low?.[k]?.median;
      if (low && tier !== 'low' && t[k].median > low * L.vsLow) failures.push(`tier ${tier} ${k} frame ${t[k].median.toFixed(0)} ms > ${L.vsLow}× Low (${low.toFixed(0)} ms)`);
    }
  }
  for (const k of ['pan', 'zoom', 'chain']) if ((r[k].detail?.worstChunk ?? 0) > LIMITS.chunkTris) failures.push(`${k} heaviest chunk ${r[k].detail.worstChunk} triangles > ${LIMITS.chunkTris}`);
  if (r.catchUp.simMsWorst > LIMITS.catchUpSimMs) failures.push(`catch-up spent ${r.catchUp.simMsWorst.toFixed(1)} ms of simulation in one frame > ${LIMITS.catchUpSimMs}`);
  if (r.catchUp.simulated < 299) failures.push(`catch-up simulated only ${r.catchUp.simulated.toFixed(0)} s of 300`);
  if (r.chainCombo < LIMITS.chainMinCombo) failures.push(`chain reached ×${r.chainCombo} < ×${LIMITS.chainMinCombo}`);
} finally {
  await browser.close();
  server.httpServer.close();
}

const f = (x) => x.toFixed(1);
console.log(`city: ${results.city?.areas} areas, ${results.city?.machines} machines, ${results.city?.plots ?? 0} plots filled, save ${((results.city?.bytes ?? 0) / 1024).toFixed(0)} KB · reload ${results.loadMs} ms`);
for (const k of ['pan', 'zoom', 'chain', 'transitions']) {
  const r = results[k];
  if (r?.detail) console.log(`      triangles: ${(r.detail.ground / 1e3).toFixed(0)}K ground+props · ${(r.detail.foliage / 1e3).toFixed(0)}K foliage in ${r.detail.chunks} chunks · heaviest chunk ${(r.detail.worstChunk / 1e3).toFixed(0)}K (${r.detail.tier}, band ${r.detail.band})`);
  if (r) console.log(`${k.padEnd(5)} ${r.frames} frames · update median ${f(r.updateMedian)} p95 ${f(r.updateP95)} worst ${f(r.updateWorst)} ms · hitches ${r.hitches} · draw calls ${r.drawCalls} (worst ${r.drawCallsWorst}) · render ${f(r.renderMedian)} ms · frame ${f(r.median)} ms`);
  if (r && GPU) console.log(`      fps: median ${(1000 / r.median).toFixed(0)} · p95 frame ${f(r.p95)} ms (${(1000 / r.p95).toFixed(0)} fps) · worst frame ${f(r.worst)} ms`);
}
if (results.catchUp) console.log(`catch-up: 300 s away → ${results.catchUp.simulated.toFixed(0)} s simulated over ${results.catchUp.frames} frames · worst frame ${f(results.catchUp.simMsWorst)} ms of simulation`);
if (results.autosave) console.log(`autosave (main thread, worst of 5): serialize ${f(results.autosave.serialize)} ms · base64 ${f(results.autosave.encode)} ms · write ${f(results.autosave.write)} ms`);
console.log(`chain: ×${results.chainCombo} along a ${results.chainSetup?.row.len}-tile corridor of ${results.chainSetup?.gardens} gardens`);
if (results.trSetup && !results.trSetup.skipped) console.log(`transitions (Look 6): a second ×500 chain + an area wave + ${results.trSetup.cultivators} Cultivators + ${results.trSetup.tiles} tiles set mid-transition (${results.trSetup.live} live in the sim at the start; ${results.trCounts?.sim} live, ${results.trCounts?.drawn} drawn as transitions after 150 frames)`);
for (const [tier, t] of Object.entries(results.tiers ?? {}))
  console.log(`tier ${tier.padEnd(6)} pan frame ${f(t.pan.median)} ms · draw calls ${t.pan.drawCalls} · update ${f(t.pan.updateMedian)} ms · render ${f(t.pan.renderMedian)} ms | zoom frame ${f(t.zoom.median)} ms · draw calls ${t.zoom.drawCalls} (worst ${t.zoom.drawCallsWorst})${t.close ? ` | close view (bloombot) frame ${f(t.close.median)} ms · draw calls ${t.close.drawCalls} (worst ${t.close.drawCallsWorst})` : ''}`);
if (GPU) for (const [tier, t] of Object.entries(results.tiers ?? {})) console.log(`tier ${tier.padEnd(6)} fps: pan ${(1000 / t.pan.median).toFixed(0)} (p95 ${(1000 / t.pan.p95).toFixed(0)}, worst frame ${f(t.pan.worst)} ms) · zoom ${(1000 / t.zoom.median).toFixed(0)} (p95 ${(1000 / t.zoom.p95).toFixed(0)}, worst frame ${f(t.zoom.worst)} ms)`);
console.log(GPU ? `(visible Chromium on ${results.device?.renderer}: a device measurement for PROGRESS.md)` : '(headless Chromium with SwiftShader software rendering: compare tiers and builds, not devices)');
if (process.env.PERF_JSON) writeFileSync(process.env.PERF_JSON, JSON.stringify(results, null, 2));
if (failures.length) {
  for (const m of failures) console.error('  ✗', m);
  process.exit(1);
}
console.log('✓ browser perf within limits');
