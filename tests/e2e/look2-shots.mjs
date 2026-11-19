// Look 2: palette shots, HUD hidden, deterministic (seeded Math.random, Playwright fake clock), for measuring colour
// coverage (tests/art/coverage.py) and colour-blind checks (tests/art/cvd.py). Follows Look 1's shots:look harness.
//
//   vite build && node tests/e2e/look2-shots.mjs [outDir]      (default docs/review/look2/current)
//   LOOK_SCENES=full,states node tests/e2e/look2-shots.mjs …   (a subset)
//   LOOK_QUERY='gfx=high' …                                    (page query; Look 1's tiers once merged)
//
// Scenes: dead park; fully restored park (bloom stages mixed, as Look 1's "full"); full bloom (every tile Radiant);
// tile states (a row of blocks: dead, prepared, growing, restored 1–4, with the fogged neighbour area behind).
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/look2/current';
mkdirSync(out, { recursive: true });
const PORT = 4217;
const query = process.env.LOOK_QUERY ? `?${process.env.LOOK_QUERY}` : '';
const FRAME = 1000 / 60;

const restoreAll = (bloom) => `
  const s = g.sim;
  for (const t of s.areas.tiles('park')) {
    if (!s.restoration.isEligible(t)) continue;
    s.restoration.complete(t, 'pulse');
    t.bloom = ${bloom};
    s.grid.touch(t);
  }
  s.state.progression.coreActivated = true;
  s.areas.clear('park', true);
  g.chunks.markAll();`;

const SCENES = {
  dead: { setup: `g.camera.glide(8, 0, 8, 1); return {};`, settle: 1500 },
  full: { setup: `${restoreAll('1 + ((t.x * 3 + t.z * 5) % 4)')} g.camera.glide(8, 0, 8, 1); return {};`, settle: 3000 },
  bloom: { setup: `${restoreAll('4')} g.camera.glide(8, 0, 8, 1); return {};`, settle: 3000 },
  states: {
    // Blocks of 2×3 lawn tiles, left to right: dead, prepared, growing, restored stage 1, 2, 3, 4 (the strip with
    // the most plain lawn is chosen), and a pollinator beside it whose zone shows the boosted-tile glow.
    setup: `
      const s = g.sim;
      const tiles = s.areas.tiles('park');
      const at = (x, z) => tiles.find((t) => t.x === x && t.z === z);
      const plain = (t) => t && !t.blocked && !t.occupantId && (t.feature ?? 'lawn') === 'lawn';
      let best = [-1, 1, 11];
      for (let z0 = 3; z0 < 16; z0++) for (let x0 = 2; x0 < 9; x0++) {
        let n = 0;
        for (let dx = 0; dx < 14; dx++) for (let dz = 0; dz < 3; dz++) if (plain(at(x0 + dx, z0 + dz))) n++;
        if (n > best[0]) best = [n, x0, z0];
      }
      const [, x0, z0] = best;
      const states = [['polluted', 0], ['prepared', 0], ['growing', 0], ['restored', 1], ['restored', 2], ['restored', 3], ['restored', 4]];
      let n = 0;
      states.forEach(([ground, bloom], i) => {
        for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 3; dz++) {
          const t = at(x0 + i * 2 + dx, z0 + dz);
          if (!t || t.blocked || t.occupantId) continue;
          if (ground === 'restored') s.restoration.complete(t, 'pulse');
          t.ground = ground; t.bloom = bloom; t.pollution = ground === 'polluted' ? 90 : 0;
          s.grid.touch(t); n++;
        }
      });
      s.areas.clear('park', true);
      const st = s.state;
      for (const m of ['scrap','seeds','copper','timber','glass','clay','gears','sunstone','biomass','food']) st.salvage.pack[m] = 999; // E23.1.4: a full backpack (no counters)
      // the pollinator stands just below the Blooming block, on restored ground
      const px = x0 + 8, pz = z0 + 3;
      for (let dx = -1; dx <= 2; dx++) for (let dz = 0; dz <= 2; dz++) { const t = at(px + dx, pz + dz); if (t && !t.blocked && !t.occupantId) { s.restoration.complete(t, 'pulse'); t.bloom = 2; s.grid.touch(t); } }
      const chk = s.build.check('pollinator', 'g', px, pz);
      const placed = chk.ok && !!s.build.place('pollinator', 'g', px, pz);
      window.__blocks = states.map(([ground, bloom], i) => ({ name: ground === 'restored' ? 'bloom' + bloom : ground === 'polluted' ? 'dead' : ground, x: x0 + i * 2 + 1, z: z0 + 1.5 }));
      g.chunks.markAll();
      g.camera.glide(x0 + 7, 0, z0 + 2, 1.5);
      return { n, x0, z0, lawn: best[0], placed, why: chk.reason };`,
    settle: 2500,
    // Screen positions of each block centre (and the boosted tiles), for tests/art/cvd.py.
    probe: `(() => {
      const v = g.camera.entity.getPosition().clone();
      const at = (x, z) => { const p = g.camera.toScreen(v.set(x, 0.1, z)); return [Math.round(p.x), Math.round(p.y)]; };
      const out = Object.fromEntries(window.__blocks.map((b) => [b.name, at(b.x, b.z)]));
      const boosted = g.tileFx.boostedTiles ? g.tileFx.boostedTiles().find((t) => t.ground === 'restored') : undefined;
      if (boosted) out.boosted = at(boosted.x + 0.5, boosted.z + 0.5);
      return out;
    })()`,
  },
};

