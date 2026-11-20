// Ground edges: a headless look at where dead paving meets dead earth and at a pool's banks in the park.
// `node tests/e2e/ground-edges.mjs [outDir]` after `vite build` (DIST=<dir> serves a copied build; GFX=low|medium|high
// picks the graphics tier, High by default).
// Writes JPEG screenshots and prints what each shows; fails on page errors.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/ground-edges';
mkdirSync(out, { recursive: true });
const server = await preview({ root: process.cwd(), build: { outDir: process.env.DIST ?? 'dist' }, preview: { port: 4251 + Math.floor(Math.random() * 400), strictPort: false }, logLevel: 'silent' });
const URL0 = server.resolvedUrls.local[0];
// GPU=1: the machine's graphics card (D3D11) instead of the software renderer
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const shots = [];
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000 }).then(() => true, () => false);
/** A still view: the ground redrawn (slow in software), no camera move, then the picture. */
async function shot(page, name, what) {
  for (let i = 0; i < 6; i++) if (await until(page, () => window.solarbloom.chunks.pending === 0 && !window.solarbloom.camera.cinematic)) break;
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 });
  shots.push(`${name}.jpg: ${what}`);
}
/** Stands bloombot on a tile, facing `facing`, at a zoom step (0 close, 1 normal, 2 far), the camera at `yaw`. */
const stand = (page, x, z, facing, zoom, yaw = 0) =>
  page.evaluate(({ x, z, facing, zoom, yaw }) => {
    const g = window.solarbloom;
    g.bot.following = true;
    g.bot.teleport('g', x, z);
    g.bot.pose.x = x + 0.5;
    g.bot.pose.z = z + 0.5;
    g.bot.pose.facing = facing;
    g.camera.turnTo(yaw, true);
    g.zoomStep = zoom;
  }, { x, z, facing, zoom, yaw });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${URL0}?slot=1&new=1&gfx=${process.env.GFX ?? 'high'}`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));

  // where a path's rounded corners meet dead earth, in the park
  const spot = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const at = (x, z) => s.grid.get('g', x, z);
    const soft = (t) => !!t && !t.blocked && !t.occupantId && t.ground === 'polluted' && ['lawn', 'litter', 'clay', undefined].includes(t.feature);
    const paved = (t) => !!t && !t.blocked && !t.occupantId && t.ground === 'polluted' && t.feature === 'paving';
    // a paved tile with an outer corner cut against earth, and room round it
    const tiles = s.areas.tiles('park');
    const cut = tiles.filter((t) => paved(t) && [[1, 1], [-1, 1], [-1, -1], [1, -1]].some(([sx, sz]) => soft(at(t.x + sx, t.z)) && soft(at(t.x, t.z + sz))));
    const fill = tiles.filter((t) => soft(t) && [[1, 1], [-1, 1], [-1, -1], [1, -1]].some(([sx, sz]) => paved(at(t.x + sx, t.z)) && paved(at(t.x, t.z + sz))));
    const water = tiles.filter((t) => t.feature === 'water' && !t.blocked);
    const pick = (list) => list.find((t) => t.z >= 3 && t.z <= 11 && paved(at(t.x, t.z)) !== undefined) ?? list[0];
    const c = pick(cut);
    const f = pick(fill);
    const w = water.find((t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => at(t.x + dx, t.z + dz)?.feature !== 'water').length >= 2) ?? water[0];
    return { cut: c && { x: c.x, z: c.z }, fill: f && { x: f.x, z: f.z }, water: w && { x: w.x, z: w.z }, counts: [cut.length, fill.length, water.length] };
  });
  console.log('spots', JSON.stringify(spot));
  console.log('renderer', await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; }));
  // the view the owner marked up: by the south path, looking north
  await stand(page, 7, 12, Math.PI / 2, 1);
  await shot(page, '01-path-and-earth', 'dead paving beside dead earth: the paving stands a little higher, with a stone lip and a soft shadow on the earth; the rounded corners carry the painted ground');
  await stand(page, 7, 12, Math.PI / 2, 0);
  await shot(page, '02-path-and-earth-close', 'the same, close in');
  if (spot.cut) {
    await stand(page, spot.cut.x, spot.cut.z, 0, 0);
    await shot(page, '03-cut-corner', 'a paved corner cut back to a curve: earth fills the corner below the paving');
    await stand(page, spot.cut.x, spot.cut.z, 0, 0, 135);
    await shot(page, '04-cut-corner-turned', 'the same corner from another side');
  }
  if (spot.fill) {
    await stand(page, spot.fill.x, spot.fill.z, 0, 0);
    await shot(page, '05-filled-corner', 'earth in the crook of a path: the paving fills its corner, raised like the rest');
  }
  if (spot.water) {
    await stand(page, spot.water.x, spot.water.z + 2, Math.PI, 0);
    await shot(page, '06-pool-bank', "a pool's rounded banks carry the painted ground of the land beside them");
    await stand(page, spot.water.x, spot.water.z + 2, Math.PI, 0, 135);
    await shot(page, '07-pool-bank-turned', 'the same bank from another side');
  }
  // looking along a world axis and a little off it: no light band down the screen (the reflection map's seam)
  await stand(page, 8, 12, Math.PI / 2, 1, 20);
  await shot(page, '08-path-and-earth-turned', 'the first view turned 20°: even light across the painted earth, no band');
  await page.close();
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(shots.map((s) => `  ${s}`).join('\n'));
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}
