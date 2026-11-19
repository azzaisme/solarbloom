// E23.8.3.3 (#453): performance with a very large mainland build, at the Deck preset (?gfx=deck).
// Builds a big save on the mainland in the page: the Great Bloom, ML_DISTRICTS districts restored outward from the
// causeway, and hundreds of machines placed through the real build path (grid batteries, panels,
// relays as the grid's poles, drone hubs with their drones, condensers, gardens). Reloads it the way a player would,
// at ?gfx=deck, then pans across it, zooms through every step and lets the sim run, recording frame time, the game's
// update time per frame, hitches and draw calls. Fails past the Deck budget. Headless SwiftShader, like the other perf
// runs (`npm run test:perf:mainland` builds and runs it).
//
//   node tests/perf/mainland.perf.mjs          (after `vite build`)
//   ML_DISTRICTS=20 ML_MACHINES=200 ...        (smaller, quicker)
//   PERF_JSON=out.json ...                     (also write the numbers)
//
// The grid (E23.3, `sim.power`) and water network (E23.4, `sim.water`) simulate these machines once they are on the
// branch: this run reports whether each was present, so the same test covers them as they land.
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

const DISTRICTS = Number(process.env.ML_DISTRICTS ?? 40);
const MACHINES = Number(process.env.ML_MACHINES ?? 400);
/**
 * The Deck budget. Draw calls: the same limit as the Old City's Deck check (tests/e2e/oldcity-drawcalls.e2e.mjs).
 * Update time and hitches: the city harness's gates (tests/perf/browser.perf.mjs), which measure the game's own JS
 * per frame (stable under software rendering, unlike wall time).
 */
const LIMITS = { loadMs: 15000, updateMedianMs: 20, hitchMs: 50, hitches: { pan: 8, zoom: 6, sim: 8 }, drawCalls: 450, simTickMs: 8 };

