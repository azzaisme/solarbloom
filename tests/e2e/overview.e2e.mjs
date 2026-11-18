// City 08.3: from the overview, any cleared area is reachable in two taps (tap its label → the camera flies there
// and its panel opens; the second tap is on the area itself).
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = await preview({ preview: { port: 4196, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let fails = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:4196/?slot=1&rules=classic');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  if (await page.locator('#introGo').isVisible()) await page.click('#introGo');
  const ids = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.state.progression.coreActivated = true;
    s.areas.clear('park', true);
    const out = [];
    for (let i = 0; i < 12; i++) {
      const id = s.areas.nextGoal();
      s.areas.clear(id, true);
      out.push(id);
    }
    document.querySelector('#hint')?.remove();
    return out;
  });
  const overview = () =>
    page.evaluate(() => {
      const g = window.solarbloom;
      document.querySelector('#inspect [data-close]')?.click();
      g.camera.glide(8, 0, 8, 0.22);
      for (let i = 0; i < 300; i++) g.camera.update(0.05);
    });
  let checked = 0;
  for (const id of ids) {
    await overview();
    await page.waitForTimeout(700);
    const label = page.locator(`[data-area="${id}"]`).first();
    if (!(await label.isVisible().catch(() => false))) continue; // off the overview screen
    // Only labels a player can actually tap here (on screen, not under a HUD panel).
    const tappable = await label.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit) || hit.closest('.wlabel')?.contains(el));
    });
    if (!tappable) continue;
    await label.click({ timeout: 5000 }); // tap 1
    await page.waitForTimeout(600);
    const r = await page.evaluate((id) => {
      const g = window.solarbloom;
      for (let i = 0; i < 300; i++) g.camera.update(0.05);
      const [x, z] = g.sim.areas.info(id).landmark;
      const t = g.camera.target;
      return { dist: Math.hypot(t.x - (x + 1), t.z - (z + 1)), zoom: g.camera.zoom, panel: document.querySelector('#inspect.open [data-area-panel]')?.getAttribute('data-area-panel') };
    }, id);
    checked++;
    if (r.dist > 2 || r.zoom < 0.6 || r.panel !== id) {
      fails++;
      console.error(`  ✗ ${id}: camera ${r.dist.toFixed(1)} tiles away at zoom ${r.zoom.toFixed(2)}, panel ${r.panel}`);
    }
  }
  if (checked < 6) {
    fails++;
    console.error(`  ✗ only ${checked} cleared areas were on the overview`);
  } else if (!fails) console.log(`  ✓ ${checked} cleared areas reached from the overview in one label tap each`);
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(fails ? 1 : 0);
