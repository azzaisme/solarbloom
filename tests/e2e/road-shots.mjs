// City 16.5–16.6: road network review shots.
//   npm run shots:roads           → docs/review/roads-*.png
// Overview before (ground generation 3: the old row/column lattice) and after (generation 4: the planned network),
// and a close-up of a junction-heavy spot (an arterial crossing near the park) dead, then restored.
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
const seed = Number(process.env.SEED ?? 42);
mkdirSync(dir, { recursive: true });
const server = await preview({ preview: { port: 4196, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));

  /** A fresh game on `seed`, with its ground at generation `gen`. */
  const fresh = async (gen) => {
    await page.goto('http://localhost:4196/?slot=1');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom);
    await page.evaluate(
      ({ seed, gen }) => {
        const g = window.solarbloom;
        const s = JSON.parse(JSON.stringify(g.sim.state));
        s.seed = seed;
        for (const l of s.layers) if (l.kind === 'ground') l.gen = gen;
        g.resetting = true;
        g.saver.save(s);
      },
      { seed, gen },
    );
    // Saving a state with a new seed: reload into it (the game rebuilds the world from the seed).
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom);
    await page.evaluate(() => {
      document.querySelector('#hint')?.remove();
      document.querySelector('#intro')?.setAttribute('hidden', '');
    });
  };
  const shot = async (name, x, z, zoom, wait = 8000) => {
    await page.evaluate(({ x, z, zoom }) => {
      const g = window.solarbloom;
      g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
      g.camera.glide(x, 0, z, zoom);
      for (let i = 0; i < 300; i++) g.camera.update(0.05);
    }, { x, z, zoom });
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${dir}/${name}.png` });
    console.log(`  ✓ ${dir}/${name}.png`);
  };
  /** Clear (lift the fog on) every area within r chunks, so the overview shows the ground. */
  const reveal = (r, restore) =>
    page.evaluate(
      ({ r, restore }) => {
        const g = window.solarbloom;
        const s = g.sim;
        s.state.progression.coreActivated = true;
        const ids = new Set();
        for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) ids.add(s.areas.map.areaOfChunk(cx, cz));
        for (const id of ids) {
          if (restore)
            for (const t of s.areas.tiles(id))
              if (!t.blocked && !t.occupantId && !s.isCoreTile(t)) {
                t.ground = 'restored';
                t.bloom = 1 + (t.variant % 3);
                t.pollution = 0;
                s.grid.touch(t);
              }
          s.areas.clear(id, true);
        }
        g.chunks.markAll?.();
      },
      { r, restore },
    );

  await fresh(3);
  await reveal(5, false);
  await shot('roads-before-overview', 8, 8, 0.3, 12000);

  await fresh(4);
  await reveal(5, false);
  await shot('roads-after-overview', 8, 8, 0.3, 12000);
  // Junction-heavy: where the ring crosses the east avenue (chunk 3, 0), dead then restored.
  await shot('roads-junction-dead', 3 * 16 + 2, 7, 1.0);
  await reveal(5, true);
  await shot('roads-junction-restored', 3 * 16 + 2, 7, 1.0);
} finally {
  await browser.close();
  server.httpServer.close();
}
