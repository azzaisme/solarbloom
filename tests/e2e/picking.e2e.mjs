// End-to-end pointer → tile picking test across screen sizes and zoom levels.
// Run with `npm run test:e2e` (builds first). Requires Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import { createRequire } from 'node:module';
import { preview } from 'vite';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 },
];
const ZOOMS = [0.6, 1, 1.8];
// Offsets inside a tile (fractions of a tile) — corners as well as the centre.
const OFFSETS = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.2], [0.2, 0.85], [0.85, 0.85]];

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
const url = 'http://localhost:4179/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failures = 0;
let checks = 0;
const fail = (msg) => {
  failures++;
  console.error('  ✗', msg);
};

try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => !!window.solarbloom);
    if (await page.locator('#introGo').isVisible()) await page.click('#introGo');
    for (const zoom of ZOOMS) {
      const res = await page.evaluate(
        ({ zoom, OFFSETS }) => {
          const g = window.solarbloom;
          g.camera.setZoom(zoom);
          const V = g.camera.target.constructor;
          const out = [];
          for (const t of g.sim.grid.roof('r1').tiles) {
            for (const [ox, oz] of OFFSETS) {
              const s = g.camera.toScreen(new V(t.x + ox, 0.08, t.z + oz));
              // Only points actually on screen can be clicked by a player.
              if (s.x < 0 || s.y < 0 || s.x > innerWidth || s.y > innerHeight) continue;
              const p = g.pick(s.x, s.y);
              out.push({ want: t.id, got: p?.tile?.id ?? null });
            }
          }
          return out;
        },
        { zoom, OFFSETS },
      );
      checks += res.length;
      const bad = res.filter((r) => r.want !== r.got);
      if (!res.length) fail(`${vp.name} zoom ${zoom}: no tiles on screen`);
      if (bad.length) fail(`${vp.name} zoom ${zoom}: ${bad.length}/${res.length} mispicked, e.g. ${JSON.stringify(bad[0])}`);
    }
    // A real mouse click at a tile's screen position must pulse exactly that tile.
    await page.evaluate(() => window.solarbloom.camera.setZoom(1));
    const target = await page.evaluate(() => {
      const g = window.solarbloom;
      g.paused = true; // keep state still while we inspect it
      const V = g.camera.target.constructor;
      const s = g.camera.toScreen(new V(5.5, 0.08, 5.5));
      return { x: s.x, y: s.y };
    });
    await page.mouse.click(target.x, target.y);
    const clicked = await page.evaluate(() => window.solarbloom.sim.grid.get('r1', 5, 5).ground);
    checks++;
    if (clicked !== 'growing') fail(`${vp.name}: real click on r1:5:5 left it '${clicked}'`);
    // Clicking the HUD must never act on the world underneath.
    const before = await page.evaluate(() => JSON.stringify(window.solarbloom.sim.state.resources));
    const box = await page.locator('#hotbar').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 4);
    const after = await page.evaluate(() => JSON.stringify(window.solarbloom.sim.state.resources));
    checks++;
    if (before !== after) fail(`${vp.name}: clicking the hotbar changed resources`);
    // Regression: when the last tile using a colour (e.g. all moss) disappears, shared meshes must survive.
    await page.evaluate(() => {
      const s = window.solarbloom.sim;
      for (const t of s.grid.roof('r1').tiles) if (t.ground === 'prepared') s.restoration.complete(t, 'pulse');
      for (const t of s.grid.roof('r1').tiles) if (t.ground === 'polluted' && !t.blocked) { t.ground = 'prepared'; t.pollution = 0; window.solarbloom.grid.refresh(t, false); break; }
    });
    await page.waitForTimeout(1500);
    if (errors.length) fail(`${vp.name}: page errors: ${errors.join(' | ')}`);
    console.log(`  ${failures ? '·' : '✓'} ${vp.name} ${vp.width}×${vp.height}`);
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(failures ? `\n${failures} failure(s) in ${checks} checks` : `\nAll ${checks} picking checks passed`);
process.exit(failures ? 1 : 0);
