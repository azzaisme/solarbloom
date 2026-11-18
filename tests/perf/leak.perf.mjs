// City 15.3: chunk streaming memory and leak test.
// Pans back and forth across a large city and checks that scene entities, mesh instances, materials, GPU
// buffers (vertex/index memory) and the JS heap return to their baseline. Runs for LEAK_MINUTES (default 10)
// of wall time, headless with software rendering.
//
//   npm run test:leak                       (builds first)
//   LEAK_MINUTES=2 node tests/perf/leak.perf.mjs
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const MINUTES = Number(process.env.LEAK_MINUTES ?? 10);
const AREAS = Number(process.env.LEAK_AREAS ?? 120);
/** Allowed growth from the baseline (taken after the first full lap, once every kind of chunk has been seen). */
const LIMITS = {
  entities: 0.1, // +10%
  meshInstances: 0.1,
  materials: 0.1,
  vramPerChunk: 0.1, // GPU vertex+index memory per streamed chunk (the number on screen varies by position)
  heap: 0.25,
};

const server = await preview({ preview: { port: 4189, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'] });
const failures = [];
const T0 = Date.now();
const phase = (m) => console.log(`  … ${((Date.now() - T0) / 1000).toFixed(0)} s: ${m}`);

try {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4189/?slot=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  if (await page.locator('#introGo').isVisible()) await page.click('#introGo');

  // A large city to pan across (the soak's fast player).
  const extent = await page.evaluate((AREAS) => {
    const g = window.solarbloom;
    const s = g.sim;
    const st = s.state;
    st.caps.energy = new (st.resources.energy.constructor)(1e9); st.caps.water = new (st.resources.energy.constructor)(1e9);
    st.progression.coreActivated = true;
    s.areas.clear('park', true);
    for (let n = 1; n < AREAS; n++) {
      const id = s.areas.nextGoal();
      if (!id) break;
      const tiles = s.areas.tiles(id).filter((t) => !t.blocked && !t.occupantId && !s.isCoreTile(t));
      for (const t of tiles.slice(0, Math.ceil(tiles.length * 0.7))) {
        t.ground = 'restored';
        t.bloom = 1 + (t.variant % 3);
        t.pollution = 0;
        s.grid.touch(t);
      }
      s.areas.clear(id, true);
    }
    g.fillPlots(); // E19.1.5: every plot filled, so streaming plots in and out is part of the leak check
    g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
    let r = 0;
    for (const id of s.areas.revealed()) for (const [cx, cz] of s.areas.info(id).chunks) r = Math.max(r, Math.abs(cx * 16), Math.abs(cz * 16));
    return Math.min(r, 300);
  }, AREAS);
  phase(`city built (${AREAS} areas, extent ${extent} tiles)`);

  const sample = () =>
    page.evaluate(async () => {
      const g = window.solarbloom;
      if (window.gc) for (let i = 0; i < 3; i++) window.gc();
      await new Promise((r) => setTimeout(r, 50));
      let entities = 0;
      let meshInstances = 0;
      const materials = new Set();
      const walk = (e) => {
        entities++;
        if (e.render) for (const mi of e.render.meshInstances) {
          meshInstances++;
          materials.add(mi.material);
        }
        for (const c of e.children) walk(c);
      };
      walk(g.app.root);
      const v = g.app.graphicsDevice._vram;
      return {
        entities,
        meshInstances,
        materials: materials.size,
        vram: (v.vb ?? 0) + (v.ib ?? 0),
        vramPerChunk: Math.round(((v.vb ?? 0) + (v.ib ?? 0)) / Math.max(1, g.chunks.views.size)),
        heap: performance.memory?.usedJSHeapSize ?? 0,
        views: g.chunks.views.size,
      };
    });

  /** One lap: glide out to a far point and back to the park, frame by frame. */
  let lap = 0;
  const runLap = () =>
    page.evaluate(
      ({ extent, lap }) =>
        new Promise((resolve) => {
          const g = window.solarbloom;
          const ang = lap * 2.4; // a different direction every lap
          const steps = 50;
          let i = 0;
          const f = () => {
            const t = i <= steps ? i / steps : 2 - i / steps;
            g.camera.glide(8 + Math.cos(ang) * extent * t, 0, 8 + Math.sin(ang) * extent * t, i % 20 < 10 ? 0.6 : 0.9);
            if (++i > steps * 2) resolve();
            else requestAnimationFrame(f);
          };
          requestAnimationFrame(f);
        }),
      { extent, lap: lap++ },
    );

  // Look 6 (#180): every lap also sets every kind of transition going around the park (restore, bloom, soften,
  // moss, lush), so transition meshes are built and folded back again and again.
  const stir = () =>
    page.evaluate((lap) => {
      const g = window.solarbloom;
      const s = g.sim;
      if (!s.transitions) return;
      const kinds = ['restore', 'bloom', 'soften', 'moss'];
      for (let z = -6; z <= 22; z++)
        for (let x = -6; x <= 22; x++) {
          const t = s.grid.get('g', x, z);
          if (!t || t.blocked || t.occupantId || (x + z + lap) % 3) continue;
          const k = kinds[(x * 7 + z + lap) % 4];
          if (k === 'bloom' && t.ground === 'restored' && (x + lap) % 2) s.transitions.lush(t, s.time + 6);
          else s.transitions.begin(t, k, 2 + ((x + z) % 3), { from: k === 'bloom' ? 1 : 60, dir: 1 + ((x + z) & 3) });
          g.chunks.markTile(t);
        }
    }, lap);
  const runLapOnly = runLap;
  const runLapStirred = async () => {
    await stir();
    await runLapOnly();
  };

  // Warm-up: a few laps in different directions, then the baseline back at the park.
  for (let i = 0; i < 3; i++) await runLapStirred();
  const settle = () => page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n > 60 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  await settle();
  const base = await sample();
  phase(`baseline ${JSON.stringify(base)}`);

  const end = Date.now() + MINUTES * 60000;
  const history = [];
  while (Date.now() < end) {
    await runLapStirred();
    if (lap % 4 === 0) {
      await settle();
      const s = await sample();
      history.push(s);
      phase(`lap ${lap}: entities ${s.entities} · mesh instances ${s.meshInstances} · materials ${s.materials} · vram ${(s.vram / 1048576).toFixed(1)} MB · heap ${(s.heap / 1048576).toFixed(0)} MB · views ${s.views}`);
    }
  }
  await settle();
  const last = await sample();
  phase(`final ${JSON.stringify(last)}`);
  console.log(`laps ${lap} in ${MINUTES} min`);
  for (const k of Object.keys(LIMITS)) {
    if (!base[k]) continue;
    const growth = (last[k] - base[k]) / base[k];
    console.log(`  ${k.padEnd(14)} ${String(base[k]).padStart(12)} → ${String(last[k]).padStart(12)}  (${(growth * 100).toFixed(1)}%, limit +${LIMITS[k] * 100}%)`);
    if (growth > LIMITS[k]) failures.push(`${k} grew ${(growth * 100).toFixed(1)}% (${base[k]} → ${last[k]})`);
  }
  if (errors.length) failures.push(`page errors: ${errors.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
  server.httpServer.close();
}

if (failures.length) {
  for (const m of failures) console.error('  ✗', m);
  process.exit(1);
}
console.log('✓ no leaks: everything returned to its baseline');
