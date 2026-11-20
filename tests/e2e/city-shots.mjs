// City 04.6: renders the city overview plus one close-up per area type (cleared, with fog around) for review.
//   npm run shots:city            → docs/review/*.png
//   SHOTS_DIR=out node tests/e2e/city-shots.mjs
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
const server = await preview({ preview: { port: 4195, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:4195/?slot=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => !!window.solarbloom);
  // A fresh city, then clear areas until every type has a cleared example.
  const picks = await page.evaluate(() => {
    const g = window.solarbloom;
    const s = g.sim;
    s.state.progression.coreActivated = true;
    s.areas.clear('park', true);
    const byType = {};
    for (let i = 0; i < 80 && Object.keys(byType).length < 7; i++) {
      const id = s.areas.nextGoal();
      if (!id) break;
      for (const t of s.areas.tiles(id)) if (!t.blocked && !t.occupantId && !s.isCoreTile(t)) {
        t.ground = 'restored';
        t.bloom = 1 + (t.variant % 3);
        t.pollution = 0;
        s.grid.touch(t);
      }
      s.areas.clear(id, true);
      const type = s.areas.info(id).type;
      byType[type] ??= s.areas.info(id).landmark;
    }
    byType.park = s.areas.info('park').landmark;
    g.chunks.markAll?.();
    return byType;
  });
  const shot = async (name, x, z, zoom) => {
    await page.evaluate(({ x, z, zoom }) => {
      const g = window.solarbloom;
      g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
      g.camera.glide(x, 0, z, zoom);
      for (let i = 0; i < 300; i++) g.camera.update(0.05);
    }, { x, z, zoom });
    await page.waitForTimeout(8000);
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log(`  ✓ ${dir}/${name}.png`);
  };
  await shot('overview', 8, 8, 0.22);
  for (const [type, [x, z]] of Object.entries(picks)) await shot(`area-${type}`, x + 1, z + 1, 1.0);
} finally {
  await browser.close();
  server.httpServer.close();
}
