// Phase 4 E09: every machine, first as built and then fully upgraded, at close zoom (docs/review/phase4-machines-*.png).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4201, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:4201/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  await page.addStyleTag({ content: '#hud { display: none !important; }' });
  const spot = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.state.caps.energy = new (s.state.resources.energy.constructor)(1e6); s.state.caps.water = new (s.state.resources.energy.constructor)(1e6);
    s.state.resources.energy = new (s.state.resources.energy.constructor)(1e6); s.state.resources.water = new (s.state.resources.energy.constructor)(1e6); s.state.resources.biomass = new (s.state.resources.energy.constructor)(1e6);
    for (const t of s.areas.tiles('park')) if (s.restoration.isEligible(t)) s.restoration.complete(t, 'pulse');
    s.state.progression.coreActivated = true;
    s.areas.clear('park', true);
    const row = ['solar', 'condenser', 'pollinator', 'droneHub', 'motherTree', 'relay'];
    // Each machine on the first free spot, scanning rows from the park's middle (unlocks need the hub first).
    const tiles = s.areas.tiles('park').sort((a, b) => Math.abs(a.z - 8) - Math.abs(b.z - 8) || a.x - b.x);
    const at = [];
    for (const type of row) {
      const t = tiles.find((t) => s.build.check(type, 'g', t.x, t.z).ok);
      if (t && s.build.place(type, 'g', t.x, t.z)) at.push(t);
    }
    if (!at.length) return undefined;
    return { x: at.reduce((a, t) => a + t.x, 0) / at.length + 0.5, z: at.reduce((a, t) => a + t.z, 0) / at.length + 0.5 };
  });
  if (!spot) throw new Error('no free strip for the machine row');
  const shoot = async (label) => {
    await page.evaluate(({ x, z }) => {
      const g = window.solarbloom;
      g.camera.glide(x, 0, z, 1.7);
      for (let i = 0; i < 240; i++) g.camera.update(0.05);
    }, spot);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${out}/phase4-machines-${label}.png` });
  };
  await shoot('base');
  await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    for (const u of s.upgrades.all()) s.state.upgrades[u.id] = u.maxLevel;
    g.machines.refreshUpgrades();
    g.drones.restyle();
  });
  await shoot('upgraded');
} finally {
  await browser.close();
  server.httpServer.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('machine shots ok');
