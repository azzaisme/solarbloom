// #563: night ponds, judged from the follow camera, on High and Medium. Run after `vite build`:
//   GPU=1 node tests/e2e/night-ponds-shots.mjs [outDir]   (default docs/review/night-ponds)
// Cistern Basin's pond, woken and full, with bloombot standing on its bank and the camera following him:
//   1 day-high / 2 day-medium: by day (13:00) the water is as it always was
//   3 night-high / 4 night-medium: at 01:55 the water reads deep moonlit navy, no brighter than its moonlit banks
// Prints ✓/✗ checks (the pond against the ground beside it, from the screenshot) and exits non-zero if any fails.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/night-ponds';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4273, strictPort: false }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.setDefaultTimeout(240000);
await page.goto(`${base}/?slot=1&ui=oldcity`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 240000 });
await page.evaluate(() => window.solarbloom.pause.clear('blur'));
await page.addStyleTag({ content: '.toast, #toasts { display: none !important; }' });
const settle = async (ms = 3000) => {
  await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('gone'), null, { timeout: 240000 });
  await page.waitForTimeout(ms);
};
const run = (fn, arg) => page.evaluate(fn, arg);
/** Screenshot, and two mean colours (0–255) from it: `pond` (upper middle, over the water) and `ground` (the pond's right-hand bank, at the water's distance). */
const shot = async (name) => {
  const png = await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${out}/${name}.png`);
  return run(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const mean = (x0, y0, w, h) => {
      const t = document.createElement('canvas');
      t.width = 100;
      t.height = 60;
      const x = t.getContext('2d');
      x.drawImage(img, img.width * x0, img.height * y0, img.width * w, img.height * h, 0, 0, 100, 60);
      const d = x.getImageData(0, 0, 100, 60).data;
      const m = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) m[k] += d[i + k];
      return m.map((v) => Math.round(v / (d.length / 4)));
    };
    return { pond: mean(0.4, 0.3, 0.2, 0.15), ground: mean(0.78, 0.48, 0.12, 0.06) };
  }, png.toString('base64'));
};
const frame = async (x, z, zoom, yaw = 0, ms = 8000) => {
  await run(({ x, z, zoom, yaw }) => {
    const g = window.solarbloom;
    g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
    g.camera.minZoom = 0.12;
    if (g.bot) g.bot.following = false;
    g.camera.glide(x, 0, z, zoom);
    g.camera.turnTo(yaw);
    for (let i = 0; i < 300; i++) g.camera.update(0.05);
  }, { x, z, zoom, yaw });
  await settle(ms);
};
const at = (f) =>
  run((f) => {
    const s = window.solarbloom.sim;
    (s.state.clock ??= { offset: 0 }).offset += (f - s.clock.dayFraction()) * 2880;
  }, f);
const gfx = (v) => run((v) => window.solarbloom.setGraphics(v), v);

try {
  await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.weather.forceForTest('sunny', Infinity);
    const area = s.areas.map.areaOfCell(64, 41);
    s.areas.reveal(area);
    delete s.state.areas[area].sealed;
    s.areas.afterUnseal(area);
    s.areas.clear(area, true);
    const id = s.water.springBodies('cistern')[0].id;
    for (let i = 0; i < 45; i++) s.water.tick(1);
    g.chunks.markAll();
    return s.water.levelOf(id);
  });
  // bloombot on the pond's south bank, the follow camera looking north over the water
  const follow = async (ms = 10000) => {
    await run(() => {
      const g = window.solarbloom;
      g.bot.teleport('g', 68.5, 53.5);
      g.sim.bot = { roofId: 'g', x: 68.5, z: 53.5 };
      g.bot.following = true;
      g.camera.turnTo(0);
      for (let i = 0; i < 300; i++) g.camera.update(0.05);
    });
    await settle(ms);
  };
  // warm up: the first trip there loads the area's chunks and models
  await follow(20000);
  const results = {};
  for (const [time, f] of [['day', 0.3], ['night', 0.83]]) {
    await at(f);
    for (const tier of ['high', 'medium']) {
      await gfx(tier);
      await follow();
      const name = `${time}-${tier}`;
      results[name] = await shot(`${['day', 'night'].indexOf(time) * 2 + (tier === 'high' ? 1 : 2)}-${name}`);
    }
  }
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const tier of ['high', 'medium']) {
    const n = results[`night-${tier}`];
    const d = results[`day-${tier}`];
    console.log(`  ${tier}: pond by day ${d.pond}, ground ${d.ground}; by night pond ${n.pond}, ground ${n.ground}`);
    check(lum(n.pond) <= lum(n.ground) * 1.1, `${tier} night: the pond is no brighter than the moonlit bank beside it (${Math.round(lum(n.pond))} vs ${Math.round(lum(n.ground))})`);
    check(n.pond[2] > n.pond[0] * 1.5, `${tier} night: the pond reads navy (blue well over red: ${n.pond})`);
    check(lum(d.pond) > lum(d.ground) * 0.9, `${tier} day: the pond is still bright aqua (${d.pond} vs ground ${d.ground})`);
  }
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} catch (e) {
  console.log(`✗ crashed: ${e.message}`);
  failures.push('crash');
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures.length ? 1 : 0);
