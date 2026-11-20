// Phase 6 baseline (E18 audit): the park at desktop sizes, HUD visible, next to the Phase 6 target
// (docs/reference/target-park-phase6.png). Real clock (the paused fake clock in look-shots.mjs makes Playwright's
// screenshot wait forever in some containers), so shots are close but not pixel-identical run to run.
//
//   npm run build && node tests/e2e/phase6-baseline.mjs [folder]   → docs/review/<folder>/ (default phase6-baseline)
//   P6_SCENES=dead,full P6_SIZES=1080p …                           (a subset)
//   P6_QUERY='gfx=medium' …                                        (page query; default gfx=high)
//   P6_RAW=1 …                                                     (also keep the raw PNGs)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = `docs/review/${process.argv[2] ?? 'phase6-baseline'}`;
mkdirSync(out, { recursive: true });
const PORT = 4219;
const query = `?${process.env.P6_QUERY ?? 'gfx=high'}`;

const SIZES = {
  '1080p': { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
};

const restoreAll = `
  const s = g.sim;
  for (const t of s.areas.tiles('park')) {
    if (!s.restoration.isEligible(t)) continue;
    // Set the restored state directly (no restore event), so no Look 6 restore animation starts: SwiftShader is too
    // slow to play them out, and half-played ones leave soil patches in the shot.
    t.ground = 'restored'; t.pollution = 0; t.tr = undefined;
    t.bloom = 1 + ((t.x * 3 + t.z * 5) % 4);
    s.grid.touch(t);
  }
  s.state.progression.coreActivated = true;
  s.areas.clear('park', true);
  g.chunks.markAll();`;

const SCENES = {
  dead: { title: 'Dead park, default zoom', setup: `g.camera.glide(8, 0, 8, 1);`, wait: 4000 },
  half: {
    title: 'Half-restored park',
    setup: `
      const s = g.sim;
      const tiles = s.areas.tiles('park').filter((t) => !t.blocked && !t.occupantId && t.ground !== 'restored');
      tiles.sort((a, b) => Math.hypot(a.x - 3, a.z - 3) - Math.hypot(b.x - 3, b.z - 3));
      tiles.slice(0, Math.floor(tiles.length / 2)).forEach((t) => { t.ground = 'restored'; t.bloom = 1 + ((t.x * 3 + t.z * 5) % 3); t.pollution = 0; s.grid.touch(t); });
      g.chunks.markAll();
      g.camera.glide(8, 0, 8, 1);`,
    wait: 5000,
  },
  full: { title: 'Restored park, fountain awake, default zoom', setup: `${restoreAll} g.camera.glide(8, 0, 8, 1);`, wait: 18000 },
  whole: { title: 'Restored park framed whole (target framing)', setup: `${restoreAll} g.camera.glide(8, 0, 8, 0.7);`, wait: 18000 },
  close: { title: 'Fountain close-up', setup: `${restoreAll} g.camera.glide(8, 0, 8, 1.7);`, wait: 18000 },
};

const pick = (env, all) => (env ? env.split(',').filter((k) => all[k]) : Object.keys(all));
const sceneKeys = pick(process.env.P6_SCENES, SCENES);
const sizeKeys = pick(process.env.P6_SIZES, SIZES);

const server = await preview({ preview: { port: PORT, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const target = `data:image/png;base64,${readFileSync('docs/reference/target-park-phase6.png').toString('base64')}`;
const metrics = { query, renderer: 'headless Chromium, SwiftShader (software GL)', when: new Date().toISOString(), shots: {} };
const errors = [];

async function shoot(sceneKey, sizeKey) {
  const scene = SCENES[sceneKey];
  const size = SIZES[sizeKey];
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${sceneKey}/${sizeKey}: ${e.message}`));
  await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  await page.goto(`http://localhost:${PORT}/${query ? query + '&' : '?'}slot=1`);
  await page.waitForFunction(() => !!window.solarbloom, null, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
  await page.evaluate(`(() => { const g = window.solarbloom; ${scene.setup} })()`);
  await page.waitForTimeout(scene.wait);
  const stats = await page.evaluate(() => {
    const g = window.solarbloom;
    return { drawCalls: g.app.stats.drawCalls.total, triangles: g.app.stats.frame.triangles, tier: g.gfxTier ?? 'n/a', fps: +g.app.stats.frame.fps.toFixed(1) };
  });
  const png = await page.screenshot({ type: 'png', timeout: 120000 });
  const name = `${sceneKey}-${sizeKey}`;
  if (process.env.P6_RAW) writeFileSync(`${out}/${name}.png`, png);
  const side = await page.evaluate(
    async ({ shot, target, title }) => {
      const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
      const [a, b] = await Promise.all([load(shot), load(target)]);
      const H = 720, bar = 40;
      const wa = Math.round((a.width / a.height) * H), wb = Math.round((b.width / b.height) * H);
      const cv = document.createElement('canvas');
      cv.width = wa + wb + 12; cv.height = H + bar;
      const x = cv.getContext('2d');
      x.fillStyle = '#111'; x.fillRect(0, 0, cv.width, cv.height);
      x.drawImage(a, 0, bar, wa, H); x.drawImage(b, wa + 12, bar, wb, H);
      x.fillStyle = '#fff'; x.font = 'bold 18px sans-serif';
      x.fillText(`Now: ${title}`, 10, 27); x.fillText('Target (Phase 6 concept)', wa + 22, 27);
      return cv.toDataURL('image/jpeg', 0.85);
    },
    { shot: `data:image/png;base64,${png.toString('base64')}`, target, title: scene.title },
  );
  writeFileSync(`${out}/${name}-vs-target.jpg`, Buffer.from(side.split(',')[1], 'base64'));
  metrics.shots[name] = { scene: scene.title, size: `${size.width}x${size.height}`, ...stats };
  console.log(`  ${name.padEnd(14)} draw calls ${String(stats.drawCalls).padStart(4)} · tris ${stats.triangles}`);
  await ctx.close();
}

try {
  for (const s of sceneKeys) for (const z of sizeKeys) await shoot(s, z);
} finally {
  await browser.close();
  server.httpServer.close();
}
writeFileSync(`${out}/metrics.json`, JSON.stringify(metrics, null, 2) + '\n');
console.log(`wrote ${Object.keys(metrics.shots).length} shots to ${out}/`);
if (errors.length) { console.error(`ERRORS:\n${errors.join('\n')}`); process.exit(1); }