const PORT = Number(process.env.PORT ?? 4191);
const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
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
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.setDefaultTimeout(600_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = `http://localhost:${PORT}/?slot=1&gfx=deck`;
  await page.goto(url, { waitUntil: 'commit' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => !!window.solarbloom?.sim);
  phase('page ready');

  // 1. The big mainland build, through the game's own systems.
  results.build = await page.evaluate(({ DISTRICTS, MACHINES }) => {
    const g = window.solarbloom;
    const s = g.sim;
    const sv = s.state.salvage;
    sv.tier = 5;
    sv.abilities = ['pry', 'hover', 'climb', 'glide'];
    s.mainland.open();
    // restore districts outward from the landing, breadth first
    const land = s.areas.map.areaOfChunk(9, 0);
    const queue = [land];
    const done = [];
    while (queue.length && done.length < DISTRICTS) {
      const id = queue.shift();
      if (done.includes(id) || !id.startsWith('ml_')) continue;
      s.state.areas[id] ??= { fog: 'frontier', revealedAt: 0 };
      for (const t of s.areas.tiles(id)) {
        if (t.blocked || t.occupantId) continue;
        t.ground = 'restored';
        t.bloom = 1 + (t.variant % 3);
        t.pollution = 0;
        s.grid.touch(t);
      }
      s.areas.clear(id, true);
      done.push(id);
      for (const nb of s.areas.info(id).neighbours) if (nb.startsWith('ml_') && !done.includes(nb)) queue.push(nb);
    }
    // hundreds of machines, placed through BuildSystem (recipes paid, drones made, events fired)
    const mix = ['solar', 'solar', 'relay', 'gridBattery', 'droneHub', 'condenser', 'pollinator', 'solar', 'relay'];
    const RECIPE_FILL = 200;
    let placed = 0;
    const byType = {};
    const fails = {};
    outer: for (const id of done)
      for (const [cx, cz] of s.areas.info(id).chunks)
        for (let z = cz * 16 + 1; z < cz * 16 + 15; z += 3)
          for (let x = cx * 16 + 1; x < cx * 16 + 15; x += 3) {
            if (placed >= MACHINES) break outer;
            const type = mix[placed % mix.length];
            for (const m of ['scrap', 'seeds', 'copper', 'timber', 'glass', 'clay', 'gears', 'sunstone', 'steel']) s.inventory.add(m, RECIPE_FILL);
            s.state.resources.biomass = new s.state.resources.biomass.constructor(1e9);
            const c = s.build.check(type, 'g', x, z);
            if (!c.ok) {
              fails[c.reason] = (fails[c.reason] ?? 0) + 1;
              continue;
            }
            if (s.build.place(type, 'g', x, z)) {
              placed++;
              byType[type] = (byType[type] ?? 0) + 1;
            }
          }
    g.chunks.markAll();
    g.saver.save(s.state);
    return {
      districts: done.length,
      machines: s.state.machines.length,
      placed,
      byType,
      topFails: Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 3),
      drones: s.state.drones.length,
      power: !!s.power,
      water: !!s.water,
      wired: s.mainland.wired,
      bytes: localStorage.getItem('solarbloom.save')?.length ?? 0,
    };
  }, { DISTRICTS, MACHINES });
  phase(`built: ${JSON.stringify(results.build)}`);
  if (results.build.placed < MACHINES * 0.9) failures.push(`placed only ${results.build.placed} of ${MACHINES} machines (${JSON.stringify(results.build.topFails)})`);
  if (!results.build.byType.gridBattery) failures.push('no grid battery was built');

  // 2. Reload like a player coming back, at the Deck preset.
  const t0 = Date.now();
  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction((n) => !!window.solarbloom?.sim && window.solarbloom.sim.state.machines.length >= n, results.build.machines);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  results.loadMs = Date.now() - t0;
  results.deck = await page.evaluate(() => new URLSearchParams(location.search).get('gfx'));
  phase(`reloaded in ${results.loadMs} ms`);

  const measure = async (name, frames, drive) => {
    const r = await page.evaluate(
      ({ frames, drive }) =>
        new Promise((resolve) => {
          const g = window.solarbloom;
          const step = new Function('g', 'i', 'n', drive);
          const times = [];
          const draws = [];
          const cpu = [];
          let last = performance.now();
          let i = 0;
          const tick = () => {
            const now = performance.now();
            if (i > 0) {
              times.push(now - last);
              draws.push(g.app.stats.drawCalls.total);
              cpu.push(g.app.stats.frame.updateTime);
            }
            last = now;
            if (i >= frames) return resolve({ times, draws, cpu });
            step(g, i, frames);
            i++;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
      { frames, drive },
    );
    const c = stats(r.cpu);
    results[name] = { frames: r.times.length, wallMedian: stats(r.times).median, updateMedian: c.median, updateP95: c.p95, hitches: r.cpu.filter((t) => t > LIMITS.hitchMs).length, drawCalls: stats(r.draws).median, drawCallsWorst: stats(r.draws).worst };
    phase(`${name}: ${JSON.stringify(results[name])}`);
    const R = results[name];
    if (R.updateMedian > LIMITS.updateMedianMs) failures.push(`${name}: update median ${R.updateMedian.toFixed(1)} ms > ${LIMITS.updateMedianMs}`);
    if (R.hitches > LIMITS.hitches[name]) failures.push(`${name}: ${R.hitches} hitches > ${LIMITS.hitches[name]}`);
    if (R.drawCalls > LIMITS.drawCalls) failures.push(`${name}: ${R.drawCalls} draw calls (median) > ${LIMITS.drawCalls}`);
  };

  // 3. Pan a loop across the build at the middle zoom step, with the camera following a moving point.
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
    if (g.bot) g.bot.following = false;
  });
  const centre = await page.evaluate(() => {
    const ms = window.solarbloom.sim.state.machines.filter((m) => m.x >= 144);
    const x = ms.reduce((a, m) => a + m.x, 0) / Math.max(1, ms.length);
    const z = ms.reduce((a, m) => a + m.z, 0) / Math.max(1, ms.length);
    const r = Math.max(...ms.map((m) => Math.hypot(m.x - x, m.z - z)));
    return { x, z, r };
  });
  results.extent = centre;
  await measure('pan', 120, `const a = (i / n) * Math.PI * 2; const R = ${Math.round(centre.r * 0.7)}; g.camera.glide(${centre.x.toFixed(1)} + Math.cos(a) * R, 0, ${centre.z.toFixed(1)} + Math.sin(a) * R, 0.5); g.camera.update(1 / 60);`);
  // 4. Zoom through every step over the middle of the build.
  await measure('zoom', 90, `const k = i / n; const z = k < 0.5 ? 0.15 + k * 2 * 1.5 : 1.65 - (k - 0.5) * 2 * 1.5; g.camera.glide(${centre.x.toFixed(1)}, 0, ${centre.z.toFixed(1)}, z); g.camera.update(1 / 60);`);
  // 5. Let the world run: drones working, the grid and water network ticking (when present), chunks updating.
  await measure('sim', 120, `g.camera.glide(${centre.x.toFixed(1)}, 0, ${centre.z.toFixed(1)}, 0.6); g.camera.update(1 / 60);`);
  // 6. The sim alone: one game tick over the whole build, timed (the grid and water solve live here).
  results.simTick = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    const ts = [];
    for (let i = 0; i < 60; i++) {
      const t = performance.now();
      s.tick(0.1);
      ts.push(performance.now() - t);
    }
    ts.sort((a, b) => a - b);
    return { median: ts[30], worst: ts[59] };
  });
  phase(`sim tick: ${JSON.stringify(results.simTick)}`);
  if (results.simTick.median > LIMITS.simTickMs) failures.push(`sim tick median ${results.simTick.median.toFixed(1)} ms > ${LIMITS.simTickMs}`);
  if (results.loadMs > LIMITS.loadMs) failures.push(`reload took ${results.loadMs} ms > ${LIMITS.loadMs}`);
  if (results.deck !== 'deck') failures.push('not running at ?gfx=deck');
  if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
} catch (e) {
  failures.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  server.httpServer.close();
}
if (process.env.PERF_JSON) writeFileSync(process.env.PERF_JSON, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
if (failures.length) {
  console.log(`\n✗ mainland perf: ${failures.length} over budget\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\n✓ mainland perf: within the Deck budget');
process.exit(0);
