// City 15.2: browser performance harness.
// Builds a large city save in the page, reloads it the way a player would, then pans across it, zooms through
// every band and plays a ×500 chain, recording frame time, draw calls and hitches for each phase. Fails when a
// number regresses past its threshold. Runs headless with software rendering (SwiftShader), like CI.
//
//   npm run test:perf:browser          (builds first)
//   PERF_AREAS=60 node tests/perf/browser.perf.mjs   (smaller city, quicker)
//   PERF_JSON=out.json ...                            (also write the numbers to a file)
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
  hitches: { pan: 8, zoom: 6, chain: 8 },
  // Per frame, phase median: under 400 at every zoom (machines merge into per-region batches, ground is one
  // mesh per chunk). The chain phase's worst frames are the instant 800 gardens appear, before they batch.
  drawCalls: { pan: 400, zoom: 400, chain: 400 },
  chainMinCombo: CHAIN,
};

const server = await preview({ preview: { port: 4183, strictPort: true }, logLevel: 'silent' });
const url = 'http://localhost:4183/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (process.env.PERF_VERBOSE) await page.addInitScript(() => (window.__verbose = true));
  if (process.env.PERF_VERBOSE) page.on('console', (m) => console.log('   page:', m.text()));
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  if (await page.locator('#introGo').isVisible()) await page.click('#introGo');

  phase('page ready');
  // 1. Build a big city: the soak's fast player clears AREAS areas and builds a few machines in each.
  const built = await page.evaluate((AREAS) => {
    const g = window.solarbloom;
    const s = g.sim;
    const st = s.state;
    st.caps.energy = st.caps.water = st.caps.biomass = 1e9;
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
    g.saver.save(st);
    return { areas: n, machines: st.machines.length, bytes: localStorage.getItem('solarbloom.save')?.length ?? 0 };
  }, AREAS);
  results.city = built;

  phase('city built');
  // 2. Reload it like a player coming back.
  const t0 = Date.now();
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom && window.solarbloom.sim.state.machines.length > 50, null, { timeout: 60000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  results.loadMs = Date.now() - t0;
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
  const measure = (name, frames, drive) =>
    page.evaluate(
      ({ frames, drive }) =>
        new Promise((resolve) => {
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
            if (i % 20 === 0 && window.__verbose) console.log(`frame ${i} ${(now - last).toFixed(0)} ms`);
            if (i > 0) {
              if (g.app.stats.frame.updateTime > 50 && window.__verbose) console.log(`slow frame ${i}: update ${g.app.stats.frame.updateTime.toFixed(0)} render ${g.app.stats.frame.renderTime.toFixed(0)} views ${g.chunks.views.size}`);
              times.push(now - last);
              draws.push(g.app.stats.drawCalls.total);
              cpu.push(g.app.stats.frame.updateTime);
              render.push(g.app.stats.frame.renderTime);
            }
            last = now;
            if (i >= frames) return resolve({ times, draws, cpu, render });
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
    });

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
  // 5. A ×500 chain: a long green corridor of street gardens through the cleared city, set off by one pulse.
  const setup = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const st = s.state;
    st.resources.energy = st.resources.water = st.resources.biomass = 1e6;
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
  // Software frames are slow, so finish the chain in simulation time and read its final combo.
  results.chainCombo = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    for (let i = 0; i < 600 && s.chains.activeRuns > 0; i++) s.advance(0.1);
    return window.__chain.combo;
  });
  results.errors = errors;

  // Checks.
  const r = results;
  if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
  if (r.loadMs > LIMITS.loadMs) failures.push(`load ${r.loadMs} ms > ${LIMITS.loadMs}`);
  for (const k of ['pan', 'zoom', 'chain']) {
    if (r[k].updateMedian > LIMITS.updateMedianMs) failures.push(`${k} update median ${r[k].updateMedian.toFixed(1)} ms > ${LIMITS.updateMedianMs}`);
    if (r[k].hitches > LIMITS.hitches[k]) failures.push(`${k} hitches ${r[k].hitches} (update > ${LIMITS.hitchMs} ms) > ${LIMITS.hitches[k]}`);
  }
  for (const k of ['pan', 'zoom', 'chain']) if (r[k].drawCalls > LIMITS.drawCalls[k]) failures.push(`${k} draw calls ${r[k].drawCalls} > ${LIMITS.drawCalls[k]}`);
  if (r.chainCombo < LIMITS.chainMinCombo) failures.push(`chain reached ×${r.chainCombo} < ×${LIMITS.chainMinCombo}`);
} finally {
  await browser.close();
  server.httpServer.close();
}

const f = (x) => x.toFixed(1);
console.log(`city: ${results.city?.areas} areas, ${results.city?.machines} machines, save ${((results.city?.bytes ?? 0) / 1024).toFixed(0)} KB · reload ${results.loadMs} ms`);
for (const k of ['pan', 'zoom', 'chain']) {
  const r = results[k];
  if (r) console.log(`${k.padEnd(5)} ${r.frames} frames · update median ${f(r.updateMedian)} p95 ${f(r.updateP95)} worst ${f(r.updateWorst)} ms · hitches ${r.hitches} · draw calls ${r.drawCalls} (worst ${r.drawCallsWorst}) · render ${f(r.renderMedian)} ms · frame ${f(r.median)} ms`);
}
console.log(`chain: ×${results.chainCombo} along a ${results.chainSetup?.row.len}-tile corridor of ${results.chainSetup?.gardens} gardens`);
if (process.env.PERF_JSON) writeFileSync(process.env.PERF_JSON, JSON.stringify(results, null, 2));
if (failures.length) {
  for (const m of failures) console.error('  ✗', m);
  process.exit(1);
}
console.log('✓ browser perf within limits');
