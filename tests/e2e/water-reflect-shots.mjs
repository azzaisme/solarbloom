// The High-tier water reflection, played headless. Run after `vite build`:   node tests/e2e/water-reflect-shots.mjs [outDir]
// (default docs/review/water-reflect). Cistern Basin's pond, woken and full, close up:
//   1 day-high: High graphics by day: a soft wash of sky across the water and a sun glint
//   2 day-medium: the same view switched live to Medium: the water as it always was (no reflection)
//   3 night-high: back on High, at midnight: the reflection goes dark blue, with a moon glint
//   4 night-medium: the same night on Medium, for comparison
// Prints ✓/✗ checks and exits non-zero if any fails. Requires Playwright.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/water-reflect';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4271, strictPort: false }, logLevel: 'silent' });
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
/** Screenshot, and the mean colour (0–255) of the middle of the frame, where the pond is (from the screenshot itself). */
const shot = async (name) => {
  const png = await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${out}/${name}.png`);
  return run(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const t = document.createElement('canvas');
    t.width = 200;
    t.height = 120;
    const x = t.getContext('2d');
    x.drawImage(img, img.width * 0.35, img.height * 0.35, img.width * 0.3, img.height * 0.3, 0, 0, 200, 120);
    const d = x.getImageData(0, 0, 200, 120).data;
    const m = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) m[k] += d[i + k];
    return m.map((v) => Math.round(v / (d.length / 4)));
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
  // Cistern Basin opened and its landmark woken: a full natural pond
  await run(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.weather.forceForTest('sunny', Infinity);
    const area = s.areas.map.areaOfCell(64, 41);
    s.areas.reveal(area);
    delete s.state.areas[area].sealed;
    s.areas.afterUnseal(area);
    s.areas.clear(area, true);
    g.bot.teleport('g', 74.5, 57.5);
    s.bot = { roofId: 'g', x: 74.5, z: 57.5 };
    const id = s.water.springBodies('cistern')[0].id;
    for (let i = 0; i < 45; i++) s.water.tick(1);
    g.chunks.markAll();
    return s.water.levelOf(id);
  });
  await gfx('high');
  await at(0.3);
  await frame(68.5, 47, 1.2, 30, 10000);
  const tier = await run(() => ({ tier: window.solarbloom.gfxTier, deck: window.solarbloom.deck }));
  check(tier.tier === 'high' && !tier.deck, `High graphics (${JSON.stringify(tier)})`);
  const dayHigh = await shot('1-day-high');
  await gfx('medium');
  await settle(5000);
  check((await run(() => window.solarbloom.gfxTier)) === 'medium', 'switched live to Medium');
  const dayMed = await shot('2-day-medium');
  const diff = dayHigh.reduce((a, v, i) => a + Math.abs(v - dayMed[i]), 0);
  check(diff > 2, `the pond looks different at High and Medium (mean ${dayHigh} vs ${dayMed})`);
  await gfx('high');
  await at(0.83);
  await settle(8000);
  const night = await shot('3-night-high');
  check(night[2] >= night[0], `night water reads blue (${night})`);
  await gfx('medium');
  await settle(5000);
  const nightMed = await shot('4-night-medium');
  console.log(`  night pond High ${night} vs Medium ${nightMed}`);
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} catch (e) {
  console.log(`✗ crashed: ${e.message}`);
  failures.push('crash');
} finally {
  await browser.close();
  await server.close();
}
process.exit(failures.length ? 1 : 0);
