// E23.2.4 (#374): a headless look at wildlife visits. The park is grown to a tier (as a pulse would leave it), bloombot
// sits on a mended bench, and animals come over: a few at "Lively", more and closer at "Thriving" (on its head and
// shoulders, in its lap, curled up beside it). Then the visitor log in the backpack.
// `node tests/e2e/wildlife-e23.mjs [outDir]` after `vite build` (DIST=<dir> serves a copied build; GPU=1 uses the
// graphics card; GFX=low|medium|high picks the tier, High by default).
// Writes JPEG screenshots and prints what each shows; fails on page errors or broken checks.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review/e23-2-4';
mkdirSync(out, { recursive: true });
const server = await preview({ root: process.cwd(), build: { outDir: process.env.DIST ?? 'dist' }, preview: { port: 4251 + Math.floor(Math.random() * 400), strictPort: false }, logLevel: 'silent' });
const URL0 = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: process.env.GPU ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const checks = [];
const check = (ok, what) => {
  checks.push(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};
const shots = [];
const until = (page, fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
async function shot(page, name, what) {
  for (let i = 0; i < 4; i++) if (await until(page, () => window.solarbloom.chunks.pending === 0 && !window.solarbloom.camera.cinematic)) break;
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 84 });
  shots.push(`${name}.jpg: ${what}`);
}
const bench = { x: 10, z: 6 };

/** Grows park ground near the bench to a tier, as the unit tests do (tests/wildlife.test.ts parkAt). */
const grow = (page, tier) =>
  page.evaluate(
    ({ tier, bench }) => {
      const s = window.solarbloom.sim;
      const near = s.areas
        .tiles('park')
        .filter((t) => t.ground === 'polluted' && !t.blocked && !t.occupantId && t.feature !== 'water')
        .sort((a, b) => Math.hypot(a.x - bench.x, a.z - bench.z) - Math.hypot(b.x - bench.x, b.z - bench.z))
        .slice(0, 40);
      const set = (tiles, bloom, plant) => {
        for (const t of tiles) {
          t.ground = 'restored';
          t.bloom = bloom;
          t.pollution = 0;
          if (plant) t.plant = plant;
          s.grid.touch(t);
        }
      };
      set(near.slice(0, 5), 2);
      set(near.slice(5, 10), 3);
      if (tier === 'thriving') {
        set(near.slice(10, 14), 2, 'meadow');
        set(near.slice(14, 16), 3, 'grove');
        s.state.fauna = { ...(s.state.fauna ?? {}), butterflies: 1, birds: 2 };
      }
      return s.wildlife.diversity('park');
    },
    { tier, bench },
  );