const pick = (env, all) => (env ? env.split(',').filter((k) => all[k]) : Object.keys(all));
const SEED_SCRIPT = `(() => { let a = 0x5eed1e5; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const key of pick(process.env.LOOK_SCENES, SCENES)) {
  const scene = SCENES[key];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${key}: ${e.message}`));
  await page.addInitScript(SEED_SCRIPT);
  await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await page.clock.install({ time: new Date('2026-06-21T16:30:00') });
  await page.clock.pauseAt(new Date('2026-06-21T16:31:00')); // headroom: the clock runs from install until paused
  await page.goto(`http://localhost:${PORT}/${query ? query + '&' : '?'}slot=1`, { timeout: 180000 });
  let booted = false;
  for (let i = 0; i < 300 && !booted; i++) {
    booted = await page.evaluate(() => !!window.solarbloom);
    if (!booted) await new Promise((r) => setTimeout(r, 100));
  }
  if (!booted) throw new Error(`${key}: game did not boot`);
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: '#hud, #toasts, .toast, #intro, #boot, #tip, .tip, #labels, .area-label { display: none !important; }' });
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
  const render = (on) => page.evaluate((on) => (window.solarbloom.app.autoRender = on), on);
  await render(false);
  await page.clock.runFor(500);
  const state = await page.evaluate(`(() => { const g = window.solarbloom; ${scene.setup} })()`);
  if (process.env.LOOK_EVAL) await page.evaluate(`(() => { const g = window.solarbloom; ${process.env.LOOK_EVAL} })()`);
  await page.clock.runFor(scene.settle);
  await page.evaluate(() => {
    const app = window.solarbloom.app;
    const gl = app.graphicsDevice.gl;
    const px = new Uint8Array(4);
    app.on('frameend', () => gl && gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px));
  });
  await render(true);
  await page.clock.runFor(12 * FRAME);
  writeFileSync(`${out}/${key}.png`, await page.screenshot({ type: 'png' }));
  if (scene.probe) writeFileSync(`${out}/${key}.json`, JSON.stringify(await page.evaluate(`(() => { const g = window.solarbloom; return ${scene.probe}; })()`), null, 1));
  console.log(key, JSON.stringify(state));
  await ctx.close();
}
await browser.close();
server.httpServer.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
