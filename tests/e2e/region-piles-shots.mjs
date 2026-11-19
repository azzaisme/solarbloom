// E23.8 (#327–#329): review shots of the regions' salvage piles, in the real game (headless Chromium).
//   node tests/e2e/region-piles-shots.mjs     (after `vite build`; SHOTS_DIR overrides the folder)
// For a few regions, the region is revealed and the camera looks down on the middle of its piles. Each shot
// checks that the piles there are drawn (their tiles carry the pile prop). Fails on any page error.
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
const REGIONS = (process.env.REGIONS ?? 'saltwind,elderGrove,cistern,clockPlaza,glasshouse,observatory').split(',');
const server = await preview({ preview: { port: 4197, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.setDefaultTimeout(300_000);
  await page.goto('http://localhost:4197/?slot=1&gfx=deck');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom?.sim);
  await page.addStyleTag({ content: '#hint, #intro, .toast, #toasts { display: none !important; }' });
  await page.evaluate(() => document.querySelector('#introGo')?.click());
  for (const id of REGIONS) {
    const at = await page.evaluate((id) => {
      const g = window.solarbloom;
      const s = g.sim;
      s.state.areas[id] = { fog: 'thinning', revealedAt: 0 };
      const piles = [];
      for (let z = -100; z < 100; z++)
        for (let x = -100; x < 100; x++) {
          const t = s.grid.get('g', x, z);
          if (t?.prop?.startsWith('pile:') && s.areas.map.areaOfCell(x, z) === id) piles.push([x, z, t.prop]);
        }
      // the middle of the region's piles: the camera centres there, high enough to see most of them
      const cx = piles.reduce((a, p) => a + p[0], 0) / Math.max(1, piles.length);
      const cz = piles.reduce((a, p) => a + p[1], 0) / Math.max(1, piles.length);
      const best = [Math.round(cx), Math.round(cz)];
      const bestN = piles.filter((q) => Math.hypot(q[0] - cx, q[1] - cz) <= 12).length;
      g.chunks.markAll();
      if (g.bot) g.bot.following = false;
      g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
      g.camera.glide(best[0] + 0.5, 0, best[1] + 0.5, 0.55);
      g.camera.turnTo(20);
      for (let i = 0; i < 300; i++) g.camera.update(0.05);
      return { piles: piles.length, near: bestN, at: best, mats: [...new Set(piles.map((p) => p[2].split(':')[1].split('-')[1].replace(/\d+/g, '')))] };
    }, id);
    console.log(`  ${id}: ${at.piles} piles, ${at.near} within 12 cells of their middle (${at.at[0]}, ${at.at[1]})`);
    if (at.piles < 15) { failed = true; console.log(`  ✗ ${id} should have its piles`); }
    await page.waitForTimeout(12000);
    await page.screenshot({ path: `${dir}/region-piles-${id}.png` });
    console.log(`  ✓ ${dir}/region-piles-${id}.png`);
  }
  if (errors.length) { failed = true; console.log('  ✗ page errors:\n   ', errors.join('\n    ')); }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.httpServer.close();
}
process.exit(failed ? 1 : 0);
