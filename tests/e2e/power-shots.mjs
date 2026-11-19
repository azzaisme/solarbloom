// E23.3: headless play-through of the power grid, with review shots in docs/review/power/ (or argv[2]).
// `npm run build` first (or this runs on whatever dist/ holds), then `node tests/e2e/power-shots.mjs [outDir]`.
// A new old-city game; on Saltwind Beach it builds solar panels, a battery, a wind turbine, two Bloom Relays (power
// poles), chargers and drone hubs, then shoots: the grid by day, the Power overlay in build mode, a pole tripped by
// lightning, and (where night lighting exists) lights at dusk and at night, with draw calls logged.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = process.argv[2] ?? 'docs/review/power';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4231, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(300_000);
  await page.goto('http://localhost:4231/?slot=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom && !!window.solarbloom.sim);
  await page.waitForTimeout(4000);
  await page.addStyleTag({ content: '#hint, #intro, .toast, #toasts { display: none !important; }' });
  const shot = async (name, x, z, zoom, yaw = 0, wait = 5000) => {
    await page.evaluate(({ x, z, zoom, yaw }) => {
      const g = window.solarbloom;
      g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
      g.camera.minZoom = 0.12;
      if (g.bot) g.bot.following = false;
      g.camera.glide(x, 0, z, zoom);
      g.camera.turnTo(yaw);
      for (let i = 0; i < 300; i++) g.camera.update(0.05);
    }, { x, z, zoom, yaw });
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${dir}/${name}.png` });
    const dc = await page.evaluate(() => window.solarbloom.app.stats.drawCalls.total);
    console.log(`  ✓ ${dir}/${name}.png  (draw calls ${dc})`);
    return dc;
  };
  // Build the grid (placement checks and recipes bypassed: this is a look test, the rules have unit tests).
  const built = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.state.salvage.tier = 3;
    const check = s.build.check.bind(s.build);
    const pay = s.inventory.pay.bind(s.inventory);
    s.build.check = () => ({ ok: true, cost: {}, spotOk: true });
    s.inventory.pay = () => true;
    const out = {};
    const put = (type, x, z, size = 1) => {
      for (let dz = 0; dz < size; dz++)
        for (let dx = 0; dx < size; dx++) {
          const t = s.grid.get('g', x + dx, z + dz);
          t.ground = 'restored';
          t.blocked = false;
          t.bloom = 1;
          t.pollution = 0;
          s.grid.touch(t);
        }
      let m;
      try {
        m = s.build.place(type, 'g', x, z); // a type this branch doesn't have yet is skipped
      } catch {}
      out[`${type}@${x},${z}`] = m?.id;
      return m ?? {};
    };
    put('solar', 7, 43);
    put('solar', 8, 43);
    put('battery', 6, 43).charge = 4200;
    put('relay', 5, 40);
    put('relay', 12, 40);
    put('windTurbine', 10, 43);
    put('charger', 8, 41);
    put('droneHub', 13, 42, 2);
    put('droneHub', 1, 40, 2);
    s.build.check = check;
    s.inventory.pay = pay;
    g.bot.teleport('g', 7, 45);
    return out;
  });
  console.log('built', JSON.stringify(built));
  await shot('power-day', 8, 42, 1.0, 20);
  await shot('power-day-close', 6, 41, 1.8, 20);
  // The Power overlay in build mode (O / d-pad right), where it exists
  const hasOverlay = await page.evaluate(() => typeof window.solarbloom.togglePowerView === 'function');
  if (hasOverlay) await page.evaluate(() => {
    const g = window.solarbloom;
    g.selectTool('battery');
    g.togglePowerView();
  });
  if (hasOverlay) await shot('power-overlay', 8, 42, 1.0, 20);
  // Lightning trips a pole: what it carried goes dark (red frames), the pole gets a red ring
  const tripped = await page.evaluate(() => {
    const g = window.solarbloom;
    return g.sim.power.trip({ int: () => 1 });
  });
  console.log('tripped', tripped);
  await shot(hasOverlay ? 'power-overlay-tripped' : 'power-tripped', 8, 42, 1.0, 20);
  await page.evaluate(({ id, hasOverlay }) => {
    const g = window.solarbloom;
    g.sim.power.reset(g.sim.machine(id));
    if (hasOverlay) {
      g.togglePowerView();
      g.selectTool('pulse');
    }
  }, { id: tripped, hasOverlay });
  // Night lighting (E23.3.5), where it exists
  const hasLights = await page.evaluate(() => !!window.solarbloom.sim.lights);
  if (hasLights) {
    const placed = await page.evaluate(() => {
      const g = window.solarbloom;
      const s = g.sim;
      const cz = (s.state.cozy ??= {});
      cz.decorUnlocked = [...(cz.decorUnlocked ?? []), 'lamppost', 'uplight', 'porchlight', 'tablelight', 'fairylights', 'paperlanterns', 'glasslanterns'];
      const kinds = ['lamppost', 'pathlight', 'lantern', 'solarstake', 'glowpod', 'uplight', 'tablelight', 'porchlight'];
      let n = 0;
      for (let z = 36; z <= 47 && n < 40; z++)
        for (let x = 0; x <= 15 && n < 40; x++) {
          const t = s.grid.get('g', x, z);
          if (!t || t.occupantId || t.feature === 'water' || (x + z) % 2) continue;
          const was = { g: t.ground, b: t.blocked };
          t.ground = 'restored';
          t.bloom = 1;
          t.pollution = 0;
          t.blocked = false;
          const k = kinds[n % kinds.length];
          if (g.cozy.canDecorate(k, 'g', x, z)) {
            Object.assign(t, { ground: was.g, blocked: was.b });
            continue;
          }
          s.grid.touch(t);
          g.cozy.placeDecor(k, n % 4, 'g', x, z);
          g.chunks.markTile(t);
          n++;
        }
      const relays = s.state.machines.filter((m) => m.type === 'relay');
      s.lights.hang('festoon', 'g', relays[0].x, relays[0].z);
      s.lights.hang('paperlanterns', 'g', relays[1].x, relays[1].z);
      // solar lights charged by a day in the sun
      for (const l of s.lights.all()) if (l.def.power === 'solar') s.lights.nodeOf(l.key).charge = 300;
      return { n };
    });
    console.log('lights placed', JSON.stringify(placed));
    // A stand-in clock when E23.7's isn't here; with it, its own time of day. The scene is dimmed by hand without it.
    const night = async (f) =>
      page.evaluate((f) => {
        const g = window.solarbloom;
        const s = g.sim;
        if (!s.clock?.setTime) s.clock = { dayFraction: () => f };
        else s.clock.setTime(f);
        const app = g.app;
        const k = Math.max(0, Math.min(1, (f - 0.6) / 0.12));
        clearInterval(window.__dim);
        const dim = () => {
          for (const l of app.root.findComponents('light')) {
            if (l.__base === undefined) l.__base = l.intensity;
            l.intensity = l.__base * (1 - 0.9 * k);
          }
          app.scene.ambientLight.set(0.55 - 0.49 * k, 0.55 - 0.48 * k, 0.6 - 0.46 * k);
          app.scene.skyboxIntensity = 1 - 0.85 * k;
        };
        dim();
        window.__dim = setInterval(dim, 100);
      }, f);
    await night(0.66);
    await shot('lights-dusk', 7, 41, 1.2, 20, 8000);
    await night(0.85);
    await page.waitForTimeout(8000);
    const dcNight = await shot('lights-night', 7, 41, 1.2, 20, 8000);
    await shot('lights-night-close', 5, 41, 2.2, 20, 4000);
    await shot('lights-night-lines', 9, 40, 1.6, 0, 4000);
    const stats = await page.evaluate(() => window.solarbloom.lightVisuals.stats());
    console.log('night', JSON.stringify(stats), 'draw calls', dcNight);
  }
  if (errors.length) {
    failed = true;
    console.error('page errors:\n' + [...new Set(errors)].slice(0, 5).join('\n'));
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);
