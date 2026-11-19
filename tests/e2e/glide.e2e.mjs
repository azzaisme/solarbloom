// E23.8 (#329): a headless play-through of the optional glides back toward the park. For each perch: bloombot walks
// up to it, the prompt reads "Glide to <region>", refused without Glide; with Glide, E takes off, bloombot flies an
// arc and lands on the landing cell, charge spent. `node tests/e2e/glide.e2e.mjs [outDir]` after `vite build`.
// Writes JPEG screenshots (on the perch, in the air, landed); fails on page errors or broken checks.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/e23-8-glides';
mkdirSync(out, { recursive: true });
const server = await preview({ root: process.cwd(), preview: { port: 4251 + Math.floor(Math.random() * 400), strictPort: false }, logLevel: 'silent' });
const URL0 = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const checks = [];
const check = (ok, what) => {
  checks.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};
const until = (page, fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const prompt = (page) => page.evaluate(() => document.getElementById('prompt')?.innerText ?? '');
async function shot(page, name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 84 });
  console.log(`  ✓ ${out}/${name}.jpg`);
}
const GLIDES = [
  { id: 'gl-observatory', x: 36, z: -34, to: [26, -13], name: 'Mast Row' },
  { id: 'gl-spire', x: -19, z: -34, to: [-13, -11], name: 'Elder Grove' },
  { id: 'gl-glasshouse', x: -34, z: 9, to: [-10, 9], name: 'Elder Grove' },
];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${URL0}?slot=1&new=1&gfx=deck`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
  await page.addStyleTag({ content: '#hint, .toast, #toasts { display: none !important; }' });
  // every region revealed; bloombot is set down beside each perch (opening the gates would queue their vistas)
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    for (let cz = -6; cz <= 6; cz++)
      for (let cx = -6; cx <= 6; cx++) {
        const id = s.areas.map.areaOfChunk(cx, cz);
        if (id !== 'sea' && id !== 'park' && !id.startsWith('out_')) s.state.areas[id] = { fog: 'thinning', revealedAt: 0 };
      }
    g.chunks.markAll();
  });
  /** Bloombot on the walkable cell beside a perch, facing it. */
  const toPerch = (gl) =>
    page.evaluate((gl) => {
      const g = window.solarbloom;
      const s = g.sim;
      const side = [[0, 1], [0, -1], [1, 0], [-1, 0]].find(([dx, dz]) => {
        const t = s.grid.get('g', gl.x + dx, gl.z + dz);
        return t && !t.blocked && !t.occupantId;
      });
      g.bot.teleport('g', gl.x + side[0] + 0.5, gl.z + side[1] + 0.5);
      g.bot.pose.x = gl.x + 0.5 + side[0] * 0.75;
      g.bot.pose.z = gl.z + 0.5 + side[1] * 0.75;
      g.bot.pose.facing = Math.atan2(-side[0], -side[1]);
      g.bot.following = true;
      return side;
    }, gl);

  for (const [i, gl] of GLIDES.entries()) {
    await page.evaluate(() => { window.solarbloom.sim.state.salvage.abilities = ['pry', 'hover', 'climb']; });
    await toPerch(gl);
    await until(page, () => !window.solarbloom.bot.frozen());
    check(await until(page, () => /needs Glide/.test(document.getElementById('prompt')?.innerText ?? '')), `${gl.id}: without Glide the perch says it needs Glide (${(await prompt(page)).replace(/\n/g, ' ')})`);
    await page.evaluate(() => {
      const s = window.solarbloom.sim;
      s.state.salvage.abilities = ['pry', 'hover', 'climb', 'glide'];
      s.state.charge.value = 50;
    });
    check(await until(page, (name) => new RegExp(`Glide to ${name}`).test(document.getElementById('prompt')?.innerText ?? ''), gl.name), `${gl.id}: with Glide it offers "Glide to ${gl.name}"`);
    if (i === 0) await shot(page, `${i + 1}0-${gl.id}-perch`);
    const before = await page.evaluate(() => window.solarbloom.sim.charge.value());
    await page.keyboard.press('KeyE');
    check(await until(page, () => window.solarbloom.bot.riding, undefined, 10000), `${gl.id}: E takes off`);
    if (i === 0) {
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${out}/${i + 1}1-${gl.id}-flying.jpg`, type: 'jpeg', quality: 84 });
      console.log(`  ✓ ${out}/${i + 1}1-${gl.id}-flying.jpg`);
    }
    check(await until(page, (to) => { const p = window.solarbloom.bot.pose; return !window.solarbloom.bot.riding && Math.hypot(p.x - to[0] - 0.5, p.z - to[1] - 0.5) < 1.2; }, gl.to, 120000), `${gl.id}: lands at ${gl.to}`);
    const after = await page.evaluate(() => window.solarbloom.sim.charge.value());
    check(after < before, `${gl.id}: the glide spent charge (${before} → ${after})`);
    if (i === 0) await shot(page, `${i + 1}2-${gl.id}-landed`);
  }
} catch (e) {
  process.exitCode = 1;
  console.error(e);
} finally {
  await browser.close();
  server.httpServer.close();
}
for (const c of checks) console.log(c);
if (errors.length) {
  process.exitCode = 1;
  console.log('page errors:', errors.slice(0, 5));
}
