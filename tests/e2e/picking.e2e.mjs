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
    // Every rooftop, each focused in turn (all unlocked for the test), at each zoom.
    await page.evaluate(() => {
      const g = window.solarbloom;
      for (const r of g.sim.state.rooftops) {
        r.unlocked = true;
        r.preview = false;
      }
    });
    for (const roofId of ['r1', 'r2', 'r3']) {
      for (const zoom of ZOOMS) {
        const res = await page.evaluate(
          ({ zoom, OFFSETS, roofId }) => {
            const g = window.solarbloom;
            const roof = g.sim.grid.roof(roofId);
            const V = g.camera.target.constructor;
            const cy = roof.origin[1] + roof.height;
            g.camera.glide(roof.origin[0] + roof.width / 2, cy, roof.origin[2] + roof.depth / 2, zoom);
            for (let i = 0; i < 200; i++) g.camera.update(0.05);
            const out = [];
            for (const t of roof.tiles) {
              for (const [ox, oz] of OFFSETS) {
                const s = g.camera.toScreen(new V(roof.origin[0] + t.x + ox, cy + 0.08, roof.origin[2] + t.z + oz));
                // Only points actually on screen can be clicked by a player.
                if (s.x < 0 || s.y < 0 || s.x > innerWidth || s.y > innerHeight) continue;
                const p = g.pick(s.x, s.y);
                // A taller rooftop in front may legitimately cover this point; never a wrong tile on the same roof.
                out.push({ want: t.id, got: p?.tile?.id ?? null, sameRoof: !p || p.roofId === roofId });
              }
            }
            if (!out.length) out.push({ want: 'camera', got: JSON.stringify([g.camera.target, g.camera.zoom, g.camera.goalPoint]), sameRoof: false });
            return out;
          },
          { zoom, OFFSETS, roofId },
        );
        const own = res.filter((r) => r.sameRoof);
        checks += own.length;
        const bad = own.filter((r) => r.want !== r.got);
        if (own.length < res.length * 0.7) fail(`${vp.name} ${roofId} zoom ${zoom}: only ${own.length}/${res.length} points reach their own roof`);
        if (res.length === 1 && res[0].want === 'camera') fail(`${vp.name} ${roofId} zoom ${zoom}: no tiles on screen, camera ${res[0].got}`);
        if (bad.length) fail(`${vp.name} ${roofId} zoom ${zoom}: ${bad.length}/${own.length} mispicked, e.g. ${JSON.stringify(bad[0])}`);
      }
    }
    await page.evaluate(() => {
      const g = window.solarbloom;
      g.camera.reset();
      for (let i = 0; i < 200; i++) g.camera.update(0.05);
    });
    await page.waitForTimeout(1500); // let the HUD catch up (world labels follow the camera)
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
    if (clicked !== 'growing') {
      const why = await page.evaluate(({ x, y }) => {
        const g = window.solarbloom;
        const el = document.elementFromPoint(x, y);
        return { pick: g.pick(x, y)?.tile?.id, el: el?.id || el?.className, res: g.sim.state.resources, tool: g.hud.currentTool };
      }, target);
      fail(`${vp.name}: real click on r1:5:5 left it '${clicked}' ${JSON.stringify(why)}`);
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
