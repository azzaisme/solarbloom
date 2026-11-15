// A generated rooftop cluster (City 12.1): out of reach, then reached by a Bloom Relay and partly restored.
// Screenshots to docs/review/rooftop-cluster-{locked,reached}.png.
import { createRequire } from 'node:module';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] ?? 'docs/review';
const server = await preview({ preview: { port: 4196, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let ok = true;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:4196/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  if (await page.locator('#introGo').isVisible()) await page.click('#introGo');
  const found = await page.evaluate(() => {
    const g = window.solarbloom, s = g.sim, st = s.state;
    st.caps.energy = new (st.resources.energy.constructor)(1e6); st.caps.water = new (st.resources.energy.constructor)(1e6);
    st.resources.energy = new (st.resources.energy.constructor)(1e5); st.resources.water = new (st.resources.energy.constructor)(1e5); st.resources.biomass = new (st.resources.energy.constructor)(1e5);
    st.progression.coreActivated = true;
    s.areas.clear('park', true);
    let id;
    for (let r = 1; r <= 8 && !id; r++)
      for (let cz = -r; cz <= r && !id; cz++)
        for (let cx = -r; cx <= r && !id; cx++) {
          const a = s.areas.map.areaOfChunk(cx, cz);
          if (s.areas.map.rooftop(a)) id = a;
        }
    if (!id) return null;
    for (const nb of s.areas.info(id).neighbours) s.areas.clear(nb, true);
    const roof = s.clusters.roof(id);
    g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
    g.camera.glide(roof.origin[0] + roof.width / 2, 0, roof.origin[2] + roof.depth / 2, 0.75);
    for (let i = 0; i < 200; i++) g.camera.update(0.05);
    return { id, roof: roof.id, unlocked: roof.unlocked };
  });
  if (!found) {
    console.log('  · no rooftop cluster near the park in this city (random seed): skipped');
  } else {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/rooftop-cluster-locked.png` });
    const after = await page.evaluate(({ id }) => {
      const g = window.solarbloom, s = g.sim;
      const hubSpot = s.areas.tiles(s.areas.info(id).neighbours[0]).find((t) => s.build.check('droneHub', 'g', t.x, t.z).spotOk || (!t.blocked && !t.occupantId));
      for (const t of s.grid.footprint('g', hubSpot.x, hubSpot.z, 2)) if (t) { t.ground = 'restored'; t.blocked = false; s.grid.touch(t); }
      s.build.place('droneHub', 'g', hubSpot.x, hubSpot.z);
      for (let i = 0; i < 40; i++) {
        const step = s.advisor.specialtyStep(id);
        if (!step) break;
        if (step.action.kind === 'build') s.build.place(step.action.type, 'g', step.action.x, step.action.z);
        else if (step.action.kind === 'focus') s.restoration.pulse(s.grid.get(step.action.layer ?? 'g', step.action.x, step.action.z).id);
        s.advance(1);
      }
      return { unlocked: s.clusters.roof(id).unlocked, roofRestored: s.clusters.counts(id).restored };
    }, found);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/rooftop-cluster-reached.png` });
    if (!after.unlocked || after.roofRestored < 1) {
      ok = false;
      console.error('  ✗ the rooftop was not reached and restored', JSON.stringify(after));
    } else console.log(`  ✓ rooftop ${found.roof} reached by a relay; ${after.roofRestored} roof tiles restored`);
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(ok ? 0 : 1);
