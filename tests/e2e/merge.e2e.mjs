// Phase 5 E13: a merge in the real page, by mouse: tap a panel, open the merge preview, tap a fourth panel to swap
// it in, confirm, and check the result. Screenshots each step. Fails on page or console errors. Run after `vite build`.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4196, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`page: ${e}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto('http://localhost:4196/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.waitForTimeout(1000);
  if ((await page.locator('#introGo').count()) && (await page.locator('#introGo').isVisible())) await page.click('#introGo');
  // Restore the whole park; stages mixed by position so every stage shows (1 sapling … 4 Radiant).
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    for (const t of s.areas.tiles('park')) {
      if (!s.restoration.isEligible(t)) continue;
      s.restoration.complete(t, 'pulse');
      t.bloom = 2;
      s.grid.touch(t);
    }
    g.chunks.markAll();
  });
  // Four panels in a row on free restored ground near the fountain.
  const spot = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const B = s.state.resources.energy.constructor;
    s.state.resources.biomass = new B(1e9);
    s.state.caps.energy = new B(1e6); s.state.caps.water = new B(1e6);
    s.state.resources.energy = new B(1e6); s.state.resources.water = new B(1e6);
    for (let z = 4; z < 14; z++)
      for (let x = 2; x < 12; x++) {
        if ([0, 1, 2, 3].every((i) => s.build.check('solar', 'g', x + i, z).ok)) {
          const ids = [0, 1, 2, 3].map((i) => s.build.place('solar', 'g', x + i, z).id);
          g.camera.glide(x + 2, 0, z + 0.5, 1.6);
          for (let i = 0; i < 200; i++) g.camera.update(0.05);
          return { x, z, ids };
        }
      }
    return null;
  });
  if (!spot) throw new Error('no room for four panels');
  await page.waitForTimeout(2200);
  const screenOf = (x, z) => page.evaluate(([x, z]) => {
    const g = window.solarbloom;
    const t = g.sim.grid.get('g', x, z);
    const [wx, wy, wz] = g.sim.grid.tileWorld(t);
    const p = g.camera.toScreen(new (g.camera.target.constructor)(wx, wy + 0.2, wz));
    return [p.x, p.y];
  }, [x, z]);
  const tap = async (x, z) => {
    // Drones have a generous tap radius (tapping one selects its hub): move them out of the way first.
    await page.evaluate(() => { for (const d of window.solarbloom.sim.state.drones) { d.px = -40; d.pz = -40; d.mode = 'cooldown'; d.timer = 30; } });
    await page.waitForFunction(([x, z]) => { const g = window.solarbloom; return g.sim.state.drones.every((d) => { const p = g.drones.worldPos(d.id); return !p || Math.hypot(p.x - x, p.z - z) > 3; }); }, [x, z], { timeout: 15000 });
    const [sx, sy] = await screenOf(x, z);
    await page.mouse.click(sx, sy);
    await page.waitForTimeout(300);
  };
  await tap(spot.x + 1, spot.z); // the second panel is the anchor
  await page.waitForTimeout(500);
  await page.waitForSelector('#inspect.open .merge-btn', { timeout: 8000 });
  await page.click('#inspect .merge-btn');
  await page.waitForSelector('#inspect .merge', { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/merge-preview.png` });
  const before = await page.evaluate(() => document.querySelector('#inspect .merge').textContent);
  await tap(spot.x + 3, spot.z); // the fourth panel: swap it in
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/merge-swapped.png` });
  await page.click('#inspect [data-merge=confirm]');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/merge-anim.png` });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${dir}/merge-done.png` });
  await page.evaluate((sp) => {
    const g = window.solarbloom;
    g.select(undefined);
    g.camera.maxZoom = 4;
    g.camera.glide(sp.x + 1.5, 0, sp.z + 0.5, 3.2);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
  }, spot);
  await page.mouse.move(5, 400);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/merge-closeup.png` });
  const r = await page.evaluate((ids) => {
    const s = window.solarbloom.sim;
    return { tiers: ids.map((id) => s.machine(id)?.tier ?? (s.machine(id) ? 1 : 0)), merges: s.state.stats.merges };
  }, spot.ids);
  console.log('preview:', before.replace(/\s+/g, ' ').slice(0, 220));
  console.log('result tiers (0 = merged away):', r.tiers.join(' '), JSON.stringify(r.merges));
  if (r.tiers.join(' ') !== '1 2 0 0') errors.push(`unexpected result ${r.tiers.join(' ')}`);
} finally {
  await browser.close();
  await server.close();
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page or console errors');
process.exit(errors.length ? 1 : 0);
