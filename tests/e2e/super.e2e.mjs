// Phase 5 E14: a superstructure in the real page, by mouse: place a core from the Build tray, pay assembly and
// activation from its panel, fire its ability; then close-ups of all four built. Fails on page or console errors.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4195, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`page: ${e}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto('http://localhost:4195/?cursor=1');
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
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    const B = s.state.resources.energy.constructor;
    s.state.caps.energy = new B(1e6); s.state.caps.water = new B(1e6);
    s.state.resources.energy = new B(1e6); s.state.resources.water = new B(1e6); s.state.resources.biomass = new B(1e12);
    s.state.cores = [{ type: 'solar' }, { type: 'condenser' }, { type: 'pollinator' }, { type: 'droneHub' }];
    g.camera.glide(8, 0, 8, 1.3);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
  });
  await page.waitForTimeout(1500);
  // Find a free 2×2 spot near the middle of the park and place the Megaflower core with the mouse.
  const spot = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    const ts = s.areas.tiles('park').filter((t) => s.supers.check('solar', 'g', t.x, t.z).ok).sort((a, b) => Math.hypot(a.x - 8, a.z - 8) - Math.hypot(b.x - 8, b.z - 8));
    return ts[0] && { x: ts[0].x, z: ts[0].z };
  });
  if (!spot) throw new Error('no room for a superstructure');
  const screenOf = (x, z) => page.evaluate(([x, z]) => {
    const g = window.solarbloom;
    const p = g.camera.toScreen(new (g.camera.target.constructor)(x, 0.2, z));
    return [p.x, p.y];
  }, [x, z]);
  await page.click('#buildToggle');
  await page.waitForTimeout(300);
  await page.click('#hotbar [data-tool="super:solar"]');
  const [gx, gy] = await screenOf(spot.x + 1, spot.z + 1); // the footprint centres on the pointer
  await page.mouse.move(gx, gy);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${dir}/super-place.png` });
  await page.mouse.click(gx, gy);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${dir}/super-foundation.png` });
  for (const name of ['assembly', 'built']) {
    await page.waitForSelector('#inspect.open [data-super^="stage|"]', { timeout: 8000 });
    await page.click('#inspect [data-super^="stage|"]');
    await page.waitForTimeout(name === 'built' ? 2000 : 900);
    await page.screenshot({ path: `${dir}/super-${name}.png` });
  }
  const id = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    const m = s.state.machines.find((x) => x.tier === 3 && x.type === 'solar');
    s.supers.addCharge(m, 100);
    window.solarbloom.select(m.id);
    return m.id;
  });
  await page.waitForTimeout(500);
  await page.click('#inspect [data-super^="activate|"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${dir}/super-fired.png` });
  // The other three, built straight away, then a close-up of all four.
  await page.evaluate((sp) => {
    const g = window.solarbloom;
    const s = g.sim;
    g.select(undefined);
    for (const type of ['condenser', 'pollinator', 'droneHub']) {
      const ts = s.areas.tiles('park').filter((t) => s.supers.check(type, 'g', t.x, t.z).ok).sort((a, b) => Math.hypot(a.x - sp.x, a.z - sp.z) - Math.hypot(b.x - sp.x, b.z - sp.z));
      const m = s.supers.place(type, 'g', ts[0].x, ts[0].z);
      for (let i = 0; i < 2; i++) {
        s.state.resources.energy = s.state.caps.energy;
        s.state.resources.water = s.state.caps.water;
        s.supers.advance(m.id);
      }
    }
    g.camera.maxZoom = 4;
    g.camera.glide(sp.x + 1, 0, sp.z + 1, 1.5);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
  }, spot);
  await page.mouse.move(5, 400);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/super-all.png` });
  const r = await page.evaluate((id) => {
    const s = window.solarbloom.sim;
    return { supers: s.state.stats.supers, used: s.machine(id).ability.used, cores: s.state.cores.length, burst: s.mods.solarMult() };
  }, id);
  console.log('result', JSON.stringify(r));
  if (r.supers !== 4 || r.used !== 1 || r.cores !== 0) errors.push(`unexpected result ${JSON.stringify(r)}`);
} finally {
  await browser.close();
  await server.close();
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page or console errors');
process.exit(errors.length ? 1 : 0);
