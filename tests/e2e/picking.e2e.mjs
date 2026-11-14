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
    // The city ground, focused at a few spots (the park and its surroundings), at each zoom.
    for (const [fx, fz] of [[8, 8], [24, -10], [-12, 20]]) {
      // On the phone, also at both zoom limits (the far overview and the closest view).
      for (const zoom of vp.name === 'phone' ? [...ZOOMS, 0.22, 1.9] : ZOOMS) {
        const res = await page.evaluate(
          ({ zoom, OFFSETS, fx, fz }) => {
            const g = window.solarbloom;
            const V = g.camera.target.constructor;
            g.camera.bounds = { minX: -1e4, maxX: 1e4, minZ: -1e4, maxZ: 1e4 };
            g.camera.glide(fx, 0, fz, zoom);
            for (let i = 0; i < 200; i++) g.camera.update(0.05);
            const out = [];
            for (let z = fz - 14; z < fz + 14; z++)
              for (let x = fx - 14; x < fx + 14; x++) {
                const t = g.sim.grid.get('g', x, z);
                for (const [ox, oz] of OFFSETS) {
                  const s = g.camera.toScreen(new V(x + ox, 0.08, z + oz));
                  if (s.x < 0 || s.y < 0 || s.x > innerWidth || s.y > innerHeight) continue;
                  const p = g.pick(s.x, s.y);
                  out.push({ want: t.id, got: p?.tile?.id ?? null, sameRoof: true });
                }
              }
            if (!out.length) out.push({ want: 'camera', got: JSON.stringify([g.camera.target, g.camera.zoom]), sameRoof: false });
            return out;
          },
          { zoom, OFFSETS, fx, fz },
        );
        checks += res.length;
        const bad = res.filter((r) => r.want !== r.got);
        if (res.length === 1 && res[0].want === 'camera') fail(`${vp.name} (${fx},${fz}) zoom ${zoom}: no tiles on screen, camera ${res[0].got}`);
        if (bad.length) fail(`${vp.name} (${fx},${fz}) zoom ${zoom}: ${bad.length}/${res.length} mispicked, e.g. ${JSON.stringify(bad[0])}`);
      }
    }
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.camera.glide(8, 0, 8, 1);
      for (let i = 0; i < 200; i++) g.camera.update(0.05);
    });
    await page.waitForTimeout(1500); // let the HUD catch up (world labels follow the camera)
    // A real mouse click at a tile's screen position must pulse exactly that tile.
    await page.evaluate(() => window.solarbloom.camera.setZoom(1));
    const target = await page.evaluate(() => {
      const g = window.solarbloom;
      g.paused = true; // keep state still while we inspect it
      const V = g.camera.target.constructor;
      const s = g.camera.toScreen(new V(2.5, 0.08, 4.5));
      return { x: s.x, y: s.y };
    });
    await page.mouse.click(target.x, target.y);
    const clicked = await page.evaluate(() => window.solarbloom.sim.grid.get('g', 2, 4).ground);
    checks++;
    if (clicked !== 'growing') {
      const why = await page.evaluate(({ x, y }) => {
        const g = window.solarbloom;
        const el = document.elementFromPoint(x, y);
        return { pick: g.pick(x, y)?.tile?.id, el: el?.id || el?.className, res: g.sim.state.resources, tool: g.hud.currentTool };
      }, target);
      fail(`${vp.name}: real click on g:2:4 left it '${clicked}' ${JSON.stringify(why)}`);
    }
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
      for (const t of s.progression.tilesFor('home')) if (t.ground === 'prepared') s.restoration.complete(t, 'pulse');
      for (const t of s.progression.tilesFor('home')) if (t.ground === 'polluted' && !t.blocked) { t.ground = 'prepared'; t.pollution = 0; window.solarbloom.chunks.markTile(t); break; }
    });
    await page.waitForTimeout(1500);
    if (errors.length) fail(`${vp.name}: page errors: ${errors.join(' | ')}`);
    console.log(`  ${failures ? '·' : '✓'} ${vp.name} ${vp.width}×${vp.height}`);
    if (vp.name === 'phone') {
      // A quick two-finger pinch-out snaps to the city overview.
      const snapped = await page.evaluate(async () => {
        const g = window.solarbloom;
        g.camera.setZoom(1.2);
        const c = g.app.graphicsDevice.canvas;
        const r = c.getBoundingClientRect();
        const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 1 }));
        const cx = r.width / 2;
        const cy = r.height / 2;
        ev('pointerdown', 1, cx - 150, cy);
        ev('pointerdown', 2, cx + 150, cy);
        for (let i = 1; i <= 6; i++) {
          const half = 150 - i * 20;
          ev('pointermove', 1, cx - half, cy);
          ev('pointermove', 2, cx + half, cy);
          await new Promise((res) => setTimeout(res, 16));
        }
        ev('pointerup', 2, cx + 30, cy);
        ev('pointerup', 1, cx - 30, cy);
        for (let i = 0; i < 300; i++) g.camera.update(0.05);
        return g.camera.zoom;
      });
      checks++;
      if (snapped > 0.25) fail(`phone: a quick pinch-out left the camera at zoom ${snapped.toFixed(2)} instead of the overview`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(failures ? `\n${failures} failure(s) in ${checks} checks` : `\nAll ${checks} picking checks passed`);
process.exit(failures ? 1 : 0);
