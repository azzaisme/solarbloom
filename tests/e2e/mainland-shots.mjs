// E23.8.3.1: review shots of the Long Causeway and the mainland (a new old-city game) into docs/review/mainland-*.png.
//   node tests/e2e/mainland-shots.mjs     (after `vite build`; SHOTS_DIR overrides the folder)
// Before the Great Bloom: the broken causeway and the mainland under cloud. After: the causeway raised, the landing
// district and its neighbours out of the cloud, a salvage field close up. Fails on any page error.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { preview } from 'vite';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}
const dir = process.env.SHOTS_DIR ?? 'docs/review';
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4199, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(240_000);
  await page.goto('http://localhost:4199/?slot=1&gfx=deck');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom?.sim);
  await page.addStyleTag({ content: '#hint, #intro, .toast, #toasts { display: none !important; }' });
  const shot = async (name, x, z, zoom, yaw = 0, wait = 8000) => {
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
    console.log(`  ✓ ${dir}/${name}.png`);
  };
  await shot('mainland-causeway-broken', 125, 8, 0.6, 90);
  const info = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.state.salvage.tier = 5;
    s.bus.emit('fountain.tier', { tier: 5 });
    // restore the landing district and the next ring out, so their neighbours come out of the cloud
    const land = s.areas.map.areaOfChunk(9, 0);
    s.areas.clear(land, true);
    for (const nb of s.areas.info(land).neighbours) if (nb.startsWith('ml_')) s.areas.clear(nb, true);
    // for comparison: an island backstreet by the causeway, cleared the same way
    s.state.areas['bs_5_0'] ??= { fog: 'frontier', revealedAt: 0 };
    s.areas.clear('bs_5_0', true);
    g.chunks.markAll();
    const seen = Object.keys(s.state.areas).filter((id) => id.startsWith('ml_'));
    return { seen, types: seen.map((id) => `${id}:${s.areas.info(id).type}`) };
  });
  console.log('  mainland areas out of the cloud:', info.types.join(', '));
  await shot('mainland-causeway-raised', 125, 8, 0.6, 90, 25000);
  await shot('mainland-compare-island-backstreet', 88, 8, 0.5, 90, 15000);
  const fog = await page.evaluate(() => { const a = window.solarbloom.sim.areas; return { landing: a.fog('ml_4_0'), next: a.fog('ml_5_0'), beyond: a.fog('ml_6_0'), sealed: a.sealed('ml_6_0') }; });
  console.log('  fog:', JSON.stringify(fog));
  if (fog.landing !== 'cleared' || fog.next !== 'cleared' || fog.beyond !== 'frontier' || fog.sealed) {
    failed = true;
    console.log('  ✗ the restored mainland should be clear, and the next district out open (frontier, never sealed)');
  }
  await shot('mainland-landing', 160, 16, 0.5, 90);
  await shot('mainland-overview', 175, 10, 0.25, 60);
  const field = await page.evaluate(() => {
    const s = window.solarbloom.sim;
    for (let cx = 9; cx < 12; cx++)
      for (let cz = -2; cz < 2; cz++)
        for (let z = cz * 16; z < cz * 16 + 16; z++)
          for (let x = cx * 16; x < cx * 16 + 16; x++) {
            const t = s.grid.get('g', x, z);
            if (t?.prop?.startsWith('pile:ml:')) return [x, z];
          }
    return undefined;
  });
  if (field) await shot('mainland-salvage-field', field[0] + 0.5, field[1] + 0.5, 1.4, 0);
  else console.log('  ✗ no salvage field near the landing');
  if (errors.length) {
    failed = true;
    console.log('  ✗ page errors:\n   ', errors.join('\n    '));
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);