/** Sits on the bench (Interact), then waits until `n` visitors are here. */
async function sitAndWait(page, n) {
  await page.evaluate((b) => {
    const g = window.solarbloom;
    g.bot.following = true;
    g.bot.teleport('g', b.x, b.z + 1);
    g.bot.pose.x = b.x + 0.5;
    g.bot.pose.z = b.z + 1.6;
    g.bot.pose.facing = Math.PI;
  }, bench);
  await page.waitForTimeout(800);
  await page.keyboard.press('KeyE');
  check(await until(page, () => window.solarbloom.sim.rest.sitting?.kind === 'bench'), 'E sits on the bench');
  const plan = await page.evaluate(() => window.solarbloom.sim.wildlife.visits.map((v) => `${v.id}@${v.perch}`));
  const ok = await until(page, (n) => window.solarbloom.sim.wildlife.here().length >= n, Math.min(n, plan.length), 180000);
  return { plan, ok };
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${URL0}?slot=1&new=1&gfx=${process.env.GFX ?? 'high'}`);
  await page.waitForFunction(() => window.solarbloom?.bot && document.querySelector('#loading')?.classList.contains('gone'));
  await page.evaluate(() => window.solarbloom.pause.clear('blur'));
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
  console.log('renderer', await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl?.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; }));
  await page.evaluate((b) => {
    const s = window.solarbloom.sim;
    s.inventory.add('scrap', 3);
    s.rest.mend(s.rest.benchAt(b.x, b.z));
  }, bench);

  // ── Lively: a few come, some climb on ──
  const lively = await grow(page, 'lively');
  check(lively.tier === 'lively', `the park grown to Lively (score ${lively.score}, ${lively.kinds.join(', ')})`);
  const l = await sitAndWait(page, 3);
  check(l.ok, `visitors come while bloombot sits: ${l.plan.join(', ')}`);
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.solarbloom.camera.jumpZoom(7));
  await shot(page, '20-visitors-lively', `Lively: ${l.plan.join(', ')}`);
  await page.keyboard.press('KeyE');
  check(await until(page, () => !window.solarbloom.sim.rest.sitting), 'E stands');
  check(await until(page, () => window.solarbloom.sim.wildlife.visits.length === 0, undefined, 30000), 'they leave when bloombot stands');

  // ── Thriving: more, and closer ──
  const thr = await grow(page, 'thriving');
  check(thr.tier === 'thriving', `the park grown to Thriving (score ${thr.score})`);
  const t = await sitAndWait(page, 5);
  check(t.ok && t.plan.length > l.plan.length, `more come at Thriving: ${t.plan.join(', ')}`);
  await page.waitForTimeout(2000);
  await shot(page, '21a-visitors-thriving-calm-view', 'the calm view as the player first gets it on sitting down (zoomed out, turning slowly)');
  check(await page.evaluate(() => window.solarbloom.camera.maxZoom >= 7), 'sitting lets the camera zoom in close (REST.visitZoom)');
  await page.evaluate(() => window.solarbloom.camera.jumpZoom(7));
  await shot(page, '21-visitors-thriving', `Thriving: ${t.plan.join(', ')}`);
  await page.evaluate(() => {
    const g = window.solarbloom;
    g.camera.turnTo(25, true);
    g.camera.jumpZoom(7);
  });
  await shot(page, '22-visitors-thriving-close', 'close up: animals on bloombot and beside it on the bench');
  await page.keyboard.press('KeyE');
  await until(page, () => !window.solarbloom.sim.rest.sitting);
  check(await until(page, () => window.solarbloom.camera.maxZoom < 5, undefined, 5000), 'standing puts the usual zoom limit back');

  // ── the visitor log ──
  const logged = await page.evaluate(() => Object.keys(window.solarbloom.sim.state.wildlife?.log ?? {}));
  check(logged.length >= 3, `the visitor log took them in: ${logged.join(', ')}`);
  await page.evaluate(() => window.solarbloom.hud.backpack.open('collection'));
  await page.waitForTimeout(800);
  const text = await page.evaluate(() => document.querySelector('#bpBody')?.innerText ?? '');
  check(/Visitors/.test(text) && /Sat with you/.test(text), 'Backpack → Collection lists the visitors');
  // scroll the backpack so the Visitors group's top is at the top of its scrolling box
  const scrolled = await page.evaluate(() => {
    const title = [...document.querySelectorAll('#bpBody section.bp-group')].find((e) => /^Visitors\b/.test(e.querySelector('h3')?.textContent ?? ''));
    let box = title?.parentElement;
    while (box && !(box.scrollHeight > box.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    if (!title || !box) return false;
    box.scrollTop += title.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
    return true;
  });
  check(scrolled, 'the Visitors group scrolled into view');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/23-visitor-log.jpg`, type: 'jpeg', quality: 84 });
  shots.push('23-visitor-log.jpg: the visitor log in the backpack (Collection → Visitors)');
  await page.close();
} finally {
  await browser.close();
  server.httpServer.close();
}
console.log(checks.join('\n'));
console.log(shots.map((s) => `  ${s}`).join('\n'));
if (errors.length) {
  console.log('page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}
